// What the terminal needs from the Battle arena (through models/index.mjs):
//   startBattle()  the runner up (started in the background when it is not), and its address
//   battleHold()   what the app says while a battle holds the memory, or null: while it is
//                  there an Agentic Coder window lets go of its model when idle and waits
//   testRun()      the hub's way to a test run from its Tests tab (▶ Run a test): reads the
//                  runner's key (runner.token) and sends it along
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { BATTLE_PORT, paths, readHold, holdText, runnerPid } from './store.mjs';

export const battleUrl = () => `http://127.0.0.1:${BATTLE_PORT}/`;
export const battleHold = () => holdText(readHold());

async function ping() {
  try { const r = await fetch(`${battleUrl()}api/ping`, { signal: AbortSignal.timeout(600) }); return r.ok; } catch { return false; }
}

// The repo the runner is in: the launcher names it (the app itself is one built file).
const repoDir = () => (process.env.AGENTIC_REPO ?? process.env.BONSAI_REPO) ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// Something that runs a .mjs file: node or bun, the one running now when it is one of them.
function jsRunner() {
  if (process.env.AGENTIC_JS) return process.env.AGENTIC_JS;
  if (/^(node|bun)$/.test(basename(process.execPath))) return process.execPath;
  for (const cmd of ['node', 'bun']) { const r = spawnSync('/usr/bin/which', [cmd], { encoding: 'utf8' }); if (r.status === 0 && r.stdout.trim()) return r.stdout.trim(); }
  const bun = join(homedir(), '.bun', 'bin', 'bun');
  return existsSync(bun) ? bun : 'node';
}

export async function startBattle({ env = process.env } = {}) {
  if (await ping()) return { url: battleUrl(), started: false };
  const script = join(repoDir(), 'models', 'evals', 'battle', 'runner.mjs');
  if (!existsSync(script)) throw new Error(`the arena's runner is not at ${script}`);
  const P = paths();
  mkdirSync(P.home, { recursive: true });
  const fd = openSync(P.log, 'a');
  const child = spawn(jsRunner(), [script], { cwd: repoDir(), env, detached: true, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  child.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if (await ping()) return { url: battleUrl(), started: true };
  }
  throw new Error(`the arena did not start (see ${P.log.replace(homedir(), '~')})`);
}

// A test run through the runner: GET /api/testrun (what runs, its lines, what is loaded), POST
// /api/testrun { test, model, n } to start one, POST /api/teststop to stop it. start: the runner is
// started first when it is not up (for a start; a look never starts it). → { up, status, body }
export async function testRun({ method = 'GET', path = '/api/testrun', body = null, start = false } = {}) {
  if (start) await startBattle();
  else if (!(await ping())) return { up: false, status: 200, body: null };
  const call = async () => {
    let key = '';
    try { key = readFileSync(paths().token, 'utf8').trim(); } catch {}
    const r = await fetch(`${battleUrl()}${path.replace(/^\//, '')}`, { method, headers: { 'content-type': 'application/json', 'x-agentic-key': key }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
    let out = null;
    try { out = await r.json(); } catch {}
    return { key, r, out };
  };
  let { key, r, out } = await call();
  // A runner from before test runs (it answers "not found", or has written no key): restarted,
  // but only while nothing runs there, so a battle is never cut short.
  if (r.status === 404 || (r.status === 403 && !key)) {
    if (!(await restartIdle())) return { up: true, status: 409, body: { error: 'the Battle runner running now is from before this update and a battle is using it: ▶ Run works once that battle ends' } };
    ({ r, out } = await call());
  }
  return { up: true, status: r.status, body: out };
}

// Stops an idle runner (SIGTERM: it keeps its line of tests) and starts this code's. false: it is busy.
async function restartIdle() {
  let s = null;
  try { s = await (await fetch(`${battleUrl()}api/state`, { signal: AbortSignal.timeout(3000) })).json(); } catch { return false; }
  if (s?.running || s?.testRun || (!s?.paused && s?.queue?.length)) return false;
  const pid = runnerPid();
  if (!pid) return false;
  try { process.kill(pid, 'SIGTERM'); } catch { return false; }
  for (let i = 0; i < 50 && (await ping()); i++) await new Promise((res) => setTimeout(res, 100));
  await startBattle();
  return true;
}
