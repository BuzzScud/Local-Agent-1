// A short map of the project for the model: each code file with its line
// count and top-level names ("src/tools/fs.mjs (109): walk, listFiles, …").
// Cached per project under ~/.agentic-coder/maps, keyed by each file's size and
// time, so a big folder costs nothing after the first look. Used when
// choosing which file a task is about, when deciding whether a request is
// clear, and as the first thing the step-by-step loop sees in a project with
// several files (instead of List → Read → List → Read at ~60 tokens a second).
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { walk, skipName, byPath } from './fs.mjs';
import { outline } from './outline.mjs';
import { HOME } from '../../../models/index.mjs';
import { readLadder, fitLines } from '../agent/ladder.mjs';

export const CODE_FILE = /\.(m?[jt]sx?|cjs|mts|cts|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|vue|svelte)$/i;
const MAP_DIR = () => join(HOME, 'maps');

// Code nobody works on: old copies, other people's libraries, test
// snapshots. Left out while the project has other code.
export const SET_ASIDE = /(^|\/)(archive[sd]?|backups?|vendor|third[_-]party|__snapshots__|older versions)\//i;
const WALK_MAX = 2000; // outside git: the code files looked at, in the folder's order
const LOG_MAX = 1000; // the newest commits read for how much each file was worked on
const HALF_LIFE = 100; // commits: a change 100 commits back counts half as much as the newest

const git = (cwd, args, ms = 5000) => {
  const r = spawnSync('git', ['-c', 'core.quotepath=off', ...args], { cwd, encoding: 'utf8', maxBuffer: 64e6, timeout: ms });
  return r.status === 0 ? r.stdout : null;
};
const listed = (out) => (out ?? '').split('\0').filter(Boolean);

// How much each file was worked on lately: every commit that changed it
// counts, the newer the more, and one that changed many files at once (a
// rename, a folder moved, a batch of test projects added) less for each.
// On this repo the time of a file's last commit alone let 230 practice
// project files, all added on 29 Sep, push out a third of terminal/src.
// Read again only after a new commit: on a big project the log is most of
// the time here (0.3 s of MAIN2026's 0.4 s, 29 Sep), and the map is made
// several times a request.
const worked = new Map(); // cwd → { head, score }
function workedOn(cwd) {
  const head = git(cwd, ['rev-parse', 'HEAD'])?.trim() ?? '';
  const kept = worked.get(cwd);
  if (kept && kept.head === head) return kept.score;
  const commits = [];
  for (const line of (git(cwd, ['log', '--relative', '--no-renames', '--format=%x00', '--name-only', '-n', String(LOG_MAX)], 10000) ?? '').split('\n')) {
    if (line.startsWith('\0')) commits.push([]);
    else if (line) commits.at(-1)?.push(line);
  }
  const score = new Map();
  commits.forEach((files, i) => {
    const w = 0.5 ** (i / HALF_LIFE) / Math.sqrt(files.length);
    for (const f of files) score.set(f, (score.get(f) ?? 0) + w);
  });
  worked.set(cwd, { head, score });
  return score;
}

// In a git repo, git's own list: the files it tracks and the new ones, never
// the ones it ignores (old test output, builds, downloads). A file changed
// and not yet committed comes first, by its time on disk; the others by how
// much they were worked on. null outside a repo, or when git lists no code here.
function gitCodeFiles(cwd) {
  const tracked = git(cwd, ['ls-files', '-z', '--cached']);
  if (tracked === null) return null;
  const fresh = new Set(listed(git(cwd, ['ls-files', '-z', '--others', '--exclude-standard'])));
  const changed = new Set(listed(git(cwd, ['ls-files', '-z', '--modified'])));
  const score = workedOn(cwd);
  const out = [];
  const seen = new Set();
  for (const rel of [...listed(tracked), ...fresh]) {
    if (seen.has(rel) || !CODE_FILE.test(rel) || rel.split('/').some(skipName)) continue;
    seen.add(rel);
    if (fresh.has(rel) || changed.has(rel)) {
      try { out.push({ rel, onDisk: statSync(join(cwd, rel)).mtimeMs, score: 0 }); } catch { continue; } // deleted, not yet committed
    } else out.push({ rel, onDisk: 0, score: score.get(rel) ?? 0 });
  }
  return out.length ? out : null;
}

// Outside git: the folder walked, each file by its time on disk.
function walkedCodeFiles(cwd) {
  const out = [];
  for (const f of walk(cwd)) {
    if (f.dir || !CODE_FILE.test(f.path)) continue;
    try { out.push({ rel: f.path, onDisk: statSync(join(cwd, f.path)).mtimeMs, score: 0 }); } catch { continue; }
    if (out.length >= WALK_MAX) break;
  }
  return out;
}

// The code files worth reading, the most recently worked on first, at most
// max: what the map lists and what the code search reads (codeindex.mjs). A
// big project has more code than either can take, and the first files in
// the folder's order were the wrong ones: on this repo 396 of the first 400
// were old test output git ignores, and none of terminal/src (29 Sep).
export function codeFiles(cwd, { max = 400 } = {}) {
  const all = gitCodeFiles(cwd) ?? walkedCodeFiles(cwd);
  const kept = all.filter((f) => !SET_ASIDE.test(f.rel));
  return (kept.length ? kept : all).sort((a, b) => b.onDisk - a.onDisk || b.score - a.score || byPath(a.rel, b.rel)).slice(0, max).map((f) => f.rel);
}

// ladder: when the project has a code map (docs/map/MAP.md, tools/codemap.mjs), the text starts with
// its folder lines (up to 45% of maxChars) and the file list takes the rest (the Map tool's answer).
export function repoMap(cwd, { maxFiles = 400, maxChars = 5000, ladder = false } = {}) {
  const files = codeFiles(cwd, { max: maxFiles });
  if (!files.length) return { entries: [], files: [], text: '' };
  const lad = ladder ? readLadder(join(cwd, 'docs', 'map')) : null;
  const mapLines = lad ? fitLines(lad.text.replace(/^# .*\n+/, ''), Math.round(maxChars * 0.45)) : '';
  if (lad) maxChars -= mapLines.length + 120;
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
  const keep = new Set(files);
  for (const k of Object.keys(cache)) if (!keep.has(k)) { delete cache[k]; changed = true; }
  if (changed) { try { mkdirSync(MAP_DIR(), { recursive: true }); writeFileSync(cacheFile, JSON.stringify(cache)); } catch {} }
  const list = mapText(entries, maxChars);
  const text = lad ? `The code map (docs/map/MAP.md; Map with a part opens one):\n${mapLines}\n\nCode files (lines: top-level names):\n${list}` : list;
  entries.sort((a, b) => byPath(a.rel, b.rel));
  return { entries, files: entries.map((e) => e.rel), text, ladder: Boolean(lad) };
}

// One line per file, in the folder's order. Over the budget, names are cut
// first, then files: the least recently worked on (entries come most
// recently worked on first).
function mapText(entries, maxChars = 5000) {
  const line = (e, n) => `${e.rel} (${e.lines})${n && e.names.length ? `: ${e.names.slice(0, n).join(', ')}${e.names.length > n ? ', …' : ''}` : ''}`;
  const inOrder = (list) => [...list].sort((a, b) => byPath(a.rel, b.rel));
  for (const n of [12, 6, 3, 0]) {
    const text = inOrder(entries).map((e) => line(e, n)).join('\n');
    if (text.length <= maxChars) return text;
    if (n === 0) {
      const shown = [];
      let used = 0;
      for (const e of entries) { const r = line(e, 0); if (used + r.length + 1 + 40 > maxChars) break; used += r.length + 1; shown.push(e); }
      return `${inOrder(shown).map((e) => `${line(e, 0)}\n`).join('')}… and ${entries.length - shown.length} more files`;
    }
  }
  return '';
}
