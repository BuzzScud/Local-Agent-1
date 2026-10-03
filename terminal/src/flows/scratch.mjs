// A scratch copy of the project where tries are written and tested, so your
// real files change only after you approve. Uses APFS clones (instant, no
// extra disk); heavy folders such as node_modules are linked, not copied.
// .git is not copied: the copy gets a small git of its own that reads your
// project's history, so tests that ask git which files are tracked or
// ignored work as they do in your project, and a test that commits or
// stashes changes only the copy.
import { mkdtempSync, readdirSync, symlinkSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync, realpathSync, cpSync, statSync, lstatSync, statfsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCommand } from '../tools/run.mjs';
import { isHomeFolder } from '../agent/prompt.mjs';

const LINK = new Set(['node_modules', '.venv', 'venv', 'env', 'vendor', 'target', '.next', '.turbo', '.cache', 'coverage', '__pycache__']);
const SKIP = new Set(['.git', '.DS_Store']);
// Caches tools write inside node_modules (Vite bundles its config into
// .vite-temp before a test run): the copy starts them empty.
const CACHES = new Set(['.vite-temp', '.vite', '.cache', '.tmp']);
// The most a copy holds outside the linked folders: a bigger folder is not a
// project. (2 Oct 2026: started in the home folder, a question's command made
// a copy of all of it, and a failed clone doubled it: 135 GB, the disk full.)
const MAX_BYTES = 5 * 1024 ** 3;
const MAX_FILES = 200_000;
// What a copy must leave free on the disk. A clone takes no room, but one that falls back to a
// plain copy does, and a full disk stops everything else on the Mac.
const MIN_FREE = 10 * 1024 ** 3;
// A copy with no note of its maker (made by an app from before 3 Oct 2026) is left over after this long.
const OLD_MS = 60 * 60_000;
const PREFIX = 'agentic-scratch-';
const freeBytes = (dir) => { try { const s = statfsSync(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; } };
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
// A folder copied without write permission (iCloud's) stops rmSync part way: opened up, the rest goes too.
function removeWhole(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {
    spawnSync('chmod', ['-R', 'u+rwx', dir]);
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

// Copies left behind by an app that was killed in the middle of a step (dispose never ran: up to
// MAX_BYTES each, for good). Each copy notes its maker beside it (<copy>.owner, the process id);
// before a new copy is made, the ones whose maker is gone are removed. Answers how many went.
export function sweepScratch(tmp = tmpdir(), { now = Date.now(), alive = isAlive } = {}) {
  let names = [];
  try { names = readdirSync(tmp); } catch { return 0; }
  let gone = 0;
  for (const n of names) {
    if (!n.startsWith(PREFIX) || n.endsWith('.owner')) continue;
    const dir = join(tmp, n), note = `${dir}.owner`;
    let st;
    try { st = lstatSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    let pid = 0;
    try { pid = Number(readFileSync(note, 'utf8')) || 0; } catch {}
    if (pid ? alive(pid) : now - st.mtimeMs < OLD_MS) continue;
    removeWhole(dir);
    rmSync(note, { force: true });
    if (!existsSync(dir)) gone++;
  }
  return gone;
}

// Why no copy is made of cwd, or null. Counted the way cp copies it (a link
// as a link) and stopped as soon as it is over a limit.
function noCopy(cwd, { home, maxBytes, maxFiles, free, minFree }) {
  if (isHomeFolder(cwd, home)) return 'it is the home folder, not a project';
  const todo = readdirSync(cwd).filter((n) => !SKIP.has(n) && !LINK.has(n)).map((n) => join(cwd, n));
  let bytes = 0, files = 0;
  while (todo.length) {
    const p = todo.pop();
    let st;
    try { st = lstatSync(p); } catch { continue; }
    if (st.isDirectory()) { try { for (const n of readdirSync(p)) todo.push(join(p, n)); } catch {} continue; }
    if (++files > maxFiles) return `it holds more than ${maxFiles.toLocaleString('en-US')} files outside node_modules and the other linked folders`;
    if ((bytes += st.size) > maxBytes) return `it holds more than ${maxBytes / 1024 ** 3} GB outside node_modules and the other linked folders`;
  }
  // The room the temp folder's disk has, were the copy to take its full size (a failed clone does).
  const room = free(tmpdir());
  if (room != null && room - bytes < minFree) return `the disk has ${(room / 1024 ** 3).toFixed(1)} GB free, and a copy must leave ${minFree / 1024 ** 3} GB`;
  return null;
}

// node_modules as a real folder of links, one per package: packages are
// still read from your project (no copying), but a tool can write its
// cache next to them. A single link to the whole folder would put those
// writes in your project, which the fence keeps read-only.
function linkEach(from, to) {
  mkdirSync(to);
  for (const name of readdirSync(from)) if (!CACHES.has(name)) symlinkSync(join(from, name), join(to, name));
}

export class Scratch {
  constructor(cwd, { home = homedir(), maxBytes = MAX_BYTES, maxFiles = MAX_FILES, free = freeBytes, minFree = MIN_FREE } = {}) {
    sweepScratch();
    const why = noCopy(cwd, { home, maxBytes, maxFiles, free, minFree });
    if (why) throw new Error(`No throwaway copy of this folder: ${why}.`);
    this.cwd = cwd;
    this.dir = mkdtempSync(join(tmpdir(), PREFIX));
    try { writeFileSync(`${this.dir}.owner`, String(process.pid)); } catch { /* without its note it is swept after an hour */ }
    this.saved = new Map(); // rel → original text (null = did not exist)
    for (const name of readdirSync(cwd)) {
      if (SKIP.has(name)) continue;
      const from = join(cwd, name);
      const to = join(this.dir, name);
      if (name === 'node_modules' && statSync(from).isDirectory()) { linkEach(from, to); continue; }
      if (LINK.has(name)) { symlinkSync(from, to); continue; }
      const r = spawnSync('cp', ['-cR', from, to]);
      // A clone that stopped at an unreadable file has made `to`: cp -R
      // again would put a second, full-size copy inside it (to/name).
      if (r.status !== 0 && !lstatSync(to, { throwIfNoEntry: false })) spawnSync('cp', ['-R', from, to]);
    }
    this.git = privateGit(cwd, this.dir);
  }

  read(rel) { const p = join(this.dir, rel); return existsSync(p) ? readFileSync(p, 'utf8') : null; }
  path(rel) { return join(this.dir, rel); }

  write(rel, text) {
    if (!this.saved.has(rel)) this.saved.set(rel, this.read(rel));
    mkdirSync(dirname(join(this.dir, rel)), { recursive: true });
    writeFileSync(join(this.dir, rel), text);
  }

  // Put a file back the way it was before this job touched it.
  restore(rel) {
    if (!this.saved.has(rel)) return;
    const orig = this.saved.get(rel);
    if (orig === null) rmSync(join(this.dir, rel), { force: true });
    else writeFileSync(join(this.dir, rel), orig);
  }

  // Same runner as the Bash tool: a stop or time-out ends everything the command started.
  async run(command, { timeoutMs = 120_000, signal } = {}) {
    // Linked folders (node_modules…) point into the real project, so it may be read.
    // Its git reads objects from your project's git, so that may be read too.
    const r = await runCommand(command, { cwd: this.dir, timeoutMs, maxLines: Infinity, signal, sandbox: { readOnly: [this.cwd, ...(this.git?.readOnly ?? [])] } });
    // Paths in the output point at the scratch copy; show the real project.
    return { code: r.code, timedOut: r.timedOut, ms: r.ms, out: r.lines.join('\n').split(this.dir).join('.').replace(/\/private\./g, '.') };
  }

  dispose() {
    removeWhole(this.dir);
    rmSync(`${this.dir}.owner`, { force: true });
  }
}

// The copy's own git: a --shared clone (a few files; objects are read from
// your project's git, never written there) at your exact commit, with your
// index, so staged files count as tracked. Only when the project is the top
// of a git checkout (a worktree's .git file points elsewhere, so ask git).
function privateGit(cwd, dir) {
  if (!existsSync(join(cwd, '.git'))) return null;
  const q = (args, where = cwd) => spawnSync('git', args, { cwd: where, encoding: 'utf8' });
  const r = q(['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir', 'HEAD']);
  if (r.status !== 0) return null;
  const [top, gitDir, common, head] = r.stdout.trim().split('\n');
  if (!top || !head || realpathSync(top) !== realpathSync(cwd)) return null;
  const commonDir = resolve(cwd, common);
  const own = join(dir, '.git');
  if (q(['clone', '-q', '--bare', '--shared', cwd, own], dir).status !== 0) { rmSync(own, { recursive: true, force: true }); return null; }
  const g = (...args) => q(['--git-dir', own, '--work-tree', dir, ...args], dir);
  g('config', 'core.bare', 'false');
  g('update-ref', '--no-deref', 'HEAD', head);
  if (existsSync(join(gitDir, 'index'))) cpSync(join(gitDir, 'index'), join(own, 'index'));
  else g('read-tree', 'HEAD');
  if (existsSync(join(commonDir, 'info', 'exclude'))) cpSync(join(commonDir, 'info', 'exclude'), join(own, 'info', 'exclude'));
  // Objects your git itself borrows (a clone made with --shared or --reference).
  let alternates = [];
  try { alternates = readFileSync(join(commonDir, 'objects', 'info', 'alternates'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => resolve(commonDir, 'objects', l)); } catch {}
  return { readOnly: [...new Set([join(commonDir, 'objects'), ...alternates])] };
}
