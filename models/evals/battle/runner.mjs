// The Battle arena's runner: Gemma vs Qwen, one model at a time. `/battle` (and `coding battle`)
// starts it when it is not up (start.mjs); it keeps going when the Agentic Coder window closes,
// and stops by itself after 2 hours with nothing to do.
//   http://127.0.0.1:8758/    the Battle page (the hub shows it in its Battle tab)
// A battle = one test, both models, one after the other: which model is "Model A" is picked at
// random each time (A goes first) and stays hidden until you vote. Each run stops at 10 minutes.
// Before a model loads, the runner holds the memory (running.json): kept-loaded models nobody
// uses are unloaded, an Agentic Coder window lets go of its model once its reply ends, and
// anything else (a practice-test run, coding -p) is waited for. Only one model is ever loaded.
// AGENTIC_BATTLE_FAKE=1: stand-in runs (fake-one.mjs), no model, for the tests and previews.
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, openSync, closeSync, appendFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, modelPath, scanServers, stopIdleServers, recordTest, codeLabel, availableBytes, needBytes } from '../../index.mjs';
import { battleHome, paths, BATTLE_PORT, LIMIT_SECS, readJson, writeJson, seedSuites, listTests, saveTest, trashTest, resetTest, trashBattles, readBattle, listBattles, latestByTest, writeHold, clearHold, inside, runnerPid } from './store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const FAKE = process.env.AGENTIC_BATTLE_FAKE === '1';
const P = paths();
const PORT = BATTLE_PORT;
const ORIGINS = [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`];
const IDS = ['gemma', 'qwen'].every((id) => MODELS[id]) ? ['gemma', 'qwen'] : Object.keys(MODELS).slice(0, 2);
const IDLE_EXIT_MS = Number(process.env.AGENTIC_BATTLE_IDLE_SECS ?? 7200) * 1000;
const GRACE_MS = 90_000; // a run that goes past 10 min + this (stuck loading, say) is stopped

mkdirSync(P.home, { recursive: true });
const other = runnerPid();
if (other && other !== process.pid) { console.log(`the arena is already running (pid ${other})`); process.exit(0); }
writeFileSync(P.pid, String(process.pid));
const log = (m) => appendFileSync(P.log, `${new Date().toISOString()} ${m}\n`);

let state = readJson(P.state, { queue: [], paused: false });
// The header's Load and Battle (design A, 29 Sep 2026): you load one test or a set, and Battle
// puts what is loaded in line in place of whatever waited there. state.loaded is what is loaded;
// state.batch the tests the last Battle put in line ("Test 2 of 5"). A set is the New 28, one
// kind of them, the Work 28, the Practice 28 (with your copies, 18b…), or your own tests.
const OWN = ['new28', 'work28', 'practice'];
const SETS = {
  new28: ['All New 28', (t) => t.suite === 'new28'],
  code: ['New 28 · Code', (t) => t.suite === 'new28' && t.kind === 'code'],
  question: ['New 28 · Questions', (t) => t.suite === 'new28' && t.kind === 'question'],
  page: ['New 28 · Pages', (t) => t.suite === 'new28' && t.kind === 'page'],
  writing: ['New 28 · Writing', (t) => t.suite === 'new28' && t.kind === 'writing'],
  work28: ['All Work 28', (t) => t.suite === 'work28'],
  practice: ['All Practice 28', (t) => t.suite === 'practice'],
  mine: ['My tests', (t) => !OWN.includes(t.suite)],
};
const loadedNow = () => state.loaded ?? { kind: 'set', id: 'new28' };
const saveState = () => writeJson(P.state, state);
let current = null;   // { battle, side, child, startedAt, loading }
let waiting = null;   // why the next run waits, in words
let stopAsked = false;
let busy = false;
let lastUse = Date.now();

// A battle left half-done by an earlier runner (the Mac slept, it was stopped) is closed.
for (const b of listBattles()) if (b.status === 'running') { b.status = 'interrupted'; writeJson(join(P.battles, b.id, 'battle.json'), b); }
clearHold();
seedSuites();
log(`runner up (pid ${process.pid})${FAKE ? ', practice mode' : ''}`);

// What holds a model in memory right now: [{ who }]. Kept-loaded models nobody uses are unloaded first.
function holders() {
  if (FAKE) return [];
  try { stopIdleServers(); } catch {}
  const files = Object.values(MODELS).map((m) => modelPath(m));
  const ps = spawnSync('/bin/ps', ['-Ao', 'pid=,command='], { encoding: 'utf8' }).stdout.split('\n');
  const windows = new Map(scanServers().map((e) => [e.pid, e]));
  const out = [];
  for (const line of ps) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line); if (!m || !/(^|\/)llama-server\s/.test(m[2])) continue;
    if (!files.some((f) => m[2].includes(f))) continue; // another home's (a test's) or a small helper model
    const e = windows.get(Number(m[1]));
    out.push({ pid: Number(m[1]), who: e ? 'an Agentic Coder window (it lets go of its model when its reply ends)' : 'another program (a practice-test run, a speed test or coding -p)' });
  }
  return out;
}
// modelId: the model about to load. A model just stopped hands its memory back to the Mac over up to
// a minute, so once nothing holds a model the runner also waits (at most 90 s) until there is room.
async function waitForMemory(title, run, modelId) {
  writeHold({ pid: process.pid, state: 'want', title, run, of: 2, startedAt: Date.now() });
  let freeSince = null;
  for (;;) {
    if (stopAsked) return false;
    const h = holders();
    if (!h.length) {
      freeSince ??= Date.now();
      let room = true;
      if (!FAKE) { try { room = availableBytes() >= needBytes(MODELS[modelId], 32768, { draft: false }); } catch {} }
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

function runOne(test, modelId, out, battle, side) {
  return new Promise((done) => {
    mkdirSync(out, { recursive: true });
    const fd = openSync(join(out, 'run.log'), 'w');
    const env = { ...process.env }; delete env.FORCE_COLOR;
    const script = join(HERE, FAKE ? 'fake-one.mjs' : 'run-one.mjs');
    const child = spawn(process.execPath, [script, '--model', modelId, '--test', join(P.tests, test.id), '--out', out, '--timeout', String(LIMIT_SECS)], { cwd: REPO, env, detached: true, stdio: ['ignore', fd, fd] });
    closeSync(fd);
    current = { battle: battle.id, test: test.id, side, child, startedAt: Date.now() };
    const guard = setTimeout(() => { log(`${battle.id} ${side}: past the limit, stopping it`); try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, LIMIT_SECS * 1000 + GRACE_MS + (FAKE ? 0 : 60_000));
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

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
async function runBattle(testId) {
  const test = listTests().find((t) => t.id === testId);
  if (!test) return;
  const order = Math.random() < 0.5 ? [IDS[0], IDS[1]] : [IDS[1], IDS[0]];
  const b = { id: `${stamp()}-${testId}`.slice(0, 90), test: test.id, title: test.title, kind: test.kind, at: new Date().toISOString(), order: { A: order[0], B: order[1] }, status: 'running', runs: {}, vote: null };
  const save = () => writeJson(join(P.battles, b.id, 'battle.json'), b);
  save();
  log(`battle ${b.id} started`);
  for (const [i, side] of ['A', 'B'].entries()) {
    if (stopAsked || !(await waitForMemory(test.title, i + 1, order[i]))) { b.runs[side] = { skipped: true }; continue; }
    writeHold({ pid: process.pid, state: 'running', test: test.id, title: test.title, run: i + 1, of: 2, startedAt: Date.now() });
    b.runs[side] = await runOne(test, order[i], join(P.battles, b.id, side), b, side);
    save();
  }
  clearHold();
  b.status = stopAsked ? 'stopped' : 'done';
  b.ended = new Date().toISOString();
  save();
  log(`battle ${b.id} ${b.status}`);
  // The test record gets a line, without the models' names (the vote is blind).
  if (!FAKE) try {
    const rs = [b.runs.A, b.runs.B].filter((r) => r && !r.skipped);
    const passed = rs.filter((r) => r.pass && !r.overLimit && !r.stopped).length;
    recordTest({ kind: 'other', name: `Battle · ${test.title} (Gemma vs Qwen, 1 run each, Low)`, code: codeLabel(REPO), effort: 'low', ctx: 32768, passed, total: 2, secs: Math.round(rs.reduce((s, r) => s + (r.secs ?? 0), 0)), result: b.status === 'stopped' ? 'stopped' : passed === 2 ? 'pass' : 'fail', part: true, note: 'which model did what: the Battle tab, once you vote', raw: join(P.battles, b.id) });
  } catch (e) { log(`record: ${e.message}`); }
}

function tick() {
  if (busy) return;
  if (!state.queue.length || state.paused) {
    if (!state.queue.length && Date.now() - lastUse > IDLE_EXIT_MS) { log('idle for a long time: stopping'); rmSync(P.pid, { force: true }); process.exit(0); }
    return;
  }
  const id = state.queue.shift();
  saveState();
  busy = true; stopAsked = false;
  lastUse = Date.now();
  runBattle(id).catch((e) => log(`battle ${id}: ${e.stack ?? e.message}`)).finally(() => { busy = false; current = null; waiting = null; clearHold(); lastUse = Date.now(); if (stopAsked) { state.paused = true; saveState(); } stopAsked = false; setTimeout(tick, 500); });
}
setInterval(tick, 1500);

// ---------- What the page reads ----------
const clean = (r) => r && !r.skipped && !r.stopped && !r.overLimit && !r.error;
const brief = (r) => r && { pass: r.pass, stopped: Boolean(r.stopped), overLimit: Boolean(r.overLimit), skipped: Boolean(r.skipped), error: r.error ?? null, secs: r.secs ?? 0, stepCount: r.stepCount ?? 0, errors: r.errors ?? 0 };
// Names only once you voted: before that the page knows A and B, never which is which.
const reveal = (b) => (b.vote ? b.order : null);
function view() {
  const tests = listTests(); const latest = latestByTest(listBattles());
  const score = { votes: Object.fromEntries(IDS.map((id) => [id, 0])), ties: 0, passes: Object.fromEntries(IDS.map((id) => [id, 0])), battles: 0 };
  for (const b of Object.values(latest)) {
    if (b.status === 'running') continue;
    score.battles += 1;
    for (const side of ['A', 'B']) if (clean(b.runs[side]) && b.runs[side].pass) score.passes[b.order[side]] += 1;
    if (b.vote === 'T') score.ties += 1; else if (b.vote) score.votes[b.order[b.vote]] += 1;
  }
  return {
    models: IDS.map((id) => ({ id, name: MODELS[id].name })), limit: LIMIT_SECS, fake: FAKE, paused: state.paused, queue: state.queue, waiting,
    loaded: loadedNow(), batch: (state.batch ?? []).filter((id) => tests.some((t) => t.id === id)),
    sets: Object.entries(SETS).map(([id, [name, has]]) => ({ id, name, ids: tests.filter(has).map((t) => t.id) })).filter((x) => x.ids.length),
    running: current ? { battle: current.battle, test: current.test, side: current.side, startedAt: current.startedAt } : busy && waiting ? { waiting: true } : null,
    score,
    tests: tests.map((t) => { const b = latest[t.id]; return { id: t.id, n: t.n ?? null, variant: t.variant ?? null, copyOf: t.copyOf ?? null, suite: t.suite, title: t.title, kind: t.kind, prompt: t.prompt, checks: t.checks ?? [], hasScript: t.hasScript, noScript: Boolean(t.noScript), edited: t.edited ?? null, rules: t.rules ?? null, ask: t.answers?.[0]?.reply ?? '', files: t.files, latest: b ? { id: b.id, at: b.at, status: b.status, vote: b.vote, order: reveal(b), runs: { A: brief(b.runs.A), B: brief(b.runs.B) } } : null }; }),
  };
}
function battleView(id) {
  const b = readBattle(id);
  if (!b) return null;
  const out = { ...b, order: reveal(b) };
  if (current?.battle === id) {
    let ev = [];
    try { ev = readFileSync(join(P.battles, id, current.side, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch {}
    out.live = { side: current.side, startedAt: current.startedAt, events: ev };
  }
  return out;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req, max = 30e6) => new Promise((ok) => { const parts = []; let n = 0; req.on('data', (c) => { n += c.length; if (n > max) req.destroy(); else parts.push(c); }); req.on('end', () => { try { ok(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { ok({}); } }); });

http.createServer(async (req, res) => {
  lastUse = Date.now();
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'GET') {
      if (url.pathname === '/' || url.pathname === '/index.html') return send(res, 200, readFileSync(join(HERE, 'battle.html'), 'utf8'), 'text/html; charset=utf-8');
      if (url.pathname === '/api/ping') return send(res, 200, { ok: true, pid: process.pid, fake: FAKE });
      if (url.pathname === '/api/state') return send(res, 200, view());
      if (url.pathname === '/api/battle') { const b = battleView(url.searchParams.get('id') ?? ''); return b ? send(res, 200, b) : send(res, 404, { error: 'no such battle' }); }
      // A page a model made: /files/<battle>/<A|B>/<its path>
      const m = /^\/files\/([^/]+)\/(A|B)\/(.+)$/.exec(url.pathname);
      if (m) { const base = inside(P.battles, m[1]); const f = base && inside(join(base, m[2], 'files'), decodeURIComponent(m[3])); if (f && existsSync(f) && statSync(f).isFile()) return send(res, 200, readFileSync(f), TYPES[extname(f).toLowerCase()] ?? 'application/octet-stream'); return send(res, 404, 'not found', 'text/plain'); }
      return send(res, 404, { error: 'not found' });
    }
    // Only this page may change anything: another site's page cannot.
    if (!ORIGINS.includes(req.headers.origin)) return send(res, 403, { error: 'wrong origin' });
    const body = await readBody(req);
    const tests = () => listTests();
    switch (url.pathname) {
      case '/api/run': {
        if (!tests().some((t) => t.id === body.id)) return send(res, 400, { error: 'no such test' });
        if (!state.queue.includes(body.id) && current?.test !== body.id) state.queue.push(body.id);
        state.paused = false; saveState(); tick();
        return send(res, 200, { ok: true });
      }
      case '/api/runall': {
        const latest = latestByTest(listBattles());
        const suite = tests().filter((t) => t.suite === (body.suite ?? 'new28'));
        let pick = suite.filter((t) => !latest[t.id] || latest[t.id].status !== 'done');
        if (!pick.length) pick = suite;
        for (const t of pick) if (!state.queue.includes(t.id) && current?.test !== t.id) state.queue.push(t.id);
        state.paused = false; saveState(); tick();
        return send(res, 200, { ok: true, queued: pick.length });
      }
      // Load: what the header's Load button holds. Nothing starts.
      case '/api/load': {
        const kind = body.kind === 'test' ? 'test' : 'set';
        if (kind === 'set' ? !SETS[body.id] : !tests().some((t) => t.id === body.id)) return send(res, 400, { error: 'no such test or set' });
        state.loaded = { kind, id: String(body.id) }; saveState();
        return send(res, 200, { ok: true });
      }
      // Battle: what is loaded replaces the line. A set runs its tests not done yet (the whole
      // set again once every one is done); one test runs (again).
      case '/api/start': {
        if (busy) return send(res, 409, { error: 'a battle is running: stop it first' });
        const L = loadedNow(); const all = tests();
        let ids = [];
        if (L.kind === 'test') ids = all.some((t) => t.id === L.id) ? [L.id] : [];
        else if (SETS[L.id]) {
          const latest = latestByTest(listBattles()); const inSet = all.filter(SETS[L.id][1]);
          const left = inSet.filter((t) => !latest[t.id] || latest[t.id].status !== 'done');
          ids = (left.length ? left : inSet).map((t) => t.id);
        }
        if (!ids.length) return send(res, 400, { error: 'nothing loaded to battle' });
        // Copies: tick() takes the first off the line, and the batch must keep all of them.
        state.queue = [...ids]; state.batch = [...ids]; state.paused = false; saveState(); tick();
        log(`battle: ${ids.length} test${ids.length > 1 ? 's' : ''} in line (${L.kind} ${L.id})`);
        return send(res, 200, { ok: true, queued: ids.length });
      }
      case '/api/unqueue': state.queue = state.queue.filter((q) => q !== body.id); saveState(); return send(res, 200, { ok: true });
      case '/api/clearqueue': state.queue = []; state.paused = false; saveState(); log('the line was cleared'); return send(res, 200, { ok: true });
      case '/api/stop': {
        stopAsked = true;
        if (current?.child) { const pid = current.child.pid; try { process.kill(-pid, 'SIGTERM'); } catch {} setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} }, 10_000); }
        state.paused = true; saveState(); log('stopped by you; the line is paused');
        return send(res, 200, { ok: true });
      }
      case '/api/resume': state.paused = false; saveState(); tick(); return send(res, 200, { ok: true });
      case '/api/vote': {
        const b = readBattle(String(body.id ?? ''));
        if (!b || b.status === 'running' || !['A', 'B', 'T'].includes(body.v)) return send(res, 400, { error: 'cannot vote on that' });
        b.vote = body.v; b.votedAt = new Date().toISOString();
        writeJson(join(P.battles, b.id, 'battle.json'), b);
        return send(res, 200, { ok: true, order: b.order });
      }
      case '/api/tests': {
        const meta = saveTest({ id: body.id ?? null, title: body.title, kind: body.kind, prompt: body.prompt, checks: body.checks ?? [], ask: body.ask ?? '', files: body.files ?? [], removeFiles: Boolean(body.removeFiles), removePaths: body.removePaths ?? [], useScript: body.useScript ?? null });
        if (body.run) { state.queue.push(meta.id); state.paused = false; saveState(); tick(); }
        return send(res, 200, { ok: true, id: meta.id, n: meta.n ?? null, variant: meta.variant ?? null, copyOf: meta.copyOf ?? null });
      }
      case '/api/tests/reset': { resetTest(String(body.id ?? '')); return send(res, 200, { ok: true }); }
      case '/api/clearresults': {
        if (busy) return send(res, 409, { error: 'a battle is running: stop it first' });
        const n = trashBattles(); log(`results cleared (${n} battles moved to trash)`);
        return send(res, 200, { ok: true, moved: n });
      }
      case '/api/tests/delete': { trashTest(String(body.id ?? '')); state.queue = state.queue.filter((q) => q !== body.id); saveState(); return send(res, 200, { ok: true }); }
      default: return send(res, 404, { error: 'not found' });
    }
  } catch (e) { log(`${req.method} ${url.pathname}: ${e.message}`); return send(res, 400, { error: e.message }); }
}).listen(PORT, '127.0.0.1', () => log(`serving http://127.0.0.1:${PORT}/`)).on('error', (e) => { log(`cannot listen on ${PORT}: ${e.message}`); rmSync(P.pid, { force: true }); process.exit(1); });

const bye = () => { if (current?.child) { try { process.kill(-current.child.pid, 'SIGTERM'); } catch {} } clearHold(); rmSync(P.pid, { force: true }); process.exit(0); };
process.on('SIGTERM', bye);
process.on('SIGINT', bye);
