// Agentic Coder Web's settings and folders (8 Oct 2026). Everything lives in the web home:
//   ~/.agentic-coder/web/            (AGENTIC_WEB_HOME names another: the container's /data)
//     settings.json                  the admin page's Settings (mode 0600: it holds the calculator login)
//     web.sqlite                     users, sign-ins, invites, API keys, chats, runs, usage
//     users/<id>/work                a user's own folder (the Mac copy's runs work here)
//     users/<id>/home                that user's Agentic Coder home (memory, settings, trust) for their runs
//     users/<id>/chats/<chat>.jsonl  a chat's events; <chat>.transcript.json its conversation
// The addresses of the user's AI services and calculator are only ever here (the repo is public).
import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const webHome = () => process.env.AGENTIC_WEB_HOME ?? join(process.env.AGENTIC_HOME ?? join(homedir(), '.agentic-coder'), 'web');
export const settingsFile = () => join(webHome(), 'settings.json');
export const userDir = (id) => join(webHome(), 'users', String(id));

// The model that is the last resort (the owner's rule, 8 Oct): only after a yes, or picked by an admin.
export const LAST_RESORT = ['laguna-xs-2.1:q8_0'];
// The model a request uses when its user picked none.
export const DEFAULT_MODEL = 'Qwen3.6:35B-A3B';

export const DEFAULTS = {
  // This copy's own id, made at its first start (its sign-in cookie's name: auth.mjs).
  instance: null,
  // mode: 'mac' (this Mac: runs in folders) or 'server' (chat + calculator only, e.g. Linux).
  mode: 'mac',
  // The user's Ollama services, in order: AI 1 first.
  services: [],
  // The calculator: its address, and the one login that unlocks formulas (never sent to a page).
  calc: { url: null, user: null, pass: null },
  limits: { perUser: 1, total: 2, runMins: 60, askMins: 30, inviteDays: 7 },
  // A request with no first word from its service in `after` seconds (plus the time to read what
  // is new) moves to `to` on another service (the owner's pick: AI 2 after 60 s). Never Laguna.
  spill: { after: 60, to: null },
  models: { default: DEFAULT_MODEL, lastResort: LAST_RESORT, blocked: [] },
  // How the page names the two copies' addresses (shown, never used to connect).
  hosts: { mac: null, server: null },
};

const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], v) : v;
  return out;
};

// The settings as saved, over the defaults; the environment fills what is still empty the first
// time (AGENTIC_AI_URLS, AGENTIC_CALC_URL, AGENTIC_WEB_MODE, AGENTIC_WEB_MAC, AGENTIC_WEB_SERVER).
export function loadSettings(env = process.env) {
  let saved = {};
  try { saved = JSON.parse(readFileSync(settingsFile(), 'utf8')); } catch { /* the defaults */ }
  const s = merge(DEFAULTS, saved);
  if (!s.services.length && env.AGENTIC_AI_URLS) s.services = String(env.AGENTIC_AI_URLS).split(',').map((u) => u.trim()).filter(Boolean).map((url) => ({ url: url.replace(/\/+$/, '') }));
  if (!s.calc.url && env.AGENTIC_CALC_URL) s.calc = { ...s.calc, url: env.AGENTIC_CALC_URL.replace(/\/+$/, '') };
  if (env.AGENTIC_WEB_MODE === 'server' || env.AGENTIC_WEB_MODE === 'mac') s.mode = env.AGENTIC_WEB_MODE;
  if (!s.hosts.mac && env.AGENTIC_WEB_MAC) s.hosts = { ...s.hosts, mac: env.AGENTIC_WEB_MAC };
  if (!s.hosts.server && env.AGENTIC_WEB_SERVER) s.hosts = { ...s.hosts, server: env.AGENTIC_WEB_SERVER };
  s.services = s.services.map((x, i) => ({ ...x, id: i, label: x.label ?? `AI ${i + 1}` }));
  return s;
}

export function saveSettings(patch) {
  const now = loadSettings({});
  const { services, ...rest } = merge(now, patch);
  const next = { ...rest, services: (patch.services ?? services).map(({ url, label }) => ({ url: String(url).replace(/\/+$/, ''), ...(label && !/^AI \d+$/.test(label) ? { label } : {}) })) };
  mkdirSync(webHome(), { recursive: true, mode: 0o700 });
  const tmp = `${settingsFile()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, settingsFile());
  try { chmodSync(settingsFile(), 0o600); } catch { /* not ours to change */ }
  return loadSettings({});
}

// What a page may see of the settings: never the calculator's password.
export const publicSettings = (s) => ({ ...s, calc: { url: s.calc.url, user: s.calc.user, hasPass: Boolean(s.calc.pass) } });

