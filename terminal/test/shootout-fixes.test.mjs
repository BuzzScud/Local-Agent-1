// The harness fixes from the model shootout (4 Oct 2026: one hard task, the same for six big models on a
// service). Three of the runs were stopped by the harness, not the task: qwen3-coder-next sent its plan
// as a string of JSON under items and tasks and called CodeSearch, which is off in the bench (five errors
// in a row); gpt-oss:120b called its own repo_browser.print_tree five times; Qwen3.6 asked for lines 95-120
// of a 183-line file with sed and got the whole file, unnumbered, three times.
import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-shootout-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { Agent } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { parseArgs, toolNameOf, patchOps, desktopDefault } = await import('../src/agent/tools.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL, setEndpoint, dropEndpoint } = await import('../../models/index.mjs');
const { fakeOllama } = await import('./fake-ollama.mjs');

const local = MODELS[DEFAULT_MODEL];
const remote = { ...local, remote: { kind: 'openai', label: 'the service', ollama: '0.12.0' }, harness: { read: { whole: 400 } } };
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentic-shootout-'));
  writeFileSync(join(dir, 'short.txt'), Array.from({ length: 183 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  writeFileSync(join(dir, 'long.txt'), Array.from({ length: 900 }, (_, i) => `row ${i + 1}`).join('\n') + '\n');
});
const agentOn = (url, model, extra = {}) => new Agent({ url, model, cwd: dir, system: systemPrompt({ cwd: dir, git: 'none' }), memory: false, flows: false, verify: false, mode: 'bypass', confirmPlan: false, way: 'model', hooks: [], ask: async () => ({ choice: 'yes' }), ...extra });

test('a plan sent as text is the list it means: JSON in a string, items or tasks, or a step a line', () => {
  const json = JSON.stringify([{ id: '1', content: 'Export plainRead', status: 'in_progress' }, { id: '2', content: 'Add tests', status: 'pending' }]);
  for (const key of ['items', 'tasks', 'todos']) {
    const { args, error } = parseArgs('TodoWrite', JSON.stringify({ [key]: json }), 'model');
    expect(error).toBeUndefined();
    expect(args.todos).toEqual([{ text: 'Export plainRead', status: 'in_progress' }, { text: 'Add tests', status: 'pending' }]);
  }
  const { args } = parseArgs('TodoWrite', JSON.stringify({ plan: '1. Update agent.mjs step()\n2. Add tests\n- [x] Read the files' }), 'model');
  expect(args.todos).toEqual([{ text: 'Update agent.mjs step()', status: 'pending' }, { text: 'Add tests', status: 'pending' }, { text: 'Read the files', status: 'done' }]);
});

test("gpt-oss's own tool names run as the tools here, with their arguments", () => {
  expect(toolNameOf('repo_browser.print_tree', 'model')).toBe('List');
  expect(toolNameOf('repo_browser.open_file', 'model')).toBe('Read');
  expect(toolNameOf('repo_browser.search', 'model')).toBe('Search');
  expect(toolNameOf('container.exec', 'model')).toBe('Bash');
  expect(toolNameOf('functions.Read', 'model')).toBe('Read');
  expect(toolNameOf('Read', 'model')).toBe('Read');
  expect(toolNameOf('repo_browser.unknown', 'model')).toBe('repo_browser.unknown');
  expect(parseArgs('Read', JSON.stringify({ path: 'a.mjs', line_start: 5, line_end: 9 }), 'model').args).toMatchObject({ path: 'a.mjs', offset: 5, limit: 5 });
  expect(parseArgs('Bash', JSON.stringify({ cmd: ['bash', '-lc', 'ls -la'] }), 'model').args.command).toBe('ls -la');
  expect(parseArgs('Bash', JSON.stringify({ cmd: ['ls', '-la'] }), 'model').args.command).toBe('ls -la');
  expect(parseArgs('Search', JSON.stringify({ query: 'plainRead' }), 'model').args.pattern).toBe('plainRead');
});

test('a repo_browser.print_tree call lists the folder instead of failing', async () => {
  const fake = await startFakeServer([{ tool: { name: 'repo_browser.print_tree', args: { path: '', depth: 2 } } }, { text: 'Two text files.' }]);
  try {
    const a = agentOn(fake.url, remote);
    const ran = [];
    a.on('tool', (e) => ran.push(e.name));
    await a.send('what files are here?');
    expect(ran).toContain('List');
    const out = a.messages.filter((m) => m.role === 'tool' && !m.opening).map((m) => String(m.content));
    expect(out.some((t) => /There is no tool called/.test(t))).toBe(false);
    expect(out.some((t) => t.includes('short.txt'))).toBe(true);
  } finally { await fake.close(); }
});

test('CodeSearch is offered only when it can run', () => {
  const a = agentOn('http://127.0.0.1:1', remote);
  const names = () => a.tools().map((t) => t.function.name);
  a.helpers.delete('rag');
  expect(a.codeSearchOff()).toMatch(/off/);
  expect(names()).not.toContain('CodeSearch');
  expect(names()).toContain('Search');
  a.helpers.add('rag');
  a.searchEmbedder = { embed: async () => [] };
  expect(a.codeSearchOff()).toBeNull();
  expect(names()).toContain('CodeSearch');
});

test('a range of a short file runs as the command; a range of a long one still runs as Read', async () => {
  const fake = await startFakeServer([
    { tool: { name: 'Bash', args: { command: "sed -n '95,97p' short.txt" } } }, { text: 'Lines 95 to 97.' },
    { tool: { name: 'Bash', args: { command: "sed -n '600,602p' long.txt" } } }, { text: 'Rows 600 to 602.' },
  ]);
  try {
    const a = agentOn(fake.url, remote);
    await a.send('show lines 95-97 of short.txt');
    const short = String(a.messages.filter((m) => m.role === 'tool' && !m.opening).pop().content);
    expect(short).not.toContain('(Run as Read');
    expect(short).toContain('line 95\nline 96\nline 97');
    expect(short).not.toContain('line 1\n');
    await a.send('show rows 600-602 of long.txt');
    const long = String(a.messages.filter((m) => m.role === 'tool' && !m.opening).pop().content);
    expect(long).toStartWith('(Run as Read');
    expect(long).toContain('row 600');
  } finally { await fake.close(); }
});

// Qwen3.6 at 64k sent its plan one step a call ({"task": "…", "active": "1"}), then as lines under "task";
// five of those, each "TodoWrite needs todos", stopped the run at five errors in a row.
test('a plan step sent alone joins the plan; lines under "task" are the whole plan', async () => {
  const one = parseArgs('TodoWrite', JSON.stringify({ task: 'Add plainRead to tools.mjs', active: '1' }), 'model');
  expect(one.error).toBeUndefined();
  expect(one.args.todos).toEqual([{ text: 'Add plainRead to tools.mjs', status: 'pending' }]);
  const lines = parseArgs('TodoWrite', JSON.stringify({ task: 'Add plainRead\n- Route it in step\n- Add tests\n- Run npm test' }), 'model');
  expect(lines.args.todos.map((t) => t.text)).toEqual(['Add plainRead', 'Route it in step', 'Add tests', 'Run npm test']);
  expect(lines.args.one).toBeUndefined();
  const fake = await startFakeServer([
    { tool: { name: 'TodoWrite', args: { task: 'Add plainRead' } } },
    { tool: { name: 'TodoWrite', args: { task: 'Add tests' } } },
    { tool: { name: 'TodoWrite', args: { task: 'Add plainRead', status: 'done' } } },
    { text: 'Planned.' },
  ]);
  try {
    const a = agentOn(fake.url, remote);
    await a.send('plan it');
    expect(a.todos).toEqual([{ text: 'Add tests', status: 'pending' }, { text: 'Add plainRead', status: 'done' }]);
  } finally { await fake.close(); }
});

test('five TodoWrite calls in the wrong shape do not stop the run; other errors still do', async () => {
  const bad = (i) => ({ tool: { name: 'TodoWrite', args: { n: i } } });
  const fake = await startFakeServer([bad(1), bad(2), bad(3), bad(4), bad(5), bad(6), { tool: { name: 'List', args: { path: '.' } } }, { text: 'Two files.' }]);
  try {
    const a = agentOn(fake.url, remote);
    const notes = [];
    a.on('note', (e) => notes.push(e.text));
    expect(await a.send('what files are here?')).not.toBe('stuck');
    expect(notes.some((t) => /Five tool errors in a row/.test(t))).toBe(false);
  } finally { await fake.close(); }
  const missing = (i) => ({ tool: { name: 'Read', args: { path: `gone-${i}.txt` } } });
  const fake2 = await startFakeServer([missing(1), missing(2), missing(3), missing(4), missing(5), { text: 'Stopped.' }, { text: 'Stopped.' }]);
  try {
    const b = agentOn(fake2.url, remote);
    const notes = [];
    b.on('note', (e) => notes.push(e.text));
    await b.send('read the files');
    expect(notes.some((t) => /Five tool errors in a row/.test(t))).toBe(true);
  } finally { await fake2.close(); }
});

// gpt-oss at 64k called its tools without the repo_browser. prefix too (open_file, print_tree, exec) and
// changed files with apply_patch: 23 errors, stopped at five in a row, nothing written.
test("gpt-oss's names without their prefix, and apply_patch, are the tools here", () => {
  for (const [n, to] of [['open_file', 'Read'], ['print_tree', 'List'], ['exec', 'Bash'], ['search', 'Search'], ['apply_patch', 'apply_patch'], ['repo_browser.apply_patch', 'apply_patch'], ['container.exec', 'Bash'], ['functions.Edit', 'Edit']]) expect(toolNameOf(n, 'model')).toBe(to);
});

test('a patch is its Edits and Writes, in order; a delete is not done', () => {
  const patch = ['*** Begin Patch', '*** Update File: a.mjs', '@@', ' const x = 1;', '-const y = 2;', '+const y = 3;', '@@ function f', ' function f() {', '-  return 1;', '+  return 2;', ' }', '*** Add File: b.mjs', '+export const b = 1;', '+export const c = 2;', '*** End Patch'].join('\n');
  expect(patchOps(patch)).toEqual([
    { name: 'Edit', args: { path: 'a.mjs', old_text: 'const x = 1;\nconst y = 2;', new_text: 'const x = 1;\nconst y = 3;' } },
    { name: 'Edit', args: { path: 'a.mjs', old_text: 'function f() {\n  return 1;\n}', new_text: 'function f() {\n  return 2;\n}' } },
    { name: 'Write', args: { path: 'b.mjs', content: 'export const b = 1;\nexport const c = 2;\n' } },
  ]);
  expect(patchOps('*** Begin Patch\n*** Update File: a.mjs\n@@\n@@\n*** End Patch')).toEqual([]);
  expect(patchOps('*** Begin Patch\n*** Delete File: a.mjs\n*** End Patch')[0].error).toMatch(/not done by a patch/);
  // Deleted and added again: the file written whole (gpt-oss replaces a file this way).
  expect(patchOps('*** Begin Patch\n*** Delete File: a.mjs\n*** Add File: a.mjs\n+export const a = 2;\n*** End Patch')).toEqual([{ name: 'Write', args: { path: 'a.mjs', content: 'export const a = 2;\n' } }]);
});

test('open_file then apply_patch changes the file, through Edit', async () => {
  writeFileSync(join(dir, 'a.mjs'), 'const x = 1;\nconst y = 2;\nexport { x, y };\n');
  const patch = '*** Begin Patch\n*** Update File: a.mjs\n@@\n const x = 1;\n-const y = 2;\n+const y = 3;\n*** End Patch';
  const fake = await startFakeServer([
    { tool: { name: 'open_file', args: { path: 'a.mjs', line_start: 1, line_end: 400 } } },
    { tool: { name: 'repo_browser.apply_patch', args: { patch } } },
    { text: 'y is 3 now.' }, { text: 'y is 3 now.' },
  ]);
  try {
    const a = agentOn(fake.url, remote);
    const ran = [];
    a.on('tool', (e) => ran.push(e.name));
    await a.send('make y 3 in a.mjs');
    expect(ran).toEqual(expect.arrayContaining(['Read', 'Edit']));
    expect(readFileSync(join(dir, 'a.mjs'), 'utf8')).toBe('const x = 1;\nconst y = 3;\nexport { x, y };\n');
    expect(a.messages.filter((m) => m.role === 'tool').some((m) => /There is no tool called/.test(String(m.content)))).toBe(false);
  } finally { await fake.close(); }
});

// The notes when memory fills, on a service: Ollama has no thinking cap, so with thinking on the
// 828 tokens went to thinking and every note came out empty (4 Oct 2026, at 32k and at 64k).
test('the notes when memory fills ask a model on a service with thinking off, with room to write', async () => {
  const fake = await startFakeServer([{ text: 'Notes: plainRead is in tools.mjs at line 60; the tail offset is wrong; tests 4 of 7 pass; next, fix tail.' }]);
  try {
    const a = agentOn(fake.url, remote, { thinking: true });
    a.messages.push({ role: 'user', content: 'add plainRead' }, { role: 'assistant', content: 'Reading.' }, { role: 'tool', content: 'x'.repeat(200), tool_call_id: 'c' }, { role: 'assistant', content: 'Next.' });
    await a.notesInPlace();
    const req = fake.requests.filter((r) => r.messages).at(-1);
    expect(JSON.stringify(req.messages.at(-1))).toContain('memory is nearly full');
    expect(JSON.stringify(req)).not.toMatch(/"(enable_thinking|think)":true/);
    expect(req.max_tokens ?? req.options?.num_predict).toBe(700 + 1024);
  } finally { await fake.close(); }
});

test('a new test file in a code project is written there, not asked about', () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-shootout-h-'));
  const cwd = join(home, 'code', 'mini');
  for (const name of ['plainRead.test.mjs', 'cart.spec.ts', 'test_cart.py']) expect(desktopDefault(name, { cwd, home, request: 'add tests', code: true })).toBeNull();
  expect(desktopDefault('helper.mjs', { cwd, home, request: 'add a helper', code: true })).toEqual({ ask: true, name: 'helper.mjs' });
  expect(desktopDefault('report.html', { cwd, home, request: 'make a page', code: true })).toEqual({ to: join(home, 'Desktop', 'report.html') });
});

// Eight more runs (4 Oct 2026, late): "Edit needs path" and "Write needs content" three times each, and a
// made-up folder before a command six times ("cd /testbed && npm test"), each a refused step.
test('an Edit with no path goes to the one file it has seen with that text; a Write of old and new text is the Edit it means', async () => {
  const fake = await startFakeServer([
    { tool: { name: 'Read', args: { path: 'short.txt', offset: 1, limit: 20 } } },
    { tool: { name: 'Edit', args: { old_text: 'line 5\n', new_text: 'LINE 5\n' } } },
    { tool: { name: 'Write', args: { path: 'short.txt', old_text: 'line 6\n', new_text: 'LINE 6\n' } } },
    { text: 'Both lines are in capitals now.' }, { text: 'again' },
  ]);
  try {
    const a = agentOn(fake.url, remote);
    await a.send('put lines 5 and 6 of short.txt in capitals');
    const text = readFileSync(join(dir, 'short.txt'), 'utf8');
    expect(text).toContain('line 4\nLINE 5\nLINE 6\nline 7');
    const out = a.messages.filter((m) => m.role === 'tool').map((m) => String(m.content));
    expect(out.some((t) => /Edit needs "path"|Write needs "content"/.test(t))).toBe(false);
  } finally { await fake.close(); }
});

test('a folder that is not there before a command: the command runs in the project folder and says so', async () => {
  const fake = await startFakeServer([
    { tool: { name: 'Bash', args: { command: 'cd /testbed-that-is-not-here && ls' } } },
    { text: 'Two files.' }, { text: 'again' },
  ]);
  try {
    const a = agentOn(fake.url, remote);
    await a.send('what files are here?');
    const out = String(a.messages.filter((m) => m.role === 'tool' && !m.opening).pop().content);
    expect(out).toStartWith('(There is no /testbed-that-is-not-here on this machine. You are already in the project folder');
    expect(out).toContain('short.txt');
    expect(out).not.toContain('outside the project folder');
  } finally { await fake.close(); }
});

// Qwen3.6 on the service thought two to three minutes in single steps and ran out of its 25 minutes in four
// runs of six: an Ollama service takes no thinking cap, so the step-down past half the time did nothing there.
test('past half its time on an Ollama service, replies are asked for with thinking off', async () => {
  const svc = await fakeOllama();
  setEndpoint(svc.url, { remote: true, kind: 'openai', ollama: true, thinks: true, model: 'coder:30b', numCtx: 65536, keepAlive: -1, free: true });
  try {
    const a = new Agent({ url: svc.url, model: { ...local, remote: { model: 'coder:30b' } }, cwd: dir, system: 'x', memory: false, flows: false, mode: 'bypass', way: 'model', hooks: [], thinking: true, thinkBudgetSecs: 1500, ctx: 65536 });
    const notes = [];
    a.on('note', (e) => notes.push(e.text));
    await a.send('hello');
    const chats = () => svc.seen.filter((x) => x.path === '/api/chat');
    expect(chats().at(-1).body.think).toBe(true);
    expect(a.serviceSteppedDown()).toBe(false);
    a.requestStarted = Date.now() - 800_000; // 13 of its 25 minutes
    a.turn.errorsInRow = 1;
    expect(a.serviceSteppedDown()).toBe(false); // not while steps are failing
    a.turn.errorsInRow = 0;
    await a.generate();
    expect(chats().at(-1).body.think).toBe(false);
    expect(notes.some((t) => /Half of the 25 minutes for this request used: thinking is off from here/.test(t))).toBe(true);
    // No budget: never.
    a.thinkBudgetSecs = 0;
    expect(a.serviceSteppedDown()).toBe(false);
  } finally { dropEndpoint?.(svc.url); await svc.close?.(); }
});

// One reply of Qwen3.6 thought for 14 minutes (28.4k tokens) to the end of its reply room: an Ollama
// service takes no thinking cap, so the app holds the model's own budget and asks again with thinking off.
test('a reply that thinks past the budget on an Ollama service is stopped and asked for again with thinking off', async () => {
  const svc = await fakeOllama({ overthink: 60_000 });
  setEndpoint(svc.url, { remote: true, kind: 'openai', ollama: true, thinks: true, model: 'coder:30b', numCtx: 65536, keepAlive: -1, free: true });
  try {
    const a = new Agent({ url: svc.url, model: { ...local, thinkingBudget: 300, remote: { model: 'coder:30b' } }, cwd: dir, system: 'x', memory: false, flows: false, mode: 'bypass', way: 'model', hooks: [], thinking: true, ctx: 65536 });
    const notes = [];
    a.on('note', (e) => notes.push(e.text));
    expect(await a.send('hello')).toBe('done');
    const thinks = svc.seen.filter((x) => x.path === '/api/chat').map((x) => x.body.think);
    expect(thinks).toEqual([true, false]);
    expect(notes.some((t) => /It thought past .* in one reply \(the service takes no thinking cap\): that reply is asked for again with thinking off/.test(t))).toBe(true);
    expect(String(a.messages.at(-1).content)).toContain('From coder:30b');
  } finally { dropEndpoint?.(svc.url); await svc.close?.(); }
});
