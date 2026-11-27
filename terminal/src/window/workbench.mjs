// The workbench's calls (26 Nov 2026, the owner: "i want to make them both like vs code, it does everything"; picks: our own
// workbench with VS Code's editor part, files, editor tabs, search, source control, terminal, problems and a command
// palette, in the window and on hearth alike). The window's page (workbench.js) draws the panes; this file is what they
// ask: the folder's files, one file read and saved, a search of every file, git's state and its few changes, a quick
// check of one file, and a real shell for the terminal pane. Everything stays inside the window's folder (`inside`), and
// nothing here is offered to the model: these are the person's own hands, as Finder and Terminal are.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync, openSync, readSync, closeSync, watch } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { walk, globToRegExp } from '../tools/fs.mjs';

export const READ_MAX = 2_000_000; // a file past this opens as its first part, and is not saved over
const FILES_MAX = 20_000; // the names Go to file offers
const HITS_MAX = 2_000; // lines one search gives back

// Where a package the page needs is (monaco-editor, @xterm/xterm): beside this source, in the copy of GitHub's main the
// app was built from (AGENTIC_BUILD), or in the repo the launcher names; as the design studio finds tailwindcss.
export function packageDir(name, probe) {
  const tries = [];
  try { tries.push(dirname(createRequire(import.meta.url).resolve(`${name}/package.json`))); } catch {}
  for (const root of [process.env.AGENTIC_BUILD, process.env.AGENTIC_REPO]) if (root) tries.push(join(root, 'node_modules', name));
  try { tries.push(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'node_modules', name)); } catch {}
  tries.push(join(homedir(), '.agentic-coder', 'build', 'main', 'node_modules', name));
  return tries.find((d) => existsSync(join(d, probe))) ?? null;
}
// The page's packages by the address they are served at. A missing one answers 404 and the page does without it (a
// plain text box for the editor, no terminal pane).
const STATIC = {
  '/vs/': () => { const d = packageDir('monaco-editor', 'min/vs/loader.js'); return d && join(d, 'min', 'vs'); },
  '/xterm/': () => packageDir('@xterm/xterm', 'lib/xterm.mjs'),
  '/xterm-fit/': () => packageDir('@xterm/addon-fit', 'lib/addon-fit.mjs'),
};
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.map': 'application/json' };
// A package's file for an address like /vs/editor/editor.main.js, or null: only files inside the package's folder.
export function staticFile(pathname) {
  for (const [prefix, dirOf] of Object.entries(STATIC)) {
    if (!pathname.startsWith(prefix)) continue;
    const root = dirOf();
    if (!root) return null;
    let rel; try { rel = decodeURIComponent(pathname.slice(prefix.length)); } catch { return null; }
    const abs = resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + sep)) return null;
    try { if (!statSync(abs).isFile()) return null; } catch { return null; }
    return { file: abs, type: TYPES[extname(abs).toLowerCase()] ?? 'application/octet-stream' };
  }
  return null;
}

const real = (p) => { try { return realpathSync(p); } catch { return null; } };
// A path of the folder as a real place inside it, or null: no way out by .., an absolute path or a link. A file not
// made yet counts by the folder it would be in.
export function inside(folder, rel) {
  const root = real(folder);
  if (!root || typeof rel !== 'string' || rel.includes('\0')) return null;
  const abs = resolve(root, rel || '.');
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  let at = abs;
  while (!existsSync(at) && at !== root) at = dirname(at);
  const r = real(at);
  if (!r || (r !== root && !r.startsWith(root + sep))) return null;
  return abs;
}
const relOf = (folder, abs) => relative(real(folder) ?? folder, abs).split(sep).join('/');
const stampOf = (abs) => { try { const s = statSync(abs); return `${Math.round(s.mtimeMs)}:${s.size}`; } catch { return null; } };
// Folders the tree shows closed and greyed and the search skips: bulky, never yours to read.
const HEAVY = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', '.cache', 'coverage', '.turbo', 'target']);

// One folder's entries (the tree opens a folder at a time): folders first, then files, by name. Hidden files show, as
// in VS Code; .git and .DS_Store do not.
export function treeOf(folder, rel = '') {
  const abs = inside(folder, rel);
  if (!abs) return { error: 'That is outside this folder.' };
  let list;
  try { list = readdirSync(abs, { withFileTypes: true }); } catch (e) { return { error: `Cannot open ${rel || 'the folder'}: ${e.code ?? e.message}` }; }
  const entries = [];
  for (const e of list) {
    if (e.name === '.git' || e.name === '.DS_Store') continue;
    let dir = e.isDirectory();
    if (e.isSymbolicLink()) { try { dir = statSync(join(abs, e.name)).isDirectory(); } catch { continue; } }
    else if (!dir && !e.isFile()) continue;
    entries.push({ name: e.name, path: rel ? `${rel}/${e.name}` : e.name, dir, ...(dir && HEAVY.has(e.name) ? { heavy: true } : {}) });
  }
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.dir ? -1 : 1));
  return { path: rel, entries };
}

const git = (folder, args, opts = {}) => spawnSync('git', args, { cwd: folder, encoding: 'utf8', maxBuffer: 64e6, timeout: 30_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }, ...opts });
const isRepo = (folder) => { const r = git(folder, ['rev-parse', '--is-inside-work-tree']); return r.status === 0 && r.stdout.trim() === 'true'; };
// The folder's place in its repository ("" at the top, "web/" one down): git names paths from the top.
const prefixOf = (folder) => { const r = git(folder, ['rev-parse', '--show-prefix']); return r.status === 0 ? r.stdout.trim() : ''; };

// Every file's name, for Go to file: git's own list in a repository (tracked and new, never an ignored one), else a walk.
export function allFiles(folder, max = FILES_MAX) {
  if (isRepo(folder)) {
    const r = git(folder, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
    if (r.status === 0) {
      const files = [...new Set(r.stdout.split('\0').filter(Boolean))];
      return { files: files.slice(0, max), cut: files.length > max };
    }
  }
  const files = [];
  for (const f of walk(folder)) { if (f.dir) continue; files.push(f.path.split(sep).join('/')); if (files.length > max) break; }
  return { files: files.slice(0, max), cut: files.length > max };
}

const looksBinary = (buf) => { for (let i = 0; i < Math.min(buf.length, 8192); i++) if (buf[i] === 0) return true; return false; };
// One file as the editor opens it: its text, and a stamp (when it last changed and its size) a save hands back, so a
// file something else changed since is never written over unseen.
export function readOne(folder, rel) {
  const abs = inside(folder, rel);
  if (!abs) return { error: 'That is outside this folder.' };
  let st; try { st = statSync(abs); } catch { return { error: `${rel} is not there.`, gone: true }; }
  if (!st.isFile()) return { error: `${rel} is not a file.` };
  const cut = st.size > READ_MAX;
  let buf;
  try {
    if (cut) { const fd = openSync(abs, 'r'); buf = Buffer.alloc(READ_MAX); readSync(fd, buf, 0, READ_MAX, 0); closeSync(fd); }
    else buf = readFileSync(abs);
  } catch (e) { return { error: `Cannot read ${rel}: ${e.code ?? e.message}` }; }
  if (looksBinary(buf)) return { path: rel, binary: true, size: st.size, stamp: stampOf(abs) };
  return { path: rel, text: buf.toString('utf8'), size: st.size, stamp: stampOf(abs), ...(cut ? { cut: true } : {}) };
}
// Save one file. stamp: the one its read gave (null for a new file); `force` writes over a file that changed since.
export function saveOne(folder, rel, text, { stamp = null, force = false } = {}) {
  const abs = inside(folder, rel);
  if (!abs || !rel) return { ok: false, why: 'That is outside this folder.' };
  if (typeof text !== 'string') return { ok: false, why: 'Nothing to save.' };
  const now = stampOf(abs);
  if (now && !force && stamp !== now) return { ok: false, changed: true, why: `${rel} changed on disk since you opened it.`, stamp: now };
  if (now && statSync(abs).isDirectory()) return { ok: false, why: `${rel} is a folder.` };
  try { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, text); } catch (e) { return { ok: false, why: `Cannot save ${rel}: ${e.code ?? e.message}` }; }
  return { ok: true, stamp: stampOf(abs), made: !now };
}
// A new file or folder, a new name, and the Trash (the Mac's own, so it comes back from there; never a delete).
export function makeOne(folder, rel, { dir = false } = {}) {
  const abs = inside(folder, rel);
  if (!abs || !rel) return { ok: false, why: 'That is outside this folder.' };
  if (existsSync(abs)) return { ok: false, why: `${rel} is there already.` };
  try { if (dir) mkdirSync(abs, { recursive: true }); else { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, '', { flag: 'wx' }); } } catch (e) { return { ok: false, why: `Cannot make ${rel}: ${e.code ?? e.message}` }; }
  return { ok: true, path: relOf(folder, abs), dir };
}
export function renameOne(folder, from, to) {
  const a = inside(folder, from), b = inside(folder, to);
  if (!a || !b || !from || !to) return { ok: false, why: 'That is outside this folder.' };
  if (!existsSync(a)) return { ok: false, why: `${from} is not there.` };
  if (existsSync(b)) return { ok: false, why: `${to} is there already.` };
  try { mkdirSync(dirname(b), { recursive: true }); renameSync(a, b); } catch (e) { return { ok: false, why: `Cannot rename ${from}: ${e.code ?? e.message}` }; }
  return { ok: true, path: relOf(folder, b) };
}
export function trashOne(folder, rel, { trash = join(homedir(), '.Trash') } = {}) {
  const abs = inside(folder, rel);
  if (!abs || !rel) return { ok: false, why: 'That is outside this folder.' };
  if (!existsSync(abs)) return { ok: false, why: `${rel} is not there.` };
  try {
    mkdirSync(trash, { recursive: true });
    let to = join(trash, basename(abs));
    for (let n = 2; existsSync(to); n++) to = join(trash, `${basename(abs, extname(abs))} ${n}${extname(abs)}`);
    renameSync(abs, to);
    return { ok: true, to };
  } catch (e) { return { ok: false, why: `Cannot move ${rel} to the Trash: ${e.code ?? e.message}` }; }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Find in files. query as typed; regex, matchCase, word as VS Code's three switches; include: "*.mjs, src/**" (commas).
// → { hits: [{ path, line, col, len, text }], total, files, cut }. A repository is searched by git (its ignore rules
// hold, new files count); any other folder by a walk that skips the bulky folders.
export function searchAll(folder, { query = '', regex = false, matchCase = false, word = false, include = '', max = HITS_MAX } = {}) {
  if (!query) return { hits: [], total: 0, files: 0 };
  let re;
  try { re = new RegExp(`${word ? '\\b(?:' : ''}${regex ? query : escapeRe(query)}${word ? ')\\b' : ''}`, matchCase ? 'g' : 'gi'); } catch (e) { return { error: `That is not a pattern: ${e.message}` }; }
  const globs = String(include).split(',').map((s) => s.trim()).filter(Boolean).map((g) => (g.includes('/') ? g : `**/${g}`));
  const hits = []; let total = 0; const seen = new Set();
  const add = (path, line, text) => {
    re.lastIndex = 0;
    const m = re.exec(text);
    total++; seen.add(path);
    if (hits.length < max) hits.push({ path, line, col: (m?.index ?? 0) + 1, len: m?.[0]?.length ?? 0, text: text.length > 400 ? text.slice(0, 400) : text });
  };
  if (isRepo(folder)) {
    const args = ['grep', '-n', '-I', '-z', '--untracked', regex ? '-E' : '-F', ...(matchCase ? [] : ['-i']), ...(word ? ['-w'] : []), '-e', query, '--', ...(globs.length ? globs.map((g) => `:(glob)${g}`) : ['.'])];
    const r = git(folder, args);
    if (r.status === 0 || r.status === 1) {
      for (const row of r.stdout.split('\n')) {
        if (!row) continue;
        const [path, line, ...rest] = row.split('\0');
        if (rest.length) add(path, Number(line), rest.join('\0'));
      }
      return { hits, total, files: seen.size, ...(total > hits.length ? { cut: true } : {}) };
    }
    if (regex) return { error: `git could not use that pattern: ${String(r.stderr ?? '').trim().split('\n')[0]}` };
  }
  const tests = globs.map((g) => globToRegExp(g));
  const until = Date.now() + 8000;
  for (const f of walk(folder)) {
    if (Date.now() > until) return { hits, total, files: seen.size, cut: true };
    if (f.dir) continue;
    const path = f.path.split(sep).join('/');
    if (tests.length && !tests.some((t) => t.test(path))) continue;
    let text;
    try { const abs = join(folder, f.path); if (statSync(abs).size > READ_MAX) continue; text = readFileSync(abs, 'utf8'); } catch { continue; }
    if (text.includes('\0')) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) { re.lastIndex = 0; if (re.test(lines[i])) add(path, i + 1, lines[i]); }
  }
  return { hits, total, files: seen.size, ...(total > hits.length ? { cut: true } : {}) };
}

const STATUS = { M: 'changed', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'changed', U: 'conflict', '?': 'new' };
// Source control as the pane shows it: the branch, how far ahead and behind, and each changed file once per side
// (staged: in the next commit; not staged: in the folder only). Paths are from this folder; a change elsewhere in a
// larger repository is counted (`elsewhere`), not listed.
export function gitState(folder) {
  if (!isRepo(folder)) return { repo: false };
  const r = git(folder, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']);
  if (r.status !== 0) return { repo: true, error: String(r.stderr ?? '').trim().split('\n')[0] || 'git status failed' };
  const prefix = prefixOf(folder);
  // remote: whether there is anywhere to push to at all (a repository made on this Mac has none)
  const out = { repo: true, branch: null, upstream: null, ahead: 0, behind: 0, files: [], elsewhere: 0, remote: Boolean(git(folder, ['remote']).stdout?.trim()) };
  const parts = r.stdout.split('\0');
  const here = (p) => { if (!prefix) return p; if (!p.startsWith(prefix)) { out.elsewhere++; return null; } return p.slice(prefix.length); };
  const push = (path, code, staged, old) => { const p = here(path); if (p != null) out.files.push({ path: p, status: STATUS[code] ?? 'changed', code, staged, ...(old ? { old } : {}) }); };
  for (let i = 0; i < parts.length; i++) {
    const row = parts[i];
    if (!row) continue;
    if (row.startsWith('# branch.head ')) out.branch = row.slice(14);
    else if (row.startsWith('# branch.upstream ')) out.upstream = row.slice(18);
    else if (row.startsWith('# branch.ab ')) { const m = /\+(\d+) -(\d+)/.exec(row); if (m) { out.ahead = Number(m[1]); out.behind = Number(m[2]); } }
    else if (row[0] === '1' || row[0] === '2') {
      const f = row.split(' ');
      const xy = f[1], path = f.slice(row[0] === '1' ? 8 : 9).join(' ');
      const old = row[0] === '2' ? parts[++i] : null;
      if (xy[0] !== '.') push(path, xy[0], true, old);
      if (xy[1] !== '.') push(path, xy[1], false, null);
    } else if (row[0] === 'u') { push(row.split(' ').slice(10).join(' '), 'U', false, null); }
    else if (row[0] === '?') push(row.slice(2), '?', false, null);
  }
  out.files.sort((a, b) => a.path.localeCompare(b.path) || Number(b.staged) - Number(a.staged));
  if (out.branch === '(detached)') { const h = git(folder, ['rev-parse', '--short', 'HEAD']); out.branch = h.status === 0 ? `detached at ${h.stdout.trim()}` : 'detached'; out.detached = true; }
  return out;
}
const shown = (folder, spec) => { const r = git(folder, ['show', spec], { encoding: 'buffer' }); return r.status === 0 ? r.stdout : null; };
// One changed file's two sides for the diff view. staged: the last commit against what is staged; else what is staged
// (the last commit when nothing is) against the file in the folder.
export function gitDiff(folder, rel, { staged = false } = {}) {
  const abs = inside(folder, rel);
  if (!abs || !isRepo(folder)) return { error: 'There is no change to show.' };
  const p = `${prefixOf(folder)}${rel}`;
  const a = staged ? shown(folder, `HEAD:${p}`) : (shown(folder, `:${p}`) ?? shown(folder, `HEAD:${p}`));
  let b;
  if (staged) b = shown(folder, `:${p}`);
  else { try { b = readFileSync(abs); } catch { b = null; } }
  if ((a && looksBinary(a)) || (b && looksBinary(b))) return { path: rel, binary: true };
  return { path: rel, before: a ? a.toString('utf8') : '', after: b ? b.toString('utf8') : '', stamp: staged ? null : stampOf(abs) };
}
const BRANCH_OK = /^(?!-)(?!.*\.\.)(?!.*[\s~^:?*[\\])[\w./-]{1,200}$/;
// What the Source control pane does. Each answers { ok } or { ok: false, why } in git's own first line.
// stage · unstage · discard (a tracked file back to its last commit; a new file to the Trash) · commit · branches ·
// checkout · branch (a new one, from here) · init · log · push (asked about in the page first: it leaves this Mac).
export function gitDo(folder, op, a = {}) {
  const said = (r) => (r.status === 0 ? { ok: true } : { ok: false, why: String(r.stderr || r.stdout || '').trim().split('\n').filter(Boolean).pop() || `git ${op} failed` });
  const paths = (Array.isArray(a.paths) ? a.paths : [a.path]).filter((p) => typeof p === 'string' && p && inside(folder, p));
  if (op === 'init') return isRepo(folder) ? { ok: false, why: 'This folder is in a repository already.' } : said(git(folder, ['init']));
  if (!isRepo(folder)) return { ok: false, why: 'This folder is not in a git repository.' };
  if (op === 'stage') return a.all ? said(git(folder, ['add', '-A', '--', '.'])) : paths.length ? said(git(folder, ['add', '-A', '--', ...paths])) : { ok: false, why: 'Nothing to stage.' };
  if (op === 'unstage') {
    const hasHead = git(folder, ['rev-parse', '--verify', 'HEAD']).status === 0;
    const what = a.all ? ['.'] : paths;
    if (!what.length) return { ok: false, why: 'Nothing to take out.' };
    return said(hasHead ? git(folder, ['reset', '-q', 'HEAD', '--', ...what]) : git(folder, ['rm', '-r', '-q', '--cached', '--', ...what]));
  }
  if (op === 'discard') {
    if (!paths.length) return { ok: false, why: 'Nothing to put back.' };
    const state = gitState(folder);
    for (const p of paths) {
      const rows = (state.files ?? []).filter((f) => f.path === p && !f.staged);
      if (rows.some((f) => f.code === '?')) { const t = trashOne(folder, p); if (!t.ok) return t; continue; }
      const r = git(folder, ['checkout', '--', p]);
      if (r.status !== 0) return said(r);
    }
    return { ok: true };
  }
  if (op === 'commit') {
    const message = String(a.message ?? '').trim();
    if (!message) return { ok: false, why: 'Write what the commit is first.' };
    if (a.all) { const r = git(folder, ['add', '-A', '--', '.']); if (r.status !== 0) return said(r); }
    const r = git(folder, ['commit', '-m', message]);
    if (r.status !== 0) return said(r);
    const h = git(folder, ['rev-parse', '--short', 'HEAD']);
    return { ok: true, commit: h.stdout.trim() };
  }
  if (op === 'branches') {
    const r = git(folder, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)%00%(HEAD)%00%(committerdate:relative)%00%(subject)', 'refs/heads']);
    if (r.status !== 0) return said(r);
    return { ok: true, branches: r.stdout.split('\n').filter(Boolean).map((l) => { const [name, head, when, subject] = l.split('\0'); return { name, current: head === '*', when, subject }; }) };
  }
  if (op === 'checkout' || op === 'branch') {
    const name = String(a.name ?? '').trim();
    if (!BRANCH_OK.test(name)) return { ok: false, why: 'That is not a name a branch can have.' };
    return said(git(folder, op === 'branch' ? ['checkout', '-b', name] : ['checkout', name]));
  }
  if (op === 'log') {
    const r = git(folder, ['log', '-n', String(Math.min(Number(a.max) || 30, 200)), '--format=%h%x00%an%x00%cr%x00%s']);
    if (r.status !== 0) return { ok: true, commits: [] };
    return { ok: true, commits: r.stdout.split('\n').filter(Boolean).map((l) => { const [hash, who, when, subject] = l.split('\0'); return { hash, who, when, subject }; }) };
  }
  // What a commit would hold, as git shows it, for the message the model writes (workbench-ai.js): what is staged, else
  // every change with the new files' first lines; and the last commits' subjects, for their style.
  if (op === 'patch') {
    const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more characters)` : s);
    const d = git(folder, ['diff', '--no-color', '--no-ext-diff', ...(a.staged ? ['--cached'] : ['HEAD']), '--', '.']);
    let patch = d.status === 0 ? d.stdout : git(folder, ['diff', '--no-color', '--', '.']).stdout ?? '';
    if (!a.staged) for (const f of gitState(folder).files.filter((x) => x.code === '?').slice(0, 20)) {
      const abs = inside(folder, f.path); let head = '';
      try { if (statSync(abs).size < 200_000) head = readFileSync(abs, 'utf8').split('\n').slice(0, 40).join('\n'); } catch {}
      patch += `\nnew file ${f.path}\n${head}\n`;
    }
    if (!patch.trim()) return { ok: false, why: a.staged ? 'Nothing is staged.' : 'Nothing has changed.' };
    const log = git(folder, ['log', '-n', '8', '--format=%s']);
    return { ok: true, patch: cut(patch, 60_000), log: log.status === 0 ? log.stdout.trim() : '' };
  }
  if (op === 'push') {
    const state = gitState(folder);
    if (!state.branch || state.detached) return { ok: false, why: 'There is no branch to push.' };
    if (!state.remote) return { ok: false, why: 'This repository has nowhere to push to yet (no remote).' };
    const r = git(folder, state.upstream ? ['push'] : ['push', '-u', 'origin', state.branch], { timeout: 120_000 });
    return said(r);
  }
  return { ok: false, why: `The workbench has no "${op}".` };
}

// A quick check of one file after a save, in its own language's words: where and what. Nothing is installed for it:
// JavaScript and JSON by Bun's own reader, Python by the Mac's python3 when there is one. → [{ path, line, col, message, severity }]
export function checkOne(folder, rel) {
  const abs = inside(folder, rel);
  if (!abs) return [];
  const ext = extname(rel).toLowerCase();
  let text; try { if (statSync(abs).size > READ_MAX) return []; text = readFileSync(abs, 'utf8'); } catch { return []; }
  const out = [];
  const add = (line, col, message) => out.push({ path: rel, line: Math.max(1, line || 1), col: Math.max(1, col || 1), message: String(message).slice(0, 300), severity: 'error' });
  if (ext === '.json') {
    try { JSON.parse(text); } catch (e) {
      // JSON's own reader names no place here: the same text read as JavaScript does, one letter along on its first line.
      let at = null;
      try { new Bun.Transpiler({ loader: 'js' }).transformSync(`(${text}\n)`); } catch (x) { const p = (x?.errors?.length ? x.errors : [x])[0]?.position; if (p?.line) at = { line: p.line, col: p.line === 1 ? p.column - 1 : p.column }; }
      add(at?.line ?? 1, at?.col ?? 1, e.message);
    }
  } else if (['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts'].includes(ext)) {
    try { new Bun.Transpiler({ loader: ext === '.mjs' || ext === '.cjs' || ext === '.js' ? 'jsx' : ext.replace(/^\.[mc]?/, '') }).transformSync(text); } catch (e) {
      const errs = e?.errors?.length ? e.errors : [e];
      for (const x of errs.slice(0, 20)) add(x?.position?.line, x?.position?.column, x?.message ?? String(x));
    }
  } else if (ext === '.py') {
    const r = spawnSync('python3', ['-I', '-c', 'import ast,sys\ntry:\n ast.parse(open(sys.argv[1],encoding="utf-8").read(), sys.argv[1])\nexcept SyntaxError as e:\n print(f"{e.lineno or 1}\\t{e.offset or 1}\\t{e.msg}")', abs], { encoding: 'utf8', timeout: 10_000 });
    for (const l of String(r.stdout ?? '').split('\n')) { const [line, col, ...m] = l.split('\t'); if (m.length) add(Number(line), Number(col), m.join(' ')); }
  }
  return out;
}

// The terminal pane's shells: the person's own login shell in the folder, each in a pretend terminal of its own.
// data(id, text) gets what it prints; ended(id, code) when it ends. Closed with the window.
export function makeShells({ folder, env = process.env, data = () => {}, ended = () => {}, max = 6 } = {}) {
  const shells = new Map();
  const dec = () => new TextDecoder('utf-8');
  return {
    open(id, { cols = 100, rows = 24 } = {}) {
      if (shells.has(id)) return { ok: true, id };
      if (shells.size >= max) return { ok: false, why: `${max} terminals are open already.` };
      const shell = env.SHELL && existsSync(env.SHELL) ? env.SHELL : '/bin/zsh';
      const d = dec();
      const childEnv = { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'agentic-coder' };
      for (const k of ['AGENTIC_WINDOW_SOCK', 'AGENTIC_WINDOW_KEY', 'AGENTIC_WINDOW_CHILD', 'AGENTIC_WINDOW_URL', 'AGENTIC_IN_HOST']) delete childEnv[k];
      let proc;
      try { proc = Bun.spawn([shell, '-l'], { cwd: folder, env: childEnv, terminal: { cols, rows, data(_t, bytes) { data(id, d.decode(bytes, { stream: true })); } } }); } catch (e) { return { ok: false, why: `The shell did not start: ${e.message}` }; }
      shells.set(id, proc);
      proc.exited.then((code) => { if (shells.get(id) === proc) { shells.delete(id); ended(id, code); } });
      return { ok: true, id };
    },
    write(id, text) { try { shells.get(id)?.terminal?.write(text); } catch {} },
    resize(id, cols, rows) { try { shells.get(id)?.terminal?.resize(Math.max(20, Math.min(400, cols | 0)), Math.max(4, Math.min(200, rows | 0))); } catch {} },
    close(id) { const p = shells.get(id); if (!p) return; shells.delete(id); try { p.terminal?.close(); } catch {} try { p.kill('SIGHUP'); } catch {} },
    closeAll() { for (const id of [...shells.keys()]) this.close(id); },
    get size() { return shells.size; },
  };
}

// Tell the page when files change under the folder (the model's edits, a command, you in another app), so the tree,
// the open files and Source control follow. Changes are gathered for a moment and sent as one list; the bulky folders
// and git's own are left out. → { close() }
export function watchFolder(folder, changed, { wait = 250 } = {}) {
  let timer = null; const paths = new Set(); let w = null;
  const flush = () => { timer = null; const list = [...paths].slice(0, 500); paths.clear(); if (list.length) changed(list); };
  try {
    w = watch(folder, { recursive: true }, (_kind, name) => {
      if (!name) return;
      const p = String(name).split(sep).join('/');
      const top = p.split('/')[0];
      if (HEAVY.has(top) && top !== '.git') return;
      if (top === '.git' && !/^\.git\/(HEAD|index|refs\/)/.test(p)) return; // git's own state matters to Source control; its objects do not
      if (/(^|\/)\.DS_Store$/.test(p) || /\.swp$|~$/.test(p)) return;
      paths.add(p);
      if (!timer) timer = setTimeout(flush, wait);
    });
    w.on?.('error', () => {});
  } catch { return { close() {} }; }
  return { close() { clearTimeout(timer); try { w?.close(); } catch {} } };
}

// What the workbench had open in a folder (its side pane, tabs, sizes), kept in the app's home by the folder's own
// path, so the next window on that folder opens the same way. Never a file's text.
const stateFile = (home, folder) => join(home, 'workbench', `${createHash('sha256').update(real(folder) ?? folder).digest('hex').slice(0, 24)}.json`);
export function readState(home, folder) { try { const o = JSON.parse(readFileSync(stateFile(home, folder), 'utf8')); return o && typeof o === 'object' ? o : {}; } catch { return {}; } }
export function saveState(home, folder, state) {
  if (!state || typeof state !== 'object') return { ok: false };
  const text = JSON.stringify(state);
  if (text.length > 200_000) return { ok: false };
  try { mkdirSync(join(home, 'workbench'), { recursive: true, mode: 0o700 }); writeFileSync(stateFile(home, folder), text, { mode: 0o600 }); return { ok: true }; } catch { return { ok: false }; }
}

// The workbench's answers for the window's server (server.mjs): a Response for an address under /wb/, else null.
// folder: the window's own. Every one of these needs the window's key, which the server has checked already.
export async function workbenchRoute(req, u, folder, { home = null } = {}) {
  const p = u.pathname, q = u.searchParams;
  const json = (o, status = 200) => Response.json(o, { status, headers: { 'cache-control': 'no-store' } });
  const body = async () => { try { return await req.json(); } catch { return {}; } };
  const on = (v) => v === '1' || v === 'true';
  if (!p.startsWith('/wb/')) return null;
  if (req.method === 'GET') {
    if (p === '/wb/tree') return json(treeOf(folder, q.get('p') ?? ''));
    if (p === '/wb/files') return json(allFiles(folder));
    if (p === '/wb/file') return json(readOne(folder, q.get('p') ?? ''));
    if (p === '/wb/search') return json(searchAll(folder, { query: q.get('q') ?? '', regex: on(q.get('re')), matchCase: on(q.get('case')), word: on(q.get('word')), include: q.get('inc') ?? '' }));
    if (p === '/wb/git') return json(gitState(folder));
    if (p === '/wb/diff') return json(gitDiff(folder, q.get('p') ?? '', { staged: on(q.get('staged')) }));
    if (p === '/wb/check') return json({ problems: checkOne(folder, q.get('p') ?? '') });
    if (p === '/wb/state') return json({ state: home ? readState(home, folder) : {} });
    return json({ error: 'Not here.' }, 404);
  }
  if (req.method !== 'POST' && req.method !== 'PUT') return json({ error: 'Not here.' }, 405);
  const b = await body();
  if (p === '/wb/file') { const r = saveOne(folder, String(b.path ?? ''), b.text, { stamp: b.stamp ?? null, force: b.force === true }); return json(r.ok ? { ...r, problems: checkOne(folder, String(b.path)) } : r); }
  if (p === '/wb/new') return json(makeOne(folder, String(b.path ?? ''), { dir: b.dir === true }));
  if (p === '/wb/rename') return json(renameOne(folder, String(b.from ?? ''), String(b.to ?? '')));
  if (p === '/wb/trash') return json(trashOne(folder, String(b.path ?? '')));
  if (p === '/wb/git') return json(gitDo(folder, String(b.op ?? ''), b));
  if (p === '/wb/state') return json(home ? saveState(home, folder, b.state) : { ok: false });
  return json({ error: 'Not here.' }, 404);
}
