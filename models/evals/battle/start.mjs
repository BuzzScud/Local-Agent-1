// What the terminal needs from the Battle arena (through models/index.mjs):
//   startBattle()  the runner up (started in the background when it is not), and its address
//   battleHold()   what the app says while a battle holds the memory, or null: while it is
//                  there an Agentic Coder window lets go of its model when idle and waits
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { BATTLE_PORT, paths, readHold, holdText } from './store.mjs';

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
