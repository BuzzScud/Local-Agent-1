// A test process's own temp folder, and the clean-up of what a test run leaves behind (10 Oct 2026).
//
// Why: the tests make their throwaway folders with mkdtemp(tmpdir()) in some 650 places and start
// programs in them (the app in a pseudo-terminal, stand-in model servers, session hosts). Most folders
// were never removed, and a program a test did not stop itself stayed on when the test process ended:
// bun ends the process with no 'exit' event, and a test that ran out of time left pty.mjs's own
// clean-up unrun. One day's runs (9 Oct 2026) left 58,000 folders (17.6 GB) and 101 programs on the Mac
// (2.9 GB of memory, 20 GB of swap).
//
// How: the preload (test-env.mjs) gives each test process a run folder of its own, `agentic-run-<pid>-…`
// in /private/tmp (RUN_BASE, below), and points TMPDIR at it, so every mkdtemp(tmpdir()) in the tests, in the app they
// start and in the programs the app starts lands inside it (Bun's and node's os.tmpdir() follow a change
// of TMPDIR; checked on bun 1.4.2). When the process's tests are over (afterAll), the programs whose
// environment carries that TMPDIR, which is every program a test started and their children, are
// stopped, and the folder goes. `bun run test` sweeps at its start and its end (run-suite.mjs runs this
// file with --sweep): a run folder whose pid is gone is one a crashed or killed process left; its
// programs are stopped and it goes too. A live sibling's folder (six files run at once) is left alone.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const RUN_PREFIX = 'agentic-run-';
// Where run folders go: /private/tmp, not the Mac's own temp folder. That one's path is 49 characters, and a
// run folder inside it made every project path a test shows 25 longer, so the lines the app tests wait for
// were cut at the screen's edge (app-mcp, app-permissions at 155 columns, 10 Oct 2026). Here they are
// shorter than before the run folders. The real path, not /tmp: node's process.cwd() gives that one.
export const RUN_BASE = existsSync('/private/tmp') ? '/private/tmp' : tmpdir();
// Whether this process already works inside a run folder (a test that runs `bun test` itself).
const inRun = () => (process.env.TMPDIR ?? '').split('/').some((part) => part.startsWith(RUN_PREFIX));

// A run folder for this process, inside `base` (RUN_BASE, or the parent run's folder when a test runs
// `bun test` itself, so the parent's clean-up finds it), and TMPDIR pointed at it.
export function makeRunFolder({ base = inRun() ? tmpdir() : RUN_BASE, pid = process.pid } = {}) {
  const dir = mkdtempSync(join(base, `${RUN_PREFIX}${pid}-`));
  process.env.TMPDIR = dir;
  return dir;
}

export const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// The pid a run folder's name carries (0 when it is not one).
export const pidOf = (name) => (name.startsWith(RUN_PREFIX) ? Number(name.slice(RUN_PREFIX.length).split('-')[0]) || 0 : 0);

// This user's processes whose environment has TMPDIR at `dir` or inside it: every program a test in that
// run started, and what those started in turn (children inherit it), with their children too. ps -E
// prints each process's environment after its command (macOS), but none for Apple's own programs
// (sleep, script, zsh: checked 10 Oct 2026), so those are reached as the children of the ones it shows.
// A program started with an environment of its own (an MCP server gets only a few variables, so no
// TMPDIR) is reached as a child of the app that started it; once that app was killed first, launchd
// adopts it, and it is found by its folder instead: a program the tests run (bun, node, a shell, script,
// sleep, python) with no parent, whose working folder is inside the run's, and its children (18 Oct 2026:
// a stand-in MCP server that never answers ran on for 39 min after a full check). The process asking is
// never in the list.
export function processesIn(dir, { me = process.pid, ps = psEnv, tree = psTree, orphans = psOrphans } = {}) {
  const mark = ` TMPDIR=${dir}`;
  const out = [];
  for (const line of ps().split('\n')) {
    const i = line.indexOf(mark);
    if (i < 0) continue;
    const next = line[i + mark.length];
    if (next !== undefined && next !== ' ' && next !== '/') continue;
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (pid && pid !== me && !out.includes(pid)) out.push(pid);
  }
  const roots = namesOf(dir);
  for (const [pid, cwd] of orphans()) if (pid !== me && !out.includes(pid) && roots.some((r) => cwd === r || cwd.startsWith(`${r}/`))) out.push(pid);
  if (!out.length) return out;
  const parents = tree();
  for (let i = 0; i < out.length; i++) for (const [pid, ppid] of parents) if (ppid === out[i] && pid !== me && !out.includes(pid)) out.push(pid);
  return out;
}
function psEnv() {
  try { return execFileSync('ps', ['-E', '-o', 'pid=,command=', '-u', String(process.getuid())], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return ''; }
}
// The folder as given and as the disk names it (/var is /private/var on a Mac): lsof gives the second.
function namesOf(dir) {
  try { const real = realpathSync(dir); return real === dir ? [dir] : [dir, real]; } catch { return [dir]; }
}
// [pid, working folder] of this user's programs of the kinds the tests run whose parent has gone (launchd's
// now). Only those kinds: lsof on every app the Mac has open would cost each test process a moment.
const RUN_KINDS = /(^|\/)(bun|node|sh|zsh|bash|script|sleep|python3?)$/;
function psOrphans() {
  let pids = [];
  try {
    pids = execFileSync('ps', ['-o', 'pid=,ppid=,comm=', '-u', String(process.getuid())], { encoding: 'utf8' }).split('\n')
      .map((l) => l.trim().split(/\s+/)).filter((r) => r[1] === '1' && RUN_KINDS.test(r[2] ?? '')).map((r) => Number(r[0])).filter(Boolean);
  } catch { return []; }
  if (!pids.length) return [];
  let text = '';
  // lsof ends with 1 when one of them has gone meanwhile; what it printed still counts.
  try { text = execFileSync('lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-Fpn'], { encoding: 'utf8' }); } catch (e) { text = String(e.stdout ?? ''); }
  const out = [];
  let pid = 0;
  for (const l of text.split('\n')) { if (l[0] === 'p') pid = Number(l.slice(1)); else if (l[0] === 'n' && pid) out.push([pid, l.slice(1)]); }
  return out;
}
// [pid, ppid] for this user's processes.
function psTree() {
  try { return execFileSync('ps', ['-o', 'pid=,ppid=', '-u', String(process.getuid())], { encoding: 'utf8' }).split('\n').map((l) => l.trim().split(/\s+/).map(Number)).filter(([a, b]) => a && b); } catch { return []; }
}

// Stops them: asked first (SIGTERM), and after `graceMs` whatever is still there is killed. The ones
// that were there are counted, not the ones that went by themselves meanwhile.
export async function stopProcesses(pids, { graceMs = 500 } = {}) {
  const there = pids.filter(isAlive);
  for (const pid of there) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  if (there.some(isAlive)) await new Promise((r) => setTimeout(r, graceMs));
  for (const pid of there) { if (isAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} } }
  return there.length;
}

// A run folder's programs stopped and the folder removed. { stopped }: how many programs there were.
export async function cleanRun(dir, opts = {}) {
  const stopped = await stopProcesses(processesIn(dir, opts), opts);
  rmSync(dir, { recursive: true, force: true });
  return { stopped };
}

// The run folders in `base` whose test process is gone: each cleaned. { folders, stopped, kept }:
// kept are the folders of processes still running (a sibling's, or this one's own).
export async function sweepRuns({ base = RUN_BASE, ...opts } = {}) {
  const r = { folders: 0, stopped: 0, kept: 0 };
  let names = [];
  try { names = readdirSync(base); } catch { return r; }
  for (const name of names) {
    const pid = pidOf(name);
    if (!pid) continue;
    if (isAlive(pid)) { r.kept++; continue; }
    const dir = join(base, name);
    if (!existsSync(dir)) continue;
    const { stopped } = await cleanRun(dir, opts);
    r.folders++;
    r.stopped += stopped;
  }
  return r;
}

// One line for the suite's output, only when something was there to clean.
export const sweepWords = ({ folders, stopped }) => (folders ? `Cleaned up after an earlier test run: ${folders} folder${folders === 1 ? '' : 's'}${stopped ? `, ${stopped} program${stopped === 1 ? '' : 's'} stopped` : ''}.\n` : '');

// bun terminal/test/test-tmp.mjs --sweep [--base <folder>]: the sweep, from run-suite.mjs (a bun of its
// own: the models part imports no file of the terminal's but its index).
if (import.meta.main && process.argv.includes('--sweep')) {
  const at = process.argv.indexOf('--base');
  const r = await sweepRuns(at >= 0 ? { base: process.argv[at + 1] } : {});
  process.stdout.write(sweepWords(r));
}
