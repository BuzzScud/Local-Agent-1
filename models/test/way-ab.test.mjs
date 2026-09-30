// Who decides: App vs Model (models/evals/tools/way-ab.mjs, the Arena → Who decides): the two runs
// it starts (the app deciding first), and, from two runs already made (--from), its verdict against
// the rule written before the first run (as many passes, at most 25% more time), its results page in
// the DOCS folder and its line in the test record naming that page.
// No model: the runs are summary.json files as bench/run.mjs writes them.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { RUN_TESTS, runCommand, cleanSettings } from '../evals/run-tests.mjs';

const HOME = mkdtempSync(join(tmpdir(), 'agentic-way-ab-'));
const DOCS = join(HOME, 'docs');
const RECORD = join(HOME, 'record.jsonl');
const REPO = join(import.meta.dir, '..', '..');
const NODE = process.execPath.endsWith('bun') ? 'node' : process.execPath;
mkdirSync(join(DOCS, 'tests'), { recursive: true });

const run = (extra) => new Promise((ok) => {
  const child = spawn(NODE, [join(REPO, 'models/evals/tools/way-ab.mjs'), ...extra], { cwd: REPO, env: { ...process.env, AGENTIC_DOCS: DOCS, AGENTIC_TEST_RECORD: RECORD, AGENTIC_HOME: HOME } });
  let text = '';
  child.stdout.on('data', (d) => { text += d; }); child.stderr.on('data', (d) => { text += d; });
  child.on('exit', (code) => ok({ code, text }));
});
const lastLine = () => readFileSync(RECORD, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);

const TASKS = Array.from({ length: 28 }, (_, i) => `${i + 1}-task`);
function runs(dir, { appPass, modelPass, appSecs = 100, modelSecs = 100 }) {
  for (const [w, passes, secs] of [['app', appPass, appSecs], ['model', modelPass, modelSecs]]) {
    mkdirSync(join(dir, w), { recursive: true });
    const results = TASKS.map((task, i) => ({ task, thinking: false, pass: passes(i), secs, steps: 6, ownSteps: w === 'model' ? 6 : 3, modelCalls: w === 'model' ? 7 : 4, toolErrors: 0, route: w === 'model' ? 'model decides' : 'question', way: w, why: passes(i) ? '' : 'check failed' }));
    writeFileSync(join(dir, w, 'summary.json'), JSON.stringify({ way: w, ctx: 32768, stopped: false, results }));
  }
  return dir;
}

test('it runs the Practice 28 twice, the app deciding first, each unrecorded, thinking as the Arena says', async () => {
  const r = await run(['--model', 'qwen', '--out', join(HOME, 'dry'), '--dry']);
  expect(r.code).toBe(0);
  const [app, model] = r.text.trim().split('\n');
  for (const [line, w] of [[app, 'app'], [model, 'model']]) {
    expect(line.startsWith(`${w}: `)).toBe(true);
    expect(line).toContain('models/evals/bench/run.mjs --model qwen --think off --set 28');
    expect(line).toContain(`--way ${w} --no-record`);
    expect(line).toContain(join(HOME, 'dry', w));
  }
  const high = await run(['--model', 'gemma', '--think', 'on', '--only', '7', '--order', 'model,app', '--dry']);
  expect(high.text.trim().split('\n')[0]).toMatch(/^model: .*--think on --effort high --only 7 .*--way model --no-record$/);
  expect((await run(['--model', 'gemma', '--order', 'app,app', '--dry'])).code).toBe(2);
});

test('from two runs: as many passes in at most 25% more time holds; the page and the record line say so', async () => {
  const dir = runs(join(HOME, 'holds'), { appPass: (i) => i < 22, modelPass: (i) => i < 23, appSecs: 100, modelSecs: 120 });
  const r = await run(['--model', 'qwen', '--from', dir]);
  expect(r.code).toBe(0);
  expect(r.text).toContain('Who decides on Qwen3.5 9B: app 22 of 28, model 23 of 28 · HOLDS');
  const line = lastLine();
  expect(line).toMatchObject({ kind: 'tasks', name: 'Who decides: App vs Model', model: 'qwen', effort: 'low', passed: 23, total: 28, result: 'pass', bar: 'model passes ≥ app, ≤ 25% more time' });
  expect(line.note).toContain('fixed: 23-task');
  expect(existsSync(join(DOCS, line.page))).toBe(true);
  const page = readFileSync(join(DOCS, line.page), 'utf8');
  expect(page).toContain('Model decides holds.');
  expect(page).toContain('App decides');
  expect(page).toContain('like Claude Code');
});

test('fewer passes, or more than 25% more time, does not hold', async () => {
  const fewer = await run(['--model', 'qwen', '--no-record', '--from', runs(join(HOME, 'fewer'), { appPass: (i) => i < 22, modelPass: (i) => i < 21 })]);
  expect(fewer.text).toContain('app 22 of 28, model 21 of 28 · DOES NOT HOLD');
  const slow = await run(['--model', 'qwen', '--no-record', '--from', runs(join(HOME, 'slow'), { appPass: () => true, modelPass: () => true, appSecs: 100, modelSecs: 130 })]);
  expect(slow.text).toContain('· DOES NOT HOLD');
});

test('the Arena lists it, runs it with the Thinking switch, and its panel can set Who decides for any run', () => {
  const t = RUN_TESTS.find((x) => x.id === 'way');
  expect(t).toMatchObject({ name: 'Who decides: App vs Model', model: true, think: true, total: 56, script: 'models/evals/tools/way-ab.mjs', record: { kind: 'tasks', name: '^Who decides: App vs Model$', part: false } });
  expect(runCommand('way', { model: 'gemma', models: ['gemma', 'qwen'], think: true }).argv).toEqual(['models/evals/tools/way-ab.mjs', '--model', 'gemma', '--think', 'on']);
  expect(cleanSettings({ way: 'model', tries: 4 })).toEqual({ way: 'model', tries: 4 });
});
