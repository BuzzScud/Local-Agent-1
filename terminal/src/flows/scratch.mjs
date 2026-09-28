// A scratch copy of the project where tries are written and tested, so your
// real files change only after you approve. Uses APFS clones (instant, no
// extra disk); heavy folders such as node_modules are linked, not copied.
// .git is not copied: the copy gets a small git of its own that reads your
// project's history, so tests that ask git which files are tracked or
// ignored work as they do in your project, and a test that commits or
// stashes changes only the copy.
import { mkdtempSync, readdirSync, symlinkSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync, realpathSync, cpSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCommand } from '../tools/run.mjs';

const LINK = new Set(['node_modules', '.venv', 'venv', 'env', 'vendor', 'target', '.next', '.turbo', '.cache', 'coverage', '__pycache__']);
const SKIP = new Set(['.git', '.DS_Store']);
// Caches tools write inside node_modules (Vite bundles its config into
// .vite-temp before a test run): the copy starts them empty.
const CACHES = new Set(['.vite-temp', '.vite', '.cache', '.tmp']);

// node_modules as a real folder of links, one per package: packages are
// still read from your project (no copying), but a tool can write its
// cache next to them. A single link to the whole folder would put those
// writes in your project, which the fence keeps read-only.
function linkEach(from, to) {
  mkdirSync(to);
  for (const name of readdirSync(from)) if (!CACHES.has(name)) symlinkSync(join(from, name), join(to, name));
}

export class Scratch {
  constructor(cwd) {
    this.cwd = cwd;
    this.dir = mkdtempSync(join(tmpdir(), 'agentic-scratch-'));
    this.saved = new Map(); // rel → original text (null = did not exist)
    for (const name of readdirSync(cwd)) {
      if (SKIP.has(name)) continue;
      const from = join(cwd, name);
      const to = join(this.dir, name);
      if (name === 'node_modules' && statSync(from).isDirectory()) { linkEach(from, to); continue; }
      if (LINK.has(name)) { symlinkSync(from, to); continue; }
      const r = spawnSync('cp', ['-cR', from, to]);
      if (r.status !== 0) spawnSync('cp', ['-R', from, to]);
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

  dispose() { try { rmSync(this.dir, { recursive: true, force: true }); } catch {} }
}

// The copy's own git: a --shared clone (a few files; objects are read from
// your project's git, never written there) at your exact commit, with your
// index, so staged files count as tracked. Only when the project is the top
// of a git checkout (a worktree's .git file points elsewhere, so ask git).
export function privateGit(cwd, dir) {
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
