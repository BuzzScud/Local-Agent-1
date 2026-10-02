// Instructions: local vs remote and the Hard practice tasks (models/evals/tools/remote-rules-ab.mjs,
// 2 Oct 2026): the commands it would run, and the page and record line from runs already made.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = join(import.meta.dir, '..', '..');
const SCRIPT = join(REPO, 'models', 'evals', 'tools', 'remote-rules-ab.mjs');
const NODE = process.execPath.endsWith('bun') ? 'node' : process.execPath;
const env = (home, docs) => ({ ...process.env, AGENTIC_HOME: home, AGENTIC_DOCS: docs, AGENTIC_MEMORY_SAVE: 'off', AGENTIC_TEST_RECORD: join(home, 'record.jsonl') });
const run = (args, home, docs) => spawnSync(NODE, [SCRIPT, ...args], { cwd: REPO, env: env(home, docs), encoding: 'utf8', timeout: 60_000 });

// A side's summary.json as bench/run.mjs writes it.
function side(dir, set, name, passes, secs) {
  const n = set === 'hard' ? 10 : 28;
  const tasks = set === 'hard' ? Array.from({ length: n }, (_, i) => `${30 + i}-hard-t`) : Array.from({ length: n }, (_, i) => `${i + 1}-t`);
  mkdirSync(join(dir, set, name), { recursive: true });
  writeFileSync(join(dir, set, name, 'summary.json'), JSON.stringify({ remote: { address: 'http://svc:1', model: 'big-coder' }, ctx: 65536, stopped: false,
    results: tasks.map((task, i) => ({ task, pass: i < passes, secs: secs / n, steps: 5, why: i < passes ? '' : 'tests fail' })) }));
}

test('--dry: each set on each side, the remote ones with --instructions remote, skills off with a rules copy of its own', () => {
  const home = mkdtempSync(join(tmpdir(), 'rr-home-'));
  const r = run(['--dry', '--remote', 'http://svc:1', '--remote-model', 'big-coder'], home, join(home, 'docs'));
  expect(r.status).toBe(0);
  const lines = r.stdout.trim().split('\n');
  expect(lines.map((l) => l.split(':')[0])).toEqual(['28 local', '28 remote', '28 remote-noskills', 'hard local', 'hard remote', 'hard remote-noskills']);
  expect(lines[0]).toContain('AGENTIC_INSTRUCTIONS=local');
  expect(lines[0]).toContain('--instructions local --set 28');
  expect(lines[1]).toContain('--instructions remote --set 28');
  expect(lines[2]).toMatch(/AGENTIC_RULES_DIR=\S+agentic-rules-noskills-/);
  expect(lines[4]).toContain('--set hard');
  const hard = run(['--dry', '--remote', 'http://svc:1', '--remote-model', 'big-coder', '--sides', 'remote', '--set', 'hard'], home, join(home, 'docs'));
  expect(hard.stdout.trim().split('\n')).toHaveLength(1);
  expect(run(['--dry', '--remote', 'x', '--remote-model', 'y', '--sides', 'nope'], home, join(home, 'docs')).status).toBe(2);
});

test('--from: the remote set holds with as many passes and at most 25% more time on each set; a page and one record line', () => {
  const home = mkdtempSync(join(tmpdir(), 'rr-home-'));
  const docs = join(home, 'docs'); mkdirSync(docs);
  const out = join(home, 'runs');
  side(out, '28', 'local', 25, 800); side(out, '28', 'remote', 26, 900); side(out, '28', 'remote-noskills', 25, 850);
  side(out, 'hard', 'local', 4, 600); side(out, 'hard', 'remote', 6, 700); side(out, 'hard', 'remote-noskills', 5, 650);
  const r = run(['--from', out, '--remote', 'http://svc:1', '--remote-model', 'big-coder'], home, docs);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('HOLDS');
  const page = readdirSync(join(docs, 'tests')).find((f) => f.startsWith('agentic-coder-instructions-local-vs-remote-big-coder-'));
  expect(page).toBeTruthy();
  const html = readFileSync(join(docs, 'tests', page), 'utf8');
  expect(html).toContain('The remote instructions hold.');
  expect(html).toContain('the 10 hard tasks: remote 6 of 10, local 4 of 10');
  const rec = readFileSync(join(home, 'record.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  expect(rec).toHaveLength(1);
  expect(rec[0]).toMatchObject({ name: 'Instructions: local vs remote', model: 'remote:big-coder', passed: 32, total: 38, result: 'pass' });
  // slower than the rule allows on the hard set: it does not hold
  const slow = join(home, 'slow');
  side(slow, '28', 'local', 25, 800); side(slow, '28', 'remote', 26, 900); side(slow, '28', 'remote-noskills', 25, 850);
  side(slow, 'hard', 'local', 4, 600); side(slow, 'hard', 'remote', 6, 800); side(slow, 'hard', 'remote-noskills', 5, 650);
  const s = run(['--from', slow, '--remote', 'http://svc:1', '--remote-model', 'big-coder', '--no-record'], home, docs);
  expect(s.stdout).toContain('DOES NOT HOLD');
});

test('--sides remote --set hard: the Hard practice tasks, its own page and record line', () => {
  const home = mkdtempSync(join(tmpdir(), 'rr-home-'));
  const docs = join(home, 'docs'); mkdirSync(docs);
  const out = join(home, 'runs');
  side(out, 'hard', 'remote', 7, 700);
  const r = run(['--from', out, '--remote', 'http://svc:1', '--remote-model', 'big-coder', '--sides', 'remote', '--set', 'hard'], home, docs);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('Hard practice tasks · big-coder: the 10 hard tasks: 7 of 10 passed');
  expect(existsSync(join(docs, 'tests'))).toBe(true);
  expect(readdirSync(join(docs, 'tests')).some((f) => f.startsWith('agentic-coder-hard-tasks-big-coder-'))).toBe(true);
  const rec = JSON.parse(readFileSync(join(home, 'record.jsonl'), 'utf8').trim());
  expect(rec).toMatchObject({ name: 'Hard practice tasks', passed: 7, total: 10, result: 'fail' });
});
