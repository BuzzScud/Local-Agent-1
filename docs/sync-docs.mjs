// Mirrors the folder "agentic-coder DOCS" at the top of the repo (where every Agentic Coder
// diagram, preview, report and test page is saved) into this repo's docs/,
// and writes docs/README.md, an index GitHub shows.
//   bun run docs              copy new and changed files, remove files gone from the Desktop folder
//   bun run docs --dry        say what would change, change nothing
//   bun run docs --force      go ahead even if the Desktop folder looks mostly empty
// BONSAI_DOCS=<folder> points at the folder if it has moved.
import { existsSync, readdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // <repo>/docs
const SRC = (process.env.AGENTIC_DOCS ?? process.env.BONSAI_DOCS) ?? join(here, '..', 'agentic-coder DOCS');
const KEEP = new Set(['README.md', 'sync-docs.mjs', 'to-docs.mjs']); // this folder's own files
const SKIP = /(^|\/)(\.DS_Store|\.localized|Icon\r)$|(^|\/)\._/;
const dry = process.argv.includes('--dry');
const force = process.argv.includes('--force');

if (!existsSync(SRC)) {
  console.error(`Not found: ${SRC}\nWas the folder moved or renamed? Run again with BONSAI_DOCS=<its path>.`);
  process.exit(1);
}

const list = (root, dir = root, out = []) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const rel = relative(root, p);
    if (SKIP.test(rel)) continue;
    if (statSync(p).isDirectory()) list(root, p, out);
    else out.push(rel);
  }
  return out;
};

const src = list(SRC);
const dst = list(here).filter((f) => !KEEP.has(f));
// A folder that suddenly holds far fewer files than the repo copy was more
// likely emptied or swapped by accident than cleaned on purpose.
if (!force && dst.length >= 4 && src.length < dst.length / 2) {
  console.error(`${SRC} holds ${src.length} files; docs/ holds ${dst.length}. Nothing changed. If that is right, run again with --force.`);
  process.exit(1);
}

const same = (a, b) => existsSync(b) && statSync(a).size === statSync(b).size && readFileSync(a).equals(readFileSync(b));
const added = [], changed = [], removed = [];
for (const f of src) {
  const to = join(here, f);
  if (same(join(SRC, f), to)) continue;
  (existsSync(to) ? changed : added).push(f);
  if (!dry) { mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(SRC, f), to); }
}
for (const f of dst) {
  if (src.includes(f)) continue;
  removed.push(f);
  if (!dry) rmSync(join(here, f));
}

// The index: every file, newest first, with its title and size.
const title = (f) => {
  if (extname(f) !== '.html') return '';
  const m = /<title>([^<]*)<\/title>/i.exec(readFileSync(join(SRC, f), 'utf8'));
  return m ? m[1].trim() : '';
};
const kind = (f) => ({ '.html': 'page', '.pdf': 'PDF', '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.svg': 'diagram', '.md': 'notes', '.csv': 'data', '.json': 'data' }[extname(f).toLowerCase()] ?? 'file');
const size = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const rows = src
  .map((f) => ({ f, st: statSync(join(SRC, f)) }))
  .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)
  .map(({ f, st }) => `| [${f.replace(/\|/g, '\\|')}](${encodeURI(f)}) | ${kind(f)} | ${title(f).replace(/\|/g, '\\|')} | ${size(st.size)} | ${new Date(st.mtimeMs).toISOString().slice(0, 10)} |`);
const readme = `# Agentic Coder docs

Every diagram, preview, report and test page about Agentic Coder, newest first. This
folder mirrors \`bonsai-code DOCS/\` at the top of the repo on the Mac: pages are saved there, and
\`bun run docs\` copies them here before a commit. The pages are single HTML files
with nothing loaded from outside; download one and open it in a browser to see it
(GitHub shows HTML as source).

| File | Kind | Title | Size | Saved |
|---|---|---|---|---|
${rows.join('\n')}
`;
const readmePath = join(here, 'README.md');
const readmeChanged = !existsSync(readmePath) || readFileSync(readmePath, 'utf8') !== readme;
if (!dry && readmeChanged) writeFileSync(readmePath, readme);

const say = (label, xs) => xs.length && console.log(`${label} (${xs.length}): ${xs.join(', ')}`);
say(dry ? 'would add' : 'added', added);
say(dry ? 'would update' : 'updated', changed);
say(dry ? 'would remove' : 'removed', removed);
if (!added.length && !changed.length && !removed.length) console.log(`docs/ already matches ${SRC} (${src.length} files)`);
else console.log(`${dry ? 'would mirror' : 'mirrored'} ${src.length} files from ${SRC.replace(homedir(), '~')}${readmeChanged && !dry ? '; README.md index rewritten' : ''}`);
