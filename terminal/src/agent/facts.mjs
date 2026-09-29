// Agentic Coder's memory, as facts: one small file per fact, a short index that is
// read at every start, a folder for retired facts and a log of every change.
//   <project>/.agentic/memory/  what holds for this project (beside an older .bonsai/notes.md: .bonsai/memory/)
//   ~/.agentic/memory/          what holds for you, in every project
//     index.md      one line per fact (rebuilt after every change)
//     facts/*.md    the facts
//     retired/*.md  facts taken out of use, with the reason; nothing is deleted
//     log.jsonl     one line per change, so the last save can be undone
// A fact is plain text you can edit: a few "name: value" lines, an empty
// line, then the fact.
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, appendFileSync, statSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { memoryFile } from './memory.mjs';

// you: how the user likes to work · project: where things are, commands that
// work · worked / failed: what a check proved · mistake: what Agentic Coder did
// wrong and what to do instead · recipe: the steps of a job done before.
export const KINDS = ['you', 'project', 'worked', 'failed', 'mistake', 'recipe'];
const ABOUT_YOU = new Set(['you']);
export const RETIRE_AT = -3; // trust this low takes a fact out of use
export const UNUSED_DAYS = 30; // never recalled for this long: retired
const INDEX_LINES = 40;
const LINE_CHARS = 90;

// The two rules the user gave on 26 Sep 2026: they hold everywhere, from the
// first start, and are read in full at every start (always).
export const FIRST_FACTS = [
  { kind: 'you', always: true, from: 'what you asked for on 26 Sep 2026', text: 'When you are stuck, ask the user what to do instead of guessing or stopping.' },
  { kind: 'you', always: true, from: 'what you asked for on 26 Sep 2026', text: 'Before you change anything, say in one plain, simple sentence what you are going to do.' },
];

// Where the memory lives for a folder. In the home folder there is no
// project, only what holds for you.
// AGENTIC_MEMORY names another folder for what holds for you; with
// AGENTIC_HOME set (a test's own home for Agentic Coder's files) it is kept in
// there, so a test never reads or writes the real one.
export function memoryDirs(cwd, home = homedir()) {
  const other = (process.env.AGENTIC_MEMORY ?? process.env.BONSAI_MEMORY) || ((process.env.AGENTIC_HOME ?? process.env.BONSAI_HOME) ? join((process.env.AGENTIC_HOME ?? process.env.BONSAI_HOME), 'memory-about-you') : null);
  const you = (home === homedir() && other) || join(home, '.agentic', 'memory');
  const notes = memoryFile(cwd, home);
  const project = resolve(dirname(dirname(notes))) === resolve(home) ? null : join(dirname(notes), 'memory');
  return { you, project };
}
export const dirFor = (dirs, kind) => (ABOUT_YOU.has(kind) || !dirs.project ? dirs.you : dirs.project);

const day = (d = new Date()) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// A key, a token or a password is never saved.
const SECRETS = [
  /\b(api[_-]?key|secret|passw(or)?d|passphrase|token|bearer)\b\s*(is|[:=])\s*\S{6,}/i,
  /\b(ghp_|gho_|github_pat_|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{12,}|xox[abprs]-|AIza[0-9A-Za-z_-]{20,})/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b[A-Fa-f0-9]{40,}\b/,
  /\b[A-Za-z0-9+/]{48,}={0,2}(?![A-Za-z0-9+/])/,
];
export const looksSecret = (text) => SECRETS.some((re) => re.test(String(text)));

// A note that only says what happened ("Created notes.html on the Desktop…")
// rather than how to work. Sent along, it told the model a page it was asked
// for already existed (28 Sep: it came with a profile card and a weather
// widget request), so it never goes into a prompt: not with a request
// (recall.mjs), not in the memory's short lines (memoryNotes), and the screen says so.
const DID = /^(?:created|made|wrote|added|fixed|built|ran|updated|deleted|removed|moved|saved|changed|renamed|installed|opened|started|finished|generated|implemented)\b/i;
const HOW = /\b(?:always|never|should|must|use|prefer|avoid|when|before|after|instead|do not|don'?t|make sure|ask)\b/i;
export const looksLikeEvent = (text) => DID.test(String(text).trim()) && !HOW.test(text);

export function parseFact(raw, id) {
  const [head, ...rest] = String(raw).replace(/\r/g, '').split(/\n\s*\n/);
  const f = { id, kind: 'project', text: '', saved: null, from: '', used: 0, last: null, trust: 0, passed: 0, failed: 0, always: false, pinned: false, steps: [] };
  let body = rest.join('\n\n');
  const lines = head.split('\n');
  // A file with no "name: value" lines at the top is all fact.
  if (!lines.every((l) => /^[a-z]+:\s/.test(l) || !l.trim())) { body = String(raw); lines.length = 0; }
  for (const l of lines) {
    const m = /^([a-z]+):\s*(.*)$/.exec(l);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'kind' && KINDS.includes(v.trim())) f.kind = v.trim();
    else if (k === 'saved') f.saved = v.trim().slice(0, 10);
    else if (k === 'from') f.from = v.trim();
    else if (k === 'used') { f.used = Number(/\d+/.exec(v)?.[0] ?? 0); f.last = /last (\d{4}-\d{2}-\d{2})/.exec(v)?.[1] ?? null; }
    else if (k === 'trust') { f.trust = Number(/-?\d+/.exec(v)?.[0] ?? 0); f.passed = Number(/(\d+) passed/.exec(v)?.[1] ?? 0); f.failed = Number(/(\d+) failed/.exec(v)?.[1] ?? 0); }
    else if (k === 'always') f.always = /^y/i.test(v.trim());
    else if (k === 'pinned') f.pinned = /^y/i.test(v.trim());
    else if (k === 'retired') f.retired = v.trim();
  }
  const text = body.trim();
  const steps = text.split('\n').filter((l) => /^\s*\d+[.)]\s+\S/.test(l));
  if (f.kind === 'recipe' && steps.length) { f.steps = steps.map((l) => l.replace(/^\s*\d+[.)]\s+/, '').trim()); f.text = text.split('\n').filter((l) => !/^\s*\d+[.)]\s+\S/.test(l)).join('\n').trim(); }
  else f.text = text;
  return f;
}

export function formatFact(f) {
  const head = [
    `kind: ${f.kind}`,
    `saved: ${f.saved ?? day()}`,
    ...(f.from ? [`from: ${oneLine(f.from).slice(0, 120)}`] : []),
    `used: ${f.used ?? 0} time${f.used === 1 ? '' : 's'}${f.last ? `, last ${f.last}` : ''}`,
    `trust: ${f.trust ?? 0} (${f.passed ?? 0} passed, ${f.failed ?? 0} failed)`,
    ...(f.always ? ['always: yes'] : []),
    ...(f.pinned ? ['pinned: yes'] : []),
    ...(f.retired ? [`retired: ${oneLine(f.retired).slice(0, 160)}`] : []),
  ];
  const steps = f.steps?.length ? `\n${f.steps.map((s, i) => `${i + 1}. ${oneLine(s)}`).join('\n')}` : '';
  return `${head.join('\n')}\n\n${f.text.trim()}${steps}\n`;
}

// One change at a time in a memory folder. Two Agentic Coder windows in one project,
// or a window and the save handed over when another one quit, can reach the
// same folder in the same moment; each reads the facts, then writes. Without
// this, a fact of one was written over by the other's (both picked the same
// file name), and of two results for one fact only one was counted (measured
// 28 Sep 2026, test/facts-at-once.test.mjs). The lock is a folder, .lock,
// made in one step by whoever gets it; it holds the pid of its owner, so a
// lock left by a window that was killed is taken over at once. A change never
// waits longer than LOCK_WAIT: past it, it goes ahead as before.
const LOCK_WAIT = 5000;
const LOCK_OLD = 10_000;
const held = new Set();
const nap = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { const t = Date.now() + ms; while (Date.now() < t); } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export function locked(dir, change) {
  if (!dir || held.has(dir)) return change();
  const lock = join(dir, '.lock');
  let mine = false;
  try {
    mkdirSync(dir, { recursive: true });
    for (const until = Date.now() + LOCK_WAIT; ;) {
      try { mkdirSync(lock); mine = true; break; } catch (e) {
        if (e.code !== 'EEXIST') break; // a folder we cannot write to: the change itself will say so
      }
      let owner = null; let age = 0;
      try { age = Date.now() - statSync(lock).mtimeMs; owner = Number(readFileSync(join(lock, 'pid'), 'utf8')); } catch { /* made this instant, or gone again */ }
      if ((owner && !alive(owner)) || (!owner && age > LOCK_OLD)) { try { rmSync(lock, { recursive: true, force: true }); } catch {} continue; }
      if (Date.now() > until) break;
      nap(8 + Math.floor(Math.random() * 12));
    }
    if (mine) { try { writeFileSync(join(lock, 'pid'), String(process.pid)); } catch {} }
  } catch { /* no lock: the change is made all the same */ }
  held.add(dir);
  try { return change(); } finally {
    held.delete(dir);
    if (mine) { try { rmSync(lock, { recursive: true, force: true }); } catch {} }
  }
}

const folder = (dir, retired) => join(dir, retired ? 'retired' : 'facts');
export function readFacts(dir, { retired = false } = {}) {
  const at = dir && folder(dir, retired);
  if (!at || !existsSync(at)) return [];
  const out = [];
  for (const name of readdirSync(at).sort()) {
    if (!name.endsWith('.md')) continue;
    try { const f = parseFact(readFileSync(join(at, name), 'utf8'), name.slice(0, -3)); if (f.text) out.push({ ...f, dir }); } catch { /* an unreadable file is skipped, not fatal */ }
  }
  return out;
}

function newId(dir, text) {
  const base = norm(text).split(' ').filter((w) => w.length > 1).slice(0, 6).join('-').slice(0, 48) || 'fact';
  let id = base;
  for (let n = 2; existsSync(join(folder(dir, false), `${id}.md`)) || existsSync(join(folder(dir, true), `${id}.md`)); n++) id = `${base}-${n}`;
  return id;
}

function write(dir, f, retired = false) {
  mkdirSync(folder(dir, retired), { recursive: true });
  const { dir: _d, id, ...rest } = f;
  writeFileSync(join(folder(dir, retired), `${id}.md`), formatFact(rest));
  keepOutOfGit(dir);
}
// What undo never takes back: the rules saved at the first start.
const KEPT = new Set(['first use']);
const CHANGES = ['add', 'replace', 'retire', 'restore', 'edit'];
const canUndo = (l, undone) => CHANGES.includes(l.what) && !undone.has(l.batch) && !KEPT.has(l.why);
const logLine = (dir, row) => { mkdirSync(dir, { recursive: true }); appendFileSync(join(dir, 'log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`); };
export function readLog(dir) {
  try { return readFileSync(join(dir, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}

// Inside a git repo the memory stays private: .bonsai/ in .git/info/exclude
// (this checkout only; no tracked file changes).
function keepOutOfGit(dir) {
  const root = dirname(dirname(dir));
  const git = join(root, '.git');
  try {
    if (!existsSync(git) || !statSync(git).isDirectory()) return;
    const ex = join(git, 'info', 'exclude');
    const cur = existsSync(ex) ? readFileSync(ex, 'utf8') : '';
    if (/^\/?\.agentic\/?\s*$/m.test(cur)) return;
    mkdirSync(dirname(ex), { recursive: true });
    appendFileSync(ex, `${cur && !cur.endsWith('\n') ? '\n' : ''}# Agentic Coder's private memory\n.bonsai/\n.agentic/\n`);
  } catch { /* a repo we cannot write to keeps its memory untracked by hand */ }
}

// Most useful first: what is always read, then by trust, then by use.
const byWorth = (a, b) => Number(b.always) - Number(a.always) || Number(b.pinned) - Number(a.pinned) || b.trust - a.trust || b.used - a.used || String(b.saved).localeCompare(String(a.saved));
const short = (f) => { const t = `${f.kind === 'failed' && !/^failed\b/i.test(f.text) ? 'failed: ' : ''}${oneLine(f.text)}`; return t.length > LINE_CHARS ? `${t.slice(0, LINE_CHARS - 1).trimEnd()}…` : t; };

function rebuildIndexNow(dir) {
  const facts = readFacts(dir).sort(byWorth);
  if (!existsSync(dir) && !facts.length) return '';
  const shown = facts.slice(0, INDEX_LINES);
  const text = `# Agentic Coder memory\nOne line per fact; the facts are in facts/. Kept by Agentic Coder, edit freely.\n\n${shown.map((f) => `- ${short(f)}`).join('\n')}${facts.length > shown.length ? `\n- (and ${facts.length - shown.length} more, brought back when a request fits them)` : ''}\n`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), text);
  return text;
}

// The changes of one save, applied together (one batch in the log):
//   add      [{ kind, text, from, always, pinned, steps }]
//   replace  [{ id, by: { kind, text, … }, reason }]   a newer fact takes an older one's place
//   retire   [{ id, reason }]
// Answers what happened, with what was refused and why.
function applyChangesNow(dir, { add = [], replace = [], retire = [] } = {}, { batch = `save-${Date.now()}`, today = day(), why = 'save' } = {}) {
  const out = { dir, batch, added: [], replaced: [], retired: [], refused: [] };
  const have = () => new Map(readFacts(dir).map((f) => [norm(f.text), f]));
  const make = (a) => {
    const text = String(a?.text ?? '').replace(/[ \t]+/g, ' ').replace(/^[-*•]\s*/, '').trim().slice(0, 400);
    const steps = (a?.steps ?? []).map(oneLine).filter(Boolean).slice(0, 12);
    if (text.length < 8) return { no: 'too short to mean anything' };
    if (looksSecret(text) || steps.some(looksSecret)) return { no: 'looks like a key or a password' };
    const kind = KINDS.includes(a.kind) ? a.kind : 'project';
    return { fact: { id: newId(dir, text), kind, text, saved: today, from: oneLine(a.from), used: 0, last: null, trust: 0, passed: 0, failed: 0, always: Boolean(a.always), pinned: Boolean(a.pinned), steps: kind === 'recipe' ? steps : [] } };
  };
  for (const r of retire) {
    const f = readFacts(dir).find((x) => x.id === r.id);
    if (!f) { out.refused.push({ text: r.id, why: 'no such fact' }); continue; }
    retireFact(dir, f, r.reason ?? 'taken out of use', batch);
    out.retired.push(f);
  }
  for (const r of replace) {
    const old = readFacts(dir).find((x) => x.id === r.id);
    const m = make(r.by);
    if (!old || m.no) { out.refused.push({ text: r.by?.text ?? r.id, why: m.no ?? 'no such fact to replace' }); continue; }
    // What the older fact had earned stays with the one that takes its place.
    const next = { ...m.fact, used: old.used, last: old.last, pinned: old.pinned || m.fact.pinned, always: old.always || m.fact.always };
    retireFact(dir, old, r.reason ?? `replaced by: ${short(next)}`, batch, { quiet: true });
    write(dir, next);
    logLine(dir, { batch, why, what: 'replace', id: next.id, old: old.id });
    out.replaced.push({ old, fact: next });
  }
  for (const a of add) {
    const m = make(a);
    if (m.no) { out.refused.push({ text: oneLine(a?.text).slice(0, 80), why: m.no }); continue; }
    const same = have().get(norm(m.fact.text));
    if (same) { out.refused.push({ text: short(m.fact), why: 'saved already' }); continue; }
    write(dir, m.fact);
    logLine(dir, { batch, why, what: 'add', id: m.fact.id });
    out.added.push(m.fact);
  }
  if (out.added.length || out.replaced.length || out.retired.length) rebuildIndex(dir);
  return out;
}

function retireFact(dir, f, reason, batch, { quiet = false } = {}) {
  // Moved, not deleted: the file goes to retired/ and gets the reason.
  mkdirSync(folder(dir, true), { recursive: true });
  renameSync(join(folder(dir, false), `${f.id}.md`), join(folder(dir, true), `${f.id}.md`));
  write(dir, { ...f, retired: `${day()} · ${reason}` }, true);
  if (!quiet) logLine(dir, { batch, what: 'retire', id: f.id, reason });
}

function restoreFactNow(dir, id, batch = `restore-${Date.now()}`) {
  const f = readFacts(dir, { retired: true }).find((x) => x.id === id);
  if (!f) return null;
  const { retired: _r, ...back } = f;
  // Back in use with a clean slate: what retired it is not held against it.
  mkdirSync(folder(dir, false), { recursive: true });
  renameSync(join(folder(dir, true), `${id}.md`), join(folder(dir, false), `${id}.md`));
  write(dir, { ...back, trust: Math.max(0, back.trust) });
  logLine(dir, { batch, what: 'restore', id });
  rebuildIndex(dir);
  return back;
}

// Takes back the last save (every change of its batch), newest change first.
// Answers what was undone, or null when there is nothing to take back.
// only: undo this batch (a save that wrote into both memories).
function undoLastNow(dir, only = null) {
  const log = readLog(dir);
  const undone = new Set(log.filter((l) => l.what === 'undo').map((l) => l.of));
  const last = [...log].reverse().find((l) => canUndo(l, undone) && (!only || l.batch === only));
  if (!last) return null;
  const rows = log.filter((l) => l.batch === last.batch && CHANGES.includes(l.what)).reverse();
  const batch = `undo-${Date.now()}`;
  const did = [];
  const putBack = (id) => {
    const f = readFacts(dir, { retired: true }).find((x) => x.id === id);
    if (!f) return null;
    const { retired: _r, ...back } = f;
    mkdirSync(folder(dir, false), { recursive: true });
    renameSync(join(folder(dir, true), `${id}.md`), join(folder(dir, false), `${id}.md`));
    write(dir, back);
    return back;
  };
  const takeOut = (id, reason) => {
    const f = readFacts(dir).find((x) => x.id === id);
    if (f) retireFact(dir, f, reason, batch, { quiet: true });
    return f;
  };
  for (const r of rows) {
    if (r.what === 'add') { const f = takeOut(r.id, 'the save that added it was undone'); if (f) did.push({ what: 'removed', fact: f }); }
    if (r.what === 'retire') { const f = putBack(r.id); if (f) did.push({ what: 'brought back', fact: f }); }
    if (r.what === 'restore') { const f = takeOut(r.id, 'bringing it back was undone'); if (f) did.push({ what: 'removed', fact: f }); }
    if (r.what === 'edit') { const f = readFacts(dir).find((x) => x.id === r.id); if (f) { write(dir, { ...f, text: r.before }); did.push({ what: 'put back as it was', fact: { ...f, text: r.before } }); } }
    if (r.what === 'replace') {
      const f = takeOut(r.id, 'the save that added it was undone');
      const old = putBack(r.old);
      if (f) did.push({ what: 'removed', fact: f });
      if (old) did.push({ what: 'brought back', fact: old });
    }
  }
  logLine(dir, { batch, what: 'undo', of: last.batch });
  rebuildIndex(dir);
  return { of: last.batch, did };
}

// The last save, taken back in both memories (one save can write to both).
export function undoSave(dirs) {
  const list = [dirs.you, dirs.project].filter(Boolean);
  let newest = null;
  for (const dir of list) {
    const log = readLog(dir);
    const undone = new Set(log.filter((l) => l.what === 'undo').map((l) => l.of));
    const l = [...log].reverse().find((x) => canUndo(x, undone));
    if (l && (!newest || l.at > newest.at)) newest = l;
  }
  if (!newest) return null;
  const did = [];
  for (const dir of list) { const u = undoLast(dir, newest.batch); if (u) did.push(...u.did); }
  return { of: newest.batch, at: newest.at, did };
}

// A fact was brought back for a request.
function markUsedNow(dir, ids, today = day()) {
  for (const f of readFacts(dir)) if (ids.includes(f.id)) write(dir, { ...f, used: f.used + 1, last: today });
}

// What happened after a fact was used changes its trust: +1 when the task
// passed its check, -1 when it failed or Agentic Coder got stuck, -2 when the user
// corrected Agentic Coder or stopped it. A fact the user pinned, or one that is
// always read, never goes out of use this way.
function changeTrustNow(dir, ids, delta, reason, { batch = `trust-${Date.now()}` } = {}) {
  const out = { changed: [], retired: [] };
  if (!delta) return out;
  for (const f of readFacts(dir)) {
    if (!ids.includes(f.id)) continue;
    const next = { ...f, trust: f.trust + delta, passed: f.passed + (delta > 0 ? 1 : 0), failed: f.failed + (delta < 0 ? 1 : 0) };
    write(dir, next);
    logLine(dir, { batch, what: 'trust', id: f.id, delta, reason });
    out.changed.push(next);
    if (next.trust <= RETIRE_AT && !next.pinned && !next.always) { retireFact(dir, next, `trust fell to ${next.trust}: ${reason}`, batch); out.retired.push(next); }
  }
  if (out.changed.length) rebuildIndex(dir);
  return out;
}

// You changed a fact's words by hand (the hub's Memory tab).
function editFactNow(dir, id, text) {
  const f = readFacts(dir).find((x) => x.id === id);
  const next = String(text ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, 400);
  if (!f) return { error: 'no such fact' };
  if (next.length < 8) return { error: 'too short to mean anything' };
  if (looksSecret(next)) return { error: 'looks like a key or a password' };
  if (next === f.text) return { fact: f };
  write(dir, { ...f, text: next });
  logLine(dir, { batch: `edit-${Date.now()}`, what: 'edit', id, before: f.text });
  rebuildIndex(dir);
  return { fact: { ...f, text: next } };
}

// /rules always N: a fact read at every start, or back to only when a request fits it.
function setAlwaysNow(dir, id, always = true) {
  const f = readFacts(dir).find((x) => x.id === id);
  if (!f) return null;
  write(dir, { ...f, always });
  logLine(dir, { batch: `always-${Date.now()}`, what: always ? 'always' : 'sometimes', id });
  rebuildIndex(dir);
  return { ...f, always };
}

function pinFactNow(dir, id, pinned = true) {
  const f = readFacts(dir).find((x) => x.id === id);
  if (!f) return null;
  write(dir, { ...f, pinned });
  logLine(dir, { batch: `pin-${Date.now()}`, what: pinned ? 'pin' : 'unpin', id });
  rebuildIndex(dir);
  return { ...f, pinned };
}

// Files a fact names ("legend.js", "terminal/rules/bug-fixing.md"): when the
// fact is about a file that is gone, it is not brought back.
export function filesIn(text) {
  return [...String(text).matchAll(/(?:^|[\s`'"(])((?:[\w@.-]+\/)+[\w@.-]+\.[A-Za-z]\w{0,5}|[\w@-]+\.(?:mjs|cjs|jsx?|tsx?|py|rb|go|rs|md|json|html|css|sh|toml|ya?ml))(?=$|[\s`'",:;!?)]|\.(?:\s|$))/g)].map((m) => m[1]);
}
export function namesMissingFile(fact, root) {
  if (!root || ABOUT_YOU.has(fact.kind)) return false;
  const files = filesIn(fact.text).filter((p) => !p.includes('<') && !p.startsWith('~'));
  if (!files.length) return false;
  const found = (p) => existsSync(join(root, p)) || (!p.includes('/') && existsSync(root) && findByName(root, p));
  return !files.some(found);
}
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', 'results']);
function findByName(root, name, depth = 0, seen = { n: 0 }) {
  if (depth > 5 || seen.n > 4000) return false;
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    seen.n++;
    if (e.name === name) return true;
    if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.') && findByName(join(root, e.name), name, depth + 1, seen)) return true;
  }
  return false;
}

// Keeps the memory clean: repeats merge, a fact about a file that is gone
// and one never brought back in UNUSED_DAYS days go out of use. Every change
// is in the log, so it can be undone.
function tidyNow(dir, { today = day(), root = null } = {}) {
  const batch = `tidy-${Date.now()}`;
  const out = { merged: [], retired: [] };
  const seen = new Map();
  for (const f of readFacts(dir).sort(byWorth)) {
    const key = norm(f.text);
    const first = seen.get(key);
    if (first) {
      // The better one stays and takes the other's count.
      write(dir, { ...first, used: first.used + f.used, passed: first.passed + f.passed, failed: first.failed + f.failed, trust: Math.max(first.trust, f.trust), last: [first.last, f.last].filter(Boolean).sort().pop() ?? null });
      retireFact(dir, f, `the same as: ${short(first)}`, batch);
      out.merged.push({ kept: first, gone: f });
      continue;
    }
    seen.set(key, f);
    if (f.always || f.pinned) continue;
    if (namesMissingFile(f, root)) { retireFact(dir, f, 'the file it names is gone', batch); out.retired.push({ fact: f, why: 'the file it names is gone' }); continue; }
    const since = f.last ?? f.saved;
    const days = since ? Math.floor((Date.parse(today) - Date.parse(since)) / 86_400_000) : 0;
    if (days >= UNUSED_DAYS) { retireFact(dir, f, `not used in ${days} days`, batch); out.retired.push({ fact: f, why: `not used in ${days} days` }); }
  }
  if (out.merged.length || out.retired.length) rebuildIndex(dir);
  return out;
}

// What other code calls: the same changes, one at a time per folder (locked).
export function rebuildIndex(...a) { return locked(a[0], () => rebuildIndexNow(...a)); }
export function applyChanges(...a) { return locked(a[0], () => applyChangesNow(...a)); }
export function restoreFact(...a) { return locked(a[0], () => restoreFactNow(...a)); }
export function undoLast(...a) { return locked(a[0], () => undoLastNow(...a)); }
export function markUsed(...a) { return locked(a[0], () => markUsedNow(...a)); }
export function changeTrust(...a) { return locked(a[0], () => changeTrustNow(...a)); }
export function editFact(...a) { return locked(a[0], () => editFactNow(...a)); }
export function pinFact(...a) { return locked(a[0], () => pinFactNow(...a)); }
export function setAlways(...a) { return locked(a[0], () => setAlwaysNow(...a)); }
export function tidy(...a) { return locked(a[0], () => tidyNow(...a)); }

const readState = (dir) => { try { return JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')); } catch { return {}; } };
const writeState = (dir, patch) => locked(dir, () => writeStateNow(dir, patch));
const writeStateNow = (dir, patch) => { mkdirSync(dir, { recursive: true }); const next = { ...readState(dir), ...patch }; writeFileSync(join(dir, 'state.json'), `${JSON.stringify(next, null, 1)}\n`); return next; };
export { readState, writeState };

// First use: the two rules go into your own memory, and the lines of an
// older notes file (.bonsai/notes.md, from "update memory") become facts.
// Each happens once; a fact you removed afterwards does not come back.
// rules: more lines that always hold, saved once as well (the app passes
// what was boiled down from Claude's notes, claude-rules.mjs).
export function openMemory(cwd, { home = homedir(), today = day(), rules = null } = {}) {
  const dirs = memoryDirs(cwd, home);
  const did = { first: [], notes: [], rules: [] };
  // Looked at and saved in one go, so two windows opened together save them once.
  locked(dirs.you, () => {
    if (!readState(dirs.you).first) {
      did.first = applyChanges(dirs.you, { add: FIRST_FACTS }, { batch: 'first-facts', today, why: 'first use' }).added;
      writeState(dirs.you, { first: today });
    }
    if (rules?.length && !readState(dirs.you).rules) {
      did.rules = applyChanges(dirs.you, { add: rules }, { batch: 'claude-rules', today, why: "from Claude's notes" }).added;
      writeState(dirs.you, { rules: today });
    }
  });
  for (const [dir, kind, notes] of [[dirs.project, 'project', dirs.project && join(dirname(dirs.project), 'notes.md')], [dirs.you, 'you', join(dirname(dirs.you), 'notes.md')]]) {
    if (!dir || !notes || !existsSync(notes) || readState(dir).notes) continue;
    locked(dir, () => {
      if (readState(dir).notes) return; // another window carried them over meanwhile
      const lines = readFileSync(notes, 'utf8').split('\n').filter((l) => /^\s*[-*•]\s+\S/.test(l)).map((l) => l.replace(/^\s*[-*•]\s+/, '').trim());
      const r = applyChanges(dir, { add: lines.map((text) => ({ kind, text, from: 'your notes file (update memory)' })) }, { batch: `notes-${Date.now()}`, today, why: 'carried over from notes.md' });
      writeState(dir, { notes: today });
      did.notes.push(...r.added);
    });
  }
  return { dirs, ...did };
}

// What is read at every start: the rules that always hold, in full, then one
// line per fact. The facts themselves come with the request they fit.
// maxChars: about 430 tokens, 7 seconds of reading at a cold start.
export function memoryNotes(cwd, { home = homedir(), maxChars = 1600 } = {}) {
  const dirs = memoryDirs(cwd, home);
  const you = readFacts(dirs.you).sort(byWorth);
  const here = readFacts(dirs.project).sort(byWorth);
  if (!you.length && !here.length) return { text: '', files: [], facts: 0 };
  const always = [...you, ...here].filter((f) => f.always);
  // An event ("Created notes.html…") is not something to know: it stays in the memory, out of the prompt.
  const rest = (list) => list.filter((f) => !f.always && !looksLikeEvent(f.text));
  const tilde = (p) => (p.startsWith(home) ? `~${p.slice(home.length)}` : p);
  let text = always.length ? `Always\n${always.map((f) => `- ${oneLine(f.text)}`).join('\n')}\n` : '';
  const blocks = [[`What you know about the user (${tilde(dirs.you)})`, rest(you)], [`What you know about this project (${dirs.project ? tilde(dirs.project) : ''})`, rest(here)]];
  for (const [title, list] of blocks) {
    if (!list.length) continue;
    const lines = [];
    for (const f of list) {
      const l = `- ${short(f)}`;
      if (text.length + title.length + lines.join('\n').length + l.length > maxChars) { lines.push(`- (and ${list.length - lines.length} more)`); break; }
      lines.push(l);
    }
    text += `${text ? '\n' : ''}${title}\n${lines.join('\n')}\n`;
  }
  if (rest(you).length + rest(here).length) text += '\nThese are short lines. The full fact comes with a request it fits.\n';
  return { text: text.trim(), files: [dirs.you, dirs.project].filter((d) => d && readFacts(d).length), facts: you.length + here.length };
}
