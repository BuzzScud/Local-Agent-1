// Prompt old vs new (models/evals/tools/prompt-ab.mjs, ▶ Run a test → Prompt old vs new): the two
// runs it starts, and, from two runs already made (--from), its verdict against the rule written
// before the first run, its results page in the DOCS folder and its line in the test record naming
// that page. No model: the runs are summary.json files as bench/run.mjs writes them.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { sideTotals, flips, buildPromptPage } from '../evals/tools/prompt-ab-page.mjs';

const HOME = mkdtempSync(join(tmpdir(), 'agentic-prompt-ab-'));
const DOCS = join(HOME, 'docs');
const RECORD = join(HOME, 'record.jsonl');
const REPO = join(import.meta.dir, '..', '..');
const NODE = process.execPath.endsWith('bun') ? 'node' : process.execPath;
mkdirSync(join(DOCS, 'tests'), { recursive: true });

const run = (script, extra) => new Promise((ok) => {
  const child = spawn(NODE, [join(REPO, script), ...extra], { cwd: REPO, env: { ...process.env, AGENTIC_DOCS: DOCS, AGENTIC_TEST_RECORD: RECORD, AGENTIC_HOME: HOME } });
  let text = '';
  child.stdout.on('data', (d) => { text += d; }); child.stderr.on('data', (d) => { text += d; });
  child.on('exit', (code) => ok({ code, text }));
});
const lastLine = () => readFileSync(RECORD, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);

// Two runs of the 28 as bench/run.mjs saves them: which pass, and the seconds of each.
const TASKS = Array.from({ length: 28 }, (_, i) => `${i + 1}-task`);
function runs(dir, { oldPass, newPass, oldSecs = 60, newSecs = 60, newTasks = TASKS, stopped = false }) {
  for (const [v, passes, secs, tasks] of [['old', oldPass, oldSecs, TASKS], ['new', newPass, newSecs, newTasks]]) {
    mkdirSync(join(dir, v), { recursive: true });
    const results = tasks.map((task, i) => ({ task, thinking: false, pass: passes(i), secs, steps: 6, ownSteps: 5, modelCalls: 7, toolErrors: 0, thinkTokens: null, why: passes(i) ? '' : 'check failed' }));
    writeFileSync(join(dir, v, 'summary.json'), JSON.stringify({ prompt: v, ctx: 32768, stopped: v === 'new' && stopped, results }));
  }
  return dir;
}

test('it runs the Practice 28 twice, old prompt first, each unrecorded, with the thinking asked for', async () => {
  const r = await run('models/evals/tools/prompt-ab.mjs', ['--model', 'qwen', '--think', 'on', '--out', join(HOME, 'dry'), '--dry']);
  expect(r.code).toBe(0);
  const [old, now] = r.text.trim().split('\n');
  for (const [line, v] of [[old, 'old'], [now, 'new']]) {
    expect(line.startsWith(`${v}: `)).toBe(true);
    expect(line).toContain('models/evals/bench/run.mjs --model qwen --think on --effort high --set 28');
    expect(line).toContain(`--prompt ${v} --no-record`);
    expect(line).toContain(join(HOME, 'dry', v));
  }
  const picked = await run('models/evals/tools/prompt-ab.mjs', ['--model', 'gemma', '--only', '3,5', '--order', 'new,old', '--dry']);
  expect(picked.text.trim().split('\n')[0]).toMatch(/^new: .*--think off --only 3,5 .*--prompt new --no-record$/);
  expect((await run('models/evals/tools/prompt-ab.mjs', ['--model', 'gemma', '--order', 'old,old', '--dry'])).code).toBe(2);
  // the practice runner refuses a prompt it does not know before it loads anything
  const bad = await run('models/evals/bench/run.mjs', ['--model', 'gemma', '--prompt', 'purple']);
  expect(bad.code).toBe(1); expect(bad.text).toContain('--prompt old or new, not "purple"');
});

test('from two runs: the new prompt holds with as many passes and at most 10% more time; the page and the record line say so', async () => {
  const dir = runs(join(HOME, 'holds'), { oldPass: (i) => i < 24, newPass: (i) => i < 25 || i === 26, oldSecs: 60, newSecs: 64 });
  const r = await run('models/evals/tools/prompt-ab.mjs', ['--model', 'gemma', '--from', dir]);
  expect(r.code).toBe(0);
  expect(r.text).toContain('Prompt old vs new on Gemma');
  expect(r.text).toContain('old 24 of 28, new 26 of 28 · HOLDS');
  const line = lastLine();
  expect(line).toMatchObject({ kind: 'tasks', name: 'Prompt old vs new', model: 'gemma', passed: 26, total: 28, result: 'pass', part: false, effort: 'low', ctx: 32768 });
  expect(line.note).toBe('old 24 of 28 in 1680 s · new 26 of 28 in 1792 s · fixed: 25-task, 27-task');
  expect(line.page).toMatch(/^tests\/agentic-coder-prompt-old-vs-new-gemma-\d{4}-\d\d-\d\d-\d{4}\.html$/);
  const html = readFileSync(join(DOCS, line.page), 'utf8');
  expect(html).toContain('<meta charset="utf-8">');
  expect(html).toContain('The new prompt holds.');
  expect(html).toContain('Work habits'); // the What changed tab shows the block compared
  expect(html).not.toMatch(/<(script|link)[^>]+(src|href)="https?:/); // nothing from the internet
  expect(JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'))).toMatchObject({ pass: true, full: true, moved: { fixed: ['25-task', '27-task'], broke: [] } });
});

test('fewer passes, or more than 10% slower, does not hold; a stopped run is a part run', async () => {
  const fewer = runs(join(HOME, 'fewer'), { oldPass: (i) => i < 24, newPass: (i) => i < 23 });
  expect((await run('models/evals/tools/prompt-ab.mjs', ['--model', 'qwen', '--from', fewer])).text).toContain('DOES NOT HOLD');
  expect(lastLine()).toMatchObject({ result: 'fail', passed: 23, note: 'old 24 of 28 in 1680 s · new 23 of 28 in 1680 s · broke: 24-task' });
  const slower = runs(join(HOME, 'slower'), { oldPass: (i) => i < 24, newPass: (i) => i < 24, oldSecs: 60, newSecs: 67 });
  expect((await run('models/evals/tools/prompt-ab.mjs', ['--model', 'qwen', '--from', slower])).text).toContain('DOES NOT HOLD');
  const cut = runs(join(HOME, 'cut'), { oldPass: () => true, newPass: () => true, newTasks: TASKS.slice(0, 10), stopped: true });
  const r = await run('models/evals/tools/prompt-ab.mjs', ['--model', 'qwen', '--from', cut, '--no-record']);
  expect(r.text).toContain('PART RUN');
  expect(r.text).toContain('a look only: no results page, no line in the test record');
  expect(JSON.parse(readFileSync(join(cut, 'summary.json'), 'utf8'))).toMatchObject({ full: false, pass: false, stopped: true, old: { tasks: 10 }, new: { tasks: 10 } });
});

test('the totals count only the tasks both prompts ran; the page names a task that moved either way', () => {
  const rows = [
    { task: 'a', old: { pass: false, secs: 10, ownSteps: 3 }, new: { pass: true, secs: 8, ownSteps: 2 } },
    { task: 'b', old: { pass: true, secs: 20, ownSteps: 4 }, new: { pass: false, secs: 30, ownSteps: 6 } },
    { task: 'c', old: { pass: true, secs: 40, ownSteps: 5 }, new: null },
  ];
  expect(sideTotals(rows, 'old')).toMatchObject({ tasks: 2, passed: 1, secs: 30, median: 15, ownSteps: 7 });
  expect(sideTotals(rows, 'new')).toMatchObject({ tasks: 2, passed: 1, secs: 38, thinkTokens: null }); // none reported: —, not 0
  expect(flips(rows)).toEqual({ fixed: ['a'], broke: ['b'] });
  const html = buildPromptPage({ title: 'T <x>', rows, verdict: 'v', chips: [{ text: 'passes', ok: true }] });
  expect(html).toContain('<title>T &lt;x&gt;</title>');
  expect(html).toContain('"fixed":["a"],"broke":["b"]');
});
