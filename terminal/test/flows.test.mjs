// The focused paths (src/flows) against the scripted model.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { routeByRules, isCodeProject } from '../src/flows/index.mjs';
import { fileHints, isTestFile } from '../src/flows/localize.mjs';
import { checkInText } from '../src/flows/fix.mjs';
import { Scratch } from '../src/flows/scratch.mjs';
import { excerpts } from '../src/flows/excerpts.mjs';
import { spawnSync } from 'node:child_process';
import { startFakeServer } from './fake-server.mjs';
import { SETUP_THINK_CAP } from '../src/flows/llm.mjs';

const model = MODELS[DEFAULT_MODEL];
const copy = (name) => { const d = join(mkdtempSync(join(tmpdir(), 'agentic-flow-')), 'project'); cpSync(join(import.meta.dir, name), d, { recursive: true }); return d; };

async function run(cwd, prompt, replies, { answer = 'yes', mode = 'ask', slots, testTimeoutMs, thinking = false } = {}) {
  const fake = await startFakeServer(replies);
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking, mode, maxTries: 4, slots, testTimeoutMs,
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
  for (const q of ['Just explain what the API in export.mjs does; change nothing.', 'explain the export, no code changes', 'tell me how main works, do not modify anything', 'Please describe the tests']) expect([q, routeByRules(q).kind]).toEqual([q, 'question']);
  // greetings skip the model (asking it to sort them cost a re-read of its instructions)
  expect(routeByRules('hello').kind).toBe('question');
  expect(routeByRules('Thanks!').kind).toBe('question');
  expect(routeByRules('hello, can you fix the tests?').kind).toBe('fix');
  // "Can you …?" asks for work whatever the verb; "can you explain …?" only wants an answer (2026-09-28).
  for (const d of ['can you use clouds and sun for the weather icons? on the page?', 'could you swap the icons for SVGs?', 'can you put the chart on my desktop?']) expect([d, routeByRules(d).kind]).toEqual([d, 'other']);
  for (const q of ['can you explain how the export works?', 'could you tell me why it is slow?', 'what can you do?']) expect([q, routeByRules(q).kind]).toEqual([q, 'question']);
  expect(routeByRules('tidy up')).toBe(null); // unclear: the model sorts it
  // Code requests that mention a writing word stay on the code paths…
  for (const c of ['Add a helper that formats prices and call it from main.mjs', 'Make the export write to a file instead of stdout', 'Add an option to export the trades to .csv in export.mjs', 'Add a notes field to each trade']) expect([c, routeByRules(c).kind]).toEqual([c, 'change']);
  for (const c of ['Fix the crash when the summary is empty in report.mjs', 'Fix the bug in the README generator']) expect([c, routeByRules(c).kind]).toEqual([c, 'fix']);
  // …writing stays writing, even next to a code file…
  for (const c of ['add a CHANGELOG entry', 'Add a NOTES.md file with three bullet points explaining how the API in server.mjs works.', 'update the README with how to run the tests']) expect([c, routeByRules(c).kind]).toEqual([c, 'other']);
  // …and file operations go step by step (the command asks first), never into code.
  for (const c of ['delete trades.json', 'rename export.mjs to exporter.mjs', 'move utils.mjs into src/', 'remove the logs folder']) expect([c, routeByRules(c).kind]).toEqual([c, 'other']);
  for (const c of ['remove console.log from export.mjs', 'delete the median function']) expect([c, routeByRules(c).kind]).toEqual([c, 'change']);
  // A question over a pasted log stays a question; asking for a fix over one is a fix.
  const log = '\nERROR connection refused at 127.0.0.1:5432'.repeat(5);
  expect(routeByRules(`Here is a log, what went wrong?${log}`).kind).toBe('question');
  expect(routeByRules(`Can you fix this?${log}`).kind).toBe('fix');
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
  const cwd = join(mkdtempSync(join(tmpdir(), 'agentic-flow-')), 'project');
  cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
  const good = '```js\n' + exportWith("  if (argv.includes('--json')) return JSON.stringify(rows);\n") + '```';
  const bad = '```js\n' + exportWith('') + '```';
  // Round one: two tests, two drafts (one wrong): they disagree, so one more test and two more drafts.
  const replies = [{ text: jsonTest }, { text: jsonTest }, { text: bad }, { text: good }, { text: jsonTest }, { text: bad }, { text: good }, { text: 'Adds a --json flag.' }];
  const { reason, events, fake } = await run(cwd, 'add a --json flag to export.mjs that prints the rows as JSON', replies);
  expect(reason).toBe('done');
  expect(events.filter((e) => e.type === 'ask').map((e) => e.name)).toEqual(['Test', 'Edit']);
  expect(events.find((e) => e.type === 'ask' && e.name === 'Test').req.prepared.after).toContain("'--json prints the rows'");
  const checked = events.find((e) => e.type === 'tries-done' && e.label === 'Checked tests against drafts');
  expect(checked.summary).toBe('3 tests, 4 drafts; the chosen test is passed by 2');
  expect(fake.remaining()).toBe(0);
  expect(readFileSync(join(cwd, 'export.mjs'), 'utf8')).toContain("argv.includes('--json')");
  expect(readFileSync(join(cwd, 'export.test.mjs'), 'utf8')).toContain('--json prints the rows');
});

test('change: when two tests and two drafts agree, nothing more is written', async () => {
  const cwd = join(mkdtempSync(join(tmpdir(), 'agentic-flow-')), 'project');
  cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
  const good = '```js\n' + exportWith("  if (argv.includes('--json')) return JSON.stringify(rows);\n") + '```';
  const replies = [{ text: jsonTest }, { text: jsonTest }, { text: good }, { text: good }, { text: 'Adds a --json flag.' }, { text: 'never used' }, { text: 'never used' }];
  const { reason, events, fake } = await run(cwd, 'add a --json flag to export.mjs that prints the rows as JSON', replies);
  expect(reason).toBe('done');
  const dones = events.filter((e) => e.type === 'tries-done').map((e) => `${e.label}: ${e.marks.join('')}`);
  expect(dones).toEqual(['Writing tests: ✓✓', 'Drafting versions: ✓✓', 'Checked tests against drafts: ✓✓']);
  expect(events.find((e) => e.type === 'tries-done' && e.label === 'Checked tests against drafts').summary).toBe('2 tests, 2 drafts; the chosen test is passed by 2');
  expect(fake.remaining()).toBe(2);
  expect(readFileSync(join(cwd, 'export.mjs'), 'utf8')).toContain("argv.includes('--json')");
});

test('change: not approving the test stops before any change', async () => {
  const cwd = join(mkdtempSync(join(tmpdir(), 'agentic-flow-')), 'project');
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
  // Three function-only tries, then three wider tries (edit blocks; a plain function is not one), then step by step.
  const { events } = await run(cwd, 'The tests fail. Fix it.', [{ text: '{"function": "median"}' }, { text: medianWrong }, { text: medianWrong }, { text: medianWrong }, { text: medianWrong }, { text: medianWrong }, { text: medianWrong }, { text: 'I looked; it needs more than median.' }]);
  expect(events.filter((e) => e.type === 'tries-done').map((e) => `${e.label}: ${e.marks.join('')}`)).toEqual(['Trying fixes: ✗✗✗', 'Trying wider fixes: ✗✗✗']);
  expect(events.some((e) => e.type === 'note' && /changed only median, nor 3 wider tries.*working step by step instead/.test(e.text))).toBe(true);
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

test('with a server Agentic Coder did not start (no slots), requests name no slot', async () => {
  const cwd = copy('fixture-fix');
  const { fake } = await run(cwd, 'tidy up', [{ text: '{"kind": "question"}' }, { text: 'Done.' }]);
  expect(fake.requests.filter((r) => r.stream).every((r) => r.id_slot === undefined)).toBe(true);
});

test('writing requests and new files work step by step (no test can define "done" for a story)', () => {
  // the request that wrote tests for a story for 2½ minutes on 24 Sep
  expect(routeByRules('CREATE A TXT FILE AND NAME IT "TEST" . ADD A SHORT STORY INSIDE AND ADD IT TO MY DESKTOP WHEN YOU ARE DONE').kind).toBe('other');
  expect(routeByRules('write a short poem in poem.md').kind).toBe('other');
  expect(routeByRules('add notes about the API to NOTES.md').kind).toBe('other');
  expect(routeByRules('update the README').kind).toBe('other');
  expect(routeByRules('create a new file called utils.js with a slugify function').kind).toBe('other');
  // code work still takes the focused paths
  expect(routeByRules('add a --json flag to export.mjs').kind).toBe('change');
  expect(routeByRules('fix the bug in the csv parser').kind).toBe('fix');
  expect(routeByRules('add a currency option to formatMoney() in money.mjs').kind).toBe('change');
});

test('a folder that is not a code project (a Desktop, a home folder) works step by step', async () => {
  const cwd = join(mkdtempSync(join(tmpdir(), 'agentic-flow-')), 'desk');
  mkdirSync(cwd);
  writeFileSync(join(cwd, 'notes.txt'), 'hello');
  mkdirSync(join(cwd, 'some-app'));
  writeFileSync(join(cwd, 'some-app', 'test.mjs'), 'export const x = 1;');
  expect(isCodeProject(cwd)).toBe(false);
  expect(isCodeProject(homedir())).toBe(false);
  expect(isCodeProject(join(homedir(), 'Desktop'))).toBe(false);
  expect(isCodeProject(join(import.meta.dir, '..', 'demo-project'))).toBe(true);
  const { events } = await run(cwd, 'add a --json flag to export.mjs', [{ text: 'There is no export.mjs here.' }]);
  expect(events.some((e) => e.type === 'route')).toBe(false);
  expect(events.some((e) => e.type === 'tries-done')).toBe(false);
});

test('change: two tests that cannot even load the code stop the test step early', async () => {
  const cwd = join(mkdtempSync(join(tmpdir(), 'agentic-flow-')), 'project');
  cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
  const brokenTest = "```js\nimport { thing } from './SEP';\ntest('x', () => assert.equal(thing(), 1));\n```";
  const replies = [{ text: brokenTest }, { text: brokenTest }, { text: 'I added nothing yet.' }];
  const { events } = await run(cwd, 'add a --json flag to export.mjs that prints the rows as JSON', replies);
  const tries = events.find((e) => e.type === 'tries-done' && e.label === 'Writing tests');
  expect(tries.marks).toEqual(['✗', '✗']); // not all 5
  expect(events.some((e) => e.type === 'note' && /working step by step instead/.test(e.text))).toBe(true);
});

// What kept Agentic Coder off a real bug (the chart test, 2026-09-25): a stopped test
// run read as failures, git missing from the scratch copy, a file list cut A to
// Z before ranking, and the named check taken as the file to fix.

test('fix: a check named in the request scores the tries, and is not the file to fix', async () => {
  const cwd = copy('fixture-fix');
  writeFileSync(join(cwd, 'check.mjs'), "import assert from 'node:assert/strict';\nimport { median } from './stats.mjs';\nassert.equal(median([4, 1, 3, 2]), 2.5);\n");
  const right = '```js\n' + statsWith('  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;') + '```';
  const { reason, events } = await run(cwd, 'the median is wrong for an even count, fix it. This check fails now and must pass when you are done: `node check.mjs`', [{ text: right }, { text: 'Fixed.' }]);
  expect(reason).toBe('done');
  const tools = events.filter((e) => e.type === 'tool');
  expect(tools.find((e) => e.name === 'Bash').arg).toBe('node check.mjs');
  expect(tools.find((e) => e.name === 'Read').arg).toBe('stats.mjs');
  expect(readFileSync(join(cwd, 'check.mjs'), 'utf8')).toContain('2.5');
  expect(readFileSync(join(cwd, 'stats.mjs'), 'utf8')).toContain('sorted.length % 2');
  expect(events.find((e) => e.type === 'assistant').text).toMatch(/node check\.mjs passes/);
});

test('fix: a test run stopped by the time limit is not read as a list of failures', async () => {
  const cwd = copy('fixture-fix');
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'slow', scripts: { test: "node -e \"console.log(' × docs/README.md 12ms'); setTimeout(() => {}, 60000)\"" } }));
  const { events } = await run(cwd, 'The tests fail. Find the bug in stats.mjs and fix it.', [{ text: 'I will look at stats.mjs step by step.' }], { testTimeoutMs: 1500 });
  expect(events.find((e) => e.type === 'tool' && e.name === 'Bash').view.lines.at(-1)).toMatch(/stopped after \d+ s, before it finished/);
  expect(events.some((e) => e.type === 'note' && /did not finish in \d+ s, so it cannot show what is wrong; working step by step instead/.test(e.text))).toBe(true);
  expect(events.some((e) => e.type === 'tries-done')).toBe(false);
});

test('checks named in a request, and e2e checks count as tests', () => {
  expect(checkInText('the list is hidden, fix it\n\nThis check fails now and must pass: `node desks/chart/tools/e2e/symmenu-layer.mjs` (it starts its own server)')).toBe('node desks/chart/tools/e2e/symmenu-layer.mjs');
  expect(checkInText('make sure `pytest tests/test_io.py` passes')).toBe('pytest tests/test_io.py');
  expect(checkInText('run `npm install` then fix the crash')).toBe(null); // not framed as a check
  expect(checkInText('rename `total` to `sum`; the tests must pass')).toBe(null); // not a command
  expect(isTestFile('desks/chart/tools/e2e/symmenu-layer.mjs')).toBe(true);
  expect(isTestFile('desks/chart/tv/legend.js')).toBe(false);
});

test('the file list is ranked before it is cut, so folders early in A to Z cannot crowd out the right one', () => {
  const cwd = join(mkdtempSync(join(tmpdir(), 'agentic-flow-')), 'big');
  const files = [];
  for (let i = 0; i < 200; i++) { const rel = `archive/old${String(i).padStart(3, '0')}.js`; mkdirSync(join(cwd, 'archive'), { recursive: true }); writeFileSync(join(cwd, rel), `export const price${i} = ${i};\n`); files.push(rel); }
  mkdirSync(join(cwd, 'desks', 'chart'), { recursive: true });
  writeFileSync(join(cwd, 'desks/chart/legend.js'), 'export function drawLegend() { /* EMA rows over the chart */ }\n');
  files.push('desks/chart/legend.js');
  const { code } = fileHints(cwd, 'the symbol search dropdown is hidden behind the EMA legend on the price chart, fix it', files);
  expect(code.length).toBe(150);
  expect(code[0]).toBe('desks/chart/legend.js');
});

test('tests in the scratch copy see the project\'s git, but cannot change it', async () => {
  const cwd = join(mkdtempSync(join(tmpdir(), 'agentic-flow-')), 'repo');
  mkdirSync(cwd);
  const git = (...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
  git('init', '-q');
  writeFileSync(join(cwd, '.gitignore'), 'secrets/\n');
  writeFileSync(join(cwd, 'a.mjs'), 'export const a = 1;\n');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'one');
  const head = git('rev-parse', 'HEAD').stdout;
  const s = new Scratch(cwd);
  try {
    const r = await s.run('git ls-files; git check-ignore -q --no-index secrets/x && echo ignored');
    expect(r.out.split('\n')).toEqual(expect.arrayContaining(['.gitignore', 'a.mjs', 'ignored']));
    s.write('b.mjs', 'export const b = 2;\n');
    await s.run('git add b.mjs; git -c user.name=t -c user.email=t@t commit -qm two');
  } finally { s.dispose(); }
  expect(git('rev-parse', 'HEAD').stdout).toBe(head);
  expect(git('ls-files').stdout.trim().split('\n')).toEqual(['.gitignore', 'a.mjs']);
});

// A page and its stylesheet: no functions to rewrite, so the model names
// strings to look for and fixes the lines shown with edit blocks.
const PAGE = `<!doctype html>
<link rel="stylesheet" href="legend.css">
<style>
  body{margin:0}
  .hud{position:absolute;top:0;z-index:4}
  #menu{position:fixed;z-index:80}
</style>
<div class="hud"><input id="sym"><div id="menu">matches</div></div>
<div class="lg">EMA 13 · 21</div>
`;
const CHECK = `import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const z = (file, sel) => Number(new RegExp(sel.replace('.', '\\\\.') + '\\\\{[^}]*z-index:(\\\\d+)').exec(readFileSync(file, 'utf8'))[1]);
assert.ok(z('page.html', '.hud') > z('legend.css', '.lg'), 'the menu (inside .hud) must paint above the legend');
`;
const pageProject = () => {
  const cwd = join(mkdtempSync(join(tmpdir(), 'agentic-flow-')), 'page');
  mkdirSync(cwd);
  writeFileSync(join(cwd, 'page.html'), PAGE);
  writeFileSync(join(cwd, 'legend.css'), '.lg{position:absolute;top:40px;z-index:4}\n');
  writeFileSync(join(cwd, 'check.mjs'), CHECK);
  return cwd;
};

test('fix in a page or stylesheet: search terms, the lines that hold them, edit blocks', async () => {
  const cwd = pageProject();
  const bad = '### page.html\n<<<<<<< OLD\n  #menu{position:fixed;z-index:80}\n=======\n  #menu{position:fixed;z-index:999}\n>>>>>>> NEW'; // applies, but the menu is still trapped in .hud
  const good = '### page.html\n<<<<<<< OLD\n  .hud{position:absolute;top:0;z-index:4}\n=======\n  .hud{position:absolute;top:0;z-index:5}\n>>>>>>> NEW';
  const replies = [{ text: '{"file": "page.html"}' }, { text: '{"terms": [".hud", ".lg", "z-index"]}' }, { text: bad }, { text: good }, { text: 'The header strip now sits one layer above the legend.' }];
  const { reason, events, fake } = await run(cwd, 'the dropdown is hidden behind the legend, fix it. This check fails now and must pass: `node check.mjs`', replies);
  expect(reason).toBe('done');
  expect(events.find((e) => e.type === 'tool' && e.name === 'Search').arg).toBe('.hud, .lg, z-index');
  // the model saw the rule in the page and the one in the stylesheet it loads
  const prompt = fake.requests.map((r) => r.messages.at(-1).content).find((c) => c.includes('The parts of the project'));
  expect(prompt).toContain('page.html (lines');
  expect(prompt).toContain('legend.css (lines 1-1)');
  expect(prompt).toContain('.lg{position:absolute;top:40px;z-index:4}');
  expect(events.find((e) => e.type === 'tries-done').marks).toEqual(['✗', '✓']);
  expect(readFileSync(join(cwd, 'page.html'), 'utf8')).toContain('.hud{position:absolute;top:0;z-index:5}');
  expect(readFileSync(join(cwd, 'check.mjs'), 'utf8')).toBe(CHECK);
  expect(events.find((e) => e.type === 'assistant').text).toMatch(/Fixed page\.html; node check\.mjs passes/);
});

test('fix in a page: when no try passes, nothing is changed', async () => {
  const cwd = pageProject();
  const bad = '### page.html\n<<<<<<< OLD\n  #menu{position:fixed;z-index:80}\n=======\n  #menu{position:fixed;z-index:999}\n>>>>>>> NEW';
  const { events } = await run(cwd, 'the dropdown is hidden behind the legend, fix it. This check fails now and must pass: `node check.mjs`', [{ text: '{"file": "page.html"}' }, { text: '{"terms": ["#menu"]}' }, { text: bad }, { text: bad }, { text: bad }, { text: bad }]);
  expect(events.find((e) => e.type === 'tries-done').marks).toEqual(['✗', '✗', '✗', '✗']);
  expect(events.some((e) => e.type === 'ask')).toBe(false);
  expect(readFileSync(join(cwd, 'page.html'), 'utf8')).toBe(PAGE);
});

test('excerpts: the lines with the most terms first, a little around each, long lines left out', () => {
  const cwd = join(mkdtempSync(join(tmpdir(), 'agentic-flow-')), 'ex');
  mkdirSync(cwd);
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
  lines[10] = '.hud{z-index:4}';
  lines[30] = `.hud{${'x'.repeat(3000)}}`;
  writeFileSync(join(cwd, 'a.css'), lines.join('\n'));
  const ex = excerpts(cwd, ['a.css'], ['.hud'], { around: 1 });
  expect(ex.text).toBe('a.css (lines 10-12):\n```\nline 9\n.hud{z-index:4}\nline 11\n```');
});

test('tools can write their caches in node_modules of the scratch copy; your node_modules is untouched', async () => {
  const cwd = join(mkdtempSync(join(tmpdir(), 'agentic-flow-')), 'app');
  mkdirSync(join(cwd, 'node_modules', 'pkg'), { recursive: true });
  mkdirSync(join(cwd, 'node_modules', '.vite-temp'));
  writeFileSync(join(cwd, 'node_modules', 'pkg', 'index.js'), 'module.exports = 42;\n');
  writeFileSync(join(cwd, 'package.json'), '{"name":"app"}');
  const s = new Scratch(cwd);
  try {
    const r = await s.run("mkdir -p node_modules/.vite-temp && echo x > node_modules/.vite-temp/config.mjs && node -e \"console.log(require('pkg'))\"");
    expect(r.code).toBe(0);
    expect(r.out).toContain('42');
  } finally { s.dispose(); }
  expect(readdirSync(join(cwd, 'node_modules', '.vite-temp'))).toEqual([]);
});

test('a fix described only by what it looks like asks where first; one that points somewhere does not', async () => {
  const { wantsWhere, questionFor, WHERE_QUESTION } = await import('../src/flows/clarify.mjs');
  expect(wantsWhere('the symbol search dropdown is hidden behind the EMA legend on the price chart, fix it')).toBe(true);
  expect(await questionFor({ cwd: tmpdir() }, 'the symbol search dropdown is hidden behind the EMA legend on the price chart, fix it')).toEqual({ question: WHERE_QUESTION, options: [] }); // a set question: nothing to pick from
  for (const t of ['The tests fail. Find the bug and fix it.', 'The tests in this project fail. Find the bug and fix it (fix the code, not the tests).', 'Fix the crash when the summary is empty in report.mjs', 'the list is hidden, fix it. This check must pass: `node check.mjs`', 'add a --json flag to export.mjs'])
    expect([t, wantsWhere(t)]).toEqual([t, false]);
});

test('thinking on: writing tests and drafting think at most SETUP_THINK_CAP; the tries keep the whole cap', async () => {
  expect(SETUP_THINK_CAP).toBeLessThan(model.thinkingBudget);
  const cwd = join(mkdtempSync(join(tmpdir(), 'agentic-flow-')), 'project');
  cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
  const good = '```js\n' + exportWith("  if (argv.includes('--json')) return JSON.stringify(rows);\n") + '```';
  const change = await run(cwd, 'add a --json flag to export.mjs that prints the rows as JSON', [{ text: jsonTest }, { text: jsonTest }, { text: good }, { text: good }, { text: 'Adds a --json flag.' }, { text: 'never used' }, { text: 'never used' }], { thinking: true });
  expect(change.reason).toBe('done');
  const capped = change.fake.requests.filter((r) => r.thinking_budget_tokens !== undefined);
  // Two tests and two drafts, each with the smaller cap and room for it.
  expect(capped.map((r) => r.thinking_budget_tokens)).toEqual([SETUP_THINK_CAP, SETUP_THINK_CAP, SETUP_THINK_CAP, SETUP_THINK_CAP]);
  expect(capped.every((r) => r.chat_template_kwargs.enable_thinking && r.max_tokens < 1200 + model.thinkingBudget)).toBe(true);

  const fix = await run(bigCopy(), 'The tests fail. Fix it.', [{ text: '{"function": "median"}' }, { text: medianWrong }, { text: medianWrong }, { text: medianWrong }, { text: medianWrong }, { text: medianWrong }, { text: medianWrong }, { text: 'I looked; it needs more than median.' }], { thinking: true });
  expect(fix.events.filter((e) => e.type === 'tries-done').map((e) => e.label)).toEqual(['Trying fixes', 'Trying wider fixes']);
  const tries = fix.fake.requests.filter((r) => r.chat_template_kwargs?.enable_thinking && !r.tools);
  expect(tries.length).toBe(6);
  expect(tries.every((r) => r.thinking_budget_tokens === undefined)).toBe(true);
});
