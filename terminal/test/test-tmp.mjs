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
// never in the list. null when the processes could not be listed at all: nothing found is not nothing there.
export function processesIn(dir, { me = process.pid, ps = psEnv, tree = psTree, orphans = psOrphans } = {}) {
  const mark = ` TMPDIR=${dir}`;
  const out = [];
  const listed = ps();
  if (listed == null) return null;
  for (const line of listed.split('\n')) {
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
  try { return psRows(['-E', '-o', 'pid=,command='], (p) => [p.pid, ...p.args, ...p.env].join(' ')); } catch { return null; }
}
// ps for this user's processes, or the same rows from the process table when ps cannot start: /bin/ps is setuid,
// and macOS never starts such a program inside a sandbox, so in Agentic Coder's fence (the test runs the app
// starts) every ps here failed and no program of a run was ever found or stopped (18 Oct 2026).
function psRows(args, row) {
  try { return execFileSync('ps', [...args, '-u', String(process.getuid())], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) { if (e.code !== 'EPERM') throw e; }
  return procTable().map(row).join('\n');
}

// This user's processes as macOS keeps them (libproc and sysctl, through Bun's FFI), read with no program
// started: { pid, ppid, comm, args, env }. The environment follows the arguments in KERN_PROCARGS2; for
// Apple's own programs it is empty, as ps -E shows it. 6 ms for 420 processes, inside a sandbox too.
let sys = null;
function libSystem() {
  if (sys) return sys;
  const { dlopen, ptr } = import.meta.require('bun:ffi');
  sys = { ptr, ...dlopen('/usr/lib/libSystem.B.dylib', {
    proc_listpids: { args: ['u32', 'u32', 'ptr', 'i32'], returns: 'i32' },
    proc_pidinfo: { args: ['i32', 'i32', 'u64', 'ptr', 'i32'], returns: 'i32' },
    sysctl: { args: ['ptr', 'u32', 'ptr', 'ptr', 'ptr', 'usize'], returns: 'i32' },
  }).symbols };
  return sys;
}
const PROC_UID_ONLY = 4, PROC_PIDTBSDINFO = 3, BSDINFO_SIZE = 136, CTL_KERN = 1, KERN_ARGMAX = 8, KERN_PROCARGS2 = 49;
const cString = (bytes, at, end) => { let e = at; while (e < end && bytes[e] !== 0) e++; return [Buffer.from(bytes.subarray(at, e)).toString('utf8'), e]; };
export function procTable(uid = process.getuid()) {
  const { ptr, proc_listpids, proc_pidinfo, sysctl } = libSystem();
  const pids = new Int32Array(proc_listpids(PROC_UID_ONLY, uid, null, 0) / 4 + 256);
  const n = proc_listpids(PROC_UID_ONLY, uid, ptr(pids), pids.byteLength) / 4;
  const mib = new Int32Array([CTL_KERN, KERN_ARGMAX, 0]);
  const max = new Int32Array(1);
  const len = new BigUint64Array([4n]);
  sysctl(ptr(mib), 2, ptr(max), ptr(len), null, 0);
  const args = new Uint8Array(max[0] || 1 << 20);
  const info = new Uint8Array(BSDINFO_SIZE);
  const out = [];
  for (const pid of pids.subarray(0, n)) {
    if (!pid || proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, ptr(info), BSDINFO_SIZE) !== BSDINFO_SIZE) continue;
    // struct proc_bsdinfo: pbi_ppid at 16, pbi_comm (16 bytes) at 48.
    const row = { pid, ppid: new DataView(info.buffer).getUint32(16, true), comm: cString(info, 48, 64)[0], args: [], env: [] };
    mib[1] = KERN_PROCARGS2; mib[2] = pid; len[0] = BigInt(args.byteLength);
    if (sysctl(ptr(mib), 3, ptr(args), ptr(len), null, 0) === 0) {
      // argc, the program's path, NULs to the first argument, argc arguments, then the environment to an empty one.
      const end = Number(len[0]);
      const argc = new DataView(args.buffer).getInt32(0, true);
      let at = cString(args, 4, end)[1];
      while (at < end && args[at] === 0) at++;
      for (let i = 0; i < argc && at < end; i++) { const [s, e] = cString(args, at, end); row.args.push(s); at = e + 1; }
      while (at < end) { const [s, e] = cString(args, at, end); if (!s) break; row.env.push(s); at = e + 1; }
    }
    out.push(row);
  }
  return out;
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
    pids = psRows(['-o', 'pid=,ppid=,comm='], (p) => `${p.pid} ${p.ppid} ${p.comm}`).split('\n')
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
  try { return psRows(['-o', 'pid=,ppid='], (p) => `${p.pid} ${p.ppid}`).split('\n').map((l) => l.trim().split(/\s+/).map(Number)).filter(([a, b]) => a && b); } catch { return []; }
}

// Stops them: asked first (SIGTERM), and after `graceMs` whatever is still there is killed. The ones
// that were there are counted, not the ones that went by themselves meanwhile. One that refuses the
// signal (EPERM) is not counted and goes into `refused`: inside a sandbox, every program but its own.
export async function stopProcesses(pids, { graceMs = 500, refused = [] } = {}) {
  const there = pids.filter(isAlive);
  const send = (pid, sig) => { try { process.kill(pid, sig); } catch (e) { if (e.code === 'EPERM' && !refused.includes(pid)) refused.push(pid); } };
  const ours = () => there.filter((pid) => !refused.includes(pid));
  for (const pid of there) send(pid, 'SIGTERM');
  if (ours().some(isAlive)) await new Promise((r) => setTimeout(r, graceMs));
  for (const pid of ours()) { if (isAlive(pid)) send(pid, 'SIGKILL'); }
  return ours().length;
}

// A run folder's programs stopped and the folder removed. { stopped }: how many programs there were.
// A folder whose programs could not be listed, or refused the signal, stays ({ left: true }): it is what a
// later run outside the sandbox finds them by. Inside Agentic Coder's fence the earlier run's programs are
// another sandbox's; removing their folder left them running with nothing to find them by (18 Oct 2026:
// the apps and stand-in model servers of two runs the app had started, still running after it).
export async function cleanRun(dir, opts = {}) {
  const pids = processesIn(dir, opts);
  if (!pids) return { stopped: 0, left: true, pids: [] };
  const refused = [];
  const stopped = await stopProcesses(pids, { ...opts, refused });
  if (refused.length) return { stopped, left: true, pids };
  rmSync(dir, { recursive: true, force: true });
  return { stopped, left: false, pids };
}

// Programs of runs in `base` that have ended, found by the run they carry rather than by its folder: TMPDIR inside
// such a run's folder, or for a program with no parent left, its working folder; the run's test process gone, and
// every run's around it. Whether the folder is still there or not: the sweep went by folders alone, so a program
// whose folder had gone (removed by an older sweep, or by hand) ran on with nothing to find it by (18 Oct 2026: 43
// programs of two runs the app had cut off, and five stand-in MCP servers of worktrees' runs, up to five hours
// old). With their children; never the process asking. null when the processes could not be listed.
export function strayProcesses(base = RUN_BASE, { me = process.pid, ps = psEnv, tree = psTree, orphans = psOrphans, alive = isAlive } = {}) {
  const listed = ps();
  if (listed == null) return null;
  const roots = namesOf(base).map((b) => `${b}/${RUN_PREFIX}`);
  // The runs below `base` only: a base inside a run folder (a test's) is not one of them.
  const ended = (path) => {
    const root = roots.find((r) => path.startsWith(r));
    if (!root) return false;
    const runs = [...path.slice(root.length - RUN_PREFIX.length - 1).matchAll(/\/agentic-run-(\d+)-/g)].map((m) => Number(m[1]));
    return runs.length > 0 && runs.every((pid) => !alive(pid));
  };
  const out = [];
  for (const line of listed.split('\n')) {
    const m = / TMPDIR=(\S+)/.exec(line);
    if (!m || !ended(m[1])) continue;
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (pid && pid !== me && !out.includes(pid)) out.push(pid);
  }
  for (const [pid, cwd] of orphans()) if (pid !== me && !out.includes(pid) && ended(cwd)) out.push(pid);
  if (!out.length) return out;
  const parents = tree();
  for (let i = 0; i < out.length; i++) for (const [pid, ppid] of parents) if (ppid === out[i] && pid !== me && !out.includes(pid)) out.push(pid);
  return out;
}

// The run folders in `base` whose test process is gone: each cleaned; then the programs of ended runs whose
// folders are gone (strayProcesses). { folders, stopped, kept, left, held }: kept are the folders of processes
// still running (a sibling's, or this one's own); left, the folders whose programs could not be stopped from here
// (cleanRun); held, the programs of no folder that could not be.
export async function sweepRuns({ base = RUN_BASE, ...opts } = {}) {
  const r = { folders: 0, stopped: 0, kept: 0, left: 0, held: 0 };
  let names = [];
  try { names = readdirSync(base); } catch { return r; }
  const done = [];
  for (const name of names) {
    const pid = pidOf(name);
    if (!pid) continue;
    if (isAlive(pid)) { r.kept++; continue; }
    const dir = join(base, name);
    if (!existsSync(dir)) continue;
    const { stopped, left, pids } = await cleanRun(dir, opts);
    r.stopped += stopped;
    done.push(...pids);
    if (left) r.left++; else r.folders++;
  }
  const strays = (strayProcesses(base, opts) ?? []).filter((pid) => !done.includes(pid));
  if (strays.length) {
    const refused = [];
    r.stopped += await stopProcesses(strays, { ...opts, refused });
    r.held += refused.length;
  }
  return r;
}

// One line for the suite's output, only when something was there to clean, and one for what could not be.
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const sweepWords = ({ folders, stopped, left = 0, held = 0 }) => `${folders || stopped ? `Cleaned up after an earlier test run: ${[folders ? plural(folders, 'folder') : '', stopped ? `${plural(stopped, 'program')} stopped` : ''].filter(Boolean).join(', ')}.\n` : ''}${left || held ? 'Some programs of earlier test runs could not be stopped from inside a sandbox (Agentic Coder\'s fence); the next test run in a Terminal stops them.\n' : ''}`;

// bun terminal/test/test-tmp.mjs --sweep [--base <folder>]: the sweep, from run-suite.mjs (a bun of its
// own: the models part imports no file of the terminal's but its index).
if (import.meta.main && process.argv.includes('--sweep')) {
  const at = process.argv.indexOf('--base');
  const r = await sweepRuns(at >= 0 ? { base: process.argv[at + 1] } : {});
  process.stdout.write(sweepWords(r));
}
