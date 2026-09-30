// Thinking old vs new (models/evals/tools/think-ab.mjs, the Arena → Thinking old vs new): the two
// runs it starts (thinking at High both times, old way first), and, from two runs already made
// (--from), its verdict against the rule written before the first run (as many passes, at least 15%
// less time), its results page in the DOCS folder and its line in the test record naming that page.
// No model: the runs are summary.json files as bench/run.mjs writes them.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const HOME = mkdtempSync(join(tmpdir(), 'agentic-think-ab-'));
const DOCS = join(HOME, 'docs');
const RECORD = join(HOME, 'record.jsonl');
const REPO = join(import.meta.dir, '..', '..');
const NODE = process.execPath.endsWith('bun') ? 'node' : process.execPath;
mkdirSync(join(DOCS, 'tests'), { recursive: true });

const run = (extra) => new Promise((ok) => {
  const child = spawn(NODE, [join(REPO, 'models/evals/tools/think-ab.mjs'), ...extra], { cwd: REPO, env: { ...process.env, AGENTIC_DOCS: DOCS, AGENTIC_TEST_RECORD: RECORD, AGENTIC_HOME: HOME } });
  let text = '';
  child.stdout.on('data', (d) => { text += d; }); child.stderr.on('data', (d) => { text += d; });
  child.on('exit', (code) => ok({ code, text }));
});
const lastLine = () => readFileSync(RECORD, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);

// Two runs of the 28 as bench/run.mjs saves them: which pass, the seconds of each, which stepped down.
const TASKS = Array.from({ length: 28 }, (_, i) => `${i + 1}-task`);
function runs(dir, { oldPass, newPass, oldSecs = 100, newSecs = 100, stepped = () => false }) {
  for (const [v, passes, secs] of [['old', oldPass, oldSecs], ['new', newPass, newSecs]]) {
    mkdirSync(join(dir, v), { recursive: true });
    const results = TASKS.map((task, i) => ({ task, thinking: true, pass: passes(i), secs, steps: 6, ownSteps: 5, modelCalls: 7, toolErrors: 0, thinkTokens: 900, steppedDown: v === 'new' && stepped(i), why: passes(i) ? '' : 'check failed' }));
    writeFileSync(join(dir, v, 'summary.json'), JSON.stringify({ thinkingWay: v, ctx: 32768, stopped: false, results }));
  }
  return dir;
}

test('it runs the Practice 28 twice at High, the old way first, each unrecorded', async () => {
  const r = await run(['--model', 'qwen', '--out', join(HOME, 'dry'), '--dry']);
  expect(r.code).toBe(0);
  const [old, now] = r.text.trim().split('\n');
  for (const [line, v] of [[old, 'old'], [now, 'new']]) {
    expect(line.startsWith(`${v}: `)).toBe(true);
    expect(line).toContain('models/evals/bench/run.mjs --model qwen --think on --effort high --set 28');
    expect(line).toContain(`--thinking ${v} --no-record`);
    expect(line).toContain(join(HOME, 'dry', v));
  }
  const picked = await run(['--model', 'gemma', '--only', '3,5', '--order', 'new,old', '--dry']);
  expect(picked.text.trim().split('\n')[0]).toMatch(/^new: .*--think on --effort high --only 3,5 .*--thinking new --no-record$/);
  expect((await run(['--model', 'gemma', '--order', 'new,new', '--dry'])).code).toBe(2);
});

test('from two runs: as many passes in at least 15% less time holds; the page names both ways and the tasks that stepped down', async () => {
  const dir = runs(join(HOME, 'holds'), { oldPass: (i) => i < 24, newPass: (i) => i < 24, oldSecs: 100, newSecs: 80, stepped: (i) => i === 27 });
  const r = await run(['--model', 'gemma', '--from', dir]);
  expect(r.code).toBe(0);
  expect(r.text).toContain('Thinking old vs new on Gemma 4 12B QAT: old 24 of 28, new 24 of 28 · HOLDS');
  const line = lastLine();
  expect(line).toMatchObject({ kind: 'tasks', name: 'Thinking old vs new', model: 'gemma', effort: 'high', passed: 24, total: 28, result: 'pass', bar: 'new passes ≥ old, ≥ 15% less time' });
  expect(line.note).toContain('stepped down: 28-task');
  const page = readFileSync(join(DOCS, line.page), 'utf8');
  expect(line.page).toMatch(/^tests\/agentic-coder-thinking-old-vs-new-gemma-\d{4}-\d\d-\d\d-\d{4}\.html$/);
  expect(page).toContain('The new way holds.');
  expect(page).toContain('"old":"Old thinking","new":"New thinking"');
  expect(page).toContain('stepped down: 1 task (28-task)');
  expect(page).toContain('Think when it pays.');
});

test('10% less time, or a pass fewer, does not hold', async () => {
  const slow = runs(join(HOME, 'slow'), { oldPass: (i) => i < 24, newPass: (i) => i < 24, oldSecs: 100, newSecs: 90 });
  const a = await run(['--model', 'qwen', '--from', slow]);
  expect(a.text).toContain('DOES NOT HOLD');
  expect(lastLine()).toMatchObject({ result: 'fail' });
  expect(readFileSync(join(DOCS, lastLine().page), 'utf8')).toContain('not 15% faster');
  const worse = runs(join(HOME, 'worse'), { oldPass: (i) => i < 24, newPass: (i) => i < 23, oldSecs: 100, newSecs: 50 });
  const b = await run(['--model', 'qwen', '--from', worse]);
  expect(b.text).toContain('DOES NOT HOLD');
  expect(readFileSync(join(DOCS, lastLine().page), 'utf8')).toContain('fewer passes');
});
