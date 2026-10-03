// Every finished Agentic Coder page (report, preview, diagram, test page) is
// saved into this repo's docs/ folder, in one of its page groups: the pages'
// one home since 30 Sep 2026 (before that they were saved into "cli docs"
// beside it and copied here). docs/ is on GitHub, which is public, so git
// keeps only the groups below, docs/README.md and docs/tools/ (the allow-list
// in .gitignore). The owner's own things (memory-about-you, design examples,
// morning briefs, Gemma run files) live in docs/private/, which never leaves
// this Mac; `bun run docs` and `bun run check` fail if a file of it is tracked.
import { existsSync, copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename, dirname, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..'); // this file is in <repo>/docs/tools/

// The repo's main folder, also when this runs from a worktree (whose .git is a
// file naming <main>/.git/worktrees/<name>): pages and private things are kept
// only there, so a page built in a worktree lands beside all the others. The app
// has the same function in terminal/src/app/docs-dir.mjs (it is built without docs/).
export function mainFolder(dir = repo) {
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

// The groups that are published. Only these reach GitHub (the repo is public).
export const PAGE_GROUPS = ['diagrams', 'reports', 'tests', 'design rounds', 'other', 'older versions', 'gemma-docs'];
// The owner's own folder inside docs/: on this Mac only, never in git.
export const PRIVATE = 'private';
export const published = (rel) => { const parts = String(rel).split('/'); return parts.length > 1 && PAGE_GROUPS.includes(parts[0]); };
export const DOCS_DIR = process.env.AGENTIC_DOCS ?? join(mainFolder(), 'docs');
export const PRIVATE_DIR = join(DOCS_DIR, PRIVATE);

// What in a published page would point at this Mac's owner: the home folder's
// path (/Users/<name>/…), or the same path as Agentic Coder writes it into a
// folder name (Users-<name>-…, the sessions folder). [] when there is none.
export function ownerMarks(text, home = homedir()) {
  const marks = [];
  const count = (s) => String(text).split(s).length - 1;
  const path = count(`${home}/`), folded = count(`${home.slice(1).replaceAll(sep, '-')}-`);
  if (path) marks.push(`the home folder's path ×${path}`);
  if (folded) marks.push(`the home folder's name in a file name ×${folded}`);
  return marks;
}

// Where a builder writes its page: into the DOCS folder (the pages' one
// home), in one of its groups: diagrams/, reports/, tests/, design rounds/,
// other/, older versions/, gemma-docs/ (or private/ for a page that must stay
// on this Mac). A missing DOCS folder stops with a clear message rather than
// recreating it; a missing group folder is made.
export function docsPath(name) {
  if (!existsSync(DOCS_DIR)) {
    console.error(`${DOCS_DIR.replace(homedir(), '~')} is not there (moved? set AGENTIC_DOCS). Nothing written.`);
    process.exit(1);
  }
  const p = join(DOCS_DIR, name);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

// Copies a finished file into the DOCS folder; returns where it went, or null.
// A missing folder is not recreated (it may have been moved): it says so instead.
export function toDocs(file, name = basename(file)) {
  if (process.env.AGENTIC_NO_DOCS) return null;
  if (!existsSync(DOCS_DIR)) {
    console.log(`not copied to ${DOCS_DIR.replace(homedir(), '~')}: the folder is not there (moved? set AGENTIC_DOCS)`);
    return null;
  }
  const to = join(DOCS_DIR, name);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(file, to);
  console.log(`copied to ${to.replace(homedir(), '~')}`);
  return to;
}
