// Code found by meaning: each code file's parts (its functions and classes,
// from outline.mjs) are turned into numbers by the small model the memory
// uses (bge-m3), so the parts closest to a request can come along with it
// and the model reads them instead of searching for them (agent/helpers.mjs).
// Also ranks the files a focused path chooses from (flows/localize.mjs).
// Built in the background, never waited for: bge-m3 reads about 0.1 s a part
// on the M4 (16 parts of ~800 characters in 1.6 s, 28 Sep), so a 40-file
// project takes ~30 s the first time and a 400-file one a few minutes. It
// waits while the model is answering (paused), so the two do not share the
// graphics chip and the answer is not slowed; mostly it runs between requests. Kept
// under ~/.agentic-coder/maps, keyed like the project map by each file's size
// and time, so only a changed file is worked out again. The files are the
// project map's (repomap.mjs codeFiles): the ones most recently worked on.
import { readFileSync, statSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { byPath } from './fs.mjs';
import { outline } from './outline.mjs';
import { codeFiles } from './repomap.mjs';
import { HOME } from '../../../models/index.mjs';
import { Words, terms, WORD_TOP } from '../agent/search.mjs';

// How close a part must be to come along: the best one at least CUT, the
// others no further than MARGIN behind it. Set on the practice tasks with
// bge-m3 (28 Sep): the code a specific request is about scored 0.61-0.81,
// a generic "the tests fail, fix it" 0.41-0.49 on every part (nothing
// stands out, so nothing comes), and unrelated requests 0.29-0.54.
export const CUT = 0.58;
export const MARGIN = 0.08;

const MAX_FILES = 400;
const MAX_PARTS = 4000;
const MAX_BYTES = 300_000; // bigger files are generated code or data, not code to read
const PART_LINES = 80; // a longer part is cut into pieces of this many lines
const WORDING = 1500; // what the small model reads at a time: a part's file, its name, its lines
const BATCH = 16;
const FORMAT = 2; // 2: a long part is read in pieces, all of it (29 Sep); 1 read its first 1,500 characters
const SAVE_EVERY = 20; // batches: a long first build keeps what it has so far

const MAP_DIR = () => join(HOME, 'maps');
const sha = (s) => createHash('sha1').update(s).digest('hex');

// Numbers kept small: one byte each and a scale (the small model's numbers
// are all well inside ±1), which ranks parts the same as the full numbers.
export function pack(v) {
  let m = 0;
  for (const x of v) m = Math.max(m, Math.abs(x));
  const b = Buffer.alloc(4 + v.length);
  b.writeFloatLE((m || 1) / 127, 0);
  for (let i = 0; i < v.length; i++) b.writeInt8(Math.round((v[i] / (m || 1)) * 127), 4 + i);
  return b.toString('base64');
}
export function unpack(s) {
  const b = Buffer.from(s, 'base64');
  const k = b.readFloatLE(0);
  const v = new Float32Array(b.length - 4);
  for (let i = 0; i < v.length; i++) v[i] = b.readInt8(4 + i) * k;
  return v;
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// A file of one very long line (a bundle, minified code) says nothing to read.
const minified = (text) => text.split('\n', 50).some((l) => l.length > 1500);

// A part's code in pieces the small model reads whole: each at most WORDING
// characters with its file and name on top. Before 29 Sep a part was cut at
// WORDING, so the end of a long function was never read (15% of this repo's
// parts, 31% of a bigger project's). The part itself stays one piece of code
// for the model: it is found when any of its pieces is close.
function wordings(head, lines) {
  const room = Math.max(200, WORDING - head.length);
  const out = [];
  let cur = '';
  for (const l of lines) {
    const line = l.slice(0, room);
    if (cur && cur.length + 1 + line.length > room) { out.push(cur); cur = line; } else cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  // A last piece of a closing brace or two says nothing on its own.
  if (out.length > 1 && out.at(-1).replace(/\s/g, '').length < 20) out.pop();
  return out.map((code) => `${head}${code}`);
}

// A file's parts, as the model would read them: the functions and classes;
// a class or a long function by its methods and inner parts (its head first),
// anything longer than PART_LINES in pieces. Each with the wordings the small
// model reads of it (one, or more for a long part).
export function partsOf(rel, text) {
  const lines = text.split('\n');
  const all = outline(text, rel);
  const pieces = [];
  for (let i = 0; i < all.length; i++) {
    const t = all[i];
    if (!t.top) continue;
    const inner = [];
    for (let k = i + 1; k < all.length && !all[k].top; k++) inner.push(all[k]);
    if (inner.length && inner[0].line > t.line) pieces.push({ name: t.name, line: t.line, end: inner[0].line - 1 });
    for (const p of inner) pieces.push({ name: t.name ? `${t.name} › ${p.name}` : p.name, line: p.line, end: p.end });
    if (!inner.length) pieces.push({ name: t.name, line: t.line, end: t.end });
  }
  // A comment just above a function says what the function does: it goes
  // with the function, not with the end of the part before it.
  const comment = (l) => /^\s*(\/\/|\/\*|\*|#(?!!))/.test(l ?? '');
  for (let i = 1; i < pieces.length; i++) {
    const prev = pieces[i - 1];
    const p = pieces[i];
    while (p.line - 1 > prev.line && prev.end === p.line - 1 && comment(lines[p.line - 2])) { p.line--; prev.end--; }
  }
  const out = [];
  for (const p of pieces) {
    for (let a = p.line; a <= p.end; a += PART_LINES) {
      const b = Math.min(p.end, a + PART_LINES - 1);
      const code = lines.slice(a - 1, b).join('\n');
      if (code.replace(/\s/g, '').length < 20) continue; // a blank gap or a lone brace
      const name = (p.end - p.line >= PART_LINES ? `${p.name ?? 'lines'} (lines ${a}-${b})` : p.name) ?? `lines ${a}-${b}`;
      out.push({ name, line: a, end: b, wordings: wordings(`${rel} · ${name}\n`, code.split('\n')) });
    }
  }
  return out;
}

// Numbers already worked out in this process, by what was read: a practice
// run copies the same project again and again, into new folders.
const known = new Map();

export class CodeIndex {
  constructor(cwd, embedder, { maxFiles = MAX_FILES, maxParts = MAX_PARTS, dir = MAP_DIR(), paused = null } = {}) {
    Object.assign(this, { cwd, embedder, maxFiles, maxParts, paused });
    this.file = join(dir, `${sha(cwd).slice(0, 16)}.code.json`);
    this.dir = dir;
    this.parts = []; // { rel, name, line, end, stamp, vec }: one for each wording, so a long part has several
    this.state = 'new'; // 'building' → 'ready', or 'off' (the small model did not answer)
    this.done = 0;
    this.total = 0;
    this.why = null;
    this.building = null;
  }

  get ready() { return this.parts.length > 0 && (this.state === 'ready' || this.state === 'building'); }

  // Starts a build, or joins the one running. Unchanged files come from the
  // saved index; a changed or new one is read again. Never throws.
  build({ signal } = {}) {
    this.building ??= this.#build(signal).catch((e) => {
      if (!this.parts.length) this.state = 'off';
      this.why = e.message;
    }).finally(() => { this.building = null; });
    return this.building;
  }

  async #build(signal) {
    if (this.state !== 'ready') this.state = 'building';
    const model = this.embedder?.model?.file ?? 'unknown';
    let saved = {};
    try { const j = JSON.parse(readFileSync(this.file, 'utf8')); if (j.model === model && j.format === FORMAT) saved = j.files ?? {}; } catch { /* none yet */ }
    // The most recently worked on first, so maxParts leaves out the least.
    const files = codeFiles(this.cwd, { max: this.maxFiles });
    const entries = {};
    const parts = [];
    const todo = [];
    for (const rel of files) {
      if (parts.length >= this.maxParts) break;
      let st;
      try { st = statSync(join(this.cwd, rel)); } catch { continue; }
      if (st.size > MAX_BYTES) continue;
      const stamp = `${Math.round(st.mtimeMs)}:${st.size}`;
      let entry = saved[rel]?.stamp === stamp ? saved[rel] : null;
      if (!entry) {
        let text;
        try { text = readFileSync(join(this.cwd, rel), 'utf8'); } catch { continue; }
        if (text.includes('\u0000') || minified(text)) continue;
        entry = { stamp, parts: partsOf(rel, text).flatMap((p) => p.wordings.map((w) => ({ n: p.name, a: p.line, b: p.end, h: sha(w).slice(0, 20), w }))) };
      }
      entries[rel] = entry;
      for (const p of entry.parts) {
        if (parts.length >= this.maxParts) break;
        if (!p.v) p.v = known.get(p.h) ?? null;
        if (!p.v) todo.push(p);
        parts.push({ rel, p, stamp });
      }
    }
    this.total = parts.length;
    this.done = parts.length - todo.length;
    const save = () => {
      // A file is kept once all of its parts have their numbers; the words
      // they were worked out from are not kept (the file itself has them).
      const out = {};
      for (const [rel, e] of Object.entries(entries)) if (e.parts.every((p) => p.v)) out[rel] = { stamp: e.stamp, parts: e.parts.map(({ n, a, b, h, v }) => ({ n, a, b, h, v })) };
      try {
        mkdirSync(this.dir, { recursive: true });
        const tmp = `${this.file}.${process.pid}`;
        writeFileSync(tmp, JSON.stringify({ model, format: FORMAT, cwd: this.cwd, files: out }));
        renameSync(tmp, this.file);
      } catch { /* a read-only home: worked out again next time */ }
    };
    for (let i = 0; i < todo.length; i += BATCH) {
      while (this.paused?.() && !signal?.aborted) await new Promise((r) => setTimeout(r, 400));
      if (signal?.aborted) break;
      const batch = todo.slice(i, i + BATCH);
      const vecs = await this.embedder.embed(batch.map((p) => p.w), { signal });
      batch.forEach((p, k) => { p.v = pack(vecs[k]); known.set(p.h, p.v); });
      this.done += batch.length;
      if ((i / BATCH) % SAVE_EVERY === SAVE_EVERY - 1) save();
    }
    save();
    // In the folder's order, so parts as close as each other come as before.
    this.parts = parts.filter((x) => x.p.v).map(({ rel, p, stamp }) => ({ rel, name: p.n, line: p.a, end: p.b, stamp, vec: unpack(p.v) })).sort((x, y) => byPath(x.rel, y.rel) || x.line - y.line);
    this.state = 'ready';
  }

  // The parts closest to a text, best first, each with its closeness (1 =
  // the same meaning), and each file's best closeness. null before the
  // first build has finished.
  async search(text, { signal, top = 40 } = {}) {
    if (!this.ready) return null;
    // The same words recall.mjs sends, so the embedder's cache answers the second ask.
    const [q] = await this.embedder.embed([String(text).slice(0, 2000)], { signal });
    const all = this.parts.map((p) => ({ rel: p.rel, name: p.name, line: p.line, end: p.end, stamp: p.stamp, close: dot(q, p.vec) })).sort((a, b) => b.close - a.close);
    // A long part once, by its closest piece.
    const seen = new Set();
    const scored = all.filter((s) => { const k = partKey(s); if (seen.has(k)) return false; seen.add(k); return true; });
    const files = new Map();
    for (const s of scored) if (!files.has(s.rel)) files.set(s.rel, s.close);
    // Every part's closeness, for a part the word search brings (Hybrid).
    const closeOf = new Map(scored.map((s) => [partKey(s), s.close]));
    return { parts: scored.slice(0, top), files, closeOf };
  }

  // The parts that share the request's words, best first (BM25, the word
  // half of /effort's Hybrid retriever). A part's words are read from its
  // file as it is now, and kept until the file changes.
  wordSearch(text, { top = WORD_TOP } = {}) {
    if (!this.ready) return [];
    if (this.words?.parts !== this.parts) {
      // Each part once, all of its lines.
      const seen = new Set();
      const list = this.parts.filter((p) => { const k = partKey(p); if (seen.has(k)) return false; seen.add(k); return true; });
      this.words = { parts: this.parts, list, index: new Words(list.map((p) => terms(this.textOf(p, Infinity)))) };
    }
    return this.words.index.order(text, top).map((i) => { const p = this.words.list[i]; return { rel: p.rel, name: p.name, line: p.line, end: p.end, stamp: p.stamp }; });
  }

  // A part as the small models read it: its file, its name, its first lines.
  textOf(p, chars = WORDING) {
    this.lines ??= new Map(); // rel → { stamp, lines }
    let f = this.lines.get(p.rel);
    if (!f || f.stamp !== p.stamp) {
      let lines = [];
      try { lines = readFileSync(join(this.cwd, p.rel), 'utf8').split('\n'); } catch { /* gone: its name is all there is */ }
      f = { stamp: p.stamp, lines };
      this.lines.set(p.rel, f);
    }
    return `${p.rel} · ${p.name}\n${f.lines.slice(p.line - 1, p.end).join('\n')}`.slice(0, chars);
  }
}

// What makes two parts the same one.
export const partKey = (p) => `${p.rel}#${p.line}`;

// Is a part as it was when its numbers were worked out? (An edit since moves its lines.)
export function sameAsIndexed(cwd, part) {
  try { const st = statSync(join(cwd, part.rel)); return `${Math.round(st.mtimeMs)}:${st.size}` === part.stamp; } catch { return false; }
}
