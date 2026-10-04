// List and Search: walk the project folder without node_modules, .git and
// other bulky folders; git grep when the folder is a git repo (much faster).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', '.cache', 'coverage', '.turbo']);

// A folder or file the walk leaves out: hidden ones and the bulky folders above.
export const skipName = (name) => (name.startsWith('.') && name !== '.github' && name !== '.env.example') || SKIP.has(name);

// The order walk() gives: a folder's entries by name, each folder's files
// where the folder comes.
export function byPath(a, b) {
  const x = a.split('/');
  const y = b.split('/');
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i].localeCompare(y[i]);
  return x.length - y.length;
}

// max: how many folders down it goes (files in root are at 0).
export function* walk(root, dir = root, depth = 0, max = 12) {
  if (depth > max) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (skipName(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { yield { path: relative(root, p), dir: true }; yield* walk(root, p, depth + 1, max); }
    else if (e.isFile()) yield { path: relative(root, p), dir: false };
  }
}

// "*.js" also finds .mjs/.cjs/.jsx, "*.ts" finds .tsx: small models ask for the family.
const FAMILIES = { js: '{js,mjs,cjs,jsx}', ts: '{ts,tsx,mts,cts}' };

export function globToRegExp(glob) {
  glob = glob.replace(/\*\.(js|ts)$/, (m, ext) => `*.${FAMILIES[ext]}`);
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') { const end = glob.indexOf('}', i); re += `(${glob.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`; i = end; }
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function listFiles(root, { path = '.', pattern, max = 200 } = {}) {
  const base = resolve(root, path);
  const re = pattern ? globToRegExp(pattern.includes('/') ? pattern : `**/${pattern}`) : null;
  const out = [];
  let total = 0;
  if (!re) {
    // Plain listing: one level, folders marked with /
    let entries = [];
    try { entries = readdirSync(base, { withFileTypes: true }); } catch (e) { return { error: `Cannot list ${path}: ${e.code ?? e.message}` }; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (SKIP.has(e.name) || (e.name.startsWith('.') && e.name !== '.github')) continue;
      total++;
      if (out.length < max) out.push(e.isDirectory() ? `${e.name}/` : e.name);
    }
  } else {
    for (const f of walk(base)) {
      if (f.dir) continue;
      if (!re.test(f.path)) continue;
      total++;
      if (out.length < max) out.push(f.path);
    }
  }
  return { lines: out, total };
}

function isGitRepo(root) {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === 'true';
}

export function searchFiles(root, { pattern, path = '.', glob, max = 50 } = {}) {
  let re;
  try { re = new RegExp(pattern); } catch (e) { return { error: `Bad pattern: ${e.message}` }; }
  const matches = [];
  let total = 0;
  if (isGitRepo(root)) {
    const rel = relative(root, resolve(root, path)) || '.';
    const args = ['grep', '-n', '-I', '-E', '--untracked', pattern, '--', glob ? `${rel}/${glob}`.replace(/^\.\//, '') : rel];
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 20e6 });
    if (r.status === 0 || r.status === 1) {
      const lines = r.stdout.split('\n').filter(Boolean);
      return { lines: lines.slice(0, max).map((l) => l.length > 220 ? `${l.slice(0, 220)}…` : l), total: lines.length };
    }
  }
  const globRe = glob ? globToRegExp(glob.includes('/') ? glob : `**/${glob}`) : null;
  const base = resolve(root, path);
  // A single file is searched on its own.
  let isFile = false;
  try { isFile = statSync(base).isFile(); } catch { return { error: `${path} does not exist. Use List to see what is there.` }; }
  const files = isFile ? [{ path: '', dir: false }] : walk(base);
  for (const f of files) {
    if (f.dir) continue;
    const rel = relative(root, join(base, f.path)) || path;
    if (globRe && !globRe.test(f.path) && !globRe.test(rel)) continue;
    let text;
    try {
      if (statSync(join(base, f.path)).size > 2e6) continue;
      text = readFileSync(join(base, f.path), 'utf8');
    } catch { continue; }
    if (text.includes('\u0000')) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        total++;
        if (matches.length < max) matches.push(`${rel}:${i + 1}:${lines[i].length > 200 ? `${lines[i].slice(0, 200)}…` : lines[i]}`);
      }
    }
  }
  return { lines: matches, total };
}

// A name typed a little wrong, set right from what is really in its folder (4 Oct 2026: Qwen
// searched "forecast-export-exports-report-2026-10-03.html" for "forecast-exports-report-2026-10-03.html",
// three steps after listing that folder, and got "does not exist"). Only the folder named is looked
// in, never a walk, so it is safe from the home folder too.
// The letters two names do not share, as edits (Levenshtein), on names up to 200 characters.
function editDistance(a, b) {
  a = a.toLowerCase().slice(0, 200); b = b.toLowerCase().slice(0, 200);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// The entries of `dir` close to `name`, closest first: [{ name, d }]. Close: at most a third of the
// name's letters differ (and at most 12), or the same words in another order or with one word more or
// less ("report-2026" for "exports-report-2026"), or the start of the name.
export function nearNames(dir, name, { max = 3 } = {}) {
  let entries;
  try { entries = readdirSync(dir); } catch { return []; }
  const words = (s) => s.toLowerCase().replace(/\.[a-z0-9]+$/, '').split(/[^a-z0-9]+/).filter(Boolean);
  const want = words(name);
  const ext = (s) => (/\.([a-z0-9]+)$/i.exec(s)?.[1] ?? '').toLowerCase();
  const out = [];
  for (const e of entries) {
    if (e.startsWith('.') && !name.startsWith('.')) continue;
    if (ext(e) !== ext(name)) continue;
    const d = editDistance(name, e);
    const have = words(e);
    const shared = want.filter((w) => have.includes(w)).length;
    // …or the name with its date or number left off ("forecaster-4-preview.html" for "forecaster-4-preview-2026-10-03.html").
    const stem = name.replace(/\.[a-z0-9]+$/i, '').toLowerCase();
    const prefix = stem.length >= 6 && e.toLowerCase().startsWith(`${stem}-`);
    const close = prefix || d <= Math.min(12, Math.max(2, Math.floor(name.length / 3))) || (shared >= 2 && Math.abs(have.length - want.length) <= 1 && shared >= Math.min(have.length, want.length) - 1);
    if (close) out.push({ name: e, d });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, max);
}
// A path that does not exist, set right one missing part at a time from the first that is missing
// (at most 3 parts): { fixed, picks } when each part had one clear match (the closest, and the next
// at least 3 edits further), else { fixed: null, picks: the closest names for the first missing part }.
export function nearPath(abs) {
  const parts = resolve(abs).split('/');
  let at = '/';
  let fixes = 0;
  for (let i = 1; i < parts.length; i++) {
    const next = join(at, parts[i]);
    if (existsSync(next)) { at = next; continue; }
    const near = nearNames(at, parts[i]);
    const clear = near.length === 1 || (near.length > 1 && near[1].d - near[0].d >= 3);
    if (!near.length || !clear || ++fixes > 3) return { fixed: null, picks: near.map((n) => join(at, n.name)) };
    at = join(at, near[0].name);
  }
  return fixes ? { fixed: at, picks: [at] } : { fixed: null, picks: [] };
}
