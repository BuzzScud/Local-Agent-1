// Starts and looks after Prism's llama-server for one model: picks a free
// port, waits until it is healthy, restarts it once if it crashes, and stops
// it when Bonsai Code exits.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { SERVER_BIN, LOG_DIR, SLOT_DIR, HOME, DEFAULT_PORT, modelPath } from './models.mjs';

// One small file per running server: which process owns it, on which port.
const REG_DIR = join(HOME, 'servers');
const regFile = (port) => join(REG_DIR, `${port}.json`);

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
    let e;
    try { e = JSON.parse(readFileSync(join(REG_DIR, f), 'utf8')); } catch { rmSync(join(REG_DIR, f), { force: true }); continue; }
    if (!alive(e.pid)) { rmSync(join(REG_DIR, f), { force: true }); continue; }
    if (!alive(e.owner)) { try { process.kill(e.pid, 'SIGTERM'); } catch {} rmSync(join(REG_DIR, f), { force: true }); continue; }
    live.push(e);
  }
  // Older versions kept a single pid file.
  const legacy = join(HOME, 'server.pid');
  if (existsSync(legacy)) { const pid = Number(readFileSync(legacy, 'utf8')); if (pid && alive(pid)) { try { process.kill(pid, 'SIGTERM'); } catch {} } rmSync(legacy, { force: true }); }
  return live;
}

export function serverArgs(model, { ctx, port }) {
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

  async start({ ctx, share = true }) {
    if (!existsSync(SERVER_BIN)) throw new Error(`Prism's llama-server is missing at ${SERVER_BIN}. Run: bonsai setup`);
    if (!existsSync(modelPath(this.model))) throw new Error(`The model file is missing at ${modelPath(this.model)}. Run: bonsai setup`);
    const live = scanServers();
    const same = share && live.find((e) => e.model === this.model.file);
    if (same) {
      try {
        const r = await fetch(`http://127.0.0.1:${same.port}/health`);
        if (r.ok) {
          Object.assign(this, { port: same.port, ctx: same.ctx, shared: same, child: null });
          return { port: same.port, ctx: same.ctx, shared: true, slots: same.slots ?? 1 };
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
    const log = createWriteStream(join(LOG_DIR, 'server.log'), { flags: 'a' });
    log.write(`\n=== ${new Date().toISOString()} start ${this.model.file} ctx=${ctx} port=${port}\n`);
    const child = spawn(SERVER_BIN, serverArgs(this.model, { ctx, port }), { stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    writeFileSync(regFile(port), JSON.stringify({ pid: child.pid, owner: process.pid, port, ctx, slots: this.model.slots ?? 1, model: this.model.file, started: new Date().toISOString() }));
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on('exit', (code, signal) => {
      log.write(`=== exit code=${code} signal=${signal}\n`);
      if (this.child === child) this.child = null;
      rmSync(regFile(port), { force: true });
      if (!this.stopping) this.emit('crash', { code, signal });
    });
    await this.waitHealthy(child);
    return { port, ctx, slots: this.model.slots ?? 1 };
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

  async stop() {
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
