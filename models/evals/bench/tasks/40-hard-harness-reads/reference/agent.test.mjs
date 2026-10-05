import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { step } from './agent.mjs';

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'mini-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'cart.mjs'), 'export const total = (xs) => xs.reduce((a, b) => a + b, 0);\nexport const tax = (x) => x * 0.2;\n');
  writeFileSync(join(dir, 'notes.txt'), 'one\ntwo\nthree\n');
  return dir;
}

test('Read numbers the lines of a file, a part with offset and limit', async () => {
  const cwd = project();
  assert.equal((await step({ name: 'Read', args: { path: 'notes.txt' } }, { cwd })).text, '1: one\n2: two\n3: three');
  assert.equal((await step({ name: 'Read', args: { path: 'notes.txt', offset: 2, limit: 1 } }, { cwd })).text, '2: two');
});

test('Search finds lines by pattern; List shows a folder', async () => {
  const cwd = project();
  assert.equal((await step({ name: 'Search', args: { pattern: 'tax', path: 'src' } }, { cwd })).text, 'src/cart.mjs:2: export const tax = (x) => x * 0.2;');
  assert.equal((await step({ name: 'List', args: { path: '.' } }, { cwd })).text, 'notes.txt\nsrc/');
});

test('Bash runs a command in the project folder', async () => {
  const cwd = project();
  assert.equal((await step({ name: 'Bash', args: { command: 'echo hi' } }, { cwd })).text, 'hi');
});

import { plainRead } from './tools.mjs';
test('a plain read in Bash runs as the tool', async () => {
  const cwd = project();
  assert.deepEqual(plainRead('cat notes.txt', cwd), { name: 'Read', args: { path: 'notes.txt' } });
  assert.equal((await step({ name: 'Bash', args: { command: 'cat notes.txt' } }, { cwd })).text, '(Run as Read)\n1: one\n2: two\n3: three');
});
test('tail reads the last lines; grep and ls map to Search and List', () => {
  const cwd = project();
  assert.deepEqual(plainRead('tail -n 2 notes.txt', cwd), { name: 'Read', args: { path: 'notes.txt', offset: 2, limit: 2 } });
  assert.deepEqual(plainRead('grep -rn tax src', cwd), { name: 'Search', args: { pattern: 'tax', path: 'src' } });
  assert.deepEqual(plainRead('ls -la src', cwd), { name: 'List', args: { path: 'src' } });
});
test('anything else runs as typed', () => {
  const cwd = project();
  for (const c of ['cat notes.txt | head', 'cat notes.txt > x', 'head -c 3 notes.txt', 'grep -i tax src', 'cat a b', 'cat missing.txt']) assert.equal(plainRead(c, cwd), null);
});
test('find with -name lists by glob', () => {
  const cwd = project();
  assert.deepEqual(plainRead("find src -type f -name '*.mjs'", cwd), { name: 'List', args: { path: 'src', pattern: '**/*.mjs' } });
});
