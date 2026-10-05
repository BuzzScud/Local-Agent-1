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
