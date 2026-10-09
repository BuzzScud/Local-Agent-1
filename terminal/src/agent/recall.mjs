// Bringing facts back: the saved facts (facts.mjs) that fit a request come
// along with it, the way a bug's steps and the math notes do. They are found
// by meaning, with the small model of the models part (BGE-M3): the request
// and every fact become numbers, and the facts closest to the request are
// taken. Without that model the facts are found by the words they share.
// A fact's numbers are worked out once and kept beside the facts.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { memoryDirs, readFacts, markUsed, namesMissingFile, fileNames, filesIn, looksLikeEvent, countDay } from './facts.mjs';
import { choose } from './search.mjs';

// At most this many facts travel with a request (3 until 1 Oct 2026, the user's pick "keep more notes"). How
// close a fact must be (the embedder's cut and margin) decides first, so most requests still bring one.
export const TOP = 5;

// A note that only says what happened is skipped, and the screen says so
// (looksLikeEvent, in facts.mjs, which keeps it out of the short lines too).
export { looksLikeEvent };
// Trust moves a fact a little closer or further: three passed tasks weigh
// as much as 0.03 of closeness, where the cut-off is 0.56.
const TRUST_WEIGHT = 0.01;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const pack = (v) => Buffer.from(new Float32Array(v).buffer).toString('base64');
const unpack = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };

// The facts' numbers, kept in vectors.json and worked out again only for a
// fact that is new or was edited, or when the model changed.
async function vectorsFor(dir, facts, embedder, signal) {
  const file = join(dir, 'vectors.json');
  let kept = {};
  try { const j = JSON.parse(readFileSync(file, 'utf8')); if (j.model === embedder.model.file) kept = j.facts ?? {}; } catch { /* none yet */ }
  const want = facts.filter((f) => kept[f.id]?.h !== hash(f.text));
  if (want.length) {
    const made = await embedder.embed(want.map(wording), { signal });
    want.forEach((f, i) => { kept[f.id] = { h: hash(f.text), v: pack(made[i]) }; });
  }
  // Only a fact that left the folder loses its numbers: a recall (which
  // leaves out the rules read at every start) and a save (which reads them
  // all) would otherwise throw away each other's.
  const ids = new Set([...facts, ...readFacts(dir)].map((f) => f.id));
  const gone = Object.keys(kept).filter((id) => !ids.has(id));
  for (const id of gone) delete kept[id];
  if (want.length || gone.length) { try { writeFileSync(file, JSON.stringify({ model: embedder.model.file, facts: kept })); } catch { /* read-only folder: worked out again next time */ } }
  return new Map(facts.map((f) => [f.id, unpack(kept[f.id].v)]));
}
// What is compared with the request: the fact, and a recipe's steps with it.
const wording = (f) => `${f.text}${f.steps?.length ? ` ${f.steps.join('. ')}` : ''}`;
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

const STOP = new Set('a an the and or of to in on at for with from by is are was were be it its this that these those i me my we our you your do does did can could should would will what where when why how which who not no so as if then than there here have has had one only each every all any some more most such also into out up down over under again very just about before after'.split(' '));
export function wordsOf(text) {
  const out = [];
  for (let w of String(text).toLowerCase().replace(/z-index/g, 'zindex').match(/[a-z0-9][a-z0-9_+#-]*/g) ?? []) {
    w = w.replace(/^[-_]+|[-_]+$/g, '');
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    if (w.length > 1 && !STOP.has(w)) out.push(w);
  }
  return out;
}
// By words: a rare word shared with the request counts for more than a
// common one, and one shared word is never enough: a fact comes back when
// it shares two words or more that together weigh more than one word found
// in no other fact.
function byWords(text, facts) {
  const docs = new Map(facts.map((f) => [`${f.dir}\0${f.id}`, new Set(wordsOf(wording(f)))]));
  const df = new Map();
  for (const d of docs.values()) for (const w of d) df.set(w, (df.get(w) ?? 0) + 1);
  const q = new Set(wordsOf(text));
  return new Map(facts.map((f) => {
    const shared = [...q].filter((w) => docs.get(`${f.dir}\0${f.id}`).has(w));
    return [`${f.dir}\0${f.id}`, shared.length >= 2 ? shared.reduce((s, w) => s + Math.log(1 + facts.length / df.get(w)), 0) : 0];
  }));
}

// The facts that fit a request, best first.
//   embedder  the models part's Embedder (null: by words)
// Answers { facts, how, ms }; how is 'meaning', 'words' or 'none' (nothing saved).
// near: how many of the next closest facts to also give back (with their closeness), for the Instructions page; the agent leaves it at 0.
// retriever, reranker: /effort's Search rows (search.mjs): which facts come;
// how many is still the cut-off's.
export async function recall(cwd, text, { embedder = null, home = homedir(), top = TOP, signal, today, mark = true, near = 0, retriever = 'meaning', reranker = null } = {}) {
  const t0 = Date.now();
  const dirs = memoryDirs(cwd, home);
  const root = dirs.project ? dirname(dirname(dirs.project)) : null;
  // What is always read is in the instructions already; a fact about a file
  // that is gone is left where it is (tidy retires it).
  const names = root ? fileNames(root) : null;
  const facts = [...readFacts(dirs.you), ...readFacts(dirs.project)].filter((f) => !f.always && !namesMissingFile(f, root, names));
  if (!facts.length || !String(text).trim()) {
    if (mark && String(text).trim()) countDay(dirs, { requests: 1 }, today);
    return { facts: [], skipped: [], how: 'none', ms: Date.now() - t0 };
  }
  let scored = null;
  let how = 'words';
  let note = null;
  if (embedder) {
    try {
      const vec = new Map();
      for (const dir of [dirs.you, dirs.project]) if (dir && existsSync(dir)) for (const [id, v] of await vectorsFor(dir, facts.filter((f) => f.dir === dir), embedder, signal)) vec.set(`${dir}\0${id}`, v);
      const [q] = await embedder.embed([String(text).slice(0, 2000)], { signal });
      scored = facts.map((f) => ({ fact: f, close: dot(q, vec.get(`${f.dir}\0${f.id}`)) }));
      how = 'meaning';
    } catch (e) {
      if (signal?.aborted || e.name === 'AbortError') throw e;
      note = `The memory's matcher did not answer (${e.message}); matching by words.`;
    }
  }
  let cut;
  let margin;
  if (scored) { cut = embedder.model.cut; margin = embedder.model.margin; }
  else {
    const w = byWords(text, facts);
    scored = facts.map((f) => ({ fact: f, close: w.get(`${f.dir}\0${f.id}`) }));
    cut = Math.log(1 + facts.length) + 0.01; margin = Infinity;
  }
  const weight = how === 'meaning' ? TRUST_WEIGHT : TRUST_WEIGHT * 10;
  for (const s of scored) s.score = s.close + weight * clamp(s.fact.trust, -3, 3);
  scored.sort((a, b) => b.score - a.score);
  const event = (s) => looksLikeEvent(s.fact.text);
  const real = scored.filter((s) => !event(s));
  const best = real[0]?.score ?? 0;
  const n = real.filter((s) => s.score >= cut && s.score >= best - margin).slice(0, top).length;
  const keyOf = (s) => `${s.fact.dir}\0${s.fact.id}`;
  let wordOrder = null;
  if (retriever === 'hybrid' && how === 'meaning') {
    const w = byWords(text, facts);
    wordOrder = real.filter((s) => w.get(keyOf(s)) > 0).sort((a, b) => w.get(keyOf(b)) - w.get(keyOf(a)));
  }
  const chosen = await choose({ query: text, byMeaning: real, byWords: wordOrder, n, key: keyOf, text: (s) => wording(s.fact), retriever, reranker, signal });
  const picked = chosen.picked;
  const skipped = scored.filter((s) => event(s) && s.score >= cut).slice(0, top);
  if (mark && picked.length) for (const dir of new Set(picked.map((s) => s.fact.dir))) markUsed(dir, picked.filter((s) => s.fact.dir === dir).map((s) => s.fact.id), today);
  if (mark) countDay(dirs, { requests: 1, found: picked.length ? 1 : 0 }, today);
  const plain = (s) => ({ ...s.fact, close: Math.round(s.close * 1000) / 1000 });
  return { facts: picked.map(plain), skipped: skipped.map(plain), how, ms: Date.now() - t0, chosen, ...(note || chosen.note ? { note: note ?? chosen.note } : {}), ...(near ? { near: real.filter((s) => !picked.includes(s)).slice(0, near).map(plain) } : {}) };
}

// Which of the facts that came with a request the turn really used, from
// what it did (each step's file, command or search) and its answer. Trust
// changes only for these: before, every fact that came along gained or lost
// trust with the task, whether it had anything to do with it or not.
//   a fact that names a file: that file was read, changed or named
//   a fact with a `command`: that command was run
//   any other fact: two of its words or more, and at least 40% of them
const COMMAND = /`([^`]{3,80})`/g;
export function usedFacts(recalled = [], evidence = '') {
  const said = String(evidence).toLowerCase();
  if (!said.trim()) return [];
  const words = new Set(wordsOf(said));
  return recalled.filter((f) => {
    const text = String(f.text ?? '');
    const files = filesIn(text).map((p) => p.split('/').pop().toLowerCase());
    if (files.length) return files.some((n) => said.includes(n));
    const commands = [...text.matchAll(COMMAND)].map((m) => m[1].toLowerCase().trim());
    if (commands.length) return commands.some((c) => said.includes(c));
    const mine = [...new Set(wordsOf(text))];
    const shared = mine.filter((w) => words.has(w)).length;
    return shared >= 2 && shared >= 0.4 * mine.length;
  });
}

// Each fact's numbers by `dir\0id`, from the vectors.json beside it.
export async function factVectors(facts, embedder, signal) {
  const out = new Map();
  for (const dir of new Set(facts.map((f) => f.dir))) {
    if (!dir || !existsSync(dir)) continue;
    for (const [id, v] of await vectorsFor(dir, facts.filter((f) => f.dir === dir), embedder, signal)) out.set(`${dir}\0${id}`, v);
  }
  return out;
}

// The n facts closest to a text, best first (by meaning, or by words when
// the small model is not here); all of them when there are n or fewer. The
// save shows the model these, not every fact: 200 facts would be about
// 8,000 tokens, some 40 seconds of reading, on every save.
export async function closest(facts, text, { embedder = null, n = 15, signal } = {}) {
  if (facts.length <= n) return facts;
  const key = (f) => `${f.dir}\0${f.id}`;
  let score = null;
  if (embedder) {
    try {
      const vec = await factVectors(facts, embedder, signal);
      const [q] = await embedder.embed([String(text).slice(0, 2000)], { signal });
      score = (f) => (vec.has(key(f)) ? dot(q, vec.get(key(f))) : -1);
    } catch (e) { if (signal?.aborted || e.name === 'AbortError') throw e; }
  }
  if (!score) { const w = byWords(text, facts); score = (f) => w.get(key(f)) ?? 0; }
  return facts.map((f, i) => ({ f, i, s: score(f) })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, n).map((x) => x.f);
}

// The saved facts about the same thing as a new one, closest first, for Remember to show the
// model so it can retire one the new fact makes out of date. Only those past the recall's own
// cut (by meaning, or by words without the small model): a fact that is merely nearby is not one.
export async function nearFacts(facts, text, { embedder = null, n = 3, signal } = {}) {
  if (!facts.length || !String(text).trim()) return [];
  const key = (f) => `${f.dir}\0${f.id}`;
  if (embedder) {
    try {
      const vec = await factVectors(facts, embedder, signal);
      const [q] = await embedder.embed([String(text).slice(0, 2000)], { signal });
      return facts.filter((f) => vec.has(key(f))).map((f) => ({ f, s: dot(q, vec.get(key(f))) }))
        .filter((x) => x.s >= embedder.model.cut).sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.f);
    } catch (e) { if (signal?.aborted || e.name === 'AbortError') throw e; }
  }
  const w = byWords(text, facts);
  const cut = Math.log(1 + facts.length) + 0.01;
  return facts.map((f) => ({ f, s: w.get(key(f)) ?? 0 })).filter((x) => x.s >= cut).sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.f);
}

const LABEL = { you: 'about you', project: 'this project', worked: 'this worked', failed: 'this failed before: do not try it again', mistake: 'a mistake to avoid', recipe: 'steps that worked before' };
// What goes with the request. The model is told these are memories, not
// what the files say now.
export function recallNotes(facts) {
  if (!facts.length) return '';
  const lines = facts.map((f) => `- (${LABEL[f.kind] ?? f.kind}) ${f.text.replace(/\s+/g, ' ')}${f.steps?.length ? ` ${f.steps.map((s, i) => `${i + 1}. ${s}`).join(' ')}` : ''}`);
  return `From your memory, saved in earlier conversations here. Use what fits; the files are right where a memory and a file disagree.\n${lines.join('\n')}`;
}
