// Every finished Bonsai Code page (report, preview, diagram, test page) is
// also saved into the Desktop folder "bonsai-code DOCS", the one place they
// are all kept; `bun run docs` then mirrors that folder into this repo's docs/.
import { existsSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

export const DOCS_DIR = process.env.BONSAI_DOCS ?? join(homedir(), 'Desktop', 'bonsai-code DOCS');

// Copies a finished file into the DOCS folder; returns where it went, or null.
// A missing folder is not recreated (it may have been moved): it says so instead.
export function toDocs(file, name = basename(file)) {
  if (process.env.BONSAI_NO_DOCS) return null;
  if (!existsSync(DOCS_DIR)) {
    console.log(`not copied to ${DOCS_DIR.replace(homedir(), '~')}: the folder is not there (moved? set BONSAI_DOCS)`);
    return null;
  }
  const to = join(DOCS_DIR, name);
  copyFileSync(file, to);
  console.log(`copied to ${to.replace(homedir(), '~')}`);
  return to;
}
