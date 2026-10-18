// "Update available" in the lower right: a commit on main that changes
// Agentic Coder's code while it runs lights the badge; docs-only commits, code that
// was already built in, and pushes not yet in this folder are told apart.
// /update restarts the app on the new code with the conversation kept.
import { test, expect } from 'bun:test';
import { needs } from './needs.mjs';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, utimesSync, readFileSync, symlinkSync, chmodSync, realpathSync, statSync, lstatSync, existsSync, rmSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isAppCode, checkUpdate, updateText, bringIn, fetchMain, isSafeRemote, plain, runGit, leaveRestart, folderArgs, withStartFolder, refreshLauncher, notOnMain, versionText } from '../src/app/update.mjs';
import { runCommand } from '../src/tools/run.mjs';
import { startFakeServer } from './fake-server.mjs';
import { openTerm } from './term.mjs';

const git = (repo, ...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
function put(repo, path, text) { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), text); }
function commit(repo, files, msg) { for (const [p, t] of Object.entries(files)) put(repo, p, t); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', msg); return git(repo, 'rev-parse', 'HEAD'); }
function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'agentic-update-'));
  git(repo, 'init', '-q', '-b', 'main');
  commit(repo, { 'terminal/src/cli.jsx': '// app\n', 'terminal/src/app/a.mjs': 'export const a = 1;\n', 'agentic-coder DOCS/x.html': '<p>x</p>' }, 'start');
  return repo;
}
const heads = (repo) => ({ main: git(repo, 'rev-parse', 'main'), origin: null });

test('the file list matches the launcher: code counts, docs, tests, results and READMEs do not', () => {
  const yes = ['terminal/src/app/App.jsx', 'terminal/src/app/help.html', 'terminal/rules/bug-fixing.md', 'models/index.mjs', 'models/bonsai-2-27b/model.mjs', 'models/evals/record.mjs', 'models/evals/run-tests.mjs', 'package.json',
    // The arena's own files are in the app too (the hub's Test builder runs them); its sets' practice projects are not.
    'models/evals/battle/store.mjs', 'models/evals/battle/builder.mjs', 'models/evals/battle/checks.mjs', 'models/evals/battle/suggest.mjs',
    // What the app reads in as text or from its copy of main (18 Oct 2026): the test prompts, a font, the Swift media
    // helper, the MLX server script, and the package files a build installs from.
    'models/evals/prompts.mjs', 'terminal/src/morning/fraunces-600.woff2.b64.txt', 'terminal/src/tools/media-tool.swift', 'models/runtime/mlx/mlx-server.py', 'patches/ink@7.1.1.patch', 'bun.lock', 'bunfig.toml'];
  const no = ['models/evals/battle/work28/w01-roll/project/roll.mjs', 'models/evals/battle/new28/n01-x/solution/a.mjs', 'models/evals/battle/arena.html', 'models/evals/battle/practice28.json',
    'docs/README.md', 'agentic-coder DOCS/a.html', 'terminal/test/app.test.mjs', 'models/evals/bench/run.mjs', 'models/bonsai-2-27b/results/r.json', 'models/README.md', 'terminal/README.md', 'terminal/scripts/demo/spin.jsx', 'models/runtime/engine/x.patch', 'terminal/app/agentic-coder-launcher.sh'];
  for (const p of yes) expect([p, isAppCode(p)]).toEqual([p, true]);
  for (const p of no) expect([p, isAppCode(p)]).toEqual([p, false]);
  // The launcher's own rule (app_code_between's awk), run on the same paths: the same answer for each.
  const launcher = readFileSync(join(import.meta.dir, '..', 'app', 'agentic-coder-launcher.sh'), 'utf8');
  const prog = /^app_code_between\(\) \{\n.*\| awk '([\s\S]*?)'\n\}/m.exec(launcher)?.[1];
  expect(prog).toBeTruthy();
  for (const p of [...yes, ...no]) expect([p, execFileSync('awk', [prog], { input: `${p}\n`, encoding: 'utf8' }).trim() === p]).toEqual([p, isAppCode(p)]);
});

test('a code commit on main after the start lights the badge; a docs-only commit does not', async () => {
  const repo = makeRepo();
  const start = heads(repo);
  const built = Date.now() - 1000;
  commit(repo, { 'agentic-coder DOCS/y.html': '<p>y</p>' }, 'docs only');
  expect(await checkUpdate(repo, start, built)).toBeNull();
  commit(repo, { 'terminal/src/app/a.mjs': 'export const a = 2;\n' }, 'code');
  const u = await checkUpdate(repo, start, built);
  expect(u?.kind).toBe('ready');
  expect(updateText(u)).toBe('Update available · /update to use it');
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
  expect(updateText(u)).toBe('Update on GitHub · /update to get it');
  git(repo, 'merge', '-q', '--ff-only', 'other'); // pulled: now it is a plain restart
  expect((await checkUpdate(repo, start, Date.now() - 60_000))?.kind).toBe('ready');
});

// Main, always (18 Oct 2026): the app is built from GitHub's main only, and the launcher says from which commit
// (AGENTIC_BUILT_COMMIT). The badge counts from that commit on GitHub's main; the folder's own commits do not count.
test("main, always: the badge lights for app code on GitHub's main past the built commit, not for the folder's own commits", async () => {
  const repo = makeRepo();
  const built = git(repo, 'rev-parse', 'main');
  git(repo, 'update-ref', 'refs/remotes/origin/main', built);
  commit(repo, { 'terminal/src/app/a.mjs': 'export const a = "mine";\n' }, 'mine, not pushed');
  expect(await checkUpdate(repo, { main: built }, Date.now(), built)).toBeNull();
  // Pages only, on GitHub's main: nothing new in the app.
  git(repo, 'checkout', '-q', '-b', 'gh', built);
  const docs = commit(repo, { 'agentic-coder DOCS/y.html': '<p>y</p>' }, 'docs');
  git(repo, 'update-ref', 'refs/remotes/origin/main', docs);
  expect(await checkUpdate(repo, { main: built }, Date.now(), built)).toBeNull();
  // The app's code, on GitHub's main: an update, whatever the folder's main has.
  const code = commit(repo, { 'models/index.mjs': 'export {};\n' }, 'code');
  git(repo, 'update-ref', 'refs/remotes/origin/main', code);
  const u = await checkUpdate(repo, { main: built }, Date.now(), built);
  expect(u).toEqual({ kind: 'ready', files: 1, commit: code });
  expect(updateText(u)).toBe('Update available · /update to use it');
  expect(await checkUpdate(repo, { main: built }, Date.now(), code)).toBeNull(); // built from it already
  // A repo with no GitHub: its own main is what the launcher builds.
  git(repo, 'update-ref', '-d', 'refs/remotes/origin/main');
  git(repo, 'checkout', '-q', 'main');
  expect((await checkUpdate(repo, { main: built }, Date.now(), built))?.commit).toBe(git(repo, 'rev-parse', 'main'));
});

test("what the folder has of the app's code and GitHub's main does not: changed, new, or committed and not pushed", async () => {
  const repo = makeRepo();
  git(repo, 'update-ref', 'refs/remotes/origin/main', git(repo, 'rev-parse', 'main'));
  expect(await notOnMain(repo)).toEqual([]);
  put(repo, 'terminal/src/app/a.mjs', 'export const a = "mine";\n');
  put(repo, 'terminal/src/app/new.mjs', 'export {};\n');
  put(repo, 'agentic-coder DOCS/z.html', '<p>z</p>'); // not the app's code
  put(repo, 'terminal/test/t.test.mjs', ''); // nor a test
  expect((await notOnMain(repo)).sort()).toEqual(['terminal/src/app/a.mjs', 'terminal/src/app/new.mjs']);
  expect(await notOnMain(repo, ['terminal/src/app/new.mjs', 'models/x.mjs'])).toEqual(['terminal/src/app/new.mjs']);
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'mine');
  expect((await notOnMain(repo)).sort()).toEqual(['terminal/src/app/a.mjs', 'terminal/src/app/new.mjs']); // committed, not pushed
  git(repo, 'update-ref', 'refs/remotes/origin/main', git(repo, 'rev-parse', 'HEAD'));
  expect(await notOnMain(repo)).toEqual([]); // pushed
  rmSync(join(repo, 'terminal/src/app/a.mjs'));
  expect(await notOnMain(repo)).toEqual(['terminal/src/app/a.mjs']); // deleted here, still on main
});

test("another Mac's version, put against GitHub's main as this Mac knows it", async () => {
  const repo = makeRepo();
  const first = git(repo, 'rev-parse', 'main');
  const docs = commit(repo, { 'agentic-coder DOCS/y.html': '<p>y</p>' }, 'docs');
  const code = commit(repo, { 'terminal/src/app/a.mjs': 'export const a = 2;\n' }, 'code');
  git(repo, 'update-ref', 'refs/remotes/origin/main', code);
  const s = (c) => c.slice(0, 7);
  expect(await versionText(code, repo)).toBe(`GitHub's main (${s(code)})`);
  expect(await versionText(first, repo)).toBe(`${s(first)}, behind GitHub's main (${s(code)}): it updates at its next start`);
  git(repo, 'update-ref', 'refs/remotes/origin/main', docs);
  expect(await versionText(first, repo)).toBe(`GitHub's main (${s(first)}, the same app as ${s(docs)})`); // only pages since
  expect(await versionText(code, repo)).toBe(`${s(code)}, newer than the main this Mac has seen`);
  expect(await versionText('f'.repeat(40), repo)).toBe('fffffff, newer than the main this Mac has seen'); // not fetched here yet
  git(repo, 'checkout', '-q', '-b', 'side', first);
  const side = commit(repo, { 'models/index.mjs': 'export {};\n' }, 'not on main');
  expect(await versionText(side, repo)).toBe(`${s(side)}, not on GitHub's main`);
  expect(await versionText(null, repo)).toBe('an older Agentic Coder (no version)');
});

test.skipIf(needs('python3'))('the real app shows the badge in the lower right when a code commit lands while it runs', async () => {
  const repo = makeRepo();
  const base = mkdtempSync(join(tmpdir(), 'agentic-update-app-'));
  const cwd = join(base, 'demo-project');
  cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
  mkdirSync(join(base, 'home'), { recursive: true });
  writeFileSync(join(base, 'home', 'trust.json'), JSON.stringify({ [cwd]: new Date().toISOString() }));
  const fake = await startFakeServer([{ text: 'Hello.' }]);
  const t = openTerm({ cwd, env: { AGENTIC_HOME: join(base, 'home'), AGENTIC_REPO: repo, AGENTIC_UPDATE_EVERY: '300' }, args: ['--url', fake.url, '--no-flows'] });
  try {
    await t.waitFor('? for shortcuts');
    await new Promise((r) => setTimeout(r, 700));
    expect(await t.screen()).not.toContain('Update available');
    commit(repo, { 'terminal/src/app/a.mjs': 'export const a = 4;\n' }, 'an update');
    await t.waitFor('Update available · /update to use it', 10_000);
    const lines = (await t.screen()).split('\n');
    const footer = lines.find((l) => l.includes('Update available'));
    expect(footer).toContain('? for shortcuts'); // the footer line, right side
    expect(footer.trimEnd().length).toBeGreaterThan(155 - 4);
  } finally { await t.close(); await fake.close(); }
}, 60_000);

test('/update brings a GitHub-only update into main only when git can fast-forward cleanly', async () => {
  const repo = makeRepo();
  git(repo, 'remote', 'add', 'origin', repo); // a folder on this Mac: a safe origin
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
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-update-app-')));
  const cwd = join(base, 'demo-project');
  cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
  mkdirSync(join(base, 'home'), { recursive: true });
  writeFileSync(join(base, 'home', 'trust.json'), JSON.stringify({ [cwd]: new Date().toISOString() }));
  return { base, cwd };
}

test.skipIf(needs('python3'))('/update without the launcher (run from the source): up to date says so; an update says to start again', async () => {
  const repo = makeRepo();
  const { base, cwd } = trustedProject();
  const fake = await startFakeServer([{ text: 'Hello.' }]);
  const t = openTerm({ cwd, env: { AGENTIC_HOME: join(base, 'home'), AGENTIC_REPO: repo, AGENTIC_UPDATE_EVERY: '300', AGENTIC_RESTART_FILE: '' }, args: ['--url', fake.url, '--no-flows'] });
  try {
    await t.waitFor('? for shortcuts');
    await t.type('/update'); t.key('enter');
    await t.waitFor('Agentic Coder is up to date');
    commit(repo, { 'terminal/src/app/a.mjs': 'export const a = 6;\n' }, 'an update');
    await t.waitFor('Update available · /update to use it', 10_000);
    await t.type('/update'); t.key('enter');
    await t.waitFor('quit and start it again');
  } finally { await t.close(); await fake.close(); }
}, 60_000);

// Main, always (18 Oct 2026): run by the coding command, the app knows the commit of main it was built from.
test.skipIf(needs('python3'))("/update in an app built from main: up to date names that main and what the folder has that main does not; a push lights the badge", async () => {
  const repo = makeRepo();
  const built = git(repo, 'rev-parse', 'main');
  git(repo, 'update-ref', 'refs/remotes/origin/main', built);
  put(repo, 'terminal/src/app/a.mjs', 'export const a = "mine";\n');
  const { base, cwd } = trustedProject();
  const fake = await startFakeServer([{ text: 'Hello.' }]);
  const t = openTerm({ cwd, env: { AGENTIC_HOME: join(base, 'home'), AGENTIC_REPO: repo, AGENTIC_BUILT_COMMIT: built, AGENTIC_UPDATE_EVERY: '300', AGENTIC_FETCH_EVERY: '0', AGENTIC_RESTART_FILE: '' }, args: ['--url', fake.url, '--no-flows'] });
  try {
    await t.waitFor('? for shortcuts');
    await t.type('/update'); t.key('enter');
    await t.waitFor(`it runs GitHub's main (${built.slice(0, 7)})`);
    await t.waitFor('a.mjs is changed in the folder');
    expect(await t.screen()).not.toContain('Update available');
    // Pushed to GitHub's main from elsewhere (the folder's main stays where it is): an update.
    git(repo, 'checkout', '-q', '-b', 'gh', built);
    git(repo, 'update-ref', 'refs/remotes/origin/main', commit(repo, { 'models/index.mjs': 'export {};\n' }, 'pushed'));
    await t.waitFor('Update available · /update to use it', 10_000);
    await t.type('/update'); t.key('enter');
    await t.waitFor('quit and start it again');
  } finally { await t.close(); await fake.close(); }
}, 60_000);

// A repo made from this working tree, so a launcher pointed at it builds this code.
function thisTree() {
  const src = join(import.meta.dir, '..', '..');
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-update-repo-')));
  const files = execFileSync('git', ['-C', src, 'ls-files', '--cached', '--others', '--exclude-standard', 'terminal/src', 'terminal/rules', 'terminal/app/agentic-coder-launcher.sh', 'models', 'package.json', 'bunfig.toml', 'patches'], { encoding: 'utf8' })
    .split('\n').filter(Boolean); // models/ whole: the app imports from evals/ too (the test record)
  for (const f of files) { mkdirSync(dirname(join(repo, f)), { recursive: true }); cpSync(join(src, f), join(repo, f)); }
  symlinkSync(join(src, 'node_modules'), join(repo, 'node_modules'));
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'this tree');
  return { src, repo };
}
// The whole path as you use it: the real launcher script, a repo made from
// this working tree (so the launcher builds this code), the compiled app.
// keeper: the app runs inside a keeper (sessions.mjs), the way a window really runs it since 3 Oct 2026;
// the keeper starts the app through the launcher, so /update restarts it there and the window only
// keeps showing it. Without it the app runs in the window itself (AGENTIC_SESSIONS=off in the tests).
async function updateThroughLauncher({ keeper = false } = {}) {
  const { src, repo } = thisTree();
  const { base, cwd } = trustedProject();
  const launcher = join(base, 'coding');
  writeFileSync(launcher, readFileSync(join(src, 'terminal/app/agentic-coder-launcher.sh'), 'utf8').replace('__REPO__', repo));
  chmodSync(launcher, 0o755);
  const fake = await startFakeServer([{ text: 'Hello from before the update.' }, { text: 'Hello from after.' }]);
  const env = { HOME: join(base, 'user'), AGENTIC_HOME: join(base, 'home'), AGENTIC_UPDATE_EVERY: '300', AGENTIC_REPO: '', ...(keeper ? { AGENTIC_SESSIONS: 'on' } : {}) };
  const t = openTerm({ cwd, bin: launcher, env, args: ['--url', fake.url, '--no-flows'] });
  try {
    await t.waitFor('? for shortcuts', 60_000);
    await t.type('hi'); t.key('enter');
    await t.waitFor('Hello from before the update.');
    await t.idle();
    commit(repo, { 'terminal/src/app/commands.mjs': `${readFileSync(join(repo, 'terminal/src/app/commands.mjs'), 'utf8')}// an update\n` }, 'an update');
    await t.waitFor('Update available · /update to use it', 10_000);
    const before = t.raw().length;
    await t.type('/update'); t.key('enter');
    await t.waitFor('resumed: hi', 60_000);
    await t.idle(600, 10_000);
    const after = t.raw().subarray(before).toString();
    expect(after).toContain('Agentic Coder updated to main ('); // the launcher built the new main
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
    const ps = execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8' }).split('\n').filter((l) => l.startsWith(join(env.HOME, '.agentic-coder/app/agentic-coder')));
    if (!keeper) expect(ps.length).toBe(1); // one app, not a chain of them
    // In a keeper: the window, its keeper, and one app in it (the new one), not a chain of apps.
    else expect([ps.filter((l) => / session-host$/.test(l.trim())).length, ps.length]).toEqual([1, 3]);
  } finally { await t.close(); await fake.close(); }
}

test.skipIf(needs('python3'))('/update through the coding launcher: rebuilt, restarted in the same window, conversation back, every key arrives', () => updateThroughLauncher(), 120_000);

const { canHost } = await import('../src/app/sessions.mjs');
test.skipIf(needs('python3') || !canHost())('/update through the keeper: the app restarts inside it, the window keeps showing it, conversation back, every key arrives', () => updateThroughLauncher({ keeper: true }), 150_000);

// 18 Oct 2026: bun build writes the NODE_ENV it runs with into the app. The real app, rebuilt by a launcher that a test
// had started (NODE_ENV=test), made a throwaway home at every start, so `coding` never found its window and opened in
// the terminal. This launcher is started from the tests too, so with NODE_ENV=test.
test('built by a launcher started from the tests, the app still keeps its home in HOME: coding window finds the window there', () => {
  expect(process.env.NODE_ENV).toBe('test');
  const { src, repo } = thisTree();
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ac-env-')));
  const user = join(base, 'user');
  const launcher = join(base, 'coding');
  writeFileSync(launcher, readFileSync(join(src, 'terminal/app/agentic-coder-launcher.sh'), 'utf8').replace('__REPO__', repo));
  chmodSync(launcher, 0o755);
  const built = Bun.spawnSync(['/bin/sh', launcher, '--version'], { env: { ...process.env, HOME: user, AGENTIC_REPO: '', AGENTIC_NO_PULL: '1' } });
  expect(`${built.stderr}`).toContain('Agentic Coder updated to main (');
  // A stand-in for the window `bun run window` builds, in the home the app should use: it notes how it was opened.
  const win = join(user, '.agentic-coder', 'build', 'window-target', 'release', 'agentic-coder-window');
  const said = join(base, 'window-said');
  mkdirSync(dirname(win), { recursive: true });
  writeFileSync(win, `#!/bin/sh\necho "$@" > '${said}'\n`);
  chmodSync(win, 0o755);
  // As a Terminal starts it: that HOME, no AGENTIC_HOME, no NODE_ENV.
  const env = { ...process.env, HOME: user };
  for (const k of ['AGENTIC_HOME', 'AGENTIC_TEST_HOME', 'AGENTIC_WINDOW_APP', 'NODE_ENV']) delete env[k];
  const r = Bun.spawnSync([join(user, '.agentic-coder', 'app', 'agentic-coder'), 'window', '--folder', base], { env, timeout: 30_000 });
  expect(`${r.stderr}`).not.toContain('not built yet');
  expect(existsSync(said) ? readFileSync(said, 'utf8') : '').toContain('--url http://127.0.0.1:');
}, 90_000);

// ── The GitHub check (git fetch) and what keeps it safe ─────────────────────

// A stand-in GitHub: a bare repo; `local` is Agentic Coder's folder (a clone of it),
// `other` is another machine pushing to it.
function github() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-gh-')));
  const hub = join(root, 'hub.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', hub]);
  const seed = join(root, 'seed');
  execFileSync('git', ['clone', '-q', hub, seed], { stdio: 'ignore' });
  commit(seed, { 'terminal/src/cli.jsx': '// app\n', 'terminal/src/app/a.mjs': 'export const a = 1;\n' }, 'start');
  git(seed, 'push', '-q', 'origin', 'main');
  const local = join(root, 'local');
  const other = join(root, 'other');
  execFileSync('git', ['clone', '-q', hub, local], { stdio: 'ignore' });
  execFileSync('git', ['clone', '-q', hub, other], { stdio: 'ignore' });
  return { hub, local, other };
}

test('only https, ssh or a folder on this Mac count as a safe place to update from', () => {
  for (const u of ['https://github.com/BuzzScud/Local-Agent-1.git', 'ssh://git@github.com/o/r.git', 'git@github.com:o/r.git', '/Users/me/hub.git', 'file:///Users/me/hub.git'])
    expect([u, isSafeRemote(u)]).toEqual([u, true]);
  for (const u of ['http://github.com/o/r.git', 'git://github.com/o/r.git', 'ext::sh -c touch% /tmp/pwned', 'fd::3', '-oProxyCommand=x@h:p', 'git@github.com:-oops', 'https://a b', '', null])
    expect([u, isSafeRemote(u)]).toEqual([u, false]);
});

test('the fetch moves only refs/remotes/origin/main: no branch of yours, no tags, no FETCH_HEAD, nothing in the folder', async () => {
  const { local, other } = github();
  const mainBefore = git(local, 'rev-parse', 'main');
  const pushed = commit(other, { 'terminal/src/app/a.mjs': 'export const a = 2;\n' }, 'pushed elsewhere');
  git(other, 'tag', 'v9'); git(other, 'push', '-q', 'origin', 'main', 'v9');
  // A setting that would map GitHub's main onto a branch of yours: --refmap= ignores it.
  git(local, 'config', '--add', 'remote.origin.fetch', '+refs/heads/main:refs/heads/victim');
  expect((await fetchMain(local)).ok).toBe(true);
  expect(git(local, 'rev-parse', 'refs/remotes/origin/main')).toBe(pushed);
  expect(git(local, 'rev-parse', 'main')).toBe(mainBefore);
  expect(git(local, 'branch', '--list', 'victim')).toBe('');
  expect(git(local, 'tag', '--list')).toBe('');
  expect(existsSync(join(local, '.git', 'FETCH_HEAD'))).toBe(false);
  expect(readFileSync(join(local, 'terminal/src/app/a.mjs'), 'utf8')).toBe('export const a = 1;\n');
  expect((await checkUpdate(local, { main: mainBefore }, Date.now()))?.kind).toBe('pull');
});

test('an http:// or git:// origin is never fetched from or brought in', async () => {
  const { local, other } = github();
  commit(other, { 'terminal/src/app/a.mjs': 'export const a = 3;\n' }, 'x'); git(other, 'push', '-q', 'origin', 'main');
  const before = git(local, 'rev-parse', 'refs/remotes/origin/main');
  for (const url of ['http://127.0.0.1:9/hub.git', 'git://127.0.0.1:9/hub.git']) {
    git(local, 'remote', 'set-url', 'origin', url);
    const f = await fetchMain(local);
    expect(f.ok).toBe(false);
    expect(f.why).toContain('not an https or ssh address');
    expect((await bringIn(local)).why).toContain('not an https or ssh address');
  }
  expect(git(local, 'rev-parse', 'refs/remotes/origin/main')).toBe(before);
});

test.skipIf(needs('python3'))('git runs without a terminal: nothing it starts can open /dev/tty to ask for a password', async () => {
  // Run inside a real pty, so the direct run below does have a terminal to open.
  const repo = makeRepo();
  const probe = join(mkdtempSync(join(tmpdir(), 'agentic-tty-')), 'probe.mjs');
  const alias = ['-c', 'alias.ttycheck=!sh -c "(exec 3</dev/tty) 2>/dev/null && echo HAS-TTY || echo NO-TTY"', 'ttycheck'];
  writeFileSync(probe, `import { runGit } from ${JSON.stringify(join(import.meta.dir, '../src/app/update.mjs'))};
import { execFileSync } from 'node:child_process';
const direct = execFileSync('git', ['-C', ${JSON.stringify(repo)}, ...${JSON.stringify(alias)}], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] }).trim();
const r = await runGit(${JSON.stringify(repo)}, ${JSON.stringify(alias)});
console.log('direct=' + direct + ' runGit=' + r.out);`);
  const t = openTerm({ cwd: repo, bin: process.execPath, args: [probe], cols: 100, rows: 10 });
  try {
    await t.waitFor(/runGit=\w/, 15_000);
    const line = (await t.screen()).split('\n').find((l) => l.includes('runGit='));
    expect(line).toContain('direct=HAS-TTY'); // the probe works: a plain child can reach the terminal
    expect(line).toContain('runGit=NO-TTY'); // Agentic Coder's git calls cannot
  } finally { await t.close(); }
}, 30_000);

test("git's words on screen carry no control characters", () => {
  expect(plain('error: Your local changes to \x1b[31mred\x1b[0m\u009b2J would be overwritten\nsecond')).toBe('Your local changes to [31mred[0m2J would be overwritten');
  expect(plain('')).toBe('');
});

test('the restart file is written fresh for you only; a link planted in its place is removed, not followed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-restart-'));
  const target = join(dir, 'precious.txt');
  writeFileSync(target, 'keep me\n');
  const file = join(dir, 'restart.123');
  symlinkSync(target, file);
  const keep = process.env.AGENTIC_RESTART_FILE;
  try {
    process.env.AGENTIC_RESTART_FILE = file;
    leaveRestart(['--resume', 'abc', '--url', 'http://127.0.0.1:1\nevil']);
  } finally { if (keep === undefined) delete process.env.AGENTIC_RESTART_FILE; else process.env.AGENTIC_RESTART_FILE = keep; }
  expect(readFileSync(target, 'utf8')).toBe('keep me\n');
  expect(lstatSync(file).isSymbolicLink()).toBe(false);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(readFileSync(file, 'utf8')).toBe('--resume\nabc\n--url\nhttp://127.0.0.1:1 evil\n');
});

test("commands Agentic Coder runs do not see where the restart file goes", async () => {
  const keep = process.env.AGENTIC_RESTART_FILE;
  process.env.AGENTIC_RESTART_FILE = '/tmp/x';
  try {
    const r = await runCommand('echo "now=${AGENTIC_RESTART_FILE:-none}"', { cwd: tmpdir(), sandbox: false });
    expect(r.output ?? r.lines?.join('\n') ?? String(r)).toContain('now=none');
  } finally {
    if (keep === undefined) delete process.env.AGENTIC_RESTART_FILE; else process.env.AGENTIC_RESTART_FILE = keep;
  }
});

test.skipIf(needs('python3'))('the real app asks GitHub on its own: a push from another machine lights "Update on GitHub", and /update brings it in', async () => {
  const { local, other } = github();
  const { base, cwd } = trustedProject();
  const fake = await startFakeServer([{ text: 'Hello.' }]);
  const t = openTerm({ cwd, env: { AGENTIC_HOME: join(base, 'home'), AGENTIC_REPO: local, AGENTIC_UPDATE_EVERY: '300', AGENTIC_FETCH_EVERY: '400', AGENTIC_RESTART_FILE: '' }, args: ['--url', fake.url, '--no-flows'] });
  try {
    await t.waitFor('? for shortcuts');
    await new Promise((r) => setTimeout(r, 900));
    expect(await t.screen()).not.toContain('Update');
    const pushed = commit(other, { 'models/index.mjs': 'export {};\n' }, 'pushed from another machine');
    git(other, 'push', '-q', 'origin', 'main');
    await t.waitFor('Update on GitHub · /update to get it', 10_000);
    await t.type('/update'); t.key('enter');
    await t.waitFor('The update is in the repo now', 15_000);
    expect(git(local, 'rev-parse', 'main')).toBe(pushed);
  } finally { await t.close(); await fake.close(); }
}, 60_000);

// ── coding builds GitHub's main when it starts (the launcher) ─────────────────

// The real launcher on a clone of a stand-in GitHub, with a stand-in `bun` first on PATH: its build writes a
// stand-in app (a script that says it ran) that keeps what it was built from (terminal/src/app/a.mjs of the
// folder it was built in, and whether b.mjs was there), so a test sees which code the app is. The app starts
// out built from the clone's main and stamped so (agentic-coder.commit), as the launcher leaves it. Answers
// what it printed, the app and the launcher.
const BUN_VERSION = execFileSync(process.execPath, ['--version'], { encoding: 'utf8' }).trim();
const LAUNCHER = readFileSync(join(import.meta.dir, '..', 'app', 'agentic-coder-launcher.sh'), 'utf8');
const STAND_IN_APP = (from) => `#!/bin/sh\n# built from: ${from}\necho "APP RAN $*"\n`;
function launcherOn(local, { built = true } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-pull-')));
  const user = join(base, 'user');
  const app = join(user, '.agentic-coder', 'app', 'agentic-coder');
  const bin = join(base, 'bin');
  const log = join(base, 'bun.log');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'bun'), `#!/bin/sh
case "$1" in
  --version) echo '${BUN_VERSION}' ;;
  -e) exit 0 ;;
  install) mkdir -p node_modules; echo "install in $(pwd)" >> '${log}' ;;
  build)
    a="$(cat terminal/src/app/a.mjs 2>/dev/null | tr -d '\\n')"
    if [ -f terminal/src/app/b.mjs ]; then b=", with b.mjs"; else b=""; fi
    case "$a" in *BREAK*) echo "error: it does not build" >&2; exit 1 ;; esac
    while [ $# -gt 0 ]; do [ "$1" = --outfile ] && out="$2"; shift; done
    printf '#!/bin/sh\\n# built from: %s\\necho "APP RAN $*"\\n' "$a$b" > "$out"
    echo "build in $(pwd) (NODE_ENV=\${NODE_ENV:-none})" >> '${log}' ;;
esac
`);
  chmodSync(join(bin, 'bun'), 0o755);
  if (built) {
    mkdirSync(dirname(app), { recursive: true });
    mkdirSync(join(user, '.agentic-coder', 'build', 'main'), { recursive: true });
    writeFileSync(app, STAND_IN_APP(readFileSync(join(local, 'terminal/src/app/a.mjs'), 'utf8').trim()));
    chmodSync(app, 0o755);
    writeFileSync(`${app}.bun`, BUN_VERSION);
    writeFileSync(`${app}.commit`, git(local, 'rev-parse', 'refs/remotes/origin/main'));
  }
  const launcher = join(base, 'coding');
  writeFileSync(launcher, LAUNCHER.replace('__REPO__', local));
  chmodSync(launcher, 0o755);
  const run = (env = {}) => {
    const r = Bun.spawnSync(['/bin/sh', launcher, 'x'], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: user, AGENTIC_HOME: '', AGENTIC_REPO: '', AGENTIC_PULL_WAIT: '8', ...env } });
    return { code: r.exitCode, out: `${r.stdout}${r.stderr}` };
  };
  const builtFrom = () => /^# built from: (.*)$/m.exec(readFileSync(app, 'utf8'))?.[1];
  const bunDid = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');
  return { launcher, run, app, user, bin, builtFrom, bunDid };
}

test('coding pulls a push from another Mac before it starts, and says so', () => {
  const { local, other } = github();
  const pushed = commit(other, { 'docs/note.html': '<p>new</p>' }, 'pushed elsewhere');
  git(other, 'push', '-q', 'origin', 'main');
  const r = launcherOn(local).run();
  expect(r.out).toContain('Pulled 1 update from GitHub');
  expect(r.out).toContain('APP RAN x');
  expect(r.code).toBe(0);
  expect(git(local, 'rev-parse', 'main')).toBe(pushed);
  // Up to date: nothing said, it just starts.
  const again = launcherOn(local).run();
  expect(again.out.trim()).toBe('APP RAN x');
});

// 18 Oct 2026, the owner's pick ("main, always"): the app is built from a clean copy of GitHub's main, never from
// the folder: a change in the folder, committed or not, is in the app only once it is pushed.
test("coding builds the app from GitHub's main only: the folder's own changes and commits are not in it", () => {
  const { local, other } = github();
  const c = launcherOn(local);
  const pushed = commit(other, { 'terminal/src/app/a.mjs': 'export const a = "main";\n' }, 'pushed elsewhere');
  git(other, 'push', '-q', 'origin', 'main');
  commit(local, { 'terminal/src/app/b.mjs': 'export const b = "only here";\n' }, 'a commit of the folder, not pushed');
  put(local, 'terminal/src/app/a.mjs', 'export const a = "edited here";\n');
  const r = c.run();
  expect(r.out).toContain('both have new commits'); // the folder is left as it is
  expect(r.out).toContain(`Agentic Coder updated to main (${pushed.slice(0, 7)})`);
  expect(r.out).toContain('APP RAN x');
  expect(c.builtFrom()).toBe('export const a = "main";'); // GitHub's a.mjs, and no b.mjs
  expect(readFileSync(`${c.app}.commit`, 'utf8')).toBe(pushed);
  expect(c.bunDid()).toContain(`build in ${join(c.user, '.agentic-coder', 'build', 'main.new.')}`);
  expect(c.bunDid()).toContain('(NODE_ENV=none)');
  expect(readFileSync(join(c.user, '.agentic-coder', 'build', 'main', 'terminal/src/app/a.mjs'), 'utf8')).toBe('export const a = "main";\n');
  expect(existsSync(join(c.user, '.agentic-coder', 'build', 'main', 'terminal/src/app/b.mjs'))).toBe(false);
  expect(readFileSync(join(local, 'terminal/src/app/a.mjs'), 'utf8')).toBe('export const a = "edited here";\n');
  // Started again with nothing new on GitHub: no build (the folder still has its own commit, and is told so).
  const before = c.bunDid();
  const again = c.run();
  expect(again.out).toContain('APP RAN x');
  expect(again.out).not.toContain('Agentic Coder updated');
  expect(c.bunDid()).toBe(before);
});

test('coding never pulls over a file you changed, a branch, or with AGENTIC_NO_PULL; the app still starts', () => {
  const { local, other } = github();
  const before = git(local, 'rev-parse', 'main');
  commit(other, { 'terminal/src/app/a.mjs': 'export const a = 9;\n' }, 'pushed elsewhere');
  git(other, 'push', '-q', 'origin', 'main');
  const { run, builtFrom } = launcherOn(local);
  expect(run({ AGENTIC_NO_PULL: '1' }).out.trim()).toBe('APP RAN x');
  put(local, 'terminal/src/app/a.mjs', 'export const a = "mine";\n');
  const blocked = run({ AGENTIC_NO_UPDATE: '0' });
  expect(blocked.out).toContain('are in the way of GitHub\'s main');
  expect(blocked.out).toContain('APP RAN x');
  expect(builtFrom()).toBe('export const a = 9;'); // the app is GitHub's main all the same
  expect(git(local, 'rev-parse', 'main')).toBe(before);
  expect(readFileSync(join(local, 'terminal/src/app/a.mjs'), 'utf8')).toBe('export const a = "mine";\n');
  git(local, 'checkout', '-q', '-b', 'mine');
  expect(run().out.trim()).toBe('APP RAN x');
  expect(git(local, 'rev-parse', 'main')).toBe(before);
});

test('coding with GitHub out of reach, or a plain http:// origin, starts the main this Mac last saw', () => {
  const { local } = github();
  const before = git(local, 'rev-parse', 'main');
  const { run } = launcherOn(local);
  git(local, 'remote', 'set-url', 'origin', join(tmpdir(), 'no-such-hub.git'));
  const off = run();
  expect(off.out).toContain('Could not reach GitHub');
  expect(off.out).toContain('APP RAN x');
  git(local, 'remote', 'set-url', 'origin', 'http://127.0.0.1:9/hub.git');
  expect(run().out.trim()).toBe('APP RAN x'); // not asked at all
  expect(git(local, 'rev-parse', 'main')).toBe(before);
});

test('a main that does not build leaves the last good app and its stamp; an app without a stamp is built from main', () => {
  const { local, other } = github();
  const c = launcherOn(local);
  const was = readFileSync(`${c.app}.commit`, 'utf8');
  commit(other, { 'terminal/src/app/a.mjs': 'BREAK\n' }, 'a broken main');
  git(other, 'push', '-q', 'origin', 'main');
  const r = c.run();
  expect(r.out).toContain("GitHub's main did not build");
  expect(r.out).toContain('APP RAN x');
  expect(c.builtFrom()).toBe('export const a = 1;');
  expect(readFileSync(`${c.app}.commit`, 'utf8')).toBe(was);
  expect(existsSync(join(c.user, '.agentic-coder', 'build', 'main', 'terminal'))).toBe(false); // the last copy stays as it was
  // An app a launcher from before 18 Oct 2026 built from the folder has no stamp: the next start builds main,
  // even with nothing new on GitHub.
  const fresh = github();
  const d = launcherOn(fresh.local);
  rmSync(`${d.app}.commit`);
  expect(d.run().out).toContain(`Agentic Coder updated to main (${git(fresh.local, 'rev-parse', 'main').slice(0, 7)})`);
  expect(d.bunDid()).toContain('build in');
  expect(readFileSync(`${d.app}.commit`, 'utf8')).toBe(git(fresh.local, 'rev-parse', 'main'));
});

test('bun run install-cli builds and installs from main, and starts nothing (AGENTIC_BUILD_ONLY)', () => {
  const { local } = github();
  const c = launcherOn(local, { built: false });
  const r = c.run({ AGENTIC_BUILD_ONLY: '1' });
  expect(r.code).toBe(0);
  expect(r.out).toContain('Agentic Coder updated to main');
  expect(r.out).not.toContain('APP RAN');
  expect(c.builtFrom()).toBe('export const a = 1;');
  expect(readFileSync(`${c.app}.commit`, 'utf8')).toBe(git(local, 'rev-parse', 'main'));
  const pkg = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'package.json'), 'utf8')).scripts['install-cli'];
  expect(pkg).toContain('AGENTIC_BUILD_ONLY=1 ~/.local/bin/coding');
  expect(pkg).toContain('rm -f ~/.agentic-coder/app/agentic-coder.commit');
  expect(pkg).not.toContain('bun run build');
});

test("the build uses the folder's packages when main's package files are the folder's, else installs its own", () => {
  const { local, other } = github();
  commit(other, { 'package.json': '{ "name": "x" }\n', 'terminal/src/app/a.mjs': 'export const a = 2;\n' }, 'packages');
  git(other, 'push', '-q', 'origin', 'main');
  git(local, 'pull', '-q', '--ff-only');
  mkdirSync(join(local, 'node_modules'));
  const c = launcherOn(local);
  git(local, 'update-ref', 'refs/remotes/origin/main', git(local, 'rev-parse', 'HEAD~1')); // the app was built before it
  writeFileSync(`${c.app}.commit`, git(local, 'rev-parse', 'HEAD~1'));
  git(local, 'remote', 'set-url', 'origin', join(local, '..', 'hub.git'));
  c.run();
  const mods = join(c.user, '.agentic-coder', 'build', 'main', 'node_modules');
  expect(lstatSync(mods).isSymbolicLink()).toBe(true);
  expect(readlinkSync(mods)).toBe(join(local, 'node_modules'));
  expect(c.bunDid()).not.toContain('install in');
  // Main asks for other packages than the folder has: installed for the build, never in the folder.
  commit(other, { 'package.json': '{ "name": "x", "dependencies": { "y": "1" } }\n', 'terminal/src/app/a.mjs': 'export const a = 3;\n' }, 'more packages');
  git(other, 'push', '-q', 'origin', 'main');
  put(local, 'package.json', '{ "name": "x", "mine": true }\n'); // in the way of the pull: the folder keeps its own
  c.run();
  expect(c.bunDid()).toContain(`install in ${join(c.user, '.agentic-coder', 'build', 'main.new.')}`);
  expect(lstatSync(mods).isSymbolicLink()).toBe(false);
  expect(c.builtFrom()).toBe('export const a = 3;');
});

test('a new launcher on main is installed, used from the next start', () => {
  const { local, other } = github();
  commit(other, { 'terminal/app/agentic-coder-launcher.sh': `${LAUNCHER}# a newer launcher\n` }, 'new launcher');
  git(other, 'push', '-q', 'origin', 'main');
  const { launcher, run } = launcherOn(local);
  git(local, 'checkout', '-q', '-b', 'elsewhere'); // the folder's branch does not matter: main's launcher
  expect(run().out).toContain('APP RAN x');
  const now = readFileSync(launcher, 'utf8');
  expect(now).toContain('# a newer launcher');
  expect(now).toContain(`REPO="\${AGENTIC_REPO:-${local}}"`);
  expect(now).not.toContain('__REPO__');
  expect(statSync(launcher).mode & 0o111).toBeTruthy();
});

// The window (a Tauri shell, terminal/app/window) is built again from main's copy when main changed its code: in the
// background, so the start does not wait, and only on a Mac that has the window. A stand-in cargo here.
test("a window on this Mac is built again from main in the background when main changed it; a stamp says which", async () => {
  const { local, other } = github();
  const c = launcherOn(local);
  const win = join(c.user, '.agentic-coder', 'app', 'Agentic Coder Window.app');
  const exe = join(win, 'Contents', 'MacOS', 'agentic-coder-window');
  const cargo = join(dirname(c.bin), 'cargo-bin');
  mkdirSync(cargo);
  writeFileSync(join(cargo, 'cargo'), '#!/bin/sh\nmkdir -p "$CARGO_TARGET_DIR/release" && cp src/main.rs "$CARGO_TARGET_DIR/release/agentic-coder-window"\n');
  chmodSync(join(cargo, 'cargo'), 0o755);
  const sys = '/usr/bin:/bin:/usr/sbin:/sbin';
  const withRust = { PATH: `${c.bin}:${cargo}:${sys}` }, noRust = { PATH: `${c.bin}:${sys}` };
  const shell = (v) => ({ 'terminal/app/window/build.sh': readFileSync(join(import.meta.dir, '..', 'app', 'window', 'build.sh'), 'utf8'), 'terminal/app/window/icons/icon.icns': 'icns', 'terminal/app/window/src/main.rs': `// window ${v}\n` });
  commit(other, shell(1), 'the window'); git(other, 'push', '-q', 'origin', 'main');
  expect(c.run(withRust).out).not.toContain('The window is being built'); // no window on this Mac: none is made
  mkdirSync(dirname(exe), { recursive: true });
  writeFileSync(exe, '// the window from before\n');
  const r = c.run(withRust);
  expect(r.out).toContain("The window is being built from GitHub's main in the background");
  expect(r.out).toContain('APP RAN x'); // the start did not wait for it
  for (let i = 0; i < 100 && !existsSync(`${win}.tree`); i++) await new Promise((res) => setTimeout(res, 100));
  expect(readFileSync(`${win}.tree`, 'utf8')).toBe(git(local, 'rev-parse', 'refs/remotes/origin/main:terminal/app/window'));
  expect(readFileSync(exe, 'utf8')).toBe('// window 1\n');
  expect(existsSync(join(c.user, '.agentic-coder', 'build', 'window.lock'))).toBe(false);
  expect(c.run(withRust).out).not.toContain('The window is being built'); // started again: nothing to build
  // Main changes the window on a Mac without Rust: a note, and the window it has stays.
  commit(other, shell(2), 'the window, again'); git(other, 'push', '-q', 'origin', 'main');
  expect(c.run(noRust).out).toContain('building it needs Rust');
  expect(readFileSync(exe, 'utf8')).toBe('// window 1\n');
});

// 9 Oct 2026: a window moved by "Work in …? → Yes" saves its conversation under that folder; its restart came back
// where coding was typed, and --resume found nothing ("Could not open that conversation: ENOENT").
test('a restart starts in the folder the window works in now; a folder given at the start comes along only when it did not move', () => {
  expect(folderArgs('/a/project', '/home')).toEqual(['--folder', '/a/project']);
  expect(folderArgs('/home', '/home')).toEqual([]);
  // moved: its own folder, once (the start's is not put in front of it)
  expect(withStartFolder(['--resume', 'x', ...folderArgs('/b', '/a')], { folder: true, cwd: '/a' })).toEqual(['--resume', 'x', '--folder', '/b']);
  // not moved, started with --folder or a picked folder: that one
  expect(withStartFolder(['--resume', 'x'], { folder: true, cwd: '/a' })).toEqual(['--folder', '/a', '--resume', 'x']);
  expect(withStartFolder(['--resume', 'x'], { picked: true, cwd: '/p' })).toEqual(['--folder', '/p', '--resume', 'x']);
  // started where coding was typed and not moved: the launcher's own folder
  expect(withStartFolder(['--resume', 'x'], { cwd: '/home' })).toEqual(['--resume', 'x']);
});

// 10 Oct 2026: a launcher change that came in by /update, or a launcher installed before 9 Oct, was never put
// in place (only a pull at the launcher's own start replaced it); that Mac needed `bun run install-cli` by hand.
test('the app puts the repo\'s launcher in place of an old one; a link, another folder\'s launcher, or no launcher is left alone', () => {
  const repo = mkdtempSync(join(tmpdir(), 'agentic-launcher-'));
  put(repo, 'terminal/app/agentic-coder-launcher.sh', '#!/bin/sh\n# the newest launcher\nREPO="${AGENTIC_REPO:-__REPO__}"\n');
  const want = `#!/bin/sh\n# the newest launcher\nREPO="\${AGENTIC_REPO:-${repo}}"\n`;
  const bin = mkdtempSync(join(tmpdir(), 'agentic-bin-'));
  const launcher = join(bin, 'coding');
  // an old one, installed for this repo: replaced whole, still runnable
  writeFileSync(launcher, `#!/bin/sh\n# from before 9 Oct\nREPO="\${AGENTIC_REPO:-${repo}}"\n`, { mode: 0o755 });
  expect(refreshLauncher(repo, launcher)).toBe('updated');
  expect(readFileSync(launcher, 'utf8')).toBe(want);
  expect(statSync(launcher).mode & 0o111).toBeTruthy();
  expect(existsSync(`${launcher}.new`)).toBe(false);
  // the next start: nothing to do
  expect(refreshLauncher(repo, launcher)).toBe('same');
  // Main, always: the launcher of the copy of main the app was built from (AGENTIC_BUILD), not the folder's.
  const build = mkdtempSync(join(tmpdir(), 'agentic-build-'));
  put(build, 'terminal/app/agentic-coder-launcher.sh', '#!/bin/sh\n# main\'s launcher\nREPO="${AGENTIC_REPO:-__REPO__}"\n');
  expect(refreshLauncher(repo, launcher, build)).toBe('updated');
  expect(readFileSync(launcher, 'utf8')).toBe(`#!/bin/sh\n# main's launcher\nREPO="\${AGENTIC_REPO:-${repo}}"\n`);
  // installed for another folder (a worktree's): left as it is
  const other = join(bin, 'other');
  writeFileSync(other, '#!/bin/sh\nREPO="${AGENTIC_REPO:-/somewhere/else}"\n', { mode: 0o755 });
  expect(refreshLauncher(repo, other)).toBe('installed for another folder');
  expect(readFileSync(other, 'utf8')).toContain('/somewhere/else');
  // a link: never followed or replaced
  const link = join(bin, 'link');
  symlinkSync(other, link);
  expect(refreshLauncher(repo, link)).toBe('not a plain file of yours');
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  // run from the source (no launcher)
  expect(refreshLauncher(repo, null)).toBe('no launcher');
});
