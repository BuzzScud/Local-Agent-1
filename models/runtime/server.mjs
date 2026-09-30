// Starts and looks after llama-server for one model (on the model's engine): picks a free
// port, waits until it is healthy, restarts it once if it crashes, and stops
// it when Agentic Coder exits.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, openSync, closeSync, appendFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { serverBinOf, engineOf, LOG_DIR, SLOT_DIR, HOME, DEFAULT_PORT, modelPath, draftPath } from '../registry.mjs';
import { setEndpoint } from './remote.mjs';

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
// When its server has quit, the watcher removes the port's files only while they still name that
// server: on 29 Sep a server was stopped by hand, a new window's server registered the same port
// within the watcher's sleep, and the old watcher then deleted the new one's files; the next window
// took that copy for another program's and waited for it, and its own watcher saw no windows.
export const WATCH = `S=$1; U=$2; R=$3; L=$4; T=$5; idle=0
while kill -0 "$S" 2>/dev/null; do
  busy=0
  for f in "$U"/*; do [ -e "$f" ] || continue; if kill -0 "\${f##*/}" 2>/dev/null; then busy=1; else rm -f "$f"; fi; done
  if [ "$busy" = 1 ]; then idle=0; else idle=$((idle+T)); fi
  if [ "$idle" -ge "$L" ]; then kill -TERM "$S" 2>/dev/null; n=0; while kill -0 "$S" 2>/dev/null && [ "$n" -lt 50 ]; do sleep 0.1; n=$((n+1)); done; kill -KILL "$S" 2>/dev/null; break; fi
  sleep "$T"
done
if grep -q '"pid":'"$S"'[,}]' "$R" 2>/dev/null; then rm -rf "$U" "$R"; fi`;
function watch(pid, port, secs) {
  const step = Math.max(1, Math.min(10, Math.floor(secs / 3)));
  // Started through a shell that leaves at once, so the watcher is nobody's
  // child: it outlives Agentic Coder and Terminal's title does not show its `sleep`.
  const args = [String(pid), usersDir(port), regFile(port), String(secs), String(step)];
  spawn('/bin/sh', ['-c', '/bin/sh -c "$0" agentic-watch "$@" </dev/null >/dev/null 2>&1 &', WATCH, ...args], { detached: true, stdio: 'ignore' }).unref();
}

const portFree = (port) => new Promise((resolve) => {
  const sock = createConnection({ port, host: '127.0.0.1' });
  sock.once('connect', () => { sock.destroy(); resolve(false); });
  sock.once('error', () => resolve(true));
});

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Servers other Agentic Coder windows started. A server whose window is gone is
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

// Whether the model's guessing helper is used: it is on this Mac (coding setup
// downloads it) and not switched off with AGENTIC_HELPER=off.
export const hasDraft = (model) => Boolean(model?.draft && (process.env.AGENTIC_HELPER ?? process.env.BONSAI_HELPER) !== 'off' && existsSync(draftPath(model)));

// host: where it listens ('127.0.0.1', this Mac only; `coding serve` opens it wider, serve.mjs).
export function serverArgs(model, { ctx, port, draft = false, host = '127.0.0.1' }) {
  // A model that only compares meanings: the engine's embedding mode, one
  // slot, room for a few short texts at once.
  if (model.kind === 'embedding') {
    return ['-m', modelPath(model), '--host', '127.0.0.1', '--port', String(port), '--embedding', '--pooling', model.pooling ?? 'cls',
      '-c', String(ctx ?? model.ctx ?? 2048), '-ub', String(ctx ?? model.ctx ?? 2048), '-ngl', '99', '-np', '1', '--no-webui'];
  }
  // A model that reads a request with each piece and scores the pair: the
  // engine's reranking mode (its own template and scoring head), one slot,
  // the pieces of one request read in one batch.
  if (model.kind === 'rerank') {
    const c = String(ctx ?? model.ctx ?? 8192);
    return ['-m', modelPath(model), '--host', '127.0.0.1', '--port', String(port), '--rerank',
      '-c', c, '-ub', c, '-b', c, '-ngl', '99', '-np', '1', '--no-webui'];
  }
  return [
    '-m', modelPath(model),
    '--host', host, '--port', String(port),
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
    // A helper that shares the model's cache (Gemma's MTP) has no cache of
    // its own to size; a type list ("draft-mtp,ngram-simple") also uses the
    // n-gram lookup, with the model's spec sizes.
    // A helper inside the model file (inFile: Qwen3.5's own MTP layer) needs no
    // file of its own to load: the server finds it in the model.
    ...(draft && model.draft ? [
      ...(model.draft.inFile ? [] : ['-md', draftPath(model)]), '--spec-type', model.draft.type, '--spec-draft-n-max', String(model.draft.nMax), ...(model.draft.inFile ? [] : ['-ngld', '99']),
      ...(model.draft.ownCache === false ? [] : ['-ctkd', 'q8_0', '-ctvd', 'q8_0']),
      ...(model.draft.ubatch ? ['-ub', String(model.draft.ubatch)] : []),
      ...(model.spec && model.draft.type.includes('ngram-simple') ? ['--spec-ngram-simple-size-n', String(model.spec.n), '--spec-ngram-simple-size-m', String(model.spec.m)] : []),
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

  get url() { return `${this.https ? 'https' : 'http'}://127.0.0.1:${this.port}`; }

  // lingerSecs > 0: the server stays loaded that long after the last window
  // using it is gone (see LINGER_SECS); 0 stops it with this process.
  // helper: false starts without the guessing helper even when its file is
  // there (chooseContext turns it off at High effort when memory is short).
  // listen: `coding serve` (serve.mjs): { host, port, args } — the address it
  // opens, its fixed port, and the key and https flags. Never shared from here.
  async start({ ctx, share = true, lingerSecs = this.lingerSecs ?? 0, helper, listen = null } = {}) {
    this.lingerSecs = lingerSecs;
    const bin = serverBinOf(this.model);
    if (!existsSync(bin)) throw new Error(`The model server (${engineOf(this.model).tag}) is missing at ${bin}. Run: coding setup`);
    if (!existsSync(modelPath(this.model))) throw new Error(`The model file is missing at ${modelPath(this.model)}. Run: coding setup`);
    const live = scanServers();
    // One `coding serve` runs over https is not shared (its certificate names another host).
    const same = share && !listen && live.find((e) => e.model === this.model.file && !e.serve?.https);
    if (same) {
      try {
        const r = await fetch(`http://127.0.0.1:${same.port}/health`);
        if (r.ok) {
          Object.assign(this, { port: same.port, ctx: same.ctx, shared: same, child: null, draft: Boolean(same.draft) });
          // `coding serve` running here: this window uses it too, with its key.
          if (same.serve?.keyFile) { try { setEndpoint(this.url, { kind: 'llama', key: readFileSync(same.serve.keyFile, 'utf8').split('\n')[0].trim(), label: 'coding serve' }); } catch {} }
          // idle: kept loaded from an earlier start, no other window on it now.
          const idle = Boolean(same.linger) && !(same.users ?? []).some((p) => p !== process.pid);
          if (same.linger) addUser(same.port);
          return { port: same.port, ctx: same.ctx, shared: true, idle, slots: same.slots ?? 1, draft: Boolean(same.draft) };
        }
      } catch {}
    }
    this.shared = null;
    let port = listen?.port ?? DEFAULT_PORT;
    if (listen && !(await portFree(port))) throw new Error(`port ${port} is in use; pick another with --port`);
    while (!(await portFree(port))) { port++; if (port > DEFAULT_PORT + 20) throw new Error('no free port near 17600'); }
    this.port = port;
    this.https = Boolean(listen?.https);
    this.ctx = ctx;
    this.stopping = false;
    mkdirSync(LOG_DIR, { recursive: true });
    mkdirSync(SLOT_DIR, { recursive: true });
    const logPath = join(LOG_DIR, 'server.log');
    appendFileSync(logPath, `\n=== ${new Date().toISOString()} start ${this.model.file} ctx=${ctx} port=${port}${lingerSecs ? ` stays ${lingerSecs}s after the last window` : ''}\n`);
    const draft = helper === false ? false : hasDraft(this.model);
    this.draft = draft;
    // The log is the server's own output file (not a pipe through this
    // process), so a server that stays loaded keeps writing after we exit.
    const logFd = openSync(logPath, 'a');
    const args = listen ? [...serverArgs(this.model, { ctx, port, draft, host: listen.host }), ...listen.args] : serverArgs(this.model, { ctx, port, draft });
    const child = spawn(bin, args, { stdio: ['ignore', logFd, logFd], detached: lingerSecs > 0 });
    closeSync(logFd);
    this.child = child;
    writeFileSync(regFile(port), JSON.stringify({ pid: child.pid, owner: process.pid, port, ctx, slots: this.model.slots ?? 1, draft, model: this.model.file, started: new Date().toISOString(), ...(lingerSecs ? { linger: lingerSecs } : {}), ...(listen ? { serve: { host: listen.host, keyFile: listen.keyFile ?? null, https: this.https } } : {}) }));
    if (lingerSecs) { addUser(port); watch(child.pid, port, lingerSecs); }
    child.on('exit', (code, signal) => {
      appendFileSync(logPath, `=== exit code=${code} signal=${signal}\n`);
      if (this.child === child) this.child = null;
      dropRegistration(port, child.pid);
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
        // Its own https server on this Mac: the certificate names the host others reach it by.
        const r = await fetch(`${this.url}/health`, this.https ? { tls: { rejectUnauthorized: false } } : undefined);
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
    return footprintOf(this.child?.pid ?? this.shared?.pid);
  }
}

// A process's macOS footprint in bytes (0 when it can't be read). A model
// server's own memory is this plus the model file it maps.
export function footprintOf(pid) {
  if (!pid) return 0;
  try {
    const out = spawnSyncText('/usr/bin/footprint', ['-p', String(pid)]);
    const m = /phys_footprint:\s+([\d.]+)\s*([KMG])B/.exec(out) ?? /Footprint:\s+([\d.]+)\s*([KMG])B/.exec(out);
    if (!m) return 0;
    return Number(m[1]) * { K: 1e3, M: 1e6, G: 1e9 }[m[2]];
  } catch { return 0; }
}

import { spawnSync } from 'node:child_process';
function spawnSyncText(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000 });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

// A port's files removed, but only while they still name server `pid`: a newer server on the same
// port keeps its own (see WATCH). true when they were removed.
export function dropRegistration(port, pid) {
  let owner = null;
  try { owner = JSON.parse(readFileSync(regFile(port), 'utf8')).pid; } catch { return false; }
  if (owner !== pid) return false;
  rmSync(regFile(port), { force: true });
  rmSync(usersDir(port), { recursive: true, force: true });
  return true;
}

// One server from the list stopped, with its files (its watcher then ends).
export function stopServer(e) {
  try { process.kill(e.pid, 'SIGTERM'); } catch {}
  dropRegistration(e.port, e.pid);
}

// `coding stop`: stops servers kept loaded that no open window is using.
export function stopIdleServers() {
  const out = { stopped: [], inUse: [] };
  for (const e of scanServers()) {
    if (!e.linger) continue;
    if (e.users.length) { out.inUse.push(e); continue; }
    stopServer(e);
    out.stopped.push(e);
  }
  return out;
}

// Other copies of this model's file already loaded, apart from the servers app
// windows keep loaded (those are shared as before): a practice-test run, a
// speed probe, a `coding -p` run, another program. Two copies of a 7 GB model
// do not fit side by side on a 16 GB Mac. Each: { pid, port, who, bytes }.
// psText: `ps -Ao pid=,ppid=,rss=,command=`; live: scanServers() (tests pass their own).
export function otherCopies(model, { psText = null, live = null } = {}) {
  const ps = psText ?? spawnSyncText('/bin/ps', ['-Ao', 'pid=,ppid=,rss=,command=']);
  const rows = ps.split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), bytes: Number(m[3]) * 1024, cmd: m[4] }));
  const shared = new Set((live ?? scanServers()).filter((e) => e.linger).map((e) => e.pid));
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  // By the file's whole path: a copy in another home (a test's) is not this one.
  const file = modelPath(model);
  return rows
    .filter((r) => /(^|\/)llama-server\s/.test(r.cmd) && r.cmd.includes(file) && !shared.has(r.pid))
    .map((r) => ({ pid: r.pid, port: Number(/--port\s+(\d+)/.exec(r.cmd)?.[1]) || null, who: whoStarted(r, byPid), bytes: r.bytes }));
}

// Every model server running now, whatever its model: { pid, bytes } (its resident size).
export function serverProcesses({ psText = null } = {}) {
  const ps = psText ?? spawnSyncText('/bin/ps', ['-Ao', 'pid=,rss=,command=']);
  return ps.split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter((m) => m && /(^|\/)llama-server(\s|$)/.test(m[3]))
    .map((m) => ({ pid: Number(m[1]), bytes: Number(m[2]) * 1024 }));
}

// Who a server belongs to, from the programs above it.
function whoStarted(r, byPid) {
  for (let p = byPid.get(r.ppid), i = 0; p && i < 8; p = byPid.get(p.ppid), i++) {
    if (/evals\/bench\//.test(p.cmd)) return 'a practice-test run';
    if (/evals\/battle\//.test(p.cmd)) return 'a battle (Gemma vs Qwen)';
    if (/probe|speed|compare/i.test(p.cmd)) return 'a speed test';
    if (/(^|\s)(-p|--print)(\s|$)/.test(p.cmd) && /coding|agentic|cli\.jsx/.test(p.cmd)) return 'a coding -p run';
    if (/(^|\s)serve(\s|$)/.test(p.cmd) && /coding|agentic|cli\.jsx/.test(p.cmd)) return 'coding serve (for another machine)';
  }
  return /probe/i.test(r.cmd) ? 'a speed test' : 'another program';
}

// A server this model could use right away (kept loaded, or another window's).
export const runningServer = (model) => scanServers().find((e) => e.model === model.file) ?? null;
