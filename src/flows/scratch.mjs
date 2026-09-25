// A scratch copy of the project where tries are written and tested, so your
// real files change only after you approve. Uses APFS clones (instant, no
// extra disk); heavy folders such as node_modules are linked, not copied.
import { mkdtempSync, readdirSync, symlinkSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';

const LINK = new Set(['node_modules', '.venv', 'venv', 'env', 'vendor', 'target', '.next', '.turbo', '.cache', 'coverage', '__pycache__']);
const SKIP = new Set(['.git', '.DS_Store']);

export class Scratch {
  constructor(cwd) {
    this.cwd = cwd;
    this.dir = mkdtempSync(join(tmpdir(), 'bonsai-scratch-'));
    this.saved = new Map(); // rel → original text (null = did not exist)
    for (const name of readdirSync(cwd)) {
      if (SKIP.has(name)) continue;
      const from = join(cwd, name);
      const to = join(this.dir, name);
      if (LINK.has(name)) { symlinkSync(from, to); continue; }
      const r = spawnSync('cp', ['-cR', from, to]);
      if (r.status !== 0) spawnSync('cp', ['-R', from, to]);
    }
  }

  read(rel) { const p = join(this.dir, rel); return existsSync(p) ? readFileSync(p, 'utf8') : null; }

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

  run(command, { timeoutMs = 120_000, signal } = {}) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const child = spawn(command, { cwd: this.dir, shell: '/bin/zsh', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' } });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
      const stop = () => child.kill('SIGTERM');
      signal?.addEventListener('abort', stop, { once: true });
      child.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
        // Paths in the output point at the scratch copy; show the real project.
        resolve({ code, timedOut, ms: Date.now() - t0, out: out.split(this.dir).join('.').replace(/\/private\./g, '.') });
      });
    });
  }

  dispose() { try { rmSync(this.dir, { recursive: true, force: true }); } catch {} }
}
