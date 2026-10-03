// The tests never reach the real home (3 Oct 2026, the fix plan's Part 5a). Several test files in one
// `bun test` share one process, and the models part reads its home once: before, a file that imported
// it first with no AGENTIC_HOME froze the REAL ~/.agentic-coder, and remote-rules.test.mjs then deleted
// settings.json there after every test (all of its tests passed, so nothing warned). Now the preload
// (test-env.mjs) gives every test process a throwaway home before anything loads, the models part never
// takes the real one inside a test run, and remote-rules deletes only in its own throwaway folder.
// Checked here for real, with a pretend $HOME: two files in one process, no AGENTIC_HOME, and a
// settings.json planted where the "real" home would be.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = join(import.meta.dir, '..', '..');

test('two test files in one process, with no AGENTIC_HOME: the "real" home\'s settings.json is still there after', () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-pretend-home-'));
  const real = join(home, '.agentic-coder');
  mkdirSync(real);
  const planted = JSON.stringify({ planted: 'by test-home.test.mjs', layout: 'classic' });
  writeFileSync(join(real, 'settings.json'), planted);
  const env = { ...process.env, HOME: home };
  for (const k of ['AGENTIC_HOME', 'FORCE_COLOR']) delete env[k];
  // sort.test.mjs imports the models part at its top without a home of its own; remote-rules.test.mjs comes after.
  const r = spawnSync(process.execPath, ['test', './terminal/test/sort.test.mjs', './terminal/test/remote-rules.test.mjs'], { cwd: REPO, env, encoding: 'utf8', timeout: 170_000 });
  const out = `${r.stdout}${r.stderr}`;
  expect(out).toMatch(/Ran \d+ tests across 2 files/);
  expect(existsSync(join(real, 'settings.json'))).toBe(true);
  expect(readFileSync(join(real, 'settings.json'), 'utf8')).toBe(planted);
}, 180_000);

test('a test process has a throwaway home before anything loads, and the models part never takes the real one', async () => {
  // The preload set it before this file was read.
  expect(process.env.AGENTIC_HOME).toBeTruthy();
  expect(process.env.AGENTIC_HOME.startsWith(tmpdir()) || process.env.AGENTIC_HOME.startsWith('/private' + tmpdir())).toBe(true);
  // A child in a test run with no AGENTIC_HOME at all: its home is a throwaway, not $HOME/.agentic-coder.
  const home = mkdtempSync(join(tmpdir(), 'agentic-pretend-home-'));
  mkdirSync(join(home, '.agentic-coder'));
  const env = { ...process.env, HOME: home, NODE_ENV: 'test' };
  for (const k of ['AGENTIC_HOME']) delete env[k];
  const r = spawnSync(process.execPath, ['-e', "const { HOME } = await import('./models/index.mjs'); console.log(HOME);"], { cwd: REPO, env, encoding: 'utf8', timeout: 30_000 });
  const got = r.stdout.trim();
  expect(got).not.toBe(join(home, '.agentic-coder'));
  expect(got.length).toBeGreaterThan(0);
  // Outside a test run nothing changes: no AGENTIC_HOME means the real one.
  const outside = { ...env };
  delete outside.NODE_ENV;
  const o = spawnSync(process.execPath, ['-e', "const { HOME } = await import('./models/index.mjs'); console.log(HOME);"], { cwd: REPO, env: outside, encoding: 'utf8', timeout: 30_000 });
  expect(o.stdout.trim()).toBe(join(home, '.agentic-coder'));
});

test('a test run takes its own throwaway home away with it when it ends', () => {
  // A temp folder of its own for the child, so only what that run leaves is counted.
  const tmp = mkdtempSync(join(tmpdir(), 'agentic-own-tmp-'));
  const env = { ...process.env, TMPDIR: tmp, NO_COLOR: '1', FORCE_COLOR: '0' };
  for (const k of ['AGENTIC_HOME', 'AGENTIC_TEST_HOME']) delete env[k];
  const r = spawnSync('bun', ['test', './terminal/test/words.test.mjs'], { cwd: REPO, env, encoding: 'utf8', timeout: 60_000 });
  expect(`${r.stdout}${r.stderr}`).toMatch(/^\s*0 fail$/m);
  expect(readdirSync(tmp).filter((n) => n.startsWith('agentic-test-home-'))).toEqual([]);
}, 90_000);

