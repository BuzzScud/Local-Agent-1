// Folder trust, like Claude Code's first-visit safety check. Before Agentic Coder
// reads a folder's notes into the model or runs anything there, the user
// says once that they trust it. A yes covers the folder and everything
// inside it, and is kept in ~/.agentic-coder/trust.json. Saying yes to
// "Work in <project>?" mid-session counts too (src/app/App.jsx).
import { readFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join, resolve, sep, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { writeWhole, withLock, keepBroken } from './store.mjs';

// Read when used, not at import, so tests can point it at their own home.
const home = () => process.env.AGENTIC_HOME ?? join(homedir(), '.agentic-coder');
const file = () => join(home(), 'trust.json');

// The path with links resolved ("/var/…" on this Mac really is
// "/private/var/…"), so the same folder never counts as two. A part that
// does not exist yet keeps its name under its nearest real parent.
function real(p) {
  p = resolve(p);
  try { return realpathSync(p); } catch {}
  const parent = dirname(p);
  return parent === p ? p : join(real(parent), basename(p));
}

// { data, broken } (as perm-store.mjs readState): the folders, or {} and why the file could not be read. Unreadable,
// nothing counts as trusted (the safety check asks), and it is never written over (saveTrust): the audit of 18 Nov 2026
// found the next yes wrote {} plus that one folder over every folder you had trusted.
function read() {
  let raw;
  try { raw = readFileSync(file(), 'utf8'); } catch (e) { return { data: {}, broken: e.code === 'ENOENT' ? null : e.message }; }
  if (!raw.trim()) return { data: {}, broken: null };
  try {
    const t = JSON.parse(raw);
    return t && typeof t === 'object' && !Array.isArray(t) ? { data: t, broken: null } : { data: {}, broken: 'it is not a JSON object' };
  } catch (e) { return { data: {}, broken: e.message }; }
}
const load = () => read().data;
// Read, change, write whole (a file beside it renamed over it), under the short lock settings.json uses, so two windows
// saying yes at once keep both. fn changes the folders and answers what to return; an unreadable file is copied aside
// once and left as it is: the answer is then false.
function change(fn) {
  mkdirSync(home(), { recursive: true });
  return withLock(file(), () => {
    const st = read();
    if (st.broken) { keepBroken(file(), 'trust'); return false; }
    const t = st.data;
    const r = fn(t);
    if (r) writeWhole(file(), `${JSON.stringify(t, null, 2)}\n`);
    return r;
  });
}

// The trusted folder that covers cwd (itself or a parent), or null.
export function trustedRoot(cwd) {
  const at = real(cwd);
  for (const k of Object.keys(load())) {
    const root = real(k);
    if (at === root || at.startsWith(`${root}${sep}`)) return root;
  }
  return null;
}

export const isTrusted = (cwd) => !!trustedRoot(cwd);

// true when it was kept; false when trust.json cannot be read (then this yes holds for this start only).
export function saveTrust(cwd) {
  return change((t) => { t[real(cwd)] = new Date().toISOString(); return true; });
}

// The folders you said yes to, by path: [{ path, at }] (/permissions lists them).
export const trustedFolders = () => Object.entries(load()).map(([path, at]) => ({ path, at })).sort((a, b) => a.path.localeCompare(b.path));

// Take a folder back out (/permissions forget): the safety check asks again the
// next time Agentic Coder starts there. True when the folder was in the list.
export function forgetTrust(path) {
  return change((t) => {
    const key = Object.keys(t).find((k) => k === path || real(k) === real(path));
    if (key === undefined) return false;
    delete t[key];
    return true;
  });
}

// The same folder however it was spelled (links resolved), for rules kept by folder.
export const realFolder = real;
