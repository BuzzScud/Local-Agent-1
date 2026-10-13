// Cache check (models/evals/tools/cache-check.mjs, the Arena → Cache check): the run it starts on the Claude API, and,
// from a run already made (--from), each reply put with its task, the rule (every reply after a task's first reads at
// least 80% from the cache), the cost with and without the cache, its results page and its line in the test record.
// No model and no money: the run is a summary.json as bench/run.mjs writes it and the replies as the cost meter keeps them.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { RUN_TESTS } from '../evals/run-tests.mjs';

const HOME = mkdtempSync(join(tmpdir(), 'agentic-cache-check-'));
const DOCS = join(HOME, 'docs');
const RECORD = join(HOME, 'record.jsonl');
const REPO = join(import.meta.dir, '..', '..');
const NODE = process.execPath.endsWith('bun') ? 'node' : process.execPath;
mkdirSync(join(DOCS, 'tests'), { recursive: true });

const run = (extra) => new Promise((ok) => {
  const child = spawn(NODE, [join(REPO, 'models/evals/tools/cache-check.mjs'), ...extra], { cwd: REPO, env: { ...process.env, AGENTIC_DOCS: DOCS, AGENTIC_TEST_RECORD: RECORD, AGENTIC_HOME: HOME } });
  let text = '';
  child.stdout.on('data', (d) => { text += d; }); child.stderr.on('data', (d) => { text += d; });
  child.on('exit', (code) => ok({ code, text }));
});
const lastLine = () => readFileSync(RECORD, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);

// Three tasks a minute apart; each reply as the cost meter keeps it ({ at, usd, sent, hit, wrote }).
const T0 = Date.parse('2026-10-13T15:00:00Z');
function made(dir, shares) {
  mkdirSync(join(dir, 'run'), { recursive: true });
  const tasks = ['31-hard', '37-hard', '39-hard'];
  writeFileSync(join(dir, 'run', 'summary.json'), JSON.stringify({ remote: { address: 'claude', model: 'claude-opus-5-5' }, ctx: 200000, stopped: false,
    results: tasks.map((task, i) => ({ task, pass: true, secs: 50, startedAt: T0 + i * 60_000, usd: 0.2 })) }));
  // the first reply of each writes 10k; the next ones send 12k, 14k… and read the share given
  const replies = tasks.flatMap((_, i) => shares[i].map((s, k) => {
    const sent = 10_000 + 2_000 * k;
    const hit = k ? Math.round(sent * s) : 0;
    return { at: T0 + i * 60_000 + 1_000 + k * 5_000, usd: 0.05, sent, hit, wrote: sent - hit };
  }));
  writeFileSync(join(dir, 'replies.json'), JSON.stringify(replies));
  return dir;
}

test('it is in the Arena, and runs three hard tasks on the Claude API under a spend name of its own, unrecorded', async () => {
  expect(RUN_TESTS.find((t) => t.id === 'cache')).toMatchObject({ name: 'Cache check', script: 'models/evals/tools/cache-check.mjs', total: 3, model: false, record: { kind: 'other', name: '^Cache check$' } });
  const r = await run(['--out', join(HOME, 'dry'), '--dry']);
  expect(r.code).toBe(0);
  expect(r.text.trim()).toMatch(/^AGENTIC_SPEND_PID=cache-check-\d{4}-\d\d-\d\d-\d{4} .*bench\/run\.mjs --remote claude --think on --only 31,37,39 --out .*dry\/run --no-record$/);
  expect((await run(['--remote-model', 'claude-sonnet-5-5', '--only', '31', '--dry'])).text).toContain('--remote claude --remote-model claude-sonnet-5-5 --think on --only 31 ');
});

test('from a run: every reply after each first at 80% or more holds; the page and the line say so, with the cost with no cache', async () => {
  const dir = made(join(HOME, 'holds'), [[0, 0.9, 0.92], [0, 0.85, 0.95, 0.97], [0, 0.88]]);
  const r = await run(['--from', dir]);
  expect(r.code).toBe(0);
  expect(r.text).toContain('PASS  31-hard  3 replies');
  expect(r.text).toMatch(/Cache check on claude-opus-5-5: 3 of 3 tasks held · 9\d% from the cache after each first reply · \$0\.45 \(about \$\d\.\d\d with no cache\) · HOLDS/);
  const line = lastLine();
  expect(line).toMatchObject({ kind: 'other', name: 'Cache check', model: 'remote:claude-opus-5-5', passed: 3, total: 3, result: 'pass' });
  expect(existsSync(join(DOCS, line.page))).toBe(true);
  const page = readFileSync(join(DOCS, line.page), 'utf8');
  expect(page).toContain('Yes: the cache works.');
  expect(page).toContain('Each reply');
  expect(page).toContain('with no cache: about $');
});

test('a reply under 80% after the first fails its task, and says which; a task of one reply cannot hold', async () => {
  const dir = made(join(HOME, 'misses'), [[0, 0.9, 0.3, 0.95], [0, 0.9], [0]]);
  const r = await run(['--from', dir]);
  expect(r.code).toBe(0);
  expect(r.text).toContain('PASS  37-hard');
  expect(r.text).toMatch(/FAIL {2}31-hard {2}4 replies, .*; under 80%: reply 3 \(30%\)/);
  expect(r.text).toContain('FAIL  39-hard  one reply only: nothing after it to read the cache');
  expect(r.text).toContain('· DOES NOT HOLD');
  expect(lastLine()).toMatchObject({ name: 'Cache check', passed: 1, total: 3, result: 'fail' });
  expect(readFileSync(join(DOCS, lastLine().page), 'utf8')).toContain('No: some replies missed the cache.');
});
