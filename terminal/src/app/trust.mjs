// Folder trust, like Claude Code's first-visit safety check. Before Agentic Coder
// reads a folder's notes into the model or runs anything there, the user
// says once that they trust it. A yes covers the folder and everything
// inside it, and is kept in ~/.agentic-coder/trust.json. Saying yes to
// "Work in <project>?" mid-session counts too (src/app/App.jsx).
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join, resolve, sep, dirname, basename } from 'node:path';
import { homedir } from 'node:os';

// Read when used, not at import, so tests can point it at their own home.
const home = () => (process.env.AGENTIC_HOME ?? process.env.BONSAI_HOME) ?? join(homedir(), '.agentic-coder');
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

function load() {
  try {
    const t = JSON.parse(readFileSync(file(), 'utf8'));
    return t && typeof t === 'object' && !Array.isArray(t) ? t : {};
  } catch { return {}; }
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

export function saveTrust(cwd) {
  const t = load();
  t[real(cwd)] = new Date().toISOString();
  mkdirSync(home(), { recursive: true });
  writeFileSync(file(), `${JSON.stringify(t, null, 2)}\n`);
}
