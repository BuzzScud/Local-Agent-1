// ▶ Run a test (the hub's Tests tab, /test): which practice tasks a run plays (--set 28), the list of
// tests it can run and the command each starts, the Battle sets on one model (run-set.mjs), and the
// arena runner's test runs end to end in practice mode (no model): the key, the hold on the memory,
// and Stop. The hub's routes in front of it: terminal/test/hub-run.test.mjs.
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// Everything here lives in a throwaway home and on ports of its own.
const HOME = mkdtempSync(join(tmpdir(), 'agentic-run-a-test-'));
const PORT = 20000 + Math.floor(Math.random() * 20000);
process.env.AGENTIC_HOME = HOME;
process.env.AGENTIC_BATTLE_PORT = String(PORT);
process.env.AGENTIC_TEST_RECORD = join(HOME, 'record.jsonl');
const { pickTasks } = await import('../evals/bench/pick-tasks.mjs');
const { RUN_TESTS, runCommand, runCatalog, findRunTest, countLines, runTestById } = await import('../evals/run-tests.mjs');
const { holdText } = await import('../evals/battle/store.mjs');
const { readRecord } = await import('../evals/record.mjs');
const REPO = join(import.meta.dir, '..', '..');
const NODE = process.execPath.endsWith('bun') ? 'node' : process.execPath;

test('--set 28 plays the 28 that grade a model; 29, the notes page, only when named; --only picks by number', () => {
  const folders = readdirSync(join(REPO, 'models', 'evals', 'bench', 'tasks'));
  const set = pickTasks(folders, { set: 28 });
  expect(set).toHaveLength(28);
  expect(set.some((t) => t.startsWith('29-'))).toBe(false);
  expect(set.slice(0, 3)).toEqual(['1-json-flag', '10-fix-off-by-one', '11-fix-sort-text']); // the order runs have always had
  expect(pickTasks(folders)).toHaveLength(folders.filter((f) => /^\d+-/.test(f)).length);
  expect(pickTasks(folders, { only: ['29'] })).toEqual(['29-notes-page']);
  expect(pickTasks(folders, { set: 28, only: ['12', '29'] })).toEqual(['12-feature-currency']);
  expect(pickTasks([...folders, '.DS_Store'], { set: 28 })).toHaveLength(28);
  expect(() => pickTasks(folders, { set: 30 })).toThrow('no set "30"');
});

test('each test the tab can run: its script is there, its command names the model, one without a model takes none', () => {
  const models = ['gemma', 'qwen'];
  for (const t of RUN_TESTS) {
    expect(existsSync(join(REPO, t.script))).toBe(true);
    const c = runCommand(t.id, { model: 'qwen', models });
    expect(c.argv[0]).toBe(t.script);
    if (t.model) expect(c.argv.slice(1, 3)).toEqual(['--model', 'qwen']);
    else expect(c.argv).not.toContain('--model');
  }
  expect(runCommand('practice28', { model: 'gemma', models }).argv).toEqual(['models/evals/bench/run.mjs', '--model', 'gemma', '--think', 'off', '--set', '28']);
  expect(runCommand('task', { model: 'gemma', n: 12, models }).argv.slice(-2)).toEqual(['--only', '12']);
  expect(runCommand('task', { model: 'gemma', models }).n).toBe(10);
  expect(() => runCommand('task', { model: 'gemma', n: 29, models })).toThrow('a task number from 1 to 28');
  expect(() => runCommand('practice28', { model: 'bonsai', models })).toThrow('pick a model');
  expect(() => runCommand('nope', { model: 'gemma', models })).toThrow('no test "nope"');
  expect(runCommand('unit', { models }).argv).toEqual(['models/evals/tools/run-suite.mjs']);
  // Thinking on (the tab's switch): at High, in each runner's own words; a test with no model takes none.
  expect(runCommand('practice28', { model: 'gemma', think: true, models }).argv).toEqual(['models/evals/bench/run.mjs', '--model', 'gemma', '--think', 'on', '--effort', 'high', '--set', '28']);
  expect(runCommand('task', { model: 'qwen', n: 5, think: true, models }).argv.slice(-6)).toEqual(['--think', 'on', '--effort', 'high', '--only', '5']);
  expect(runCommand('requests', { model: 'gemma', think: true, models }).argv.slice(-2)).toEqual(['--think', 'on']);
  expect(runCommand('long', { model: 'gemma', think: true, models }).argv).toContain('high');
  expect(runCommand('long', { model: 'gemma', models }).argv.join(' ')).toContain('--effort low');
  expect(runCommand('work28', { model: 'gemma', think: true, models }).argv.slice(-2)).toEqual(['--think', 'on']);
  expect(runCommand('new28', { model: 'gemma', models }).argv).not.toContain('--think');
  const u = runCommand('unit', { think: true, models });
  expect([u.think, u.argv.includes('--think')]).toEqual([false, false]);
  for (const t of RUN_TESTS) expect(Boolean(t.think)).toBe(t.model);
  // What /test takes for a name.
  expect(findRunTest('practice 28')?.id).toBe('practice28');
  expect(findRunTest('Work28')?.id).toBe('work28');
  expect(findRunTest('new 28')?.id).toBe('new28');
  expect(findRunTest('unit tests')?.id).toBe('unit');
  expect(findRunTest('repo')?.id).toBe('check');
  expect(findRunTest('long')?.id).toBe('long');
  expect(findRunTest('nonsense')).toBeNull();
  // The page's copy: no functions, the command as text per model.
  const cat = runCatalog(models);
  expect(JSON.parse(JSON.stringify(cat))).toEqual(cat);
  expect(cat.find((t) => t.id === 'requests').command.qwen).toBe('node models/evals/bench/words/real.mjs --model qwen');
  expect(cat.find((t) => t.id === 'check').command.none).toBe('node models/evals/tools/check.mjs --fast');
  expect(cat.find((t) => t.id === 'requests').commandThink.qwen).toBe('node models/evals/bench/words/real.mjs --model qwen --think on');
  expect(cat.find((t) => t.id === 'check').commandThink).toBeUndefined();
  // Progress from what it printed so far.
  expect(countLines(runTestById('practice28'), ['server up', '    · Plan()', 'PASS  think=off  1-json-flag', 'FAIL  think=off  10-fix', 'thinking off: 1/2 passed'])).toEqual({ done: 2, passed: 1, total: 28 });
  expect(countLines(runTestById('requests'), ['OK   #1 [code] "hello"', 'FAIL #2 [code] "x"'])).toEqual({ done: 2, passed: 1, total: 28 });
  expect(countLines(runTestById('long'), ['anything']).done).toBeNull();
});

test('what the app says while a test run holds the memory names the test and its model', () => {
  expect(holdText({ kind: 'test', state: 'want', title: 'Practice 28 on Gemma 4 12B QAT' })).toBe('a test run is about to start (Practice 28 on Gemma 4 12B QAT)');
  expect(holdText({ kind: 'test', state: 'running', title: 'Work 28 on Qwen3.5 9B', startedAt: 1000 }, 1000 + 7 * 60_000)).toBe('a test is running (Work 28 on Qwen3.5 9B · 7 min so far)');
  expect(holdText({ kind: 'test', state: 'running', title: 'Long task on Gemma 4 12B QAT', startedAt: 1000 }, 2000)).toContain('just started');
  expect(holdText({ state: 'running', title: 'Fix a bug', run: 1, of: 2, startedAt: 0 }, 0)).toContain('a battle is running (Fix a bug · run 1 of 2');
});

const runSet = (extra, env = {}) => spawn(NODE, [join(REPO, 'models', 'evals', 'battle', 'run-set.mjs'), '--model', 'gemma', ...extra], { cwd: REPO, env: { ...process.env, AGENTIC_BATTLE_FAKE: '1', AGENTIC_BATTLE_FAKE_MS: '20', ...env } });
const collect = (child) => new Promise((ok) => { let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; }); child.on('exit', (code) => ok({ code, out })); });

test('a Battle set on one model: a line per test, the checks as the arena runs them, one line in the record (Battle sets)', async () => {
  const out = join(HOME, 'sets-a');
  const r = await collect(runSet(['--set', 'work28', '--only', 'w01,w02', '--out', out]));
  expect(r.code).toBe(0);
  expect(r.out).toContain('Gemma 4 12B QAT · Work 28 · thinking off (Low) · 2 tests, one at a time, each stops at 10 minutes · practice run: no model');
  expect(r.out).toMatch(/^(PASS|FAIL)  w01-contract-roll\s+\d+s\s+\d+ steps/m);
  expect(r.out).toMatch(/^(PASS|FAIL)  w02-tick-rounding/m);
  expect(r.out).toMatch(/Work 28 on Gemma: \d of 2 passed/);
  const sum = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
  expect(sum).toMatchObject({ model: 'gemma', set: 'work28', total: 2, stopped: false, fake: true });
  expect(existsSync(join(out, 'w01-contract-roll', 'result.json'))).toBe(true);
  const line = readRecord(join(HOME, 'record.jsonl')).find((x) => x.kind === 'sets');
  expect(line).toMatchObject({ name: 'The Work 28 (2 picked), one model', model: 'gemma', total: 2, part: true });
  expect(line.note).toContain('practice run: no model ran');
  expect(new RegExp(runTestById('work28').record.name).test(line.name)).toBe(true);
  expect((await collect(runSet(['--set', 'nope']))).code).toBe(2);
}, 60_000);

test('a Battle set with thinking on: each test is asked for it, and the record says High', async () => {
  const out = join(HOME, 'sets-think');
  const r = await collect(runSet(['--set', 'new28', '--only', 'n01', '--think', 'on', '--out', out]));
  expect(r.code).toBe(0);
  expect(r.out).toContain('· New 28 · thinking on (High) · 1 test,');
  expect(JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')).thinking).toBe(true);
  expect(JSON.parse(readFileSync(join(out, 'n01-date-one-day-early', 'result.json'), 'utf8')).thinking).toBe(true);
  const line = readRecord(join(HOME, 'record.jsonl')).find((x) => x.kind === 'sets' && x.name.startsWith('The New 28 (1 picked)'));
  expect(line.effort).toBe('high');
}, 60_000);

test('a Battle set stopped part way: the test under way is left out, the rest skipped, and the line says stopped', async () => {
  const child = runSet(['--set', 'new28', '--out', join(HOME, 'sets-b')], { AGENTIC_BATTLE_FAKE_MS: '150' });
  let seen = '';
  child.stdout.on('data', (d) => { seen += d; if (/^(PASS|FAIL|NONE)  n01/m.test(seen) && !child.stopSent) { child.stopSent = true; child.kill('SIGTERM'); } });
  const r = await collect(child);
  expect(r.code).toBe(0);
  expect(seen).toContain('stopping: the test under way saves what it has');
  const sum = JSON.parse(readFileSync(join(HOME, 'sets-b', 'summary.json'), 'utf8'));
  expect(sum.stopped).toBe(true);
  expect(sum.total).toBeLessThan(28);
  const line = readRecord(join(HOME, 'record.jsonl')).find((x) => x.kind === 'sets' && x.result === 'stopped');
  expect(line).toMatchObject({ name: 'The New 28, one model', part: true });
}, 60_000);

// ---------- The practice runner itself (run.mjs), against the app's stand-in model server ----------
// A home of its own with the stand-in as the engine and a stand-in model file: nothing real loads.
async function standInHome() {
  const { ENGINE, MODELS } = await import('../index.mjs');
  const { symlinkSync } = await import('node:fs');
  const home = mkdtempSync(join(tmpdir(), 'agentic-run-standin-'));
  mkdirSync(join(home, 'engine', ENGINE.tag), { recursive: true });
  mkdirSync(join(home, 'models'), { recursive: true });
  symlinkSync(join(REPO, 'terminal', 'test', 'fake-llama-server.mjs'), join(home, 'engine', ENGINE.tag, 'llama-server'));
  (await import('node:fs')).writeFileSync(join(home, 'models', MODELS.gemma.file), 'stand-in');
  return home;
}
const practice = (home, args, env = {}) => spawn(NODE, [join(REPO, 'models', 'evals', 'bench', 'run.mjs'), '--model', 'gemma', '--think', 'off', '--out', join(home, 'out'), ...args], { cwd: REPO, env: { ...process.env, AGENTIC_HOME: home, AGENTIC_TEST_RECORD: join(home, 'record.jsonl'), AGENTIC_HELPERS: 'off', ...env } });

test('run.mjs --only 10 on the stand-in: the task runs and is checked, and its line goes in the record as part of the set', async () => {
  const home = await standInHome();
  const r = await collect(practice(home, ['--only', '10', '--timeout', '60']));
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/^server up on http:\/\/127\.0\.0\.1:\d+, ctx 32768/m);
  expect(r.out).toMatch(/^(PASS|FAIL)  think=off  10-fix-off-by-one/m);
  expect(r.out).toContain('recorded in the test record: The 1 picked practice tasks, helpers off —');
  expect(readRecord(join(home, 'record.jsonl'))[0]).toMatchObject({ kind: 'tasks', model: 'gemma', total: 1, part: true });
}, 90_000);

test('run.mjs --set 28 on the stand-in, stopped during its first task: that task is left out, nothing is recorded, the model is stopped', async () => {
  const home = await standInHome();
  const child = practice(home, ['--set', '28', '--timeout', '120'], { FAKE_LLAMA_REPLY_MS: '20000' });
  let seen = '';
  child.stdout.on('data', (d) => { seen += d; if (/server up/.test(seen) && !child.stopSent) { child.stopSent = true; setTimeout(() => child.kill('SIGTERM'), 1500); } });
  const t0 = Date.now();
  const r = await collect(child);
  expect(r.code).toBe(0);
  expect(Date.now() - t0).toBeLessThan(30_000);
  expect(seen).toContain('stopping: the task under way ends now and the rest are skipped');
  expect(seen).not.toMatch(/^(PASS|FAIL)  /m);
  const sum = JSON.parse(readFileSync(join(home, 'out', 'summary.json'), 'utf8'));
  expect(sum).toMatchObject({ stopped: true, results: [] });
  expect(existsSync(join(home, 'record.jsonl'))).toBe(false);
  // The stand-in model server went with it: its registry entry is gone.
  await until(async () => !readdirSync(join(home, 'servers')).some((f) => f.endsWith('.json')), 10_000);
}, 90_000);

test('real.mjs on the stand-in, stopped during its first request: it says so, saves an empty run as stopped, records nothing', async () => {
  const home = await standInHome();
  const out = join(home, 'words.json');
  const child = spawn(NODE, [join(REPO, 'models', 'evals', 'bench', 'words', 'real.mjs'), '--model', 'gemma', '--only', '1,2', '--think', 'on', '--out', out], { cwd: REPO, env: { ...process.env, AGENTIC_HOME: home, AGENTIC_TEST_RECORD: join(home, 'record.jsonl'), FAKE_LLAMA_REPLY_MS: '20000' } });
  let seen = '';
  child.stdout.on('data', (d) => { seen += d; if (/server up/.test(seen) && !child.stopSent) { child.stopSent = true; setTimeout(() => child.kill('SIGTERM'), 1500); } });
  const t0 = Date.now();
  const r = await collect(child);
  expect(r.code).toBe(0);
  // Not the 20 s the stand-in holds its reply: a request already stopped is not sent (it was, for "hello").
  expect(Date.now() - t0).toBeLessThan(12_000);
  expect(seen).toContain('server up on http://127.0.0.1:');
  expect(seen).toContain('thinking on (High); 2 of the 28 requests, one at a time');
  expect(seen).toContain('stopping: the request under way ends now');
  expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({ stopped: true, total: 0 });
  expect(existsSync(join(home, 'record.jsonl'))).toBe(false);
}, 90_000);

// ---------- The arena's runner: test runs, in practice mode ----------
let runner = null;
const O = `http://127.0.0.1:${PORT}`;
const get = async (p) => (await fetch(`${O}${p}`)).json();
const key = () => readFileSync(join(HOME, 'battle', 'runner.token'), 'utf8').trim();
const post = async (p, body, headers = {}) => { const r = await fetch(`${O}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) }); return { status: r.status, body: await r.json() }; };
const until = async (fn, ms = 30_000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 120)); } };
const idle = () => until(async () => { const j = (await get('/api/testrun')).job; return !j || !['waiting', 'running'].includes(j.status); });
beforeAll(async () => {
  runner = spawn(NODE, [join(REPO, 'models', 'evals', 'battle', 'runner.mjs')], { env: { ...process.env, AGENTIC_BATTLE_FAKE: '1', AGENTIC_BATTLE_FAKE_MS: '60' }, stdio: 'ignore' });
  await until(async () => { try { return (await get('/api/ping')).ok; } catch { return false; } });
});
afterAll(() => { try { runner?.kill('SIGTERM'); } catch {} });

test('a test run needs the key the runner wrote (only this Mac\'s user can read it); a page on another address cannot start one', async () => {
  expect(statSync(join(HOME, 'battle', 'runner.token')).mode & 0o777).toBe(0o600);
  expect((await post('/api/testrun', { test: 'unit' })).status).toBe(403);
  expect((await post('/api/testrun', { test: 'unit' }, { 'x-agentic-key': 'nope', origin: O })).status).toBe(403);
  expect((await post('/api/teststop', {}, { origin: O })).status).toBe(403);
  expect((await post('/api/testrun', { test: 'nope' }, { 'x-agentic-key': key() })).body.error).toBe('no test "nope"');
  expect((await post('/api/testrun', { test: 'practice28', model: 'bonsai' }, { 'x-agentic-key': key() })).status).toBe(400);
});

test('Practice 28 on Gemma: it holds the memory as a test run (named, on its own process), prints live, counts, and ends done', async () => {
  const r = await post('/api/testrun', { test: 'practice28', model: 'gemma' }, { 'x-agentic-key': key() });
  expect(r.status).toBe(200);
  const running = await until(async () => { const s = await get('/api/testrun'); return s.job?.status === 'running' && s.job.count.done > 0 ? s : null; });
  expect(running.job).toMatchObject({ test: 'practice28', model: 'gemma', modelName: 'Gemma 4 12B QAT', name: 'Practice 28' });
  const hold = JSON.parse(readFileSync(join(HOME, 'battle', 'running.json'), 'utf8'));
  expect(hold).toMatchObject({ kind: 'test', state: 'running', title: 'Practice 28 on Gemma 4 12B QAT', pid: running.job.pid });
  expect(running.loaded).toEqual([{ model: 'Gemma 4 12B QAT', who: 'this test run' }]);
  // One at a time: a second run, and a battle, both wait for this one.
  expect((await post('/api/testrun', { test: 'unit' }, { 'x-agentic-key': key() })).status).toBe(409);
  expect((await post('/api/start', {}, { origin: O })).body.error).toBe('a test is running in the Tests tab: stop it there first');
  await idle();
  const done = (await get('/api/testrun')).job;
  expect(done.status).toBe('done');
  expect(done.count).toEqual({ done: 28, passed: done.count.passed, total: 28 });
  expect(done.lines.at(-1)).toBe('not recorded in the test record: a practice run (no model ran)');
  expect(existsSync(join(HOME, 'battle', 'running.json'))).toBe(false);
  expect(JSON.parse(readFileSync(join(HOME, 'battle', 'state.json'), 'utf8')).job.status).toBe('done');
}, 60_000);

test('thinking on: the run is asked for it, its title (and so the app\'s waiting line) says so, and a test with no model ignores it', async () => {
  expect((await post('/api/testrun', { test: 'work28', model: 'qwen', think: true }, { 'x-agentic-key': key() })).status).toBe(200);
  const s = await until(async () => { const x = await get('/api/testrun'); return x.job?.test === 'work28' && x.job.status === 'running' && x.job.lines.length ? x : null; });
  expect(s.job).toMatchObject({ model: 'qwen', think: true });
  expect(s.job.id).toMatch(/-work28-qwen-think$/);
  expect(s.job.lines[0]).toContain('thinking on (High)');
  expect(JSON.parse(readFileSync(join(HOME, 'battle', 'running.json'), 'utf8')).title).toBe('Work 28 on Qwen3.5 9B · thinking on');
  await post('/api/teststop', {}, { 'x-agentic-key': key() });
  await idle();
  await post('/api/testrun', { test: 'check', think: true }, { 'x-agentic-key': key() });
  await idle();
  expect((await get('/api/testrun')).job).toMatchObject({ test: 'check', think: false, status: 'done' });
}, 60_000);

test('Stop: the run is told to stop, saves what it has, and ends as stopped; a run with no model holds no memory', async () => {
  await post('/api/testrun', { test: 'work28', model: 'qwen' }, { 'x-agentic-key': key() });
  await until(async () => (await get('/api/testrun')).job?.count?.done >= 2);
  expect((await post('/api/teststop', {}, { 'x-agentic-key': key() })).status).toBe(200);
  expect((await get('/api/testrun')).job.stopping).toBe(true);
  await idle();
  const j = (await get('/api/testrun')).job;
  expect(j.status).toBe('stopped');
  expect(j.lines.join('\n')).toContain('stopping:');
  expect(j.count.done).toBeLessThan(28);
  expect((await post('/api/teststop', {}, { 'x-agentic-key': key() })).status).toBe(409);
  await post('/api/testrun', { test: 'unit' }, { 'x-agentic-key': key() });
  await until(async () => (await get('/api/testrun')).job?.status === 'running');
  expect(existsSync(join(HOME, 'battle', 'running.json'))).toBe(false);
  await idle();
  expect((await get('/api/testrun')).job).toMatchObject({ test: 'unit', model: null, status: 'done' });
}, 60_000);
