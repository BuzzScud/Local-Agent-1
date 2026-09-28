// "Update available" in the lower right, as in Claude Code: while Agentic Coder runs,
// it looks at its own repo every 20 s. When a commit lands on main (or is
// pushed to GitHub's main from this Mac) that changes Agentic Coder's code, a restart
// would run something new, and the badge says so. /update restarts Agentic Coder on
// it through the launcher (which builds the new version first) and picks the
// conversation back up.
// GitHub is asked too (git fetch, 30 s after the start, then every 5 min, and
// at each /update), so a push from anywhere else shows up as well.
//   AGENTIC_NO_UPDATE=1 turns the check off (as it turns off the launcher's rebuild);
//   AGENTIC_UPDATE_EVERY=<ms> looks more often (the tests); AGENTIC_FETCH_EVERY=<ms>
//   asks GitHub that often, 0 never.
import { spawn } from 'node:child_process';
import { statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const EVERY_MS = 20_000;
export const FETCH_EVERY_MS = 5 * 60_000;
export const FETCH_FIRST_MS = 30_000;

// The files a rebuild picks up: the same list the launcher checks
// (terminal/app/agentic-coder-launcher.sh), so the badge and the rebuild agree.
export function isAppCode(path) {
  // package.json, and the one file under evals/ that is part of the app (the test record)
  if (path === 'package.json' || path === 'models/evals/record.mjs') return true;
  if (!/^(terminal\/src|terminal\/rules|models)\//.test(path)) return false;
  if (/(^|\/)(node_modules|results|evals|test)\//.test(path)) return false;
  if (/(^|\/)README\.md$/.test(path)) return false;
  return /\.(mjs|js|jsx|json|md|html)$/.test(path);
}

// Every git call runs without a terminal: in its own session, so neither git
// nor ssh can open /dev/tty to ask for a password or a host key (a prompt fails
// instead of taking over Agentic Coder's screen and keys), with every prompt turned
// off by env too and TLS checks that settings cannot switch off. A time limit
// stops git and whatever it started (the https helper); output is capped.
function gitEnv() {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', GCM_INTERACTIVE: 'never', LC_ALL: 'C' };
  env.GIT_SSH_COMMAND ??= 'ssh -o BatchMode=yes';
  delete env.GIT_SSL_NO_VERIFY;
  return env;
}
export function runGit(repo, args, { timeout = 5000, cap = 4 << 20 } = {}) {
  return new Promise((res) => {
    let out = '', err = '', over = false, done = false;
    let child;
    try { child = spawn('git', ['-C', repo, '-c', 'core.fsmonitor=false', ...args], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv() }); } catch (e) { res({ ok: false, out: '', err: e.message }); return; }
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } };
    const timer = setTimeout(() => { over = true; kill(); }, timeout);
    const take = (add) => (d) => { if (over) return; add(String(d)); if (out.length + err.length > cap) { over = true; kill(); } };
    child.stdout.on('data', take((d) => { out += d; }));
    child.stderr.on('data', take((d) => { err += d; }));
    const finish = (ok) => { if (done) return; done = true; clearTimeout(timer); res({ ok: ok && !over, out: out.trim(), err: err.trim() }); };
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
  });
}
const git = async (repo, args) => { const r = await runGit(repo, args); return r.ok ? r.out : null; };
const rev = (repo, ref) => git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
const changed = async (repo, from, to) => ((await git(repo, ['diff', '--name-only', `${from}..${to}`])) ?? '').split('\n').filter(isAppCode);

// Where Agentic Coder's code lives: the launcher passes AGENTIC_REPO; run from the
// source (bun run start), it is the repo this file sits in.
export function findRepo() {
  const tries = [(process.env.AGENTIC_REPO ?? process.env.BONSAI_REPO), join(import.meta.dir, '..', '..', '..')].filter(Boolean);
  return tries.find((d) => { try { return statSync(join(d, 'terminal', 'src', 'cli.jsx')).isFile(); } catch { return false; } }) ?? null;
}

// When the running code was built: the app file's time at start (another
// `coding` may replace the file later), or now when run from the source.
export function builtAt() {
  try { if (!/(^|\/)bun$/.test(process.execPath)) return statSync(process.execPath).mtimeMs; } catch {}
  return Date.now();
}

// One look. `start` = { main } as it was when Agentic Coder started.
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
  if (origin && main && origin !== main) {
    // On GitHub's main (as last fetched, or pushed from a worktree on this
    // Mac) and not in this folder yet: a restart alone would not pick it up.
    const inMain = (await git(repo, ['merge-base', '--is-ancestor', origin, main])) !== null;
    if (!inMain && (await changed(repo, main, origin)).length) return { kind: 'pull', commit: origin };
  }
  return null;
}

export const updateText = (u) => (!u ? null : u.kind === 'pull' ? 'Update on GitHub · /update to get it' : 'Update available · /update to use it');

// Where the update may come from: GitHub over https or ssh (both check who
// they talk to), or a folder on this Mac. Not plain http:// or git:// (anyone
// on the network could hand over other code, and /update would run it), and
// not git's command-running transports (ext::, fd::).
export function isSafeRemote(url) {
  if (!url || /\s/.test(url) || url.includes('::')) return false;
  return /^https:\/\/[^/]/i.test(url) || /^ssh:\/\/\w/i.test(url) || /^\w[\w.-]*@[\w.-]+:[^-]/.test(url) || /^(file:\/\/)?\//.test(url);
}
async function safeOrigin(repo) {
  const url = await git(repo, ['remote', 'get-url', 'origin']); // after any insteadOf rewrite
  if (!url) return { ok: false, why: 'no GitHub remote (origin)' };
  return isSafeRemote(url) ? { ok: true } : { ok: false, why: 'origin is not an https or ssh address' };
}

// Asks GitHub for its main. It reads only: one ref changes, refs/remotes/
// origin/main (--refmap= keeps any other mapping in the settings from moving a
// branch of yours), no tags, no submodules, no FETCH_HEAD, no housekeeping, the
// objects checked as they arrive; only the https, ssh and file transports.
// Nothing in your folder changes; /update is the only step that uses it.
export async function fetchMain(repo, timeout = 20_000) {
  const o = await safeOrigin(repo);
  if (!o.ok) return o;
  const r = await runGit(repo, [
    '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always', '-c', 'protocol.file.allow=always',
    '-c', 'http.sslVerify=true', '-c', 'fetch.fsckObjects=true', '-c', 'transfer.fsckObjects=true',
    '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'submodule.recurse=false',
    'fetch', '--quiet', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', '--refmap=',
    'origin', '+refs/heads/main:refs/remotes/origin/main',
  ], { timeout });
  return r.ok ? { ok: true } : { ok: false, why: plain(r.err) || 'could not reach it' };
}
// Git's words, safe to put on the screen: no control characters (a file name
// in an error cannot move the cursor or recolour the terminal), one line.
export const plain = (text) => String(text ?? '').split('\n').map((l) => l.replace(/^(fatal|error): /, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()).find(Boolean)?.slice(0, 200) ?? '';
export const msEnv = (name, dflt) => { const v = process.env[`AGENTIC_${name}`] ?? process.env[`BONSAI_${name}`]; return v === undefined || v === '' ? dflt : Number(v) || 0; };

// Watches until stopped; calls onChange with the new state when it changes.
// Returns { stop, check }: check() asks GitHub, then looks (for /update).
export function watchUpdates(onChange, { repo = findRepo(), every = msEnv('UPDATE_EVERY', EVERY_MS) || EVERY_MS, fetchEvery = msEnv('FETCH_EVERY', FETCH_EVERY_MS) } = {}) {
  if (!repo || (process.env.AGENTIC_NO_UPDATE ?? process.env.BONSAI_NO_UPDATE) === '1') return { repo: null, stop: () => {}, check: async () => null };
  const built = builtAt();
  let start = null;
  let last = null;
  let now = null;
  let stopped = false;
  const begin = (async () => { start = { main: await rev(repo, 'refs/heads/main') }; })();
  const look = async () => {
    await begin;
    if (stopped) return now;
    now = await checkUpdate(repo, start, built);
    const key = now ? `${now.kind}:${now.commit}` : null;
    if (!stopped && key !== last) { last = key; onChange(now); }
    return now;
  };
  // One fetch at a time; a look right after each, so the badge follows it.
  let fetching = null;
  const fetchNow = (timeout) => (fetching ??= fetchMain(repo, timeout).catch(() => null).finally(() => { fetching = null; }));
  const fetchAndLook = async () => { if (!stopped) { await fetchNow(); await look(); } };
  const timers = [setInterval(look, every)];
  if (fetchEvery > 0) timers.push(setTimeout(fetchAndLook, Math.min(FETCH_FIRST_MS, fetchEvery)), setInterval(fetchAndLook, fetchEvery));
  for (const t of timers) t.unref?.();
  const check = async () => { if (fetchEvery > 0) await fetchNow(8000); return look(); };
  return { repo, stop: () => { stopped = true; for (const t of timers) clearTimeout(t); }, check };
}

// /update, for an update that is on GitHub's main but not in this folder:
// fast-forward the folder's main to it. Git refuses (and changes nothing)
// when the folder is on another branch, main has commits of its own, or a
// file with uncommitted changes would be overwritten.
// Only from a safe origin (see isSafeRemote), only a fast-forward, only when
// you typed /update.
export async function bringIn(repo) {
  const o = await safeOrigin(repo);
  if (!o.ok) return o;
  const branch = await git(repo, ['symbolic-ref', '--short', 'HEAD']);
  if (branch !== 'main') return { ok: false, why: `${short(repo)} is on ${branch ? `the branch ${plain(branch)}` : 'no branch'}, not main` };
  const r = await runGit(repo, ['-c', 'submodule.recurse=false', 'merge', '--ff-only', '--no-edit', 'refs/remotes/origin/main'], { timeout: 20_000 });
  return r.ok ? { ok: true } : { ok: false, why: plain(r.err) || 'git said no' };
}
const short = (p) => (process.env.HOME && p.startsWith(process.env.HOME) ? `~${p.slice(process.env.HOME.length)}` : p);

// Restarting is the launcher's job (terminal/app/agentic-coder-launcher.sh): it runs
// the app and waits, so when this app exits with RESTART_CODE it rebuilds and
// starts the new version with the arguments left in AGENTIC_RESTART_FILE (one
// per line). This window has fully let go of the keyboard by then; a restart
// from inside the app (it waiting on the new one) lost typed keys to the old
// process and left one more of them behind at each /update.
export const RESTART_CODE = 75;
export const canRestart = () => Boolean((process.env.AGENTIC_RESTART_FILE ?? process.env.BONSAI_RESTART_FILE));
// Written fresh ('wx': a file or link someone put in its place is removed, not
// followed or reused), readable by you only. If it cannot be written, Agentic Coder
// ends normally instead (code 0), so the launcher does not restart it.
export function leaveRestart(args) {
  const file = (process.env.AGENTIC_RESTART_FILE ?? process.env.BONSAI_RESTART_FILE);
  try {
    try { unlinkSync(file); } catch {}
    writeFileSync(file, args.map((a) => `${String(a).replace(/[\r\n]/g, ' ')}\n`).join(''), { flag: 'wx', mode: 0o600 });
  } catch (e) {
    process.stderr.write(`\x1b[33m  Could not restart (${plain(e.message)}). Start coding again to use the update.\x1b[0m\n`);
    process.exit(0);
  }
}
