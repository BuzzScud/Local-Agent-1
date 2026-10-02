// The tests the Arena and /test know by name (models/evals/run-tests.mjs): which practice tasks a run
// plays (--set 28), the list and the command each starts from Terminal, a set on one model
// (run-set.mjs), and the runs from Terminal stopped part way. The Arena's runner, which runs them from
// the page: models/test/arena.test.mjs; the hub's tab in front of it: terminal/test/hub-arena.test.mjs.
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
const { RUN_TESTS, runCommand, runCatalog, findRunTest, countLines, runTestById, practiceChoices, practiceChoice, ownCount } = await import('../evals/run-tests.mjs');
const { holdText, seedSuites, saveTest } = await import('../evals/battle/store.mjs');
const { readRecord } = await import('../evals/record.mjs');
const REPO = join(import.meta.dir, '..', '..');
const until = async (fn, ms = 30_000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 120)); } };
const NODE = process.execPath.endsWith('bun') ? 'node' : process.execPath;

test('--set 28 plays the 28 that grade a model; 29, the notes page, only when named; --only picks by number', () => {
  const folders = readdirSync(join(REPO, 'models', 'evals', 'bench', 'tasks'));
  const set = pickTasks(folders, { set: 28 });
  expect(set).toHaveLength(28);
  expect(set.some((t) => t.startsWith('29-'))).toBe(false);
  expect(set.slice(0, 3)).toEqual(['1-json-flag', '10-fix-off-by-one', '11-fix-sort-text']); // the order runs have always had
  // No --set: every task below the hard ones (1–29), as before the hard set came.
  expect(pickTasks(folders)).toHaveLength(folders.filter((f) => /^\d+-/.test(f) && Number(f.split('-')[0]) < 30).length);
  expect(pickTasks(folders).some((t) => t.startsWith('29-'))).toBe(true);
  expect(pickTasks(folders, { only: ['29'] })).toEqual(['29-notes-page']);
  expect(pickTasks(folders, { set: 28, only: ['12', '29'] })).toEqual(['12-feature-currency']);
  expect(pickTasks([...folders, '.DS_Store'], { set: 28 })).toHaveLength(28);
  expect(() => pickTasks(folders, { set: 30 })).toThrow('no set "30"');
});

test('--set hard plays the 10 hard tasks (30–39), each with its project, a reference and a check', () => {
  const folders = readdirSync(join(REPO, 'models', 'evals', 'bench', 'tasks'));
  const hard = pickTasks(folders, { set: 'hard' });
  expect(hard).toHaveLength(10);
  expect(hard.every((t) => /^3\d-hard-/.test(t))).toBe(true);
  for (const t of hard) for (const f of ['task.txt', 'check.sh', 'project', 'reference']) expect(existsSync(join(REPO, 'models', 'evals', 'bench', 'tasks', t, f))).toBe(true);
  expect(pickTasks(folders, { set: 'hard', only: ['31', '12'] })).toEqual(['31-hard-refactor-dedupe']);
});

test('each test the tab can run: its script is there, its command names the model, one without a model takes none', () => {
  const models = ['gemma', 'qwen'];
  for (const t of RUN_TESTS) {
    expect(existsSync(join(REPO, t.script))).toBe(true);
    if (t.own || t.pick?.own) continue; // My tests (all, a level, or one of them), with none yet: below
    const c = runCommand(t.id, { model: 'qwen', models });
    expect(c.argv[0]).toBe(t.script);
    if (t.model) expect(c.argv.slice(1, 3)).toEqual(['--model', 'qwen']);
    else expect(c.argv).not.toContain('--model');
  }
  expect(runCommand('practice28', { model: 'gemma', models }).argv).toEqual(['models/evals/bench/run.mjs', '--model', 'gemma', '--think', 'off', '--set', '28']);
  // One practice task: the Practice 28 test picked, as the Battle tab keeps it (run-set.mjs --set practice).
  expect(runCommand('task', { model: 'gemma', n: 12, models }).argv).toEqual(['models/evals/battle/run-set.mjs', '--model', 'gemma', '--set', 'practice', '--only', 'p12']);
  expect(runCommand('task', { model: 'gemma', n: '3', models }).argv.slice(-2)).toEqual(['--only', 'p03']);
  expect(runCommand('task', { model: 'gemma', models }).n).toBe('10');
  expect(() => runCommand('task', { model: 'gemma', n: 29, models })).toThrow('no practice test "29" (1 to 28, or a copy of yours like 18b)');
  expect(() => runCommand('task', { model: 'gemma', n: '18b', models })).toThrow('no practice test "18b"');
  // My tests: none yet, so nothing to run.
  expect(() => runCommand('mine', { model: 'gemma', models })).toThrow('you have no tests of your own yet: the Test builder (in the Arena) makes one');
  // A level of them (the Test builder sets a test's level), and one of them by its number: the same.
  expect(() => runCommand('mine-hard', { model: 'gemma', models })).toThrow('you have no Hard tests yet');
  expect(() => runCommand('mytest', { model: 'gemma', n: 1, models })).toThrow('you have no tests of your own yet');
  expect(RUN_TESTS.filter((t) => t.own).map((t) => [t.id, t.own, t.args('gemma', null, false).slice(-2)])).toEqual([['mine', true, ['--set', 'mine']], ['mine-easy', 'easy', ['--level', 'easy']], ['mine-medium', 'medium', ['--level', 'medium']], ['mine-hard', 'hard', ['--level', 'hard']]]);
  expect(findRunTest('my tests easy')?.id).toBe('mine-easy');
  expect(() => runCommand('practice28', { model: 'bonsai', models })).toThrow('pick a model');
  expect(() => runCommand('nope', { model: 'gemma', models })).toThrow('no test "nope"');
  expect(runCommand('unit', { models }).argv).toEqual(['models/evals/tools/run-suite.mjs']);
  // Thinking on (the tab's switch): at High, in each runner's own words; a test with no model takes none.
  expect(runCommand('practice28', { model: 'gemma', think: true, models }).argv).toEqual(['models/evals/bench/run.mjs', '--model', 'gemma', '--think', 'on', '--effort', 'high', '--set', '28']);
  expect(runCommand('task', { model: 'qwen', n: 5, think: true, models }).argv.slice(-4)).toEqual(['--only', 'p05', '--think', 'on']);
  expect(runCommand('requests', { model: 'gemma', think: true, models }).argv.slice(-2)).toEqual(['--think', 'on']);
  expect(runCommand('long', { model: 'gemma', think: true, models }).argv).toContain('high');
  expect(runCommand('long', { model: 'gemma', models }).argv.join(' ')).toContain('--effort low');
  expect(runCommand('work28', { model: 'gemma', think: true, models }).argv.slice(-2)).toEqual(['--think', 'on']);
  expect(runCommand('new28', { model: 'gemma', models }).argv).not.toContain('--think');
  const u = runCommand('unit', { think: true, models });
  expect([u.think, u.argv.includes('--think')]).toEqual([false, false]);
  for (const t of RUN_TESTS) if (!t.model) expect(Boolean(t.think)).toBe(false);
  // A sort writes nothing and the speed check writes with thinking off, so they never think; Thinking old vs new sets its own (High).
  // The remote check asks at Low.
  // The edited copy check asks a model and its edited copy the same questions with thinking off, so it never thinks either.
  expect(RUN_TESTS.filter((t) => t.model && !t.think).map((t) => t.id)).toEqual(['sorting', 'done', 'twoatonce', 'remote', 'vision', 'picturetokens', 'web', 'subagent', 'autoscreen', 'rulesfile', 'skills', 'lookfirst', 'habits', 'thinking', 'edited', 'modelcheck']); // done sets its own (High); the New model check sets each level itself
  const ed = runCommand('edited', { model: 'qwen', think: true, models });
  expect([ed.think, ed.argv]).toEqual([false, ['models/evals/tools/edited-check.mjs', '--model', 'qwen']]);
  expect(countLines(runTestById('edited'), ['original: loaded in 9 s', 'PASS original · 17 × 23 → "391"', 'FAIL edited · the capital of Japan → "Kyoto"', 'ASKED edited · “<start_of_turn>” (row 3): a special token or a space, nothing to write back'])).toEqual({ done: 3, passed: 1, total: null });
  const so = runCommand('sorting', { model: 'gemma', think: true, models });
  expect([so.think, so.argv]).toEqual([false, ['models/evals/tools/sort-check.mjs', '--model', 'gemma']]);
  expect(findRunTest('sorting')?.id).toBe('sorting');
  expect(countLines(runTestById('sorting'), ['loaded in 6 s', 'PASS #1 other · odds 91% · 0.61 s · "x"', 'FAIL #2 change (should be other) · odds 77% · 0.60 s · "y"', '---- #3 change · odds 76% · 0.59 s · "api"'])).toEqual({ done: 2, passed: 1, total: 82 });
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
  expect(cat.find((t) => t.id === 'task').command.gemma).toBe('node models/evals/battle/run-set.mjs --model gemma --set practice --only p10');
  expect(cat.find((t) => t.id === 'task').choices).toHaveLength(28);
  expect(cat.find((t) => t.id === 'mine')).toMatchObject({ own: true, total: 0 });
  expect(cat.find((t) => t.id === 'mine-medium')).toMatchObject({ own: true, level: 'medium', total: 0, name: 'My tests · Medium' });
  expect(cat.find((t) => t.id === 'mytest')).toMatchObject({ own: true, total: 0, choices: [], pick: { own: true, prefix: 'My test ' } });
  expect(cat.find((t) => t.id === 'task').pick.prefix).toBe('Practice test ');
  // Progress from what it printed so far.
  expect(countLines(runTestById('practice28'), ['server up', '    · Plan()', 'PASS  think=off  1-json-flag', 'FAIL  think=off  10-fix', 'thinking off: 1/2 passed'])).toEqual({ done: 2, passed: 1, total: 28 });
  expect(countLines(runTestById('requests'), ['OK   #1 [code] "hello"', 'FAIL #2 [code] "x"'])).toEqual({ done: 2, passed: 1, total: 28 });
  expect(countLines(runTestById('long'), ['anything']).done).toBeNull();
});

test('One practice task picks from the Practice 28 as the Battle tab keeps them: your copy after its original; My tests counts yours', () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-picks-'));
  expect(practiceChoices(home).map((c) => c.key).slice(0, 3)).toEqual(['1', '2', '3']); // before the arena starts: the repo's
  seedSuites(home);
  saveTest({ id: 'p18-writing-noncode-folder', title: 'A shorter story', kind: 'writing', prompt: 'Write two sentences into TEST.txt', checks: [] }, home);
  const cs = practiceChoices(home);
  expect(cs).toHaveLength(29);
  expect(cs.slice(17, 19)).toEqual([expect.objectContaining({ key: '18', only: 'p18', copy: false }), { key: '18b', only: 'p18b', title: 'A shorter story', copy: true }]);
  for (const n of ['18b', 'p18b', 'P18B', 'p18b-writing-noncode-folder']) expect(practiceChoice(n, home)?.only).toBe('p18b');
  expect(practiceChoice('01', home)?.key).toBe('1');
  expect(practiceChoice('18c', home)).toBeNull();
  expect(() => saveTest({ title: 'No check', kind: 'question', prompt: 'Which port?', checks: [] }, home)).toThrow('tick at least one check');
  saveTest({ title: 'Port', kind: 'question', prompt: 'Which port?', checks: [{ type: 'answer-has', value: '8080' }] }, home);
  expect(ownCount(home)).toBe(1);
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

test('One practice task and My tests on one model: run-set plays the pick (or every test of yours) and names its line so the tab finds it', async () => {
  const r = await collect(runSet(['--set', 'practice', '--only', 'p12', '--out', join(HOME, 'sets-p')]));
  expect(r.code).toBe(0);
  expect(r.out).toContain('Gemma 4 12B QAT · Practice 28 · thinking off (Low) · 1 test, one at a time');
  expect(r.out).toMatch(/^(PASS|FAIL|NONE)  p12-feature-currency\s/m);
  let line = readRecord(join(HOME, 'record.jsonl')).find((x) => x.kind === 'sets' && x.name.startsWith('Practice test'));
  expect(line).toMatchObject({ name: 'Practice test 12: Add a currency option to formatMoney(), one model', total: 1, part: true });
  expect(new RegExp(runTestById('task').record.name).test(line.name)).toBe(true);
  // Yours: one, with a check, so a run of it can pass or fail.
  saveTest({ title: 'Port', kind: 'question', prompt: 'Which port does it listen on?', checks: [{ type: 'answer-has', value: '8080' }] });
  expect(runCommand('mine', { model: 'gemma', models: ['gemma'] }).total).toBe(1);
  expect(runCatalog(['gemma']).find((t) => t.id === 'mine').total).toBe(1);
  const m = await collect(runSet(['--set', 'mine', '--out', join(HOME, 'sets-m')]));
  expect(m.code).toBe(0);
  expect(m.out).toContain('· My tests · thinking off (Low) · 1 test, one at a time');
  line = readRecord(join(HOME, 'record.jsonl')).find((x) => x.kind === 'sets' && x.name.startsWith('My tests'));
  expect(line).toMatchObject({ name: 'My tests, one model', total: 1, part: false });
  expect(new RegExp(runTestById('mine').record.name).test(line.name)).toBe(true);
  expect(countLines(runTestById('mine'), ['PASS  m-port-x   4s', 'x'], 3)).toEqual({ done: 1, passed: 1, total: 3 });
  // A level of yours, and one of yours by its number: each names its own line, with the level and the points.
  const hard = saveTest({ title: 'A player', kind: 'page', prompt: 'Create one HTML file for a media player.', checks: [{ type: 'page-made', value: '' }], level: 'hard' });
  expect([runCommand('mine-hard', { model: 'gemma', models: ['gemma'] }).total, runCatalog(['gemma']).find((t) => t.id === 'mine-easy').total]).toEqual([1, 0]);
  const pick = runCommand('mytest', { model: 'gemma', n: hard.n, models: ['gemma'] });
  expect([pick.n, pick.argv.slice(-2)]).toEqual([String(hard.n), ['--only', hard.id]]);
  expect(() => runCommand('mytest', { model: 'gemma', n: 99, models: ['gemma'] })).toThrow('no test of yours numbered "99"');
  expect(runCatalog(['gemma']).find((t) => t.id === 'mytest')).toMatchObject({ total: 1, choices: [{ key: '1', title: 'Port' }, { key: String(hard.n), only: hard.id, title: 'A player · Hard' }] });
  const h = await collect(runSet(['--set', 'mine', '--level', 'hard', '--out', join(HOME, 'sets-h')]));
  expect(h.code).toBe(0);
  expect(h.out).toContain('· My tests · Hard · thinking off (Low) · 1 test, one at a time, each stops at 20 minutes');
  expect(h.out).toMatch(/My tests · Hard on Gemma: \d of 1 passed · \d of 3 points/);
  line = readRecord(join(HOME, 'record.jsonl')).find((x) => x.name.startsWith('My tests · Hard'));
  expect(line).toMatchObject({ name: 'My tests · Hard, one model', total: 1, part: false, level: 'hard', points: { of: 3 } });
  expect([new RegExp(runTestById('mine-hard').record.name).test(line.name), new RegExp(runTestById('mine').record.name).test(line.name), new RegExp(runTestById('mine').record.name).test('My tests, one model'), new RegExp(runTestById('mine').record.name).test('My tests (2 picked), one model')]).toEqual([true, false, true, true]);
  const o = await collect(runSet(['--set', 'mine', '--only', hard.id, '--out', join(HOME, 'sets-o')]));
  expect(o.code).toBe(0);
  line = readRecord(join(HOME, 'record.jsonl')).find((x) => x.name.startsWith('My test '));
  expect(line).toMatchObject({ name: `My test ${hard.n}: A player, one model`, total: 1, part: true, level: 'hard' });
  expect(new RegExp(runTestById('mytest').record.name).test(line.name)).toBe(true);
  // A level is only for your own tests.
  expect((await collect(runSet(['--set', 'work28', '--level', 'easy']))).code).toBe(2);
}, 90_000);

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
  // Today's way of thinking unless --thinking old (Thinking old vs new); each task says whether it stepped down.
  expect(r.out).toMatch(/; thinking: new; who decides: app$/m);
  const sum = JSON.parse(readFileSync(join(home, 'out', 'summary.json'), 'utf8'));
  expect([sum.thinkingWay, sum.results[0].steppedDown]).toEqual(['new', false]);
  const old = await collect(practice(home, ['--only', '10', '--timeout', '60', '--thinking', 'old', '--no-record']));
  expect(old.out).toMatch(/; thinking: old; who decides: app$/m);
  expect(JSON.parse(readFileSync(join(home, 'out', 'summary.json'), 'utf8')).thinkingWay).toBe('old');
  expect((await collect(practice(home, ['--only', '10', '--thinking', 'some']))).code).toBe(1);
}, 90_000);

test('run.mjs --way model on the stand-in: no path is sorted for the task, the row, summary and record line say the model decided', async () => {
  const home = await standInHome();
  const r = await collect(practice(home, ['--only', '10', '--timeout', '60', '--way', 'model']));
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/; who decides: model$/m);
  expect(r.out).not.toContain('Plan()'); // the fix path's plan: it never ran, nothing sorted the task to it
  const sum = JSON.parse(readFileSync(join(home, 'out', 'summary.json'), 'utf8'));
  expect([sum.way, sum.results[0].way, sum.results[0].route]).toEqual(['model', 'model', 'model decides']);
  expect(readRecord(join(home, 'record.jsonl'))[0].name).toMatch(/, model decides$/);
  expect((await collect(practice(home, ['--only', '10', '--way', 'claude']))).code).toBe(1);
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

test('a run from the Tests page may be given Look first (/effort’s last row), as a named choice', async () => {
  const { cleanSettings } = await import('../evals/run-tests.mjs');
  expect(cleanSettings({ look: '30' })).toEqual({ look: '30' });
  expect(cleanSettings({ look: 30 })).toBeNull(); // a number is not one of its steps
});
