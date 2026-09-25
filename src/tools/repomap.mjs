// A short map of the project for the model: each code file with its line
// count and top-level names ("src/tools/fs.mjs (109): walk, listFiles, …").
// Cached per project under ~/.bonsai-code/maps, keyed by each file's size and
// time, so a big folder costs nothing after the first look. Used when
// choosing which file a task is about, when deciding whether a request is
// clear, and as the first thing the step-by-step loop sees in a project with
// several files (instead of List → Read → List → Read at ~60 tokens a second).
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { walk } from './fs.mjs';
import { outline } from './outline.mjs';
import { HOME } from '../server/models.mjs';

export const CODE_FILE = /\.(m?[jt]sx?|cjs|mts|cts|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|vue|svelte)$/i;
const MAP_DIR = () => join(HOME, 'maps');

export function repoMap(cwd, { maxFiles = 400, maxChars = 5000 } = {}) {
  const files = [];
  for (const f of walk(cwd)) { if (!f.dir && CODE_FILE.test(f.path)) files.push(f.path); if (files.length >= maxFiles) break; }
  if (!files.length) return { entries: [], files: [], text: '' };
  const cacheFile = join(MAP_DIR(), `${createHash('sha1').update(cwd).digest('hex').slice(0, 16)}.json`);
  let cache = {};
  try { cache = JSON.parse(readFileSync(cacheFile, 'utf8')); } catch {}
  const entries = [];
  let changed = false;
  for (const rel of files) {
    let st;
    try { st = statSync(join(cwd, rel)); } catch { continue; }
    const stamp = `${Math.round(st.mtimeMs)}:${st.size}`;
    let e = cache[rel];
    if (!e || e.stamp !== stamp) {
      let text;
      try { text = readFileSync(join(cwd, rel), 'utf8'); } catch { continue; }
      if (text.includes('\u0000')) continue;
      e = { stamp, lines: text.split('\n').length, names: outline(text, rel).filter((p) => p.top && p.name && p.name !== 'imports and setup').map((p) => p.name).slice(0, 40) };
      changed = true;
    }
    cache[rel] = e;
    entries.push({ rel, lines: e.lines, names: e.names });
  }
  for (const k of Object.keys(cache)) if (!files.includes(k)) { delete cache[k]; changed = true; }
  if (changed) { try { mkdirSync(MAP_DIR(), { recursive: true }); writeFileSync(cacheFile, JSON.stringify(cache)); } catch {} }
  return { entries, files, text: mapText(entries, maxChars) };
}

// One line per file. Over the budget, names are cut first, then files.
export function mapText(entries, maxChars = 5000) {
  const line = (e, n) => `${e.rel} (${e.lines})${n && e.names.length ? `: ${e.names.slice(0, n).join(', ')}${e.names.length > n ? ', …' : ''}` : ''}`;
  for (const n of [12, 6, 3, 0]) {
    const rows = entries.map((e) => line(e, n));
    const text = rows.join('\n');
    if (text.length <= maxChars) return text;
    if (n === 0) {
      let out = '';
      let shown = 0;
      for (const r of rows) { if (out.length + r.length + 40 > maxChars) break; out += `${r}\n`; shown++; }
      return `${out}… and ${entries.length - shown} more files`;
    }
  }
  return '';
}
