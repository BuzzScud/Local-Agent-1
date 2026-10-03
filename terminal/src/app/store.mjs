// Settings, saved sessions and prompt history, all under ~/.agentic-coder.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, appendFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOME, DEFAULT_MODEL } from '../../../models/index.mjs';
import { isTrusted } from './trust.mjs';
import { startModeFor } from './perm-store.mjs';

const SETTINGS = join(HOME, 'settings.json');
const DEFAULTS = { thinking: null, model: DEFAULT_MODEL };

// A trusted folder may set these in <folder>/.agentic/settings.json (the old
// .bonsai/settings.json is still read); they
// win over the global file, and what you type on the command line wins
// over both. Anything else in the file is ignored.
// memory: false turns the memory off (nothing brought back, nothing saved).
const FOLDER_KEYS = ['mode', 'effort', 'memory'];

function folderSettings(cwd) {
  if (!cwd || !isTrusted(cwd)) return {};
  let raw;
  try { raw = JSON.parse(readFileSync(join(cwd, '.agentic', 'settings.json'), 'utf8')); }
  catch { try { raw = JSON.parse(readFileSync(join(cwd, '.bonsai', 'settings.json'), 'utf8')); } catch { return {}; } }
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
// for another Mac's "New session in" rows (door.mjs). Only the latest conversation of each is
// opened, for its folder and title. A folder that is gone is left out, and so is a throwaway one
// (a test's project under the temp folders).
const THROWAWAY = [tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'];
export function recentFolders({ dir = SESSIONS, max = 6 } = {}) {
  let slugs = [];
  try { slugs = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
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
  for (const l of latest) {
    if (out.length >= max) break;
    try {
      const c = JSON.parse(readFileSync(l.file, 'utf8'));
      if (!c.cwd || THROWAWAY.some((t) => c.cwd === t || c.cwd.startsWith(`${t}/`)) || !statSync(c.cwd).isDirectory()) continue;
      if (out.some((o) => o.folder === c.cwd)) continue;
      out.push({ folder: c.cwd, title: c.title ?? '', updated: c.updated ?? new Date(l.at).toISOString(), convs: l.convs });
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
