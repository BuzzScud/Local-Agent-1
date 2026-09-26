// "Update available" in the lower right, as in Claude Code: while Bonsai runs,
// it looks at its own repo every 20 s. When a commit lands on main (or is
// pushed to GitHub's main from this Mac) that changes Bonsai's code, a restart
// would run something new, and the badge says so. The launcher builds the new
// version at the next `bonsai`.
//   BONSAI_NO_UPDATE=1 turns the check off (as it turns off the launcher's rebuild);
//   BONSAI_UPDATE_EVERY=<ms> looks more often (the tests).
import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';

export const EVERY_MS = 20_000;

// The files a rebuild picks up: the same list the launcher checks
// (terminal/app/bonsai-launcher.sh), so the badge and the rebuild agree.
export function isAppCode(path) {
  if (path === 'package.json') return true;
  if (!/^(terminal\/src|terminal\/rules|models)\//.test(path)) return false;
  if (/(^|\/)(node_modules|results|evals|test)\//.test(path)) return false;
  if (/(^|\/)README\.md$/.test(path)) return false;
  return /\.(mjs|js|jsx|json|md|html)$/.test(path);
}

const git = (repo, args) => new Promise((res) => {
  execFile('git', ['-C', repo, ...args], { timeout: 5000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, out) => res(err ? null : String(out).trim()));
});
const rev = (repo, ref) => git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
const changed = async (repo, from, to) => ((await git(repo, ['diff', '--name-only', `${from}..${to}`])) ?? '').split('\n').filter(isAppCode);

// Where Bonsai's code lives: the launcher passes BONSAI_REPO; run from the
// source (bun run start), it is the repo this file sits in.
export function findRepo() {
  const tries = [process.env.BONSAI_REPO, join(import.meta.dir, '..', '..', '..')].filter(Boolean);
  return tries.find((d) => { try { return statSync(join(d, 'terminal', 'src', 'cli.jsx')).isFile(); } catch { return false; } }) ?? null;
}

// When the running code was built: the app file's time at start (another
// `bonsai` may replace the file later), or now when run from the source.
export function builtAt() {
  try { if (!/(^|\/)bun$/.test(process.execPath)) return statSync(process.execPath).mtimeMs; } catch {}
  return Date.now();
}

// One look. `start` = { main, origin } as they were when Bonsai started.
// Returns the badge's state or null.
export async function checkUpdate(repo, start, built) {
  const main = await rev(repo, 'refs/heads/main');
  if (main && start.main && main !== start.main) {
    // New commits on main that change code newer than this build: a restart
    // rebuilds from this folder and runs them. Code that was already built in
    // (committed after the build, unchanged since) does not count.
    const files = await changed(repo, start.main, main);
    const fresh = files.filter((f) => { try { return statSync(join(repo, f)).mtimeMs > built; } catch { return true; } });
    if (fresh.length) return { kind: 'ready', files: fresh.length, commit: main };
  }
  const origin = await rev(repo, 'refs/remotes/origin/main');
  if (origin && start.origin && origin !== start.origin && main) {
    // Pushed to GitHub from somewhere else on this Mac (a worktree) and not in
    // this folder yet: a restart alone would not pick it up.
    const inMain = (await git(repo, ['merge-base', '--is-ancestor', origin, main])) !== null;
    if (!inMain && (await changed(repo, main, origin)).length) return { kind: 'pull', commit: origin };
  }
  return null;
}

export const updateText = (u) => (!u ? null : u.kind === 'pull' ? '↻ Update on GitHub · git pull, then restart' : '↻ Update available · restart bonsai to use it');

// Watches until stopped; calls onChange with the new state when it changes.
export function watchUpdates(onChange, { repo = findRepo(), every = Number(process.env.BONSAI_UPDATE_EVERY) || EVERY_MS } = {}) {
  if (!repo || process.env.BONSAI_NO_UPDATE === '1') return () => {};
  const built = builtAt();
  let start = null;
  let last = null;
  let stopped = false;
  const look = async () => {
    if (stopped) return;
    if (!start) { start = { main: await rev(repo, 'refs/heads/main'), origin: await rev(repo, 'refs/remotes/origin/main') }; return; }
    const u = await checkUpdate(repo, start, built);
    const key = u ? `${u.kind}:${u.commit}` : null;
    if (!stopped && key !== last) { last = key; onChange(u); }
  };
  look();
  const id = setInterval(look, every);
  id.unref?.();
  return () => { stopped = true; clearInterval(id); };
}
