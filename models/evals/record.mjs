// The test record: one line per test run, kept on this Mac in
// ~/.agentic-coder/tests/record.jsonl (AGENTIC_HOME moves it, AGENTIC_TEST_RECORD
// names the file outright). Every runner adds its result with recordTest();
// the hub's Tests tab reads the file live, and a snapshot page goes into the
// DOCS folder (tests/agentic-coder-test-record.html) so the record reaches GitHub
// with the other pages.
//
// A line:
//   { id, at, kind, name, code, model, effort, ctx, passed, total, secs, result, part, note, raw, page, bar?, failed? }
//   kind    tasks · sets · requests · bug · suite · check · other     (KINDS below)
//   result  pass · fail · stopped · measured (a number with no pass or fail: a speed, a count)
//   part    true for a run of only some of the set (a rerun of two tasks): kept, never shown as "the latest full run"
//   code    the commit under test ("7595055", "7595055+" with uncommitted changes)
//   model   the model the run used, by its id in models/registry.mjs ("gemma", "qwen"); null for a check that is of no one model (unit tests, the repo check)
//   raw     where the raw results are, from the repo's top
//   page    its results page in the DOCS folder ("tests/agentic-coder-….html"), if one was made
//   bar     what counts as a pass when it is not "every one" ("at most 4 wrong"); only then
//   failed  the unit tests that failed, by name ("hub-run.test.mjs › stop ends the run"); only then
//   settings the rows of the Tests page's control panel the run changed from the tests' defaults
//            ({ reranker: 'qwen3-reranker-0.6b', context: 65536 }); only then. Runs compare only
//            with runs at the same settings.
// A later line with the same id replaces the earlier one.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, basename, resolve, relative } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MODELS, MODELS_DIR } from '../registry.mjs';
import { RUN_TESTS, practiceChoices } from './run-tests.mjs';

export const KINDS = {
  tasks: ['Practice tasks', 'the 28 practice tasks, each with its own check'],
  sets: ['Battle sets', 'the Work 28 and the New 28 on one model, each test with its own checks'],
  requests: ['Real requests', 'trigger words and blocked commands in throwaway folders'],
  bug: ['Real bugs', 'a bug from a real project, judged in the browser'],
  suite: ['Unit tests', 'bun test over both parts'],
  check: ['Repo check', 'is anything in the repo that should not be: secrets, packages, where the code connects'],
  other: ['Other', 'probes and one-off checks'],
};
export const SNAPSHOT = 'tests/agentic-coder-test-record.html';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// The record's real place. A record anywhere else (a test's, a scratch run's) is never
// written into the DOCS folder: the saved copy there is of the real record only.
export const REAL_RECORD = join(homedir(), '.agentic-coder', 'tests', 'record.jsonl');
export const recordFile = () => (process.env.AGENTIC_TEST_RECORD ?? process.env.BONSAI_TEST_RECORD) ?? join((process.env.AGENTIC_HOME ?? process.env.BONSAI_HOME) ?? join(homedir(), '.agentic-coder'), 'tests', 'record.jsonl');

// The commit a folder of code is at. A frozen copy has no git of its own (and
// may sit inside another repo), so it is named by its folder: "main-7595055".
export function codeLabel(dir = repo) {
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  const top = git('rev-parse', '--show-toplevel');
  if (top.status !== 0 || resolve(top.stdout.trim()) !== resolve(dir)) return basename(resolve(dir));
  return git('rev-parse', '--short', 'HEAD').stdout.trim() + (git('status', '--porcelain', '--untracked-files=no').stdout.trim() ? '+' : '');
}

// Where the raw results are, as the record shows it: from the repo's top when
// they are inside the repo, from ~ when elsewhere in your home folder. The
// record is mirrored to GitHub, so a full path (your account's name) stays out.
export function rawPlace(raw, top = repo) {
  const p = String(raw ?? '');
  if (!p.startsWith('/')) return p;
  const rel = relative(resolve(top), resolve(p));
  if (rel && !rel.startsWith('..')) return rel;
  if (p === homedir() || p.startsWith(`${homedir()}/`)) return `~${p.slice(homedir().length)}`;
  // A session's temporary folder (/private/tmp/claude-501/-Users-<account>/<id>/scratchpad/…)
  // names the account too: only its last part is kept.
  if (/^\/(private\/)?(tmp|var\/folders)\//.test(p)) return `a temporary folder (${basename(p)})`;
  return p;
}

// Which model a run was of. A new line says so (`model`). An older line does
// not: it is read off where its raw results are (models/<folder>/results), then
// off the model named in its words. A practice, real-request or bug run that
// names no model is by date: the Bonsai 27B until 28 Sep 2026, Gemma after.
// The unit tests and the checks (the repo check) are of no one model: null. The Bonsai 27B is no
// longer in the registry, but its runs keep their id.
const FOLDER_MODEL = { 'gemma-4-12b': 'gemma', 'qwen3.5-9b': 'qwen', 'bonsai-2-27b': 'bonsai' };
const GEMMA_FROM = '2026-09-28';
export function modelOf(r) {
  if (r.model) return r.model;
  if (r.kind === 'suite' || r.kind === 'check' || /bge-m3/i.test(r.name)) return null; // the small matcher writes nothing: it is no chat model
  if (/^Battle · /.test(r.name ?? '')) return null; // a battle is of two models, whichever two (its vote is blind)
  const folder = /models\/([^/]+)\/results/.exec(r.raw ?? '')?.[1];
  if (FOLDER_MODEL[folder]) return FOLDER_MODEL[folder];
  const words = `${r.name} ${r.note} ${r.code}`.toLowerCase();
  const named = [/gemma/.test(words) && 'gemma', /qwen/.test(words) && 'qwen', /bonsai|27b/.test(words) && 'bonsai'].filter(Boolean);
  if (named.length === 1) return named[0];
  if (named.length > 1 || r.kind === 'other') return null;
  return String(r.at) < GEMMA_FROM ? 'bonsai' : 'gemma';
}

// How a line's result is marked. 'check': ✓ or ✗, all or nothing. 'bar': ✓ or ✗ against a bar
// that is not "every one" (it shows beside the mark). 'measure': a number with no pass or fail,
// drawn grey: a line that says pass with fewer than all right and names no bar measured
// something (16 of 50 functions found), it did not pass a check.
export function gradeOf(r) {
  if (r.result === 'measured') return { grade: 'measure', bar: '' };
  if (r.bar) return { grade: 'bar', bar: r.bar };
  if (r.result === 'pass' && r.total != null && r.passed != null && r.passed < r.total) {
    const m = /(\d+) wrong; pass at most (\d+)/.exec(r.note ?? ''); // the Sorting check's words before it named its bar
    return m ? { grade: 'bar', bar: `at most ${m[2]} wrong` } : { grade: 'measure', bar: '' };
  }
  return { grade: 'check', bar: '' };
}

// Every line of the record, newest first. A line that does not parse is skipped. The repo check
// wrote its lines as 'other' before it had a tab of its own: they are filed under 'check'.
export function readRecord(file = recordFile()) {
  if (!existsSync(file)) return [];
  const byId = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (!r || !r.id || !KINDS[r.kind]) continue;
      const kind = r.kind === 'other' && /^Repo check\b/.test(r.name ?? '') ? 'check' : r.kind;
      byId.set(r.id, { ...r, kind, raw: rawPlace(r.raw), model: modelOf(r), ...gradeOf(r) });
    } catch { /* a cut-off line */ }
  }
  return [...byId.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// The settings a run was started with from the Tests page's control panel (the runner passes them
// as AGENTIC_TEST_SETTINGS), or null. Read here, not from the terminal part: the record is part of it.
export function panelSettings(env = process.env) {
  try { const v = JSON.parse(env.AGENTIC_TEST_SETTINGS || 'null'); return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length ? v : null; } catch { return null; }
}

// Adds one run to the record. It never throws: a test must not fail because
// its result could not be written down. Returns the line, or null.
export function recordTest(row, { file = recordFile(), snapshot = true, quiet = false } = {}) {
  try {
    if (!KINDS[row?.kind] || !row.name) throw new Error('a line needs a kind (tasks, sets, requests, bug, suite, check, other) and a name');
    const at = row.at ?? new Date().toISOString();
    const result = row.result ?? (row.total != null && row.passed != null ? (row.passed === row.total && row.total > 0 ? 'pass' : 'fail') : 'fail');
    const line = { id: row.id ?? `${row.kind}:${at}`, at, kind: row.kind, name: row.name, code: row.code ?? codeLabel(), model: row.model ?? null, effort: row.effort ?? null, ctx: row.ctx ?? null,
      passed: row.passed ?? null, total: row.total ?? null, secs: row.secs == null ? null : Math.round(row.secs), result, part: Boolean(row.part), note: row.note ?? '', raw: rawPlace(row.raw), page: row.page ?? '',
      ...(row.bar ? { bar: String(row.bar) } : {}), ...(Array.isArray(row.failed) && row.failed.length ? { failed: row.failed.map(String).slice(0, 50) } : {}),
      // A run of your own tests: its level (Easy, Medium, Hard) and the points it got of those it could.
      ...(row.level ? { level: String(row.level) } : {}), ...(row.points && Number.isFinite(row.points.got) && Number.isFinite(row.points.of) ? { points: { got: row.points.got, of: row.points.of } } : {}),
      ...(() => { const s = row.settings ?? panelSettings(); return s ? { settings: s } : {}; })() };
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(line)}\n`);
    if (!quiet) console.log(`recorded in the test record: ${line.name} — ${line.total != null ? `${line.passed} of ${line.total}` : line.result}${line.secs != null ? `, ${line.secs.toLocaleString()} s` : ''}`);
    if (snapshot) writeSnapshot({ file });
    return line;
  } catch (e) {
    if (!quiet) console.log(`not recorded in the test record: ${e.message}`);
    return null;
  }
}

// The models whose file is on this Mac: the Tests tab's side panel lists these.
export const installedModels = () => Object.values(MODELS).filter((m) => existsSync(join(MODELS_DIR, m.file))).map((m) => ({ id: m.id, name: m.name }));

// The tests the Overview lays out, and how each one's line is found in the record: `board` is a
// column of the model × test grid (a full run on one model), `health` a check of no one model
// (the unit tests, the repo check). From the tests ▶ Run a test can run.
const place = (t) => ({ id: t.id, name: t.name, kind: t.record.kind, re: t.record.name, part: t.record.part });
export const overviewTests = () => ({
  board: RUN_TESTS.filter((t) => t.model && !t.pick && !t.own).map(place),
  health: RUN_TESTS.filter((t) => !t.model).map(place),
});

// What the Tests tab and the snapshot page both show.
export function recordData(file = recordFile()) {
  return { rows: readRecord(file), kinds: KINDS, models: installedModels(), ...overviewTests(), file: file.startsWith(homedir()) ? file.replace(homedir(), '~') : basename(file), made: new Date().toISOString() };
}

// What the record holds about the listed models side by side (the hub's Harness and Flow tabs):
//   run   the newest practice-task run every one of them did under the same name, effort, context
//         and panel settings, task by task from each run's raw results. Only the tasks they all
//         ran count. null while they have no such run. Each task also says which path it took
//         through the app and whether it went on step by step (the Flow tab draws the paths), and
//         `example` is one task's real steps on every model (the Flow tab's "One request").
//   sort  each model's newest whole Sorting check ({ right, total }), or null.
// The prompt test keeps two sides in its raw results: the new prompt's is read (the app as it is).
// `top` is the repo the raw results sit in: the launcher names it (the built app has no folder of its own).
const rawDir = (raw, top) => { const p = String(raw ?? ''); return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p.startsWith('/') ? p : p && !p.startsWith('a temporary folder') ? join(top, p) : null; };
// A task run's rows, the folder they were read from, and whether the memory was on for it.
function taskRun(dir) {
  for (const at of [dir, join(dir, 'new')]) {
    try { const d = JSON.parse(readFileSync(join(at, 'summary.json'), 'utf8')); if (Array.isArray(d.results) && d.results.length) return { rows: d.results, at, memory: Boolean(d.memory) }; } catch { /* not there, or not a task run */ }
  }
  return null;
}
// The path a task took through the app: the run's own route, with the step-by-step loop's three
// names as one ('loop'), and a change that spans files told apart by its tries ('multi': its
// drafts are called "changes"). null for a run from before the route was kept.
const LOOP_ROUTES = new Set(['question', 'other', 'step by step']);
export const pathOf = (row) => (!row?.route ? null : LOOP_ROUTES.has(row.route) ? 'loop' : row.route === 'change' && (row.tries ?? []).some((t) => /^Drafting changes\b/.test(String(t))) ? 'multi' : String(row.route));
// One task's steps as the run's own log has them: how it was sorted, each round of tries with its
// marks and seconds, what it asked before changing anything, the files it changed and the check it
// ran afterwards. The log is beside the summary, or one folder down in t<number>/ (the prompt
// test). null when it is gone.
const CHANGES = new Set(['Update', 'Edit', 'Write', 'Test']);
export function taskSteps(dir, task) {
  for (const at of [dir, join(dir, `t${parseInt(task, 10)}`)]) {
    let names; try { names = readdirSync(at); } catch { continue; }
    const f = names.filter((x) => x.startsWith(`${task}-think-`) && x.endsWith('.json')).sort()[0];
    if (!f) continue;
    try {
      const log = JSON.parse(readFileSync(join(at, f), 'utf8')).log;
      if (!Array.isArray(log) || !log.length) return null;
      const tools = log.filter((e) => e.type === 'tool'), settled = log.find((e) => e.type === 'settled');
      const changed = new Map();
      for (const e of tools) if (CHANGES.has(e.name) || CHANGES.has(e.label)) changed.set(String(e.arg), { path: String(e.arg), add: e.view?.additions ?? null, del: e.view?.removals ?? null, created: Boolean(e.view?.created), test: e.name === 'Test' });
      const first = tools.findIndex((e) => CHANGES.has(e.name) || CHANGES.has(e.label));
      const ran = first < 0 ? null : tools.slice(first).findLast((e) => e.name === 'Bash');
      return {
        request: String(settled?.request ?? ''),
        sorted: String(log.find((e) => e.type === 'sorted')?.text ?? '').replace(/^Sorted as:\s*/, ''),
        tries: log.filter((e) => e.type === 'tries-done').map((e) => ({ label: String(e.label ?? ''), marks: (e.marks ?? []).join(''), secs: Math.round(e.secs ?? 0) })),
        asked: tools.filter((e) => e.label === 'Ask').map((e) => ({ question: String(e.view?.question ?? e.arg ?? ''), answer: String(e.view?.text ?? '') })),
        changed: [...changed.values()],
        check: ran ? { cmd: String(ran.arg), ok: ran.view?.code === 0 } : settled?.check ? { cmd: String(settled.check.cmd), ok: Boolean(settled.check.ok) } : null,
      };
    } catch { return null; }
  }
  return null;
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const middle = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
export function sideBySide(ids = Object.keys(MODELS), { file = recordFile(), top = (process.env.AGENTIC_REPO ?? process.env.BONSAI_REPO) ?? repo, home } = {}) {
  const rows = readRecord(file);
  const whole = (r) => r.result !== 'stopped';
  const sort = Object.fromEntries(ids.map((id) => { const r = rows.find((x) => x.name === 'Sorting check' && x.model === id && !x.part && whole(x) && x.total); return [id, r ? { right: r.passed, total: r.total, at: r.at } : null]; }));
  const same = (r) => JSON.stringify([r.name, r.effort ?? null, r.ctx ?? null, r.settings ?? null]);
  const titles = new Map(practiceChoices(home).map((c) => [c.key, c.title]));
  const tried = new Set();
  for (const r of rows) {
    if (r.kind !== 'tasks' || !ids.includes(r.model) || !whole(r) || tried.has(same(r))) continue;
    tried.add(same(r));
    const lines = ids.map((id) => rows.find((x) => x.kind === 'tasks' && x.model === id && whole(x) && same(x) === same(r)));
    if (lines.some((l) => !l)) continue;
    const runs = lines.map((l) => { const d = rawDir(l.raw, top); return d ? taskRun(d) : null; });
    if (runs.some((x) => !x)) continue;
    const raws = runs.map((x) => x.rows);
    const num = (t) => parseInt(t, 10) || 0;
    const shared = [...new Set(raws[0].map((x) => x.task))].filter((t) => raws.every((rs) => rs.some((x) => x.task === t))).sort((a, b) => num(a) - num(b) || a.localeCompare(b));
    if (!shared.length) continue;
    const models = Object.fromEntries(ids.map((id, i) => {
      // A task run several times passes when every run did; its time is the mean.
      const tasks = Object.fromEntries(shared.map((t) => { const reps = raws[i].filter((x) => x.task === t); const bad = reps.find((x) => !x.pass); const path = pathOf(reps[0]); return [t, { pass: !bad, secs: Math.round(mean(reps.map((x) => x.secs ?? 0))), why: bad ? (bad.reason === 'interrupted' ? 'time' : String(bad.why || bad.reason || '')) : '', think: Math.round(mean(reps.map((x) => x.thinkTokens ?? 0))), calls: Math.round(mean(reps.map((x) => x.modelCalls ?? 0))),
        // The path it took, and whether the model went on step by step after a focused path (its own tool steps).
        path, thenLoop: Boolean(path) && path !== 'loop' && reps.some((x) => (x.ownSteps ?? 0) > 0) }]; }));
      const all = Object.values(tasks);
      const tps = raws[i].filter((x) => shared.includes(x.task) && x.tps).map((x) => x.tps);
      return [id, { at: lines[i].at, page: lines[i].page ?? '', passed: all.filter((t) => t.pass).length, secs: all.reduce((n, t) => n + t.secs, 0), median: middle(all.map((t) => t.secs)), thinkTokens: all.reduce((n, t) => n + t.think, 0), modelCalls: all.reduce((n, t) => n + t.calls, 0), write: tps.length ? +middle(tps).toFixed(1) : null, tasks }];
    }));
    const timed = Object.values(models).flatMap((m) => Object.values(m.tasks)).filter((t) => t.why === 'time').map((t) => t.secs);
    // The example: a task every model passed by the shortest road (a fix, one round of tries, no
    // step of its own), the lowest number first; else any task all passed on a focused path.
    const rowOf = (i, t) => raws[i].find((x) => x.task === t);
    const clean = (t, strict) => ids.every((id, i) => { const m = models[id].tasks[t], tries = rowOf(i, t).tries ?? []; return m.pass && ['fix', 'change', 'multi'].includes(m.path) && !m.thenLoop && tries.length > 0 && (!strict || (m.path === 'fix' && tries.length === 1)); });
    const picked = shared.find((t) => clean(t, true)) ?? shared.find((t) => clean(t, false));
    const steps = picked ? ids.map((id, i) => taskSteps(runs[i].at, picked)) : [];
    const example = picked && steps.every(Boolean) ? { task: picked, request: steps[0].request, memory: runs.every((x) => x.memory), models: Object.fromEntries(ids.map((id, i) => [id, steps[i]])) } : null;
    return {
      // reps: how many times each task was run, on the model that ran it least.
      run: { name: String(r.name).replace(/, tasks [\w, ]+$/, ''), at: lines.map((l) => l.at).sort().at(-1), effort: r.effort ?? null, ctx: r.ctx ?? null, thinking: Boolean(raws[0][0].thinking), limitMins: timed.length ? Math.round(Math.max(...timed) / 60) : null,
        reps: Math.min(...raws.flatMap((rs) => shared.map((t) => rs.filter((x) => x.task === t).length))),
        tasks: shared.map((t) => ({ id: t, n: num(t), title: titles.get(String(num(t))) ?? t.replace(/^\d+-/, '').replace(/-/g, ' ') })), models, example },
      sort,
    };
  }
  return { run: null, sort };
}

// The newest run the most of these models share, two at least, when no run has every one of them:
// a model added later shows "not run yet" beside the run the others share, instead of no run at all.
// ids in the answer: the models in that run (empty when there is none); sort is every model's.
export function sideByMost(ids = Object.keys(MODELS), opts = {}) {
  const all = sideBySide(ids, opts);
  if (all.run || ids.length < 3) return { ...all, ids: all.run ? ids : [] };
  const groups = (k, from = 0, pick = []) => (pick.length === k ? [pick] : ids.slice(from).flatMap((id, i) => groups(k, from + i + 1, [...pick, id])));
  for (let k = ids.length - 1; k >= 2; k--) {
    const found = groups(k).map((g) => [g, sideBySide(g, opts)]).filter(([, s]) => s.run).sort((a, b) => String(b[1].run.at).localeCompare(String(a[1].run.at)));
    if (found.length) return { run: found[0][1].run, sort: all.sort, ids: found[0][0] };
  }
  return { ...all, ids: [] };
}

// The same page the hub shows, with the record written into it, saved into
// the DOCS folder (the repo's docs/). Skipped quietly when the folder or the
// page's source is not here, and in a worktree or a frozen copy (its docs/
// would carry the page into a branch): the hub still reads the record live.
// Only the real record goes to the repo's DOCS folder; any other record needs
// the folder named (docsDir, or AGENTIC_DOCS).
// The main folder's .git is a folder; a worktree's is a file.
const isMainFolder = (dir) => { try { return statSync(join(dir, '.git')).isDirectory(); } catch { return false; } };
export function writeSnapshot({ file = recordFile(), docsDir = (process.env.AGENTIC_DOCS ?? process.env.BONSAI_DOCS) ?? (resolve(file) === REAL_RECORD && isMainFolder(repo) ? join(repo, 'docs') : null), template = join(repo, 'terminal', 'src', 'app', 'tests.html') } = {}) {
  try {
    if ((process.env.AGENTIC_NO_DOCS ?? process.env.BONSAI_NO_DOCS) || !docsDir || !existsSync(template) || !existsSync(docsDir) || !statSync(docsDir).isDirectory()) return null;
    const html = readFileSync(template, 'utf8');
    if (!html.includes('<!--DATA-->')) return null;
    const out = join(docsDir, SNAPSHOT);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html.replace('<!--DATA-->', () => `<script id="data" type="application/json">${JSON.stringify(recordData(file)).replace(/</g, '\\u003c')}</script>`));
    return out;
  } catch { return null; }
}
