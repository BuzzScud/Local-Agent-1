// The Bonsai check (models/evals/tools/bonsai-check.mjs, 27 Oct 2026): the commands it would run, and the click
// scores, page and record line from runs already made (the pages clicked through in a real browser).
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findChrome } from '../evals/bench/tasks/29-notes-page/click-check.mjs';

const REPO = join(import.meta.dir, '..', '..');
const SCRIPT = join(REPO, 'models', 'evals', 'tools', 'bonsai-check.mjs');
const NODE = process.execPath.endsWith('bun') ? 'node' : process.execPath;
const env = (home, docs) => ({ ...process.env, AGENTIC_HOME: home, AGENTIC_DOCS: docs, AGENTIC_MEMORY_SAVE: 'off', AGENTIC_TEST_RECORD: join(home, 'record.jsonl') });
const run = (args, home, docs) => spawnSync(NODE, [SCRIPT, ...args], { cwd: REPO, env: env(home, docs), encoding: 'utf8', timeout: 120_000 });
const TASK = join(REPO, 'models', 'evals', 'bench', 'tasks', '29-notes-page');
const GOOD = readFileSync(join(TASK, 'reference', 'Desktop', 'notes.html'), 'utf8');
// Bonsai's own slip, planted in the good page: Save stores the new list and draws the old one.
const BAD = GOOD.replace('notes = [{ title: title.value.trim(), text: text.value, date }, ...notes];\n    localStorage.setItem(\'notes\', JSON.stringify(notes));', 'const all = [{ title: title.value.trim(), text: text.value, date }, ...notes];\n    localStorage.setItem(\'notes\', JSON.stringify(all));');

// A side as bench/run.mjs --keep writes it: summary.json and each run's files.
function side(dir, name, pages, passes) {
  mkdirSync(join(dir, name), { recursive: true });
  pages.forEach((html, i) => { const d = join(dir, name, `29-notes-page-think-on-rep${i + 1}-files`, 'Desktop'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'notes.html'), html); });
  writeFileSync(join(dir, name, 'summary.json'), JSON.stringify({ remote: { address: 'http://localhost:11434', model: 'bonsai-2:9b' }, ctx: 65536, reps: pages.length, stopped: false,
    results: pages.map((_, i) => ({ task: '29-notes-page', pass: i < passes, secs: 600, steps: 20, why: i < passes ? '' : 'the page fails 5 of 16 click-through checks' })) }));
}

test('the planted page really is Bonsai\'s slip', () => { expect(BAD).not.toBe(GOOD); expect(BAD).toContain('JSON.stringify(all)'); });

test('--dry: before with the remote instructions and no form pass, after on auto; both the notes page, thinking on, the page check on, kept', () => {
  const home = mkdtempSync(join(tmpdir(), 'bonsai-check-home-'));
  const r = run(['--dry'], home, join(home, 'docs'));
  expect(r.status).toBe(0);
  const [before, after, ...rest] = r.stdout.trim().split('\n');
  expect(rest).toEqual([]);
  expect(before).toMatch(/^before: AGENTIC_DESIGN=on AGENTIC_LAYOUT=on AGENTIC_LAYOUT_ASK=off AGENTIC_INSTRUCTIONS=remote AGENTIC_FORM_CHECK=off /);
  expect(before).toContain('--remote http://localhost:11434 --remote-model bonsai-2:9b --think on --instructions remote --only 29 --reps 2 --timeout 1800 --keep');
  expect(after).toMatch(/^after: AGENTIC_DESIGN=on AGENTIC_LAYOUT=on AGENTIC_LAYOUT_ASK=off \S/);
  expect(after).not.toContain('AGENTIC_FORM_CHECK');
  expect(after).toContain('--instructions auto --only 29');
  expect(run(['--dry', '--sides', 'nope'], home, join(home, 'docs')).status).toBe(2);
  expect(run(['--dry', '--reps', '0'], home, join(home, 'docs')).status).toBe(2);
});

test.skipIf(globalThis.needs('chrome', findChrome))('--from: each kept page clicked through; after holds with more click checks and runs; a page and one record line', () => {
  const home = mkdtempSync(join(tmpdir(), 'bonsai-check-home-'));
  const docs = join(home, 'docs'); mkdirSync(docs);
  const out = join(home, 'runs');
  side(out, 'before', [BAD, BAD], 0);
  side(out, 'after', [GOOD, BAD], 1);
  const r = run(['--from', out], home, docs);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('after 27 of 32 click checks, 1 of 2 runs pass · before 22 of 32 click checks, 0 of 2 runs pass · HOLDS');
  const sum = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
  expect(sum.rows[0].old.why).toMatch(/^11 of 16 click checks \(fails: card shows the title, /);
  expect(sum.rows[0].new.why).toBe('16 of 16 click checks');
  const page = readdirSync(join(docs, 'tests')).find((f) => f.startsWith('agentic-coder-bonsai-check-'));
  expect(readFileSync(join(docs, 'tests', page), 'utf8')).toContain('The new set-up holds.');
  const rec = readFileSync(join(home, 'record.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  expect(rec).toHaveLength(1);
  expect(rec[0]).toMatchObject({ name: 'Bonsai check', model: 'remote:bonsai-2:9b', passed: 1, total: 2, result: 'pass' });
  // Worse after: it does not hold.
  const worse = join(home, 'worse');
  side(worse, 'before', [GOOD, GOOD], 2);
  side(worse, 'after', [GOOD, BAD], 1);
  expect(run(['--from', worse, '--no-record'], home, docs).stdout).toContain('DOES NOT HOLD');
}, 120_000);
