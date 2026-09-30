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
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
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

// What the record holds about the listed models side by side (the hub's Harness tab):
//   run   the newest practice-task run every one of them did under the same name, effort, context
//         and panel settings, task by task from each run's raw results. Only the tasks they all
//         ran count. null while they have no such run.
//   sort  each model's newest whole Sorting check ({ right, total }), or null.
// The prompt test keeps two sides in its raw results: the new prompt's is read (the app as it is).
// `top` is the repo the raw results sit in: the launcher names it (the built app has no folder of its own).
const rawDir = (raw, top) => { const p = String(raw ?? ''); return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p.startsWith('/') ? p : p && !p.startsWith('a temporary folder') ? join(top, p) : null; };
function taskRows(dir) {
  for (const f of [join(dir, 'summary.json'), join(dir, 'new', 'summary.json')]) {
    try { const d = JSON.parse(readFileSync(f, 'utf8')); if (Array.isArray(d.results) && d.results.length) return d.results; } catch { /* not there, or not a task run */ }
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
    const raws = lines.map((l) => { const d = rawDir(l.raw, top); return d ? taskRows(d) : null; });
    if (raws.some((x) => !x)) continue;
    const num = (t) => parseInt(t, 10) || 0;
    const shared = [...new Set(raws[0].map((x) => x.task))].filter((t) => raws.every((rs) => rs.some((x) => x.task === t))).sort((a, b) => num(a) - num(b) || a.localeCompare(b));
    if (!shared.length) continue;
    const models = Object.fromEntries(ids.map((id, i) => {
      // A task run several times passes when every run did; its time is the mean.
      const tasks = Object.fromEntries(shared.map((t) => { const reps = raws[i].filter((x) => x.task === t); const bad = reps.find((x) => !x.pass); return [t, { pass: !bad, secs: Math.round(mean(reps.map((x) => x.secs ?? 0))), why: bad ? (bad.reason === 'interrupted' ? 'time' : String(bad.why || bad.reason || '')) : '', think: Math.round(mean(reps.map((x) => x.thinkTokens ?? 0))), calls: Math.round(mean(reps.map((x) => x.modelCalls ?? 0))) }]; }));
      const all = Object.values(tasks);
      const tps = raws[i].filter((x) => shared.includes(x.task) && x.tps).map((x) => x.tps);
      return [id, { at: lines[i].at, page: lines[i].page ?? '', passed: all.filter((t) => t.pass).length, secs: all.reduce((n, t) => n + t.secs, 0), median: middle(all.map((t) => t.secs)), thinkTokens: all.reduce((n, t) => n + t.think, 0), modelCalls: all.reduce((n, t) => n + t.calls, 0), write: tps.length ? +middle(tps).toFixed(1) : null, tasks }];
    }));
    const timed = Object.values(models).flatMap((m) => Object.values(m.tasks)).filter((t) => t.why === 'time').map((t) => t.secs);
    return {
      run: { name: String(r.name).replace(/, tasks [\w, ]+$/, ''), at: lines.map((l) => l.at).sort().at(-1), effort: r.effort ?? null, ctx: r.ctx ?? null, thinking: Boolean(raws[0][0].thinking), limitMins: timed.length ? Math.round(Math.max(...timed) / 60) : null,
        tasks: shared.map((t) => ({ id: t, n: num(t), title: titles.get(String(num(t))) ?? t.replace(/^\d+-/, '').replace(/-/g, ' ') })), models },
      sort,
    };
  }
  return { run: null, sort };
}

// The same page the hub shows, with the record written into it, saved into
// the DOCS folder. Skipped quietly when the folder or the page's source is
// not here (a worktree, a frozen copy): the hub still reads the record live.
// Only the real record goes to the repo's DOCS folder; any other record needs
// the folder named (docsDir, or AGENTIC_DOCS).
export function writeSnapshot({ file = recordFile(), docsDir = (process.env.AGENTIC_DOCS ?? process.env.BONSAI_DOCS) ?? (resolve(file) === REAL_RECORD ? (['cli docs', 'agentic-coder DOCS', 'bonsai-code DOCS'].map((n) => join(repo, n)).find((p) => existsSync(p)) ?? join(repo, 'cli docs')) : null), template = join(repo, 'terminal', 'src', 'app', 'tests.html') } = {}) {
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
