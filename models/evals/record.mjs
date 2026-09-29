// The test record: one line per test run, kept on this Mac in
// ~/.agentic-coder/tests/record.jsonl (AGENTIC_HOME moves it, AGENTIC_TEST_RECORD
// names the file outright). Every runner adds its result with recordTest();
// the hub's Tests tab reads the file live, and a snapshot page goes into the
// DOCS folder (tests/agentic-coder-test-record.html) so the record reaches GitHub
// with the other pages.
//
// A line:
//   { id, at, kind, name, code, model, effort, ctx, passed, total, secs, result, part, note, raw, page }
//   kind    tasks · requests · bug · suite · other            (KINDS below)
//   result  pass · fail · stopped
//   part    true for a run of only some of the set (a rerun of two tasks): kept, never shown as "the latest full run"
//   code    the commit under test ("7595055", "7595055+" with uncommitted changes)
//   model   the model the run used, by its id in models/registry.mjs ("gemma", "qwen"); null for a check that is of no one model (unit tests, the repo check)
//   raw     where the raw results are, from the repo's top
//   page    its results page in the DOCS folder ("tests/agentic-coder-….html"), if one was made
// A later line with the same id replaces the earlier one.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, basename, resolve, relative } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MODELS, MODELS_DIR } from '../registry.mjs';

export const KINDS = {
  tasks: ['Practice tasks', 'the 28 practice tasks, each with its own check'],
  requests: ['Real requests', 'trigger words and blocked commands in throwaway folders'],
  bug: ['Real bugs', 'a bug from a real project, judged in the browser'],
  suite: ['Unit tests', 'bun test over both parts'],
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
// The unit tests and the checks are of no one model: null. The Bonsai 27B is no
// longer in the registry, but its runs keep their id.
const FOLDER_MODEL = { 'gemma-4-12b': 'gemma', 'qwen3.5-9b': 'qwen', 'bonsai-2-27b': 'bonsai' };
const GEMMA_FROM = '2026-09-28';
export function modelOf(r) {
  if (r.model) return r.model;
  if (r.kind === 'suite' || /bge-m3/i.test(r.name)) return null; // the small matcher writes nothing: it is no chat model
  const folder = /models\/([^/]+)\/results/.exec(r.raw ?? '')?.[1];
  if (FOLDER_MODEL[folder]) return FOLDER_MODEL[folder];
  const words = `${r.name} ${r.note} ${r.code}`.toLowerCase();
  const named = [/gemma/.test(words) && 'gemma', /qwen/.test(words) && 'qwen', /bonsai|27b/.test(words) && 'bonsai'].filter(Boolean);
  if (named.length === 1) return named[0];
  if (named.length > 1 || r.kind === 'other') return null;
  return String(r.at) < GEMMA_FROM ? 'bonsai' : 'gemma';
}

// Every line of the record, newest first. A line that does not parse is skipped.
export function readRecord(file = recordFile()) {
  if (!existsSync(file)) return [];
  const byId = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r && r.id && KINDS[r.kind]) byId.set(r.id, { ...r, raw: rawPlace(r.raw), model: modelOf(r) }); } catch { /* a cut-off line */ }
  }
  return [...byId.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// Adds one run to the record. It never throws: a test must not fail because
// its result could not be written down. Returns the line, or null.
export function recordTest(row, { file = recordFile(), snapshot = true, quiet = false } = {}) {
  try {
    if (!KINDS[row?.kind] || !row.name) throw new Error('a line needs a kind (tasks, requests, bug, suite, other) and a name');
    const at = row.at ?? new Date().toISOString();
    const result = row.result ?? (row.total != null && row.passed != null ? (row.passed === row.total && row.total > 0 ? 'pass' : 'fail') : 'fail');
    const line = { id: row.id ?? `${row.kind}:${at}`, at, kind: row.kind, name: row.name, code: row.code ?? codeLabel(), model: row.model ?? null, effort: row.effort ?? null, ctx: row.ctx ?? null,
      passed: row.passed ?? null, total: row.total ?? null, secs: row.secs == null ? null : Math.round(row.secs), result, part: Boolean(row.part), note: row.note ?? '', raw: rawPlace(row.raw), page: row.page ?? '' };
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

// What the Tests tab and the snapshot page both show.
export function recordData(file = recordFile()) {
  return { rows: readRecord(file), kinds: KINDS, models: installedModels(), file: file.startsWith(homedir()) ? file.replace(homedir(), '~') : basename(file), made: new Date().toISOString() };
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
