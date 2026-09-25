// Settings, saved sessions and prompt history, all under ~/.bonsai-code.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HOME } from '../server/models.mjs';

const SETTINGS = join(HOME, 'settings.json');
const DEFAULTS = { layout: 'classic', thinking: null, model: '27b' };

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(readFileSync(SETTINGS, 'utf8')) }; } catch { return { ...DEFAULTS }; }
}
export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
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
