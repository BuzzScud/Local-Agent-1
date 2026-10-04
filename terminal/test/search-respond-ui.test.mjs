// How it searches, answers and looks (4 Oct 2026, the owner's picks after two watched runs on a
// service): a plain read in a command (cat, head, grep -r, ls, find) runs as the app's own tool on a
// model on another machine; a code project's README goes with the first request; your standing rules
// go with each request; the opening read says your rules are in the instructions; under the answer,
// what it made; the page check and the second look are steps; a long command shows its first line.
import { test, expect, beforeEach } from 'bun:test';
import React from 'react';
import { renderToString } from 'ink';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-sru-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { Agent } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { plainRead } = await import('../src/agent/tools.mjs');
const { openingRead } = await import('../src/agent/opening.mjs');
const { openMemory, memoryDirs, applyChanges, alwaysRules } = await import('../src/agent/facts.mjs');
const { CheckNode, MadeNode, cmdShown } = await import('../src/app/rail.jsx');
const { startFakeServer } = await import('./fake-server.mjs');
const { runInPty, emulate } = await import('./pty.mjs');
const { T, setup, quit } = await import('./app-setup.mjs');
const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');

const local = MODELS[DEFAULT_MODEL];
const remote = { ...local, remote: { kind: 'openai', label: 'the service', ollama: '0.12.0' } };
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentic-sru-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'cart.mjs'), 'export const total = (xs) => xs.reduce((a, b) => a + b, 0);\n');
  writeFileSync(join(dir, 'src', 'tax.mjs'), 'export const tax = (x) => x * 0.2;\n');
  writeFileSync(join(dir, 'src', 'ship.mjs'), 'export const ship = 5;\n');
  writeFileSync(join(dir, 'notes.txt'), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
});
const agentOn = (url, model, extra = {}) => new Agent({ url, model, cwd: dir, system: systemPrompt({ cwd: dir, git: 'none' }), memory: false, flows: false, verify: false, mode: 'bypass', confirmPlan: false, way: 'model', hooks: [], ask: async () => ({ choice: 'yes' }), ...extra });

test('a plain read in a command is the app tool it stands for; anything else is not', () => {
  expect(plainRead('cat notes.txt', dir)).toEqual({ name: 'Read', args: { path: 'notes.txt' } });
  expect(plainRead('head -n 5 notes.txt', dir)).toEqual({ name: 'Read', args: { path: 'notes.txt', offset: 1, limit: 5 } });
  expect(plainRead('tail -3 notes.txt', dir)).toEqual({ name: 'Read', args: { path: 'notes.txt', offset: 28, limit: 3 } });
  expect(plainRead("sed -n '10,12p' notes.txt", dir)).toEqual({ name: 'Read', args: { path: 'notes.txt', offset: 10, limit: 3 } });
  expect(plainRead('grep -rn "total" src', dir)).toEqual({ name: 'Search', args: { pattern: 'total', path: 'src' } });
  expect(plainRead('ls -la src 2>/dev/null', dir)).toEqual({ name: 'List', args: { path: 'src' } });
  expect(plainRead("find src -type f -name '*.mjs'", dir)).toEqual({ name: 'List', args: { path: 'src', pattern: '**/*.mjs' } });
  for (const c of ['cat notes.txt | head', 'grep -i total src/cart.mjs', 'cat a b', 'ls missing', 'head -c 9 notes.txt', 'find . -mtime -1', 'cat notes.txt > copy.txt']) expect(plainRead(c, dir)).toBeNull();
});

test('on a model on another machine, cat runs as Read and the result says so; on this Mac it runs as typed', async () => {
  const fake = await startFakeServer([{ tool: { name: 'Bash', args: { command: 'cat notes.txt' } } }, { text: 'It has 30 lines.' }, { tool: { name: 'Bash', args: { command: 'cat notes.txt' } } }, { text: 'Same.' }]);
  try {
    const a = agentOn(fake.url, remote);
    const tools = [];
    a.on('tool', (e) => tools.push(e.name));
    await a.send('what is in notes.txt?');
    expect(tools).toContain('Read');
    expect(String(a.messages.find((m) => m.role === 'tool' && !m.opening).content)).toStartWith("(Run as Read: the app's own tool shows a long file in parts, with an outline. Use Read yourself.)");
    const b = agentOn(fake.url, local);
    const ran = [];
    b.on('tool', (e) => ran.push(e.name));
    await b.send('what is in notes.txt?');
    expect(ran).toContain('Bash');
  } finally { await fake.close(); }
});

test('a code project\'s README goes with the first request to a model on another machine, once, when it says something', async () => {
  writeFileSync(join(dir, 'package.json'), '{"name":"shop"}');
  writeFileSync(join(dir, 'README.md'), `# Shop\n\nThe cart, tax and shipping of a small shop. ${'Each part is a module in src/, tested with node --test. '.repeat(4)}\n`);
  const fake = await startFakeServer([{ text: 'A shop.' }, { text: 'Still a shop.' }]);
  try {
    const a = agentOn(fake.url, remote);
    await a.send('what is this project?');
    const first = fake.requests[0].messages.filter((m) => m.role === 'user').at(-1).content;
    expect(first).toContain('What this project says about itself (README.md; Read it for the rest):\nREADME.md:\n# Shop');
    await a.send('and the tax?');
    expect(fake.requests[1].messages.filter((m) => m.role === 'user').at(-1).content).not.toContain('What this project says about itself');
  } finally { await fake.close(); }
});

test('your standing rules go with each request to a model on another machine, and the opening read says they are in the instructions', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-sru-me-'));
  openMemory(dir, { home });
  const { you } = memoryDirs(dir, home);
  applyChanges(you, { add: [{ kind: 'you', always: true, text: 'Explain simply: the result first, then a few short steps.' }, { kind: 'you', always: true, text: 'Never say a check passed unless you ran it.' }, { kind: 'you', text: 'The user lives near the sea.' }] });
  // A new memory starts with two rules of its own (facts.mjs), so four in all.
  const rules = alwaysRules(dir, { home });
  expect(rules).toEqual(expect.arrayContaining(['Explain simply: the result first, then a few short steps.', 'Never say a check passed unless you ran it.']));
  expect(rules).not.toContain('The user lives near the sea.');
  const r = openingRead(dir, { memory: { home }, home, you: false });
  expect(r.view.lines[0]).toBe(`0 facts about this project · ${rules.length} rules of yours in the instructions · 1 about you stay on this Mac`);
  expect(r.view.title).toBe("Reading the project's memory");
  const fake = await startFakeServer([{ text: 'Done.' }, { text: 'Done here.' }]);
  try {
    const a = agentOn(fake.url, remote, { memory: { home, recall: false }, home });
    await a.send('tidy the cart');
    const sent = fake.requests[0].messages.filter((m) => m.role === 'user').at(-1).content;
    expect(sent).toContain('Your standing rules, for this answer too:\n- ');
    expect(sent).toContain('- Explain simply: the result first, then a few short steps.');
    expect(sent).toContain('- Never say a check passed unless you ran it.');
    expect(sent).not.toContain('lives near the sea');
    const b = agentOn(fake.url, local, { memory: { home, recall: false }, home });
    await b.send('tidy the cart');
    expect(fake.requests[1].messages.filter((m) => m.role === 'user').at(-1).content).not.toContain('Your standing rules');
  } finally { await fake.close(); }
});

test('the turn says what it made: each file, its size, new or changed', async () => {
  const fake = await startFakeServer([{ tool: { name: 'Write', args: { path: 'report.html', content: '<p>The cart total.</p>\n' } } }, { tool: { name: 'Bash', args: { command: "python3 -c \"open('out.csv','w').write('a,b\\n1,2\\n')\"" } } }, { text: 'Made both.' }]);
  try {
    const a = agentOn(fake.url, local);
    let made = null;
    a.on('turn-end', (e) => { made = e.made; });
    await a.send('make a report page and a csv');
    expect(made).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'report.html', bytes: 23, created: true }), expect.objectContaining({ path: 'out.csv', bytes: 8, created: true })]));
  } finally { await fake.close(); }
});

test('the page check and the second look draw as checks; a long command shows its first line; Made lists the files', () => {
  const page = renderToString(React.createElement(CheckNode, { check: { title: 'Page check', page: '~/Desktop/math.html', problems: ['8 of 8 sections show only their heading: Math Core, Vectors'], ok: '0 of 8 sections show text', bad: '0 of 8 sections show text', where: 'opened in WebKit, scripts run', sent: true } }), { columns: 140 });
  expect(page).toContain('Page check  ~/Desktop/math.html  ✗ 0 of 8 sections show text · opened in WebKit, scripts run · sent back to fix');
  expect(page).toContain('8 of 8 sections show only their heading: Math Core, Vectors');
  const look = renderToString(React.createElement(CheckNode, { check: { title: 'Second look', page: '', problems: [], ok: 'the answer holds', where: '2.2 s' } }), { columns: 140 });
  expect(look).toContain('Second look  ✓ the answer holds · 2.2 s');
  expect(cmdShown("python3 - <<'PYEOF'\nimport json\nprint(1)\nPYEOF", 'SCRIPTS/1-script.py')).toBe("python3 - <<'PYEOF' … +3 lines · SCRIPTS/1-script.py");
  expect(cmdShown('ls -la')).toBe('ls -la');
  const made = renderToString(React.createElement(MadeNode, { files: [{ path: '~/Desktop/math.html', bytes: 40160, created: true, page: 'page check: 0 of 8 sections show text', empty: true }, { path: 'src/cart.mjs', bytes: 512, created: false }] }), { columns: 140 });
  expect(made).toContain('Made  ~/Desktop/math.html · 40.2 KB · new');
  expect(made).toContain('page check: 0 of 8 sections show text');
  expect(made).toContain('src/cart.mjs · 0.5 KB · changed');
});

test('in the window: the Made lines under the answer', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ tool: { name: 'Write', args: { path: 'made-here.txt', content: 'hi there\n' } } }, { text: 'Wrote it.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows', '--mode', 'bypass'], steps: [
    { wait: '? for shortcuts' }, { type: 'write made-here.txt' }, { key: 'enter' }, { wait: 'Wrote it.' }, { wait: 'Made' }, { sleep: 300 }, ...quit,
  ] });
  await fake.close();
  expect(r.text).toMatch(/Made\s+made-here\.txt · 0\.0 KB · new/);
  expect(readFileSync(join(cwd, 'made-here.txt'), 'utf8')).toBe('hi there\n');
}, T);

// 4 Oct 2026, the owner's ask: "allow me to access this by clicking". A start on a remote prints the page
// as the conversation's first lines; a click on one of its Recent activity rows opens that conversation.
test('in the window: a click on a Recent activity row of the start page opens that conversation', async () => {
  const { cwd, env, base } = setup();
  // The folder as the app sees it (on a Mac the temp folders are under /private).
  const slug = realpathSync(cwd).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(-100);
  const dir = join(base, 'home', 'sessions', slug);
  mkdirSync(dir, { recursive: true });
  const id = '2026-10-04T10-00-00-000Z';
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ title: 'the cart total that rounded down', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'why does the cart round down?' }, { role: 'assistant', content: 'It used Math.floor.' }], items: [{ type: 'user', text: 'why does the cart round down?' }, { type: 'text', text: 'It used Math.floor.' }], cwd, id, updated: new Date(Date.now() - 3_600_000).toISOString() }));
  const fake = await startFakeServer([]);
  const click = async ({ write, raw }, word) => {
    const term = await emulate(raw(), 155, 43);
    const b = term.buffer.active;
    let at = null;
    for (let y = 0; y < term.rows && !at; y++) { const x = (b.getLine(b.baseY + y)?.translateToString(true) ?? '').indexOf(word); if (x >= 0) at = { col: x + 3, row: y + 1 }; }
    if (!at) throw new Error(`"${word}" is not on the screen`);
    write(`\x1b[<0;${at.col};${at.row}M`);
    await new Promise((res) => setTimeout(res, 50));
    write(`\x1b[<0;${at.col};${at.row}m`);
  };
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'cart total that rounded down' }, { wait: 'click one, or /resume' }, { sleep: 300 },
    { fn: (t) => click(t, 'cart total that rounded down') }, { wait: 'resumed: the cart total that rounded down' }, { sleep: 300 }, { snapshot: 'end' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.end).toContain('It used Math.floor.');
  expect(r.snapshots.end).not.toContain('[<0;'); // the reports were never typed
}, T);
