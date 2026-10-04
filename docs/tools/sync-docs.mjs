// `bun run docs`, before a commit of pages. Pages are saved straight into this
// folder's groups (since 30 Sep 2026; before that they were saved into "cli docs"
// and copied here), so nothing is copied any more. It
//   1. rewrites docs/README.md, the index GitHub shows: every page of the
//      published groups (PAGE_GROUPS in to-docs.mjs), newest first;
//   2. stops with an error when git tracks a file of docs/ outside those groups
//      (docs/private/, a loose page at the top): the repo is public;
//   3. stops with an error when a page of the groups holds the home folder's
//      path or name (ownerMarks), so it is fixed before it is committed.
// It lives in docs/tools/ with to-docs.mjs, so that the groups hold only pages.
//   bun run docs              rewrite the index, run the two checks
//   bun run docs --dry        say what would change, change nothing
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { published, ownerMarks, PAGE_GROUPS } from './to-docs.mjs';

const here = dirname(dirname(fileURLToPath(import.meta.url))); // <repo>/docs (this file is in docs/tools/)
const own = (f) => f === 'README.md' || f.startsWith('tools/') || f.startsWith('map/'); // this folder's own files: the index, these tools and the repo's code map
const SKIP = /(^|\/)(\.DS_Store|\.localized|Icon\r)$|(^|\/)\._/;
const dry = process.argv.includes('--dry');

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
const pages = PAGE_GROUPS.filter((g) => existsSync(join(here, g))).flatMap((g) => list(here, join(here, g))).filter(published);

// Git must never hold a file of docs/ that is not a page of a group, the index or a tool.
const git = spawnSync('git', ['-C', here, 'ls-files', '-z', '--', '.'], { encoding: 'utf8' });
const tracked = git.status === 0 ? git.stdout.split('\0').filter(Boolean) : [];
const strays = tracked.filter((f) => !published(f) && !own(f));
// A published page must not point at this Mac's owner.
const marked = pages.map((f) => [f, ownerMarks(readFileSync(join(here, f), 'latin1'))]).filter(([, m]) => m.length);

// The index: every page, newest first, with its title and size.
const title = (f) => {
  if (extname(f) !== '.html') return '';
  const m = /<title>([^<]*)<\/title>/i.exec(readFileSync(join(here, f), 'utf8'));
  return m ? m[1].trim() : '';
};
const kind = (f) => ({ '.html': 'page', '.pdf': 'PDF', '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.svg': 'diagram', '.md': 'notes', '.csv': 'data', '.json': 'data' }[extname(f).toLowerCase()] ?? 'file');
const size = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const rows = pages
  .map((f) => ({ f, st: statSync(join(here, f)) }))
  .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)
  .map(({ f, st }) => `| [${f.replace(/\|/g, '\\|')}](${encodeURI(f)}) | ${kind(f)} | ${title(f).replace(/\|/g, '\\|')} | ${size(st.size)} | ${new Date(st.mtimeMs).toISOString().slice(0, 10)} |`);
const readme = `# Agentic Coder docs

Every diagram, preview, report and test page about Agentic Coder, newest first, by group:
${PAGE_GROUPS.map((g) => `\`${g}/\``).join(', ')}. Pages are saved straight into these
folders; \`bun run docs\` rewrites this index before a commit. The pages are single HTML
files with nothing loaded from outside; download one and open it in a browser to see it
(GitHub shows HTML as source).

| File | Kind | Title | Size | Saved |
|---|---|---|---|---|
${rows.join('\n')}
`;
const readmePath = join(here, 'README.md');
const readmeChanged = !existsSync(readmePath) || readFileSync(readmePath, 'utf8') !== readme;
if (!dry && readmeChanged) writeFileSync(readmePath, readme);
console.log(`${pages.length} pages in ${PAGE_GROUPS.length} groups; README.md index ${readmeChanged ? (dry ? 'would be rewritten' : 'rewritten') : 'already up to date'}`);

let bad = false;
if (strays.length) {
  bad = true;
  console.error(`git tracks ${strays.length} file${strays.length > 1 ? 's' : ''} of docs/ that must stay on this Mac: ${strays.join(', ')}\n  untrack with: git rm --cached -- <file> (the file itself stays)`);
}
if (marked.length) {
  bad = true;
  console.error(`${marked.length} page${marked.length > 1 ? 's hold' : ' holds'} the home folder's path or name (write it as ~ first):\n${marked.map(([f, m]) => `  ${f}: ${m.join(', ')}`).join('\n')}`);
}
if (git.status !== 0) console.error('git could not list docs/, so what it tracks was not checked');
process.exit(bad ? 1 : 0);
