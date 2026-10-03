// needs.mjs: a tool a test needs that this Mac lacks is a named skip, never a failure, and a tool
// that is here is never skipped. Checked with finders of its own, so it does not depend on what
// this Mac has.
import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { needs, REASONS, hiddenTools } from './needs.mjs';

const REPO = join(import.meta.dir, '..', '..');

test('a tool that is here is not skipped; one that is missing gives its reason; a hidden one counts as missing', () => {
  expect(needs('chrome', () => '/Applications/Some Browser')).toBe(false);
  expect(needs('playwright', () => null, { quiet: true })).toBe(REASONS.playwright); // quiet: this file's own output must not count as a skip
  expect(needs('sandbox', () => { throw new Error('no'); }, { quiet: true })).toBe(REASONS.sandbox);
  expect(() => needs('telepathy')).toThrow('no tool called "telepathy"');
  expect(hiddenTools({ AGENTIC_TEST_HIDE: 'pytest, chrome' })).toEqual(['pytest', 'chrome']);
  expect(hiddenTools({})).toEqual([]);
  expect(globalThis.needs).toBe(needs); // the models part's tests reach it through the preload
});

test('in a real run a hidden tool skips its tests, one line each, and nothing fails; with the tool here they run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-needs-'));
  const file = join(dir, 'tool.test.mjs');
  writeFileSync(file, `import { test, expect } from 'bun:test';
import { needs } from ${JSON.stringify(join(import.meta.dir, 'needs.mjs'))};
const here = () => true;
test.skipIf(needs('chrome', here))('needs the browser, one', () => { expect(1).toBe(1); });
test.skipIf(needs('chrome', here))('needs the browser, two', () => { expect(1).toBe(1); });
test('needs nothing', () => { expect(1).toBe(1); });
`);
  const run = (hide) => spawnSync('bun', ['test', file], { cwd: REPO, encoding: 'utf8', timeout: 60_000, env: { ...process.env, AGENTIC_TEST_HIDE: hide, NO_COLOR: '1', FORCE_COLOR: '0' } });
  const hidden = run('chrome');
  const out = `${hidden.stdout}${hidden.stderr}`;
  expect(hidden.status).toBe(0);
  expect(out.match(/^\(skipped: no Chrome\)$/gm)).toHaveLength(2);
  expect(out).toMatch(/^\s*1 pass$/m);
  expect(out).toMatch(/^\s*2 skip$/m);
  expect(out).toMatch(/^\s*0 fail$/m);
  const shown = run('');
  const all = `${shown.stdout}${shown.stderr}`;
  expect(all).not.toContain('(skipped:');
  expect(all).toMatch(/^\s*3 pass$/m);
});
