// Started in a folder that is not a project (the home folder, say), Agentic Coder can
// go into the project a request names: "fix the chart bug in MAIN2026".
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { isCodeProject } from '../flows/index.mjs';

// Folders never searched: the Mac's own, media, and build output.
const SKIP = new Set(['Library', 'Applications', 'Pictures', 'Music', 'Movies', 'Public', 'node_modules', 'dist', 'build']);

// Project folders under `root`, up to `depth` levels down. A project's own
// subfolders are not searched (MAIN2026/desks/chart is part of MAIN2026).
export function findProjects(root = homedir(), depth = 3) {
  const found = [];
  const walk = (dir, left) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const p = join(dir, e.name);
      if (isCodeProject(p)) found.push(p);
      else if (left > 1) walk(p, left - 1);
    }
  };
  walk(root, depth);
  return found;
}

const words = (s) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

// A folder name no sentence uses by chance: a digit, a dash, two words, capitals
// (MAIN2026, agentic-coder, Trading Lab). "prime" or "geometry" is an everyday word.
const distinctive = (name) => /[\d_\s-]/.test(name) || /[A-Z]/.test(name);

// The projects a request names: a path into one (~/Desktop/MAIN2026/...), or
// a folder name as a word ("MAIN2026", "coding code" for agentic-coder). An
// everyday word counts only when pointed at: "in prime", "the geometry folder".
export function projectsNamed(text, projects, cwd = homedir()) {
  for (const m of text.matchAll(/(?:^|\s)((?:~\/|\/|[\w.-]+\/)[^\s'"`]*)/g)) {
    const p = m[1].startsWith('~/') ? join(homedir(), m[1].slice(2)) : resolve(cwd, m[1]);
    const hit = projects.filter((d) => p === d || p.startsWith(`${d}/`)).sort((a, b) => b.length - a.length)[0];
    if (hit) return [hit];
  }
  const said = words(text);
  return projects.filter((d) => {
    const name = words(basename(d));
    if (name.trim().length < 3 || !said.includes(name)) return false;
    if (distinctive(basename(d))) return true;
    return new RegExp(` (in|into|inside|open|from)${name}| (the |my )?${name.trim()} (project|app|folder|repo|code|codebase) `).test(said);
  });
}
