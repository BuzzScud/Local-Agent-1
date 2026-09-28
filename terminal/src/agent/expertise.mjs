// The user's own mathematics: the MATH folder on their Desktop (~11 MB of
// notes, far more than the model can read). At start it is indexed into
// areas (a chapter folder or a top-level folder) with keywords; the system
// prompt carries a one-line map of the areas; when a request uses an area's
// words, that section's notes go with the request the way a bug's steps do
// (src/agent/rules.mjs). The folder is read-only here, reached with paths
// that start "MATH/" (src/agent/tools.mjs). Files added to the folder later
// are picked up on their own: the index rebuilds when anything is newer.
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

// Read when used, not at import: tests point these at their own folders.
export const mathDir = () => (process.env.AGENTIC_MATH ?? process.env.BONSAI_MATH) ?? join(homedir(), 'Desktop', 'MATH');
const indexFile = () => join((process.env.AGENTIC_HOME ?? process.env.BONSAI_HOME) ?? join(homedir(), '.agentic-coder'), 'expertise', 'math-index.json');

// Near-copies of the thesis kept in the folder as backups: not indexed.
const SKIP_FILE = /backup|_complete\.md$/i;

// Words too common to pick a topic on their own ("fix the clock display"
// must not bring the clock-lattice notes into a coding task). They still
// count inside a phrase such as "clock lattice".
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'about', 'this', 'that', 'does', 'why', 'how', 'what', 'when', 'where', 'not', 'are', 'its', 'was', 'were', 'has', 'have', 'can', 'all', 'one', 'two',
  'chapter', 'part', 'parts', 'overview', 'introduction', 'summary', 'conclusion', 'conclusions', 'notes', 'docs', 'analysis', 'section', 'sections', 'core', 'principles', 'foundations', 'theoretical', 'advanced', 'concepts', 'applications', 'synthesis', 'implementation', 'detailed', 'novel', 'future', 'directions', 'readme', 'content', 'contents', 'answer', 'question', 'questions',
  'math', 'mathematics', 'mathematical', 'number', 'numbers', 'structure', 'structures', 'theory', 'system', 'systems', 'model', 'models', 'method', 'methods', 'function', 'functions', 'value', 'values', 'problem', 'problems', 'example', 'examples', 'definition', 'properties', 'proof', 'proofs',
  'clock', 'time', 'hash', 'hashing', 'ring', 'rings', 'tree', 'node', 'nodes', 'map', 'maps', 'key', 'keys', 'phase', 'phases', 'cycle', 'cycles', 'point', 'points', 'unit', 'units', 'base', 'recovery', 'integration', 'algorithm', 'algorithms', 'signal', 'signals', 'inputs', 'side',
  'test', 'tests', 'testing', 'results', 'result', 'data', 'used', 'uses', 'work', 'status', 'planned', 'details', 'performance', 'validation', 'complete', 'final', 'update', 'updates', 'report', 'reports', 'check', 'options']);

// Asking for the notes themselves ("what's in my math folder?"): show the map.
const META_PHRASES = ['math folder', 'math notes', 'my math'];

const clean = (s) => s.toLowerCase().replace(/[_\-—–]/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
// Words that can name a topic: 3+ letters (or a 3+ digit number such as 360),
// not too common. Only folder and file names and an area's own title give
// them — section headings use everyday words that would match everything.
const wordsOf = (s) => clean(s).split(' ').filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d{1,2}$/.test(w));
// A folder or title as a phrase: its words with numbers and stopwords at the
// ends dropped ("chapter_05_clock_lattice" → "clock lattice").
function phraseOf(s) {
  const ws = clean(s).split(' ').filter((w) => w && !/^\d+$/.test(w) && !['chapter', 'part', 'readme', 'content'].includes(w));
  return ws.length >= 2 && ws.length <= 5 ? ws.join(' ') : '';
}

const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

// Every note under a folder, skipping backups; sorted for a stable index.
// .md files carry the content; pages and scripts (.html, .txt, .pine) are
// known by name only, so a study kept as one page is still found.
const NOTE = /\.md$/i;
const PAGE = /\.(html|txt|pine)$/i;
function* noteFiles(root, dir = root, depth = 0) {
  if (depth > 6) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* noteFiles(root, p, depth + 1);
    else if (e.isFile() && (NOTE.test(e.name) || PAGE.test(e.name)) && !SKIP_FILE.test(e.name)) yield { abs: p, md: NOTE.test(e.name) };
  }
}

// Headings of one file: [character position, level, title], in order.
export function headingsOf(text) {
  const out = [];
  let at = 0;
  let inCode = false;
  for (const line of text.split('\n')) {
    if (/^```/.test(line)) inCode = !inCode;
    const m = !inCode && /^(#{1,4})\s+(.+)/.exec(line);
    if (m) out.push([at, m[1].length, m[2].trim().slice(0, 120)]);
    at += line.length + 1;
  }
  return out;
}

// The newest change and the file count: a cheap look to see the index is current.
function folderState(root) {
  let newest = 0;
  let count = 0;
  for (const f of noteFiles(root)) {
    count++;
    try { newest = Math.max(newest, statSync(f.abs).mtimeMs); } catch {}
  }
  return { newest, count };
}

// One area per chapter folder (inside the part_* folders) or per other
// top-level folder; loose .md files at the top are one area of their own.
function areaKeyOf(rel) {
  const parts = rel.split(sep);
  if (parts.length === 1) return '.';
  if (/^part_/i.test(parts[0]) && parts.length >= 3) return join(parts[0], parts[1]);
  return parts[0];
}

function areaNameOf(key, files) {
  if (key === '.') return 'Pages at the top of MATH';
  const last = key.split(sep).pop();
  // The area's own README names it best (not a subfolder's, such as prototype/).
  const readme = files.find((f) => f.f === join(key, 'README.md'));
  const fromTitle = readme?.sections.find(([, level]) => level === 1)?.[2]?.replace(/^(chapter|part)\s*[\dIVX]+:\s*/i, '');
  return fromTitle?.trim() || titleCase(clean(last).replace(/^chapter \d+ /, '').replace(/^\d+ /, ''));
}

export function buildIndex(root = mathDir()) {
  const byArea = new Map();
  for (const { abs, md } of noteFiles(root)) {
    const rel = abs.slice(root.length + 1);
    let sections = [];
    if (md) {
      let text;
      try { text = readFileSync(abs, 'utf8'); } catch { continue; }
      if (text.includes('\u0000')) continue;
      sections = headingsOf(text);
    }
    const key = areaKeyOf(rel);
    const area = byArea.get(key) ?? { key, files: [] };
    area.files.push({ f: rel, sections, md });
    byArea.set(key, area);
  }
  const areas = [];
  for (const area of byArea.values()) {
    const name = areaNameOf(area.key, area.files);
    const words = new Set([...wordsOf(area.key === '.' ? '' : area.key.split(sep).pop()), ...wordsOf(name)]);
    const phrases = new Set();
    const folderPhrase = area.key === '.' ? '' : phraseOf(area.key.split(sep).pop());
    if (folderPhrase) phrases.add(folderPhrase);
    const namePhrase = phraseOf(name);
    if (namePhrase) phrases.add(namePhrase);
    for (const file of area.files) {
      if (words.size >= 24) break;
      for (const w of wordsOf(file.f.split(sep).pop().replace(/\.[a-z0-9]+$/i, ''))) { if (words.size < 24) words.add(w); }
    }
    areas.push({ key: area.key, name, words: [...words], phrases: [...phrases], files: area.files });
  }
  // The named studies (thesis, prime, platonic…) before the numbered chapters.
  areas.sort((a, b) => (/^part_/i.test(a.key) ? 1 : 0) - (/^part_/i.test(b.key) ? 1 : 0));
  const { newest, count } = folderState(root);
  return { v: INDEX_V, dir: root, built: Date.now(), newest, count, areas };
}

// A saved index from before a change to how it is built must not be used.
const INDEX_V = 3;

// The index, from disk when current, rebuilt when the folder changed.
// The folder is re-checked at most every 30 seconds ({ fresh: true } always).
let cached = null;
let checkedAt = 0;
export function mathIndex({ fresh = false } = {}) {
  const root = mathDir();
  if (!existsSync(root)) { cached = null; return null; }
  if (!fresh && cached && cached.dir === root && Date.now() - checkedAt < 30_000) return cached;
  const state = folderState(root);
  checkedAt = Date.now();
  if (cached && cached.v === INDEX_V && cached.dir === root && cached.newest === state.newest && cached.count === state.count) return cached;
  const file = indexFile();
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (saved.v === INDEX_V && saved.dir === root && saved.newest === state.newest && saved.count === state.count) return (cached = saved);
  } catch {}
  cached = buildIndex(root);
  try { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, JSON.stringify(cached)); } catch {}
  return cached;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-word match, singular or plural ("primes" finds "prime").
const hits = (t, w) => new RegExp(`(^|[^a-z0-9])${escapeRe(w)}s?(?=$|[^a-z0-9])`).test(t) || (w.endsWith('s') && hits(t, w.slice(0, -1)));

// The area whose words the request uses most: a phrase counts 2, a word 1,
// at most 3 from single words. Below min (2; /math lowers it to 1) nothing
// matches, so a lone common word never drags math notes into a coding task.
// Asking about the notes themselves matches as { browse: true }.
export function sortMath(text, { min = 2, index = mathIndex() } = {}) {
  if (!index?.areas?.length) return null;
  const t = clean(text.replace(/the question "[^"]*"/g, ''));
  let best = null;
  for (const area of index.areas) {
    let score = 0;
    for (const p of area.phrases) if (hits(t, p)) score += 2;
    let single = 0;
    for (const w of area.words) if (single < 3 && hits(t, w)) { single++; }
    score += single;
    if (score > (best?.score ?? 0)) best = { area, score };
  }
  if (best && best.score >= min) return { ...best, index };
  if (META_PHRASES.some((p) => hits(t, p))) return { browse: true, index };
  return null;
}

// Within the matched area, the section whose title shares the most words
// with the request; a file matched only by its name (a page such as .html)
// is pointed at rather than excerpted; otherwise the area's first .md file.
function pickSection(area, text) {
  const ws = new Set(wordsOf(text));
  let best = null;
  for (const file of area.files) {
    for (let i = 0; i < file.sections.length; i++) {
      const [, , title] = file.sections[i];
      const n = wordsOf(title).filter((w) => ws.has(w)).length;
      if (n > (best?.n ?? 0)) best = { file, i, n };
    }
  }
  if (best) return best;
  let byName = null;
  for (const file of area.files) {
    const n = wordsOf(file.f.split(sep).pop()).filter((w) => ws.has(w)).length;
    if (n > (byName?.n ?? 0)) byName = { file, i: -1, n };
  }
  if (byName && !byName.file.md) return { ...byName, pointer: true };
  return byName ?? { file: area.files.find((f) => f.md) ?? area.files[0], i: -1, n: 0 };
}

const EXCERPT_MAX = 2600;

// What goes with the request: the matched notes and how to treat them.
// The user chose: their notes come first for these topics, with one short
// line added when standard mathematics says otherwise.
const HOW = 'These are the user\'s own mathematical framework. For this topic answer from these notes first; when standard mathematics says something different, add one short line saying so. More is in the MATH folder: Read, List and Search work with paths starting MATH/ (it is read-only).';

export function mathNotes(match, text = '') {
  if (match.browse) {
    const list = match.index.areas.map((a) => a.name).join('; ');
    return `The user asks about their own math notes (the MATH folder). Its areas: ${list}. List or Read them with paths starting MATH/. ${HOW}`;
  }
  const { area } = match;
  const pick = pickSection(area, text);
  const rel = pick.file.f;
  if (pick.pointer || !pick.file.md) return `The request touches the user's math notes on ${area.name}: the file MATH/${rel}. Read it (or List MATH/${area.key === '.' ? '' : area.key} for more). ${HOW}`;
  let piece = '';
  try {
    const full = readFileSync(join(match.index.dir, rel), 'utf8');
    if (pick.i >= 0) {
      const [at, level] = pick.file.sections[pick.i];
      const next = pick.file.sections.slice(pick.i + 1).find(([, l]) => l <= level);
      piece = full.slice(at, next ? next[0] : undefined);
    } else piece = full;
  } catch { return `The request touches the user's math notes on ${area.name} (MATH/${area.key === '.' ? '' : area.key}). ${HOW}`; }
  if (piece.length > EXCERPT_MAX) piece = `${piece.slice(0, EXCERPT_MAX)}\n[cut here; the rest is in the file]`;
  return `From the user's own math notes, MATH/${rel}${pick.i >= 0 ? ` ("${pick.file.sections[pick.i][2]}")` : ''}:\n${piece.trim()}\n[end of the notes]\n${HOW}`;
}

// Rows for the /math panel: each area and the words that reach it.
export function mathTopics(index = mathIndex()) {
  if (!index?.areas?.length) return [];
  return index.areas.map((a) => [a.name, [...a.phrases, ...a.words].slice(0, 5).join(', ')]);
}

// "MATH" or "MATH/…" typed by the model: the real place under the folder,
// or null when the name means something else. tools.mjs asks before falling
// back so a project's own MATH folder still wins.
export function mathPathFor(p) {
  if (p !== 'MATH' && !p.startsWith('MATH/')) return null;
  const root = mathDir();
  if (!existsSync(root)) return null;
  const abs = resolve(root, p === 'MATH' ? '.' : p.slice(5));
  if (!(`${abs}${sep}`).startsWith(`${resolve(root)}${sep}`) && abs !== resolve(root)) return null; // "MATH/../…" stays out
  return { abs, rel: p };
}
