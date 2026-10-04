// The ladder (3 Oct 2026, the owner's picks for the code maps and the pack of Claude's notes): a
// folder a model reads from the top down instead of all at once, the same shape for both.
//   MAP.md        level 0: one line per part ("- desks/ — the trading desks … → desks.md")
//   <part>.md     level 1: one line per folder, file or note in that part, each file under 2,000 tokens
//   then the file or note itself (level 2), and for a long note its history (level 3)
// docs/map/ in a project (made by `bun run codemap`, tools/codemap.mjs) and ~/.agentic-coder/claude-pack
// (made by `bun run pack`, claude-pack.mjs) are both ladders. How much of a MAP.md a model gets is
// decided by its context (mapRoom): every model reads the same structure, a bigger one more of it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { wordsOf } from './recall.mjs';

export const MAP_FILE = 'MAP.md';
export const PART_TOKENS = 2000;
export const PART_CHARS = 7000; // about 2,000 tokens at 3.5 characters a token
// A part's name in a MAP.md line, after the arrow: "→ desks.md", "→ reference/claude-code-tools.md".
const PART_LINE = /^- (.+?)\s+→\s+((?:[\w-]+\/)?[\w.-]+\.md)\s*$/;
const PART_NAME = /^(?:[\w-]+\/)?[\w.-]+$/;

// How many characters of a MAP.md go to a model with this context (in tokens), and whether the part
// nearest the request comes along with it. 32k (Qwen3.6 on the service as loaded, the 9B here): the
// map's lines; 128k and up (qwen3-coder-next, gpt-oss, laguna): the map and that part.
export function mapRoom(ctx = 32768) {
  if (ctx <= 16384) return { chars: 1500, part: 0 };
  if (ctx <= 32768) return { chars: 3000, part: 0 };
  if (ctx <= 65536) return { chars: 4500, part: 0 };
  return { chars: 6000, part: PART_CHARS };
}

export function readLadder(dir) {
  if (!dir) return null;
  let text;
  try { text = readFileSync(join(dir, MAP_FILE), 'utf8'); } catch { return null; }
  return { dir, text, parts: partsOf(text) };
}

// The parts a MAP.md names, in its order: [{ title, file, line }].
export function partsOf(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = PART_LINE.exec(line.trim());
    if (m) out.push({ title: m[1], file: m[2], line: line.trim() });
  }
  return out;
}

// Whole lines up to room; what did not fit is counted on a last line.
export function fitLines(text, room) {
  const lines = String(text).trimEnd().split('\n');
  if (text.length <= room) return String(text).trimEnd();
  const kept = [];
  let used = 0;
  for (const l of lines) {
    if (used + l.length + 1 > room - 60) break;
    kept.push(l);
    used += l.length + 1;
  }
  const left = lines.slice(kept.length).filter((l) => l.startsWith('- ')).length;
  return `${kept.join('\n')}${left ? `\n(… ${left} more ${left === 1 ? 'line' : 'lines'} in ${MAP_FILE})` : ''}`;
}

// One part by its name ("desks", "desks.md", "reference/claude-code-tools"), never outside the folder.
export function openPart(dir, name) {
  const want = String(name ?? '').trim().replace(/^\.?\//, '').replace(/\.md$/, '');
  if (!want || !PART_NAME.test(want) || want.split('/').includes('..')) return null;
  const file = join(dir, `${want}.md`);
  if (!existsSync(file)) return null;
  try { return { file: `${want}.md`, text: readFileSync(file, 'utf8') }; } catch { return null; }
}

// The part a request is most likely about: the most words it shares with the part's MAP line and the
// part's own lines, a rare word counting for more. null when no part shares two words or more.
export function nearestPart(ladder, request) {
  if (!ladder?.parts?.length) return null;
  const q = new Set(wordsOf(request));
  if (!q.size) return null;
  const docs = ladder.parts.map((p) => {
    const body = openPart(ladder.dir, p.file)?.text ?? '';
    return { p, words: new Set(wordsOf(`${p.title} ${p.file.replace(/[-_.]/g, ' ')} ${body}`)) };
  });
  const df = new Map();
  for (const d of docs) for (const w of d.words) df.set(w, (df.get(w) ?? 0) + 1);
  let best = null;
  for (const d of docs) {
    const shared = [...q].filter((w) => d.words.has(w));
    const score = shared.reduce((s, w) => s + Math.log(1 + docs.length / df.get(w)), 0);
    if (shared.length >= 2 && (!best || score > best.score)) best = { part: d.p, score, shared };
  }
  return best;
}

// A part's lines split into files of at most PART_CHARS: name.md, name-2.md, … Each starts with its
// heading and intro; the first says how many files the part has.
export function splitPart(name, heading, intro, lines, max = PART_CHARS) {
  // A part in several files says which it is and where the next one is.
  const fileOf = (i) => (i > 1 ? `${name}-${i}.md` : `${name}.md`);
  const head = (i, n) => `# ${heading}${n > 1 ? ` (${i} of ${n}${i < n ? `; the next is ${fileOf(i + 1)}` : ''})` : ''}\n\n${intro ? `${intro}\n\n` : ''}`;
  const groups = [[]];
  let used = head(1, 9).length;
  for (const l of lines) {
    const cut = l.length > max - 400 ? `${l.slice(0, max - 401)}…` : l;
    if (used + cut.length + 1 > max && groups.at(-1).length) { groups.push([]); used = head(groups.length, 9).length; }
    groups.at(-1).push(cut);
    used += cut.length + 1;
  }
  return groups.map((g, i) => ({ file: fileOf(i + 1), text: `${head(i + 1, groups.length)}${g.join('\n')}\n` }));
}
