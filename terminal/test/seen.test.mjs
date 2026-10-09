// A file that changed since the model read it (agent/seen.mjs): the change is turned back with
// the lines that changed, which count as reading it again; too many, and it reads it again.
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SeenFiles, changedBlocks, changedNote, SHOW_MAX, printedFiles } from '../src/agent/seen.mjs';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'agentic-seen-'));
const lines = (n, f = (i) => `line ${i}`) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n');

test('a file seen and unchanged is not changed; touched with the same text is not either', () => {
  const d = dir();
  const f = join(d, 'a.txt');
  writeFileSync(f, 'one\ntwo\n');
  const seen = new SeenFiles();
  expect(seen.changed(f)).toBe(null); // never seen
  seen.add(f);
  expect(seen.has(f)).toBe(true);
  expect(seen.size).toBe(1);
  expect(seen.changed(f)).toBe(null);
  writeFileSync(f, 'one\ntwo\n');
  expect(seen.changed(f)).toBe(null);
  writeFileSync(f, 'one\nTWO\n');
  const ch = seen.changed(f);
  expect(ch.now).toBe('one\nTWO\n');
  expect(ch.blocks).toEqual([{ from: 2, to: 2, newFrom: 2, newTo: 2, removed: ['two'], added: ['TWO'] }]);
  // Written by the model (its text given): that is what it has seen.
  seen.add(f, 'one\nTWO\n');
  expect(seen.changed(f)).toBe(null);
  // Gone: Edit says it is missing, Write may make it again.
  rmSync(f);
  expect(seen.changed(f)).toBe(null);
  // A file that is not there is not kept.
  seen.add(join(d, 'none.txt'));
  expect(seen.has(join(d, 'none.txt'))).toBe(false);
  rmSync(d, { recursive: true });
});

test('changes far apart are separate blocks, with insertions and removals', () => {
  const a = lines(600);
  const b = a.replace('line 10\n', 'line ten\n').replace('line 500\n', '').replace('line 300\n', 'line 300\nnew A\nnew B\n');
  const blocks = changedBlocks(a, b);
  expect(blocks.length).toBe(3);
  expect(blocks[0]).toMatchObject({ from: 10, to: 10, newFrom: 10, newTo: 10, removed: ['line 10'], added: ['line ten'] });
  expect(blocks[1]).toMatchObject({ from: 301, to: 300, newFrom: 301, newTo: 302, removed: [], added: ['new A', 'new B'] });
  expect(blocks[2]).toMatchObject({ from: 500, to: 500, newFrom: 502, newTo: 501, removed: ['line 500'], added: [] });
  // Text added at the end, and everything replaced.
  expect(changedBlocks('a\nb', 'a\nb\nc')).toEqual([{ from: 3, to: 2, newFrom: 3, newTo: 3, removed: [], added: ['c'] }]);
  expect(changedBlocks('x\ny', 'p\nq')).toEqual([{ from: 1, to: 2, newFrom: 1, newTo: 2, removed: ['x', 'y'], added: ['p', 'q'] }]);
});

test('the note shows the changed lines with their numbers, or asks for a new Read when too much changed', () => {
  const before = lines(20);
  const now = before.replace('line 4\n', 'line four\n').replace('line 12\n', '');
  const small = changedNote('src/a.js', { before, now, blocks: changedBlocks(before, now) });
  expect(small.shown).toBe(true);
  expect(small.text).toContain('src/a.js changed since you read it');
  expect(small.text).toContain('this Edit was not made');
  expect(small.text).toContain('Line 4 now reads (in place of one line):\n4: line four');
  expect(small.text).toContain('After line 11, this line was removed:\n- line 12');
  expect(small.text).toContain('Send the Edit again with old_text copied from the file as it is now.');
  const big = lines(200);
  const bigNow = lines(200, (i) => (i > 50 && i <= 50 + SHOW_MAX ? `changed ${i}` : `line ${i}`));
  const far = changedNote('b.js', { before: big, now: bigNow, blocks: changedBlocks(big, bigNow) }, 'Write');
  expect(far.shown).toBe(false);
  expect(far.text).toContain('this Write was not made');
  expect(far.text).toContain('Read it again (offset 48 starts just before the first change)');
  // A file too big to keep: no lines to show.
  const huge = changedNote('c.js', { before: null, now: 'x\ny', blocks: null });
  expect(huge.shown).toBe(false);
  expect(huge.text).toContain('Read it again; it is 2 lines now.');
});

// The whole path on a scripted model: it reads billing.mjs, the file changes on disk before its
// Edit (someone else's change to line 1), the Edit is turned back with that line, and the same
// Edit sent again lands on the file as it is now, keeping the other change.
test('an Edit of a file changed since its Read is turned back with the change, then lands', async () => {
  const d = dir();
  writeFileSync(join(d, 'billing.mjs'), '// Order totals.\nexport function addTax(amount, rate = 0.0825) {\n  return amount * (1 + rate);\n}\n');
  writeFileSync(join(d, 'package.json'), '{"name":"shop","type":"module"}\n');
  const edit = { tool: { name: 'Edit', args: { path: 'billing.mjs', old_text: 'rate = 0.0825', new_text: 'rate = 0.09' } } };
  let n = 0;
  const route = (json) => {
    if (!json.messages) return null;
    if (++n === 2) writeFileSync(join(d, 'billing.mjs'), readFileSync(join(d, 'billing.mjs'), 'utf8').replace('// Order totals.', '// Order totals, with tax.'));
    return null;
  };
  const fake = await startFakeServer([{ tool: { name: 'Read', args: { path: 'billing.mjs' } } }, edit, edit, { text: 'Changed the rate to 0.09.' }], { route });
  const events = [];
  const model = MODELS[DEFAULT_MODEL];
  const agent = new Agent({ url: fake.url, model, cwd: d, system: systemPrompt({ cwd: d, git: 'test' }), thinking: false, ctx: 32768, mode: 'edits', flows: false, way: 'model', hooks: [], verify: false,
    ask: async () => ({ choice: 'yes' }) });
  agent.on('tool', (e) => events.push(e));
  await agent.send('Change the default tax rate in billing.mjs to 0.09.');
  await fake.close();
  const tools = events.map((e) => `${e.name}${e.error ? ' ✗' : ''}`);
  expect(tools).toEqual(['Read', 'Edit ✗', 'Edit']);
  expect(events[1].view.message).toBe('billing.mjs changed since it was read: shown the changes');
  const sent = fake.requests.filter((r) => r.stream && r.messages);
  const turnedBack = sent[2].messages.filter((m) => m.role === 'tool').at(-1).content;
  expect(turnedBack).toContain('billing.mjs changed since you read it');
  expect(turnedBack).toContain('Line 1 now reads (in place of one line):\n1: // Order totals, with tax.');
  expect(readFileSync(join(d, 'billing.mjs'), 'utf8')).toBe('// Order totals, with tax.\nexport function addTax(amount, rate = 0.09) {\n  return amount * (1 + rate);\n}\n');
  rmSync(d, { recursive: true });
});

test('its own Edits one after another need no new Read', async () => {
  const d = dir();
  writeFileSync(join(d, 'notes.txt'), 'alpha\nbeta\ngamma\n');
  const fake = await startFakeServer([
    { tool: { name: 'Read', args: { path: 'notes.txt' } } },
    { tool: { name: 'Edit', args: { path: 'notes.txt', old_text: 'alpha', new_text: 'ALPHA' } } },
    { tool: { name: 'Edit', args: { path: 'notes.txt', old_text: 'gamma', new_text: 'GAMMA' } } },
    { text: 'Done.' },
  ]);
  const events = [];
  const agent = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd: d, system: systemPrompt({ cwd: d, git: 'test' }), thinking: false, ctx: 32768, mode: 'edits', flows: false, way: 'model', hooks: [], verify: false, ask: async () => ({ choice: 'yes' }) });
  agent.on('tool', (e) => events.push(e));
  await agent.send('Capitalise alpha and gamma in notes.txt.');
  await fake.close();
  expect(events.map((e) => `${e.name}${e.error ? ' ✗' : ''}`)).toEqual(['Read', 'Edit', 'Edit']);
  expect(readFileSync(join(d, 'notes.txt'), 'utf8')).toBe('ALPHA\nbeta\nGAMMA\n');
  rmSync(d, { recursive: true });
});

test('a file printed by a command (cat, sed -n, head) counts as seen; a pipe, a write or a sed -i does not', () => {
  const d = dir();
  mkdirSync(join(d, 'sub'));
  for (const f of ['a.mjs', 'b.mjs', 'sub/c.mjs']) writeFileSync(join(d, f), 'x\n');
  const p = (c) => printedFiles(c, d, d).map((f) => f.slice(d.length + 1));
  expect(p('cat a.mjs')).toEqual(['a.mjs']);
  expect(p("sed -n '280,295p' a.mjs; sed -n 1,5p b.mjs")).toEqual(['a.mjs', 'b.mjs']);
  expect(p('head -n 40 a.mjs && tail -20 b.mjs')).toEqual(['a.mjs', 'b.mjs']);
  expect(p('cd sub && nl c.mjs')).toEqual(['sub/c.mjs']);
  expect(p('cd ~/sub && cat c.mjs')).toEqual(['sub/c.mjs']);
  expect(p('cat a.mjs | grep x')).toEqual([]);
  expect(p('cat a.mjs > b.mjs')).toEqual([]);
  expect(p("sed -i '' s/x/y/ a.mjs")).toEqual([]);
  expect(p('sed s/x/y/ a.mjs')).toEqual([]);
  expect(p('cat nope.mjs')).toEqual([]);
  rmSync(d, { recursive: true });
});

test('an Edit after a sed -n of the file lands, with no "Read it first"', async () => {
  const d = dir();
  writeFileSync(join(d, 'notes.txt'), 'alpha\nbeta\ngamma\n');
  const fake = await startFakeServer([
    { tool: { name: 'Bash', args: { command: 'sed -n 1,3p notes.txt' } } },
    { tool: { name: 'Edit', args: { path: 'notes.txt', old_text: 'beta', new_text: 'BETA' } } },
    { text: 'Done.' },
  ]);
  const events = [];
  const agent = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd: d, system: systemPrompt({ cwd: d, git: 'test' }), thinking: false, ctx: 32768, mode: 'edits', flows: false, way: 'model', hooks: [], verify: false, ask: async () => ({ choice: 'yes' }) });
  agent.on('tool', (e) => events.push(e));
  await agent.send('Capitalise beta in notes.txt.');
  await fake.close();
  expect(events.map((e) => `${e.name}${e.error ? ' ✗' : ''}`)).toEqual(['Bash', 'Edit']);
  expect(readFileSync(join(d, 'notes.txt'), 'utf8')).toBe('alpha\nBETA\ngamma\n');
  rmSync(d, { recursive: true });
});
