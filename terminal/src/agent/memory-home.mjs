// Where the memory about you lives, found again when it moved; what a save could not write, kept until it can; and
// the memory in one line (18 Oct 2026).
//
// On the owner's Mac ~/.agentic/memory is a link into the project's private folder (docs/private/memory-about-you).
// When the project moved into Desktop/PROJECTS (about 10 Oct 2026) the link went on pointing at the old place: every
// save about the user failed from then on, a save that failed there took the project's facts of the same round down
// with it, and the save after each round said nothing. The owner, "i dont see any memorys", picked: keep it in the
// project's folder; at a start find it, fix the link and say so; a line after each save; the memory in one line at
// the start and in /memory and the hub.
//   youState     ok (a folder, or a link to one) · none (not made yet: the first save makes it) · broken
//   repairYou    a broken link pointed at the folder where it is now, never a real folder touched
//   holdSave     what could not be written, kept in <home>/memory-jobs/held-*.json
//   saveHeld     written at a start once its folder can be reached (two weeks at most)
//   memoryStatus how many facts about you and this project, the last save, the folder's state
import { existsSync, lstatSync, readlinkSync, statSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, unlinkSync, symlinkSync, realpathSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { HOME } from '../../../models/index.mjs';
import { youDir, memoryDirs, readFacts, readLog } from './facts.mjs';

const isDir = (d) => { try { return statSync(d).isDirectory(); } catch { return false; } };
const tilde = (p) => (p && p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);
const JOBS = () => join(process.env.AGENTIC_HOME ?? HOME, 'memory-jobs');
const HELD_DAYS = 14;

export function youState(home = homedir()) {
  const dir = youDir(home);
  let st;
  try { st = lstatSync(dir); } catch { return { state: 'none', dir }; }
  if (!st.isSymbolicLink()) return { state: 'ok', dir };
  const target = resolve(dirname(dir), readlinkSync(dir));
  return isDir(target) ? { state: 'ok', dir, target } : { state: 'broken', dir, target };
}

// A folder that holds a memory: its facts, or its log.
const isMemory = (d) => isDir(join(d, 'facts')) || existsSync(join(d, 'log.jsonl'));
const newest = (d) => { try { return statSync(join(d, 'log.jsonl')).mtimeMs; } catch { return 0; } };
// Folders under home worth a look: not hidden, not the Mac's own, not packages' or builds'.
const SKIP = new Set(['Library', 'Applications', 'Pictures', 'Music', 'Movies', 'Public', 'node_modules']);
function foldersIn(dir) {
  try { return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)).map((e) => e.name); } catch { return []; }
}

// Where a moved memory folder is now: the first of the places given that holds a memory (the app's own private
// folder), else the newest of the same folder under a project of the same name one or two folders down from home
// (~/Desktop/PROJECTS/agentic-coder/…), or null.
export function memoryFolderNow(target, { home = homedir(), places = [] } = {}) {
  const given = places.filter(Boolean).find(isMemory);
  if (given) return given;
  const tries = [];
  const parts = String(target).split(sep);
  const at = parts.lastIndexOf('docs');
  if (at > 0) {
    const project = parts[at - 1];
    const tail = parts.slice(at).join(sep);
    for (const a of foldersIn(home)) {
      tries.push(join(home, a, project, tail));
      for (const b of foldersIn(join(home, a)).slice(0, 400)) tries.push(join(home, a, b, project, tail));
    }
  }
  const seen = new Set();
  const found = tries.filter((d) => {
    if (!isMemory(d)) return false;
    let real = d;
    try { real = realpathSync(d); } catch {}
    if (seen.has(real)) return false;
    seen.add(real);
    return true;
  });
  return found.sort((x, y) => newest(y) - newest(x))[0] ?? null;
}

// → { state: 'ok' | 'none' | 'fixed' | 'missing', dir, from?, to?, target? }
export function repairYou({ home = homedir(), places = [] } = {}) {
  const s = youState(home);
  if (s.state !== 'broken') return s;
  const to = memoryFolderNow(s.target, { home, places });
  if (!to) return { state: 'missing', dir: s.dir, target: s.target };
  try { unlinkSync(s.dir); symlinkSync(to, s.dir); } catch (e) { return { state: 'missing', dir: s.dir, target: s.target, why: e.message }; }
  return { state: 'fixed', dir: s.dir, from: s.target, to };
}

// What a repair says, once, at the start (null when there is nothing to say).
export function repairWords(r) {
  if (r?.state === 'fixed') return { text: `Memory: the folder about you had moved · found it at ${tilde(r.to)} and pointed ${tilde(r.dir)} there`, tone: 'dim' };
  if (r?.state === 'missing') return { text: `Memory: the folder about you is missing · ${tilde(r.dir)} points at ${tilde(r.target)}, which is gone · facts about you are kept and saved once it is back`, tone: 'warn' };
  return null;
}

// Why a folder could not be written, in words.
export function whyNotSaved(e, dir, home = homedir()) {
  const s = youState(home);
  if (dir === s.dir && s.state === 'broken') return `the memory folder is missing (${tilde(s.dir)} points at ${tilde(s.target)}, which is gone)`;
  if (e?.code === 'EACCES' || e?.code === 'EPERM') return `the memory folder ${tilde(dir)} cannot be written`;
  return String(e?.message ?? e).replace(homedir(), '~');
}

// ---- what could not be written, kept -------------------------------------------------------------------------------

export function holdSave({ cwd, home, about, adds = [], drops = [], why = '' }) {
  if (!adds.length && !drops.length) return null;
  try {
    mkdirSync(JOBS(), { recursive: true });
    const file = join(JOBS(), `held-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`);
    writeFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), cwd, home: home ?? null, about, why, adds, drops })}\n`);
    return file;
  } catch { return null; }
}

export function heldSaves() {
  const out = [];
  try {
    for (const f of readdirSync(JOBS()).filter((x) => x.startsWith('held-') && x.endsWith('.json')).sort()) {
      const file = join(JOBS(), f);
      let p;
      try { p = JSON.parse(readFileSync(file, 'utf8')); } catch { rmSync(file, { force: true }); continue; }
      if (Date.now() - Date.parse(p.at) > HELD_DAYS * 86_400_000) { rmSync(file, { force: true }); continue; }
      out.push({ ...p, adds: p.adds ?? [], drops: p.drops ?? [], file });
    }
  } catch { /* none kept */ }
  return out;
}

// At a start: each kept save whose folder can be reached now is written (save = lessons.mjs applySave, passed in so
// this file does not import it). → how many facts were saved, and how many saves still wait.
export function saveHeld(save) {
  let saved = 0;
  let left = 0;
  for (const p of heldSaves()) {
    const home = p.home ?? undefined;
    if (p.about === 'you' && youState(home).state === 'broken') { left++; continue; }
    try {
      const out = save({ cwd: p.cwd, home, adds: p.adds, drops: p.drops }, { why: 'kept while the folder was missing', hold: false });
      if (out.failed?.length) { left++; continue; }
      saved += out.added.length + out.replaced.length;
      rmSync(p.file, { force: true });
    } catch { left++; }
  }
  return { saved, left };
}

// ---- the memory in one line ----------------------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SAVES = new Set(['add', 'replace']);
// { you, project (null in the home folder), last (the newest fact saved, ISO), state, dir, target }
export function memoryStatus(cwd, home = homedir()) {
  const dirs = memoryDirs(cwd, home);
  const s = youState(home);
  const last = [dirs.you, dirs.project].filter(Boolean).flatMap((d) => readLog(d)).filter((l) => SAVES.has(l.what)).map((l) => String(l.at)).sort().at(-1) ?? null;
  return { you: readFacts(dirs.you).length, project: dirs.project ? readFacts(dirs.project).length : null, last, state: s.state, dir: s.dir, target: s.target ?? null };
}
// "Memory · 13 about you · 22 this project · last saved 18 Oct", and what is wrong with the folder.
export function statusWords(st) {
  const d = st.last ? new Date(st.last) : null;
  const when = d && !Number.isNaN(d.getTime()) ? `last saved ${d.getDate()} ${MONTHS[d.getMonth()]}` : 'nothing saved yet';
  const parts = [st.state === 'broken' ? 'the folder about you is missing' : `${st.you} about you`];
  if (st.project !== null) parts.push(`${st.project} this project`);
  parts.push(when);
  return `Memory · ${parts.join(' · ')}`;
}
