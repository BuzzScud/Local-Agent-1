// Several windows in one project. Each open window notes its folder in windows/<pid>.json, so a
// second window opened in a project another window is working in can ask: work in its own copy,
// or share the folder (the user's pick, 1 Oct 2026).
//
// The own copy: a git project gets a git worktree of its last commit, with the folder's own
// unfinished changes and new files carried over; a folder without git, a plain copy. Big folders
// a package manager puts back (node_modules, .venv) are linked, not copied, so the tests still run.
// What the copy looked like at the start is kept in a private git store (never the project's own
// git), so putting the window's changes back carries only what this window changed: a file the
// other window did not touch goes straight back, one both changed is merged line by line, and one
// whose same lines both changed is left for you to decide. Everything here runs synchronously (a
// window closing still tidies up), with git as a separate program.
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, cpSync, symlinkSync,
  realpathSync, lstatSync, mkdtempSync,
} from 'node:fs';
import { join, relative, dirname, basename, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { HOME } from '../../../models/index.mjs';

const home = () => process.env.AGENTIC_HOME ?? HOME;
const WINDOWS = () => join(home(), 'windows');
const COPIES = () => join(home(), 'copies');
// Linked into a copy instead of copied (a package manager or a build puts them back).
const LINKED = ['node_modules', '.venv', 'venv'];
// Never copied, never counted as a change.
const SKIP = new Set([...LINKED, '.git', '__pycache__', '.next', '.nuxt', '.parcel-cache', '.turbo', '.DS_Store', '.agentic-check']);
export const MAX_FILES = 25_000; // a bigger folder is not copied

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const real = (p) => { try { return realpathSync(p); } catch { return p; } };
const within = (p, dir) => p === dir || p.startsWith(dir + sep);
// A program run to its end: { code, out (bytes), err (text) }.
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { timeout: 120_000, maxBuffer: 256 * 1024 * 1024, ...opts });
  return { code: r.status ?? -1, out: r.stdout ?? Buffer.alloc(0), err: String(r.stderr ?? r.error?.message ?? '') };
}
// git on the project itself (worktrees, the folder's changes).
const pgit = (dir, args, opts) => run('git', ['-C', dir, '-c', 'core.quotepath=off', ...args], { env: cleanEnv(), ...opts });
// git on the copy's private store: every GIT_ variable of the shell dropped, as rewind.mjs does.
function sgit(store, args, { work, index, input } = {}) {
  const env = { ...cleanEnv(), GIT_DIR: store, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  if (work) env.GIT_WORK_TREE = work;
  if (index) env.GIT_INDEX_FILE = index;
  const conf = ['-c', 'core.quotepath=off', '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', '-c', 'core.fsmonitor=false', '-c', 'gc.auto=0'];
  return run('git', [...conf, ...args], { cwd: work ?? store, env, input });
}
function cleanEnv() { return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))); }

// ---- the windows ---------------------------------------------------------------------------------

// The project a folder belongs to: its git top folder, else the folder itself.
export function projectOf(cwd) {
  const r = pgit(cwd, ['rev-parse', '--show-toplevel']);
  const top = r.code === 0 ? String(r.out).trim() : '';
  return top ? { root: real(top), git: true } : { root: real(cwd), git: false };
}

// This window is open in `cwd` (and, in its own copy, works for `copyOf`, the real project).
export function registerWindow(cwd, { copyOf = null, pid = process.pid } = {}) {
  const at = real(cwd);
  const entry = { pid, cwd: at, project: copyOf ?? projectOf(at).root, copy: Boolean(copyOf), started: new Date().toISOString(), task: null };
  try { mkdirSync(WINDOWS(), { recursive: true }); writeFileSync(join(WINDOWS(), `${pid}.json`), JSON.stringify(entry)); } catch {}
  return entry;
}
export function updateWindow(patch, { pid = process.pid } = {}) {
  const file = join(WINDOWS(), `${pid}.json`);
  try { writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), ...patch })); } catch {}
}
export function unregisterWindow({ pid = process.pid } = {}) { rmSync(join(WINDOWS(), `${pid}.json`), { force: true }); }

// Other open windows working in the project's own folder (not in copies of it); a closed window's
// file is removed on the way.
export function othersIn(root, { pid = process.pid } = {}) {
  let files = [];
  try { files = readdirSync(WINDOWS()).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of files) {
    let e;
    try { e = JSON.parse(readFileSync(join(WINDOWS(), f), 'utf8')); } catch { continue; }
    if (!alive(e.pid)) { rmSync(join(WINDOWS(), f), { force: true }); continue; }
    if (e.pid === pid || e.copy) continue;
    if (e.project === real(root)) out.push(e);
  }
  return out;
}

// The models other open windows use on a service (updateWindow's `service` and `models`), so a
// window never unloads one another is using (/subagents, 2 Oct 2026).
export function modelsInUseOn(service, { pid = process.pid } = {}) {
  let files = [];
  try { files = readdirSync(WINDOWS()).filter((f) => f.endsWith('.json')); } catch { return new Set(); }
  const out = new Set();
  for (const f of files) {
    let e;
    try { e = JSON.parse(readFileSync(join(WINDOWS(), f), 'utf8')); } catch { continue; }
    if (e.pid === pid || !alive(e.pid) || e.service !== service) continue;
    for (const m of e.models ?? []) out.add(m);
  }
  return out;
}

// ---- the copy ------------------------------------------------------------------------------------

const metaFile = (id) => join(COPIES(), id, 'meta.json');
const storeOf = (id) => join(COPIES(), id, 'base.git');
const readMeta = (id) => { try { return JSON.parse(readFileSync(metaFile(id), 'utf8')); } catch { return null; } };
const saveMeta = (m) => writeFileSync(metaFile(m.id), JSON.stringify(m, null, 2));

// The copy a folder is in (a window opened inside one, or one that moved there), else null.
export function copyAt(cwd) {
  const at = real(cwd), root = real(COPIES());
  if (!within(at, root)) return null;
  const id = relative(root, at).split(sep)[0];
  const m = readMeta(id);
  return m && within(at, m.dir) ? m : null;
}

// The copy's files as they are now, as a tree in its store (what changed is the difference of two).
function snapshot(m) {
  const index = join(COPIES(), m.id, 'index');
  const add = sgit(storeOf(m.id), ['add', '-A', '--', '.'], { work: m.dir, index });
  if (add.code !== 0) throw new Error(`could not read the copy (${add.err.trim().split('\n')[0]})`);
  const t = sgit(storeOf(m.id), ['write-tree'], { work: m.dir, index });
  if (t.code !== 0) throw new Error(`could not read the copy (${t.err.trim().split('\n')[0]})`);
  return String(t.out).trim();
}

// Counts files the way a copy would take them; stops past `max`.
function countFiles(dir, max) {
  let n = 0;
  const walk = (d) => {
    let names;
    try { names = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      if (SKIP.has(e.name)) continue;
      if (e.isDirectory()) walk(join(d, e.name)); else n++;
      if (n > max) return;
    }
  };
  walk(dir);
  return n;
}

// Makes this window's own copy of the project `cwd` is in. Answers the copy's record:
// { id, original, rel, dir, work (where this window works: cwd's place in the copy), kind, base }.
export function makeCopy(cwd, { now = new Date() } = {}) {
  const at = real(cwd);
  const p = projectOf(at);
  const rel = relative(p.root, at);
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const id = `${basename(p.root).replace(/[^\w.-]+/g, '-').slice(0, 40) || 'project'}-${stamp}-${process.pid}`;
  const base = join(COPIES(), id);
  const dir = join(base, 'work');
  mkdirSync(base, { recursive: true });
  let kind = 'plain';
  try {
    // A git project with a commit: a worktree of it, then the folder's own changes and new files.
    if (p.git && pgit(p.root, ['rev-parse', '--verify', '-q', 'HEAD']).code === 0) {
      const w = pgit(p.root, ['worktree', 'add', '--detach', dir, 'HEAD']);
      if (w.code !== 0) throw new Error(`git worktree: ${w.err.trim().split('\n').at(-1)}`);
      kind = 'worktree';
      const diff = pgit(p.root, ['diff', '--binary', 'HEAD']);
      if (diff.code === 0 && diff.out.length) {
        const a = pgit(dir, ['apply', '--binary', '--whitespace=nowarn', '-'], { input: diff.out });
        if (a.code !== 0) throw new Error(`could not carry the folder's unsaved changes over (${a.err.trim().split('\n')[0]})`);
      }
      const extra = pgit(p.root, ['ls-files', '--others', '--exclude-standard', '-z']);
      for (const f of String(extra.out).split('\0').filter(Boolean)) {
        if (f.split('/').some((x) => SKIP.has(x))) continue;
        mkdirSync(dirname(join(dir, f)), { recursive: true });
        try { cpSync(join(p.root, f), join(dir, f), { dereference: false }); } catch {}
      }
    } else {
      if (countFiles(p.root, MAX_FILES) > MAX_FILES) throw new Error(`the folder has more than ${MAX_FILES.toLocaleString('en-US')} files, too many to copy`);
      cpSync(p.root, dir, { recursive: true, verbatimSymlinks: true, filter: (src) => src === p.root || !SKIP.has(basename(src)) });
    }
    // The packages, linked: the copy's tests and builds run as the folder's do.
    for (const name of LINKED) {
      const from = join(p.root, name), to = join(dir, name);
      try { if (lstatSync(from).isDirectory() && !existsSync(to)) symlinkSync(from, to); } catch {}
    }
    // The private store of what the copy looked like at the start.
    const init = run('git', ['init', '-q', '--bare', storeOf(id)], { env: cleanEnv() });
    if (init.code !== 0) throw new Error(`could not keep the copy's start (${init.err.trim()})`);
    mkdirSync(join(storeOf(id), 'info'), { recursive: true });
    writeFileSync(join(storeOf(id), 'info', 'exclude'), `${[...SKIP].map((s) => `/${s}`).join('\n')}\n${[...SKIP].join('\n')}\n`);
    const m = { id, original: p.root, rel, dir, work: rel ? join(dir, rel) : dir, kind, created: now.toISOString(), pid: process.pid, applied: {} };
    saveMeta(m);
    m.base = snapshot(m);
    saveMeta(m);
    return m;
  } catch (e) {
    removeCopy({ id, original: p.root, dir, kind });
    throw e;
  }
}

// Removes a copy (its worktree from the project's list too). Only ever under COPIES().
export function removeCopy(m) {
  const base = join(COPIES(), m.id);
  if (!m.id || !within(real(base), real(COPIES())) || real(base) === real(COPIES())) return;
  if (m.kind === 'worktree') pgit(m.original, ['worktree', 'remove', '--force', m.dir]);
  rmSync(base, { recursive: true, force: true });
  if (m.kind === 'worktree') pgit(m.original, ['worktree', 'prune']);
}

// What this window changed in its copy and has not put back: [{ path, status: A|M|D, from, to }]
// (from/to: the file's ids at the start and now; a file put back starts from what was put back).
export function copyChanges(m) {
  const end = snapshot(m);
  const d = sgit(storeOf(m.id), ['diff-tree', '-r', '--no-renames', '-z', m.base, end]);
  if (d.code !== 0) throw new Error(`could not compare the copy (${d.err.trim()})`);
  const parts = String(d.out).split('\0');
  const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const meta = parts[i].replace(/^:/, '').split(' ');
    if (meta.length < 5) continue;
    const [, , from, to, status] = meta;
    const path = parts[i + 1];
    const put = m.applied?.[path];
    if (put !== undefined && put === (status === 'D' ? null : to)) continue; // already put back as it is
    out.push({ path, status: status[0], from: put ?? (status === 'A' ? null : from), to: status === 'D' ? null : to });
  }
  return { end, changes: out };
}

const blob = (m, id) => (id ? sgit(storeOf(m.id), ['cat-file', 'blob', id]).out : null);
const same = (a, b) => (a == null && b == null) || (a != null && b != null && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0);
const isBinary = (b) => b && b.subarray(0, 8000).includes(0);

// Puts the copy's changes back into the real folder. A file the folder still has as it was at the
// start takes the copy's version; one changed on both sides is merged (git merge-file), and kept
// back as a conflict when the same lines changed (or it is not text). only: put back just these
// paths; force: the copy's version wins for every file. Answers { applied, conflicts, merged }.
export function putBack(m, { only = null, force = false } = {}) {
  const { changes } = copyChanges(m);
  const applied = [], conflicts = [], merged = [];
  for (const c of changes) {
    if (only && !only.includes(c.path)) continue;
    const target = join(m.original, c.path);
    if (!within(target, m.original)) continue;
    const baseBuf = blob(m, c.from);
    const mine = c.to ? blob(m, c.to) : null;
    let theirs = null;
    try { if (lstatSync(target).isFile()) theirs = readFileSync(target); } catch {}
    let write = undefined; // undefined: leave it; null: remove it; a buffer: write it
    if (same(theirs, mine)) { applied.push(c.path); continue; } // the folder has it already
    if (force || same(theirs, baseBuf)) write = mine;
    else if (mine && baseBuf && theirs && !isBinary(mine) && !isBinary(baseBuf) && !isBinary(theirs)) {
      const dir = mkdtempSync(join(tmpdir(), 'agentic-merge-'));
      const [a, o, b] = ['theirs', 'base', 'mine'].map((n) => join(dir, n));
      writeFileSync(a, theirs); writeFileSync(o, baseBuf); writeFileSync(b, mine);
      const r = run('git', ['merge-file', '-p', a, o, b], { env: cleanEnv() });
      rmSync(dir, { recursive: true, force: true });
      if (r.code === 0) { write = r.out; merged.push(c.path); } else { conflicts.push(c.path); continue; }
    } else { conflicts.push(c.path); continue; }
    try {
      if (write === null) rmSync(target, { force: true });
      else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, write); }
      m.applied = { ...(m.applied ?? {}), [c.path]: c.to };
      applied.push(c.path);
    } catch { conflicts.push(c.path); }
  }
  saveMeta(m);
  return { applied, conflicts, merged };
}

// The copy's changes as a diff, cut to `maxLines` (for "Show me the changes first").
export function copyDiff(m, { maxLines = 120 } = {}) {
  const { end, changes } = copyChanges(m);
  if (!changes.length) return '';
  const d = sgit(storeOf(m.id), ['diff', '--no-color', '--stat', '-p', m.base, end, '--', ...changes.map((c) => c.path)]);
  const lines = String(d.out).split('\n');
  return lines.length > maxLines ? `${lines.slice(0, maxLines).join('\n')}\n… ${lines.length - maxLines} more lines` : lines.join('\n');
}

// Copies kept for a project with changes not put back (a window that closed with them).
export function keptCopies(root) {
  let ids = [];
  try { ids = readdirSync(COPIES()); } catch { return []; }
  return ids.map(readMeta).filter((m) => m && m.original === real(root) && !alive(m.pid) && existsSync(m.dir));
}

// Lines of the changes for a question: "export.mjs  +18 −2" (counted from the copy's start).
export function changeLines(m, changes) {
  const out = [];
  for (const c of changes) {
    const a = c.from ? String(blob(m, c.from)) : '';
    const b = c.to ? String(blob(m, c.to)) : '';
    const r = run('git', ['diff', '--no-index', '--numstat', '--', fileFor(a), fileFor(b)], { env: cleanEnv() });
    const [add = '0', del = '0'] = String(r.out).trim().split(/\s+/);
    out.push({ path: c.path, add: Number(add) || 0, del: Number(del) || 0, status: c.status });
  }
  tidyTemp();
  return out;
}
let temp = null;
function fileFor(text) { temp ??= mkdtempSync(join(tmpdir(), 'agentic-count-')); const f = join(temp, String(Math.random()).slice(2)); writeFileSync(f, text); return f; }
function tidyTemp() { if (temp) rmSync(temp, { recursive: true, force: true }); temp = null; }
