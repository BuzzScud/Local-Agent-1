
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { listFiles, globToRegExp } from '../src/tools/fs.mjs';

test('globToRegExp: *.js also matches .mjs', () => {
  assert.ok(globToRegExp('*.js').test('a.mjs'));
  assert.ok(!globToRegExp('*.js').test('a.py'));
});

test('listFiles skips node_modules', () => {
  const d = mkdtempSync(join(tmpdir(), 'fs-test-'));
  mkdirSync(join(d, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(d, 'node_modules', 'x', 'index.js'), '');
  writeFileSync(join(d, 'a.js'), '');
  assert.deepEqual(listFiles(d, { pattern: '**/*' }).lines, ['a.js']);
});
