// The workbench's calls (terminal/src/window/workbench.mjs, 26 Nov 2026): the folder's tree and names, a file read and
// saved with its stamp, the fence around the folder, new · rename · Trash, a search by git and by a walk, Source
// control's state, its two sides and its changes, the quick check of a file, the page's packages, a real shell in the
// terminal pane, and the note when a file changes. No model and no window: each call on a folder made for the test.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { treeOf, allFiles, readOne, saveOne, makeOne, renameOne, trashOne, inside, searchAll, gitState, gitDiff, gitDo, checkOne, staticFile, packageDir, makeShells, watchFolder, workbenchRoute, readState, saveState, READ_MAX } from '../src/window/workbench.mjs';

const sh = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } });
function shop({ repo = true } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wbx-')));
  mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(dir, 'src', 'price.mjs'), 'export const total = (a, b) => a + b;\nexport const TAX = 0.2;\n');
  writeFileSync(join(dir, 'src', 'cart.mjs'), "import { total } from './price.mjs';\nexport const cart = () => total(1, 2);\n");
  writeFileSync(join(dir, 'README.md'), '# Shop\n\nThe total is a + b.\n');
  writeFileSync(join(dir, 'node_modules', 'x', 'index.js'), 'module.exports = "total";\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
  if (repo) { sh(dir, 'init', '-q', '-b', 'main'); sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'first'); }
  return dir;
}

test('the tree: folders first, hidden files shown, git\'s own folder never, a bulky folder marked', () => {
  const dir = shop();
  const top = treeOf(dir);
  expect(top.entries.map((e) => e.name)).toEqual(['node_modules', 'src', '.gitignore', 'README.md']);
  expect(top.entries[0]).toMatchObject({ dir: true, heavy: true });
  expect(treeOf(dir, 'src').entries.map((e) => e.path)).toEqual(['src/cart.mjs', 'src/price.mjs']);
  expect(treeOf(dir, '../..').error).toMatch(/outside/);
});

test('Go to file lists what git knows and what is new, never an ignored file; a plain folder is walked', () => {
  const dir = shop();
  writeFileSync(join(dir, 'new.txt'), 'x');
  expect(allFiles(dir).files.sort()).toEqual(['.gitignore', 'README.md', 'new.txt', 'src/cart.mjs', 'src/price.mjs']);
  const plain = shop({ repo: false });
  expect(allFiles(plain).files.sort()).toEqual(['README.md', 'src/cart.mjs', 'src/price.mjs']);
});

test('a file is read with a stamp, saved with it, and never written over when it changed since', async () => {
  const dir = shop();
  const a = readOne(dir, 'src/price.mjs');
  expect(a.text).toContain('TAX');
  expect(saveOne(dir, 'src/price.mjs', 'export const TAX = 0.25;\n', { stamp: a.stamp })).toMatchObject({ ok: true });
  await Bun.sleep(15);
  writeFileSync(join(dir, 'src', 'price.mjs'), 'export const TAX = 0.3; // someone else\n');
  const late = saveOne(dir, 'src/price.mjs', 'mine\n', { stamp: a.stamp });
  expect(late).toMatchObject({ ok: false, changed: true });
  expect(readFileSync(join(dir, 'src', 'price.mjs'), 'utf8')).toContain('someone else');
  expect(saveOne(dir, 'src/price.mjs', 'mine\n', { stamp: a.stamp, force: true }).ok).toBe(true);
  expect(saveOne(dir, 'src/deep/new.mjs', 'export {};\n')).toMatchObject({ ok: true, made: true });
  writeFileSync(join(dir, 'pic.bin'), Buffer.from([1, 2, 0, 3]));
  expect(readOne(dir, 'pic.bin')).toMatchObject({ binary: true });
  writeFileSync(join(dir, 'big.txt'), 'a'.repeat(READ_MAX + 10));
  expect(readOne(dir, 'big.txt')).toMatchObject({ cut: true });
  expect(readOne(dir, 'nope.txt')).toMatchObject({ gone: true });
});

test('the fence: no way out of the folder by .., an absolute path or a link', () => {
  const dir = shop();
  const out = realpathSync(mkdtempSync(join(tmpdir(), 'wbx-out-')));
  writeFileSync(join(out, 'secret.txt'), 'no');
  symlinkSync(out, join(dir, 'link'));
  expect(inside(dir, '../x')).toBe(null);
  expect(inside(dir, '/etc/hosts')).toBe(null);
  expect(inside(dir, 'link/secret.txt')).toBe(null);
  expect(readOne(dir, 'link/secret.txt').error).toMatch(/outside/);
  expect(saveOne(dir, 'link/new.txt', 'x').ok).toBe(false);
  expect(existsSync(join(out, 'new.txt'))).toBe(false);
  expect(inside(dir, 'src/not-yet/a.mjs')).toBe(join(dir, 'src', 'not-yet', 'a.mjs'));
});

test('a new file and folder, a new name, and the Trash instead of a delete', () => {
  const dir = shop();
  const trash = mkdtempSync(join(tmpdir(), 'wbx-trash-'));
  expect(makeOne(dir, 'src/a/b.mjs')).toMatchObject({ ok: true, path: 'src/a/b.mjs' });
  expect(makeOne(dir, 'src/a/b.mjs').ok).toBe(false);
  expect(makeOne(dir, 'docs', { dir: true })).toMatchObject({ ok: true, dir: true });
  expect(renameOne(dir, 'src/a/b.mjs', 'src/a/c.mjs')).toMatchObject({ ok: true, path: 'src/a/c.mjs' });
  expect(renameOne(dir, 'src/a/c.mjs', 'README.md').ok).toBe(false);
  expect(trashOne(dir, 'src/a/c.mjs', { trash }).ok).toBe(true);
  expect(existsSync(join(dir, 'src', 'a', 'c.mjs'))).toBe(false);
  expect(existsSync(join(trash, 'c.mjs'))).toBe(true);
  expect(trashOne(dir, '../x', { trash }).ok).toBe(false);
});

test('Find in files: plain words, a pattern, whole words, the case, only some files; by git and by a walk the same', () => {
  for (const repo of [true, false]) {
    const dir = shop({ repo });
    const all = searchAll(dir, { query: 'total' });
    expect(all.hits.map((h) => `${h.path}:${h.line}`).sort()).toEqual(['README.md:3', 'src/cart.mjs:1', 'src/cart.mjs:2', 'src/price.mjs:1']);
    expect(all.hits.find((h) => h.path === 'src/price.mjs')).toMatchObject({ col: 14, len: 5 });
    expect(all.files).toBe(3);
    expect(searchAll(dir, { query: 'TOTAL', matchCase: true }).total).toBe(0);
    expect(searchAll(dir, { query: 'tot', word: true }).total).toBe(0);
    expect(searchAll(dir, { query: 'to+tal\\(', regex: true }).hits.map((h) => h.path)).toEqual(['src/cart.mjs']);
    expect(searchAll(dir, { query: 'total', include: '*.md' }).hits.map((h) => h.path)).toEqual(['README.md']);
    expect(searchAll(dir, { query: '(', regex: true }).error).toBeTruthy();
    expect(searchAll(dir, { query: '' }).hits).toEqual([]);
  }
});

test('Source control: the branch, each change on its side, the two sides of one, stage · commit · discard · branches', () => {
  const dir = shop();
  writeFileSync(join(dir, 'src', 'price.mjs'), 'export const total = (a, b) => a + b;\nexport const TAX = 0.25;\n');
  writeFileSync(join(dir, 'notes.txt'), 'new\n');
  let s = gitState(dir);
  expect(s).toMatchObject({ repo: true, branch: 'main', remote: false });
  expect(gitDo(dir, 'push', {})).toMatchObject({ ok: false, why: expect.stringContaining('nowhere to push') });
  expect(s.files).toEqual([{ path: 'notes.txt', status: 'new', code: '?', staged: false }, { path: 'src/price.mjs', status: 'changed', code: 'M', staged: false }]);
  const d = gitDiff(dir, 'src/price.mjs');
  expect(d.before).toContain('0.2;');
  expect(d.after).toContain('0.25;');
  expect(gitDo(dir, 'stage', { path: 'src/price.mjs' }).ok).toBe(true);
  s = gitState(dir);
  expect(s.files.find((f) => f.path === 'src/price.mjs')).toMatchObject({ staged: true, status: 'changed' });
  expect(gitDiff(dir, 'src/price.mjs', { staged: true }).after).toContain('0.25;');
  expect(gitDo(dir, 'unstage', { path: 'src/price.mjs' }).ok).toBe(true);
  expect(gitState(dir).files.find((f) => f.path === 'src/price.mjs').staged).toBe(false);
  expect(gitDo(dir, 'commit', { message: '  ' }).ok).toBe(false);
  expect(gitDo(dir, 'stage', { path: 'src/price.mjs' }).ok).toBe(true);
  expect(gitDo(dir, 'commit', { message: 'tax up' })).toMatchObject({ ok: true });
  expect(gitDo(dir, 'log', {}).commits.map((c) => c.subject)).toEqual(['tax up', 'first']);
  // discard: a tracked file goes back to its last commit, a new one is not deleted (it goes to the Trash)
  writeFileSync(join(dir, 'README.md'), 'gone wrong\n');
  expect(gitDo(dir, 'discard', { path: 'README.md' }).ok).toBe(true);
  expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('# Shop');
  expect(gitDo(dir, 'branch', { name: 'tax-work' }).ok).toBe(true);
  expect(gitState(dir).branch).toBe('tax-work');
  expect(gitDo(dir, 'branches', {}).branches.map((b) => [b.name, b.current]).sort()).toEqual([['main', false], ['tax-work', true]]);
  expect(gitDo(dir, 'checkout', { name: 'main' }).ok).toBe(true);
  expect(gitDo(dir, 'checkout', { name: '--force' }).ok).toBe(false);
  expect(gitDo(dir, 'branch', { name: 'a..b' }).ok).toBe(false);
  // a folder that is no repository says so, and init makes it one
  const plain = shop({ repo: false });
  expect(gitState(plain)).toEqual({ repo: false });
  expect(gitDo(plain, 'commit', { message: 'x' }).ok).toBe(false);
  expect(gitDo(plain, 'init', {}).ok).toBe(true);
  expect(gitState(plain).repo).toBe(true);
});

test('a folder inside a larger repository shows its own changes by its own paths', () => {
  const dir = shop();
  mkdirSync(join(dir, 'web'));
  writeFileSync(join(dir, 'web', 'page.html'), '<p>hi</p>\n');
  writeFileSync(join(dir, 'README.md'), 'changed above\n');
  const s = gitState(join(dir, 'web'));
  expect(s.files).toEqual([{ path: 'page.html', status: 'new', code: '?', staged: false }]);
  expect(s.elsewhere).toBe(1);
  expect(gitDiff(join(dir, 'web'), 'page.html').after).toContain('hi');
});

test('the quick check says where a file does not read: JavaScript, JSON, and Python where the Mac has it', () => {
  const dir = shop();
  writeFileSync(join(dir, 'bad.mjs'), 'export const a = (1 +;\n');
  writeFileSync(join(dir, 'bad.json'), '{ "a": 1,\n  "b": }\n');
  writeFileSync(join(dir, 'ok.json'), '{ "a": 1 }\n');
  expect(checkOne(dir, 'src/price.mjs')).toEqual([]);
  const js = checkOne(dir, 'bad.mjs');
  expect(js.length).toBeGreaterThan(0);
  expect(js[0]).toMatchObject({ path: 'bad.mjs', line: 1, severity: 'error' });
  expect(checkOne(dir, 'bad.json')[0]).toMatchObject({ path: 'bad.json', line: 2 });
  expect(checkOne(dir, 'ok.json')).toEqual([]);
  if (spawnSync('python3', ['--version']).status === 0) {
    writeFileSync(join(dir, 'bad.py'), 'def f(:\n    pass\n');
    expect(checkOne(dir, 'bad.py')[0]).toMatchObject({ path: 'bad.py', line: 1 });
  }
});

test("the page's packages are served from their own folders only", () => {
  const vs = packageDir('monaco-editor', 'min/vs/loader.js');
  expect(vs).toBeTruthy();
  expect(staticFile('/vs/loader.js')).toMatchObject({ type: 'text/javascript; charset=utf-8' });
  expect(staticFile('/vs/editor/editor.main.css').type).toMatch(/css/);
  expect(staticFile('/vs/../../package.json')).toBe(null);
  expect(staticFile('/vs/%2e%2e/%2e%2e/package.json')).toBe(null);
  expect(staticFile('/xterm/lib/xterm.mjs')).toMatchObject({ type: 'text/javascript; charset=utf-8' });
  expect(staticFile('/xterm/css/xterm.css').type).toMatch(/css/);
  expect(staticFile('/xterm-fit/lib/addon-fit.mjs')).toBeTruthy();
  expect(staticFile('/elsewhere/x.js')).toBe(null);
});

test('the terminal pane runs a real shell in the folder, takes typing, and ends', async () => {
  const dir = shop();
  let out = ''; const ends = [];
  const shells = makeShells({ folder: dir, env: { ...process.env, SHELL: '/bin/sh' }, data: (_id, t) => { out += t; }, ended: (id, code) => ends.push([id, code]) });
  expect(shells.open('t1', { cols: 80, rows: 10 }).ok).toBe(true);
  shells.write('t1', 'echo wbx-$((40+2)) && pwd\r');
  for (let i = 0; i < 60 && !(out.includes('wbx-42') && out.includes(dir)); i++) await Bun.sleep(50);
  expect(out).toContain('wbx-42');
  expect(out).toContain(dir);
  shells.resize('t1', 120, 30);
  shells.write('t1', 'exit\r');
  for (let i = 0; i < 60 && !ends.length; i++) await Bun.sleep(50);
  expect(ends[0]?.[0]).toBe('t1');
  expect(shells.size).toBe(0);
});

test('a file that changes under the folder is told once, with its path; bulky folders are not', async () => {
  const dir = shop();
  const told = [];
  const w = watchFolder(dir, (paths) => told.push(...paths), { wait: 60 });
  await Bun.sleep(120);
  writeFileSync(join(dir, 'src', 'price.mjs'), 'export const total = 1;\n');
  writeFileSync(join(dir, 'node_modules', 'x', 'index.js'), 'changed\n');
  for (let i = 0; i < 40 && !told.includes('src/price.mjs'); i++) await Bun.sleep(50);
  w.close();
  expect(told).toContain('src/price.mjs');
  expect(told.some((p) => p.startsWith('node_modules/'))).toBe(false);
});

test("the window server's answers: read, save with its check, search, git, and nothing outside /wb/", async () => {
  const dir = shop();
  const ask = async (path, init) => { const u = new URL(`http://x${path}`); const r = await workbenchRoute(new Request(u, init), u, dir); return r ? { status: r.status, body: await r.json() } : null; };
  const post = (path, body) => ask(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  expect(await ask('/other')).toBe(null);
  expect((await ask('/wb/tree?p=src')).body.entries.length).toBe(2);
  const f = (await ask('/wb/file?p=src/price.mjs')).body;
  const saved = (await post('/wb/file', { path: 'src/price.mjs', text: 'export const a = (;\n', stamp: f.stamp })).body;
  expect(saved.ok).toBe(true);
  expect(saved.problems[0]).toMatchObject({ path: 'src/price.mjs', line: 1 });
  expect((await ask('/wb/search?q=total&word=1')).body.total).toBeGreaterThan(0);
  expect((await ask('/wb/git')).body.files.map((x) => x.path)).toEqual(['src/price.mjs']);
  expect((await post('/wb/git', { op: 'stage', path: 'src/price.mjs' })).body.ok).toBe(true);
  expect((await post('/wb/new', { path: 'a.txt' })).body.ok).toBe(true);
  expect((await ask('/wb/nothing')).status).toBe(404);
});

test('what the workbench had open is kept by folder in the app\'s home, and never without one', async () => {
  const dir = shop(), other = shop(), home = mkdtempSync(join(tmpdir(), 'wbx-home-'));
  expect(readState(home, dir)).toEqual({});
  expect(saveState(home, dir, { state: { view: 'files' }, chatW: 480 }).ok).toBe(true);
  expect(readState(home, dir)).toEqual({ state: { view: 'files' }, chatW: 480 });
  expect(readState(home, other)).toEqual({});
  expect(saveState(home, dir, 'x').ok).toBe(false);
  expect(saveState(home, dir, { big: 'a'.repeat(300_000) }).ok).toBe(false);
  const ask = async (path, init, o) => { const u = new URL(`http://x${path}`); const r = await workbenchRoute(new Request(u, init), u, dir, o); return r.json(); };
  expect(await ask('/wb/state', undefined, { home })).toEqual({ state: { state: { view: 'files' }, chatW: 480 } });
  expect(await ask('/wb/state', { method: 'POST', body: JSON.stringify({ state: { a: 1 } }) }, {})).toEqual({ ok: false });
});
