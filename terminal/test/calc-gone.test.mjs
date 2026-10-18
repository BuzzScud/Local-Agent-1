// The calculator link was taken out (18 Oct 2026): `coding calc` only takes an old Mac's login item away (web/calc-gone.mjs).
import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CALC_LABEL, calcGone, retireCalcLink } from '../src/web/calc-gone.mjs';

const cli = join(import.meta.dir, '..', 'src', 'cli.jsx');

test('an old login item is taken away: its file goes, and launchd lets it go', () => {
  const dir = mkdtempSync(join(tmpdir(), 'calc-gone-'));
  writeFileSync(join(dir, `${CALC_LABEL}.plist`), '<plist/>');
  const asked = [];
  expect(retireCalcLink({ dir, run: (a) => asked.push(a), uid: 501, loaded: true })).toEqual({ had: true });
  expect(existsSync(join(dir, `${CALC_LABEL}.plist`))).toBe(false);
  if (process.platform === 'darwin') expect(asked).toEqual([['bootout', `gui/501/${CALC_LABEL}`]]);
  // A folder of a test's own: nothing is asked of launchd, whatever is there.
  const quiet = [];
  expect(retireCalcLink({ dir, run: (a) => quiet.push(a), uid: 501 })).toEqual({ had: false });
  expect(quiet).toEqual([]);
});

test('coding calc says it was taken out, and ends with 0 so launchd does not start it again', () => {
  const said = [];
  expect(calcGone({ out: (s) => said.push(s), retire: () => ({}), had: true })).toBe(0);
  expect(said[0]).toContain('taken out of Agentic Coder on 18 Oct 2026; its background service on this Mac goes too');
  expect(said[0]).toContain("The web's calculator tools still work");
  // The real command, as an old login item starts it (`coding calc run`), with a login item in a folder of its own.
  const dir = mkdtempSync(join(tmpdir(), 'calc-gone-cli-'));
  writeFileSync(join(dir, `${CALC_LABEL}.plist`), '<plist/>');
  const r = spawnSync(process.execPath, [cli, 'calc', 'run'], { encoding: 'utf8', env: { ...process.env, AGENTIC_LAUNCH_DIR: dir }, timeout: 20_000 });
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('The calculator link was taken out of Agentic Coder');
  expect(existsSync(join(dir, `${CALC_LABEL}.plist`))).toBe(false);
});
