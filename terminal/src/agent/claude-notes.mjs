// Claude's notes: what Claude Code has written down about your work over
// many conversations (its memory folder), as a second place Bonsai's memory
// looks. There are hundreds of them, far more than the model can hold, so
// they come the way saved facts do (recall.mjs): the one or two that fit a
// request, found by meaning, cut to the part that fits, written into the
// request itself.
//   read where they are   every time, so a note written today is there today
//   never changed         Bonsai's own numbers for them are kept in its own
//                         folder (~/.bonsai-code/claude-notes), not beside them
//   sign-ins, servers     a note about them is left out whole; in a note that
//   and secrets           is kept, a line that holds one is left out
//   written for Claude    the model is told so: a note may name tools Bonsai
//                         does not have, and may be out of date
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { HOME } from '../../../models/index.mjs';
import { looksSecret } from './facts.mjs';
import { wordsOf } from './recall.mjs';

export const TOP = 2; // at most this many notes travel with a request
export const PART_CHARS = 1100; // of one note
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
// A note about the project Bonsai is working in counts as a little closer,
// and so does a note on how the user likes things done: it holds for every
// project, where a note about one design round holds for that round.
const HERE = 0.02;
const ABOUT_THEM = 0.03;

// Whether Claude's notes are used at all: "claudeNotes": false in
// settings.json, or BONSAI_CLAUDE_NOTES=off (the app's tests), leaves them out,
// and the lines boiled down from them with them.
export const claudeOn = (settings = {}) => settings.claudeNotes !== false && !['off', ''].includes(process.env.BONSAI_CLAUDE_NOTES ?? 'on');

// Where the notes are: BONSAI_CLAUDE_NOTES or the setting "claudeNotes" names
// the folder ("off" or false: none); otherwise Claude Code's memory folder
// for your home folder, the one it writes to from any folder on this Mac.
export function notesDir({ home = homedir(), setting } = {}) {
  const named = process.env.BONSAI_CLAUDE_NOTES ?? setting;
  if (named === false || named === 'off' || named === '') return null;
  if (typeof named === 'string') return existsSync(named) ? named : null;
  const slug = home.replace(/[/.]/g, '-');
  for (const base of ['.claude', '.claude-2']) {
    const dir = join(home, base, 'projects', slug, 'memory');
    if (existsSync(join(dir, 'MEMORY.md'))) return dir;
  }
  return null;
}

// "name: x" lines between the two --- lines at the top; the type may sit
// under "metadata:".
function parse(raw, file) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  const head = m?.[1] ?? '';
  const field = (k) => { const x = new RegExp(`^\\s*${k}:\\s*(.*)$`, 'm').exec(head)?.[1]?.trim() ?? ''; return /^".*"$/.test(x) ? x.slice(1, -1).replace(/\\"/g, '"') : x.replace(/^'|'$/g, ''); };
  const id = basename(file, '.md');
  return { id, file, name: field('name') || id, description: field('description'), type: field('type') || 'project', body: (m ? raw.slice(m[0].length) : raw).trim() };
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
      had = { stamp, note: parse(raw, file) };
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

const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const pack = (v) => Buffer.from(new Float32Array(v).buffer).toString('base64');
const unpack = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
// What is compared with a request: what the note is called and its summary
// (written, in Claude's memory, to decide exactly this).
export const wording = (n) => `${n.title ? `${n.title}. ` : ''}${n.name.replace(/-/g, ' ')}: ${holdsSecret(n.description) ? '' : n.description}`.slice(0, 1200);

// Where Bonsai keeps its own numbers for the notes (never beside the notes).
export const notesStore = () => process.env.BONSAI_CLAUDE_STORE ?? join(process.env.BONSAI_HOME ?? HOME, 'claude-notes');
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

// The folders Bonsai is working in, by name: ~/Desktop/MAIN2026/desks/chart
// gives main2026 and chart. A name any project could have says nothing.
const ANY_PROJECT = new Set(['project', 'projects', 'desktop', 'documents', 'downloads', 'users', 'home', 'code', 'work', 'worktrees', 'repo', 'repos', 'src', 'app', 'apps', 'site', 'web', 'main', 'test', 'tests', 'desk', 'desks', 'private', 'folders', 'var', 'tmp', 'temp']);
const THROWAWAY = /^\/(private\/)?(tmp|var\/folders)\//;
export function foldersOf(cwd, home = homedir()) {
  if (THROWAWAY.test(`${cwd}/`) && !cwd.startsWith(`${home}/`)) return []; // a throwaway folder is nobody's project
  const path = cwd.startsWith(`${home}/`) ? cwd.slice(home.length) : cwd;
  return [...new Set(path.toLowerCase().split('/').filter((p) => p.length >= 4 && !ANY_PROJECT.has(p)))];
}

// The notes that fit a request, best first: { notes: [{ id, name, type,
// description, part, close }], how, ms, of }. how is 'meaning', 'words' or
// 'none' (no folder, or nothing in it).
//   kind   how the request was sorted. For work on the code here (fix,
//          change, rename) a note about ANOTHER project of the user's does
//          not come along: notes about Bonsai's own practice tasks fitted
//          "the tests fail, fix them" in every project (28 Sep 2026). Notes
//          on how the user likes things done and on how something is done
//          on this Mac hold everywhere.
export async function recallClaude(cwd, text, { embedder = null, dir = notesDir(), top = TOP, signal, store, kind = null } = {}) {
  const t0 = Date.now();
  const folders = foldersOf(cwd);
  const isHere = (n) => { const t = `${n.id} ${n.title ?? ''} ${n.description}`.toLowerCase(); return folders.some((f) => t.includes(f)); };
  const onTheCode = ['fix', 'change', 'rename'].includes(kind);
  const notes = readNotes(dir).filter((n) => !leftOut(n) && n.description && !(onTheCode && n.type === 'project' && !isHere(n)));
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
    const cut = 2 * Math.log(1 + notes.length / 3);
    fits = (s) => s.score >= cut;
    margin = Infinity;
  }
  scored.sort((a, b) => b.score - a.score);
  const first = scored.find(fits);
  const picked = (process.env.BONSAI_NOTES_ALL ? scored : first ? scored.filter((s) => fits(s) && s.score >= first.score - margin) : []).slice(0, top);
  return {
    notes: picked.map((s) => ({ id: s.note.id, name: s.note.name, type: s.note.type, description: s.note.description, part: bestPart(s.note, text), close: Math.round(s.close * 1000) / 1000, words: Math.round(s.words * 10) / 10 })),
    how, ms: Date.now() - t0, of: notes.length, ...(note ? { note } : {}),
  };
}

const KIND = { feedback: 'how the user likes things done', user: 'about the user', project: 'about a project of theirs', reference: 'how something is done on this Mac' };
// What goes with the request.
export function claudeText(notes) {
  if (!notes.length) return '';
  const blocks = notes.map((n) => `[${n.name.replace(/-/g, ' ')}] (${KIND[n.type] ?? n.type})\n${n.part}`);
  // "Do not go looking": with a note in hand the model went to open the
  // files the note names, which are in other folders, behind the fence, and
  // ran out of time with no answer (3 of 6 questions, 28 Sep 2026).
  // "The request comes first": a note that says where finished files go
  // ("on the Desktop") once sent a file there that the request wanted "in
  // this folder" (practice task 18, 28 Sep 2026).
  return `From Claude's notes. Claude Code wrote these for itself in earlier conversations with this user. The request above comes first: where it names a place, a file name or a way of doing it, do what it says, whatever a note says. When the notes hold the answer to a question, answer from them now, in your own plain words, and say that it comes from Claude's notes. The files and folders a note names are mostly in other folders, which you cannot open from here: do not go looking for them. A note can name tools you do not have, and it can be out of date: where a file in THIS folder says otherwise, the file is right.\n${blocks.join('\n\n')}`;
}

// For the /memory panel and the results page: how many notes there are, how
// many are left out and why.
export function notesCount(dir = notesDir()) {
  const all = readNotes(dir);
  const out = all.map((n) => ({ id: n.id, why: leftOut(n) })).filter((x) => x.why);
  return { dir, all: all.length, used: all.length - out.length, leftOut: out };
}
