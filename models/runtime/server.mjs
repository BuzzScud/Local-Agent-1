// Starts and looks after Prism's llama-server for one model: picks a free
// port, waits until it is healthy, restarts it once if it crashes, and stops
// it when Bonsai Code exits.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, openSync, closeSync, appendFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { SERVER_BIN, LOG_DIR, SLOT_DIR, HOME, DEFAULT_PORT, modelPath, draftPath } from '../registry.mjs';

// One small file per running server: which process owns it, on which port.
const REG_DIR = join(HOME, 'servers');
const regFile = (port) => join(REG_DIR, `${port}.json`);

// Staying loaded after you quit: every window using a server keeps an empty
// file named by its process id in <port>.users/. A small watcher started with
// the server stops it once no window has used it for `linger` seconds, so a
// window closed by any means (quit, closed Terminal, crash) still frees it.
export const LINGER_SECS = 30 * 60;
const usersDir = (port) => join(REG_DIR, `${port}.users`);
const addUser = (port) => { mkdirSync(usersDir(port), { recursive: true }); writeFileSync(join(usersDir(port), String(process.pid)), ''); };
const removeUser = (port) => rmSync(join(usersDir(port), String(process.pid)), { force: true });
export const liveUsers = (port) => { try { return readdirSync(usersDir(port)).map(Number).filter((p) => p && alive(p)); } catch { return []; } };
const WATCH = `S=$1; U=$2; R=$3; L=$4; T=$5; idle=0
while kill -0 "$S" 2>/dev/null; do
  busy=0
  for f in "$U"/*; do [ -e "$f" ] || continue; if kill -0 "\${f##*/}" 2>/dev/null; then busy=1; else rm -f "$f"; fi; done
  if [ "$busy" = 1 ]; then idle=0; else idle=$((idle+T)); fi
  if [ "$idle" -ge "$L" ]; then kill -TERM "$S" 2>/dev/null; n=0; while kill -0 "$S" 2>/dev/null && [ "$n" -lt 50 ]; do sleep 0.1; n=$((n+1)); done; kill -KILL "$S" 2>/dev/null; break; fi
  sleep "$T"
done
rm -rf "$U" "$R"`;
function watch(pid, port, secs) {
  const step = Math.max(1, Math.min(10, Math.floor(secs / 3)));
  spawn('/bin/sh', ['-c', WATCH, 'bonsai-watch', String(pid), usersDir(port), regFile(port), String(secs), String(step)], { detached: true, stdio: 'ignore' }).unref();
}

const portFree = (port) => new Promise((resolve) => {
  const sock = createConnection({ port, host: '127.0.0.1' });
  sock.once('connect', () => { sock.destroy(); resolve(false); });
  sock.once('error', () => resolve(true));
});

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Servers other Bonsai Code windows started. A server whose window is gone is
// left over, so it is stopped; one whose window is still open can be shared.
export function scanServers() {
  mkdirSync(REG_DIR, { recursive: true });
  const live = [];
  for (const f of readdirSync(REG_DIR)) {
    if (!f.endsWith('.json')) continue; // <port>.users/ folders sit beside the files
    let e;
    try { e = JSON.parse(readFileSync(join(REG_DIR, f), 'utf8')); } catch { rmSync(join(REG_DIR, f), { force: true }); continue; }
    if (!alive(e.pid)) { rmSync(join(REG_DIR, f), { force: true }); rmSync(usersDir(e.port), { recursive: true, force: true }); continue; }
    // One that stays loaded after you quit: its watcher stops it when idle.
    if (e.linger) { live.push({ ...e, users: liveUsers(e.port) }); continue; }
    if (!alive(e.owner)) { try { process.kill(e.pid, 'SIGTERM'); } catch {} rmSync(join(REG_DIR, f), { force: true }); continue; }
    live.push(e);
  }
  // Older versions kept a single pid file.
  const legacy = join(HOME, 'server.pid');
  if (existsSync(legacy)) { const pid = Number(readFileSync(legacy, 'utf8')); if (pid && alive(pid)) { try { process.kill(pid, 'SIGTERM'); } catch {} } rmSync(legacy, { force: true }); }
  return live;
}

// Whether the model's guessing helper is used: it is on this Mac (bonsai setup
// downloads it) and not switched off with BONSAI_HELPER=off.
export const hasDraft = (model) => Boolean(model?.draft && process.env.BONSAI_HELPER !== 'off' && existsSync(draftPath(model)));

export function serverArgs(model, { ctx, port, draft = false }) {
  return [
    '-m', modelPath(model),
    '--host', '127.0.0.1', '--port', String(port),
    '-c', String(ctx), '-ngl', '99', '-fa', 'on',
    '-ctk', 'q8_0', '-ctv', 'q8_0',
    '-np', String(model.slots ?? 1), ...(model.slots > 1 ? ['-kvu'] : []), '--no-webui',
    // The model file's own chat template (tool calls + the thinking switch).
    '--jinja',
    '--reasoning-format', 'deepseek',
    // Low-bit models can think forever; after this many tokens the server ends
    // the thinking and the model has to act.
    '--reasoning-budget', String(model.thinkingBudget ?? 2048),
    '--reasoning-budget-message', ' I have thought enough. Now I act on it.',
    // Speculative decoding. With the helper (model.draft): it guesses the next
    // words and the model checks them all in one pass (see draft in model.mjs).
    // Its working space is sized by the micro-batch, so -ub is set with it.
    ...(draft && model.draft ? [
      '-md', draftPath(model), '--spec-type', model.draft.type, '--spec-draft-n-max', String(model.draft.nMax),
      '-ngld', '99', '-ctkd', 'q8_0', '-ctvd', 'q8_0', '-ub', String(model.draft.ubatch),
    ]
    // Without it: n-grams already in the prompt. When the answer copies its
    // input, as a rewritten function does, runs of tokens are accepted at
    // once. Measured 2026-09-25 on a rewrite of export.mjs: 8.2 → 10–11
    // tokens/s written, same output; ngram-mod gave 9.2.
    : model.spec ? ['--spec-type', model.spec.type, '--spec-ngram-simple-size-n', String(model.spec.n), '--spec-ngram-simple-size-m', String(model.spec.m)] : []),
    // Cap the saved states (see checkpoints in models.mjs).
    '--ctx-checkpoints', String(model.checkpoints ?? 3),
    '--cache-ram', '0',
    // Where the read-in instructions are saved and restored (warmup.mjs).
    '--slot-save-path', SLOT_DIR,
  ];
}

export class ModelServer extends EventEmitter {
  constructor(model) {
    super();
    this.model = model;
    this.child = null;
    this.port = null;
    this.ctx = null;
    this.stopping = false;
    this.restarts = 0;
  }

  get url() { return `http://127.0.0.1:${this.port}`; }

  // lingerSecs > 0: the server stays loaded that long after the last window
  // using it is gone (see LINGER_SECS); 0 stops it with this process.
  async start({ ctx, share = true, lingerSecs = this.lingerSecs ?? 0 }) {
    this.lingerSecs = lingerSecs;
    if (!existsSync(SERVER_BIN)) throw new Error(`Prism's llama-server is missing at ${SERVER_BIN}. Run: bonsai setup`);
    if (!existsSync(modelPath(this.model))) throw new Error(`The model file is missing at ${modelPath(this.model)}. Run: bonsai setup`);
    const live = scanServers();
    const same = share && live.find((e) => e.model === this.model.file);
    if (same) {
      try {
        const r = await fetch(`http://127.0.0.1:${same.port}/health`);
        if (r.ok) {
          Object.assign(this, { port: same.port, ctx: same.ctx, shared: same, child: null, draft: Boolean(same.draft) });
          // idle: kept loaded from an earlier start, no other window on it now.
          const idle = Boolean(same.linger) && !(same.users ?? []).some((p) => p !== process.pid);
          if (same.linger) addUser(same.port);
          return { port: same.port, ctx: same.ctx, shared: true, idle, slots: same.slots ?? 1, draft: Boolean(same.draft) };
        }
      } catch {}
    }
    this.shared = null;
    let port = DEFAULT_PORT;
    while (!(await portFree(port))) { port++; if (port > DEFAULT_PORT + 20) throw new Error('no free port near 17600'); }
    this.port = port;
    this.ctx = ctx;
    this.stopping = false;
    mkdirSync(LOG_DIR, { recursive: true });
    mkdirSync(SLOT_DIR, { recursive: true });
    const logPath = join(LOG_DIR, 'server.log');
    appendFileSync(logPath, `\n=== ${new Date().toISOString()} start ${this.model.file} ctx=${ctx} port=${port}${lingerSecs ? ` stays ${lingerSecs}s after the last window` : ''}\n`);
    const draft = hasDraft(this.model);
    this.draft = draft;
    // The log is the server's own output file (not a pipe through this
    // process), so a server that stays loaded keeps writing after we exit.
    const logFd = openSync(logPath, 'a');
    const child = spawn(SERVER_BIN, serverArgs(this.model, { ctx, port, draft }), { stdio: ['ignore', logFd, logFd], detached: lingerSecs > 0 });
    closeSync(logFd);
    this.child = child;
    writeFileSync(regFile(port), JSON.stringify({ pid: child.pid, owner: process.pid, port, ctx, slots: this.model.slots ?? 1, draft, model: this.model.file, started: new Date().toISOString(), ...(lingerSecs ? { linger: lingerSecs } : {}) }));
    if (lingerSecs) { addUser(port); watch(child.pid, port, lingerSecs); }
    child.on('exit', (code, signal) => {
      appendFileSync(logPath, `=== exit code=${code} signal=${signal}\n`);
      if (this.child === child) this.child = null;
      rmSync(regFile(port), { force: true });
      if (!this.stopping) this.emit('crash', { code, signal });
    });
    await this.waitHealthy(child);
    return { port, ctx, slots: this.model.slots ?? 1, draft };
  }

  async waitHealthy(child, timeoutMs = 180_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (child.exitCode !== null) throw new Error(`llama-server exited while loading (code ${child.exitCode}); see ${join(LOG_DIR, 'server.log')}`);
      try {
        const r = await fetch(`${this.url}/health`);
        if (r.ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('llama-server did not become healthy in 3 minutes');
  }

  async restart() {
    this.restarts++;
    await this.stop();
    return this.start({ ctx: this.ctx, share: false });
  }

  // keep: leave a server that stays loaded (lingerSecs) running for the next
  // start; its watcher stops it later. Otherwise stop the one we started.
  async stop({ keep = false } = {}) {
    if (this.port && this.lingerSecs) removeUser(this.port);
    if (keep && this.lingerSecs) { this.child?.unref(); this.child?.removeAllListeners('exit'); this.child = null; return; }
    const child = this.child;
    if (!child) return; // a shared server belongs to the window that started it
    this.stopping = true;
    child.kill('SIGTERM');
    const done = new Promise((r) => child.once('exit', r));
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await done;
    clearTimeout(timer);
    this.child = null;
  }

  // Memory the server really uses (macOS "footprint", includes Metal buffers).
  footprintBytes() {
    const pid = this.child?.pid ?? this.shared?.pid;
    if (!pid) return 0;
    try {
      const out = spawnSyncText('/usr/bin/footprint', ['-p', String(pid)]);
      const m = /phys_footprint:\s+([\d.]+)\s*([KMG])B/.exec(out) ?? /Footprint:\s+([\d.]+)\s*([KMG])B/.exec(out);
      if (!m) return 0;
      return Number(m[1]) * { K: 1e3, M: 1e6, G: 1e9 }[m[2]];
    } catch { return 0; }
  }
}

import { spawnSync } from 'node:child_process';
function spawnSyncText(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000 });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

// `bonsai stop`: stops servers kept loaded that no open window is using.
export function stopIdleServers() {
  const out = { stopped: [], inUse: [] };
  for (const e of scanServers()) {
    if (!e.linger) continue;
    if (e.users.length) { out.inUse.push(e); continue; }
    try { process.kill(e.pid, 'SIGTERM'); } catch {}
    rmSync(regFile(e.port), { force: true });
    rmSync(usersDir(e.port), { recursive: true, force: true });
    out.stopped.push(e);
  }
  return out;
}

// A server this model could use right away (kept loaded, or another window's).
export const runningServer = (model) => scanServers().find((e) => e.model === model.file) ?? null;
