// The guard and the end checks (28 Sep 2026, after the 28 practice tasks on Gemma):
// - no draft passes any of its own new tests → the tests are doubted, step by step instead (practice task 1);
// - a change that removes a function the request never names is refused or sent back (practice task 14);
// - the done check counts thin work (a two-sentence "short story") as not done (practice task 18).
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { lostNames, guardChange } from '../src/flows/blocks.mjs';
import { distrustTests, newTestNames, newTestPassed } from '../src/flows/change.mjs';
import { startFakeServer } from './fake-server.mjs';

const model = MODELS[DEFAULT_MODEL];
const demo = () => { const d = join(mkdtempSync(join(tmpdir(), 'agentic-guard-')), 'project'); cpSync(join(import.meta.dir, '..', 'demo-project'), d, { recursive: true }); return d; };
const project = (files) => { const d = join(mkdtempSync(join(tmpdir(), 'agentic-guard-')), 'project'); mkdirSync(d, { recursive: true }); for (const [rel, text] of Object.entries(files)) writeFileSync(join(d, rel), text); return d; };

async function run(cwd, prompt, replies, { flows = true } = {}) {
  const fake = await startFakeServer(replies);
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'ask', maxTries: 4, flows,
    ask: async (req) => { events.push({ type: 'ask', name: req.name, req }); return { choice: 'yes' }; } });
  for (const t of ['assistant', 'tool', 'note', 'tries-done']) agent.on(t, (e) => events.push({ type: t, ...e }));
  const reason = await agent.send(prompt);
  await fake.close();
  return { reason, events, fake };
}

test('lostNames: functions gone that the task never names; a named, moved or asked-for removal is not lost', () => {
  const before = 'export function area(w, h) {\n  return w * h;\n}\n';
  const onlyNew = 'export function perimeter(w, h) {\n  return 2 * (w + h);\n}\n';
  expect(lostNames('shapes.mjs', before, onlyNew, 'Add a perimeter(w, h) function to shapes.mjs')).toEqual(['area']);
  expect(lostNames('shapes.mjs', before, before + onlyNew, 'Add a perimeter(w, h) function to shapes.mjs')).toEqual([]);
  expect(lostNames('shapes.mjs', before, onlyNew, 'replace area() with perimeter()')).toEqual([]);
  expect(lostNames('shapes.mjs', before, onlyNew, 'remove the unused helpers')).toEqual([]);
  // Named but not restructured: "use it in area" keeps area (the multi-file test's formatMoney → money draft).
  expect(lostNames('shapes.mjs', before, onlyNew, 'use the new unit in area and add perimeter')).toEqual(['area']);
  expect(lostNames('shapes.mjs', before, onlyNew, 'move the helpers to geometry.mjs', { elsewhere: [before] })).toEqual([]);
  expect(lostNames('m.py', 'def fee():\n    return 0\n\ndef value():\n    return 1\n', 'def value():\n    return 1\n', 'add a test')).toEqual(['fee']);
  expect(lostNames('shapes.mjs', null, onlyNew, 'add perimeter')).toEqual([]);
  expect(guardChange('shapes.mjs', before, onlyNew, 'Add a perimeter(w, h) function')).toMatch(/removes area, which the task does not ask for/);
});

test('the guard doubts the tests only when no draft passes any new test, not when drafts only break an older one', () => {
  expect(newTestNames("test('old', () => {});\ntest('--json prints the rows', () => {});", "test('old', () => {});")).toEqual(['--json prints the rows']);
  expect(newTestNames('def test_old():\n    pass\ndef test_fee():\n    pass', 'def test_old():\n    pass')).toEqual(['test_fee']);
  const fresh = ['--json prints the rows'];
  expect(newTestPassed([{ ok: false, total: 3, failing: ['--json prints the rows'] }], fresh, false)).toBe(false);
  expect(newTestPassed([{ ok: false, total: 3, failing: ['toCsv writes a header row'] }], fresh, false)).toBe(true); // only an older test broke
  expect(newTestPassed([{ ok: false, total: null, failing: [] }], fresh, false)).toBe(false); // did not load: unknown is no
  expect(newTestPassed([{ ok: true, total: 3, failing: [] }], fresh, false)).toBe(true);
  expect(distrustTests([{ passing: [], passingNew: 0 }, { passing: [], passingNew: 0 }], [{}, {}])).toMatch(/none of the 2 drafts passed any of the 2 tests .* probably wrong/);
  expect(distrustTests([{ passing: [], passingNew: 1 }], [{}, {}])).toBe(null); // stale older test: the rescue round's case
  expect(distrustTests([{ passing: [{}], passingNew: 1 }], [{}])).toBe(null);
  expect(distrustTests([{ passing: [], passingNew: 0 }], [])).toBe(null); // no drafts at all: nothing to judge by
});

const exportWith = (extra) => readFileSync(join(import.meta.dir, '..', 'demo-project', 'export.mjs'), 'utf8').replace('  return toCsv(rows);', `${extra}  return toCsv(rows);`);

test('the guard: every draft fails its own tests (a test that wants 2 rows of 3), so no code is fitted to them (practice task 1)', async () => {
  const cwd = demo();
  const wrong = "```js\ntest('--json prints the rows', () => {\n  const out = JSON.parse(main(['trades.json', '--json']));\n  assert.equal(out.length, 2);\n});\n```";
  const good = '```js\n' + exportWith("  if (argv.includes('--json')) return JSON.stringify(rows);\n") + '```';
  // Two tests + two drafts, one more test + two drafts, two simpler tests: every test wants 2 rows, every draft prints 3.
  const replies = [wrong, wrong, good, good, wrong, good, good, wrong, wrong].map((text) => ({ text }))
    .concat([{ text: 'The tests I wrote wanted 2 rows, but trades.json has 3, so I left the code as it is.' }]);
  const { events } = await run(cwd, 'add a --json flag to export.mjs that prints the rows as JSON, and add a test for it', replies);
  expect(events.some((e) => e.type === 'note' && /tests are probably wrong; working step by step instead/.test(e.text))).toBe(true);
  expect(events.some((e) => e.type === 'tries-done' && e.label === 'Trying changes')).toBe(false);
  expect(events.some((e) => e.type === 'ask' && e.name === 'Test')).toBe(false);
  expect(readFileSync(join(cwd, 'export.mjs'), 'utf8')).not.toContain('--json');
}, 60_000);

test('the change path refuses a draft that removes a function the task keeps (practice task 14)', async () => {
  const lib = 'export function double(n) {\n  return n * 2;\n}\n\nexport function half(n) {\n  return n / 2;\n}\n';
  const cwd = project({ 'lib.mjs': lib, 'lib.test.mjs': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { double } from './lib.mjs';\n\ntest('double', () => {\n  assert.equal(double(2), 4);\n});\n" });
  const newTest = "```js\nimport { triple } from './lib.mjs';\ntest('triple', () => {\n  assert.equal(triple(2), 6);\n});\n```";
  const triple = 'export function triple(n) {\n  return n * 3;\n}\n';
  const replacesHalf = '```js\n' + lib.replace(/export function half[\s\S]*$/, triple) + '```';
  const good = '```js\n' + lib + '\n' + triple + '```';
  const { reason, events } = await run(cwd, 'add a triple(n) function to lib.mjs', [{ text: newTest }, { text: newTest }, { text: replacesHalf }, { text: good }, { text: 'Adds triple().' }]);
  expect(reason).toBe('done');
  expect(events.find((e) => e.type === 'tries-done' && e.label === 'Drafting versions').marks).toEqual(['✗', '✓']);
  const after = readFileSync(join(cwd, 'lib.mjs'), 'utf8');
  expect(after).toContain('export function half');
  expect(after).toContain('export function triple');
}, 60_000);

test('step by step: a function removed without being asked is sent back once, and put back (practice task 14)', async () => {
  const area = 'export function area(w, h) {\n  return w * h;\n}\n';
  const perimeter = 'export function perimeter(w, h) {\n  return 2 * (w + h);\n}\n';
  const cwd = project({ 'shapes.mjs': area });
  const { reason, events } = await run(cwd, 'Add a perimeter(w, h) function to shapes.mjs that returns the perimeter of a w-by-h rectangle.', [
    { tool: { name: 'Read', args: { path: 'shapes.mjs' } } },
    // The morning run's move: the new function written over the old one.
    { tool: { name: 'Edit', args: { path: 'shapes.mjs', old_text: area, new_text: perimeter } } },
    { text: 'Added perimeter().' },
    { tool: { name: 'Edit', args: { path: 'shapes.mjs', old_text: perimeter, new_text: `${area}\n${perimeter}` } } },
    { text: 'Put area() back and added perimeter() beside it.' },
    { text: '{"parts":[{"part":"add perimeter(w, h)","done":true}],"done":true,"missing":""}' },
  ], { flows: false });
  expect(reason).toBe('done');
  expect(events.filter((e) => e.type === 'note' && /^Removed without being asked: area in shapes\.mjs/.test(e.text))).toHaveLength(1);
  const after = readFileSync(join(cwd, 'shapes.mjs'), 'utf8');
  expect(after).toContain('export function area');
  expect(after).toContain('export function perimeter');
}, 60_000);

test('step by step: a request that names the function it replaces is not sent back', async () => {
  const cwd = project({ 'shapes.mjs': 'export function area(w, h) {\n  return w * h;\n}\n' });
  const { events } = await run(cwd, 'In shapes.mjs, replace area() with perimeter(w, h).', [
    { tool: { name: 'Read', args: { path: 'shapes.mjs' } } },
    { tool: { name: 'Edit', args: { path: 'shapes.mjs', old_text: 'export function area(w, h) {\n  return w * h;\n}\n', new_text: 'export function perimeter(w, h) {\n  return 2 * (w + h);\n}\n' } } },
    { text: 'Replaced area() with perimeter().' },
    { text: '{"parts":[{"part":"replace area with perimeter","done":true}],"done":true,"missing":""}' },
  ], { flows: false });
  expect(events.some((e) => e.type === 'note' && /Removed without being asked/.test(e.text))).toBe(false);
}, 60_000);

test('the done check asks for work done fully: a story or notes of a sentence or two counts as not done (practice task 18)', async () => {
  const cwd = project({ 'ideas.md': '# ideas\n' });
  const fake = await startFakeServer([{ text: '{"parts":[{"part":"a short story in TEST.txt","done":false}],"done":false,"missing":"the story is only two sentences"}' }]);
  const agent = new Agent({ url: fake.url, model, cwd, system: 'test', thinking: false, ask: async () => ({ choice: 'yes' }) });
  agent.messages.push({ role: 'user', content: 'CREATE A TXT FILE AND NAME IT "TEST". ADD A SHORT STORY INSIDE' });
  agent.turn = { diffs: 'TEST.txt:\n+Once upon a time, a bit of data went on an adventure. It settled in a cozy terminal.', changed: true };
  expect(await agent.verifyDone('I created TEST.txt with a short story.')).toBe('a short story in TEST.txt');
  const asked = JSON.stringify(fake.requests.at(-1).messages);
  expect(asked).toContain('A part is done only when it is done fully');
  expect(asked).toContain('only a sentence or two');
  await fake.close();
});
