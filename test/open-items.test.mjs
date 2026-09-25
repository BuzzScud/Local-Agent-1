// The nine open items from the 2026-09-25 night check: rename leaves text
// alone, the macOS fence, outlines and one-read questions, deep trims,
// greetings without tools, a blank answer retried, and thinking on the
// coding paths.
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { Agent, filesNamed } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { execute } from '../src/agent/tools.mjs';
import { decide } from '../src/agent/permissions.mjs';
import { MODELS, DEFAULT_MODEL } from '../src/server/models.mjs';
import { renameInCode, planRename } from '../src/flows/rename.mjs';
import { outline, outlineText } from '../src/tools/outline.mjs';
import { runCommand } from '../src/tools/run.mjs';
import { sandboxAvailable, forgetPorts } from '../src/tools/sandbox.mjs';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { complete } from '../src/flows/llm.mjs';
import { startFakeServer } from './fake-server.mjs';

const model = MODELS[DEFAULT_MODEL];
const dir = (files) => {
  const d = mkdtempSync(join(tmpdir(), 'bonsai-open-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(d, name), text);
  return d;
};
const EXPORT = "export function toCsv(rows) {\n  return rows.map((r) => Object.values(r).join(',')).join('\\n');\n}\n";
const EXPORT_TEST = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { toCsv } from './export.mjs';\n\n// the test of toCsv\ntest('toCsv joins values', () => {\n  assert.equal(toCsv([{ a: 1, b: 2 }]), '1,2');\n});\n";

// 3 · rename
test('rename keeps quotes and comments, and aliases a name imported from a package', () => {
  const r = renameInCode(EXPORT_TEST, 'test', 'check');
  expect(r.after).toContain("import { test as check } from 'node:test';");
  expect(r.after).toContain("check('toCsv joins values'");
  expect(r.after).toContain('// the test of toCsv');
  expect(r.count).toBe(2);
  expect(r.skipped).toBe(2); // 'node:test' and the comment
  // Inside ${…} a template string is code again.
  expect(renameInCode('const s = `n ${n} and n`;', 'n', 'count').after).toBe('const s = `n ${count} and n`;');
  // `test as t`: the real name stays.
  expect(renameInCode("import { test as t } from 'vitest';\nt('x');", 'test', 'check').count).toBe(0);
  // Python: # comments and docstrings are text; a package import gets "as".
  const py = renameInCode('from statistics import mean\n# mean\ndef f():\n    """mean"""\n    return mean([1])\n', 'mean', 'average', { python: true });
  expect(py.after).toBe('from statistics import mean as average\n# mean\ndef f():\n    """mean"""\n    return average([1])\n');
});

test('rename leaves README and JSON alone and counts them', () => {
  const cwd = dir({ 'price.mjs': 'export function calcTotal() { return 1; }\n', 'README.md': 'Use calcTotal.\n', 'data.json': '{"calcTotal": 1}\n' });
  const plan = planRename(cwd, 'calcTotal', 'totalPrice');
  expect(plan.files.map((f) => f.rel)).toEqual(['price.mjs']);
  expect(plan.leftText.map((f) => f.rel).sort()).toEqual(['README.md', 'data.json']);
});

test('"rename test to check" leaves the tests passing', async () => {
  const cwd = dir({ 'export.mjs': EXPORT, 'export.test.mjs': EXPORT_TEST, 'package.json': '{"type":"module"}' });
  const fake = await startFakeServer([]);
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'edits', flows: true, ask: async () => ({ choice: 'yes' }) });
  let final = '';
  agent.on('assistant', (e) => { if (e.final) final = e.text; });
  await agent.send('rename test to check');
  await fake.close();
  expect(final).toMatch(/Renamed test to check: 2 uses in 1 file; all \d* ?tests pass\. Left alone: 2 in quotes or comments\./);
  expect(readFileSync(join(cwd, 'export.test.mjs'), 'utf8')).toContain("from 'node:test'");
});

// 6 · the fence
test.skipIf(!sandboxAvailable())('commands cannot read the home folder or write outside the project', async () => {
  const cwd = dir({ 'a.txt': 'inside\n' });
  const home = await runCommand('ls ~/Desktop', { cwd });
  expect(home.lines.join('\n')).toMatch(/Operation not permitted/);
  expect(home.lines.join('\n')).toMatch(/cannot be read or changed/);
  expect((await runCommand('ls "$HOME"/Documents; ls ~$USER/Library', { cwd })).lines.join('\n')).not.toMatch(/^\w+\.\w+$/m);
  const probe = join(homedir(), `bonsai-fence-probe-${process.pid}.txt`);
  await runCommand(`echo x > ${probe}`, { cwd });
  expect(existsSync(probe)).toBe(false);
  expect((await runCommand('echo ok > b.txt && cat a.txt b.txt', { cwd })).lines).toEqual(['inside', 'ok']);
  expect((await runCommand('open -h', { cwd })).code).not.toBe(0);
  expect((await runCommand('node -e "console.log(1+1)"', { cwd })).lines).toEqual(['2']);
  // A command you type yourself (! in the app) is not fenced.
  expect((await runCommand('ls ~ >/dev/null && echo seen', { cwd, sandbox: false })).lines).toEqual(['seen']);
  rmSync(probe, { force: true });
});

test.skipIf(!sandboxAvailable())('commands cannot signal or connect to what already runs on this Mac', async () => {
  const cwd = dir({});
  // Stand-ins for a database and a desk server: a process and a listener started outside.
  const other = spawn('/bin/sleep', ['60'], { stdio: 'ignore' });
  const srv = createServer((c) => c.end('reached\n'));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  forgetPorts();
  const port = srv.address().port;
  const connect = `node -e "const s=require('net').connect(${port},'127.0.0.1');s.on('data',d=>{console.log(String(d).trim());s.end()});s.on('error',e=>console.log(e.code))"`;
  expect((await runCommand(connect, { cwd })).lines[0]).toBe('EPERM');
  expect((await runCommand(`/bin/kill -0 ${other.pid} && echo reached`, { cwd })).lines.join('\n')).toMatch(/not permitted/);
  // Its own server and its own child processes work.
  const own = `node -e "const n=require('net');const s=n.createServer(c=>c.end('own\\n')).listen(0,'127.0.0.1',()=>n.connect(s.address().port,'127.0.0.1').on('data',d=>{console.log(String(d).trim());process.exit(0)}))"`;
  expect((await runCommand(own, { cwd })).lines).toEqual(['own']);
  expect((await runCommand('sleep 30 & kill $! && echo stopped', { cwd })).lines).toEqual(['stopped']);
  other.kill();
  srv.close();
});

test('the word check also catches ~user and a quoted $HOME', () => {
  const cwd = '/private/tmp/p';
  for (const c of ['ls ~root', 'ls "$HOME"/Desktop', "cat '~/x'"]) expect([c, decide('Bash', { command: c }, { mode: 'edits', cwd }).decision]).toEqual([c, 'deny']);
});

// 1 · reads
const longFile = () => {
  const parts = ["import fs from 'node:fs';", ''];
  for (let i = 1; i <= 8; i++) parts.push(`export function step${i}(x) {`, ...Array.from({ length: 20 }, (_, k) => `  x += ${k};`), '  return x;', '}', '');
  return parts.join('\n');
};

test('a long file comes back as an outline; a part comes back as text', async () => {
  const text = longFile();
  const cwd = dir({ 'steps.mjs': text });
  const o = outline(text, 'steps.mjs');
  expect(o.map((p) => p.name)).toEqual(['imports and setup', ...Array.from({ length: 8 }, (_, i) => `step${i + 1}`)]);
  expect(o[1]).toMatchObject({ line: 3, end: 26 });
  const whole = await execute('Read', { path: 'steps.mjs' }, {}, { cwd });
  expect(whole.text).toMatch(/is \d+ lines, too long to show at once/);
  expect(whole.text).toContain('3-26');
  expect(whole.view.outline).toBe(true);
  const part = await execute('Read', { path: 'steps.mjs', offset: 3, limit: 23 }, {}, { cwd });
  expect(part.text.split('\n')[1]).toBe('export function step1(x) {');
  expect(part.text).not.toContain('step2');
});

test('a question that names a file gets it read in one go before the model starts', async () => {
  const cwd = dir({ 'export.mjs': EXPORT, 'steps.mjs': longFile() });
  expect(filesNamed(cwd, 'What does export.mjs do? And src/nope.mjs?').map((f) => f.rel)).toEqual(['export.mjs']);
  const fake = await startFakeServer([{ text: 'It joins values with commas.' }]);
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'edits', flows: false, ask: async () => ({ choice: 'yes' }) });
  const tools = [];
  agent.on('tool', (e) => tools.push(e));
  await agent.send('what does export.mjs do?');
  await fake.close();
  expect(fake.requests.length).toBe(1);
  const sent = fake.requests[0].messages;
  expect(sent.at(-1)).toMatchObject({ role: 'tool' });
  expect(sent.at(-1).content).toContain('export function toCsv');
  expect(tools.map((t) => `${t.label}(${t.arg})`)).toEqual(['Read(export.mjs)']);
});

// 2 · trims
test('a trim is rare and deep: oldest outputs first, down under half, the newest two kept', async () => {
  const cwd = dir({});
  const agent = new Agent({ url: 'http://127.0.0.1:1', model, cwd, system: 'sys', thinking: false, ctx: 10000, flows: false });
  for (let i = 0; i < 10; i++) {
    agent.messages.push({ role: 'assistant', content: '', tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'Read', arguments: '{}' } }] });
    agent.messages.push({ role: 'tool', tool_call_id: `c${i}`, content: `${i}`.repeat(3000) }); // ~830 tokens each
  }
  agent.ctxUsed = 8400;
  const notes = [];
  agent.on('note', (e) => notes.push(e.text));
  await agent.fitContext();
  const tools = agent.messages.filter((m) => m.role === 'tool');
  expect(tools[0].content).toMatch(/^\[older output removed/);
  expect(tools.slice(-2).every((m) => m.content.length === 3000)).toBe(true);
  expect(agent.ctxUsed).toBeLessThan(10000 * 0.45 + 900);
  expect(notes.length).toBe(1);
  // One more output does not start another trim.
  agent.ctxUsed += 900;
  await agent.fitContext();
  expect(notes.length).toBe(1);
});

// 4 · greetings
test('"hello" gets one reply with tools switched off', async () => {
  const cwd = dir({ 'export.mjs': EXPORT });
  const fake = await startFakeServer([{ text: 'Hello! What shall we work on?' }]);
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'edits', flows: true, ask: async () => ({ choice: 'yes' }) });
  const events = [];
  for (const t of ['assistant', 'tool']) agent.on(t, (e) => events.push({ type: t, ...e }));
  await agent.send('hello');
  await fake.close();
  expect(fake.requests.length).toBe(1);
  expect(fake.requests[0].tool_choice).toBe('none');
  expect(fake.requests[0].tools.length).toBeGreaterThan(0); // same prompt as always, so the saved warm-up still matches
  expect(events.filter((e) => e.type === 'tool')).toEqual([]);
  expect(events.find((e) => e.type === 'assistant').text).toBe('Hello! What shall we work on?');
});

test('a greeting that tries a tool anyway gets a plain answer and runs nothing', async () => {
  const cwd = dir({});
  const fake = await startFakeServer([{ tool: { name: 'Bash', args: { command: 'node --test' } } }]);
  const agent = new Agent({ url: fake.url, model, cwd, system: 'sys', thinking: false, mode: 'edits', flows: false, ask: async () => ({ choice: 'yes' }) });
  const events = [];
  for (const t of ['assistant', 'tool']) agent.on(t, (e) => events.push({ type: t, ...e }));
  await agent.send('thanks!');
  await fake.close();
  expect(events.filter((e) => e.type === 'tool')).toEqual([]);
  expect(events.find((e) => e.type === 'assistant').text).toBe('You’re welcome.');
});

// 5 · blank answers
test('a blank answer is asked for once more', async () => {
  const cwd = dir({});
  const fake = await startFakeServer([{ text: '' }, { text: 'Port 8790.' }]);
  const agent = new Agent({ url: fake.url, model, cwd, system: 'sys', thinking: false, mode: 'edits', flows: false, ask: async () => ({ choice: 'yes' }) });
  let final = null;
  const notes = [];
  agent.on('assistant', (e) => { if (e.final && e.text) final = e.text; });
  agent.on('note', (e) => notes.push(e.text));
  await agent.send('which port is used');
  await fake.close();
  expect(final).toBe('Port 8790.');
  expect(notes.some((n) => /empty answer/.test(n))).toBe(true);
});

// 7 · thinking on the coding paths
test('code and tests are written at the chosen thinking level; sorting never thinks', async () => {
  const fake = await startFakeServer([{ text: '```js\nx\n```' }, { text: '{"kind":"fix"}' }, { text: 'y' }]);
  await complete({ url: fake.url, model, system: 's', user: 'u', thinking: true, effort: 'high', maxTokens: 100 });
  await complete({ url: fake.url, model, system: 's', user: 'u', thinking: true, schema: { type: 'object' } });
  await complete({ url: fake.url, model, system: 's', user: 'u' });
  await fake.close();
  const [code, sort, plain] = fake.requests;
  expect(code.chat_template_kwargs).toEqual({ enable_thinking: true, reasoning_effort: 'xhigh' });
  expect(code.max_tokens).toBe(100 + model.thinkingBudget);
  expect(code.temperature).toBe(model.thinkingSampling.temperature);
  expect(sort.chat_template_kwargs).toEqual({ enable_thinking: false });
  expect(plain.chat_template_kwargs).toEqual({ enable_thinking: false });
});
