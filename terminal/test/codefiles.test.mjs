// Which code the project map and the code search read (src/tools/repomap.mjs
// codeFiles, src/tools/codeindex.mjs): in a big, messy folder, the files git
// knows, the most recently worked on first. Until 29 Sep both took the first
// 400 code files in the folder's order: on this repo 396 of them were old test
// output git ignores, and terminal/src was never read.
import { test, expect, beforeAll } from 'bun:test';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { FakeEmbedder } from './fake-embedder.mjs';

let codeFiles, repoMap, CodeIndex;
beforeAll(async () => {
  process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-codefiles-home-'));
  ({ codeFiles, repoMap } = await import('../src/tools/repomap.mjs'));
  ({ CodeIndex } = await import('../src/tools/codeindex.mjs'));
});

const tmp = (name) => mkdtempSync(join(tmpdir(), `agentic-codefiles-${name}-`));
const git = (cwd, args, date) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
  cwd, encoding: 'utf8', env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
});
const write = (cwd, rel, text) => { mkdirSync(join(cwd, rel, '..'), { recursive: true }); writeFileSync(join(cwd, rel), text); };
const when = (cwd, rel, ms) => utimesSync(join(cwd, rel), new Date(ms), new Date(ms));

// A project like this repo on 29 Sep: ignored test output that comes first in
// the folder's order and outnumbers the code, an old copy, a vendored library,
// and the real code, committed at different times.
function messyProject() {
  const cwd = join(tmp('messy'), 'project');
  mkdirSync(cwd, { recursive: true });
  git(cwd, ['init', '-q']);
  write(cwd, '.gitignore', 'a-results/\n');
  for (let i = 0; i < 450; i++) write(cwd, `a-results/run-${String(i).padStart(3, '0')}.mjs`, `export const run${i} = ${i};\n`);
  write(cwd, 'archive/old-app/billing.mjs', '// the old billing\nexport function invoiceTotal() { return 0; }\n');
  write(cwd, 'vendor/chart-lib.js', 'export function drawChart() {}\n');
  write(cwd, 'src/old.mjs', 'export function oldThing() { return 1; }\n');
  write(cwd, 'src/edited.mjs', 'export function edited() { return 1; }\n');
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', 'first'], '2019-01-01T00:00:00Z');
  write(cwd, 'src/billing.mjs', '// Invoices: the tests check the total.\nexport function invoiceTotal(lines) {\n  return lines.reduce((s, l) => s + l.amount, 0);\n}\n');
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', 'billing'], '2024-06-01T00:00:00Z');
  // Changed and not committed; and a new file git has not seen yet.
  write(cwd, 'src/edited.mjs', 'export function edited() { return 2; }\n');
  write(cwd, 'src/draft.mjs', 'export function draft() { return 3; }\n');
  const now = Date.now();
  when(cwd, 'src/edited.mjs', now - 60_000);
  when(cwd, 'src/draft.mjs', now);
  return cwd;
}

test('in a git repo: the files git knows, never ignored ones, old copies or vendored code; the most recently worked on first', () => {
  const cwd = messyProject();
  const files = codeFiles(cwd);
  expect(files.sort()).toEqual(['src/billing.mjs', 'src/draft.mjs', 'src/edited.mjs', 'src/old.mjs']);
  // New on disk, then changed on disk, then by how much they were worked on.
  expect(codeFiles(cwd, { max: 4 })).toEqual(['src/draft.mjs', 'src/edited.mjs', 'src/billing.mjs', 'src/old.mjs']);
  // From a folder inside the repo: its own files, named from there.
  expect(codeFiles(join(cwd, 'src'), { max: 3 })).toEqual(['draft.mjs', 'edited.mjs', 'billing.mjs']);
  // A batch of 40 practice projects added in one commit, after all of it:
  // newer, but one big commit counts little for each file in it.
  for (let i = 0; i < 40; i++) write(cwd, `evals/tasks/t${String(i).padStart(2, '0')}/project/app.mjs`, `export function task${i}() {}\n`);
  git(cwd, ['add', 'evals']);
  git(cwd, ['commit', '-q', '-m', 'practice projects'], '2025-01-01T00:00:00Z');
  expect(codeFiles(cwd)).toHaveLength(44);
  expect(codeFiles(cwd, { max: 4 })).toEqual(['src/draft.mjs', 'src/edited.mjs', 'src/billing.mjs', 'src/old.mjs']);
});

test('the project map lists the real code of a big messy folder, in the folder\'s order', () => {
  const cwd = messyProject();
  const map = repoMap(cwd);
  expect(map.entries.map((e) => e.rel)).toEqual(['src/billing.mjs', 'src/draft.mjs', 'src/edited.mjs', 'src/old.mjs']);
  expect(map.text).toStartWith('src/billing.mjs (5): invoiceTotal\n');
  expect(map.text).not.toContain('a-results');
  // Over its budget, the map keeps the most recently worked on (not the first in the folder's order).
  const small = repoMap(cwd, { maxChars: 71 });
  expect(small.text).toBe('src/draft.mjs (2)\n… and 3 more files');
});

test('the code search reads the real code of a big messy folder, a long function to its last line', async () => {
  const cwd = messyProject();
  // A long function whose end is what the request is about.
  write(cwd, 'src/report.mjs', ['export function buildReport(rows) {', ...Array.from({ length: 70 }, (_, i) => `  const column${i} = rows.map((r) => r.value${i});`), '  // save the page into the docs folder', '  return savePage(rows);', '}'].join('\n'));
  const index = new CodeIndex(cwd, new FakeEmbedder(), { dir: tmp('maps') });
  await index.build();
  expect([...new Set(index.parts.map((p) => p.rel))]).toEqual(['src/billing.mjs', 'src/draft.mjs', 'src/edited.mjs', 'src/old.mjs', 'src/report.mjs']);
  // The long function is read in pieces, but found as one part.
  expect(index.parts.filter((p) => p.name === 'buildReport').length).toBeGreaterThan(1);
  const found = await index.search('where do we save the page to the docs folder');
  expect(found.parts[0]).toMatchObject({ rel: 'src/report.mjs', name: 'buildReport', line: 1, end: 74 });
  expect(found.parts.filter((p) => p.name === 'buildReport')).toHaveLength(1);
  expect(index.wordSearch('savePage')[0]).toMatchObject({ rel: 'src/report.mjs', name: 'buildReport' });
  const billing = await index.search('the invoice total the tests check');
  expect(billing.parts[0].rel).toBe('src/billing.mjs');
});

test('outside git the folder is walked, the same code left out; old copies are read when there is nothing else', () => {
  const cwd = messyProject();
  const plain = join(tmp('plain'), 'project');
  cpSync(cwd, plain, { recursive: true });
  rmSync(join(plain, '.git'), { recursive: true });
  const files = codeFiles(plain, { max: 1000 });
  expect(files).toContain('src/billing.mjs');
  expect(files).not.toContain('archive/old-app/billing.mjs');
  expect(files).not.toContain('vendor/chart-lib.js');
  // No .gitignore to follow here: the test output is read, but after the code last touched.
  when(plain, 'src/billing.mjs', Date.now() + 60_000);
  expect(codeFiles(plain, { max: 1 })).toEqual(['src/billing.mjs']);
  // A folder of nothing but an old copy: that is the code there is.
  const only = tmp('only');
  write(only, 'archive/app.mjs', 'export function app() {}\n');
  expect(codeFiles(only)).toEqual(['archive/app.mjs']);
  // A folder git ignores as a whole, opened on its own: its own files.
  expect(codeFiles(join(cwd, 'a-results'), { max: 2 })).toHaveLength(2);
});

// The maps are a cache that only grew (54,418 files, 247 MB by 15 Oct 2026, mostly practice copies):
// a map used is touched; one not used for 30 days goes, and so does a code search index whose folder
// is gone; looked at once a day at most.
test('the maps: one used is touched and kept; one unused for 30 days, or an index of a folder that is gone, is deleted; once a day', async () => {
  const { pruneMaps, touchMap, MAP_DAYS } = await import('../src/tools/repomap.mjs');
  const dir = tmp('prune');
  const now = Date.now();
  const age = (name, days) => utimesSync(join(dir, name), new Date(now - days * 86_400_000), new Date(now - days * 86_400_000));
  const here = tmp('here');
  writeFileSync(join(dir, 'fresh.json'), '{}');
  writeFileSync(join(dir, 'old.json'), '{}');
  writeFileSync(join(dir, 'used.json'), '{}');
  writeFileSync(join(dir, 'kept.code.json'), JSON.stringify({ model: 'm', format: 2, cwd: here, files: {} }));
  writeFileSync(join(dir, 'gone.code.json'), JSON.stringify({ model: 'm', format: 2, cwd: join(here, 'deleted'), files: {} }));
  age('fresh.json', MAP_DAYS - 1);
  age('old.json', MAP_DAYS + 1);
  age('used.json', MAP_DAYS + 5);
  touchMap(join(dir, 'used.json')); // used today: its 35 days start again
  expect(pruneMaps(dir, { now })).toBe(2);
  const { readdirSync } = await import('node:fs');
  expect(readdirSync(dir).sort()).toEqual(['.pruned', 'fresh.json', 'kept.code.json', 'used.json']);
  // Once a day: within the day nothing is looked at, the next day it is.
  age('fresh.json', MAP_DAYS + 1);
  expect(pruneMaps(dir, { now: now + 3_600_000 })).toBe(0);
  expect(pruneMaps(dir, { now: now + 86_400_000 + 1000 })).toBe(1);
});

test('the project map touches its map when it reads it unchanged', async () => {
  const cwd = messyProject();
  repoMap(cwd);
  const { statSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  // This project's own map (the other tests here map copies of the same files).
  const file = join(process.env.AGENTIC_HOME, 'maps', `${createHash('sha1').update(cwd).digest('hex').slice(0, 16)}.json`);
  expect(readFileSync(file, 'utf8')).toContain('src/billing.mjs');
  const long = new Date(Date.now() - 20 * 86_400_000);
  utimesSync(file, long, long);
  repoMap(cwd);
  expect(Date.now() - statSync(file).mtimeMs).toBeLessThan(60_000);
});
