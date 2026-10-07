// Claude: lean vs full (models/evals/tools/claude-lean-ab.mjs, the Arena → Claude: lean vs full): the two runs
// it starts on the Claude API (the app's checks first, AGENTIC_LEAN=off), and, from two runs already made
// (--from), its verdict (as many passes, fewer replies, at least 10% less time), what each side cost, its
// results page and its line in the test record. No model and no money: the runs are summary.json files as
// bench/run.mjs writes them.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { RUN_TESTS } from '../evals/run-tests.mjs';

const HOME = mkdtempSync(join(tmpdir(), 'agentic-claude-lean-'));
const DOCS = join(HOME, 'docs');
const RECORD = join(HOME, 'record.jsonl');
const REPO = join(import.meta.dir, '..', '..');
const NODE = process.execPath.endsWith('bun') ? 'node' : process.execPath;
mkdirSync(join(DOCS, 'tests'), { recursive: true });

const run = (extra) => new Promise((ok) => {
  const child = spawn(NODE, [join(REPO, 'models/evals/tools/claude-lean-ab.mjs'), ...extra], { cwd: REPO, env: { ...process.env, AGENTIC_DOCS: DOCS, AGENTIC_TEST_RECORD: RECORD, AGENTIC_HOME: HOME } });
  let text = '';
  child.stdout.on('data', (d) => { text += d; }); child.stderr.on('data', (d) => { text += d; });
  child.on('exit', (code) => ok({ code, text }));
});
const lastLine = () => readFileSync(RECORD, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);

const TASKS = Array.from({ length: 10 }, (_, i) => `${30 + i}-hard`);
function runs(dir, { oldCalls, newCalls, oldSecs, newSecs, newPass = () => true }) {
  for (const [side, calls, secs, passes, usd] of [['old', oldCalls, oldSecs, () => true, 0.2], ['new', newCalls, newSecs, newPass, 0.15]]) {
    mkdirSync(join(dir, side), { recursive: true });
    const results = TASKS.map((task, i) => ({ task, thinking: true, rep: 1, pass: passes(i), secs, steps: calls + 2, ownSteps: calls, modelCalls: calls, toolErrors: 0, usd, why: '' }));
    writeFileSync(join(dir, side, 'summary.json'), JSON.stringify({ remote: { address: 'claude', model: 'claude-opus-5-5' }, ctx: 200000, stopped: false, results }));
  }
  return dir;
}

test('it is in the Arena, and runs the 10 hard tasks twice on the Claude API, the app\'s checks first, each unrecorded', async () => {
  expect(RUN_TESTS.find((t) => t.id === 'claude-lean')).toMatchObject({ name: 'Claude: lean vs full', script: 'models/evals/tools/claude-lean-ab.mjs', total: 20, model: false });
  const r = await run(['--out', join(HOME, 'dry'), '--dry']);
  expect(r.code).toBe(0);
  const [full, lean] = r.text.trim().split('\n');
  expect(full).toMatch(/^old: AGENTIC_LEAN=off .*bench\/run\.mjs --remote claude --think on --set hard --out .*dry\/old --no-record$/);
  expect(lean).toMatch(/^new: AGENTIC_LEAN=on .*--set hard --out .*dry\/new --no-record$/);
  expect((await run(['--remote-model', 'claude-sonnet-5-5', '--only', '31,37', '--dry'])).text).toContain('--remote claude --remote-model claude-sonnet-5-5 --think on --only 31,37');
  expect((await run(['--order', 'old,old', '--dry'])).code).toBe(2);
});

test('from two runs: as many passes, fewer replies and 10% less time holds; the page and the line say so, with the cost', async () => {
  const dir = runs(join(HOME, 'holds'), { oldCalls: 11, newCalls: 4, oldSecs: 50, newSecs: 28 });
  const r = await run(['--from', dir]);
  expect(r.code).toBe(0);
  expect(r.text).toContain('full 10 of 10 (110 replies, 500 s, $2.00), lean 10 of 10 (40 replies, 280 s, $1.50) · HOLDS');
  const line = lastLine();
  expect(line).toMatchObject({ kind: 'tasks', name: 'Claude: lean vs full', model: 'remote:claude-opus-5-5', passed: 10, total: 10, result: 'pass' });
  expect(existsSync(join(DOCS, line.page))).toBe(true);
  const page = readFileSync(join(DOCS, line.page), 'utf8');
  expect(page).toContain('Lean holds on Claude');
  expect(page).toContain('cost: full $2.00 · lean $1.50 (less is better)');
  expect(page).toContain('steps: full 130 · lean 60 (fewer is better)');
});

test('fewer passes, or not 10% faster, does not hold', async () => {
  const fewer = await run(['--from', runs(join(HOME, 'fewer'), { oldCalls: 11, newCalls: 4, oldSecs: 50, newSecs: 28, newPass: (i) => i > 0 })]);
  expect(fewer.text).toContain('DOES NOT HOLD');
  expect(lastLine().result).toBe('fail');
  const slow = await run(['--from', runs(join(HOME, 'slow'), { oldCalls: 11, newCalls: 10, oldSecs: 50, newSecs: 48 })]);
  expect(slow.text).toContain('DOES NOT HOLD');
  expect(readFileSync(join(DOCS, lastLine().page), 'utf8')).toContain('not 10% faster');
});
