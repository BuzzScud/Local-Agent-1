// List and Search: walk the project folder without node_modules, .git and
// other bulky folders; git grep when the folder is a git repo (much faster).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', '.cache', 'coverage', '.turbo', 'tmp']);

export function* walk(root, dir = root, depth = 0) {
  if (depth > 12) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.github' && e.name !== '.env.example') continue;
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { yield { path: relative(root, p), dir: true }; yield* walk(root, p, depth + 1); }
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
