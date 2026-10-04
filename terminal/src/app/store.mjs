// Settings, saved sessions and prompt history, all under ~/.agentic-coder.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, appendFileSync, existsSync, statSync, openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOME, DEFAULT_MODEL } from '../../../models/index.mjs';
import { isTrusted } from './trust.mjs';
import { startModeFor } from './perm-store.mjs';
import { modeOf } from '../agent/permissions.mjs';

const SETTINGS = join(HOME, 'settings.json');
const DEFAULTS = { thinking: null, model: DEFAULT_MODEL };

// A trusted folder may set these in <folder>/.agentic/settings.json; they
// win over the global file, and what you type on the command line wins
// over both. Anything else in the file is ignored.
// memory: false turns the memory off (nothing brought back, nothing saved).
const FOLDER_KEYS = ['mode', 'effort', 'memory'];

function folderSettings(cwd) {
  if (!cwd || !isTrusted(cwd)) return {};
  let raw;
  try { raw = JSON.parse(readFileSync(join(cwd, '.agentic', 'settings.json'), 'utf8')); } catch { return {}; }
  const out = {};
  for (const k of FOLDER_KEYS) if (raw[k] !== undefined) out[k] = raw[k];
  if (typeof out.effort === 'string') {
    // The level names: low answers straight away (no thinking).
    out.effort = out.effort.toLowerCase().replace(/^off$/, 'low').replace(/^xhigh$/, 'high');
    out.thinking = out.effort !== 'low';
    if (out.effort === 'low') delete out.effort;
  }
  if (out.mode && !['ask', 'edits', 'plan'].includes(out.mode)) delete out.mode;
  if (out.memory !== undefined && typeof out.memory !== 'boolean') delete out.memory;
  if (Object.keys(out).length) out.fromFolder = Object.keys(out).filter((k) => k !== 'fromFolder');
  return out;
}

export function loadSettings(cwd) {
  let global;
  try { global = { ...DEFAULTS, ...JSON.parse(readFileSync(SETTINGS, 'utf8')) }; } catch { global = { ...DEFAULTS }; }
  // The start-up mode saved with /permissions (its folder's, else everywhere's)
  // wins over the older settings files; modeFrom says which it was.
  const saved = cwd ? startModeFor(cwd) : null;
  return { ...global, ...folderSettings(cwd), ...(saved ? { mode: saved.mode, modeFrom: saved.where } : {}) };
}
// The mode a window starts in: --mode; else the start-up mode saved with /permissions or a trusted
// folder's own; else the one the last window was left in (lastMode, kept by the window as it
// changes; 4 Oct 2026, the owner's ask: "when we close it or exit, can it remember the mode?",
// Bypass included); else the older settings.json "mode"; else Manual. { mode, from } with from
// 'flag', 'saved', 'last' or 'default'. AGENTIC_LAST_MODE=off: the last one is not used (the tests).
export const keepsLastMode = () => !['off', '0', 'false'].includes(String(process.env.AGENTIC_LAST_MODE ?? 'on').toLowerCase());
export function firstMode(asked, settings = {}) {
  if (asked && modeOf(asked)) return { mode: modeOf(asked), from: 'flag' };
  if ((settings.modeFrom || settings.fromFolder?.includes('mode')) && modeOf(settings.mode)) return { mode: modeOf(settings.mode), from: 'saved' };
  if (keepsLastMode() && modeOf(settings.lastMode)) return { mode: modeOf(settings.lastMode), from: 'last' };
  return { mode: modeOf(settings.mode) ?? 'ask', from: 'default' };
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  delete next.fromFolder;
  delete next.modeFrom;
  mkdirSync(HOME, { recursive: true });
  writeFileSync(SETTINGS, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

const SESSIONS = join(HOME, 'sessions');
const slug = (cwd) => cwd.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(-100) || 'root';
export const newSessionId = () => new Date().toISOString().replace(/[:.]/g, '-');

export function saveSession(cwd, id, data) {
  const dir = join(SESSIONS, slug(cwd));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ ...data, cwd, id, updated: new Date().toISOString() }));
}

export function listSessions(cwd) {
  const dir = join(SESSIONS, slug(cwd));
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    try {
      const s = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      return { id: s.id, title: s.title ?? '(untitled)', updated: s.updated, turns: (s.messages ?? []).filter((m) => m.role === 'user').length };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => b.updated.localeCompare(a.updated));
}

// The folders conversations were had in, the latest first: [{ folder, title, updated, convs }],
// for another Mac's "New session in" rows (door.mjs). A throwaway folder (a test's project under
// the temp folders) is left out, and so is one that is gone.
// It is asked for on every list a door answers, so it reads little: a throwaway run is told by
// its folder's name where that shows, at most `look` of the latest are opened, and of each only
// its first and last bytes (saveSession writes the title first and the folder last), never the
// whole conversation. exists: how a folder is checked; null leaves the check to the caller (the
// door checks with a time limit: a folder macOS guards, or on a drive that went away, can keep a
// plain check waiting, and the door must never wait).
const THROWAWAY = [tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'];
const THROWAWAY_NAME = /^(private-)?(var-folders|tmp)-/;
const str = (x) => { try { return JSON.parse(`"${x}"`); } catch { return x; } };
function ends(file, n = 4096) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const head = Buffer.alloc(Math.min(n, size));
    const tail = Buffer.alloc(Math.min(n, size));
    readSync(fd, head, 0, head.length, 0);
    readSync(fd, tail, 0, tail.length, size - tail.length);
    return { head: head.toString('utf8'), tail: tail.toString('utf8') };
  } finally { closeSync(fd); }
}
export function recentFolders({ dir = SESSIONS, max = 6, look = 200, exists = (f) => statSync(f).isDirectory() } = {}) {
  let slugs = [];
  try { slugs = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !THROWAWAY_NAME.test(d.name)).map((d) => d.name); } catch { return []; }
  const latest = [];
  for (const s of slugs) {
    let best = null;
    let convs = 0;
    try {
      for (const f of readdirSync(join(dir, s))) {
        if (!f.endsWith('.json')) continue;
        convs++;
        const at = statSync(join(dir, s, f)).mtimeMs;
        if (!best || at > best.at) best = { file: join(dir, s, f), at };
      }
    } catch { continue; }
    if (best) latest.push({ ...best, convs });
  }
  latest.sort((a, b) => b.at - a.at);
  const out = [];
  for (const l of latest.slice(0, look)) {
    if (out.length >= max) break;
    try {
      const { head, tail } = ends(l.file);
      const m = /"cwd":"((?:[^"\\]|\\.)*)","id":"(?:[^"\\]|\\.)*","updated":"([^"]*)"\}\s*$/.exec(tail);
      if (!m) continue;
      const cwd = str(m[1]);
      if (!cwd || THROWAWAY.some((t) => cwd === t || cwd.startsWith(`${t}/`))) continue;
      if (out.some((o) => o.folder === cwd)) continue;
      if (exists && !exists(cwd)) continue;
      const t = /^\{"title":"((?:[^"\\]|\\.)*)"/.exec(head);
      out.push({ folder: cwd, title: t ? str(t[1]) : '', updated: m[2] || new Date(l.at).toISOString(), convs: l.convs });
    } catch {}
  }
  return out;
}

export function loadSession(cwd, id) {
  return JSON.parse(readFileSync(join(SESSIONS, slug(cwd), `${id}.json`), 'utf8'));
}

const HISTORY = join(HOME, 'history.jsonl');
export function loadHistory(cwd, max = 200) {
  try {
    return readFileSync(HISTORY, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((h) => h && h.cwd === cwd).map((h) => h.text).slice(-max);
  } catch { return []; }
}
export function addHistory(cwd, text) {
  mkdirSync(HOME, { recursive: true });
  appendFileSync(HISTORY, `${JSON.stringify({ cwd, text, at: new Date().toISOString() })}\n`);
}
