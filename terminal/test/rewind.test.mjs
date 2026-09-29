// /rewind's store (app/rewind.mjs): copies around each message and each
// command, whose change was whose, and putting files back without touching
// anyone else's work or the project's own git.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync, chmodSync, utimesSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Rewind, pruneRewind, currentId, blobId, keyOf, rowNote, rewindChoices, planLines, ago } from '../src/app/rewind.mjs';

function project() {
  const base = mkdtempSync(join(tmpdir(), 'agentic-rewind-'));
  const cwd = join(base, 'proj');
  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, 'src', 'app.js'), 'export const a = 1;\n');
  writeFileSync(join(cwd, 'README.md'), '# demo\n');
  writeFileSync(join(cwd, 'run.sh'), '#!/bin/sh\necho hi\n');
  chmodSync(join(cwd, 'run.sh'), 0o755);
  return { base, cwd, home: join(base, 'home') };
}
const read = (p) => readFileSync(p, 'utf8');
// The project's own git, asked without refreshing its index (a plain
// status may rewrite the index's saved file times).
const gitIn = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_OPTIONAL_LOCKS: '0' } });

test('a message: edits, a command and someone else\'s change are told apart; only the model\'s go back', async () => {
  const { cwd, home } = project();
  const rw = new Rewind({ home, session: 's1' });
  await rw.warm(cwd);
  const p = await rw.begin({ cwd, text: 'make it 2' });
  expect(p.mode).toBe('full');
  // The model's Edit (the agent reports the path), a command it runs, and a
  // file another window changes meanwhile.
  writeFileSync(join(cwd, 'src', 'app.js'), 'export const a = 2;\n');
  await rw.around(async () => {
    writeFileSync(join(cwd, 'README.md'), '# demo, built\n');
    mkdirSync(join(cwd, 'out', 'deep'), { recursive: true });
    writeFileSync(join(cwd, 'out', 'deep', 'bundle.js'), 'x');
    rmSync(join(cwd, 'run.sh'));
  });
  writeFileSync(join(cwd, 'notes.txt'), 'mine');
  const done = await rw.finish(p, { files: ['src/app.js'], message: { role: 'user', content: 'make it 2' } });
  const by = Object.fromEntries(done.files.map((f) => [f.path, f.by]));
  expect(by).toEqual({ 'src/app.js': 'edit', 'README.md': 'command', 'out/deep/bundle.js': 'command', 'run.sh': 'command', 'notes.txt': 'other' });
  expect(done.key).toBe(keyOf('make it 2'));

  const plan = rw.plan(done.n);
  expect(plan.put.map((f) => f.rel)).toEqual(['README.md', 'out/deep/bundle.js', 'run.sh', 'src/app.js']);
  expect(plan.skip).toEqual([]);
  expect(plan.others.map((f) => f.rel)).toEqual(['notes.txt']);
  const r = await rw.restore(done.n);
  expect(r.failed).toEqual([]);
  expect(read(join(cwd, 'src', 'app.js'))).toBe('export const a = 1;\n');
  expect(read(join(cwd, 'README.md'))).toBe('# demo\n');
  expect(existsSync(join(cwd, 'out'))).toBe(false); // the folders it made went with the file
  expect(read(join(cwd, 'run.sh'))).toBe('#!/bin/sh\necho hi\n');
  expect(statSync(join(cwd, 'run.sh')).mode & 0o111).not.toBe(0); // still runs
  expect(read(join(cwd, 'notes.txt'))).toBe('mine'); // someone else's: left alone
  // Done once: a second time there is nothing left to put back.
  expect(rw.plan(done.n).put).toEqual([]);
  expect(rw.list()[0]).toMatchObject({ n: done.n, files: 4, undone: true });
});

test('a file changed since (by you or another session) is skipped and said why; the rest goes back', async () => {
  const { cwd, home } = project();
  const rw = new Rewind({ home, session: 's1' });
  const p = await rw.begin({ cwd, text: 'change both' });
  writeFileSync(join(cwd, 'src', 'app.js'), 'export const a = 2;\n');
  writeFileSync(join(cwd, 'README.md'), '# changed\n');
  const done = await rw.finish(p, { files: ['src/app.js', 'README.md'] });
  writeFileSync(join(cwd, 'README.md'), '# changed, then edited by hand\n');
  const r = await rw.restore(done.n);
  expect(r.put.map((f) => f.rel)).toEqual(['src/app.js']);
  expect(r.skip.map((f) => [f.rel, f.why])).toEqual([['README.md', 'changed since, by you or another session']]);
  expect(read(join(cwd, 'README.md'))).toBe('# changed, then edited by hand\n');
  expect(read(join(cwd, 'src', 'app.js'))).toBe('export const a = 1;\n');
});

test('back past several messages: each file returns to before its first change; a hand edit between messages keeps it', async () => {
  const { cwd, home } = project();
  const rw = new Rewind({ home, session: 's1' });
  const one = await rw.finish(await rw.begin({ cwd, text: 'one' }).then((p) => { writeFileSync(join(cwd, 'src', 'app.js'), 'v2\n'); writeFileSync(join(cwd, 'README.md'), 'r2\n'); return p; }), { files: ['src/app.js', 'README.md'] });
  writeFileSync(join(cwd, 'README.md'), 'r2 + my line\n'); // you, between the messages
  const p2 = await rw.begin({ cwd, text: 'two' });
  writeFileSync(join(cwd, 'src', 'app.js'), 'v3\n');
  writeFileSync(join(cwd, 'README.md'), 'r3\n');
  writeFileSync(join(cwd, 'src', 'new.js'), 'new\n');
  await rw.finish(p2, { files: ['src/app.js', 'README.md', 'src/new.js'] });
  expect(rw.list().map((m) => [m.text, m.files])).toEqual([['two', 3], ['one', 2]]);
  const r = await rw.restore(one.n);
  expect(read(join(cwd, 'src', 'app.js'))).toBe('export const a = 1;\n');
  expect(existsSync(join(cwd, 'src', 'new.js'))).toBe(false);
  expect(existsSync(join(cwd, 'src'))).toBe(true); // it was there before
  expect(r.skip.map((f) => [f.rel, f.why])).toEqual([['README.md', 'changed between your messages']]);
  expect(read(join(cwd, 'README.md'))).toBe('r3\n');
});

test('the project\'s own git is never touched: staging, stashes and branches stay as they were', async () => {
  const { cwd, home } = project();
  gitIn(cwd, 'init', '-q');
  gitIn(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
  gitIn(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'start');
  writeFileSync(join(cwd, 'README.md'), '# staged\n');
  gitIn(cwd, 'add', 'README.md');
  writeFileSync(join(cwd, '.git', 'info', 'exclude'), 'secret-notes/\n');
  mkdirSync(join(cwd, 'secret-notes'));
  writeFileSync(join(cwd, 'secret-notes', 'a.md'), 'private');
  const status = gitIn(cwd, 'status', '--porcelain');
  const refs = gitIn(cwd, 'for-each-ref');
  const staged = gitIn(cwd, 'ls-files', '-s');
  const rw = new Rewind({ home, session: 's1' });
  const p = await rw.begin({ cwd, text: 'edit' });
  writeFileSync(join(cwd, 'src', 'app.js'), 'changed\n');
  await rw.restore((await rw.finish(p, { files: ['src/app.js'] })).n);
  expect(gitIn(cwd, 'status', '--porcelain')).toBe(status);
  expect(gitIn(cwd, 'for-each-ref')).toBe(refs);
  expect(gitIn(cwd, 'ls-files', '-s')).toBe(staged);
  expect(gitIn(cwd, 'stash', 'list')).toBe('');
  // The project's own ignore list (in .git/info/exclude) keeps its folder out of the copies too.
  const store = join(home, 'rewind', 'stores');
  const dir = join(store, readdirSync(store)[0], 'store.git');
  const tree = execFileSync('git', ['--git-dir', dir, 'ls-tree', '-r', '--name-only', p.before], { encoding: 'utf8' });
  expect(tree).toContain('src/app.js');
  expect(tree).not.toContain('secret-notes');
});

test('an ignored file the model edits is still kept (from the text before its Edit)', async () => {
  const { cwd, home } = project();
  writeFileSync(join(cwd, '.gitignore'), '.env\n');
  writeFileSync(join(cwd, '.env'), 'KEY=old\n');
  const rw = new Rewind({ home, session: 's1' });
  const p = await rw.begin({ cwd, text: 'set the key' });
  rw.edited(join(cwd, '.env'), 'KEY=old\n');
  writeFileSync(join(cwd, '.env'), 'KEY=new\n');
  const done = await rw.finish(p, { files: ['.env'] });
  expect(done.files).toEqual([expect.objectContaining({ path: '.env', by: 'edit' })]);
  await rw.restore(done.n);
  expect(read(join(cwd, '.env'))).toBe('KEY=old\n');
});

test('a folder too big to copy: only the model\'s edits are kept, commands are not followed', async () => {
  const { cwd, home } = project();
  const rw = new Rewind({ home, session: 's1', maxFiles: 2 });
  const p = await rw.begin({ cwd, text: 'go' });
  expect(p.mode).toBe('edits');
  expect(rw.store(cwd).why).toBe('big');
  rw.edited(join(cwd, 'src', 'app.js'), 'export const a = 1;\n');
  writeFileSync(join(cwd, 'src', 'app.js'), 'export const a = 9;\n');
  rw.edited(join(cwd, 'src', 'made.js'), null);
  writeFileSync(join(cwd, 'src', 'made.js'), 'new\n');
  await rw.around(async () => writeFileSync(join(cwd, 'README.md'), 'by a command\n'));
  const done = await rw.finish(p, { files: ['src/app.js', 'src/made.js'] });
  expect(done.files.map((f) => f.path).sort()).toEqual(['src/app.js', 'src/made.js']);
  await rw.restore(done.n);
  expect(read(join(cwd, 'src', 'app.js'))).toBe('export const a = 1;\n');
  expect(existsSync(join(cwd, 'src', 'made.js'))).toBe(false);
  expect(read(join(cwd, 'README.md'))).toBe('by a command\n');
});

test('a big file is never copied into the store', async () => {
  const { cwd, home } = project();
  writeFileSync(join(cwd, 'data.bin'), Buffer.alloc(4096, 1));
  const rw = new Rewind({ home, session: 's1', bigFile: 1024 });
  const p = await rw.begin({ cwd, text: 'go' });
  const store = join(home, 'rewind', 'stores');
  const dir = join(store, readdirSync(store)[0], 'store.git');
  const tree = execFileSync('git', ['--git-dir', dir, 'ls-tree', '-r', '--name-only', p.before], { encoding: 'utf8' });
  expect(tree).toContain('README.md');
  expect(tree).not.toContain('data.bin');
});

test('the list is saved per conversation, the conversation part can drop the later messages, and ids match git\'s', async () => {
  const { cwd, home } = project();
  const rw = new Rewind({ home, session: 's1' });
  for (const t of ['a', 'b', 'c']) {
    const p = await rw.begin({ cwd, text: t });
    writeFileSync(join(cwd, `${t}.txt`), t);
    await rw.finish(p, { files: [`${t}.txt`] });
  }
  const again = new Rewind({ home, session: 's1' });
  expect(again.list().map((m) => m.text)).toEqual(['c', 'b', 'a']);
  again.dropFrom(again.list()[1].n);
  expect(new Rewind({ home, session: 's1' }).list().map((m) => m.text)).toEqual(['a']);
  again.setSession('s2');
  expect(again.list()).toEqual([]);
  expect(currentId(join(cwd, 'a.txt'))).toBe(execFileSync('git', ['hash-object', join(cwd, 'a.txt')], { encoding: 'utf8' }).trim());
  expect(blobId(Buffer.from(''))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
});

test('clean-up never takes a store a window has just started copying into', async () => {
  const { cwd, home } = project();
  const rw = new Rewind({ home, session: 'fresh' });
  const warming = rw.warm(cwd);
  await pruneRewind(home);
  await warming;
  const p = await rw.begin({ cwd, text: 'x' });
  expect(p.mode).toBe('full');
  expect(p.before).toMatch(/^[0-9a-f]{40}$/);
});

test('clean-up: a conversation unused for 7 days loses its copies, and the store goes once none is left', async () => {
  const { cwd, home } = project();
  const rw = new Rewind({ home, session: 'old' });
  const p = await rw.begin({ cwd, text: 'x' });
  writeFileSync(join(cwd, 'x.txt'), 'x');
  await rw.finish(p, { files: ['x.txt'] });
  const keep = new Rewind({ home, session: 'new' });
  const q = await keep.begin({ cwd, text: 'y' });
  writeFileSync(join(cwd, 'y.txt'), 'y');
  await keep.finish(q, { files: ['y.txt'] });
  const old = (Date.now() - 8 * 86_400_000) / 1000;
  utimesSync(join(home, 'rewind', 'sessions', 'old.json'), old, old);
  const stores = join(home, 'rewind', 'stores');
  const idx = join(stores, readdirSync(stores)[0], 'indexes');
  utimesSync(join(idx, 'old'), old, old);
  expect(await pruneRewind(home)).toEqual(['old']);
  const dir = join(stores, readdirSync(stores)[0], 'store.git');
  expect(execFileSync('git', ['--git-dir', dir, 'for-each-ref', '--format=%(refname)'], { encoding: 'utf8' }).trim()).toBe(`refs/rw/new/${q.n}`);
  // The newer one still goes back.
  await keep.restore(q.n);
  expect(existsSync(join(cwd, 'y.txt'))).toBe(false);
  // Then it ages out too: nothing is left behind.
  utimesSync(join(home, 'rewind', 'sessions', 'new.json'), old, old);
  utimesSync(join(idx, 'new'), old, old);
  utimesSync(join(dir, 'HEAD'), old, old);
  expect(await pruneRewind(home)).toEqual(['new']);
  expect(readdirSync(stores)).toEqual([]);
});

test('the message is found again: the same object in this window; after /resume by its text, counted from the newest; gone after a summary', async () => {
  const { cwd, home } = project();
  const rw = new Rewind({ home, session: 's1' });
  const messages = [{ role: 'system', content: 'sys' }];
  const send = async (content) => {
    const p = await rw.begin({ cwd, text: content });
    const msg = { role: 'user', content };
    messages.push(msg, { role: 'assistant', content: 'ok' });
    return rw.finish(p, { message: msg });
  };
  const a = await send('continue');
  const b = await send('other');
  const c = await send('continue');
  expect([a, b, c].map((p) => rw.messageIndex(messages, p.n))).toEqual([1, 3, 5]);
  // /resume: the conversation comes back from disk, the objects are new.
  const back = JSON.parse(JSON.stringify(messages));
  const again = new Rewind({ home, session: 's1' });
  expect([a, b, c].map((p) => again.messageIndex(back, p.n))).toEqual([1, 3, 5]);
  // A summary kept only the newest message of yours.
  const summed = [back[0], { role: 'assistant', content: 'My notes…' }, back[5], back[6]];
  expect([a, b, c].map((p) => again.messageIndex(summed, p.n))).toEqual([-1, -1, 2]);
});

test('the picker\'s words: each row, the choices there are, and what they do', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  expect(ago('2026-09-29T11:59:30Z', now)).toBe('just now');
  expect(ago('2026-09-29T11:48:00Z', now)).toBe('12 min ago');
  expect(ago('2026-09-29T09:00:00Z', now)).toBe('3 h ago');
  expect(rowNote({ files: 3, at: '2026-09-29T11:58:00Z', talk: true }, now)).toBe('3 files · 2 min ago');
  expect(rowNote({ files: 0, at: '2026-09-29T11:58:00Z', talk: false }, now)).toBe('no file changes · 2 min ago · summarized since');
  expect(rowNote({ files: 2, undone: true, at: '2026-09-29T11:58:00Z', talk: true }, now)).toBe('files put back · 2 min ago');
  const plan = { put: [{ rel: 'a.js' }, { rel: 'b.js' }], skip: [{ rel: 'c.js', why: 'changed since, by you or another session' }], others: [{ rel: 'notes.txt' }], edits: false };
  expect(rewindChoices(plan, true).map((o) => o.id)).toEqual(['both', 'files', 'talk', 'cancel']);
  expect(rewindChoices(plan, false).map((o) => o.id)).toEqual(['files', 'cancel']);
  expect(rewindChoices({ ...plan, put: [] }, true).map((o) => o.id)).toEqual(['talk', 'cancel']);
  expect(planLines(plan, true).map((l) => l.text)).toEqual([
    'Files that go back: a.js, b.js',
    'Left alone: c.js (changed since, by you or another session)',
    "Not the model's, left alone: notes.txt (changed while it worked, not by its edits or commands)",
  ]);
  expect(planLines({ put: [], skip: [], others: [], edits: true }, false).map((l) => l.text)).toEqual([
    "No file of the model's to put back from here on.",
    'In this folder only its Edit and Write changes were kept; what its commands changed is not followed.',
    'The conversation was summarized after this message, so only the files can go back.',
  ]);
});

test('a message that moves to another folder ("Work in <project>?") copies that folder before anything in it changes', async () => {
  const { base, cwd, home } = project();
  const other = join(base, 'other');
  mkdirSync(other);
  writeFileSync(join(other, 'x.js'), 'x = 1\n');
  const rw = new Rewind({ home, session: 's1' });
  const p = await rw.begin({ cwd, text: 'fix x in other' });
  rw.moved(other);
  await rw.whenMoved();
  writeFileSync(join(other, 'x.js'), 'x = 2\n');
  const done = await rw.finish(p, { files: ['x.js'] });
  expect(done.cwd).toBe(other);
  expect(done.files).toEqual([expect.objectContaining({ path: 'x.js', by: 'edit' })]);
  await rw.restore(done.n);
  expect(read(join(other, 'x.js'))).toBe('x = 1\n');
});

test('a copy that never comes back does not hold up the message: it goes ahead, keeping only the model\'s edits', async () => {
  const { cwd, home } = project();
  const rw = new Rewind({ home, session: 's1', beginWaitMs: 300 });
  rw.store(cwd).ready = new Promise(() => {}); // stuck for good
  const t0 = Date.now();
  const p = await rw.begin({ cwd, text: 'go' });
  expect(Date.now() - t0).toBeLessThan(2000);
  expect([p.mode, p.late]).toEqual(['edits', true]);
  rw.edited(join(cwd, 'README.md'), '# demo\n');
  writeFileSync(join(cwd, 'README.md'), '# changed\n');
  const done = await rw.finish(p, { files: ['README.md'] });
  expect(done.files.map((f) => f.path)).toEqual(['README.md']);
});
