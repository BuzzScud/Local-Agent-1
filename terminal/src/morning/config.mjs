// The morning brief's settings. The defaults are here; your own name, emails,
// deploy check and test records live on the Mac in ~/.repo-morning/config.json
// (REPO_MORNING_CONFIG points elsewhere), and win over these.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const expand = (p) => (typeof p === 'string' ? p.replace(/^~(?=\/|$)/, homedir()) : p);
const MORNING_HOME = () => expand(process.env.REPO_MORNING_HOME ?? '~/.repo-morning');

export const DEFAULTS = {
  name: null, // from git's user.name when unset
  scan: ['~/Desktop', '~', '~/worktrees', '~/work'],
  maxDepth: 4,
  exclude: ['/.nvm/', '/.codex/', '/.cache/', '/Library/', '/node_modules/', '/.Trash/', '/.claude', '/.equity-orbit/'],
  emails: [],
  ciOwners: [],
  deploy: {},
  testRecords: {},
  ignoreUntracked: ['.venv', 'venv', 'node_modules', '__pycache__', '.DS_Store', '.pytest_cache'],
  // Trees whose uncommitted changes are known to be kept elsewhere (never an attention item)
  ignoreDirty: [],
  out: '~/Desktop/morning-brief.html',
  history: null, // <MORNING_HOME>/history
};

export function loadConfig(overrides = {}) {
  const file = expand(process.env.REPO_MORNING_CONFIG ?? join(MORNING_HOME(), 'config.json'));
  let mine = {};
  if (existsSync(file)) {
    try { mine = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${file} is not valid JSON: ${e.message}`); }
  }
  const c = { ...DEFAULTS, ...mine, ...overrides };
  c.history = expand(process.env.REPO_MORNING_HISTORY ?? c.history ?? join(MORNING_HOME(), 'history'));
  c.out = expand(c.out);
  c.file = existsSync(file) ? file : null;
  return c;
}
