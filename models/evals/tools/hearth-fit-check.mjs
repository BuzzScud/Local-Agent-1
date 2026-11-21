// hearth fit check (21 Nov 2026, the owner: "we need to ensure its optimized and wired correctly … i want to use hearth api and
// work on code for the site like that and do other tasks", picked "Full Arena check"). Agentic Coder on hearth's API the way the
// owner runs it: their saved thinking and effort, and a copy of their /profiles (a profile on any server other than hearth is
// pointed at a closed port, so a job that would leave hearth shows up as a failed request instead of running somewhere: no Claude
// spend, no job on another service). Four kinds of work, each in a fresh copy of the shop through `coding -p`, on GitHub's main
// (--before, by default a clean copy of origin/main) and then on this code:
//   quick   a one-sentence question (no change)            fix    a small fix with a test
//   multi   a change across files, the whole suite run     docs   a page written from the code
// The checks, written before the first run (all on this code's side):
//   1 every run ends by itself (none stopped at its time limit), and none waits more than 60 s after its last request
//   2 no request leaves hearth (none to Claude, this Mac, or another service)
//   3 no request taken over by a newer job, none failed; every side job comes back with words
//   4 all four pieces of work are right
//   5 the quick question is answered within 90 s
//   6 the four runs' time in all at most 10% over main's
// On hearth's 27b on Poseidon by default (--model hearth@poseidon-seats: the door names it so; "hearth@poseidon" matches no server): tests never go to the copies kept for customers.
// Usage: bun models/evals/tools/hearth-fit-check.mjs [--before <checkout>] [--model <name>] [--only quick,fix] [--arms after] [--look]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUN, root, options, pad, stampOf, previousRun, writeResultsPage, rebuildIfAsked, rawOf } from './check-kit.mjs';
import { makeShop, throwawayHome, trust } from './ab-kit.mjs';
import { fitPage } from './hearth-fit-check-page.mjs';

const o = options();
const DIR = join(root, 'models', 'evals', 'results');
rebuildIfAsked(o, (dir, rows, summary) => writeResultsPage(fitPage, dir, rows, summary, previousRun(dir, summary, 'hearth-fit-')));

const { recordTest, codeLabel, HEARTH_ADDRESS } = await import('../../index.mjs');
const MODEL = o.opt('model', 'hearth@poseidon-seats');
const look = o.has('look');
const CAP_MS = Number(o.opt('cap', '720')) * 1000; // each run's time limit (12 min)
const sh = (cmd, cwd) => spawnSync('sh', ['-c', cmd], { cwd, encoding: 'utf8' });
const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');

// The four pieces of work and how each is judged (from the shop's files after the run, never the model's words alone).
const TASKS = [
  { id: 'quick', name: 'A quick question', prompt: 'In one sentence: what does checkout() in src/checkout.mjs return? Do not change any file.',
    judge: (shop, out) => { const t = out.toLowerCase(); const clean = !sh('git status --porcelain -- src test', shop).stdout.trim(); return { ok: /subtotal/.test(t) && /tax/.test(t) && /shipping/.test(t) && clean, why: `${clean ? 'no file changed' : 'files changed'} · answer names ${['subtotal', 'tax', 'shipping'].filter((w) => t.includes(w)).join(', ') || 'none of subtotal, tax, shipping'}` }; } },
  { id: 'fix', name: 'A small fix with a test', prompt: 'In src/price.mjs, applyDiscount can return a negative price when the percent is over 100. Make it never go below 0, add a test for that in test/price.test.mjs, and run the tests.',
    judge: (shop) => { const tests = sh('node --test', shop).status === 0; const clamp = spawnSync('node', ['-e', "import('./src/price.mjs').then((m) => process.exit(m.applyDiscount(10, 150) === 0 && m.applyDiscount(10, 50) === 5 ? 0 : 1))"], { cwd: shop }).status === 0; const t = existsSync(join(shop, 'test', 'price.test.mjs')); return { ok: tests && clamp && t, why: `clamped ${clamp ? 'yes' : 'no'} · test file ${t ? 'yes' : 'no'} · suite ${tests ? 'passes' : 'fails'}` }; } },
  { id: 'multi', name: 'A change across files', prompt: 'Free shipping should start at 75 instead of 50, and the tax rate should be 7%. Make both changes, update or add tests so both are covered, and run the whole test suite.',
    judge: (shop) => { const cfg = read(join(shop, 'src', 'config.mjs')); const free = /FREE_SHIPPING\s*=\s*75\b/.test(cfg); const rate = /RATE\s*=\s*0?\.07\b/.test(cfg); const tests = sh('node --test', shop).status === 0; const t = sh('cat test/*.mjs', shop).stdout; const covered = /75|74/.test(t) && /0?\.07|1\.07|7\b/.test(t); return { ok: free && rate && tests && covered, why: `free shipping 75 ${free ? 'yes' : 'no'} · tax 7% ${rate ? 'yes' : 'no'} · tests cover them ${covered ? 'yes' : 'no'} · suite ${tests ? 'passes' : 'fails'}` }; } },
  { id: 'docs', name: 'A page from the code', prompt: 'Write docs/API.md: one line for every function exported from src/, saying what it does. Do not change the code.',
    judge: (shop) => { const d = read(join(shop, 'docs', 'API.md')); const want = ['total', 'withTax', 'shippingFor', 'checkout', 'applyDiscount', 'roundCents']; const has = want.filter((w) => d.includes(w)); const clean = !sh('git status --porcelain -- src test', shop).stdout.trim(); return { ok: has.length === want.length && clean, why: `${has.length} of ${want.length} functions named · ${clean ? 'code untouched' : 'code changed'}` }; } },
];
const only = o.opt('only', null)?.split(',');
const tasks = only ? TASKS.filter((t) => only.includes(t.id)) : TASKS;

// HEARTH_FIT_KEY: the key for a run off a Mac (no Keychain: 21 Nov 2026, run on Triton while the M4 was off).
const key = process.env.HEARTH_FIT_KEY?.trim() || (spawnSync('security', ['find-generic-password', '-s', 'agentic-coder-remote', '-a', 'hearth', '-w'], { encoding: 'utf8' }).stdout ?? '').trim();
if (!key) { console.log('no hearth key in the Keychain (agentic-coder-remote / hearth): set it up with /remote hearth first'); process.exit(2); }
const own = (() => { try { return JSON.parse(readFileSync(join(homedir(), '.agentic-coder', 'settings.json'), 'utf8')); } catch { return {}; } })();

// The owner's /profiles, with every server that isn't hearth's door pointed at a closed port (named, so it shows where it led).
const CLOSED = 'http://127.0.0.1:9';
function ownProfiles(door = null) {
  let p = null;
  try { p = JSON.parse(readFileSync(join(homedir(), '.agentic-coder', 'profiles.json'), 'utf8')); } catch { return null; }
  const profiles = {};
  for (const [name, x] of Object.entries(p.profiles ?? {})) {
    const onHearth = String(x.server?.address ?? '').startsWith(HEARTH_ADDRESS.replace(/\/v1$/, ''));
    // One on hearth goes through the run's guard too (door), so it is held as the run is.
    profiles[name] = onHearth ? { ...x, server: { ...x.server, address: door ?? x.server.address, connect: 'http' } } : { ...x, server: { kind: 'openai', source: `closed-${x.server?.source ?? 'x'}`, address: CLOSED, port: null, connect: 'http', keyId: null } };
  }
  return { profiles, uses: p.uses ?? {} };
}

// The guard in front of hearth's door (each run's address): every chat must name MODEL, so no request of a test reaches a
// copy customers use (tests go to Poseidon only). On main's side (hold: true) it holds main there: GitHub's main gives back
// plain "hearth" for a name with its server and sends its side jobs to the sizes, which live on other servers (hearth Lite's
// 9b answers customers on one), so its chats are renamed to MODEL and the sizes hidden from its lists. A chat that names
// anything else on this code's side is refused and counted (`strays`).
const DOOR = HEARTH_ADDRESS.replace(/\/v1$/, '');
const SIZE = /^hearth-(2b|4b|9b)$/;
function guard({ hold = false } = {}) {
  const strays = [], asked = [];
  const server = Bun.serve({
    port: 0, hostname: '127.0.0.1', idleTimeout: 0,
    async fetch(req) {
      const u = new URL(req.url);
      const path = u.pathname.replace(/^\/door/, '');
      const headers = new Headers(req.headers);
      for (const h of ['host', 'content-length', 'accept-encoding', 'connection']) headers.delete(h);
      let body = req.method === 'GET' ? undefined : await req.text();
      if (/\/(api\/chat|api\/generate|v1\/chat\/completions)$/.test(path) && body) {
        const j = JSON.parse(body);
        asked.push(String(j.model));
        if (hold) j.model = MODEL;
        else if (j.model !== MODEL) { strays.push(String(j.model)); return Response.json({ error: `held to ${MODEL} by the hearth fit check` }, { status: 403 }); }
        body = JSON.stringify(j);
      }
      const up = await fetch(`${DOOR}${path}${u.search}`, { method: req.method, headers, body, signal: req.signal });
      const out = new Headers(up.headers);
      for (const h of ['content-encoding', 'content-length', 'transfer-encoding', 'connection']) out.delete(h);
      if (hold && /\/(api\/tags|api\/ps|v1\/models)$/.test(path) && up.ok) {
        const j = await up.json();
        if (Array.isArray(j.models)) j.models = j.models.filter((m) => !SIZE.test(m.name ?? m.model ?? ''));
        if (Array.isArray(j.data)) j.data = j.data.filter((m) => !SIZE.test(m.id ?? ''));
        return Response.json(j, { status: up.status });
      }
      return new Response(up.body, { status: up.status, headers: out });
    },
  });
  return { address: `http://127.0.0.1:${server.port}/door/v1`, strays, asked, stop: () => server.stop(true) };
}

function beforeCheckout() {
  const named = o.opt('before', null);
  if (named) return { dir: named, code: spawnSync('git', ['-C', named, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim() || 'before' };
  const dir = mkdtempSync(join(tmpdir(), 'hearth-fit-main-'));
  if (sh(`git -C "${root}" archive origin/main | tar -x -C "${dir}"`).status !== 0) throw new Error('could not copy origin/main');
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
  return { dir, code: spawnSync('git', ['-C', root, 'rev-parse', '--short', 'origin/main'], { encoding: 'utf8' }).stdout.trim() };
}

// One run: a throwaway home on hearth with the owner's settings and profiles, a fresh shop, one request.
async function runOne(arm, checkout, task) {
  const base = mkdtempSync(join(tmpdir(), `hearth-fit-${arm}-${task.id}-`));
  const shop = makeShop(join(base, 'shop'));
  const g = guard({ hold: arm === 'before' });
  const remote = { use: true, source: 'hearth', kind: 'openai', connect: 'http', address: g.address, port: null, model: MODEL, context: 0, key: true, keyEnd: key.slice(-4), keyId: 'hearth' };
  const home = throwawayHome(join(base, 'home'), { remote, remotes: { hearth: remote }, instructions: 'auto', thinking: own.thinking ?? true, effort: own.effort ?? null });
  const prof = ownProfiles(g.address);
  if (prof) writeFileSync(join(home, 'profiles.json'), JSON.stringify(prof));
  trust(home, shop);
  const t0 = Date.now();
  const run = await new Promise((ok) => {
    const p = spawn(BUN, [join(checkout, 'terminal', 'src', 'cli.jsx'), '-p', task.prompt, '--yes', '--mode', 'bypass'], { cwd: shop, env: { ...process.env, AGENTIC_HOME: home, AGENTIC_REMOTE_KEY: key, AGENTIC_NO_UPDATE: '1', AGENTIC_MEMORY_SAVE: 'off', AGENTIC_NO_MEMORY: '1', AGENTIC_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', killed = false;
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { killed = true; p.kill('SIGTERM'); }, CAP_MS);
    p.on('exit', (code) => { clearTimeout(timer); ok({ code, out, err, killed }); });
  });
  const end = Date.now();
  g.stop();
  const secs = (end - t0) / 1000;
  const file = join(home, 'activity', 'requests.jsonl');
  const reqs = read(file).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && r.at >= new Date(t0).toISOString());
  const sum = (list, k) => list.reduce((t, r) => t + (Number(r[k]) || 0), 0);
  const sides = reqs.filter((r) => r.who !== 'conversation');
  const lastEnd = reqs.length ? Math.max(...reqs.map((r) => Date.parse(r.at))) : t0;
  const judged = task.judge(shop, run.out);
  const offHearth = reqs.filter((r) => !/^hearth/.test(String(r.model ?? '')));
  const r = {
    arm, task: task.id, secs, code: run.code, killed: run.killed, idleAfter: run.killed ? null : Math.max(0, (end - lastEnd) / 1000),
    requests: reqs.length, steps: reqs.length - sides.length, side: sides.length,
    sideWords: sides.filter((x) => x.end !== 'error' && x.end !== 'length' && (x.wroteTok || 0) > (x.thinkTok || 0)).length,
    taken: reqs.filter((x) => /took its place/.test(x.error || '')).length,
    failed: reqs.filter((x) => x.end === 'error').length,
    offHearth: [...offHearth.map((x) => `${x.model} (${x.who})`), ...g.strays.map((m) => `${m} (refused by the guard)`)],
    asked: [...new Set(g.asked)],
    wrote: sum(reqs, 'wroteTok'), think: sum(reqs, 'thinkTok'), readTok: sum(reqs, 'readTok'),
    workSecs: (sum(reqs, 'readMs') + sum(reqs, 'writeMs')) / 1000,
    queued: (run.err.match(/in hearth's line/g) || []).length,
    ok: judged.ok, why: judged.why, answer: run.out.trim().slice(-300), errTail: run.err.trim().split('\n').slice(-6).join('\n'), reqs,
  };
  r.thinkShare = r.wrote ? r.think / r.wrote : null;
  console.log(`${arm} · ${task.id}: ${Math.round(secs)} s${run.killed ? ' (STOPPED at its limit)' : ''}, ${r.steps} steps, ${r.side} side (${r.sideWords} with words), ${r.offHearth.length} off hearth, thinking ${r.thinkShare == null ? '—' : Math.round(r.thinkShare * 100) + '%'}, work ${judged.ok ? 'right' : 'WRONG'} (${judged.why})`);
  return r;
}

const now = new Date();
const stamp = stampOf(now);
const out = join(DIR, `hearth-fit-${stamp}`);
mkdirSync(out, { recursive: true });
const code = codeLabel();
const arms = o.opt('arms', 'before,after').split(',');
const before = arms.includes('before') ? beforeCheckout() : null;
console.log(`before: ${before?.code ?? '—'} · after: ${code} · on ${MODEL} · tasks ${tasks.map((t) => t.id).join(', ')} · each at most ${CAP_MS / 60000} min`);
const t0 = Date.now();
const res = { before: [], after: [] };
// One task at a time, main then this code, so the two sides see the same hour on hearth.
for (const t of tasks) {
  if (before) res.before.push(await runOne('before', before.dir, t));
  if (arms.includes('after')) res.after.push(await runOne('after', root, t));
}
const A = res.after, B = res.before;
const tot = (L, k) => L.reduce((s, r) => s + (Number(r[k]) || 0), 0);
const quick = A.find((r) => r.task === 'quick');
const row = (id, name, ok, detail) => ({ id, name, ok, detail, secs: 0 });
const rows = [
  row('ends', 'Every run ends by itself, at most 60 s after its last request', A.every((r) => !r.killed && r.idleAfter <= 60), A.map((r) => `${r.task} ${r.killed ? 'stopped at its limit' : `${Math.round(r.idleAfter)} s after`}`).join(' · ') + (B.length ? ` | main: ${B.map((r) => `${r.task} ${r.killed ? 'stopped' : `${Math.round(r.idleAfter)} s`}`).join(' · ')}` : '')),
  row('hearth', 'No request leaves hearth', A.every((r) => !r.offHearth.length), `after: ${A.flatMap((r) => r.offHearth).join(', ') || 'none'}${B.length ? ` | main: ${B.flatMap((r) => r.offHearth).join(', ') || 'none'}` : ''}`),
  row('jobs', 'None taken over or failed; side jobs back with words', A.every((r) => !r.taken && !r.failed && r.sideWords === r.side), `after: ${tot(A, 'taken')} taken, ${tot(A, 'failed')} failed, ${tot(A, 'sideWords')}/${tot(A, 'side')} side jobs back${B.length ? ` | main: ${tot(B, 'taken')} taken, ${tot(B, 'failed')} failed, ${tot(B, 'sideWords')}/${tot(B, 'side')}` : ''}`),
  row('work', 'All the work right', A.every((r) => r.ok), A.map((r) => `${r.task} ${r.ok ? 'right' : 'wrong'} (${r.why})`).join(' · ') + (B.length ? ` | main: ${B.map((r) => `${r.task} ${r.ok ? 'right' : 'wrong'}`).join(' · ')}` : '')),
  row('quick', 'The quick question within 90 s', Boolean(quick) && !quick.killed && quick.secs <= 90, quick ? `after ${Math.round(quick.secs)} s${B.find((r) => r.task === 'quick') ? `, main ${Math.round(B.find((r) => r.task === 'quick').secs)} s` : ''}` : 'not run'),
  row('time', 'Time in all at most 10% over main', !B.length || tot(A, 'secs') <= tot(B, 'secs') * 1.1, `after ${Math.round(tot(A, 'secs'))} s${B.length ? `, main ${Math.round(tot(B, 'secs'))} s` : ''}`),
];
for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name} · ${r.detail}`);
const pass = rows.every((r) => r.ok);
const secs = (Date.now() - t0) / 1000;
const strip = (L) => L.map(({ reqs, ...x }) => x);
const summary = {
  name: 'hearth fit check', model: MODEL, code, beforeCode: before?.code ?? null, tasks: tasks.map(({ id, name, prompt }) => ({ id, name, prompt })),
  effort: own.effort ?? null, thinking: own.thinking ?? null, profiles: Boolean(ownProfiles()),
  started: new Date(t0).toISOString(), finished: new Date().toISOString(), secs,
  checks: rows.length, of: rows.length, passed: rows.filter((r) => r.ok).length, pass, stopped: false, arms: { before: strip(B), after: strip(A) },
  label: 'This run', sub: `${now.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} ${pad(now.getHours())}:${pad(now.getMinutes())} · ${code}`,
  page: look ? '' : `tests/agentic-coder-hearth-fit-${stamp}.html`,
};
writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(out, 'requests.json'), JSON.stringify({ before: B.map((r) => ({ task: r.task, reqs: r.reqs })), after: A.map((r) => ({ task: r.task, reqs: r.reqs })) }, null, 2));
if (look) console.log('a look only: no results page, no line in the test record');
else {
  writeResultsPage(fitPage, out, rows, summary, previousRun(out, summary, 'hearth-fit-'));
  console.log(`results page: ${summary.page}`);
  recordTest({
    kind: 'other', model: `remote:${MODEL}`, name: 'hearth fit check', code, passed: summary.passed, total: rows.length, secs, part: false,
    result: pass ? 'pass' : 'fail', bar: 'this code: every run ends by itself, nothing leaves hearth, no job taken over or failed, all four pieces of work right, the quick question within 90 s, time at most 10% over main',
    note: `after ${Math.round(tot(A, 'secs'))} s (${A.filter((r) => r.ok).length}/${A.length} right)${B.length ? `, main ${Math.round(tot(B, 'secs'))} s (${B.filter((r) => r.ok).length}/${B.length} right)` : ''}`, raw: rawOf(out), page: summary.page,
  });
}
console.log(`hearth fit check: ${pass ? 'PASSED' : 'FAILED'}`);
process.exit(pass ? 0 : 1);
