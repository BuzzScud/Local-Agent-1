// The focused paths (src/flows) against the scripted model.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../src/server/models.mjs';
import { routeByRules } from '../src/flows/index.mjs';
import { startFakeServer } from './fake-server.mjs';

const model = MODELS[DEFAULT_MODEL];
const copy = (name) => { const d = join(mkdtempSync(join(tmpdir(), 'bonsai-flow-')), 'project'); cpSync(join(import.meta.dir, name), d, { recursive: true }); return d; };

async function run(cwd, prompt, replies, { answer = 'yes', mode = 'ask', slots } = {}) {
  const fake = await startFakeServer(replies);
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode, maxTries: 4, slots,
    ask: async (req) => { events.push({ type: 'ask', name: req.name, req }); return { choice: typeof answer === 'function' ? answer(req) : answer }; } });
  for (const t of ['assistant', 'tool', 'note', 'tries-done', 'route']) agent.on(t, (e) => events.push({ type: t, ...e }));
  const reason = await agent.send(prompt);
  await fake.close();
  return { reason, events, agent, fake };
}

test('requests are sorted into paths', () => {
  expect(routeByRules('Rename the function calcTotal to totalPrice everywhere')).toEqual({ kind: 'rename', from: 'calcTotal', to: 'totalPrice' });
  expect(routeByRules('The tests fail. Fix the bug.').kind).toBe('fix');
  expect(routeByRules('add a --json flag to export.mjs').kind).toBe('change');
  expect(routeByRules("Which port does it use? Don't change any files.").kind).toBe('question');
  expect(routeByRules('why is it slow?').kind).toBe('question');
  // greetings skip the model (asking it to sort them cost a re-read of its instructions)
  expect(routeByRules('hello').kind).toBe('question');
  expect(routeByRules('Thanks!').kind).toBe('question');
  expect(routeByRules('hello, can you fix the tests?').kind).toBe('fix');
  expect(routeByRules('tidy up')).toBe(null); // unclear: the model sorts it
});

test('rename: every use in every file, one question, tests run', async () => {
  const cwd = copy('fixture-rename');
  const { reason, events } = await run(cwd, 'Rename calcTotal to totalPrice everywhere', []);
  expect(reason).toBe('done');
  expect(events.filter((e) => e.type === 'ask').map((e) => e.name)).toEqual(['Rename']);
  expect(readFileSync(join(cwd, 'cart.mjs'), 'utf8')).toContain('totalPrice(cart.items');
  expect(readFileSync(join(cwd, 'price.mjs'), 'utf8')).toContain('export function totalPrice');
  expect(events.find((e) => e.type === 'assistant').text).toMatch(/Renamed calcTotal to totalPrice: 3 uses in 2 files; all 1 tests pass/);
});

test('rename: saying no changes nothing', async () => {
  const cwd = copy('fixture-rename');
  const { reason } = await run(cwd, 'Rename calcTotal to totalPrice', [], { answer: 'no' });
  expect(reason).toBe('declined');
  expect(readFileSync(join(cwd, 'price.mjs'), 'utf8')).toContain('calcTotal');
});

const statsWith = (body) => readFileSync(join(import.meta.dir, 'fixture-fix', 'stats.mjs'), 'utf8').replace('  return sorted[mid];', body);

test('fix: a wrong try, then a right one; only the right one reaches your file', async () => {
  const cwd = copy('fixture-fix');
  const wrong = '```js\n' + statsWith('  return (sorted[mid] + sorted[mid + 1]) / 2;') + '```';
  const right = '```js\n' + statsWith('  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;') + '```';
  const { reason, events, fake } = await run(cwd, 'The tests fail. Find the bug and fix it.', [{ text: wrong }, { text: right }, { text: 'The median now averages the two middle values for an even count.' }]);
  expect(reason).toBe('done');
  const tries = events.find((e) => e.type === 'tries-done');
  expect(tries.marks).toEqual(['✗', '✓']);
  expect(events.filter((e) => e.type === 'ask').map((e) => e.name)).toEqual(['Edit']);
  expect(readFileSync(join(cwd, 'stats.mjs'), 'utf8')).toContain('sorted.length % 2');
  // the second try was told what the first did wrong
  expect(fake.requests[1].messages[1].content).toContain('Your previous try was wrong');
  expect(fake.requests[1].messages[1].content).toContain('3 !== 2.5');
  expect(events.find((e) => e.type === 'assistant').text).toMatch(/Fixed stats\.mjs; all 4 tests pass/);
});

test('fix: when no try passes, nothing is changed', async () => {
  const cwd = copy('fixture-fix');
  const wrong = '```js\n' + statsWith('  return sorted[mid] + 0;') + '```';
  const { events } = await run(cwd, 'The tests fail. Fix it.', [{ text: wrong }, { text: wrong }, { text: wrong }, { text: wrong }]);
  expect(events.find((e) => e.type === 'tries-done').marks).toEqual(['✗', '✗', '✗', '✗']);
  expect(events.some((e) => e.type === 'ask')).toBe(false);
  expect(readFileSync(join(cwd, 'stats.mjs'), 'utf8')).toContain('return sorted[mid];');
});

const exportWith = (extra) => readFileSync(join(import.meta.dir, '..', 'demo-project', 'export.mjs'), 'utf8').replace('  return toCsv(rows);', `${extra}  return toCsv(rows);`);
const jsonTest = "```js\ntest('--json prints the rows', () => {\n  const out = JSON.parse(main(['trades.json', '--json']));\n  assert.equal(out.length, 3);\n});\n```";

test('change: tests first, drafts cross-checked, you approve the test, then the change', async () => {
  const cwd = join(mkdtempSync(join(tmpdir(), 'bonsai-flow-')), 'project');
  cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
  const good = '```js\n' + exportWith("  if (argv.includes('--json')) return JSON.stringify(rows);\n") + '```';
  const bad = '```js\n' + exportWith('') + '```';
  const replies = [{ text: jsonTest }, { text: jsonTest }, { text: jsonTest }, { text: bad }, { text: good }, { text: bad }, { text: good }, { text: 'Adds a --json flag.' }];
  const { reason, events } = await run(cwd, 'add a --json flag to export.mjs that prints the rows as JSON', replies);
  expect(reason).toBe('done');
  expect(events.filter((e) => e.type === 'ask').map((e) => e.name)).toEqual(['Test', 'Edit']);
  expect(events.find((e) => e.type === 'ask' && e.name === 'Test').req.prepared.after).toContain("'--json prints the rows'");
  const checked = events.find((e) => e.type === 'tries-done' && e.label === 'Checked tests against drafts');
  expect(checked.summary).toContain('passed by 2');
  expect(readFileSync(join(cwd, 'export.mjs'), 'utf8')).toContain("argv.includes('--json')");
  expect(readFileSync(join(cwd, 'export.test.mjs'), 'utf8')).toContain('--json prints the rows');
});

test('change: not approving the test stops before any change', async () => {
  const cwd = join(mkdtempSync(join(tmpdir(), 'bonsai-flow-')), 'project');
  cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
  const good = '```js\n' + exportWith("  if (argv.includes('--json')) return JSON.stringify(rows);\n") + '```';
  const replies = [{ text: jsonTest }, { text: jsonTest }, { text: jsonTest }, { text: good }, { text: good }, { text: good }, { text: good }];
  const { reason } = await run(cwd, 'add a --json flag to export.mjs', replies, { answer: (req) => (req.name === 'Test' ? 'no' : 'yes') });
  expect(reason).toBe('declined');
  expect(readFileSync(join(cwd, 'export.mjs'), 'utf8')).not.toContain('--json');
  expect(readFileSync(join(cwd, 'export.test.mjs'), 'utf8')).not.toContain('--json prints the rows');
});

// A stats.mjs past 80 lines: tries rewrite only the function, but the model
// still reads the whole file.
const bigStats = () => {
  const extra = Array.from({ length: 20 }, (_, i) => `export function shift${i}(v) {\n  return v + ${i};\n}\n`).join('\n');
  return `${readFileSync(join(import.meta.dir, 'fixture-fix', 'stats.mjs'), 'utf8')}\n${extra}`;
};
const bigCopy = () => { const cwd = copy('fixture-fix'); writeFileSync(join(cwd, 'stats.mjs'), bigStats()); return cwd; };
const medianRight = '```js\nexport function median(values) {\n  const sorted = [...values].sort((a, b) => a - b);\n  const mid = Math.floor(sorted.length / 2);\n  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;\n}\n```';
const medianWrong = '```js\nexport function median(values) {\n  return values[0];\n}\n```';

test('fix in a file over 80 lines: the model picks the function, reads the whole file, rewrites only that function', async () => {
  const cwd = bigCopy();
  const before = readFileSync(join(cwd, 'stats.mjs'), 'utf8');
  expect(before.split('\n').length).toBeGreaterThan(80);
  const { reason, events, fake } = await run(cwd, 'The tests fail. Find the bug and fix it.', [{ text: '{"function": "median"}' }, { text: medianRight }, { text: 'Fixed.' }]);
  expect(reason).toBe('done');
  expect(events.find((e) => e.type === 'tries-done').marks).toEqual(['✓']);
  const prompt = fake.requests[1].messages[1].content;
  expect(prompt).toContain('export function shift19'); // the whole file was shown
  expect(prompt).toMatch(/Only the function median \(lines \d+-\d+\) needs to change/);
  expect(prompt).toContain('Reply with the complete corrected function median');
  const after = readFileSync(join(cwd, 'stats.mjs'), 'utf8');
  expect(after).toContain('sorted.length % 2');
  // everything outside median is untouched
  expect(after.replace(/export function median[\s\S]*?\n}\n/, '')).toBe(before.replace(/export function median[\s\S]*?\n}\n/, ''));
});

test('fix in a file over 80 lines: a whole-file reply is used as the whole file, not pasted into the function', async () => {
  const cwd = bigCopy();
  const fixed = bigStats().replace('  return sorted[mid];', '  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;');
  const { reason } = await run(cwd, 'The tests fail. Find the bug and fix it.', [{ text: '{"function": "median"}' }, { text: '```js\n' + fixed + '```' }, { text: 'Fixed.' }]);
  expect(reason).toBe('done');
  const after = readFileSync(join(cwd, 'stats.mjs'), 'utf8');
  expect(after.match(/export function mean/g)).toHaveLength(1);
  expect(after).toContain('sorted.length % 2');
});

test('fix in a file over 80 lines: when changing only the function never passes, it works step by step instead', async () => {
  const cwd = bigCopy();
  const { events } = await run(cwd, 'The tests fail. Fix it.', [{ text: '{"function": "median"}' }, { text: medianWrong }, { text: medianWrong }, { text: medianWrong }, { text: medianWrong }, { text: 'I looked; it needs more than median.' }]);
  expect(events.find((e) => e.type === 'tries-done').marks).toEqual(['✗', '✗', '✗', '✗']);
  expect(events.some((e) => e.type === 'note' && /changed only median.*working step by step instead/.test(e.text))).toBe(true);
  expect(events.some((e) => e.type === 'ask')).toBe(false);
  expect(readFileSync(join(cwd, 'stats.mjs'), 'utf8')).toContain('return sorted[mid];');
});

test('the conversation keeps slot 0; sorting a request uses slot 1, so it never wipes the conversation', async () => {
  const cwd = copy('fixture-fix');
  const { fake } = await run(cwd, 'tidy up', [{ text: '{"kind": "question"}' }, { text: 'Done.' }], { slots: { main: 0, side: 1 } });
  const sorting = fake.requests.find((r) => r.response_format);
  const conversation = fake.requests.find((r) => r.tools);
  expect(sorting.id_slot).toBe(1);
  expect(conversation.id_slot).toBe(0);
});

test('with a server Bonsai Code did not start (no slots), requests name no slot', async () => {
  const cwd = copy('fixture-fix');
  const { fake } = await run(cwd, 'tidy up', [{ text: '{"kind": "question"}' }, { text: 'Done.' }]);
  expect(fake.requests.filter((r) => r.stream).every((r) => r.id_slot === undefined)).toBe(true);
});
