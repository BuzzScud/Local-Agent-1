// Where the DOCS folder is: the repo's own docs/ (since 30 Sep 2026; it was
// `cli docs/` beside it before that). AGENTIC_DOCS names it outright, else
// AGENTIC_REPO (the launcher passes it), else the repo this source runs from;
// from a worktree, the main folder's docs/, where the private things are.
// A leaf module, so the agent can find the folder (the design examples live
// in its private/ folder) without loading the hub.
import { statSync, readFileSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// This file's folder (import.meta.dir is Bun's alone; the bench runs under Node).
const here = dirname(fileURLToPath(import.meta.url));
const isDir = (d) => { try { return statSync(d).isDirectory(); } catch { return false; } };
// The owner's own folder inside docs/: on this Mac only, never in git.
export const PRIVATE = 'private';

// The repo's main folder, also from a worktree (whose .git is a file naming
// <main>/.git/worktrees/<name>). The same as mainFolder in docs/tools/to-docs.mjs,
// which the page builders use: the app is built without docs/, so it keeps its own.
export function mainFolder(dir) {
  try {
    const git = join(dir, '.git');
    if (statSync(git).isFile()) {
      const to = /^gitdir:\s*(.+)$/m.exec(readFileSync(git, 'utf8'))?.[1].trim() ?? '';
      const at = to.indexOf(`${sep}.git${sep}worktrees${sep}`);
      if (at > 0) return to.slice(0, at);
    }
  } catch {}
  return dir;
}

export function findDocsDir() {
  const repo = process.env.AGENTIC_REPO;
  const tries = [process.env.AGENTIC_DOCS, repo && join(mainFolder(repo), 'docs'), join(mainFolder(join(here, '..', '..', '..')), 'docs')].filter(Boolean);
  return tries.find(isDir) ?? null;
}

// The owner's own folder inside it (docs/private/), or null when it is not here (a fresh clone).
export function findPrivateDir() {
  const docs = findDocsDir();
  return docs && isDir(join(docs, PRIVATE)) ? join(docs, PRIVATE) : null;
}
