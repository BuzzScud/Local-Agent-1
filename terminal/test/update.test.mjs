// "Update available" in the lower right: a commit on main that changes
// Bonsai's code while it runs lights the badge; docs-only commits, code that
// was already built in, and pushes not yet in this folder are told apart.
// /update restarts the app on the new code with the conversation kept.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, utimesSync, readFileSync, symlinkSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isAppCode, checkUpdate, updateText, bringIn } from '../src/app/update.mjs';
import { startFakeServer } from './fake-server.mjs';
import { openTerm } from './term.mjs';

const git = (repo, ...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
function put(repo, path, text) { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), text); }
function commit(repo, files, msg) { for (const [p, t] of Object.entries(files)) put(repo, p, t); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', msg); return git(repo, 'rev-parse', 'HEAD'); }
function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'bonsai-update-'));
  git(repo, 'init', '-q', '-b', 'main');
  commit(repo, { 'terminal/src/cli.jsx': '// app\n', 'terminal/src/app/a.mjs': 'export const a = 1;\n', 'bonsai-code DOCS/x.html': '<p>x</p>' }, 'start');
  return repo;
}
const heads = (repo) => ({ main: git(repo, 'rev-parse', 'main'), origin: null });

test('the file list matches the launcher: code counts, docs, tests, results and READMEs do not', () => {
  for (const p of ['terminal/src/app/App.jsx', 'terminal/src/app/help.html', 'terminal/rules/bug-fixing.md', 'models/index.mjs', 'models/bonsai-2-27b/model.mjs', 'package.json']) expect([p, isAppCode(p)]).toEqual([p, true]);
  for (const p of ['docs/README.md', 'bonsai-code DOCS/a.html', 'terminal/test/app.test.mjs', 'models/evals/bench/run.mjs', 'models/bonsai-2-27b/results/r.json', 'models/README.md', 'terminal/README.md', 'terminal/scripts/demo/spin.jsx', 'models/runtime/engine/x.patch']) expect([p, isAppCode(p)]).toEqual([p, false]);
});

test('a code commit on main after the start lights the badge; a docs-only commit does not', async () => {
  const repo = makeRepo();
  const start = heads(repo);
  const built = Date.now() - 1000;
  commit(repo, { 'bonsai-code DOCS/y.html': '<p>y</p>' }, 'docs only');
  expect(await checkUpdate(repo, start, built)).toBeNull();
  commit(repo, { 'terminal/src/app/a.mjs': 'export const a = 2;\n' }, 'code');
  const u = await checkUpdate(repo, start, built);
  expect(u?.kind).toBe('ready');
  expect(updateText(u)).toBe('↻ Update available · /update to use it');
});

test('committing code that was already built in (older than the build) is not an update', async () => {
  const repo = makeRepo();
  const start = heads(repo);
  put(repo, 'terminal/src/app/a.mjs', 'export const a = 3;\n');
  const old = new Date(Date.now() - 60_000);
  utimesSync(join(repo, 'terminal/src/app/a.mjs'), old, old); // edited before this build ran
  commit(repo, {}, 'commit the edit the running build already has');
  expect(await checkUpdate(repo, start, Date.now() - 1000)).toBeNull();
});

test("a push to GitHub's main from elsewhere (not in this folder) asks for a pull first", async () => {
  const repo = makeRepo();
  const base = git(repo, 'rev-parse', 'main');
  git(repo, 'update-ref', 'refs/remotes/origin/main', base);
  const start = { main: base, origin: base };
  git(repo, 'checkout', '-q', '-b', 'other');
  const pushed = commit(repo, { 'models/index.mjs': 'export {};\n' }, 'from a worktree');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'update-ref', 'refs/remotes/origin/main', pushed);
  const u = await checkUpdate(repo, start, Date.now());
  expect(u?.kind).toBe('pull');
  expect(updateText(u)).toBe('↻ Update on GitHub · /update to get it');
  git(repo, 'merge', '-q', '--ff-only', 'other'); // pulled: now it is a plain restart
  expect((await checkUpdate(repo, start, Date.now() - 60_000))?.kind).toBe('ready');
});

test('the real app shows the badge in the lower right when a code commit lands while it runs', async () => {
  const repo = makeRepo();
  const base = mkdtempSync(join(tmpdir(), 'bonsai-update-app-'));
  const cwd = join(base, 'demo-project');
  cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
  mkdirSync(join(base, 'home'), { recursive: true });
  writeFileSync(join(base, 'home', 'trust.json'), JSON.stringify({ [cwd]: new Date().toISOString() }));
  const fake = await startFakeServer([{ text: 'Hello.' }]);
  const t = openTerm({ cwd, env: { BONSAI_HOME: join(base, 'home'), BONSAI_REPO: repo, BONSAI_UPDATE_EVERY: '300' }, args: ['--url', fake.url, '--no-flows'] });
  try {
    await t.waitFor('? for shortcuts');
    await new Promise((r) => setTimeout(r, 700));
    expect(await t.screen()).not.toContain('Update available');
    commit(repo, { 'terminal/src/app/a.mjs': 'export const a = 4;\n' }, 'an update');
    await t.waitFor('↻ Update available · /update to use it', 10_000);
    const lines = (await t.screen()).split('\n');
    const footer = lines.find((l) => l.includes('Update available'));
    expect(footer).toContain('? for shortcuts'); // the footer line, right side
    expect(footer.trimEnd().length).toBeGreaterThan(155 - 4);
  } finally { await t.close(); await fake.close(); }
}, 60_000);

test('/update brings a GitHub-only update into main only when git can fast-forward cleanly', async () => {
  const repo = makeRepo();
  const base = git(repo, 'rev-parse', 'main');
  git(repo, 'checkout', '-q', '-b', 'other');
  const pushed = commit(repo, { 'terminal/src/app/a.mjs': 'export const a = 5;\n' }, 'from a worktree');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'update-ref', 'refs/remotes/origin/main', pushed);
  // An uncommitted edit to a file the update changes: git refuses, nothing moves.
  put(repo, 'terminal/src/app/a.mjs', 'export const a = "mine";\n');
  const no = await bringIn(repo);
  expect(no.ok).toBe(false);
  expect(no.why).toMatch(/overwritten|local changes/i);
  expect(git(repo, 'rev-parse', 'main')).toBe(base);
  git(repo, 'checkout', '--', 'terminal/src/app/a.mjs');
  // On another branch: not touched.
  git(repo, 'checkout', '-q', 'other');
  expect((await bringIn(repo)).why).toContain('the branch other');
  git(repo, 'checkout', '-q', 'main');
  // Clean: main moves to the pushed commit.
  expect(await bringIn(repo)).toEqual({ ok: true });
  expect(git(repo, 'rev-parse', 'main')).toBe(pushed);
});

function trustedProject() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'bonsai-update-app-')));
  const cwd = join(base, 'demo-project');
  cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
  mkdirSync(join(base, 'home'), { recursive: true });
  writeFileSync(join(base, 'home', 'trust.json'), JSON.stringify({ [cwd]: new Date().toISOString() }));
  return { base, cwd };
}

test('/update without the launcher (run from the source): up to date says so; an update says to start again', async () => {
  const repo = makeRepo();
  const { base, cwd } = trustedProject();
  const fake = await startFakeServer([{ text: 'Hello.' }]);
  const t = openTerm({ cwd, env: { BONSAI_HOME: join(base, 'home'), BONSAI_REPO: repo, BONSAI_UPDATE_EVERY: '300', BONSAI_RESTART_FILE: '' }, args: ['--url', fake.url, '--no-flows'] });
  try {
    await t.waitFor('? for shortcuts');
    await t.type('/update'); t.key('enter');
    await t.waitFor('Bonsai is up to date');
    commit(repo, { 'terminal/src/app/a.mjs': 'export const a = 6;\n' }, 'an update');
    await t.waitFor('↻ Update available · /update to use it', 10_000);
    await t.type('/update'); t.key('enter');
    await t.waitFor('quit and start it again');
  } finally { await t.close(); await fake.close(); }
}, 60_000);

// The whole path as you use it: the real launcher script, a repo made from
// this working tree (so the launcher builds this code), the compiled app.
test('/update through the bonsai launcher: rebuilt, restarted in the same window, conversation back, every key arrives', async () => {
  const src = join(import.meta.dir, '..', '..');
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'bonsai-update-repo-')));
  const files = execFileSync('git', ['-C', src, 'ls-files', '--cached', '--others', '--exclude-standard', 'terminal/src', 'terminal/rules', 'terminal/app/bonsai-launcher.sh', 'models', 'package.json', 'bunfig.toml'], { encoding: 'utf8' })
    .split('\n').filter((f) => f && !/^models\/(evals|test)\//.test(f));
  for (const f of files) { mkdirSync(dirname(join(repo, f)), { recursive: true }); cpSync(join(src, f), join(repo, f)); }
  symlinkSync(join(src, 'node_modules'), join(repo, 'node_modules'));
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'this tree');
  const { base, cwd } = trustedProject();
  const launcher = join(base, 'bonsai');
  writeFileSync(launcher, readFileSync(join(src, 'terminal/app/bonsai-launcher.sh'), 'utf8').replace('__REPO__', repo));
  chmodSync(launcher, 0o755);
  const fake = await startFakeServer([{ text: 'Hello from before the update.' }, { text: 'Hello from after.' }]);
  const env = { HOME: join(base, 'user'), BONSAI_HOME: join(base, 'home'), BONSAI_UPDATE_EVERY: '300', BONSAI_REPO: '' };
  const t = openTerm({ cwd, bin: launcher, env, args: ['--url', fake.url, '--no-flows'] });
  try {
    await t.waitFor('? for shortcuts', 60_000);
    await t.type('hi'); t.key('enter');
    await t.waitFor('Hello from before the update.');
    await t.idle();
    commit(repo, { 'terminal/src/app/commands.mjs': `${readFileSync(join(repo, 'terminal/src/app/commands.mjs'), 'utf8')}// an update\n` }, 'an update');
    await t.waitFor('↻ Update available · /update to use it', 10_000);
    const before = t.raw().length;
    await t.type('/update'); t.key('enter');
    await t.waitFor('resumed: hi', 60_000);
    await t.idle(600, 10_000);
    const after = t.raw().subarray(before).toString();
    expect(after).toContain('Bonsai updated from'); // the launcher rebuilt it
    const screen = await t.screen();
    expect(screen).toContain('Hello from before the update.');
    expect(screen).not.toContain('Update available');
    // No old window left reading keys: every character arrives.
    await t.type('abcdefghijklmnop', 25);
    await new Promise((r) => setTimeout(r, 400));
    expect(await t.screen()).toContain('> abcdefghijklmnop');
    for (let i = 0; i < 16; i++) t.key('backspace');
    await t.type('again'); t.key('enter');
    await t.waitFor('Hello from after.');
    const ps = execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8' }).split('\n').filter((l) => l.startsWith(join(env.HOME, '.bonsai-code/app/bonsai')));
    expect(ps.length).toBe(1); // one app, not a chain of them
  } finally { await t.close(); await fake.close(); }
}, 120_000);
