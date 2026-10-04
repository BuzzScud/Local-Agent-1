// Claude's notes: what Claude Code has written down about your work over
// many conversations (its memory folder), as a second place Agentic Coder's memory
// looks. There are hundreds of them, far more than the model can hold, so
// they come the way saved facts do (recall.mjs): up to four that fit a
// request, found by meaning, cut to the part that fits, written into the
// request itself.
//   read where they are   every time, so a note written today is there today
//   never changed         Agentic Coder's own numbers for them are kept in its own
//                         folder (~/.agentic-coder/claude-notes), not beside them
//   sign-ins, servers     a note about them is left out whole; in a note that
//   and secrets           is kept, a line that holds one is left out
//   written for Claude    the model is told so: a note may name tools Agentic Coder
//                         does not have, and may be out of date
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { HOME } from '../../../models/index.mjs';
import { looksSecret } from './facts.mjs';
import { wordsOf } from './recall.mjs';
import { choose } from './search.mjs';
import { packDir, sameProject } from './claude-pack.mjs';

// At most this many notes travel with a request (2 until 1 Oct 2026, the user's pick "keep more notes": on
// their recent requests it added a note to 6 of 13, about 300–630 tokens). CUT and MARGIN decide first.
export const TOP = 4;
const PART_CHARS = 1100; // of one note
// When a note comes along. Its meaning must be close to the request's (1 is
// the same meaning): very close is enough by itself (CUT), less close counts
// only when the two also share words that few notes hold (NEAR and WORDS).
// A second note may be no further than MARGIN behind the first. Measured on
// the 50 requests of the check (models/evals/bench/memory/claude-notes.mjs):
// by meaning alone, requests that need no note reached 0.57 and notes that
// were needed started at 0.49, so no single line divides them.
export const CUT = 0.6;
export const NEAR = 0.5;
export const WORDS = 9.5;
export const MARGIN = 0.04;
// A note about the project Agentic Coder is working in counts as a little closer,
// and so does a note on how the user likes things done: it holds for every
// project, where a note about one design round holds for that round.
const HERE = 0.02;
const WORDS_CAP = 100; // by words: the cut stops growing at 300 notes (recallClaude)
const ABOUT_THEM = 0.03;

// Whether Claude's notes are used at all: "claudeNotes": false in
// settings.json, or AGENTIC_CLAUDE_NOTES=off (the app's tests), leaves them out,
// and the lines boiled down from them with them.
export const claudeOn = (settings = {}) => settings.claudeNotes !== false && !['off', ''].includes(process.env.AGENTIC_CLAUDE_NOTES ?? 'on');

// Where the notes are: AGENTIC_CLAUDE_NOTES or the setting "claudeNotes" names
// the folder ("off" or false: none; a pack's folder means its notes/); otherwise
// the pack of Claude's notes when one is built (claude-pack.mjs, `bun run pack`:
// every memory folder and the copies, 3 Oct 2026), else Claude Code's memory
// folder for your home folder, the one it writes to from any folder on this Mac.
export function notesDir({ home = homedir(), setting, pack = packDir() } = {}) {
  const named = process.env.AGENTIC_CLAUDE_NOTES ?? setting;
  if (named === false || named === 'off' || named === '') return null;
  if (typeof named === 'string') return existsSync(join(named, 'pack.json')) && existsSync(join(named, 'notes')) ? join(named, 'notes') : existsSync(named) ? named : null;
  if (pack && existsSync(join(pack, 'notes', 'MEMORY.md'))) return join(pack, 'notes');
  const slug = home.replace(/[/.]/g, '-');
  for (const base of ['.claude', '.claude-2']) {
    const dir = join(home, base, 'projects', slug, 'memory');
    if (existsSync(join(dir, 'MEMORY.md'))) return dir;
  }
  return null;
}

// "name: x" lines between the two --- lines at the top; the type may sit
// under "metadata:". project: the project a note of the pack belongs to
// (claude-pack.mjs writes it), empty for a note about the user or any project.
export function parseNote(raw, file) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  const head = m?.[1] ?? '';
  const field = (k) => { const x = new RegExp(`^\\s*${k}:\\s*(.*)$`, 'm').exec(head)?.[1]?.trim() ?? ''; return /^".*"$/.test(x) ? x.slice(1, -1).replace(/\\"/g, '"') : x.replace(/^'|'$/g, ''); };
  const id = basename(file, '.md');
  return { id, file, name: field('name') || id, description: field('description'), type: field('type') || 'project', project: field('project'), modified: field('modified'), body: (m ? raw.slice(m[0].length) : raw).trim() };
}

// What Claude's own list of its notes (MEMORY.md) calls each one: "[Rules app
// (START HERE for "my rules")](rules-app.md)". Written to find the note by,
// so it is compared with the request along with the note's summary.
const lists = new Map(); // folder → { stamp, titles }
function titlesIn(dir) {
  const file = join(dir, 'MEMORY.md');
  let st;
  try { st = statSync(file); } catch { return new Map(); }
  const stamp = `${Math.round(st.mtimeMs)}:${st.size}`;
  let had = lists.get(dir);
  if (had?.stamp !== stamp) {
    const titles = new Map();
    let raw = '';
    try { raw = readFileSync(file, 'utf8'); } catch { /* no list */ }
    for (const m of raw.matchAll(/\[([^\]\n]{3,160})\]\(([\w.-]+)\.md\)/g)) {
      const t = m[1].replace(/\s+/g, ' ').trim();
      if (holdsSecret(t)) continue;
      titles.set(m[2], [...(titles.get(m[2]) ?? []), t].slice(0, 3));
    }
    had = { stamp, titles };
    lists.set(dir, had);
  }
  return had.titles;
}

// Every note, read again only when its file changed.
const seen = new Map(); // file → { stamp, note }
export function readNotes(dir) {
  if (!dir) return [];
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'MEMORY.md'); } catch { return []; }
  const titles = titlesIn(dir);
  const out = [];
  for (const n of names) {
    const file = join(dir, n);
    let st;
    try { st = statSync(file); } catch { continue; }
    if (!st.isFile() || st.size > 400_000) continue;
    const stamp = `${Math.round(st.mtimeMs)}:${st.size}`;
    let had = seen.get(file);
    if (had?.stamp !== stamp) {
      let raw;
      try { raw = readFileSync(file, 'utf8'); } catch { continue; }
      had = { stamp, note: parseNote(raw, file) };
      seen.set(file, had);
    }
    const title = (titles.get(had.note.id) ?? []).join('. ');
    out.push(title === had.note.title ? had.note : (had.note = { ...had.note, title }));
  }
  return out;
}

// A note that is about a way in: signing in, a server of yours, a secret.
// Judged by what the note is called and how its summary begins, not by a
// word somewhere inside it (a third of all notes mention "token" or
// "secret" in passing: a secret scan that ran, a model's tokens).
const WAY_IN = /\b(secrets?|passwords?|passcodes?|credentials?|api[ _-]?keys?|keychain|ssh|sign-?ins?|log-?ins?|auth|oauth|2fa|lockdown|hardening|security|invites?|accounts?)\b/i;
const SERVER = /\b(droplet|deploy(ment)?s?|production|nginx|dns|firewall|vps)\b/i;
// In the summary only the plain words for a secret count: "pages behind
// login" in a recipe for looking at a page is not a note about signing in.
const SECRET_WORD = /\b(secret|passwords?|passcodes?|credentials?|api[ _-]?keys?|private key)\b/i;
export function leftOut(note) {
  const called = `${note.id.replace(/-/g, ' ')} ${note.name.replace(/-/g, ' ')}`;
  if (WAY_IN.test(called)) return 'it is about signing in or a secret';
  if (SERVER.test(called)) return 'it is about a server of yours';
  if (SECRET_WORD.test(note.description.slice(0, 200))) return 'its summary names a secret';
  return null;
}

// A line that holds a secret or a way in. Counting words a model reads
// ("32,000 tokens", "tokens a second") is not one.
const HOLDS = /\b(passw(or)?ds?|passcodes?|passphrase|credentials?|api[ _-]?keys?|keychain|bearer|private key|shared secret|secrets?\b(?! scan))|(^|[\s\/`'"(])\.env\b|\b(ssh|scp|sftp)\s+\S|\b(?!127\.0\.0\.1\b|0\.0\.0\.0\b)\d{1,3}(?:\.\d{1,3}){3}\b|\b(access|auth|session|refresh|local|desk)[ _-]?tokens?\b|\btokens?\s*(is|[:=])\s*\S/i;
export const holdsSecret = (line) => looksSecret(line) || HOLDS.test(line);

// The note in pieces: its paragraphs and bullets, without the lines that
// hold a secret.
export function pieces(note) {
  const out = [];
  let cur = [];
  const flush = () => { const t = cur.join('\n').trim(); if (t) out.push(t.length > 900 ? `${t.slice(0, 900)}…` : t); cur = []; };
  for (const line of note.body.split('\n')) {
    if (holdsSecret(line)) continue;
    if (!line.trim()) { flush(); continue; }
    if (/^\s*([-*•]|\d+\.)\s+\S|^#{1,4}\s|^\*\*[^*]+\*\*/.test(line) && cur.length) flush();
    cur.push(line);
  }
  flush();
  return out;
}

// The part of a note that fits a request: its summary, then the pieces that
// share the most words with the request, in the note's own order.
export function bestPart(note, request, maxChars = PART_CHARS) {
  const q = new Set(wordsOf(request));
  const summary = holdsSecret(note.description) ? '' : note.description.trim();
  const all = pieces(note).map((text, i) => ({ text, i, n: new Set(wordsOf(text).filter((w) => q.has(w))).size }));
  const ranked = [...all].sort((a, b) => b.n - a.n || a.i - b.i);
  const take = [];
  let used = summary.length;
  for (const p of ranked) {
    if (used + p.text.length + 1 > maxChars) { if (!take.length && maxChars - used > 200) take.push({ ...p, text: `${p.text.slice(0, maxChars - used - 1)}…` }); break; }
    take.push(p);
    used += p.text.length + 1;
  }
  const body = take.sort((a, b) => a.i - b.i).map((p) => p.text).join('\n');
  return [summary, body].filter(Boolean).join('\n');
}

// A note of the pack that was cut to how it stands now keeps its whole text in history/ beside
// notes/ (claude-pack.mjs). Its part prefers the top: a piece of the history comes too only when it
// shares two words more with the request than the best piece of the top does (port 5434 of the
// distribution work sat in an older part of its note, 3 Oct 2026).
function historyPiece(note, request, dir) {
  const file = join(dirname(dir), 'history', `${note.id}.md`);
  if (!existsSync(file)) return null;
  const q = new Set(wordsOf(request));
  const shared = (t) => new Set(wordsOf(t).filter((w) => q.has(w))).size;
  const top = Math.max(0, ...pieces(note).map(shared));
  let full;
  try { full = parseNote(readFileSync(file, 'utf8'), file); } catch { return null; }
  const best = pieces(full).map((text, i) => ({ text, i, n: shared(text) })).filter((p) => p.n >= top + 2).sort((a, b) => b.n - a.n || b.i - a.i)[0];
  return best ? `(from the whole note) ${best.text}` : null;
}

const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const pack = (v) => Buffer.from(new Float32Array(v).buffer).toString('base64');
const unpack = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
// What is compared with a request: what the note is called and its summary
// (written, in Claude's memory, to decide exactly this).
export const wording = (n) => `${n.title ? `${n.title}. ` : ''}${n.name.replace(/-/g, ' ')}: ${holdsSecret(n.description) ? '' : n.description}`.slice(0, 1200);

// Where Agentic Coder keeps its own numbers for the notes (never beside the notes).
const notesStore = () => process.env.AGENTIC_CLAUDE_STORE ?? join(process.env.AGENTIC_HOME ?? HOME, 'claude-notes');
let held = null; // the numbers as last read: { file, model, kept, vec }
async function vectorsFor(notes, embedder, signal, store = notesStore()) {
  const file = join(store, 'vectors.json');
  let kept = {};
  if (held?.file === file && held.model === embedder.model.file) kept = held.kept;
  else try { const j = JSON.parse(readFileSync(file, 'utf8')); if (j.model === embedder.model.file) kept = j.notes ?? {}; } catch { /* none yet */ }
  if (held?.kept !== kept) held = { file, model: embedder.model.file, kept, vec: new Map() };
  const want = notes.filter((n) => kept[n.id]?.h !== hash(wording(n)));
  if (want.length) {
    const made = await embedder.embed(want.map(wording), { signal });
    want.forEach((n, i) => { kept[n.id] = { h: hash(wording(n)), v: pack(made[i]) }; held.vec.delete(n.id); });
  }
  const ids = new Set(notes.map((n) => n.id));
  const gone = Object.keys(kept).filter((id) => !ids.has(id));
  for (const id of gone) delete kept[id];
  if (want.length || gone.length) { try { mkdirSync(store, { recursive: true }); writeFileSync(file, JSON.stringify({ model: embedder.model.file, notes: kept })); } catch { /* worked out again next time */ } }
  for (const n of notes) if (!held.vec.has(n.id)) held.vec.set(n.id, unpack(kept[n.id].v));
  return { vec: held.vec, made: want.length };
}

// By words, when the small model is not here: a rare word shared with the
// request counts for more, and one shared word is never enough.
const wordSets = new Map(); // note id → { h, words }
function wordsIn(n) {
  const h = hash(wording(n));
  let had = wordSets.get(n.id);
  if (had?.h !== h) { had = { h, words: new Set(wordsOf(wording(n))) }; wordSets.set(n.id, had); }
  return had.words;
}
function byWords(text, notes) {
  const docs = new Map(notes.map((n) => [n.id, wordsIn(n)]));
  const df = new Map();
  for (const d of docs.values()) for (const w of d) df.set(w, (df.get(w) ?? 0) + 1);
  const q = new Set(wordsOf(text));
  return new Map(notes.map((n) => {
    const shared = [...q].filter((w) => docs.get(n.id).has(w));
    return [n.id, shared.length >= 2 ? shared.reduce((s, w) => s + Math.log(1 + notes.length / df.get(w)), 0) : 0];
  }));
}

// The folders Agentic Coder is working in, by name: ~/Desktop/MAIN2026/desks/chart
// gives main2026 and chart. A name any project could have says nothing.
const ANY_PROJECT = new Set(['project', 'projects', 'desktop', 'documents', 'downloads', 'users', 'home', 'code', 'work', 'worktrees', 'repo', 'repos', 'src', 'app', 'apps', 'site', 'web', 'main', 'test', 'tests', 'desk', 'desks', 'private', 'folders', 'var', 'tmp', 'temp']);
const THROWAWAY = /^\/(private\/)?(tmp|var\/folders)\//;
export function foldersOf(cwd, home = homedir()) {
  if (THROWAWAY.test(`${cwd}/`) && !cwd.startsWith(`${home}/`)) return []; // a throwaway folder is nobody's project
  const path = cwd.startsWith(`${home}/`) ? cwd.slice(home.length) : cwd;
  // A GitHub download's folder ("MAIN2026-main-2") is its project's too ("main2026").
  const names = path.toLowerCase().split('/').flatMap((p) => [p, p.replace(/-(main|master)(-\d+)?$/, '')]);
  return [...new Set(names.filter((p) => p.length >= 4 && !ANY_PROJECT.has(p)))];
}

// The notes that fit a request, best first: { notes: [{ id, name, type,
// description, part, close }], how, ms, of }. how is 'meaning', 'words' or
// 'none' (no folder, or nothing in it).
//   kind   how the request was sorted. For work on the code here (fix,
//          change, rename) a note about ANOTHER project of the user's does
//          not come along: notes about Agentic Coder's own practice tasks fitted
//          "the tests fail, fix them" in every project (28 Sep 2026). Notes
//          on how the user likes things done and on how something is done
//          on this Mac hold everywhere.
//   retriever, reranker  /effort's Search rows (search.mjs): which notes come;
//          how many is still the cut-off's.
//   sent   what may go to this model (Memory sent, opening.mjs memorySent): 'all' (a model on this
//          Mac, or the owner's own machine), 'project' (any other service: only the notes about the
//          project it works in; notes about the user stay on this Mac) or 'none'.
export const sentAllows = (sent, cwd, isHere) => (n) => sent !== 'project' || (n.project ? sameProject(n.project, cwd) : n.type === 'project' && isHere(n));
export async function recallClaude(cwd, text, { embedder = null, dir = notesDir(), top = TOP, signal, store, kind = null, retriever = 'meaning', reranker = null, sent = 'all' } = {}) {
  const t0 = Date.now();
  const folders = foldersOf(cwd);
  const isHere = (n) => { const t = `${n.id} ${n.title ?? ''} ${n.description}`.toLowerCase(); return folders.some((f) => t.includes(f)) || Boolean(n.project && sameProject(n.project, cwd)); };
  const onTheCode = ['fix', 'change', 'rename'].includes(kind);
  if (sent === 'none') return { notes: [], how: 'none', ms: 0, of: 0 };
  const may = sentAllows(sent, cwd, isHere);
  const notes = readNotes(dir).filter((n) => !leftOut(n) && n.description && may(n) && !(onTheCode && n.type === 'project' && !isHere(n)));
  if (!notes.length || !String(text).trim()) return { notes: [], how: 'none', ms: Date.now() - t0, of: notes.length };
  const about = (n) => (isHere(n) ? HERE : 0);
  let scored = null;
  let how = 'words';
  let note = null;
  const shared = byWords(text, notes);
  if (embedder) {
    try {
      const { vec } = await vectorsFor(notes, embedder, signal, store);
      const [q] = await embedder.embed([String(text).slice(0, 2000)], { signal });
      scored = notes.map((n) => ({ note: n, close: dot(q, vec.get(n.id)), words: shared.get(n.id) }));
      how = 'meaning';
    } catch (e) {
      if (signal?.aborted || e.name === 'AbortError') throw e;
      note = `The memory's matcher did not answer (${e.message}); Claude's notes are matched by words.`;
    }
  }
  let fits;
  let margin = MARGIN;
  if (scored) {
    for (const s of scored) s.score = s.close + about(s.note) + (s.note.type === 'feedback' || s.note.type === 'user' ? ABOUT_THEM : 0);
    fits = (s) => s.score >= CUT || (s.score >= NEAR && s.words >= WORDS);
  } else {
    scored = notes.map((n) => ({ note: n, close: shared.get(n.id), words: shared.get(n.id), score: shared.get(n.id) }));
    // Two words found in three notes each, up to 300 notes; past that, two found in 1% of them. With
    // the pack's ~1,000 notes the uncapped cut (11.6) let 5 of the 16 questions of the maps and notes
    // check find their note; capped (9.2), 9 of 16, and 1 of 15 requests that need none got one (3 Oct 2026).
    const cut = 2 * Math.log(1 + Math.min(notes.length / 3, WORDS_CAP));
    fits = (s) => s.score >= cut;
    margin = Infinity;
  }
  scored.sort((a, b) => b.score - a.score);
  const first = scored.find(fits);
  const all = Boolean(process.env.AGENTIC_NOTES_ALL);
  const n = (all ? scored : first ? scored.filter((s) => fits(s) && s.score >= first.score - margin) : []).slice(0, top).length;
  const wordOrder = retriever === 'hybrid' && how === 'meaning' ? scored.filter((s) => s.words > 0).sort((a, b) => b.words - a.words) : null;
  const chosen = all ? { picked: scored.slice(0, top) } : await choose({ query: text, byMeaning: scored, byWords: wordOrder, n, key: (s) => s.note.id, text: (s) => `${s.note.name.replace(/-/g, ' ')}: ${s.note.description}`, retriever, reranker, signal });
  const picked = chosen.picked;
  return {
    notes: picked.map((s) => {
      const extra = historyPiece(s.note, text, dir);
      const part = bestPart(s.note, text, extra ? PART_CHARS - Math.min(extra.length, 500) - 1 : PART_CHARS);
      return { id: s.note.id, name: s.note.name, type: s.note.type, ...(s.note.project ? { project: s.note.project } : {}), description: s.note.description, part: extra ? `${part}\n${extra.length > 500 ? `${extra.slice(0, 499)}…` : extra}` : part, close: Math.round(s.close * 1000) / 1000, words: Math.round(s.words * 10) / 10 };
    }),
    how, ms: Date.now() - t0, of: notes.length, chosen, ...(note || chosen.note ? { note: note ?? chosen.note } : {}),
  };
}

const KIND = { feedback: 'how the user likes things done', user: 'about the user', project: 'about a project of theirs', reference: 'how something is done on this Mac' };
// What goes with the request.
export function claudeText(notes, { pack = false } = {}) {
  if (!notes.length) return '';
  // From the pack, a note is named as it opens (NOTES/notes/<id>.md); a project's note says which project.
  const blocks = notes.map((n) => `[${pack ? n.id : n.name.replace(/-/g, ' ')}] (${n.project ? `about the ${n.project} project` : KIND[n.type] ?? n.type})\n${n.part}`);
  // "Do not go looking": with a note in hand the model went to open the
  // files the note names, which are in other folders, behind the fence, and
  // ran out of time with no answer (3 of 6 questions, 28 Sep 2026).
  // "The request comes first": a note that says where finished files go
  // ("on the Desktop") once sent a file there that the request wanted "in
  // this folder" (practice task 18, 28 Sep 2026).
  // "Apps": a note that ends "Then `open` it" sent Qwen to run open, which
  // the fence stops (30 Sep 2026).
  return `From Claude's notes. Claude Code wrote these for itself in earlier conversations with this user. The request above comes first: where it names a place, a file name or a way of doing it, do what it says, whatever a note says. When the notes hold the answer to a question, answer from them now, in your own plain words, and say that it comes from Claude's notes. The files and folders a note names are mostly in other folders, which you cannot open from here: do not go looking for them. A note can name tools you do not have, and it can be out of date: where a file in THIS folder says otherwise, the file is right. You cannot start apps: where a note says to open a file or a page, say where it is, with its full path, instead.${pack ? ' When the piece here is not enough, Read the whole note at NOTES/notes/<the name in brackets>.md.' : ''}\n${blocks.join('\n\n')}`;
}

// For the /memory panel and the results page: how many notes there are, how
// many are left out and why.
export function notesCount(dir = notesDir()) {
  const all = readNotes(dir);
  const out = all.map((n) => ({ id: n.id, why: leftOut(n) })).filter((x) => x.why);
  return { dir, all: all.length, used: all.length - out.length, leftOut: out };
}
