// The docs folder (docs/): pages are saved straight into its groups and the repo is
// public, so git keeps only those groups (the allow-list in .gitignore), and
// docs/private/ (the owner's memory, design cards, morning briefs, Gemma run files)
// never leaves the Mac. `bun run docs` rewrites the index and refuses a page that
// holds the home folder's path.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { published, PAGE_GROUPS, PRIVATE, ownerMarks, mainFolder } from '../../docs/tools/to-docs.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('only files inside the page groups are published; gemma-docs is one of them, private/ never is', () => {
  expect(PAGE_GROUPS).toEqual(['diagrams', 'reports', 'tests', 'design rounds', 'other', 'older versions', 'gemma-docs']);
  expect(PRIVATE).toBe('private');
  for (const f of ['diagrams/a.html', 'tests/agentic-coder-test-record.html', 'design rounds/b.html', 'older versions/c.html', 'gemma-docs/g.html', 'gemma-docs/test/t.html']) expect(published(f)).toBe(true);
  for (const f of ['private/memory-about-you/index.md', 'private/design examples/opus/a.md', 'private/morning briefs/morning-brief.html', 'private/my-page.html', 'my-page.html', 'README.md', 'tools/sync-docs.mjs', 'tests', 'diagrams']) expect(published(f)).toBe(false);
});

test('.gitignore lets through exactly the page groups, the index, the tools and the code map of docs/', () => {
  const lines = readFileSync(join(repo, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
  expect(lines).toContain('docs/*');
  const allowed = lines.filter((l) => l.startsWith('!docs/')).map((l) => l.slice('!docs/'.length).replace(/\/$/, ''));
  expect(allowed.sort()).toEqual([...PAGE_GROUPS, 'README.md', 'tools', 'map'].sort());
  // and git agrees: a private file, a loose page and a new folder are ignored, a group's page is not
  const probe = (f) => spawnSync('git', ['-C', repo, 'check-ignore', '-q', '--no-index', f]).status === 0;
  for (const f of ['docs/private/memory-about-you/index.md', 'docs/loose-page.html', 'docs/some-new-folder/x.html']) expect(probe(f)).toBe(true);
  for (const f of ['docs/diagrams/x.html', 'docs/gemma-docs/test/x.html', 'docs/README.md', 'docs/tools/sync-docs.mjs', 'docs/map/MAP.md']) expect(probe(f)).toBe(false);
});

test('ownerMarks finds the home folder path, and its folded form in a file name; ~ is fine', () => {
  const home = homedir();
  expect(ownerMarks(`saved ${home}/Desktop/a.html`)).toEqual(["the home folder's path ×1"]);
  expect(ownerMarks(`sessions/${home.slice(1).replaceAll('/', '-')}-Desktop-x/1.json`)).toEqual(["the home folder's name in a file name ×1"]);
  expect(ownerMarks('saved ~/Desktop/a.html')).toEqual([]);
});

test('mainFolder: a worktree leads back to the main folder, where the pages are', () => {
  const main = mkdtempSync(join(tmpdir(), 'agentic-main-'));
  const tree = mkdtempSync(join(tmpdir(), 'agentic-tree-'));
  mkdirSync(join(main, '.git', 'worktrees', 'x'), { recursive: true });
  writeFileSync(join(tree, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'x')}\n`);
  expect(mainFolder(tree)).toBe(main);
  expect(mainFolder(main)).toBe(main); // the main folder's .git is a folder
});

test('bun run docs rewrites the index from the groups only, and stops on a page with the home folder path (a copy of docs/, not the real one)', () => {
  const copy = mkdtempSync(join(tmpdir(), 'agentic-docs-'));
  cpSync(join(repo, 'docs', 'tools'), join(copy, 'docs', 'tools'), { recursive: true });
  const put = (f, text = '<title>x</title>') => { mkdirSync(dirname(join(copy, 'docs', f)), { recursive: true }); writeFileSync(join(copy, 'docs', f), text); };
  put('diagrams/zz-diagram.html', '<title>A diagram</title>'); put('gemma-docs/test/zz-gemma.html', '<title>A Gemma page</title>');
  put('private/memory-about-you/index.md', '# private'); put('private/zz-private.html', '<title>Private</title>'); put('zz-loose.html');
  const run = () => spawnSync(process.execPath, [join(copy, 'docs', 'tools', 'sync-docs.mjs')], { encoding: 'utf8' });
  let r = run();
  expect(r.status).toBe(0);
  const index = readFileSync(join(copy, 'docs', 'README.md'), 'utf8');
  expect(index).toContain('diagrams/zz-diagram.html');
  expect(index).toContain('gemma-docs/test/zz-gemma.html');
  for (const secret of ['memory-about-you', 'zz-private', 'zz-loose']) expect(index).not.toContain(secret);
  put('tests/zz-leak.html', `<title>Leak</title> saved ${homedir()}/Desktop/x`);
  r = run();
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("tests/zz-leak.html: the home folder's path ×1");
});
