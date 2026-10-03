// The Arena's runner: tests on one model, battles of two, and the checks, one model at a time.
// `/arena` (and `coding arena`) starts it when it is not up (start.mjs); it keeps going when the
// Agentic Coder window closes, and stops by itself after 2 hours with nothing to do.
//   http://127.0.0.1:8758/    the Arena page (the hub shows it in its Arena tab)
// Everything you start goes in ONE line (state.json), run one at a time, because only one model fits:
//   a test on two models    a battle (any two; Gemma and Qwen unless it names others): which model
//                           is "Model A" is picked at random (A goes first) and stays hidden until you vote
//   a test on one model     a run of it alone: no vote, the name shows
//   a check                 one of the tests in models/evals/run-tests.mjs that prints its own lines
//                           (real requests, the sorting check, the unit tests…); on two models it is
//                           two runs, one after the other
// A set (the New 28, the Work 28, the Practice 28, your own tests) goes in as its tests, one item each.
// Each run of a test stops at 10 minutes and is kept in battles/<id>/ (battle.json, A/ and B/): one
// place for every run, so any two runs of a test can be put side by side. A check's run is kept in
// runs/<id>/ (job.json, run.log). The panel's effort and changed rows go with every run.
// Each press of ▶ Run is one group (a batch, kept in state.json): its runs carry its id, so the
// page's Results step shows what that press ran, and any earlier one (/api/batches, /api/batch).
// Before a model loads, the runner holds the memory (running.json): kept-loaded models nobody
// uses are unloaded, an Agentic Coder window lets go of its model once its reply ends, and
// anything else (coding -p, a run from Terminal) is waited for.
// While Agentic Coder is connected to a service with /remote, that service's models join in
// (remote-entrants.mjs): alone or in a battle, beside the models on this Mac or against each other.
// They take no memory here, so a run on one never waits for it; the checks stay on this Mac's models.
// Only the Arena page itself may change anything (its requests carry this address as their origin).
// AGENTIC_BATTLE_FAKE=1: stand-in runs (fake-one.mjs, fake-test.mjs), no model, for the tests and previews.
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, openSync, closeSync, appendFileSync, writeFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, MODELS_DIR, DEFAULT_MODEL, modelPath, scanServers, stopIdleServers, serverProcesses, recordTest, readRecord, codeLabel, availableBytes, needBytes, freeAfterQuit, SERVER_PROCESS, HOME } from '../../index.mjs';
import { panelData } from '../../../terminal/index.mjs';
import { paths, BATTLE_PORT, LIMIT_SECS, SUITES, LEVELS, limitSecsOf, pointsOf, readJson, writeJson, seedSuites, listTests, saveTest, trashTest, resetTest, trashBattles, readBattle, listBattles, latestByTest, writeHold, clearHold, inside, runnerPid } from './store.mjs';
import { RUN_TESTS, runTestById, runCommand, countLines, cleanSettings, runCatalog } from '../run-tests.mjs';
import { labelOf } from './checks.mjs';
import { remoteEntrants, isRemoteId, parseRemoteId, connectedRemote } from './remote-entrants.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const FAKE = process.env.AGENTIC_BATTLE_FAKE === '1';
const P = paths();
const PORT = BATTLE_PORT;
const ORIGINS = [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`];
// Every model in /model can run a test alone, and any two can battle (1 Oct 2026: K2 Horizon and
// Bonsai joined Gemma and Qwen). A battle names its two (vs); one that names none is the default pair.
const IDS = Object.keys(MODELS);
const PAIR = ['gemma', 'qwen'].every((id) => MODELS[id]) ? ['gemma', 'qwen'] : IDS.slice(0, 2);
// A model's short name in a battle's record line: "Gemma vs Qwen", "K2 vs Bonsai" (a version after the name is dropped).
// A remote model (remote:<service>:<name>) is named by its entrant, else by its name on the service.
const entrantOf = (id) => remoteEntrants().find((m) => m.id === id) ?? null;
const shortOf = (id) => (isRemoteId(id) ? entrantOf(id)?.short ?? parseRemoteId(id).model : MODELS[id].name.split(' ')[0].replace(/\d+\.\d+$/, ''));
const fullNameOf = (id) => (isRemoteId(id) ? entrantOf(id)?.name ?? parseRemoteId(id).model : MODELS[id].name);
// Who may run now: a model on this Mac, or a model of the service /remote is connected to.
const canRun = (id) => IDS.includes(id) || (isRemoteId(id) && connectedRemote()?.source === parseRemoteId(id).source);
const vsOf = (v) => (Array.isArray(v) && v.length === 2 && v[0] !== v[1] && v.every(canRun) ? [...v] : PAIR);
const IDLE_EXIT_MS = Number(process.env.AGENTIC_BATTLE_IDLE_SECS ?? 7200) * 1000;
const GRACE_MS = 90_000; // a run that goes past 10 min + this (stuck loading, say) is stopped

mkdirSync(P.home, { recursive: true });
const other = runnerPid();
if (other && other !== process.pid) { console.log(`the arena is already running (pid ${other})`); process.exit(0); }
writeFileSync(P.pid, String(process.pid));
rmSync(P.token, { force: true }); // the key of the runner before the Arena: nothing reads it now
const log = (m) => appendFileSync(P.log, `${new Date().toISOString()} ${m}\n`);

// The sets: the New 28 (and its kinds), the Work 28, the Practice 28 (the 28 that came with the
// arena; a copy of yours, 18b, is a test of its own beside them), and your own tests.
const OWN = Object.keys(SUITES).filter((s) => s !== 'mine');
const SETS = {
  new28: ['New 28', (t) => t.suite === 'new28'],
  code: ['New 28 · Code', (t) => t.suite === 'new28' && t.kind === 'code'],
  question: ['New 28 · Questions', (t) => t.suite === 'new28' && t.kind === 'question'],
  page: ['New 28 · Pages', (t) => t.suite === 'new28' && t.kind === 'page'],
  writing: ['New 28 · Writing', (t) => t.suite === 'new28' && t.kind === 'writing'],
  work28: ['Work 28', (t) => t.suite === 'work28'],
  practice: ['Practice 28', (t) => t.suite === 'practice' && !t.copyOf],
  mine: ['My tests', (t) => !OWN.includes(t.suite)],
  // Your own tests of one level (the Test builder sets a test's level).
  ...Object.fromEntries(Object.entries(LEVELS).map(([lv, L]) => [`mine-${lv}`, [`My tests · ${L.name}`, (t) => !OWN.includes(t.suite) && t.level === lv]])),
};
// The checks: what ▶ Run tests could run, less the ones that are sets here.
const CHECKS = () => RUN_TESTS.filter((t) => !t.set && !t.pick);

// ---------- The line ----------
// item: { key, kind: 'test' | 'check', test, title, who: a model's id | 'both' (a battle of vs) | null, vs?: [a, b], think, settings,
//         group?, groupSet?, groupName?, groupOf? (a set's tests), pair? (a check on two models), batch? (the press of ▶ Run it came from) }
let state = readJson(P.state, {});
{
  // A line kept by the runner from before the Arena: its battles and its test runs, in that order.
  const old = [...(state.testLine ?? []).map((x) => ({ kind: 'check', test: x.test, who: x.model ?? null, think: Boolean(x.think), settings: x.settings ?? null })),
    ...(state.queue ?? []).map((id) => ({ kind: 'test', test: id, who: 'both', think: false, settings: null }))];
  state = { line: state.line ?? old.map((x, i) => ({ key: `kept-${i}`, title: x.test, ...x })), paused: Boolean(state.paused), done: state.done ?? [], job: state.job ?? null, batches: state.batches ?? [] };
}
const saveState = () => writeJson(P.state, state);
saveState();
let seq = 0;
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const newKey = () => `${stamp()}-${(seq++).toString(36)}`;
// A folder name nothing has yet: two runs of one test can start within the same second.
const freshId = (dir, base) => { let id = base; for (let n = 2; existsSync(join(dir, id)); n++) id = `${base}-${n}`; return id; };
const whoOf = (w) => { if (w === 'both' || canRun(w)) return w; if (isRemoteId(w)) throw new Error('that remote model is on a service /remote is not connected to now: connect it with /remote first'); throw new Error(`pick who runs it: ${IDS.join(', ')} or both`); };
// A battle's two models, kept on its item; a run on one model has none.
const vsFor = (who, v) => (who === 'both' ? { vs: vsOf(v) } : {});

let current = null;   // { match, test, side, child, startedAt } while a test runs
let now = null;       // the item running now
let waiting = null;   // why the next run waits, in words
let stopAsked = false;
let busy = false;
let lastUse = Date.now();

// A run left half-done by an earlier runner (the Mac slept, it was stopped) is closed.
for (const b of listBattles()) if (b.status === 'running') { b.status = 'interrupted'; writeJson(join(P.battles, b.id, 'battle.json'), b); }
clearHold();
seedSuites();
log(`runner up (pid ${process.pid})${FAKE ? ', practice mode' : ''}`);

// What the page sends → the items it means. A set becomes its tests; a check on both, two runs.
function makeItems(list) {
  const tests = listTests();
  const out = [];
  for (const b of Array.isArray(list) ? list : []) {
    const think = b.think === true;
    const settings = cleanSettings(b.settings);
    if (b.kind === 'set') {
      const S = SETS[b.id];
      if (!S) throw new Error('no such set');
      const ts = tests.filter(S[1]);
      if (!ts.length) throw new Error(`${S[0]} has no tests yet`);
      const who = whoOf(b.who), group = newKey();
      for (const t of ts) out.push({ key: newKey(), kind: 'test', test: t.id, title: t.title, who, ...vsFor(who, b.vs), think, settings, group, groupSet: b.id, groupName: S[0], groupOf: ts.length });
    } else if (b.kind === 'test') {
      const t = tests.find((x) => x.id === b.id);
      if (!t) throw new Error('no such test');
      const who = whoOf(b.who);
      out.push({ key: newKey(), kind: 'test', test: t.id, title: t.title, who, ...vsFor(who, b.vs), think, settings });
    } else if (b.kind === 'check') {
      const c = CHECKS().find((x) => x.id === b.id);
      if (!c) throw new Error('no such check');
      if (!c.model) { out.push({ key: newKey(), kind: 'check', test: c.id, title: c.name, who: null, think: false, settings: null }); continue; }
      const who = whoOf(b.who), pair = who === 'both' ? newKey() : null;
      if ((who === 'both' ? vsOf(b.vs) : [who]).some(isRemoteId)) throw new Error(`${c.name} runs on the models on this Mac only: pick one of them for it`);
      for (const m of who === 'both' ? vsOf(b.vs) : [who]) {
        const cmd = runCommand(c.id, { model: m, think, models: IDS, settings }); // throws what is wrong with it
        out.push({ key: newKey(), kind: 'check', test: c.id, title: c.name, who: m, think: cmd.think, settings: cmd.settings, ...(pair ? { pair } : {}) });
      }
    } else throw new Error('an item is a test, a set or a check');
  }
  return out;
}

// What holds a model in memory right now: [{ who }]. Kept-loaded models nobody uses are unloaded first.
function holders() {
  if (FAKE) return [];
  try { stopIdleServers(); } catch {}
  const files = Object.values(MODELS).map((m) => modelPath(m));
  const ps = spawnSync('/bin/ps', ['-Ao', 'pid=,command='], { encoding: 'utf8' }).stdout.split('\n');
  const windows = new Map(scanServers().map((e) => [e.pid, e]));
  const out = [];
  for (const line of ps) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line); if (!m || !SERVER_PROCESS.test(m[2])) continue;
    if (!files.some((f) => m[2].includes(f))) continue; // another home's (a test's) or a small helper model
    const e = windows.get(Number(m[1]));
    out.push({ pid: Number(m[1]), who: e ? 'an Agentic Coder window (it lets go of its model when its reply ends)' : 'another program (a run from Terminal, a speed test or coding -p)' });
  }
  return out;
}
// modelId: the model about to load (need: the bytes a check with a big model of its own needs, its
// `memory`). A model just stopped hands its memory back to the Mac over up to a minute, so once
// nothing holds a model the runner also waits (at most 90 s) until there is room.
async function waitForMemory(title, run, of, modelId, kind = 'battle', need = null) {
  writeHold({ pid: process.pid, state: 'want', kind, title, run, of, startedAt: Date.now() });
  let freeSince = null;
  for (;;) {
    if (stopAsked) return false;
    const h = holders();
    if (!h.length) {
      freeSince ??= Date.now();
      let room = true;
      if (!FAKE) { try { room = availableBytes() >= (need ?? needBytes(MODELS[modelId], 32768, { draft: false })); } catch {} }
      if (room || Date.now() - freeSince > 90_000) { waiting = null; return true; }
      waiting = 'Waiting for memory: the last model is still giving its memory back to the Mac.';
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    freeSince = null;
    const why = `Waiting for memory: ${[...new Set(h.map((x) => x.who))].join(' and ')} has a model loaded, and two do not fit.`;
    if (why !== waiting) log(why);
    waiting = why;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// ---------- A test: on two models (a battle) or on one ----------
function runOne(test, modelId, out, match, side, item) {
  const limit = match.limit;
  return new Promise((done) => {
    mkdirSync(out, { recursive: true });
    const fd = openSync(join(out, 'run.log'), 'w');
    const env = { ...process.env }; delete env.FORCE_COLOR; delete env.AGENTIC_TEST_SETTINGS;
    if (item.settings) env.AGENTIC_TEST_SETTINGS = JSON.stringify(item.settings);
    const script = join(HERE, FAKE ? 'fake-one.mjs' : 'run-one.mjs');
    const child = spawn(process.execPath, [script, '--model', modelId, '--test', join(P.tests, test.id), '--out', out, '--timeout', String(limit), ...(item.think ? ['--think', 'on'] : [])], { cwd: REPO, env, detached: true, stdio: ['ignore', fd, fd] });
    closeSync(fd);
    current = { match: match.id, test: test.id, side, child, startedAt: Date.now() };
    const guard = setTimeout(() => { log(`${match.id} ${side}: past the limit, stopping it`); try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, limit * 1000 + GRACE_MS + (FAKE ? 0 : 60_000) + (isRemoteId(modelId) && !FAKE ? 15 * 60_000 : 0)); // a big model on a service can take minutes to load
    child.on('exit', (code, sig) => {
      clearTimeout(guard);
      current = null;
      const r = readJson(join(out, 'result.json'));
      if (r) return done(r);
      let tail = '';
      try { tail = readFileSync(join(out, 'run.log'), 'utf8').trim().split('\n').slice(-3).join(' · '); } catch {}
      done({ model: modelId, pass: false, error: `the run ended without a result (${code ?? sig})${tail ? `: ${tail.slice(0, 300)}` : ''}`, stopped: stopAsked, secs: 0, steps: [], stepCount: 0, errors: 0, answer: '', diffs: [], pages: [], checks: [] });
    });
  });
}

const clean = (r) => r && !r.skipped && !r.stopped && !r.overLimit && !r.error;
const passed = (r) => Boolean(clean(r) && r.pass === true);
const effortOf = (x) => (x.think ? 'high' : 'low');
const suiteName = (t) => SUITES[OWN.includes(t.suite) ? t.suite : 'mine'];
async function runMatch(item) {
  const test = listTests().find((t) => t.id === item.test);
  if (!test) { log(`${item.test}: no such test now; left out`); return null; }
  const both = item.who === 'both';
  const vs = vsOf(item.vs);
  const order = both ? (Math.random() < 0.5 ? [vs[0], vs[1]] : [vs[1], vs[0]]) : [item.who];
  const b = { id: freshId(P.battles, `${stamp()}-${test.id}`.slice(0, 90)), test: test.id, title: test.title, kind: test.kind, at: new Date().toISOString(), mode: both ? 'battle' : 'solo',
    order: both ? { A: order[0], B: order[1] } : { A: order[0] }, think: Boolean(item.think), settings: item.settings ?? null, group: item.group ?? null, key: item.key, batch: item.batch ?? null,
    // Each run's time limit: a battle stops each side at 10 minutes; a test on one model at its own (a test of yours: its level's, Easy 5, Medium 10, Hard 20).
    limit: both ? LIMIT_SECS : limitSecsOf(test), status: 'running', runs: {}, vote: null };
  const save = () => writeJson(join(P.battles, b.id, 'battle.json'), b);
  save();
  log(`${b.mode} ${b.id} started`);
  const sides = both ? ['A', 'B'] : ['A'];
  const holdTitle = both ? test.title : `${test.title} on ${fullNameOf(order[0])}`;
  for (const [i, side] of sides.entries()) {
    // A remote model takes no memory on this Mac: it neither waits for it nor holds it.
    const here = !isRemoteId(order[i]);
    if (stopAsked || (here && !(await waitForMemory(holdTitle, i + 1, sides.length, order[i], both ? 'battle' : 'test')))) { b.runs[side] = { skipped: true }; continue; }
    if (here) writeHold({ pid: process.pid, state: 'running', kind: both ? 'battle' : 'test', test: test.id, title: holdTitle, run: i + 1, of: sides.length, startedAt: Date.now() });
    else clearHold();
    b.runs[side] = await runOne(test, order[i], join(P.battles, b.id, side), b, side, item);
    save();
  }
  clearHold();
  b.status = stopAsked ? 'stopped' : 'done';
  b.ended = new Date().toISOString();
  save();
  log(`${b.mode} ${b.id} ${b.status}`);
  // The test record. A battle's line names no model (the vote is blind); a run on one model that
  // is part of a set is counted in the set's own line, when the set ends.
  if (!FAKE) try {
    const rs = sides.map((s) => b.runs[s]).filter((r) => r && !r.skipped);
    const secs = Math.round(rs.reduce((s, r) => s + (r.secs ?? 0), 0));
    const base = { code: codeLabel(REPO), effort: effortOf(item), ctx: item.settings?.context ?? 32768, secs, part: true, raw: join(P.battles, b.id), ...(item.settings ? { settings: item.settings } : {}) };
    if (both) recordTest({ ...base, kind: 'other', name: `Battle · ${test.title} (${vs.map(shortOf).join(' vs ')}, 1 run each)`, passed: rs.filter(passed).length, total: 2, result: b.status === 'stopped' ? 'stopped' : rs.filter(passed).length === 2 ? 'pass' : 'fail', note: 'which model did what: the Arena, once you vote' });
    else if (!item.group && rs.length) recordTest({ ...base, kind: 'sets', model: order[0], name: `${test.suite === 'practice' ? `Practice test ${test.n}${test.variant ?? ''}` : OWN.includes(test.suite) ? `${suiteName(test)} test ${test.n}` : `My test ${test.n ?? test.id}`}: ${test.title}, one model`, passed: rs.filter(passed).length, total: 1, result: b.status === 'stopped' ? 'stopped' : undefined,
      // A test of yours is worth its level's points (Easy 1, Medium 2, Hard 3).
      ...(pointsOf(test) ? { level: test.level, points: { got: rs.filter(passed).length ? pointsOf(test) : 0, of: pointsOf(test) }, note: `${rs.filter(passed).length ? pointsOf(test) : 0} of ${pointsOf(test)} points` } : {}) });
  } catch (e) { log(`record: ${e.message}`); }
  return { match: b.id, status: b.status };
}
// A set on one model ended: its one line in the record, from the runs made for it. The Practice 28
// continue the line the graded run kept ("The 28 practice tasks…"), so the record's grid goes on.
function recordGroup(item) {
  if (FAKE) return;
  try {
    const ms = listBattles().filter((b) => b.group === item.group && b.mode === 'solo');
    const rs = ms.map((b) => b.runs.A).filter((r) => r && !r.skipped);
    if (!rs.length) return;
    const failed = ms.filter((b) => b.runs.A && !b.runs.A.skipped && !passed(b.runs.A)).map((b) => b.test);
    const whole = rs.length === item.groupOf;
    // Your own tests: each passed one is worth its level's points (Easy 1, Medium 2, Hard 3), as run-set.mjs counts them.
    const metas = new Map(listTests().map((t) => [t.id, t]));
    const ran = ms.filter((b) => b.runs.A && !b.runs.A.skipped);
    const of = ran.reduce((n, b) => n + pointsOf(metas.get(b.test)), 0);
    const points = /^mine/.test(item.groupSet) && of ? { got: ran.filter((b) => passed(b.runs.A)).reduce((n, b) => n + pointsOf(metas.get(b.test)), 0), of } : null;
    recordTest({ kind: item.groupSet === 'practice' ? 'tasks' : 'sets', model: item.who, code: codeLabel(REPO), effort: effortOf(item), ctx: item.settings?.context ?? 32768,
      name: item.groupSet === 'practice' ? `The ${rs.length} practice tasks, in the Arena` : `${/^mine/.test(item.groupSet) ? item.groupName : `The ${item.groupName}`}${whole ? '' : ` (${rs.length} run)`}, one model`,
      passed: rs.filter(passed).length, total: rs.length, secs: Math.round(rs.reduce((s, r) => s + (r.secs ?? 0), 0)), part: !whole, result: whole ? undefined : 'stopped',
      ...(points ? { points, level: item.groupSet.startsWith('mine-') ? item.groupSet.slice(5) : null } : {}),
      note: [points ? `${points.got} of ${points.of} points` : '', failed.length ? `failed: ${failed.join(', ')}` : ''].filter(Boolean).join(' · '), raw: P.battles, ...(item.settings ? { settings: item.settings } : {}) });
  } catch (e) { log(`record: ${e.message}`); }
}

// ---------- A check: one of run-tests.mjs's, on one model (or none) ----------
// job: the check running now or the last one, kept in state.json so the page still shows it after a restart.
//   { id, key, test, name, total, model, modelName, think, settings, pair, status: 'waiting' | 'running' | 'done' | 'failed' | 'stopped' | 'interrupted',
//     startedAt, runStartedAt, endedAt, pid, dir, result: { done, passed, total, code, recorded } }
let job = state.job ?? null;
let jobChild = null;
const jobLive = () => Boolean(job && (job.status === 'waiting' || job.status === 'running'));
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
// The checks are started with node where there is one (the tools' own runtime: `node models/evals/…`).
const NODE = (() => { if (basename(process.execPath) === 'node') return process.execPath; const r = spawnSync('/usr/bin/which', ['node'], { encoding: 'utf8' }); return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : process.execPath; })();
const linesOf = (dir) => { try { return readFileSync(join(dir, 'run.log'), 'utf8').replace(/\r/g, '').split('\n'); } catch { return []; } };
const saveJob = () => { if (!job) return; state.job = job; saveState(); try { writeJson(join(job.dir, 'job.json'), job); } catch {} };
function finishJob(code) {
  const t = runTestById(job.test);
  const lines = linesOf(job.dir);
  const rec = [...lines].reverse().find((l) => l.startsWith('recorded in the test record: '));
  job.endedAt = Date.now();
  job.status = job.stopAsked ? 'stopped' : code === 0 ? 'done' : 'failed';
  job.secs = Math.round((job.endedAt - (job.runStartedAt ?? job.startedAt)) / 1000);
  job.result = { ...(t ? countLines(t, lines, job.total ?? t.total) : {}), code: code ?? null, recorded: rec ? rec.slice('recorded in the test record: '.length) : null };
  if (job.status !== 'stopped' && code !== 0) job.result.why = lines.filter((l) => l.trim()).slice(-3).join(' · ').slice(0, 300);
  delete job.stopAsked;
  saveJob();
  log(`check ${job.id} ${job.status}${code != null ? ` (exit ${code})` : ''}`);
}
const jobTitle = (j) => `${j.name}${j.model ? ` on ${j.modelName}` : ''}${j.think ? ' · thinking on' : ''}`;
async function runCheck(item) {
  const cmd = runCommand(item.test, { model: item.who, think: item.think, models: IDS, settings: item.settings });
  const t = cmd.test;
  const id = freshId(P.runs, `${stamp()}-${t.id}${t.model ? `-${item.who}` : ''}${cmd.think ? '-think' : ''}${cmd.settings ? '-set' : ''}`);
  job = { id, key: item.key, test: t.id, name: t.name, total: cmd.total ?? null, model: t.model ? item.who : null, modelName: t.model ? MODELS[item.who].name : null, think: cmd.think, settings: cmd.settings, pair: item.pair ?? null, batch: item.batch ?? null, status: 'waiting', startedAt: Date.now(), dir: join(P.runs, id) };
  const title = jobTitle(job);
  mkdirSync(job.dir, { recursive: true });
  saveJob();
  // A check with a big model of its own (its `memory`) holds the memory too, though it takes none of /model.
  const holds = Boolean(t.model || t.memory);
  if (holds && !(await waitForMemory(title, 1, 1, job.model, 'test', t.model ? null : t.memory))) { job.stopAsked = true; finishJob(null); return { job: job.id, status: job.status }; }
  const fd = openSync(join(job.dir, 'run.log'), 'w');
  const env = { ...process.env, ...cmd.env }; delete env.FORCE_COLOR;
  if (!cmd.settings) delete env.AGENTIC_TEST_SETTINGS;
  const argv = FAKE ? [join(HERE, 'fake-test.mjs'), '--test', t.id, '--model', job.model ?? 'none', '--think', job.think ? 'on' : 'off'] : [join(REPO, cmd.argv[0]), ...cmd.argv.slice(1)];
  const child = spawn(FAKE ? process.execPath : NODE, argv, { cwd: REPO, env, detached: true, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  jobChild = child;
  job.pid = child.pid; job.status = 'running'; job.runStartedAt = Date.now();
  // The hold names the check's own process: it lasts as long as the run, even past this runner.
  if (holds) writeHold({ pid: child.pid, state: 'running', kind: 'test', test: t.id, title, startedAt: job.runStartedAt });
  if (!FAKE) { try { spawn('caffeinate', ['-i', '-w', String(child.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {} }
  saveJob();
  log(`check ${job.id} started (pid ${child.pid}): ${argv.map((a) => a.replace(`${REPO}/`, '')).join(' ')}`);
  const code = await new Promise((ok) => child.on('exit', (c, sig) => ok(c ?? (sig ? 128 : null))));
  jobChild = null;
  finishJob(code);
  return { job: job.id, status: job.status };
}
function stopJob() {
  job.stopAsked = true;
  const t = runTestById(job.test);
  const pid = jobChild?.pid ?? job.pid;
  if (pid && alive(pid)) {
    // A check that takes a model stops itself (its own model too) and saves what it has; one that
    // takes none is stopped with everything it started. Either way, a minute later nothing is left.
    try { process.kill(t?.model ? pid : -pid, t?.stop ?? 'SIGTERM'); } catch {}
    setTimeout(() => { if (alive(pid)) { log(`check ${job?.id}: still going a minute after Stop, ending it`); try { process.kill(-pid, 'SIGKILL'); } catch {} } }, 60_000);
  }
}
// A check left going by an earlier runner (it was restarted): followed until its process ends.
if (jobLive()) {
  if (job.status === 'running' && alive(job.pid)) {
    busy = true;
    now = { key: job.key, kind: 'check', test: job.test, title: job.name, who: job.model, think: job.think, settings: job.settings, startedAt: job.runStartedAt };
    if (job.model || runTestById(job.test)?.memory) writeHold({ pid: job.pid, state: 'running', kind: 'test', test: job.test, title: jobTitle(job), startedAt: job.runStartedAt });
    log(`check ${job.id} still going (pid ${job.pid}): following it`);
    const follow = setInterval(() => {
      if (alive(job.pid)) return;
      clearInterval(follow);
      finishJob(linesOf(job.dir).some((l) => l.startsWith('recorded in the test record: ')) ? 0 : null);
      ended(now, { job: job.id, status: job.status });
      busy = false; now = null; clearHold(); setTimeout(tick, 500);
    }, 2000);
  } else { job.status = 'interrupted'; job.endedAt = Date.now(); saveJob(); }
}
const jobView = (j, lines) => {
  const t = runTestById(j.test);
  const ls = lines ?? linesOf(j.dir);
  while (ls.length && !ls[ls.length - 1].trim()) ls.pop();
  return { ...j, dir: undefined, stopAsked: undefined, stopping: Boolean(j.stopAsked), waiting: j.status === 'waiting' ? (waiting ?? 'Getting the memory ready…') : null,
    lines: ls.slice(-400), lineCount: ls.length, count: t ? countLines(t, ls, j.total ?? t.total) : null, now: Date.now() };
};
// Every check run kept on this Mac, newest first: [{ id, test, model, think, settings, status, result, secs, endedAt }].
function listJobs() {
  let ids = [];
  try { ids = readdirSync(P.runs).sort().reverse().slice(0, 300); } catch { return []; }
  return ids.map((id) => readJson(join(P.runs, id, 'job.json'))).filter((j) => j && j.id);
}

// ---------- One at a time ----------
function ended(item, res) {
  state.done = [{ key: item.key, kind: item.kind, test: item.test, title: item.title, who: item.who, think: Boolean(item.think), settings: item.settings ?? null, group: item.group ?? null, pair: item.pair ?? null, endedAt: Date.now(), ...(res ?? { status: 'failed' }) }, ...state.done].slice(0, 80);
  saveState();
  // The last test of a set on one model: the set's line in the record (not when you stopped it part way with more waiting).
  if (item.group && item.who !== 'both' && !state.line.some((x) => x.group === item.group)) recordGroup(item);
}
function tick() {
  if (busy) return;
  if (!state.line.length || state.paused) {
    if (!state.line.length && Date.now() - lastUse > IDLE_EXIT_MS) { log('idle for a long time: stopping'); rmSync(P.pid, { force: true }); process.exit(0); }
    return;
  }
  const item = state.line.shift();
  saveState();
  busy = true; stopAsked = false; lastUse = Date.now();
  now = { ...item, startedAt: Date.now() };
  let res = null;
  (item.kind === 'check' ? runCheck(item) : runMatch(item)).then((r) => { res = r; }).catch((e) => { log(`${item.kind} ${item.test}: ${e.stack ?? e.message}`); if (jobLive()) finishJob(null); })
    .finally(() => {
      ended(item, res);
      busy = false; current = null; waiting = null; now = null; jobChild = null;
      if (!job?.pid || !alive(job.pid)) clearHold();
      if (stopAsked) { state.paused = state.line.length > 0; saveState(); }
      stopAsked = false; lastUse = Date.now();
      setTimeout(tick, 500);
    });
}
setInterval(tick, 1500);

// ---------- What the page reads ----------
const brief = (r) => r && { pass: r.pass, stopped: Boolean(r.stopped), overLimit: Boolean(r.overLimit), skipped: Boolean(r.skipped), error: r.error ?? null, secs: r.secs ?? 0, stepCount: r.stepCount ?? 0, errors: r.errors ?? 0 };
// Names only once you voted, or where there never was a vote (a run on one model).
const open = (b) => b.mode === 'solo' || Boolean(b.vote);
const reveal = (b) => (open(b) ? b.order : null);
// What holds a model now, for the page's "Loaded now" line. Read only: nothing is stopped or unloaded.
function loadedNow() {
  if (FAKE) return current ? [{ model: 'a stand-in', who: 'this run' }] : jobLive() && job.status === 'running' && job.model ? [{ model: job.modelName, who: 'this run' }] : [];
  const reg = new Map();
  try { for (const f of readdirSync(join(HOME, 'servers'))) { if (!f.endsWith('.json')) continue; const e = readJson(join(HOME, 'servers', f)); if (e?.pid) reg.set(e.pid, e); } } catch {}
  const ps = spawnSync('/bin/ps', ['-Ao', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout.split('\n');
  const out = [];
  for (const line of ps) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line); if (!m || !SERVER_PROCESS.test(m[3])) continue;
    const model = Object.values(MODELS).find((x) => m[3].includes(modelPath(x)));
    if (!model) continue;
    const e = reg.get(Number(m[1]));
    const users = e?.linger ? (() => { try { return readdirSync(join(HOME, 'servers', `${e.port}.users`)).map(Number).filter(alive); } catch { return []; } })() : [];
    const who = busy && !e ? 'this run' : e?.linger ? (users.length ? 'an Agentic Coder window' : 'kept loaded after a window closed') : 'another program (a run from Terminal or coding -p)';
    out.push({ model: model.name, who });
  }
  return out;
}
// The control panel: /effort's rows for each model on this Mac, with what a run will have free (free
// now, plus what the model servers loaded now give back: the runner frees them first). Kept 10 s.
let panelCache = null;
function runPanel() {
  if (panelCache && Date.now() - panelCache.at < 10_000) return panelCache.data;
  let freeBytes = null;
  try { const servers = serverProcesses(); freeBytes = servers.length ? freeAfterQuit({ free: availableBytes(), servers }, []) : availableBytes(); } catch {}
  const here = IDS.map((id) => MODELS[id]).filter((m) => FAKE || existsSync(join(MODELS_DIR, m.file)));
  panelCache = { at: Date.now(), data: { free: freeBytes, models: panelData(here.length ? here : [MODELS[DEFAULT_MODEL]], { freeBytes }) } };
  return panelCache.data;
}
// Each check's last line in the record, per model (kept 5 s: the page asks every second while something runs).
let recCache = null;
function checkRows() {
  if (recCache && Date.now() - recCache.at < 5000) return recCache.rows;
  let rec = [];
  try { rec = readRecord(); } catch {}
  const cat = runCatalog(IDS);
  const rows = CHECKS().map((c) => {
    const re = new RegExp(c.record.name);
    const mine = rec.filter((r) => r.kind === c.record.kind && re.test(r.name) && Boolean(r.part) === Boolean(c.record.part) && r.result !== 'stopped');
    const last = (m) => { const r = mine.find((x) => (c.model ? x.model === m : !x.model)); return r ? { at: r.at, passed: r.passed, total: r.total, result: r.result, secs: r.secs, effort: r.effort ?? null, page: r.page || '', bar: r.bar || '', grade: r.grade } : null; };
    const e = cat.find((x) => x.id === c.id);
    return { id: c.id, name: c.name, what: c.what, model: c.model, think: Boolean(c.think), total: e?.total ?? c.total ?? null, minutes: c.minutes ?? null, command: e?.command ?? {}, commandThink: e?.commandThink ?? null,
      last: c.model ? Object.fromEntries(IDS.map((m) => [m, last(m)])) : { none: last(null) } };
  });
  recCache = { at: Date.now(), rows };
  return rows;
}
function view() {
  const tests = listTests(); const all = listBattles(); const latest = latestByTest(all);
  // The last run of each test on each model that may be named: a run on one model, or a battle you voted on.
  const last = {}; const lastBattle = {};
  for (const b of all) {
    if (b.status === 'running') continue;
    if (b.mode !== 'solo') lastBattle[b.test] = b;
    if (!open(b)) continue;
    for (const side of Object.keys(b.runs ?? {})) { const r = b.runs[side]; if (r && !r.skipped) (last[b.test] ??= {})[b.order[side]] = { match: b.id, side, at: b.at, think: Boolean(b.think), ...brief(r) }; }
  }
  const remotes = remoteEntrants();
  const score = { votes: Object.fromEntries(IDS.map((id) => [id, 0])), ties: 0, passes: Object.fromEntries(IDS.map((id) => [id, 0])), battles: 0 };
  for (const b of Object.values(lastBattle)) {
    score.battles += 1;
    // A battle counts for a model only once you voted: before that, who passed would give the names away.
    if (!b.vote) continue;
    // A remote model has its own count too (from 0: it may not be in the list now).
    for (const side of ['A', 'B']) if (passed(b.runs[side])) score.passes[b.order[side]] = (score.passes[b.order[side]] ?? 0) + 1;
    if (b.vote === 'T') score.ties += 1; else score.votes[b.order[b.vote]] = (score.votes[b.order[b.vote]] ?? 0) + 1;
  }
  const running = now ? { key: now.key, kind: now.kind, test: now.test, title: now.title, who: now.who, vs: now.who === 'both' ? vsOf(now.vs) : null, think: Boolean(now.think), group: now.group ?? null, groupName: now.groupName ?? null, groupOf: now.groupOf ?? null, pair: now.pair ?? null, batch: now.batch ?? null, startedAt: now.startedAt,
    match: current?.match ?? null, side: current?.side ?? null, sideStartedAt: current?.startedAt ?? null, job: now.kind === 'check' && job ? job.id : null, waiting: !current && !(jobLive() && job.status === 'running') ? (waiting ?? 'Getting the memory ready…') : null } : null;
  return {
    // Every model in /model, and whether its file is here (only those can run); the battle a pick of none means.
    // The remote ones after them, while /remote is connected (remote: true, short: their short name).
    models: [...IDS.map((id) => ({ id, name: MODELS[id].name, here: FAKE || existsSync(join(MODELS_DIR, MODELS[id].file)) })), ...remotes], pair: PAIR, limit: LIMIT_SECS, fake: FAKE, paused: state.paused, waiting,
    line: state.line, running, done: state.done.slice(0, 40), loaded: loadedNow(), batch: state.batches[0]?.id ?? null,
    sets: ['new28', 'work28', 'practice', 'mine', ...Object.keys(LEVELS).map((lv) => `mine-${lv}`)].map((id) => ({ id, name: SETS[id][0], ids: tests.filter(SETS[id][1]).map((t) => t.id), ...(id.startsWith('mine-') ? { level: id.slice(5) } : {}) })).filter((x) => !x.level || x.ids.length),
    checks: checkRows(), panel: runPanel(), score,
    tests: tests.map((t) => { const b = latest[t.id], bt = lastBattle[t.id];
      return { id: t.id, n: t.n ?? null, variant: t.variant ?? null, copyOf: t.copyOf ?? null, suite: t.suite, title: t.title, kind: t.kind, level: t.level ?? null, limit: limitSecsOf(t), prompt: t.prompt, checks: (t.checks ?? []).map((c) => ({ ...c, label: labelOf(c) })), hasScript: t.hasScript, noScript: Boolean(t.noScript), edited: t.edited ?? null, rules: t.rules ?? null, ask: t.answers?.[0]?.reply ?? '', files: t.files,
        latest: b ? { id: b.id, at: b.at, status: b.status, mode: b.mode ?? 'battle', vote: b.vote, order: reveal(b), runs: Object.fromEntries(Object.entries(b.runs ?? {}).map(([s, r]) => [s, brief(r)])) } : null,
        toVote: bt && bt.status === 'done' && !bt.vote ? bt.id : null, last: last[t.id] ?? {} }; }),
  };
}
function matchView(id) {
  const b = readBattle(id);
  if (!b) return null;
  const out = { ...b, mode: b.mode ?? 'battle', order: reveal(b) };
  if (current?.match === id) {
    let ev = [];
    try { ev = readFileSync(join(P.battles, id, current.side, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch {}
    out.live = { side: current.side, startedAt: current.startedAt, events: ev };
  }
  return out;
}
// Every run of a test that may be named, newest first: what "put a run beside it" picks from.
function runsOf(testId) {
  const out = [];
  for (const b of listBattles().reverse()) {
    if (b.test !== testId || b.status === 'running' || !open(b)) continue;
    for (const side of Object.keys(b.runs ?? {})) { const r = b.runs[side]; if (r && !r.skipped) out.push({ match: b.id, side, model: b.order[side], at: b.at, mode: b.mode ?? 'battle', think: Boolean(b.think), settings: b.settings ?? null, ...brief(r) }); }
  }
  return out;
}

// ---------- The groups: each press of ▶ Run ----------
// A group's items as they stand: waiting, running, or what each run came to (a battle's names only once you voted).
function batchView(bt, all = listBattles(), jobs = listJobs()) {
  const byKey = new Map(all.filter((b) => b.batch === bt.id).map((b) => [b.key, b]));
  const jobByKey = new Map(jobs.filter((j) => j.batch === bt.id).map((j) => [j.key, j]));
  const waitingKeys = new Set(state.line.filter((x) => x.batch === bt.id).map((x) => x.key));
  const items = bt.items.map((it) => {
    const running = now?.key === it.key;
    const base = { key: it.key, kind: it.kind, test: it.test, title: it.title, who: it.who, vs: it.vs ?? null };
    if (it.kind === 'check') {
      const j = jobByKey.get(it.key);
      if (running || (j && (j.status === 'waiting' || j.status === 'running'))) return { ...base, state: 'running', job: j?.id ?? null };
      if (j) return { ...base, state: 'done', job: j.id, status: j.status, result: j.result ?? null, secs: j.secs ?? null, model: j.model ?? null };
      return { ...base, state: waitingKeys.has(it.key) ? 'waiting' : 'left' };
    }
    const b = byKey.get(it.key);
    if (running || b?.status === 'running') return { ...base, state: 'running', match: b?.id ?? current?.match ?? null };
    if (b) return { ...base, state: 'done', match: b.id, mode: b.mode ?? 'battle', status: b.status, vote: b.vote ?? null, order: reveal(b), runs: Object.fromEntries(Object.entries(b.runs ?? {}).map(([s, r]) => [s, brief(r)])) };
    return { ...base, state: waitingKeys.has(it.key) ? 'waiting' : 'left' };
  });
  const ran = items.filter((x) => x.state === 'done');
  const runsOk = (x) => (x.kind === 'check' ? x.status === 'done' && (x.result?.done == null || x.result.passed === x.result.done) : Object.values(x.runs ?? {}).filter((r) => r && !r.skipped).every(passed) && Object.values(x.runs ?? {}).some((r) => r && !r.skipped));
  return { id: bt.id, name: bt.name, at: bt.at, who: bt.who, vs: bt.vs ?? null, think: bt.think, settings: bt.settings ?? null, ask: bt.ask, count: items.length,
    done: ran.length, passed: ran.filter(runsOk).length, waiting: items.filter((x) => x.state === 'waiting').length,
    status: items.some((x) => x.state === 'running') ? 'running' : items.some((x) => x.state === 'waiting') ? (state.paused ? 'paused' : 'waiting') : items.some((x) => x.state === 'left') || ran.some((x) => x.status === 'stopped') ? 'stopped' : 'done', items };
}
function batchesView() {
  const all = listBattles(), jobs = listJobs();
  return state.batches.map((bt) => { const v = batchView(bt, all, jobs); delete v.items; delete v.ask; return v; });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req, max = 30e6) => new Promise((ok) => { const parts = []; let n = 0; req.on('data', (c) => { n += c.length; if (n > max) req.destroy(); else parts.push(c); }); req.on('end', () => { try { ok(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { ok({}); } }); });

http.createServer(async (req, res) => {
  lastUse = Date.now();
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'GET') {
      if (url.pathname === '/' || url.pathname === '/index.html') return send(res, 200, readFileSync(join(HERE, 'arena.html'), 'utf8'), 'text/html; charset=utf-8');
      if (url.pathname === '/api/ping') return send(res, 200, { ok: true, pid: process.pid, fake: FAKE, arena: true });
      if (url.pathname === '/api/state') return send(res, 200, view());
      if (url.pathname === '/api/match' || url.pathname === '/api/battle') { const b = matchView(url.searchParams.get('id') ?? ''); return b ? send(res, 200, b) : send(res, 404, { error: 'no such run' }); }
      if (url.pathname === '/api/runs') return send(res, 200, { runs: runsOf(url.searchParams.get('test') ?? '') });
      if (url.pathname === '/api/batches') return send(res, 200, { batches: batchesView() });
      if (url.pathname === '/api/batch') { const bt = state.batches.find((x) => x.id === url.searchParams.get('id')); return bt ? send(res, 200, batchView(bt)) : send(res, 404, { error: 'no such group' }); }
      if (url.pathname === '/api/jobs') { const t = url.searchParams.get('test') ?? ''; return send(res, 200, { jobs: listJobs().filter((j) => j.test === t && !(jobLive() && j.id === job.id)).slice(0, 40).map((j) => ({ id: j.id, test: j.test, model: j.model ?? null, think: Boolean(j.think), settings: j.settings ?? null, status: j.status, result: j.result ?? null, secs: j.secs ?? null, endedAt: j.endedAt ?? null, pair: j.pair ?? null })), live: jobLive() && job.test === t ? jobView(job) : null }); }
      if (url.pathname === '/api/job') { const id = url.searchParams.get('id') ?? ''; if (job && job.id === id) return send(res, 200, jobView(job)); const dir = inside(P.runs, id); const j = dir && readJson(join(dir, 'job.json')); return j ? send(res, 200, jobView({ ...j, dir })) : send(res, 404, { error: 'no such run' }); }
      // A page a model made: /files/<run>/<A|B>/<its path>
      const m = /^\/files\/([^/]+)\/(A|B)\/(.+)$/.exec(url.pathname);
      if (m) { const base = inside(P.battles, m[1]); const f = base && inside(join(base, m[2], 'files'), decodeURIComponent(m[3])); if (f && existsSync(f) && statSync(f).isFile()) return send(res, 200, readFileSync(f), TYPES[extname(f).toLowerCase()] ?? 'application/octet-stream'); return send(res, 404, 'not found', 'text/plain'); }
      return send(res, 404, { error: 'not found' });
    }
    // Only this page may change anything: another site's page cannot.
    if (!ORIGINS.includes(req.headers.origin)) return send(res, 403, { error: 'wrong origin' });
    const body = await readBody(req);
    switch (url.pathname) {
      // Into the line: tests, sets and checks, each with who runs it and the panel's settings.
      case '/api/line': {
        const items = makeItems(body.items);
        if (!items.length) return send(res, 400, { error: 'nothing picked to run' });
        // One press of ▶ Run is one group: its name (the page's words, or the first item's), who, the effort and the settings.
        const first = (Array.isArray(body.items) ? body.items : [])[0] ?? {};
        const batch = { id: newKey(), name: String(body.name ?? '').trim().slice(0, 80) || (items.length === 1 ? items[0].title : `${items.length} runs`), at: new Date().toISOString(), who: first.who ?? null, vs: first.who === 'both' ? vsOf(first.vs) : null,
          think: first.think === true, settings: cleanSettings(first.settings), ask: body.items, items: items.map((x) => ({ key: x.key, kind: x.kind, test: x.test, title: x.title, who: x.who, ...(x.vs ? { vs: x.vs } : {}) })) };
        for (const x of items) x.batch = batch.id;
        state.batches = [batch, ...state.batches].slice(0, 60);
        state.line.push(...items); state.paused = false; saveState(); tick();
        log(`line: ${items.length} added (${state.line.length} waiting)`);
        return send(res, 200, { ok: true, added: items.length, keys: items.map((x) => x.key), batch: batch.id });
      }
      case '/api/unqueue': { const n = state.line.length; state.line = state.line.filter((x) => x.key !== body.key && (!body.group || x.group !== body.group)); saveState(); return send(res, 200, { ok: true, removed: n - state.line.length }); }
      case '/api/clearline': {
        // A set on one model cut short here keeps what it ran: its line in the record (the one running now records itself when it ends).
        const cut = state.line.filter((x) => x.group && x.who !== 'both' && x.group !== now?.group);
        state.line = []; state.paused = false; saveState(); log('the line was cleared');
        for (const g of new Set(cut.map((x) => x.group))) recordGroup(cut.find((x) => x.group === g));
        return send(res, 200, { ok: true });
      }
      case '/api/stop': {
        if (!busy) return send(res, 409, { error: 'nothing is running' });
        stopAsked = true;
        if (jobLive()) stopJob();
        if (current?.child) { const pid = current.child.pid; try { process.kill(-pid, 'SIGTERM'); } catch {} setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} }, 10_000); }
        state.paused = state.line.length > 0; saveState(); log('stopped by you');
        return send(res, 200, { ok: true });
      }
      case '/api/resume': state.paused = false; saveState(); tick(); return send(res, 200, { ok: true });
      case '/api/vote': {
        const b = readBattle(String(body.id ?? ''));
        if (!b || b.status === 'running' || b.mode === 'solo' || !['A', 'B', 'T'].includes(body.v)) return send(res, 400, { error: 'cannot vote on that' });
        b.vote = body.v; b.votedAt = new Date().toISOString();
        writeJson(join(P.battles, b.id, 'battle.json'), b);
        return send(res, 200, { ok: true, order: b.order });
      }
      case '/api/tests': {
        const meta = saveTest({ id: body.id ?? null, title: body.title, kind: body.kind, prompt: body.prompt, checks: body.checks ?? [], ask: body.ask ?? '', files: body.files ?? [], removeFiles: Boolean(body.removeFiles), removePaths: body.removePaths ?? [], useScript: body.useScript ?? null });
        return send(res, 200, { ok: true, id: meta.id, n: meta.n ?? null, variant: meta.variant ?? null, copyOf: meta.copyOf ?? null });
      }
      case '/api/tests/reset': { resetTest(String(body.id ?? '')); return send(res, 200, { ok: true }); }
      case '/api/clearresults': {
        if (busy) return send(res, 409, { error: 'something is running: stop it first' });
        const n = trashBattles(); log(`results cleared (${n} runs moved to trash)`);
        // The groups go too, but for one still waiting in the line.
        state.batches = state.batches.filter((bt) => state.line.some((x) => x.batch === bt.id)); saveState();
        return send(res, 200, { ok: true, moved: n });
      }
      case '/api/tests/delete': { trashTest(String(body.id ?? '')); state.line = state.line.filter((x) => !(x.kind === 'test' && x.test === body.id)); saveState(); return send(res, 200, { ok: true }); }
      default: return send(res, 404, { error: 'not found' });
    }
  } catch (e) { log(`${req.method} ${url.pathname}: ${e.message}`); return send(res, 400, { error: e.message }); }
}).listen(PORT, '127.0.0.1', () => log(`serving http://127.0.0.1:${PORT}/`)).on('error', (e) => { log(`cannot listen on ${PORT}: ${e.message}`); rmSync(P.pid, { force: true }); process.exit(1); });

// A check keeps going (its hold names its own process; the next runner follows it).
const bye = () => { if (current?.child) { try { process.kill(-current.child.pid, 'SIGTERM'); } catch {} } if (!(jobLive() && job.status === 'running' && alive(job.pid))) clearHold(); rmSync(P.pid, { force: true }); process.exit(0); };
process.on('SIGTERM', bye);
process.on('SIGINT', bye);
