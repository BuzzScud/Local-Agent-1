// The harness's tools: what the model calls, run here. Each returns { text, error? }.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { execSync } from 'node:child_process';

const SKIP = new Set(['node_modules', '.git']);

// Read: a file's lines, numbered from 1; offset (first line) and limit (how many) pick a part.
export function read({ path, offset = 1, limit = 2000 }, cwd) {
  const abs = resolve(cwd, path);
  if (!existsSync(abs) || !statSync(abs).isFile()) return { text: `No such file: ${path}`, error: true };
  const lines = readFileSync(abs, 'utf8').replace(/\n$/, '').split('\n');
  const from = Math.max(1, offset);
  const part = lines.slice(from - 1, from - 1 + limit);
  return { text: part.map((l, i) => `${from + i}: ${l}`).join('\n') };
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// Search: every line matching a regular expression, as file:line: text, files under path.
export function search({ pattern, path = '.' }, cwd) {
  const root = resolve(cwd, path);
  if (!existsSync(root)) return { text: `No such folder: ${path}`, error: true };
  let re;
  try { re = new RegExp(pattern); } catch (e) { return { text: `Bad pattern: ${e.message}`, error: true }; }
  const hits = [];
  for (const f of walk(root)) {
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (re.test(l)) hits.push(`${relative(cwd, f)}:${i + 1}: ${l}`); });
  }
  return { text: hits.join('\n') || 'No matches.' };
}

// A glob as a regular expression: ** any folders, * any letters within one name, ? one letter.
const globRe = (g) => new RegExp(`^${g.split(/(\*\*\/|\*|\?)/).map((t) => (t === '**/' ? '(?:.*/)?' : t === '*' ? '[^/]*' : t === '?' ? '[^/]' : t.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('')}$`);
// List: the entries of a folder; with pattern, every file under it whose path matches the glob.
export function list({ path = '.', pattern = null }, cwd) {
  const root = resolve(cwd, path);
  if (!existsSync(root) || !statSync(root).isDirectory()) return { text: `No such folder: ${path}`, error: true };
  if (!pattern) return { text: readdirSync(root).filter((n) => !SKIP.has(n)).sort().map((n) => (statSync(join(root, n)).isDirectory() ? `${n}/` : n)).join('\n') };
  const re = globRe(pattern);
  return { text: walk(root).map((f) => relative(root, f)).filter((r) => re.test(r)).sort().join('\n') };
}

// Bash: a shell command, run in the project folder.
export function bash({ command }, cwd) {
  try { return { text: execSync(command, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\n$/, '') }; } catch (e) { return { text: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || e.message, error: true }; }
}

export const TOOLS = { Read: read, Search: search, List: list, Bash: bash };
export function runTool(name, args, cwd) {
  const tool = TOOLS[name];
  return tool ? tool(args ?? {}, cwd) : { text: `Unknown tool ${name}`, error: true };
}

// A plain read in a Bash command: the tool it stands for, { name, args }, or null.
export function plainRead(command, cwd) {
  const c = String(command ?? '').trim();
  if (!c || /[|;&<>`$()\n]/.test(c.replace(/"[^"]*"|'[^']*'/g, ''))) return null;
  const words = (c.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^(['"])([\s\S]*)\1$/, '$2'));
  const [cmd, ...rest] = words;
  const kind = (p) => { try { const st = statSync(resolve(cwd, p)); return st.isFile() ? 'file' : st.isDirectory() ? 'dir' : null; } catch { return null; } };
  const flags = rest.filter((w) => w.startsWith('-'));
  const plain = rest.filter((w) => !w.startsWith('-'));
  if (cmd === 'cat' && plain.length === 1 && flags.length === 0 && kind(plain[0]) === 'file') return { name: 'Read', args: { path: plain[0] } };
  if (cmd === 'head' || cmd === 'tail') {
    let n = 10;
    const files = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '-n' && /^\d+$/.test(rest[i + 1] ?? '')) { n = Number(rest[++i]); continue; }
      const m = /^-n?(\d+)$/.exec(rest[i]);
      if (m) { n = Number(m[1]); continue; }
      if (rest[i].startsWith('-')) return null;
      files.push(rest[i]);
    }
    if (files.length !== 1 || kind(files[0]) !== 'file') return null;
    if (cmd === 'head') return { name: 'Read', args: { path: files[0], offset: 1, limit: n } };
    const total = readFileSync(resolve(cwd, files[0]), 'utf8').replace(/\n$/, '').split('\n').length;
    return { name: 'Read', args: { path: files[0], offset: Math.max(1, total - n + 1), limit: n } };
  }
  if (cmd === 'sed' && rest.length === 3 && rest[0] === '-n') {
    const m = /^(\d+),(\d+)p$/.exec(rest[1]);
    if (!m || kind(rest[2]) !== 'file' || Number(m[2]) < Number(m[1])) return null;
    return { name: 'Read', args: { path: rest[2], offset: Number(m[1]), limit: Number(m[2]) - Number(m[1]) + 1 } };
  }
  if (cmd === 'grep') {
    if (!flags.length || !flags.every((f) => /^-(r|rn|nr)$/.test(f))) return null;
    if (plain.length < 1 || plain.length > 2 || (plain[1] && kind(plain[1]) !== 'dir')) return null;
    return { name: 'Search', args: { pattern: plain[0], path: plain[1] ?? '.' } };
  }
  if (cmd === 'ls') {
    if (!flags.every((f) => /^-[la]+$/.test(f)) || plain.length > 1) return null;
    if (plain[0] && kind(plain[0]) !== 'dir') return null;
    return { name: 'List', args: { path: plain[0] ?? '.' } };
  }
  if (cmd === 'find' && kind(rest[0] ?? '') === 'dir') {
    let pattern = null;
    for (let i = 1; i < rest.length; i++) {
      if (rest[i] === '-type' && rest[i + 1] === 'f') { i++; continue; }
      if (rest[i] === '-name' && rest[i + 1]) { pattern = `**/${rest[++i]}`; continue; }
      return null;
    }
    return pattern ? { name: 'List', args: { path: rest[0], pattern } } : null;
  }
  return null;
}
