// The test record (models/evals/record.mjs): one line per run, read newest
// first, never a throw, and the saved copy of the Tests page.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { recordTest, readRecord, recordData, writeSnapshot, codeLabel, recordFile, rawPlace, modelOf, installedModels, SNAPSHOT, REAL_RECORD } from '../evals/record.mjs';

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
  expect(Object.keys(data.kinds)).toEqual(['tasks', 'sets', 'requests', 'bug', 'suite', 'other']);
  expect(writeSnapshot({ file, docsDir: join(dir, 'not-there') })).toBe(null);
  expect(recordData(file).rows).toHaveLength(1);
});

test('a record that is not the real one never reaches the DOCS folder by itself, and its folder path is not shown', () => {
  const { dir, file } = scratch();
  const was = { docs: (process.env.AGENTIC_DOCS ?? process.env.BONSAI_DOCS), home: (process.env.AGENTIC_HOME ?? process.env.BONSAI_HOME), rec: (process.env.AGENTIC_TEST_RECORD ?? process.env.BONSAI_TEST_RECORD) };
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
  expect(ids.every((id) => ['gemma', 'qwen'].includes(id))).toBe(true);
  const { file } = scratch();
  recordTest({ kind: 'tasks', name: 'a run', model: 'gemma', passed: 1, total: 1 }, quiet(file));
  expect(recordData(file).models).toEqual(installedModels());
});
