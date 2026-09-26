// Started in the home folder: a general question is answered and the turn ends;
// a named project is asked about once, then worked in, with its own rules.
// home-flow.mjs runs in its own process with HOME set to a pretend home folder.
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('from the home folder: a plain answer for a general question; a named project is asked about, then worked in', () => {
  const home = mkdtempSync(join(tmpdir(), 'bonsai-home-'));
  const r = spawnSync(process.execPath, [join(import.meta.dir, 'home-flow.mjs')], { cwd: home, env: { ...process.env, HOME: home, BONSAI_SANDBOX: '0' }, encoding: 'utf8', timeout: 60_000 });
  const results = JSON.parse(r.stdout.trim().split('\n').pop() || '[]');
  expect(results.length).toBe(12);
  expect(results.filter(([, passed]) => !passed).map(([label]) => label)).toEqual([]);
});
