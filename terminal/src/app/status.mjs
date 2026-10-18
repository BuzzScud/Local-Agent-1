// Which Agentic Coder runs, put against GitHub's main (main, always: the owner's pick, 18 Oct 2026, with "coding
// status"): this app, the coding command, the window, the door, the folder, and your other Macs. `coding status`
// prints it; /status shows it in the window. GitHub is asked first (8 s at most), so main is the newest.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fetchMain, findRepo, mainRef, notOnMain, runGit, versionText } from './update.mjs';
import { readState, doorRunning, savedMacs, macVersion } from './door.mjs';

const read = (file) => { try { return readFileSync(file, 'utf8'); } catch { return null; } };
const tilde = (p) => (p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);
const git = async (repo, args) => { const r = await runGit(repo, args); return r.ok ? r.out : null; };
const alive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
// Rust's cargo where the launcher looks for it (window_shell): on the PATH, or in rustup's own folder.
const hasRust = () => [...String(process.env.PATH ?? '').split(':').filter(Boolean).map((d) => join(d, 'cargo')), join(homedir(), '.cargo', 'bin', 'cargo')].some((p) => existsSync(p));

// The rows: { mark: ✓ (as main), ! (not: what happens next is said), · (not here, nothing to do), what, text }.
// Every place can be pointed elsewhere, for the tests.
export async function statusRows({
  repo = findRepo(),
  built = process.env.AGENTIC_BUILT_COMMIT ?? null,
  launcher = join(homedir(), '.local', 'bin', 'coding'),
  window = join(process.env.AGENTIC_HOME ?? join(homedir(), '.agentic-coder'), 'app', 'Agentic Coder Window.app'),
  door = () => ({ ...readState(), running: doorRunning() }),
  macs = savedMacs,
  version = macVersion,
  fetch = true,
  rust = hasRust(),
  windowOff = /^(off|0|no|false|terminal)$/i.test(String(process.env.AGENTIC_WINDOW ?? '')),
} = {}) {
  if (!repo) return { head: 'Agentic Coder runs here without its repo, so there is no GitHub main to compare with.', rows: [] };
  const fetched = fetch ? await fetchMain(repo, 8000).catch(() => ({ ok: false })) : { ok: false };
  const main = await mainRef(repo);
  const short = main?.slice(0, 7) ?? '?';
  const head = `Agentic Coder against GitHub's main (${short}${fetch ? (fetched.ok ? ', asked just now' : `, as this Mac last saw it: ${fetched.why ?? 'GitHub did not answer'}`) : ''}):`;
  const rows = [];
  const row = (mark, what, text) => rows.push({ mark, what, text });

  // This app: the commit of main it was built from (the launcher says), or the folder's code (bun run start).
  if (built) { const t = await versionText(built, repo); row(t.startsWith("GitHub's main") ? '✓' : '!', 'This app', t); }
  else row('·', 'This app', `the folder's own code (run from it with bun run start), not a build of main`);

  // The coding command: main's launcher, with this repo in it.
  const have = read(launcher);
  const at = have && (/^REPO="\$\{AGENTIC_REPO:-([^$]*)\}"$/m.exec(have)?.[1] ?? null);
  const theirs = main ? await git(repo, ['show', `${main}:terminal/app/agentic-coder-launcher.sh`]) : null;
  if (!have) row('!', 'coding command', `not installed (in ${tilde(repo)}: bun run install-cli)`);
  else if (!at) row('!', 'coding command', `${tilde(launcher)} is not Agentic Coder's launcher`);
  else if (theirs && `${have}`.trim() === theirs.replace('__REPO__', at).trim()) row('✓', 'coding command', "main's launcher");
  else row('!', 'coding command', "not main's launcher yet: the next coding start puts main's in its place");

  // The window: the stamp beside it names main's terminal/app/window it was built from. The coding command builds it
  // by itself on a Mac with Rust, the first time too, and notes a build that failed (launcher window_shell).
  const tree = main ? await git(repo, ['rev-parse', '-q', '--verify', `${main}:terminal/app/window`]) : null;
  const stamp = read(`${window}.tree`)?.trim();
  const whome = join(window, '..', '..');
  const lock = join(whome, 'build', 'window.lock');
  const log = tilde(join(whome, 'logs', 'window-build.log'));
  const there = existsSync(window);
  if (there && tree && stamp === tree) row('✓', 'Window', "GitHub's main");
  else if (windowOff) row('·', 'Window', 'turned off here (AGENTIC_WINDOW=off): coding stays in the terminal');
  else if (existsSync(lock) && alive(read(join(lock, 'pid')))) row('!', 'Window', there ? `being built from main now (${log}); the next start uses it` : `being built for the first time (${log}); a start after that opens it`);
  else if (tree && read(join(whome, 'build', 'window.failed'))?.trim() === tree) row('!', 'Window', `main's window did not build (${log}; bun run window shows why); coding tries again when main changes it`);
  else if (!there) row('!', 'Window', rust ? 'not built yet: the next coding start builds it in the background (a few minutes)' : 'not on this Mac: install Rust (rustup.rs) and the next coding start builds it');
  else row('!', 'Window', `${stamp ? 'behind main' : 'built before 18 Oct 2026'}: the next coding start builds it again from main${rust ? '' : ' once Rust is installed (rustup.rs)'}`);

  // The door: it runs the installed app, so it is that app's version.
  const d = door();
  if (!d.on) row('·', 'Door', 'off (coding door on lets your other Macs in)');
  else row(d.running ? '✓' : '!', 'Door', d.running ? `on, port ${d.port ?? 7790}: it runs the installed app, and starts again when that is rebuilt` : 'on, but not running (coding door start)');

  // The folder: its own changes are in the app once they are pushed.
  const branch = await git(repo, ['symbolic-ref', '--short', '-q', 'HEAD']);
  const mine = await notOnMain(repo).catch(() => []);
  const ahead = main ? Number(await git(repo, ['rev-list', '--count', `${main}..HEAD`])) || 0 : 0;
  const behind = main ? Number(await git(repo, ['rev-list', '--count', `HEAD..${main}`])) || 0 : 0;
  const own = [mine.length ? `${n(mine.length, 'file')} of the app changed` : '', ahead ? `${n(ahead, 'commit')} not on GitHub` : ''].filter(Boolean).join(' and ');
  const where = `${tilde(repo)}${branch && branch !== 'main' ? ` (on the branch ${branch})` : ''}`;
  if (own) row('!', 'This folder', `${where}: ${own}; the app has them once they are pushed to main`);
  else if (behind) row('!', 'This folder', `${where}: ${n(behind, 'commit')} behind GitHub's main${branch === 'main' ? ' (the next coding start fast-forwards it)' : ''}`);
  else row('✓', 'This folder', `${where}: nothing of its own, the same as GitHub's main`);

  // Your other Macs (/jumptomac's list): what each one's door says it runs.
  for (const host of macs()) {
    const v = await version(host).catch((e) => ({ why: e.message }));
    if (v.why) { row('·', host, v.why); continue; }
    const t = await versionText(v.commit, repo);
    row(t.startsWith("GitHub's main") ? '✓' : '!', host, t);
  }
  return { head, rows };
}

export const statusText = ({ head, rows }) => {
  const w = Math.max(0, ...rows.map((r) => r.what.length));
  return [head, ...rows.map((r) => `  ${r.mark} ${r.what.padEnd(w)}  ${r.text}`)].join('\n');
};
