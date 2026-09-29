// The Battle arena's files, on this Mac only (never in git): ~/.agentic-coder/battle/
// (AGENTIC_HOME moves it with the rest).
//   tests/<id>/        one test: meta.json, task.txt, project/ (its starter files), check.sh (optional)
//   battles/<id>/      one battle of one test: battle.json, A/ and B/ (each model's run: result.json,
//                      events.jsonl, files/ with the pages it made)
//   trash/             a deleted test, kept (nothing is removed for good)
//   state.json         the line of tests waiting to run, and whether it is paused
//   running.json       the hold: a battle wants or uses the memory (the app waits while it is there)
//   runner.pid, runner.log
// The New 28 come with the repo (models/evals/battle/new28/): each is copied into tests/ the
// first time the arena starts, so your edits are yours; a deleted one is not copied again.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, cpSync, rmSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME } from '../../registry.mjs';

export const battleHome = () => join(HOME, 'battle');
export const BATTLE_PORT = Number((process.env.AGENTIC_BATTLE_PORT ?? '') || 8758);
export const LIMIT_SECS = 600; // each model's run stops at 10 minutes
export const NEW28_DIR = join(dirname(fileURLToPath(import.meta.url)), 'new28');
export const KINDS = { code: 'Code change', question: 'Question', page: 'Page', writing: 'Writing' };

export const paths = (home = battleHome()) => ({
  home, tests: join(home, 'tests'), battles: join(home, 'battles'), trash: join(home, 'trash'),
  state: join(home, 'state.json'), hold: join(home, 'running.json'), pid: join(home, 'runner.pid'), log: join(home, 'runner.log'), seeded: join(home, 'seeded.json'),
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

// Copies the New 28 that are not here yet (and were never deleted).
export function seedNew28(home = battleHome(), from = NEW28_DIR) {
  const P = paths(home);
  mkdirSync(P.tests, { recursive: true });
  if (!existsSync(from)) return 0;
  const seeded = new Set(readJson(P.seeded, []));
  let n = 0;
  for (const id of readdirSync(from).sort()) {
    if (!existsSync(join(from, id, 'meta.json')) || seeded.has(id)) continue;
    if (!existsSync(join(P.tests, id))) cpSync(join(from, id), join(P.tests, id), { recursive: true, filter: (s) => !s.split(sep).includes('solution') });
    seeded.add(id); n += 1;
  }
  writeJson(P.seeded, [...seeded].sort());
  return n;
}

// Every test, New 28 first (by number), then yours (oldest first).
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
  return out.sort((a, b) => (a.suite === b.suite ? (a.suite === 'new28' ? (a.n ?? 0) - (b.n ?? 0) : String(a.created).localeCompare(String(b.created))) : a.suite === 'new28' ? -1 : 1));
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
  const tid = id ?? `m-${slug(title || prompt)}-${Date.now().toString(36).slice(-4)}`;
  const dir = join(P.tests, tid);
  if (id && !existsSync(join(dir, 'meta.json'))) throw new Error('no such test');
  const old = readJson(join(dir, 'meta.json'), {});
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

// A New 28 test as it came: your edited copy goes to trash/, the original comes back (without its answer).
export function resetTest(id, home = battleHome(), from = NEW28_DIR) {
  const P = paths(home);
  const src = inside(from, id);
  if (!src || !existsSync(join(src, 'meta.json'))) throw new Error('only a New 28 test can be put back');
  const dir = join(P.tests, id);
  mkdirSync(P.trash, { recursive: true });
  if (existsSync(dir)) renameSync(dir, join(P.trash, `${id}-edited-${Date.now()}`));
  cpSync(src, dir, { recursive: true, filter: (s) => !s.split(sep).includes('solution') });
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
export const latestByTest = (battles) => { const m = {}; for (const b of battles) m[b.test] = b; return m; };

// The hold on the memory (running.json): { pid, state: 'want' | 'running', test, title, run, of, startedAt }.
// The app reads it: while it is there, a window lets go of its model when idle and waits.
export function readHold(home = battleHome()) {
  const h = readJson(paths(home).hold);
  if (!h) return null;
  if (!alive(h.pid)) { rmSync(paths(home).hold, { force: true }); return null; }
  return h;
}
export const writeHold = (h, home = battleHome()) => writeJson(paths(home).hold, h);
export const clearHold = (home = battleHome()) => rmSync(paths(home).hold, { force: true });

// What the app says while a battle holds the memory (no model named: the vote is blind).
export function holdText(h, now = Date.now()) {
  if (!h) return null;
  if (h.state === 'want') return `a battle is about to start (${h.title})`;
  const left = Math.max(0, Math.ceil((LIMIT_SECS * 1000 - (now - (h.startedAt ?? now))) / 60000));
  return `a battle is running (${h.title} · run ${h.run} of ${h.of} · at most ${left} min left of this run)`;
}

// Whether the arena's runner is up: its pid file names a live process.
export const runnerPid = (home = battleHome()) => { const pid = Number(readJson(paths(home).pid) ?? 0); return alive(pid) ? pid : null; };
