// "Update available" in the lower right: a commit on main that changes
// Agentic Coder's code while it runs lights the badge; docs-only commits, code that
// was already built in, and pushes not yet in this folder are told apart.
// /update restarts the app on the new code with the conversation kept.
import { test, expect } from 'bun:test';
import { needs } from './needs.mjs';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, utimesSync, readFileSync, symlinkSync, chmodSync, realpathSync, statSync, lstatSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isAppCode, checkUpdate, updateText, bringIn, fetchMain, isSafeRemote, plain, runGit, leaveRestart } from '../src/app/update.mjs';
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
  for (const p of ['terminal/src/app/App.jsx', 'terminal/src/app/help.html', 'terminal/rules/bug-fixing.md', 'models/index.mjs', 'models/bonsai-2-27b/model.mjs', 'models/evals/record.mjs', 'models/evals/run-tests.mjs', 'package.json']) expect([p, isAppCode(p)]).toEqual([p, true]);
  // The arena's own files are in the app too (the hub's Test builder runs them); its sets' practice projects are not.
  for (const p of ['models/evals/battle/store.mjs', 'models/evals/battle/builder.mjs', 'models/evals/battle/checks.mjs', 'models/evals/battle/suggest.mjs']) expect([p, isAppCode(p)]).toEqual([p, true]);
  for (const p of ['models/evals/battle/work28/w01-roll/project/roll.mjs', 'models/evals/battle/new28/n01-x/solution/a.mjs', 'models/evals/battle/arena.html', 'models/evals/battle/practice28.json']) expect([p, isAppCode(p)]).toEqual([p, false]);
  const launcher = readFileSync(join(import.meta.dir, '..', 'app', 'agentic-coder-launcher.sh'), 'utf8');
  expect(launcher).toContain("-o \\( -path '*/models/evals/battle/*.mjs' -not -path '*/models/evals/battle/*/*' \\)");
  for (const p of ['docs/README.md', 'agentic-coder DOCS/a.html', 'terminal/test/app.test.mjs', 'models/evals/bench/run.mjs', 'models/bonsai-2-27b/results/r.json', 'models/README.md', 'terminal/README.md', 'terminal/scripts/demo/spin.jsx', 'models/runtime/engine/x.patch']) expect([p, isAppCode(p)]).toEqual([p, false]);
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

// The whole path as you use it: the real launcher script, a repo made from
// this working tree (so the launcher builds this code), the compiled app.
// keeper: the app runs inside a keeper (sessions.mjs), the way a window really runs it since 3 Oct 2026;
// the keeper starts the app through the launcher, so /update restarts it there and the window only
// keeps showing it. Without it the app runs in the window itself (AGENTIC_SESSIONS=off in the tests).
async function updateThroughLauncher({ keeper = false } = {}) {
  const src = join(import.meta.dir, '..', '..');
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-update-repo-')));
  const files = execFileSync('git', ['-C', src, 'ls-files', '--cached', '--others', '--exclude-standard', 'terminal/src', 'terminal/rules', 'terminal/app/agentic-coder-launcher.sh', 'models', 'package.json', 'bunfig.toml'], { encoding: 'utf8' })
    .split('\n').filter(Boolean); // models/ whole: the app imports from evals/ too (the test record)
  for (const f of files) { mkdirSync(dirname(join(repo, f)), { recursive: true }); cpSync(join(src, f), join(repo, f)); }
  symlinkSync(join(src, 'node_modules'), join(repo, 'node_modules'));
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'this tree');
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
    expect(after).toContain('Agentic Coder updated from'); // the launcher rebuilt it
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
  const keep = (process.env.AGENTIC_RESTART_FILE ?? process.env.BONSAI_RESTART_FILE);
  try {
    process.env.AGENTIC_RESTART_FILE = file;
    leaveRestart(['--resume', 'abc', '--url', 'http://127.0.0.1:1\nevil']);
  } finally { if (keep === undefined) delete process.env.AGENTIC_RESTART_FILE; else process.env.AGENTIC_RESTART_FILE = keep; }
  expect(readFileSync(target, 'utf8')).toBe('keep me\n');
  expect(lstatSync(file).isSymbolicLink()).toBe(false);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(readFileSync(file, 'utf8')).toBe('--resume\nabc\n--url\nhttp://127.0.0.1:1 evil\n');
});

test("commands Agentic Coder runs do not see where the restart file goes, under either name", async () => {
  const keep = { now: process.env.AGENTIC_RESTART_FILE, old: process.env.BONSAI_RESTART_FILE };
  process.env.AGENTIC_RESTART_FILE = '/tmp/x';
  process.env.BONSAI_RESTART_FILE = '/tmp/y'; // an app started by a launcher from before the rename sets this one
  try {
    const r = await runCommand('echo "now=${AGENTIC_RESTART_FILE:-none} old=${BONSAI_RESTART_FILE:-none}"', { cwd: tmpdir(), sandbox: false });
    expect(r.output ?? r.lines?.join('\n') ?? String(r)).toContain('now=none old=none');
  } finally {
    if (keep.now === undefined) delete process.env.AGENTIC_RESTART_FILE; else process.env.AGENTIC_RESTART_FILE = keep.now;
    if (keep.old === undefined) delete process.env.BONSAI_RESTART_FILE; else process.env.BONSAI_RESTART_FILE = keep.old;
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
