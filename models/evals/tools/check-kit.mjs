// What the Arena's model checks share (the clean-up plan of 30 Sep 2026, stage 3): the command
// line, the run before this one (the page's Before column), where a run's raw results are, the
// results page and --rebuild, and `coding -p` in a throwaway home. Each check keeps its own checks
// (their runners differ: how long a detail is kept, a check that runs even while stopping), page
// and line in the record.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { docsPath } from '../../../docs/tools/to-docs.mjs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); // the repo
export const CLI = join(root, 'terminal', 'src', 'cli.jsx');
export const BUN = process.versions.bun ? process.execPath : [join(process.env.HOME ?? '', '.bun', 'bin', 'bun'), '/opt/homebrew/bin/bun', '/usr/local/bin/bun'].find((p) => existsSync(p)) ?? 'bun';

// --name value, and --flag.
export function options(args = process.argv.slice(2)) {
  return { args, opt: (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; }, has: (n) => args.includes(`--${n}`) };
}
export const pad = (n) => String(n).padStart(2, '0');
// A run's folder name: 2026-10-03-1356.
export const stampOf = (now) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
export const short = (s, n = 90) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
// The steps `coding -p` printed on stderr ("⏺ Read(a.mjs)", "✗ Bash(…)").
export const toolsOf = (err) => err.split('\n').filter((l) => /^[⏺✗] /.test(l)).map((l) => l.slice(2));

// The newest finished run before this one, in the folders beside it named <prefix>…, on the same
// model unless sameModel is false: { s: its summary, rows }, or null.
export function previousRun(out, summary, prefix, { sameModel = true } = {}) {
  let best = null;
  const beside = dirname(out);
  for (const d of readdirSync(beside)) {
    const dir = join(beside, d);
    if (!d.startsWith(prefix) || dir === out || !existsSync(join(dir, 'summary.json'))) continue;
    try {
      const s = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
      if (s.stopped || (sameModel && s.model !== summary.model) || !(s.finished < summary.finished)) continue;
      if (!best || s.finished > best.s.finished) best = { s, rows: JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8')) };
    } catch { /* a folder being written, or a broken one: skipped */ }
  }
  return best;
}

// Where a run's raw results are, as the page and the record name them: in the repo, a model's
// results folder, or ~.
export const rawOf = (dir) => (dir.startsWith(`${root}/`) ? relative(root, dir) : /\/(models\/[^/]+\/results\/.+)$/.exec(dir)?.[1] ?? dir.replace(homedir(), '~'));

// The results page, drawn by the check's own page builder: draw({ summary, rows, prev, raw }).
export function writeResultsPage(draw, out, rows, summary, prev, { raw = [rawOf(out)] } = {}) {
  mkdirSync(dirname(docsPath(summary.page)), { recursive: true });
  writeFileSync(docsPath(summary.page), draw({ summary, rows, prev, raw }));
}

// --rebuild <a run's folder>: draws that run's page again and ends the process. page(dir, rows,
// summary) draws it (the check's writePage, with the run before it, as after a run).
export function rebuildIfAsked({ has, opt }, page) {
  if (!has('rebuild')) return;
  const dir = opt('rebuild');
  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  if (!summary.page) { console.error(`${dir} has no results page to draw again`); process.exit(2); }
  page(dir, JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8')), summary);
  console.log(`results page drawn again: ${summary.page}`);
  process.exit(0);
}

// `coding -p` as you would run it: { code, out, err, secs }. flags: after the prompt (--yes,
// --no-flows); env: over this process's own; ms: then it is stopped.
export function runCoding({ cwd, env = {}, prompt, flags = ['--yes'], ms = 300_000 }) {
  return new Promise((ok) => {
    const t = Date.now();
    const p = spawn(BUN, [CLI, '-p', prompt, ...flags], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '', e = '';
    p.stdout.on('data', (d) => { o += d; });
    p.stderr.on('data', (d) => { e += d; });
    const timer = setTimeout(() => p.kill('SIGTERM'), ms);
    p.on('exit', (code) => { clearTimeout(timer); ok({ code, out: o.trim(), err: e.trim(), secs: (Date.now() - t) / 1000 }); });
  });
}

// The model servers started from a home (a run that left one behind is a failed check).
export const llamaServers = (home) => spawnSync('ps', ['-axwwo', 'pid=,command='], { encoding: 'utf8' }).stdout.split('\n')
  .map((l) => /^\s*(\d+)\s+(.*)$/.exec(l)).filter((m) => m && /llama-server\s/.test(m[2]) && m[2].includes(home)).map((m) => ({ pid: Number(m[1]) }));
