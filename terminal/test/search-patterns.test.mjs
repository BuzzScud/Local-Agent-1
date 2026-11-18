// Search takes the model's JavaScript patterns in a git project too (18 Nov 2026, the audit: git grep -E knows
// no \d, \w, \s, so "MAX_\w+ = " said "No matches"), a pattern that starts with "-", and a walk of a huge folder
// stops and says so.
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { searchFiles, listFiles } from '../src/tools/fs.mjs';

function repo() {
  const d = mkdtempSync(join(tmpdir(), 'agentic-search-'));
  writeFileSync(join(d, 'a.mjs'), 'export const MAX_STEPS = 40;\nconst x = 12;\n-- a dashed line\nplain words here\n');
  spawnSync('git', ['init', '-q'], { cwd: d });
  return d;
}

test('JavaScript shorthands find lines in a git project, as in a plain folder', () => {
  const d = repo();
  expect(searchFiles(d, { pattern: 'MAX_\\w+ = ' }).total).toBe(1);
  expect(searchFiles(d, { pattern: '= \\d+;' }).total).toBe(2);
  expect(searchFiles(d, { pattern: 'plain\\swords' }).total).toBe(1);
  expect(searchFiles(d, { pattern: '\\bx\\b' }).total).toBe(1);
  expect(searchFiles(d, { pattern: '(?i)max_steps' }).total).toBe(1);
});

test('a pattern that starts with a dash is a pattern, not a flag', () => {
  const d = repo();
  const r = searchFiles(d, { pattern: '-- a dashed' });
  expect(r.error).toBeUndefined();
  expect(r.total).toBe(1);
});

test('a walk of a very big folder stops and says so', async () => {
  const d = mkdtempSync(join(tmpdir(), 'agentic-walk-'));
  mkdirSync(join(d, 'x'));
  for (let i = 0; i < 40; i++) writeFileSync(join(d, 'x', `f${i}.txt`), 'hello\n');
  const fs = await import('../src/tools/fs.mjs');
  expect(fs.WALK_FILES).toBeGreaterThan(1000);
  // the walk itself is unchanged for a small folder
  expect(listFiles(d, { pattern: '*.txt' }).total).toBe(40);
  expect(searchFiles(d, { pattern: 'hello' }).total).toBe(40);
});
