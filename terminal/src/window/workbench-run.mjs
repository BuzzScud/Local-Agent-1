// The workbench's newer tools on the server (27 Nov 2026, the owner's picks: language smarts, a tests panel, a browser
// preview, a debugger; workbench-lang.js, -tests.js, -web.js, -debug.js draw them). This file: the project's code for
// the language service, a file of the folder served for the browser preview, the servers this Mac runs, and the tests:
// which runner, which tests, a run and its results. The debugger is workbench-debug.mjs. As in workbench.mjs, nothing
// leaves the window's folder and nothing here is the model's: these are the person's own hands.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { allFiles, inside } from './workbench.mjs';
import './workbench-testkit.js';

// How tests are found, run and read (workbench-testkit.js): the same file hearth's page reads them with.
const K = globalThis.WorkbenchTestKit;
export const { testsIn, resultsOf, countsOf } = K;
export const testCommand = (folder, runner, o) => K.testCommand(runner, readJson(join(folder, 'package.json')), o);

const CODE = /\.(m?[jt]sx?|c[jt]s)$/i;
const SKIP = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|\.turbo|target|vendor)\//;
const SOURCE_MAX = 2500, SOURCE_BYTES = 400_000, SOURCES_TOTAL = 25_000_000;

// The folder's code files whole, for the language service (workbench-lang.js): the first SOURCE_MAX of them, none past
// SOURCE_BYTES, SOURCES_TOTAL in all. → { files: [{ path, text }], cut }
export function sourcesOf(folder) {
  const { files: names } = allFiles(folder);
  const out = []; let total = 0, cut = false;
  for (const path of names) {
    if (!CODE.test(path) || SKIP.test(path) || path.endsWith('.min.js')) continue;
    if (out.length >= SOURCE_MAX) { cut = true; break; }
    const abs = inside(folder, path); if (!abs) continue;
    let size; try { size = statSync(abs).size; } catch { continue; }
    if (size > SOURCE_BYTES || total + size > SOURCES_TOTAL) { cut = true; continue; }
    try { out.push({ path, text: readFileSync(abs, 'utf8') }); total += size; } catch {}
  }
  return { files: out, cut };
}

// ---------- the browser preview: a file of the folder at /wb/site/<its own key>/<path>, so a page's own links to its
// pictures and scripts work. The key is the preview's alone (server.mjs): the window's key never reaches a page you
// preview, which the page could read from its own address.
const SITE_TYPES = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.wasm': 'application/wasm' };
export function siteFile(folder, rel) {
  let p = rel; try { p = decodeURIComponent(rel); } catch {}
  let abs = inside(folder, p || 'index.html');
  try { if (abs && statSync(abs).isDirectory()) abs = join(abs, 'index.html'); } catch {}
  if (!abs || !existsSync(abs) || !statSync(abs).isFile()) return new Response('Not in this folder.', { status: 404 });
  return new Response(Bun.file(abs), { headers: { 'content-type': SITE_TYPES[extname(abs).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' } });
}

// ---------- servers running on this Mac, for the preview's address list: the ports something of yours listens on.
export function listPorts({ not = [] } = {}) {
  const r = spawnSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-u', String(process.getuid?.() ?? '')], { encoding: 'utf8', timeout: 5000 });
  const out = new Map();
  for (const line of String(r.stdout ?? '').split('\n').slice(1)) {
    const f = line.trim().split(/\s+/); if (f.length < 9) continue;
    const m = /(?:127\.0\.0\.1|\*|\[::1\]|\[::\]|localhost):(\d+)$/.exec(f[8]); if (!m) continue;
    const port = Number(m[1]); if (port < 1024 || not.includes(port) || out.has(port)) continue;
    out.set(port, { port, name: f[0].replace(/\\x20/g, ' ') });
  }
  return [...out.values()].sort((a, b) => a.port - b.port).slice(0, 40);
}

// ---------- tests: which runner the folder uses, its tests by file, and runs
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
export function runnerOf(folder) {
  return K.runnerFrom({ has: (f) => existsSync(join(folder, f)), pkg: readJson(join(folder, 'package.json')) });
}
export function testsOf(folder) {
  const runner = runnerOf(folder);
  if (!runner) return { runner: null, files: [] };
  const kind = K.kindOf(runner), re = K.TEST_FILE[kind];
  const files = [];
  for (const path of allFiles(folder).files) {
    if (!re.test(path) || SKIP.test(path)) continue;
    const abs = inside(folder, path); if (!abs) continue;
    let text; try { if (statSync(abs).size > 2_000_000) continue; text = readFileSync(abs, 'utf8'); } catch { continue; }
    files.push({ path, tests: K.testsIn(text, kind) });
    if (files.length >= 2000) break;
  }
  return { runner, files };
}
// Runs, one at a time per id: what they print goes to send({ t: 'wbx-test', id, data }); the end with the results.
export function makeTestRuns({ folder, env = process.env, send = () => {} } = {}) {
  const runs = new Map();
  return {
    run({ id, path = null, name = null } = {}) {
      if (!id || runs.has(id)) return { ok: false, why: 'That run is under way.' };
      if (path && !inside(folder, path)) return { ok: false, why: 'That file is not in this folder.' };
      const runner = runnerOf(folder);
      const cmd = runner && K.testCommand(runner, readJson(join(folder, 'package.json')), { path, name });
      if (!cmd) return { ok: false, why: 'No test runner found in this folder (package.json, bun, pytest or go).' };
      const childEnv = { ...env, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' };
      for (const k of ['AGENTIC_WINDOW_SOCK', 'AGENTIC_WINDOW_KEY', 'AGENTIC_WINDOW_CHILD', 'AGENTIC_WINDOW_URL', 'AGENTIC_IN_HOST']) delete childEnv[k];
      let p; try { p = spawn(cmd[0], cmd.slice(1), { cwd: folder, env: childEnv, detached: true }); } catch (e) { return { ok: false, why: e.message }; }
      const t0 = Date.now(); let all = '';
      const on = (d) => { const s = d.toString('utf8'); if (all.length < 4_000_000) all += s; send({ t: 'wbx-test', id, data: s }); };
      p.stdout.on('data', on); p.stderr.on('data', on);
      p.on('error', (e) => on(Buffer.from(`\n${e.message}\n`)));
      p.on('close', (code) => { runs.delete(id); send({ t: 'wbx-test', id, ended: true, code, secs: (Date.now() - t0) / 1000, results: K.resultsOf(all, runner), counts: K.countsOf(all, runner), runner, path, name }); });
      runs.set(id, p);
      send({ t: 'wbx-test', id, data: `$ ${cmd.join(' ')}\n` });
      return { ok: true, id, runner, command: cmd.join(' ') };
    },
    stop(id) { const p = runs.get(id); if (!p) return; try { process.kill(-p.pid, 'SIGTERM'); } catch { try { p.kill('SIGTERM'); } catch {} } },
    stopAll() { for (const id of [...runs.keys()]) this.stop(id); },
  };
}
