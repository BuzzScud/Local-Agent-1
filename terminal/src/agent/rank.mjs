// Which files a request is about, found by meaning before the model reads
// anything. The memory's small model (BGE-M3, already running beside Gemma)
// turns each code file's card (its path, its top-level names and its first
// lines) and the request into numbers; the closest files come first. Reading
// was ~84% of a task's time in the bake-off: the step-by-step loop found and
// read files one step at a time, each step a full reply. With the right files
// given up front, that search is one step of reading instead.
//
// A card's numbers are worked out once and kept under ~/.agentic-coder/ranks,
// keyed by the file's size and time, so only new or changed files cost
// anything. Without the small model the files are ranked by the request's
// words instead (fileHints' way), and the result says so.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { HOME } from '../../../models/index.mjs';
import { repoMap } from '../tools/repomap.mjs';

const RANK_DIR = () => join(HOME, 'ranks');
const CARD_LINES = 12; // the file's first lines on its card (its imports and opening comment say most)
const CARD_CHARS = 1200;
// A file is given only when it is close to the request and not far behind
// the best one: a request about "the weather page" should not bring along
// every file that is merely in the same project.
export const MIN_CLOSE = 0.42;
export const WITHIN = 0.06;

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);
const pack = (v) => Buffer.from(new Float32Array(v).buffer).toString('base64');
const unpack = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// What a file is, in a few lines: what the small model compares with the request.
export function card(cwd, e) {
  let head = '';
  try { head = readFileSync(join(cwd, e.rel), 'utf8').split('\n').slice(0, CARD_LINES).join('\n'); } catch {}
  return `${e.rel}\n${e.names.length ? `Defines: ${e.names.slice(0, 20).join(', ')}\n` : ''}${head}`.slice(0, CARD_CHARS);
}

// The request's words in the file's path and names: the fallback, and a
// small tie-break on top of the meaning.
function wordScore(text, e) {
  const words = [...new Set((String(text).toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? []))];
  if (!words.length) return 0;
  const hay = `${e.rel} ${e.names.join(' ')}`.toLowerCase();
  return words.filter((w) => hay.includes(w)).length / words.length;
}

// → { files: [{ rel, lines, score }], how: 'meaning' | 'words', ms }
// files: best first, only those that pass MIN_CLOSE and WITHIN (at most top).
export async function rankFiles(cwd, text, { embedder = null, top = 3, signal, entries } = {}) {
  const t0 = Date.now();
  let list = entries;
  if (!list) { try { list = repoMap(cwd).entries; } catch { list = []; } }
  if (!list.length) return { files: [], how: 'none', ms: 0 };
  if (embedder) {
    try {
      const file = join(RANK_DIR(), `${hash(cwd)}.json`);
      let kept = {};
      try { const j = JSON.parse(readFileSync(file, 'utf8')); if (j.model === embedder.model?.file) kept = j.files ?? {}; } catch { /* none yet */ }
      const cards = list.map((e) => ({ e, c: card(cwd, e) }));
      const want = cards.filter(({ e, c }) => kept[e.rel]?.h !== hash(c));
      if (want.length) {
        const made = await embedder.embed(want.map((w) => w.c), { signal });
        want.forEach((w, i) => { kept[w.e.rel] = { h: hash(w.c), v: pack(made[i]) }; });
        for (const k of Object.keys(kept)) if (!list.some((e) => e.rel === k)) delete kept[k];
        try { mkdirSync(RANK_DIR(), { recursive: true }); writeFileSync(file, JSON.stringify({ model: embedder.model?.file, files: kept })); } catch { /* ranking still works this time */ }
      }
      const [q] = await embedder.embed([text], { signal });
      const scored = list.map((e) => ({ rel: e.rel, lines: e.lines, score: dot(q, unpack(kept[e.rel].v)) + 0.02 * wordScore(text, e) }))
        .sort((a, b) => b.score - a.score);
      const best = scored[0]?.score ?? 0;
      const files = scored.filter((f) => f.score >= MIN_CLOSE && f.score >= best - WITHIN).slice(0, top);
      return { files, how: 'meaning', ms: Date.now() - t0, best: scored.slice(0, top) };
    } catch (e) {
      if (signal?.aborted || e.name === 'AbortError') throw e;
      // The small model is not there or failed: rank by words.
    }
  }
  const scored = list.map((e) => ({ rel: e.rel, lines: e.lines, score: wordScore(text, e) })).filter((f) => f.score > 0).sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ?? 0;
  // By words, a file is given only when it shares at least a third of the request's words.
  return { files: scored.filter((f) => f.score >= Math.max(0.34, best - 0.1)).slice(0, top), how: 'words', ms: Date.now() - t0, best: scored.slice(0, top) };
}
