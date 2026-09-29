// Where the DOCS folder is: `cli docs/` at the top of the repo on this Mac
// (older Macs: `agentic-coder DOCS/`). AGENTIC_DOCS names it outright, else
// AGENTIC_REPO (the launcher passes it), else the repo this source runs from.
// A leaf module, so the agent can find the folder (the design examples live
// in it) without loading the hub.
import { statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// This file's folder (import.meta.dir is Bun's alone; the bench runs under Node).
const here = dirname(fileURLToPath(import.meta.url));

export const DOCS_NAMES = ['cli docs', 'agentic-coder DOCS', 'bonsai-code DOCS'];

export function findDocsDir() {
  const repo = process.env.AGENTIC_REPO ?? process.env.BONSAI_REPO;
  const tries = [(process.env.AGENTIC_DOCS ?? process.env.BONSAI_DOCS), ...(repo ? DOCS_NAMES.map((n) => join(repo, n)) : []), ...DOCS_NAMES.map((n) => join(here, '..', '..', '..', n))].filter(Boolean);
  return tries.find((d) => { try { return statSync(d).isDirectory(); } catch { return false; } }) ?? null;
}
