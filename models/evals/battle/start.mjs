// What the terminal needs from the Arena (through models/index.mjs):
//   startBattle()  the runner up (started in the background when it is not), and its address
//   battleHold()   what the app says while a battle or a test holds the memory, or null: while it
//                  is there an Agentic Coder window lets go of its model when idle and waits
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { BATTLE_PORT, paths, readHold, holdText, runnerPid } from './store.mjs';

export const battleUrl = () => `http://127.0.0.1:${BATTLE_PORT}/`;
export const battleHold = () => holdText(readHold());

// What answers at the runner's address: { arena: true } from this code's runner, else what an
// older one says, or null when nothing is there.
async function pingInfo() {
  try { const r = await fetch(`${battleUrl()}api/ping`, { signal: AbortSignal.timeout(600) }); return r.ok ? await r.json() : null; } catch { return null; }
}
const ping = async () => Boolean(await pingInfo());

// The repo the runner is in: the launcher names it (the app itself is one built file).
const repoDir = () => process.env.AGENTIC_REPO ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// Something that runs a .mjs file: node or bun, the one running now when it is one of them.
function jsRunner() {
  if (process.env.AGENTIC_JS) return process.env.AGENTIC_JS;
  if (/^(node|bun)$/.test(basename(process.execPath))) return process.execPath;
  for (const cmd of ['node', 'bun']) { const r = spawnSync('/usr/bin/which', [cmd], { encoding: 'utf8' }); if (r.status === 0 && r.stdout.trim()) return r.stdout.trim(); }
  const bun = join(homedir(), '.bun', 'bin', 'bun');
  return existsSync(bun) ? bun : 'node';
}

// A runner answers with its pid, and each runner writes that pid into its home's battle folder (runner.mjs): the
// one at the address is this home's only when the two are the same. A hub on another home (a test's, a preview's)
// never joins it, so its tests and records stay apart (18 Nov 2026, the audit); it says so instead, since the
// address is taken. AGENTIC_BATTLE_PORT gives that home a runner of its own.
const otherHome = (up) => Number(up?.pid) > 0 && Number(up.pid) !== runnerPid();
const OTHER_HOME = () => `the Arena's address (port ${BATTLE_PORT}) is taken by the runner of another Agentic Coder home, so this one does not join it: set AGENTIC_BATTLE_PORT to give this home its own`;

export async function startBattle({ env = process.env } = {}) {
  const up = await pingInfo();
  if (up?.arena && otherHome(up)) throw new Error(OTHER_HOME());
  if (up?.arena) return { url: battleUrl(), started: false };
  if (up && !(await stopOld())) throw new Error('the runner running now is from before the Arena, and something is running in it: open the Arena again when that ends');
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
    const now = await pingInfo();
    if (now && otherHome(now)) throw new Error(OTHER_HOME()); // another home's took the address first
    if (now) return { url: battleUrl(), started: true };
  }
  throw new Error(`the arena did not start (see ${P.log.replace(homedir(), '~')})`);
}

// A runner from before the Arena (it says nothing of `arena` when asked): stopped while nothing
// runs there (SIGTERM: it keeps its line), so this code's can start. false: it is busy.
async function stopOld() {
  let s = null;
  try { s = await (await fetch(`${battleUrl()}api/state`, { signal: AbortSignal.timeout(3000) })).json(); } catch { return false; }
  if (s?.running || s?.testRun || (!s?.paused && s?.queue?.length)) return false;
  const pid = runnerPid();
  if (!pid) return false;
  try { process.kill(pid, 'SIGTERM'); } catch { return false; }
  for (let i = 0; i < 50 && (await ping()); i++) await new Promise((res) => setTimeout(res, 100));
  return true;
}
