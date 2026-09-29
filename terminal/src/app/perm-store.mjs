// The rules you save with /permissions, kept in ~/.agentic-coder/permissions.json:
// in the app's own folder, not in the project, so a project you download can
// not arrive with "allow" rules of its own.
//   { "everywhere": { allow, never, protect, mode }, "folders": { "<real path>": { allow, never, protect, mode } } }
// allow: commands that run without asking · never: commands that never run ·
// protect: files that always ask before a change · mode: what Agentic Coder
// starts in. A folder's rules cover it and everything inside it, like its trust.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, sep } from 'node:path';
import { homedir } from 'node:os';
import { realFolder, isTrusted } from './trust.mjs';

export const KINDS = ['allow', 'never', 'protect'];
export const MAX_RULES = 40;
const MODES = ['ask', 'edits', 'plan'];

// Read when used, not at import (as trust.json is), so tests can point it at their own home.
const home = () => (process.env.AGENTIC_HOME ?? process.env.BONSAI_HOME) ?? join(homedir(), '.agentic-coder');
export const permissionsFile = () => join(home(), 'permissions.json');

// { data, broken }: the file's content, or {} and why it could not be read.
// A file that cannot be read is never written over: a typo in it must not
// wipe the rest of your rules.
export function readState() {
  let raw;
  try { raw = readFileSync(permissionsFile(), 'utf8'); } catch (e) { return { data: {}, broken: e.code === 'ENOENT' ? null : e.message }; }
  if (!raw.trim()) return { data: {}, broken: null };
  try {
    const d = JSON.parse(raw);
    return d && typeof d === 'object' && !Array.isArray(d) ? { data: d, broken: null } : { data: {}, broken: 'it is not a JSON object' };
  } catch (e) { return { data: {}, broken: e.message }; }
}

const list = (x) => (Array.isArray(x) ? [...new Set(x.filter((s) => typeof s === 'string').map((s) => s.trim()).filter(Boolean))] : []);
const scope = (s) => ({ allow: list(s?.allow), never: list(s?.never), protect: list(s?.protect), mode: MODES.includes(s?.mode) ? s.mode : null });

// The saved folders whose rules cover cwd (the folder itself or one above it), outermost first.
function coveringKeys(data, cwd) {
  const at = realFolder(cwd);
  return Object.keys(data.folders ?? {}).filter((k) => { const r = realFolder(k); return at === r || at.startsWith(`${r}${sep}`); }).sort((a, b) => a.length - b.length);
}

// One kind of rule as /permissions numbers it: what holds everywhere first,
// then each covering folder's. [{ text, where: 'everywhere' | 'folder', key?, at, here? }]
// (at: its place in its own list; here: the folder is cwd itself, not one above it)
export function entries(cwd, kind, state = readState()) {
  const { data } = state;
  const out = scope(data.everywhere)[kind].map((text, at) => ({ text, where: 'everywhere', at }));
  if (cwd && isTrusted(cwd)) {
    for (const key of coveringKeys(data, cwd)) scope(data.folders[key])[kind].forEach((text, at) => out.push({ text, where: 'folder', key, at, here: realFolder(key) === realFolder(cwd) }));
  }
  return out;
}

// What the permission check reads for one folder: { allow, never, protect } as
// plain text lists, and why the file could not be read (then no rule applies).
export function rulesFor(cwd) {
  const state = readState();
  const pick = (kind) => [...new Set(entries(cwd, kind, state).map((e) => e.text))];
  return { allow: pick('allow'), never: pick('never'), protect: pick('protect'), broken: state.broken };
}

// The mode saved for cwd: its folder's (or the nearest one above), else the
// everywhere one. { mode, where } or null.
export function startModeFor(cwd, state = readState()) {
  const { data } = state;
  if (cwd && isTrusted(cwd)) for (const key of coveringKeys(data, cwd).reverse()) { const mode = scope(data.folders[key]).mode; if (mode) return { mode, where: 'folder', key, here: realFolder(key) === realFolder(cwd) }; }
  const mode = scope(data.everywhere).mode;
  return mode ? { mode, where: 'everywhere' } : null;
}

const compact = (s) => { const o = {}; for (const k of KINDS) if (s[k].length) o[k] = s[k]; if (s.mode) o.mode = s.mode; return o; };
function prune(data) {
  const out = {};
  const every = compact(data.everywhere);
  if (Object.keys(every).length) out.everywhere = every;
  const folders = {};
  for (const [k, s] of Object.entries(data.folders)) { const c = compact(s); if (Object.keys(c).length) folders[k] = c; }
  if (Object.keys(folders).length) out.folders = folders;
  return out;
}

// Read, change, write (a temporary file renamed over it, so another window never
// reads half a file). fn gets the cleaned data and answers { ok, … }.
function change(fn) {
  const state = readState();
  if (state.broken) return { ok: false, error: `${permissionsFile().replace(homedir(), '~')} cannot be read (${state.broken}). Fix or delete it, then try again.` };
  const data = { everywhere: scope(state.data.everywhere), folders: {} };
  for (const [k, v] of Object.entries(state.data.folders ?? {})) data.folders[k] = scope(v);
  const r = fn(data);
  if (r.ok) {
    mkdirSync(home(), { recursive: true });
    const tmp = `${permissionsFile()}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(prune(data), null, 2)}\n`);
    renameSync(tmp, permissionsFile());
  }
  return r;
}

const target = (data, cwd, where) => (where === 'everywhere' ? data.everywhere : (data.folders[realFolder(cwd)] ??= scope({})));

// Add a rule for this folder (or everywhere). { ok } · { ok: false, duplicate, where } · { ok: false, error }
export function addRule(cwd, kind, rule, { where = 'folder' } = {}) {
  return change((data) => {
    const already = entries(cwd, kind, { data }).find((e) => e.text === rule);
    if (already) return { ok: false, duplicate: true, where: already.where };
    const s = target(data, cwd, where);
    if (s[kind].length >= MAX_RULES) return { ok: false, error: `That list is full (${MAX_RULES} rules). Remove one first.` };
    s[kind].push(rule);
    return { ok: true };
  });
}

// Take out rule number n of a kind, as numbered by entries().
export function removeRule(cwd, kind, n) {
  return change((data) => {
    const e = entries(cwd, kind, { data })[n - 1];
    if (!e) return { ok: false, missing: true };
    (e.where === 'everywhere' ? data.everywhere : data.folders[e.key])[kind].splice(e.at, 1);
    return { ok: true, removed: e.text, where: e.where };
  });
}

// Move a folder's rule to "everywhere".
export function promoteRule(cwd, kind, n) {
  return change((data) => {
    const e = entries(cwd, kind, { data })[n - 1];
    if (!e) return { ok: false, missing: true };
    if (e.where === 'everywhere') return { ok: false, already: true, text: e.text };
    data.folders[e.key][kind].splice(e.at, 1);
    if (!data.everywhere[kind].includes(e.text)) data.everywhere[kind].push(e.text);
    return { ok: true, promoted: e.text };
  });
}

// The mode Agentic Coder starts in (null takes the saved one away).
export function setStartMode(cwd, mode, { where = 'folder' } = {}) {
  return change((data) => { target(data, cwd, where).mode = mode; return { ok: true }; });
}
