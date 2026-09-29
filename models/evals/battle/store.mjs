// The Battle arena's files, on this Mac only (never in git): ~/.agentic-coder/battle/
// (AGENTIC_HOME moves it with the rest).
//   tests/<id>/        one test: meta.json, task.txt, project/ (its starter files), check.sh (optional)
//   battles/<id>/      one battle of one test: battle.json, A/ and B/ (each model's run: result.json,
//                      events.jsonl, files/ with the pages it made)
//   trash/             a deleted test, kept (nothing is removed for good)
//   state.json         the line of tests waiting to run, and whether it is paused
//   running.json       the hold: a battle or a test run wants or uses the memory (the app waits while it is there)
//   runs/<id>/         one test run from the hub's Tests tab (▶ Run a test): job.json, run.log (what it printed)
//   runner.pid, runner.log, runner.token (the key the hub sends to start or stop a test run)
// Three sets of 28 come with the repo, each copied into tests/ the first time the arena starts,
// so your edits are yours; a deleted one is not copied again:
//   new28/      the New 28 (n01…), written for the arena
//   work28/     the Work 28 (w01…), about the work this Mac is used for: futures, market data, the desks
//   practice    the Practice 28 (p01…): the practice tasks that grade a model (models/evals/bench/tasks/),
//               with a title, kind and rules from practice28.json. Those task folders are never changed:
//               an edit of a Practice 28 test is saved as a copy with the next letter (p18 → p18b).
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, cpSync, rmSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME } from '../../registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const battleHome = () => join(HOME, 'battle');
export const BATTLE_PORT = Number((process.env.AGENTIC_BATTLE_PORT ?? '') || 8758);
export const LIMIT_SECS = 600; // each model's run stops at 10 minutes
export const NEW28_DIR = join(HERE, 'new28');
export const WORK28_DIR = join(HERE, 'work28');
export const PRACTICE_DIR = join(HERE, '..', 'bench', 'tasks');
export const PRACTICE_LIST = join(HERE, 'practice28.json');
export const KINDS = { code: 'Code change', question: 'Question', page: 'Page', writing: 'Writing' };
// The sets in the order the page shows them (yours, 'mine', come last).
export const SUITES = { new28: 'New 28', work28: 'Work 28', practice: 'Practice 28', mine: 'My tests' };
const RANK = Object.keys(SUITES);
const rank = (suite) => (RANK.includes(suite) ? RANK.indexOf(suite) : RANK.length - 1);

export const paths = (home = battleHome()) => ({
  home, tests: join(home, 'tests'), battles: join(home, 'battles'), trash: join(home, 'trash'),
  state: join(home, 'state.json'), hold: join(home, 'running.json'), pid: join(home, 'runner.pid'), log: join(home, 'runner.log'), seeded: join(home, 'seeded.json'),
  runs: join(home, 'runs'), token: join(home, 'runner.token'),
});

export const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
export function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(`${f}.tmp`, JSON.stringify(v, null, 1)); renameSync(`${f}.tmp`, f); }
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };

// A name that is safe as a folder: letters, digits and dashes.
export const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'test';
// Inside the folder, or null: a path from outside never reaches another folder.
export function inside(base, rel) {
  const p = resolve(base, String(rel ?? '').replace(/^\/+/, ''));
  return p === resolve(base) || p.startsWith(resolve(base) + sep) ? p : null;
}

// The Practice 28 as arena tests: [{ id: 'p01-json-flag', task: '1-json-flag', n, title, kind, rules }].
export function practiceList(list = PRACTICE_LIST) {
  return readJson(list, []).map((p) => ({ ...p, id: `p${String(p.n).padStart(2, '0')}-${p.task.replace(/^\d+-/, '')}` }));
}
// Writes one Practice 28 test from its practice task: the prompt, project/, check.sh and the replies
// to its questions (answers.json) as they are; the known-good answer (reference/) stays out.
function writePractice(p, to, from = PRACTICE_DIR) {
  const src = join(from, p.task);
  mkdirSync(to, { recursive: true });
  cpSync(join(src, 'project'), join(to, 'project'), { recursive: true });
  cpSync(join(src, 'check.sh'), join(to, 'check.sh'));
  cpSync(join(src, 'task.txt'), join(to, 'task.txt'));
  const answers = readJson(join(src, 'answers.json'), []);
  writeJson(join(to, 'meta.json'), { id: p.id, n: p.n, suite: 'practice', title: p.title, kind: p.kind, rules: p.rules, checks: [], answers, home: false, created: '2026-09-29T12:00:00.000Z', task: p.task });
}
// Where a test that came with the repo is from: a function that writes it again, or null.
function originalOf(id) {
  for (const dir of [NEW28_DIR, WORK28_DIR]) {
    const src = inside(dir, id);
    if (src && existsSync(join(src, 'meta.json'))) return (to) => cpSync(src, to, { recursive: true, filter: (s) => !s.split(sep).includes('solution') });
  }
  const p = practiceList().find((x) => x.id === id);
  return p && existsSync(join(PRACTICE_DIR, p.task)) ? (to) => writePractice(p, to) : null;
}

// Copies the tests that come with the repo and are not here yet (and were never deleted).
export function seedSuites(home = battleHome()) {
  const P = paths(home);
  mkdirSync(P.tests, { recursive: true });
  const seeded = new Set(readJson(P.seeded, []));
  const ids = [NEW28_DIR, WORK28_DIR].flatMap((dir) => (existsSync(dir) ? readdirSync(dir).filter((id) => existsSync(join(dir, id, 'meta.json'))) : []));
  ids.push(...practiceList().map((p) => p.id));
  let n = 0;
  for (const id of ids.sort()) {
    if (seeded.has(id)) continue;
    const write = originalOf(id);
    if (!write) continue;
    if (!existsSync(join(P.tests, id))) write(join(P.tests, id));
    seeded.add(id); n += 1;
  }
  writeJson(P.seeded, [...seeded].sort());
  return n;
}

// Every test: the sets that come with the repo (by number, a copy after its original), then yours (oldest first).
export function listTests(home = battleHome()) {
  const P = paths(home);
  if (!existsSync(P.tests)) return [];
  const out = [];
  for (const id of readdirSync(P.tests)) {
    const meta = readJson(join(P.tests, id, 'meta.json'));
    if (!meta) continue;
    let prompt = '';
    try { prompt = readFileSync(join(P.tests, id, 'task.txt'), 'utf8').trim(); } catch {}
    out.push({ ...meta, id, prompt, files: listFiles(join(P.tests, id, 'project')), hasScript: existsSync(join(P.tests, id, 'check.sh')) });
  }
  return out.sort((a, b) => rank(a.suite) - rank(b.suite) || (rank(a.suite) === RANK.length - 1
    ? String(a.created).localeCompare(String(b.created))
    : (a.n ?? 0) - (b.n ?? 0) || String(a.variant ?? '').localeCompare(String(b.variant ?? ''))));
}

// The next free letter for a copy of Practice 28 test n: b, c, … (never one used before, even by a
// deleted copy or an old result, so a copy's results are only ever its own).
function nextVariant(n, home = battleHome()) {
  const P = paths(home);
  const re = new RegExp(`(^|-)p${String(n).padStart(2, '0')}([b-z])-`);
  const used = new Set();
  for (const d of [P.tests, P.trash, P.battles]) { let names = []; try { names = readdirSync(d); } catch {} for (const f of names) { const m = re.exec(f); if (m) used.add(m[2]); } }
  const free = 'bcdefghijklmnopqrstuvwxyz'.split('').find((c) => !used.has(c));
  if (!free) throw new Error(`test ${n} has no copy letters left`);
  return free;
}

// The starter files of a test (paths from its project folder), up to 200.
export function listFiles(dir, max = 200) {
  const out = [];
  const walk = (d) => {
    let names = [];
    try { names = readdirSync(d); } catch { return; }
    for (const n of names.sort()) {
      if (out.length >= max) return;
      if (n === 'node_modules' || n === '.git' || n === '.DS_Store') continue;
      const p = join(d, n);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p); else out.push(relative(dir, p));
    }
  };
  walk(dir);
  return out;
}

// A new test from the page (or an edit of one). files: [{ path, b64 }], added to project/.
// removePaths: starter files to take out (paths from project/). useScript: false turns off a New 28 test's own
// check (check.sh stays, unused), for a test whose prompt you changed so its check no longer fits.
export function saveTest({ id = null, title, kind, prompt, checks = [], ask = '', files = [], removeFiles = false, removePaths = [], useScript = null, suite = 'mine' }, home = battleHome()) {
  const P = paths(home);
  if (!String(prompt ?? '').trim()) throw new Error('the test needs a prompt');
  if (!KINDS[kind]) throw new Error(`no kind ${kind}`);
  let tid = id ?? `m-${slug(title || prompt)}-${Date.now().toString(36).slice(-4)}`;
  let dir = join(P.tests, tid);
  if (id && !existsSync(join(dir, 'meta.json'))) throw new Error('no such test');
  let old = readJson(join(dir, 'meta.json'), {});
  // A Practice 28 test itself never changes (it is what grades a model): the edit becomes a copy,
  // test 18 → 18b, with the original's files, and the original stays as it was.
  if (id && old.suite === 'practice' && !old.copyOf) {
    const variant = nextVariant(old.n, home);
    tid = id.replace(/^p(\d+)-/, `p$1${variant}-`);
    cpSync(dir, join(P.tests, tid), { recursive: true });
    dir = join(P.tests, tid);
    old = { ...old, id: tid, copyOf: id, variant, created: new Date().toISOString() };
  }
  mkdirSync(join(dir, 'project'), { recursive: true });
  if (removeFiles) { rmSync(join(dir, 'project'), { recursive: true, force: true }); mkdirSync(join(dir, 'project'), { recursive: true }); }
  for (const p of removePaths) { const f = inside(join(dir, 'project'), p); if (f && f !== resolve(join(dir, 'project'))) rmSync(f, { force: true }); }
  for (const f of files) {
    const to = inside(join(dir, 'project'), f.path);
    if (!to || to === resolve(join(dir, 'project'))) continue;
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, Buffer.from(String(f.b64 ?? ''), 'base64'));
  }
  writeFileSync(join(dir, 'task.txt'), `${String(prompt).trim()}\n`);
  const meta = {
    ...old, id: tid, title: String(title || '').trim() || String(prompt).trim().split(/\s+/).slice(0, 7).join(' '), kind, suite: old.suite ?? suite,
    checks: checks.map((c) => ({ type: String(c.type), value: String(c.value ?? '') })),
    answers: String(ask ?? '').trim() ? [{ match: '.', reply: String(ask).trim() }] : [],
    home: kind === 'page' || kind === 'writing' ? true : Boolean(old.home), created: old.created ?? new Date().toISOString(), edited: id ? new Date().toISOString() : undefined,
    noScript: useScript == null ? Boolean(old.noScript) : !useScript,
  };
  writeJson(join(dir, 'meta.json'), meta);
  return meta;
}

// A test that came with the repo, as it came: your edited copy goes to trash/, the original comes back
// (without its known-good answer). A copy of a Practice 28 test (18b) has no original of its own.
export function resetTest(id, home = battleHome()) {
  const P = paths(home);
  const write = originalOf(id);
  if (!write) throw new Error('only a test that came with the arena can be put back');
  const dir = join(P.tests, id);
  mkdirSync(P.trash, { recursive: true });
  if (existsSync(dir)) renameSync(dir, join(P.trash, `${id}-edited-${Date.now()}`));
  write(dir);
}

// All results go to trash/ (your votes with them): the score starts again at 0–0.
export function trashBattles(home = battleHome()) {
  const P = paths(home);
  if (!existsSync(P.battles) || !readdirSync(P.battles).length) return 0;
  const n = readdirSync(P.battles).length;
  mkdirSync(P.trash, { recursive: true });
  renameSync(P.battles, join(P.trash, `battles-${Date.now()}`));
  return n;
}

// Deleting moves the test to trash/ (and a New 28 test stays deleted).
export function trashTest(id, home = battleHome()) {
  const P = paths(home);
  const dir = inside(P.tests, id);
  if (!dir || !existsSync(join(dir, 'meta.json'))) throw new Error('no such test');
  mkdirSync(P.trash, { recursive: true });
  renameSync(dir, join(P.trash, `${id}-${Date.now()}`));
}

// Battles: the latest of each test, and all of one test.
export function readBattle(id, home = battleHome()) { const d = inside(paths(home).battles, id); return d ? readJson(join(d, 'battle.json')) : null; }
export function listBattles(home = battleHome()) {
  const P = paths(home);
  if (!existsSync(P.battles)) return [];
  return readdirSync(P.battles).map((id) => readJson(join(P.battles, id, 'battle.json'))).filter(Boolean).sort((a, b) => String(a.at).localeCompare(String(b.at)));
}
// How many tests and battles there are, without reading them (the /settings row).
export function battleCounts(home = battleHome()) {
  const P = paths(home);
  const n = (d) => { try { return readdirSync(d).filter((f) => !f.startsWith('.')).length; } catch { return 0; } };
  return { tests: n(P.tests), battles: n(P.battles) };
}
export const latestByTest = (battles) => { const m = {}; for (const b of battles) m[b.test] = b; return m; };

// The hold on the memory (running.json): { pid, state: 'want' | 'running', kind: 'battle' | 'test', test, title, run, of, startedAt }.
// A test run's hold names the test's own process once it runs, so it lasts exactly as long as the run.
// The app reads it: while it is there, a window lets go of its model when idle and waits.
export function readHold(home = battleHome()) {
  const h = readJson(paths(home).hold);
  if (!h) return null;
  if (!alive(h.pid)) { rmSync(paths(home).hold, { force: true }); return null; }
  return h;
}
export const writeHold = (h, home = battleHome()) => writeJson(paths(home).hold, h);
export const clearHold = (home = battleHome()) => rmSync(paths(home).hold, { force: true });

// What the app says while a battle holds the memory (no model named: the vote is blind), or a test
// run from the Tests tab (that one names its model: it is one model's test).
export function holdText(h, now = Date.now()) {
  if (!h) return null;
  if (h.kind === 'test') {
    if (h.state === 'want') return `a test run is about to start (${h.title})`;
    const mins = Math.max(0, Math.floor((now - (h.startedAt ?? now)) / 60000));
    return `a test is running (${h.title} · ${mins ? `${mins} min so far` : 'just started'})`;
  }
  if (h.state === 'want') return `a battle is about to start (${h.title})`;
  const left = Math.max(0, Math.ceil((LIMIT_SECS * 1000 - (now - (h.startedAt ?? now))) / 60000));
  return `a battle is running (${h.title} · run ${h.run} of ${h.of} · at most ${left} min left of this run)`;
}

// Whether the arena's runner is up: its pid file names a live process.
export const runnerPid = (home = battleHome()) => { const pid = Number(readJson(paths(home).pid) ?? 0); return alive(pid) ? pid : null; };
