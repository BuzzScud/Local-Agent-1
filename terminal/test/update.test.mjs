// "Update available" in the lower right: a commit on main that changes
// Bonsai's code while it runs lights the badge; docs-only commits, code that
// was already built in, and pushes not yet in this folder are told apart.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isAppCode, checkUpdate, updateText } from '../src/app/update.mjs';
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
  expect(updateText(u)).toBe('↻ Update available · restart bonsai to use it');
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
  expect(updateText(u)).toBe('↻ Update on GitHub · git pull, then restart');
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
    await t.waitFor('↻ Update available · restart bonsai to use it', 10_000);
    const lines = (await t.screen()).split('\n');
    const footer = lines.find((l) => l.includes('Update available'));
    expect(footer).toContain('? for shortcuts'); // the footer line, right side
    expect(footer.trimEnd().length).toBeGreaterThan(155 - 4);
  } finally { await t.close(); await fake.close(); }
}, 60_000);
