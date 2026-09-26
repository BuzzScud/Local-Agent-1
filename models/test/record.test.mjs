// The test record (models/evals/record.mjs): one line per run, read newest
// first, never a throw, and the saved copy of the Tests page.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordTest, readRecord, recordData, writeSnapshot, codeLabel, SNAPSHOT } from '../evals/record.mjs';

const scratch = () => { const dir = mkdtempSync(join(tmpdir(), 'bonsai-record-')); return { dir, file: join(dir, 'tests', 'record.jsonl') }; };
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
  expect(html).toContain('<title>Bonsai test record</title>');
  expect(html).not.toContain('<!--DATA-->');
  const json = /<script id="data" type="application\/json">(.*?)<\/script>/s.exec(html)[1];
  expect(json).not.toContain('</script>'); // a name cannot close the data block
  const data = JSON.parse(json);
  expect(data.rows[0].name).toBe('The 28 real requests </script><b>');
  expect(Object.keys(data.kinds)).toEqual(['tasks', 'requests', 'bug', 'suite', 'other']);
  expect(writeSnapshot({ file, docsDir: join(dir, 'not-there') })).toBe(null);
  expect(recordData(file).rows).toHaveLength(1);
});

test('the code under test is named by its commit, and a frozen copy inside another repo by its folder', () => {
  expect(codeLabel()).toMatch(/^[0-9a-f]{7,}\+?$/);
  const frozen = join(mkdtempSync(join(tmpdir(), 'bonsai-frozen-')), 'main-7595055'); mkdirSync(frozen);
  expect(codeLabel(frozen)).toBe('main-7595055');
});
