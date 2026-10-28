// A helper's report checked against the files (src/agent/helper-proof.mjs, 28 Oct 2026): the lines it cites read from
// the files, a cite a few lines off shown at the right line, and what the files do not have named. No model.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkReport, citesOf, namesOf, proofBlock, recheckNote } from '../src/agent/helper-proof.mjs';

const cwd = mkdtempSync(join(tmpdir(), 'agentic-proof-'));
mkdirSync(join(cwd, 'src', 'app'), { recursive: true });
writeFileSync(join(cwd, 'src', 'app', 'panel.mjs'), ['// The panel.', '', 'export const KEEP_DONE_MS = 6000;', '', 'export const shown = (list, now) => list.filter((h) => now - h.doneAt < KEEP_DONE_MS);', ''].join('\n'));
writeFileSync(join(cwd, 'src', 'app', 'profiles.mjs'), ['// Profiles.', 'export function writeProfiles(data) {', '  return data;', '}', 'export function helpersTo(data, model) {', '  return { ...data, model };', '}', ''].join('\n'));

test('cites in the shapes a report writes them, and the code names in it', () => {
  const r = 'KEEP_DONE_MS is at `src/app/panel.mjs:3`; see line 5 in panel.mjs, and profiles.mjs, line 5 (`helpersTo`). writeProfiles() writes it; `export const KEEP_DONE_MS = 6000`.';
  expect(citesOf(r).map((c) => `${c.path}:${c.line}`)).toEqual(['src/app/panel.mjs:3', 'panel.mjs:5', 'profiles.mjs:5']);
  expect(namesOf(r).sort()).toEqual(['KEEP_DONE_MS', 'helpersTo', 'writeProfiles']);
  expect(namesOf('It reads the folder and keeps the rows for a while.')).toEqual([]);
});

test('the lines it cites, read from the files; a cite a few lines off shown where the name is', () => {
  const c = checkReport('(1) 6 seconds: line 9 in panel.mjs (KEEP_DONE_MS). (2) helpersTo, profiles.mjs:4.', cwd);
  expect(c.problems).toEqual([]);
  expect(c.proof).toEqual([
    'src/app/panel.mjs:3  export const KEEP_DONE_MS = 6000;  (cited as line 9)',
    'src/app/profiles.mjs:5  export function helpersTo(data, model) {  (cited as line 4)',
  ]);
  const block = proofBlock(c);
  expect(block).toContain('read from the files by Agentic Coder just now');
  expect(block).toContain('  src/app/panel.mjs:3  export const KEEP_DONE_MS = 6000;');
  expect(block).not.toContain('Not confirmed');
});

test('a name with no cite is found where it is defined', () => {
  expect(checkReport('useHelperModel calls writeProfiles.', cwd).proof).toEqual(['src/app/profiles.mjs:2  export function writeProfiles(data) {']);
});

test('what the files do not have: a made-up function, a file not there, a line past the end', () => {
  const c = checkReport('It is `saveProfileWithModel`, at line 131 in `app-panels.mjs`; and panel.mjs:40.', cwd);
  expect(c.problems).toEqual(['app-panels.mjs is not in the project', 'src/app/panel.mjs:40 is past the end (it has 6 lines)', '`saveProfileWithModel` is not in the project']);
  expect(proofBlock(c)).toBe('Not confirmed by the files: app-panels.mjs is not in the project; src/app/panel.mjs:40 is past the end (it has 6 lines); `saveProfileWithModel` is not in the project.');
  expect(recheckNote(c.problems)).toContain('Look again with your tools and send the report again');
  expect(proofBlock(checkReport('Nothing named here.', cwd))).toBe('');
});
