// Fewer steps: before vs after (models/evals/tools/steps-ab.mjs, the Arena → Fewer steps): the two runs
// it starts (before first, AGENTIC_STEPS=old), and, from two runs already made (--from), its verdict
// against the rule written before the first run (as many passes, fewer replies, at least 10% less
// working time with the service's waiting left out), its results page and its line in the test record.
// No model: the runs are summary.json files as bench/run.mjs writes them.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { RUN_TESTS } from '../evals/run-tests.mjs';

const HOME = mkdtempSync(join(tmpdir(), 'agentic-steps-ab-'));
const DOCS = join(HOME, 'docs');
const RECORD = join(HOME, 'record.jsonl');
const REPO = join(import.meta.dir, '..', '..');
const NODE = process.execPath.endsWith('bun') ? 'node' : process.execPath;
mkdirSync(join(DOCS, 'tests'), { recursive: true });

const run = (extra) => new Promise((ok) => {
  const child = spawn(NODE, [join(REPO, 'models/evals/tools/steps-ab.mjs'), '--remote', 'http://127.0.0.1:1', '--remote-model', 'Qwen3.6:35B-A3B', ...extra], { cwd: REPO, env: { ...process.env, AGENTIC_DOCS: DOCS, AGENTIC_TEST_RECORD: RECORD, AGENTIC_HOME: HOME } });
  let text = '';
  child.stdout.on('data', (d) => { text += d; }); child.stderr.on('data', (d) => { text += d; });
  child.on('exit', (code) => ok({ code, text }));
});
const lastLine = () => readFileSync(RECORD, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);

const TASKS = Array.from({ length: 10 }, (_, i) => `${30 + i}-hard`);
function runs(dir, { oldCalls, newCalls, oldSecs, newSecs, newWait = 0, newPass = () => true }) {
  for (const [side, calls, secs, wait, passes] of [['old', oldCalls, oldSecs, 0, () => true], ['new', newCalls, newSecs, newWait, newPass]]) {
    mkdirSync(join(dir, side), { recursive: true });
    const results = TASKS.map((task, i) => ({ task, thinking: true, rep: 1, pass: passes(i), secs, steps: calls, ownSteps: calls, modelCalls: calls, toolErrors: side === 'old' ? 2 : 0, time: { wait }, why: '' }));
    writeFileSync(join(dir, side, 'summary.json'), JSON.stringify({ remote: { model: 'Qwen3.6:35B-A3B' }, ctx: 120000, stopped: false, results }));
  }
  return dir;
}

test('it is in the Arena, and runs the 10 hard tasks twice, before first, thinking on, each unrecorded', async () => {
  expect(RUN_TESTS.find((t) => t.id === 'steps')).toMatchObject({ name: 'Fewer steps: before vs after', script: 'models/evals/tools/steps-ab.mjs', total: 20 });
  const r = await run(['--out', join(HOME, 'dry'), '--dry']);
  expect(r.code).toBe(0);
  const [before, after] = r.text.trim().split('\n');
  expect(before).toMatch(/^old: AGENTIC_STEPS=old .*bench\/run\.mjs --remote http:\/\/127\.0\.0\.1:1 --remote-model Qwen3\.6:35B-A3B --think on --effort high --set hard --out .*dry\/old --no-record$/);
  expect(after).toMatch(/^new: AGENTIC_STEPS=new .*--set hard --out .*dry\/new --no-record$/);
  expect((await run(['--only', '31,37', '--reps', '2', '--dry'])).text).toContain('--only 31,37 --reps 2');
  expect((await run(['--order', 'old,old', '--dry'])).code).toBe(2);
});

test('from two runs: as many passes, fewer replies and 10% less working time holds; the page and the line say so', async () => {
  // After is slower on the clock only because the service kept it waiting 30 s a task.
  const dir = runs(join(HOME, 'holds'), { oldCalls: 12, newCalls: 9, oldSecs: 100, newSecs: 110, newWait: 30 });
  const r = await run(['--from', dir]);
  expect(r.code).toBe(0);
  expect(r.text).toContain('before 10 of 10 (120 replies, 1000 s working), after 10 of 10 (90 replies, 800 s working) · HOLDS');
  const line = lastLine();
  expect(line).toMatchObject({ kind: 'tasks', name: 'Fewer steps: before vs after', model: 'remote:Qwen3.6:35B-A3B', passed: 10, total: 10, result: 'pass' });
  expect(existsSync(join(DOCS, line.page))).toBe(true);
  const page = readFileSync(join(DOCS, line.page), 'utf8');
  expect(page).toContain('Fewer steps holds');
  expect(page).toContain('waiting on the service: before 0 s · after 300 s');
});

test('fewer passes, or not 10% faster, does not hold', async () => {
  const fewer = await run(['--from', runs(join(HOME, 'fewer'), { oldCalls: 12, newCalls: 9, oldSecs: 100, newSecs: 60, newPass: (i) => i > 0 })]);
  expect(fewer.text).toContain('DOES NOT HOLD');
  expect(lastLine().result).toBe('fail');
  const slow = await run(['--from', runs(join(HOME, 'slow'), { oldCalls: 12, newCalls: 11, oldSecs: 100, newSecs: 95 })]);
  expect(slow.text).toContain('DOES NOT HOLD');
  expect(readFileSync(join(DOCS, lastLine().page), 'utf8')).toContain('not 10% faster');
});

test('a part run counts the waiting only of the tasks both sides ran', async () => {
  const dir = runs(join(HOME, 'part'), { oldCalls: 12, newCalls: 9, oldSecs: 100, newSecs: 80, newWait: 0 });
  const oldOnly = JSON.parse(readFileSync(join(dir, 'old', 'summary.json'), 'utf8'));
  oldOnly.results.push({ task: '40-extra', thinking: true, rep: 1, pass: true, secs: 829, modelCalls: 47, toolErrors: 8, time: { wait: 445 } });
  writeFileSync(join(dir, 'old', 'summary.json'), JSON.stringify(oldOnly));
  const r = await run(['--from', dir]);
  expect(r.text).toContain('before 10 of 10 (120 replies, 1000 s working)');
  expect(r.text).not.toContain('-445');
});
