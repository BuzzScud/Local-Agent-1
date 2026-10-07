// The test record (models/evals/record.mjs): one line per run, read newest
// first, never a throw, and the saved copy of the Tests page.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { recordTest, readRecord, recordData, writeSnapshot, codeLabel, recordFile, rawPlace, modelOf, installedModels, gradeOf, overviewTests, sideBySide, sideByMost, pathOf, taskSteps, SNAPSHOT, REAL_RECORD, skipsIn, skipWords } from '../evals/record.mjs';
import { RUN_TESTS } from '../evals/run-tests.mjs';
import { MODELS } from '../registry.mjs';

const scratch = () => { const dir = mkdtempSync(join(tmpdir(), 'agentic-record-')); return { dir, file: join(dir, 'tests', 'record.jsonl') }; };
const quiet = (file) => ({ file, snapshot: false, quiet: true });

test('a run is written as one line and read back newest first; pass or fail follows from the counts', () => {
  const { file } = scratch();
  const a = recordTest({ kind: 'tasks', name: 'The 28 practice tasks', at: '2026-09-25T21:09:27.000Z', code: 'abc1234', effort: 'low', ctx: 32768, passed: 28, total: 28, secs: 1974.4 }, quiet(file));
  const b = recordTest({ kind: 'tasks', name: 'The 28 practice tasks', at: '2026-09-26T23:45:18.000Z', code: 'def5678', passed: 27, total: 28, secs: 1929, note: 'failed: 25-bigproject-question' }, quiet(file));
  expect(a).toMatchObject({ id: 'tasks:2026-09-25T21:09:27.000Z', result: 'pass', secs: 1974, part: false, raw: '', page: '' });
  expect(b.result).toBe('fail');
  expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2);
  expect(readRecord(file).map((r) => r.code)).toEqual(['def5678', 'abc1234']);
  expect(recordTest({ kind: 'bug', name: 'a bug', result: 'stopped', passed: 0, total: 1 }, quiet(file)).result).toBe('stopped');
});

test('the same id again replaces the earlier line; a cut-off line and an unknown kind are skipped', () => {
  const { file } = scratch();
  recordTest({ id: 'suite:one', kind: 'suite', name: 'Unit tests', at: '2026-09-26T10:00:00.000Z', passed: 10, total: 12 }, quiet(file));
  recordTest({ id: 'suite:one', kind: 'suite', name: 'Unit tests', at: '2026-09-26T10:00:00.000Z', passed: 12, total: 12 }, quiet(file));
  appendFileSync(file, '{"id":"x","kind":"tasks","name":"cut of\n{"id":"y","kind":"nonsense","name":"n","at":"2026-09-26T11:00:00.000Z"}\n');
  const rows = readRecord(file);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ passed: 12, result: 'pass' });
});

test('a line without a kind or a name is refused without a throw, and nothing is written', () => {
  const { file } = scratch();
  expect(recordTest({ kind: 'tasks' }, quiet(file))).toBe(null);
  expect(recordTest({ kind: 'nonsense', name: 'x' }, quiet(file))).toBe(null);
  expect(recordTest(null, quiet(file))).toBe(null);
  expect(existsSync(file)).toBe(false);
  expect(readRecord(file)).toEqual([]);
  // a record that cannot be written (its folder is a file) is not an error either
  writeFileSync(join(scratch().dir, 'blocked'), '');
  const blocked = scratch(); writeFileSync(join(blocked.dir, 'tests'), 'a file where the folder should be');
  expect(recordTest({ kind: 'tasks', name: 'x' }, quiet(blocked.file))).toBe(null);
});

test('the saved copy is the Tests page with the record inside it; with no DOCS folder nothing is written', () => {
  const { dir, file } = scratch();
  recordTest({ kind: 'requests', name: 'The 28 real requests </script><b>', at: '2026-09-25T13:47:30.000Z', passed: 28, total: 28, secs: 1597 }, quiet(file));
  const docsDir = join(dir, 'docs'); mkdirSync(docsDir);
  const out = writeSnapshot({ file, docsDir });
  expect(out).toBe(join(docsDir, SNAPSHOT));
  const html = readFileSync(out, 'utf8');
  expect(html).toContain('<title>Agentic Coder test record</title>');
  expect(html).not.toContain('<!--DATA-->');
  const json = /<script id="data" type="application\/json">(.*?)<\/script>/s.exec(html)[1];
  expect(json).not.toContain('</script>'); // a name cannot close the data block
  const data = JSON.parse(json);
  expect(data.rows[0].name).toBe('The 28 real requests </script><b>');
  expect(Object.keys(data.kinds)).toEqual(['tasks', 'sets', 'requests', 'bug', 'suite', 'check', 'other']);
  expect(writeSnapshot({ file, docsDir: join(dir, 'not-there') })).toBe(null);
  expect(recordData(file).rows).toHaveLength(1);
});

test('a record that is not the real one never reaches the DOCS folder by itself, and its folder path is not shown', () => {
  const { dir, file } = scratch();
  const was = { docs: process.env.AGENTIC_DOCS, home: process.env.AGENTIC_HOME, rec: process.env.AGENTIC_TEST_RECORD };
  delete process.env.AGENTIC_DOCS; delete process.env.AGENTIC_TEST_RECORD;
  process.env.AGENTIC_HOME = dir; // what a test or a scratch run sets
  try {
    expect(recordFile()).toBe(file);
    expect(recordFile()).not.toBe(REAL_RECORD);
    recordTest({ kind: 'suite', name: 'Unit tests', passed: 3, total: 3 }, { quiet: true }); // snapshot left on, as a runner does
    expect(readRecord(file)).toHaveLength(1);
    expect(writeSnapshot()).toBe(null);
    expect(writeSnapshot({ file })).toBe(null);
    expect(recordData(file).file).toBe('record.jsonl'); // no folder of a scratch run in a page
  } finally {
    for (const [k, v] of [['AGENTIC_DOCS', was.docs], ['AGENTIC_HOME', was.home], ['AGENTIC_TEST_RECORD', was.rec]]) { if (v == null) delete process.env[k]; else process.env[k] = v; }
  }
});

test('the code under test is named by its commit, and a frozen copy inside another repo by its folder', () => {
  expect(codeLabel()).toMatch(/^[0-9a-f]{7,}\+?$/);
  const frozen = join(mkdtempSync(join(tmpdir(), 'agentic-frozen-')), 'main-7595055'); mkdirSync(frozen);
  expect(codeLabel(frozen)).toBe('main-7595055');
});

test('where the raw results are is kept from the repo\'s top, or from ~: never with your home folder\'s full path', () => {
  const top = join(import.meta.dir, '..', '..');
  expect(rawPlace(join(top, 'models', 'bonsai-2-27b', 'results', 'night'))).toBe('models/bonsai-2-27b/results/night');
  expect(rawPlace(join(homedir(), 'elsewhere', 'runs'))).toBe('~/elsewhere/runs');
  expect(rawPlace('models/bonsai-2-27b/results/runs')).toBe('models/bonsai-2-27b/results/runs');
  expect([rawPlace(''), rawPlace(undefined), rawPlace('/opt/runs')]).toEqual(['', '', '/opt/runs']);
  // A session's temporary folder names the account (the repo is public): only its last part is shown.
  expect(rawPlace('/private/tmp/claude-501/-Users-someone/8550d4f8/scratchpad/smoke-after-app')).toBe('a temporary folder (smoke-after-app)');
  expect(rawPlace('/tmp/agentic-eval-x/project')).toBe('a temporary folder (project)');
  // a line written before this rule is shown by the rule when read
  const { file } = scratch();
  const full = join(top, 'models', 'bonsai-2-27b', 'results', 'old-run');
  mkdirSync(join(file, '..'), { recursive: true });
  appendFileSync(file, `${JSON.stringify({ id: 'tasks:old', at: '2026-09-27T20:55:00.000Z', kind: 'tasks', name: 'an older line', passed: 1, total: 1, raw: full })}\n`);
  expect(recordTest({ kind: 'tasks', name: 'a new line', passed: 1, total: 1, raw: full }, quiet(file)).raw).toBe('models/bonsai-2-27b/results/old-run');
  expect(readRecord(file).map((r) => r.raw)).toEqual(['models/bonsai-2-27b/results/old-run', 'models/bonsai-2-27b/results/old-run']);
  expect(JSON.stringify(recordData(file))).not.toContain(homedir());
});

test('a run is filed under its model: the one it names, else its results folder, else its words, else its date; unit tests and checks are of no model', () => {
  const at = '2026-09-29T10:00:00.000Z';
  // a new line says so, and it is kept as written
  const { file } = scratch();
  expect(recordTest({ kind: 'tasks', name: 'a run', model: 'qwen', passed: 1, total: 1 }, quiet(file)).model).toBe('qwen');
  expect(recordTest({ kind: 'suite', name: 'Unit tests' }, quiet(file)).model).toBeNull();
  expect(readRecord(file).map((r) => r.model)).toEqual(expect.arrayContaining(['qwen', null]));
  // an older line has none: its results folder, then the model in its words
  expect(modelOf({ kind: 'tasks', at, name: 'x', raw: 'models/qwen3.5-9b/results/run-1' })).toBe('qwen');
  expect(modelOf({ kind: 'tasks', at, name: 'x', raw: '~/Desktop/agentic-coder/models/gemma-4-12b/results/low-vs-high' })).toBe('gemma');
  expect(modelOf({ kind: 'bug', at, name: 'x', raw: 'models/bonsai-2-27b/results/step3' })).toBe('bonsai');
  expect(modelOf({ kind: 'other', at, name: 'Gemma speed probe', note: '' })).toBe('gemma');
  expect(modelOf({ kind: 'other', at, name: 'Bonsai 27B probe' })).toBe('bonsai');
  // a battle is of two models, whichever two: "K2 vs Bonsai" names Bonsai, but the line is of no one model
  expect(modelOf({ kind: 'other', at, name: 'Battle · Fix a date that shows one day early (K2 vs Bonsai, 1 run each)' })).toBeNull();
  expect(modelOf({ kind: 'other', at, name: 'Battle · Fix a date that shows one day early (Gemma vs Qwen, 1 run each)' })).toBeNull();
  // both models named (a comparison), or an "other" check that names none, is of no one model
  expect(modelOf({ kind: 'other', at, name: 'Gemma vs Qwen', note: '' })).toBeNull();
  expect(modelOf({ kind: 'other', at, name: 'Repo check (fast)' })).toBeNull();
  // the small matcher is no chat model, even inside a model's results folder
  expect(modelOf({ kind: 'other', at, name: "Claude's notes: the right note comes back (BGE-M3)", raw: 'models/gemma-4-12b/results/claude-notes' })).toBeNull();
  expect(modelOf({ kind: 'suite', at, name: 'Unit tests, both parts', raw: 'models/gemma-4-12b/results/x' })).toBeNull();
  // a practice, request or bug run that names no model is by date: Bonsai before 28 Sep 2026, Gemma from then
  expect(modelOf({ kind: 'tasks', at: '2026-09-26T19:05:00.000Z', name: 'The 28 practice tasks' })).toBe('bonsai');
  expect(modelOf({ kind: 'tasks', at: '2026-09-28T22:21:00.000Z', name: 'The 1 picked practice tasks' })).toBe('gemma');
});

test('the side panel lists the models whose file is on this Mac, and the record data carries them', () => {
  const ids = installedModels().map((m) => m.id);
  expect(ids.every((id) => Object.keys(MODELS).includes(id))).toBe(true); // whichever of them are on this Mac
  const { file } = scratch();
  recordTest({ kind: 'tasks', name: 'a run', model: 'gemma', passed: 1, total: 1 }, quiet(file));
  expect(recordData(file).models).toEqual(installedModels());
});

test('the repo check has a tab of its own: its older lines, written as other, are filed under check and of no model', () => {
  const { file } = scratch();
  mkdirSync(join(file, '..'), { recursive: true });
  appendFileSync(file, `${JSON.stringify({ id: 'other:1', at: '2026-09-29T10:00:00.000Z', kind: 'other', name: 'Repo check (fast)', passed: 9, total: 10, result: 'fail', note: 'wrong: Private on GitHub' })}\n`);
  appendFileSync(file, `${JSON.stringify({ id: 'other:2', at: '2026-09-29T10:01:00.000Z', kind: 'other', name: 'Repo checker probe? no: a Sorting check', passed: 1, total: 1 })}\n`);
  recordTest({ kind: 'check', name: 'Repo check (fast)', at: '2026-09-29T11:00:00.000Z', passed: 9, total: 9 }, quiet(file));
  const rows = readRecord(file);
  expect(rows.map((r) => [r.kind, r.model])).toEqual([['check', null], ['other', null], ['check', null]]);
  expect(RUN_TESTS.find((t) => t.id === 'check').record.kind).toBe('check');
});

test('a result is a check (✓ or ✗), a check against its own bar, or a measurement with no pass or fail', () => {
  expect(gradeOf({ result: 'pass', passed: 28, total: 28 })).toEqual({ grade: 'check', bar: '' });
  expect(gradeOf({ result: 'fail', passed: 26, total: 28 })).toEqual({ grade: 'check', bar: '' });
  expect(gradeOf({ result: 'fail', passed: 9, total: 9, note: 'bun test ended with code 1' })).toEqual({ grade: 'check', bar: '' }); // a failure stays one
  expect(gradeOf({ result: 'measured', passed: null, total: null })).toEqual({ grade: 'measure', bar: '' });
  expect(gradeOf({ result: 'pass', passed: 16, total: 50, note: 'handed 15/25' })).toEqual({ grade: 'measure', bar: '' }); // said pass with 16 of 50 and no bar: it counted
  expect(gradeOf({ result: 'pass', passed: 81, total: 82, note: '81 of 82 sorted right (1 wrong; pass at most 4); 1.38 s a sort' })).toEqual({ grade: 'bar', bar: 'at most 4 wrong' });
  expect(gradeOf({ result: 'fail', passed: 70, total: 82, bar: 'at most 4 wrong' })).toEqual({ grade: 'bar', bar: 'at most 4 wrong' });
  expect(gradeOf({ result: 'stopped', passed: 3, total: 28 }).grade).toBe('check');
});

test('a line keeps its bar and the unit tests that failed, by name; a line without them has neither', () => {
  const { file } = scratch();
  const a = recordTest({ kind: 'other', name: 'Sorting check', model: 'gemma', passed: 81, total: 82, result: 'pass', bar: 'at most 4 wrong' }, quiet(file));
  const b = recordTest({ kind: 'suite', name: 'Unit tests, both parts', passed: 642, total: 644, failed: ['hub-run.test.mjs › stop ends the run', 'app-sort.test.mjs › picks one'] }, quiet(file));
  const c = recordTest({ kind: 'suite', name: 'Unit tests, both parts', passed: 644, total: 644, failed: [] }, quiet(file));
  expect(a.bar).toBe('at most 4 wrong');
  expect(b.failed).toEqual(['hub-run.test.mjs › stop ends the run', 'app-sort.test.mjs › picks one']);
  expect('failed' in c || 'bar' in c).toBe(false);
  const rows = readRecord(file);
  expect(rows.find((r) => r.name === 'Sorting check')).toMatchObject({ grade: 'bar', bar: 'at most 4 wrong' });
  expect(rows.filter((r) => r.failed).map((r) => r.failed.length)).toEqual([2]);
});

test('the Overview grid has a column for each whole test of one model ▶ Run a test can run, and a line for each check of no model', () => {
  const { board, health } = overviewTests();
  expect(board.map((t) => t.id)).toEqual(RUN_TESTS.filter((t) => t.model && !t.pick && !t.own).map((t) => t.id));
  expect(board.every((t) => !t.part)).toBe(true);
  expect(health.map((t) => t.id)).toEqual(['mcp-remote', 'big', 'remote-rules', 'hard', 'steps', 'claude-lean', 'ladder', 'unit', 'check', 'reader', 'studio', 'constantkv', 'door', 'follow-through']); // mcp-remote, big, remote-rules, hard, steps, claude-lean, ladder and follow-through run on a service, no model of this Mac
  const { file } = scratch();
  recordTest({ kind: 'tasks', name: 'a run', model: 'gemma', passed: 1, total: 1 }, quiet(file));
  expect(recordData(file)).toMatchObject({ board, health });
  // each column finds its test's line in the record
  expect(new RegExp(board.find((t) => t.id === 'sorting').re).test('Sorting check')).toBe(true);
  expect(new RegExp(health.find((t) => t.id === 'unit').re).test('Unit tests, both parts')).toBe(true);
});

test('a run from the Run tab keeps the panel rows it changed (settings), from the runner\'s env or given; a run with none has no settings', () => {
  const { file } = scratch();
  const was = process.env.AGENTIC_TEST_SETTINGS;
  try {
    process.env.AGENTIC_TEST_SETTINGS = JSON.stringify({ tries: 4 });
    recordTest({ id: 'a', at: '2026-09-30T01:00:00.000Z', kind: 'tasks', name: 'The 28 practice tasks', passed: 20, total: 28 }, quiet(file));
    delete process.env.AGENTIC_TEST_SETTINGS;
    recordTest({ id: 'b', at: '2026-09-30T02:00:00.000Z', kind: 'tasks', name: 'The 28 practice tasks', passed: 21, total: 28, settings: { steps: 20 } }, quiet(file));
    recordTest({ id: 'c', at: '2026-09-30T03:00:00.000Z', kind: 'suite', name: 'Unit tests', passed: 5, total: 5 }, quiet(file));
  } finally { if (was == null) delete process.env.AGENTIC_TEST_SETTINGS; else process.env.AGENTIC_TEST_SETTINGS = was; }
  const byId = Object.fromEntries(readRecord(file).map((r) => [r.id, r]));
  expect(byId.a.settings).toEqual({ tries: 4 });
  expect(byId.b.settings).toEqual({ steps: 20 });
  expect('settings' in byId.c).toBe(false);
});

// The hub's Harness tab reads the models side by side from here.
const taskRun = (top, raw, rows, sub = '') => { const dir = join(top, raw, sub); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'summary.json'), JSON.stringify({ ctx: 32768, effort: 'high', results: rows })); };
const row = (task, pass, secs, more = {}) => ({ task, pass, secs, thinking: true, thinkTokens: 100, modelCalls: 2, tps: 15, why: '', reason: 'done', ...more });

test('side by side: the newest task run both models did under the same name and settings, only the tasks both ran, task by task from the raw results', () => {
  const { dir, file } = scratch();
  const line = (model, at, raw, more = {}) => recordTest({ kind: 'tasks', name: 'Prompt old vs new, tasks 1,2,21', at, model, effort: 'high', ctx: 32768, passed: 2, total: 3, part: true, raw, ...more }, quiet(file));
  // The prompt test keeps its task rows one folder down, under new/; a plain run keeps them at the top.
  taskRun(dir, 'models/gemma-4-12b/results/run-a', [row('21-bigfile-two-places', false, 880, { reason: 'interrupted', why: 'tests still fail', tps: 0 }), row('5-only-gemma', true, 7), row('2-fix-bug', true, 50, { tps: 16 }), row('1-json-flag', true, 300, { tps: 14 })], 'new');
  taskRun(dir, 'models/qwen3.5-9b/results/run-a', [row('2-fix-bug', true, 20, { tps: 18 }), row('1-json-flag', true, 200, { tps: 20 }), row('21-bigfile-two-places', true, 340, { tps: 19 }), row('9-only-qwen', true, 5)]);
  line('gemma', '2026-09-30T11:00:20.000Z', 'models/gemma-4-12b/results/run-a');
  line('qwen', '2026-09-30T11:00:10.000Z', 'models/qwen3.5-9b/results/run-a');
  // A newer run only one of them did is passed over, and so is one that was stopped.
  recordTest({ kind: 'tasks', name: 'The 28 practice tasks', at: '2026-09-30T12:00:00.000Z', model: 'qwen', effort: 'high', ctx: 32768, passed: 1, total: 1, raw: 'models/qwen3.5-9b/results/run-a' }, quiet(file));
  line('qwen', '2026-09-30T13:00:00.000Z', 'models/qwen3.5-9b/results/run-a', { result: 'stopped' });
  recordTest({ kind: 'other', name: 'Sorting check', at: '2026-09-29T22:49:18.000Z', model: 'gemma', passed: 81, total: 82, result: 'pass' }, quiet(file));
  // A newer Sorting check of only part of the set, and one that was stopped, are not the model's score.
  recordTest({ kind: 'other', name: 'Sorting check', at: '2026-09-30T09:00:00.000Z', model: 'gemma', passed: 3, total: 5, part: true, result: 'pass' }, quiet(file));
  recordTest({ kind: 'other', name: 'Sorting check', at: '2026-09-30T09:30:00.000Z', model: 'qwen', passed: 10, total: 82, result: 'stopped' }, quiet(file));
  const { run, sort } = sideBySide(['gemma', 'qwen'], { file, top: dir, home: join(dir, 'no-arena') });
  expect(run).toMatchObject({ name: 'Prompt old vs new', at: '2026-09-30T11:00:20.000Z', effort: 'high', ctx: 32768, thinking: true, limitMins: 15, reps: 1 });
  expect(run.tasks.map((t) => t.id)).toEqual(['1-json-flag', '2-fix-bug', '21-bigfile-two-places']); // by number, whatever order they ran in; a task only one of them ran is left out
  expect(run.tasks[0]).toMatchObject({ n: 1, title: expect.stringContaining('--json') });
  expect(run.models.gemma).toMatchObject({ passed: 2, secs: 1230, median: 300, thinkTokens: 300, modelCalls: 6, write: 15 });
  expect(run.models.gemma.tasks['21-bigfile-two-places']).toMatchObject({ pass: false, secs: 880, why: 'time' });
  expect(run.models.qwen).toMatchObject({ passed: 3, secs: 560, median: 200, write: 19 });
  expect(sort).toEqual({ gemma: { right: 81, total: 82, at: '2026-09-29T22:49:18.000Z' }, qwen: null });
});

test('side by side: no run in common, raw results that are gone, or a different setting mean no run (never a throw)', () => {
  const { dir, file } = scratch();
  expect(sideBySide(['gemma', 'qwen'], { file, top: dir })).toEqual({ run: null, sort: { gemma: null, qwen: null } });
  const line = (model, more = {}) => recordTest({ kind: 'tasks', name: 'The 28 practice tasks', at: `2026-09-30T1${model === 'gemma' ? 0 : 1}:00:00.000Z`, model, effort: 'high', ctx: 32768, passed: 1, total: 1, raw: `models/${model}/results/run-b`, ...more }, quiet(file));
  line('gemma'); line('qwen');
  expect(sideBySide(['gemma', 'qwen'], { file, top: dir }).run).toBe(null); // the lines are there, the raw results are not
  taskRun(dir, 'models/gemma/results/run-b', [row('3-add-function', true, 10)]);
  taskRun(dir, 'models/qwen/results/run-b', [row('3-add-function', true, 12)]);
  expect(sideBySide(['gemma', 'qwen'], { file, top: dir }).run.tasks).toHaveLength(1);
  // A task run three times on one model and once on the other: reps is the fewest, and it passes only when every run did.
  taskRun(dir, 'models/gemma/results/run-b', [row('3-add-function', true, 10), row('3-add-function', false, 20, { why: 'wrong answer' }), row('3-add-function', true, 30)]);
  const thrice = sideBySide(['gemma', 'qwen'], { file, top: dir }).run;
  expect(thrice.reps).toBe(1);
  expect(thrice.models.gemma.tasks['3-add-function']).toMatchObject({ pass: false, secs: 20, why: 'wrong answer' });
  expect(thrice.limitMins).toBe(null);
  // One model alone: its own newest run.
  expect(sideBySide(['qwen'], { file, top: dir }).run.models.qwen.passed).toBe(1);
  // The same test at another context is another test: it does not pair with the first.
  const other = scratch();
  recordTest({ kind: 'tasks', name: 'The 28 practice tasks', at: '2026-09-30T10:00:00.000Z', model: 'gemma', effort: 'high', ctx: 32768, passed: 1, total: 1, raw: 'models/gemma/results/run-b' }, quiet(other.file));
  recordTest({ kind: 'tasks', name: 'The 28 practice tasks', at: '2026-09-30T11:00:00.000Z', model: 'qwen', effort: 'high', ctx: 65536, passed: 1, total: 1, raw: 'models/qwen/results/run-b' }, quiet(other.file));
  expect(sideBySide(['gemma', 'qwen'], { file: other.file, top: dir }).run).toBe(null);
});

// A model added later has no run yet: the Harness and Flow tabs show the newest run the most models share.
test('side by most: no run all four share falls back to the newest run the most of them share (two at least), naming who is in it', () => {
  const { dir, file } = scratch();
  // Each line its own minute: a line's id is its kind and time.
  const at = (h, model) => `2026-09-30T${h}:0${['gemma', 'qwen', 'k2', 'bonsai'].indexOf(model)}:00.000Z`;
  const line = (model, name, h) => recordTest({ kind: 'tasks', name, at: at(h, model), model, effort: 'high', ctx: 32768, passed: 1, total: 1, raw: `models/${model}/results/${name.replace(/ /g, '-')}` }, quiet(file));
  for (const model of ['gemma', 'qwen', 'k2', 'bonsai']) for (const name of ['Old pair', 'New pair', 'Three']) taskRun(dir, `models/${model}/results/${name.replace(/ /g, '-')}`, [row('3-add-function', true, 10)]);
  // Nothing shared: no run, and every model's sorting score is still there.
  expect(sideByMost(['gemma', 'qwen', 'k2', 'bonsai'], { file, top: dir })).toEqual({ run: null, sort: { gemma: null, qwen: null, k2: null, bonsai: null }, ids: [] });
  line('gemma', 'Old pair', 10); line('qwen', 'Old pair', 10);
  line('k2', 'New pair', 12); line('bonsai', 'New pair', 12);
  // Two pairs: the newer one.
  expect(sideByMost(['gemma', 'qwen', 'k2', 'bonsai'], { file, top: dir })).toMatchObject({ ids: ['k2', 'bonsai'], run: { name: 'New pair' } });
  // Three that share an older run beat a newer pair: the most models first, then the newest.
  line('gemma', 'Three', 11); line('qwen', 'Three', 11); line('k2', 'Three', 11);
  const three = sideByMost(['gemma', 'qwen', 'k2', 'bonsai'], { file, top: dir });
  expect(three.ids).toEqual(['gemma', 'qwen', 'k2']);
  expect(Object.keys(three.run.models)).toEqual(['gemma', 'qwen', 'k2']);
  // Every model in it: the same as side by side.
  line('bonsai', 'Three', 11);
  expect(sideByMost(['gemma', 'qwen', 'k2', 'bonsai'], { file, top: dir })).toMatchObject({ ids: ['gemma', 'qwen', 'k2', 'bonsai'], run: { name: 'Three' } });
  // One or two models: side by side as it was.
  expect(sideByMost(['gemma', 'k2'], { file, top: dir }).ids).toEqual(['gemma', 'k2']);
});

// The hub's Flow tab draws the paths and one real task from here.
test('side by side: each task says which path it took and whether it went on step by step; one task every model passed the short way is the example, step by step from its own log', () => {
  expect([{ route: 'rename' }, { route: 'fix' }, { route: 'change', tries: ['Writing tests: ✓✓', 'Drafting versions: ✓✓'] }, { route: 'change', tries: ['Writing tests: ✓✓', 'Drafting changes: ✓✗'] }, { route: 'question' }, { route: 'other' }, { route: 'step by step' }, {}, null].map(pathOf))
    .toEqual(['rename', 'fix', 'change', 'multi', 'loop', 'loop', 'loop', null, null]);
  const { dir, file } = scratch();
  const line = (model, raw) => recordTest({ kind: 'tasks', name: 'The 28 practice tasks', at: `2026-09-30T1${model === 'gemma' ? 0 : 1}:00:00.000Z`, model, effort: 'high', ctx: 32768, passed: 4, total: 4, raw }, quiet(file));
  const rows = (fixSecs, more = {}) => [
    row('1-json-flag', true, 300, { route: 'change', tries: ['Writing tests: ✓✓', 'Drafting versions: ✓✓'], ownSteps: 0 }),
    row('2-fix-bug', true, fixSecs, { route: 'fix', tries: ['Trying fixes: ✓'], ownSteps: 0 }),
    row('21-bigfile', true, 340, { route: 'fix', tries: ['Trying fixes: ✗✗✗', 'Trying wider fixes: ✗✗✗'], ownSteps: 7, ...more }),
    row('18-story', true, 44, { route: 'step by step', ownSteps: 2 }),
  ];
  // The log of a task, as the runner writes it: beside the summary, or one folder down in t<number>/ (the prompt test).
  const log = (secs) => ({ task: '2-fix-bug', thinking: true, reason: 'done', log: [
    { type: 'sorted', kind: 'fix', text: 'Sorted as: fix · shortcut', at: 1000 },
    { type: 'tool', id: 'flow_2', name: 'Bash', label: 'Bash', arg: 'node --test', view: { kind: 'bash', code: 1 }, at: 1200 },
    { type: 'tries-done', label: 'Trying fixes', marks: ['✓'], secs: secs + 0.4, at: 2000 },
    { type: 'tool', id: 'plan_1', name: 'Ask', label: 'Ask', arg: 'Before I change anything: change stats.mjs (+3 −0). Go ahead?', view: { kind: 'answer', question: 'Before I change anything: change stats.mjs (+3 −0). Go ahead?', text: 'yes' }, at: 2100 },
    { type: 'tool', id: 'flow_4', name: 'Update', label: 'Update', arg: 'stats.mjs', view: { kind: 'diff', path: 'stats.mjs', created: false, additions: 3, removals: 0 }, at: 2200 },
    { type: 'tool', id: 'flow_5', name: 'Bash', label: 'Bash', arg: 'node --test', view: { kind: 'bash', code: 0 }, at: 2300 },
    { type: 'assistant', text: 'Fixed stats.mjs; all 4 tests pass.', final: true, at: 2400 },
    { type: 'settled', request: 'The tests fail. Fix the bug.', kind: 'fix', reason: 'done', check: null, at: 2500 },
  ] });
  taskRun(dir, 'models/gemma/results/run-c', rows(49), 'new');
  taskRun(dir, 'models/qwen/results/run-c', rows(23, { pass: false, reason: 'interrupted' }));
  mkdirSync(join(dir, 'models/gemma/results/run-c/new/t2'), { recursive: true });
  writeFileSync(join(dir, 'models/gemma/results/run-c/new/t2/2-fix-bug-think-on.json'), JSON.stringify(log(46)));
  writeFileSync(join(dir, 'models/qwen/results/run-c/2-fix-bug-think-on.json'), JSON.stringify(log(21)));
  line('gemma', 'models/gemma/results/run-c'); line('qwen', 'models/qwen/results/run-c');
  const { run } = sideBySide(['gemma', 'qwen'], { file, top: dir, home: join(dir, 'no-arena') });
  expect(Object.fromEntries(Object.entries(run.models.gemma.tasks).map(([t, x]) => [t, [x.path, x.thenLoop]]))).toEqual({ '1-json-flag': ['change', false], '2-fix-bug': ['fix', false], '18-story': ['loop', false], '21-bigfile': ['fix', true] });
  // The example is the fix both passed in one round of tries, not the first task by number (a change) nor the one that went on step by step.
  expect(run.example).toMatchObject({ task: '2-fix-bug', request: 'The tests fail. Fix the bug.', memory: false });
  expect(run.example.models.gemma).toEqual({ request: 'The tests fail. Fix the bug.', sorted: 'fix · shortcut', tries: [{ label: 'Trying fixes', marks: '✓', secs: 46 }], asked: [{ question: 'Before I change anything: change stats.mjs (+3 −0). Go ahead?', answer: 'yes' }],
    changed: [{ path: 'stats.mjs', add: 3, del: 0, created: false, test: false }], check: { cmd: 'node --test', ok: true } });
  expect(run.example.models.qwen.tries[0].secs).toBe(21);
  // A log that is gone, cut off or empty gives no example, never a throw; the paths stay.
  expect(taskSteps(join(dir, 'models/qwen/results/run-c'), '9-not-there')).toBe(null);
  writeFileSync(join(dir, 'models/qwen/results/run-c/2-fix-bug-think-on.json'), '{"log": [');
  const cut = sideBySide(['gemma', 'qwen'], { file, top: dir, home: join(dir, 'no-arena') }).run;
  expect(cut.example).toBe(null);
  expect(cut.models.qwen.tasks['21-bigfile']).toMatchObject({ pass: false, path: 'fix', thenLoop: true });
  // A run from before the route was kept: no path, no example.
  taskRun(dir, 'models/gemma/results/run-c', [row('2-fix-bug', true, 49)], 'new');
  taskRun(dir, 'models/qwen/results/run-c', [row('2-fix-bug', true, 23)]);
  const old = sideBySide(['gemma', 'qwen'], { file, top: dir, home: join(dir, 'no-arena') }).run;
  expect(old.models.gemma.tasks['2-fix-bug']).toMatchObject({ path: null, thenLoop: false });
  expect(old.example).toBe(null);
});

test('tests skipped for want of a tool are counted by their reason, said the most first, and kept on the run\'s line', () => {
  const out = ['terminal/test/vision.test.mjs:', '(skipped: no picture helper)', '\x1b[2m(skipped: no picture helper)\x1b[0m', '(skipped: no pytest)', 'it said (skipped: no pytest) in a sentence', ' 3 pass', ' 3 skip'].join('\n');
  const why = skipsIn(out);
  expect(why).toEqual({ 'no picture helper': 2, 'no pytest': 1 }); // a whole line only, colours aside
  expect(skipsIn('(skipped: no pytest)\n', why)).toEqual({ 'no picture helper': 2, 'no pytest': 2 }); // added up, file after file
  expect(skipWords({ 'no pytest': 9, 'no picture helper': 16, 'no Chrome': 2 })).toBe('16 no picture helper, 9 no pytest, 2 no Chrome');
  expect(skipWords({})).toBe('');
  const dir = mkdtempSync(join(tmpdir(), 'agentic-record-skips-'));
  const file = join(dir, 'record.jsonl');
  const line = recordTest({ kind: 'suite', name: 'Unit tests, both parts', passed: 10, total: 10, secs: 1, skipped: { 'no pytest': 3 } }, { file, snapshot: false, quiet: true });
  expect(line.skipped).toEqual({ 'no pytest': 3 });
  expect(recordTest({ kind: 'suite', name: 'Unit tests, both parts', passed: 10, total: 10, secs: 1, skipped: {} }, { file, snapshot: false, quiet: true }).skipped).toBeUndefined();
});
