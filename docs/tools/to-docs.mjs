// Every finished Agentic Coder page (report, preview, diagram, test page) is
// also saved into the folder "agentic-coder DOCS" at the top of this repo (on
// this Mac only, not in git), the one place they are all kept; `bun run docs`
// then mirrors that folder into this repo's docs/.
import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..'); // this file is in <repo>/docs/tools/
const named = ['agentic-coder DOCS', 'bonsai-code DOCS'].map((n) => join(repo, n));
export const DOCS_DIR = (process.env.AGENTIC_DOCS ?? process.env.BONSAI_DOCS) ?? (named.find((p) => existsSync(p)) ?? named[0]);

// Where a builder writes its page: into the DOCS folder (the pages' one
// home), in one of its groups: diagrams/, reports/, tests/, design rounds/,
// other/, older versions/. A missing DOCS folder stops with a clear message
// rather than recreating it; a missing group folder is made.
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
  if (process.env.AGENTIC_NO_DOCS ?? process.env.BONSAI_NO_DOCS) return null;
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
