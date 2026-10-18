// coding status and /status (18 Oct 2026, with "main, always"): which Agentic Coder runs here and on the other
// Macs, put against GitHub's main; each row that is not main says what happens next (app/status.mjs).
import { test, expect } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { statusRows, statusText } from '../src/app/status.mjs';

const git = (repo, ...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();
const LAUNCHER = readFileSync(join(import.meta.dir, '..', 'app', 'agentic-coder-launcher.sh'), 'utf8');
const CLI = join(import.meta.dir, '..', 'src', 'cli.jsx');

// A repo with GitHub's main in it, the coding command installed from it, and a window built from it.
function setup() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'status-')));
  const repo = join(base, 'repo');
  const put = (p, t) => { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), t); };
  put('terminal/src/cli.jsx', '// app\n');
  put('terminal/src/app/a.mjs', 'export const a = 1;\n');
  put('terminal/app/agentic-coder-launcher.sh', LAUNCHER);
  put('terminal/app/window/src/main.rs', '// window\n');
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'start');
  const main = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'update-ref', 'refs/remotes/origin/main', main);
  const launcher = join(base, 'bin', 'coding');
  mkdirSync(dirname(launcher), { recursive: true });
  writeFileSync(launcher, LAUNCHER.replace('__REPO__', repo));
  const window = join(base, 'home', 'app', 'Agentic Coder Window.app');
  mkdirSync(window, { recursive: true });
  writeFileSync(`${window}.tree`, git(repo, 'rev-parse', `${main}:terminal/app/window`));
  return { base, repo, main, launcher, window, put };
}
const opts = (s, more = {}) => ({ repo: s.repo, built: s.main, launcher: s.launcher, window: s.window, door: () => ({ on: true, running: true, port: 7790 }), macs: () => [], fetch: false, ...more });
const byName = (r) => Object.fromEntries(r.rows.map((x) => [x.what, x]));

test("everything as GitHub's main: each row says so", async () => {
  const s = setup();
  const r = await statusRows(opts(s));
  expect(r.head).toBe(`Agentic Coder against GitHub's main (${s.main.slice(0, 7)}):`);
  expect(r.rows.map((x) => [x.mark, x.what])).toEqual([['✓', 'This app'], ['✓', 'coding command'], ['✓', 'Window'], ['✓', 'Door'], ['✓', 'This folder']]);
  const text = statusText(r);
  expect(text).toContain(`  ✓ This app        GitHub's main (${s.main.slice(0, 7)})`);
  expect(text).toContain("  ✓ coding command  main's launcher");
});

test('what is not main says what happens next: an older app, an older launcher and window, the folder\'s own change, the other Macs', async () => {
  const s = setup();
  const old = s.main;
  // GitHub's main moves on: the app's code, the window and the launcher.
  git(s.repo, 'checkout', '-q', '-b', 'gh');
  s.put('terminal/src/app/a.mjs', 'export const a = 2;\n');
  s.put('terminal/app/window/src/main.rs', '// window 2\n');
  s.put('terminal/app/agentic-coder-launcher.sh', `${LAUNCHER}# newer\n`);
  git(s.repo, 'commit', '-qam', 'newer main');
  const main = git(s.repo, 'rev-parse', 'HEAD');
  git(s.repo, 'update-ref', 'refs/remotes/origin/main', main);
  git(s.repo, 'checkout', '-q', 'main');
  git(s.repo, 'merge', '-q', '--ff-only', 'gh');
  s.put('terminal/src/app/a.mjs', 'export const a = "mine";\n'); // the folder's own change, not pushed
  const asked = [];
  const version = async (host) => { asked.push(host); return host === 'server-1' ? { commit: main } : host === 'mini' ? { commit: null } : { why: 'no key for its door kept here yet' }; };
  const r = await statusRows(opts(s, { built: old, door: () => ({ on: false }), macs: () => ['server-1', 'mini', 'studio'], version }));
  const by = byName(r);
  expect(by['This app']).toMatchObject({ mark: '!', text: `${old.slice(0, 7)}, behind GitHub's main (${main.slice(0, 7)}): it updates at its next start` });
  expect(by['coding command']).toMatchObject({ mark: '!', text: "not main's launcher yet: the next coding start puts main's in its place" });
  expect(by.Window).toMatchObject({ mark: '!', text: 'behind main: the next coding start builds it again from main (it needs Rust)' });
  expect(by.Door).toMatchObject({ mark: '·', text: 'off (coding door on lets your other Macs in)' });
  expect(by['This folder']).toMatchObject({ mark: '!', text: `${s.repo.replace(process.env.HOME, '~')}: 1 file of the app changed; the app has them once they are pushed to main` });
  expect(asked).toEqual(['server-1', 'mini', 'studio']);
  expect(by['server-1']).toMatchObject({ mark: '✓', text: `GitHub's main (${main.slice(0, 7)})` });
  expect(by.mini).toMatchObject({ mark: '!', text: 'an older Agentic Coder (no version)' });
  expect(by.studio).toMatchObject({ mark: '·', text: 'no key for its door kept here yet' });
});

test('run from the folder, with no window and no coding command: said plainly', async () => {
  const s = setup();
  const r = await statusRows(opts(s, { built: null, launcher: join(s.base, 'none', 'coding'), window: join(s.base, 'none', 'Agentic Coder Window.app') }));
  const by = byName(r);
  expect(by['This app']).toMatchObject({ mark: '·', text: "the folder's own code (run from it with bun run start), not a build of main" });
  expect(by['coding command'].text).toBe(`not installed (in ${s.repo.replace(process.env.HOME, '~')}: bun run install-cli)`);
  expect(by.Window).toMatchObject({ mark: '·', text: 'not on this Mac (bun run window makes it once; it needs Rust)' });
});

test('coding status prints it', () => {
  const s = setup();
  const r = spawnSync('bun', [CLI, 'status'], { encoding: 'utf8', env: { ...process.env, AGENTIC_REPO: s.repo, AGENTIC_BUILT_COMMIT: s.main, HOME: s.base }, timeout: 30_000 });
  expect(r.status).toBe(0);
  expect(r.stdout).toContain(`Agentic Coder against GitHub's main (${s.main.slice(0, 7)}, as this Mac last saw it: no GitHub remote (origin)):`);
  expect(r.stdout).toContain(`✓ This app        GitHub's main (${s.main.slice(0, 7)})`);
  expect(r.stdout).toContain('! coding command  not installed');
}, 40_000);
