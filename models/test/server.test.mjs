import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Runs in its own process with its own AGENTIC_HOME: the server module reads
// the home folder when it loads, and this test must never see the real one
// (an earlier version of it stopped a real model server).
test('a second window shares a live server; a left-over one is stopped', () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-srv-'));
  const script = `
    import { spawn } from 'node:child_process';
    import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
    import { join } from 'node:path';
    const { HOME } = await import(${JSON.stringify(join(import.meta.dir, '../registry.mjs'))});
    if (HOME !== (process.env.AGENTIC_HOME ?? process.env.BONSAI_HOME)) { console.log(JSON.stringify({ error: 'wrong home ' + HOME })); process.exit(1); }
    const { scanServers } = await import(${JSON.stringify(join(import.meta.dir, '../runtime/server.mjs'))});
    const reg = join(HOME, 'servers');
    mkdirSync(reg, { recursive: true });
    const orphan = spawn('sleep', ['30']);
    const shared = spawn('sleep', ['30']);
    const gone = spawn('true');
    await new Promise((r) => gone.on('exit', r));
    writeFileSync(join(reg, '17600.json'), JSON.stringify({ pid: shared.pid, owner: process.pid, port: 17600, ctx: 32768, model: 'm.gguf' }));
    writeFileSync(join(reg, '17601.json'), JSON.stringify({ pid: orphan.pid, owner: gone.pid, port: 17601, ctx: 32768, model: 'm.gguf' }));
    writeFileSync(join(reg, '17602.json'), JSON.stringify({ pid: gone.pid, owner: process.pid, port: 17602, ctx: 32768, model: 'm.gguf' }));
    const orphanExit = new Promise((r) => orphan.on('exit', (code, sig) => r(sig)));
    const live = scanServers().map((e) => e.port);
    const sig = await orphanExit;
    shared.kill();
    console.log(JSON.stringify({ live, sig, left: [17601, 17602].map((p) => existsSync(join(reg, p + '.json'))) }));
  `;
  const r = spawnSync('bun', ['-e', script], { env: { ...process.env, AGENTIC_HOME: home }, encoding: 'utf8', timeout: 20000 });
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  expect(out).toEqual({ live: [17600], sig: 'SIGTERM', left: [false, false] });
});

// Staying loaded after you quit: a stand-in llama-server, a window that starts
// it and quits, a second window that finds it at once, then the watcher
// stopping it when no window has used it for the linger time.
test('the model stays loaded after the window quits, the next start takes it over, and it stops once idle', () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-linger-'));
  const mod = (p) => JSON.stringify(join(import.meta.dir, '..', p));
  const script = `
    import { spawnSync } from 'node:child_process';
    import { mkdirSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
    import { join, dirname } from 'node:path';
    const { HOME, SERVER_BIN, MODELS, DEFAULT_MODEL, modelPath } = await import(${mod('registry.mjs')});
    if (HOME !== (process.env.AGENTIC_HOME ?? process.env.BONSAI_HOME)) { console.log(JSON.stringify({ error: 'wrong home ' + HOME })); process.exit(1); }
    const model = MODELS[DEFAULT_MODEL];
    mkdirSync(dirname(SERVER_BIN), { recursive: true });
    writeFileSync(SERVER_BIN, '#!/usr/bin/env bun\\nconst i = process.argv.indexOf("--port"); Bun.serve({ port: Number(process.argv[i + 1]), hostname: "127.0.0.1", fetch: () => new Response("{}") });\\n');
    chmodSync(SERVER_BIN, 0o755);
    mkdirSync(dirname(modelPath(model)), { recursive: true });
    writeFileSync(modelPath(model), '');
    // One "window": its own process, starts (or takes over) the server, then quits keeping it.
    const winRun = () => spawnSync('bun', ['-e', \`
      const { ModelServer, MODELS, DEFAULT_MODEL } = await import(${mod('index.mjs')});
      const s = new ModelServer(MODELS[DEFAULT_MODEL]);
      const st = await s.start({ ctx: 4096, lingerSecs: 3 });
      const pid = s.child?.pid ?? s.shared.pid;
      await s.stop({ keep: true });
      console.log(JSON.stringify({ ...st, pid }));
      process.exit(0);
    \`], { env: process.env, encoding: 'utf8', timeout: 20000 });
    const winOut = (r) => { const l = r.stdout.trim().split('\\n').pop(); if (!l) { console.log(JSON.stringify({ error: r.stderr.slice(-800) })); process.exit(1); } return JSON.parse(l); };
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const a = winOut(winRun());
    await sleep(300);
    const afterQuit = alive(a.pid);
    const b = winOut(winRun());
    const { runningServer, stopIdleServers } = await import(${mod('index.mjs')});
    const seen = runningServer(model);
    let stoppedAfter = null;
    for (let i = 0; i < 40; i++) { await sleep(250); if (!alive(a.pid)) { stoppedAfter = (i + 1) * 250; break; } }
    let regLeft = true;
    for (let i = 0; i < 20 && regLeft; i++) { regLeft = existsSync(join(HOME, 'servers', a.port + '.json')); if (regLeft) await sleep(100); }
    // coding stop: a kept server with no window stops at once
    const c = winOut(winRun());
    const stopped = stopIdleServers();
    await sleep(300);
    console.log(JSON.stringify({ a, b, afterQuit, seen: seen && { port: seen.port, linger: seen.linger }, stoppedAfter, regLeft, c: { shared: c.shared }, stoppedNow: stopped.stopped.length, cGone: !alive(c.pid) }));
    process.exit(0);
  `;
  const r = spawnSync('bun', ['-e', script], { env: { ...process.env, AGENTIC_HOME: home }, encoding: 'utf8', timeout: 40000 });
  const line = r.stdout.trim().split('\n').pop();
  if (!line) throw new Error(r.stderr);
  const out = JSON.parse(line);
  if (out.error) throw new Error(out.error);
  expect(out.a.shared).toBeUndefined();          // the first window started it
  expect(out.afterQuit).toBe(true);              // still loaded after that window quit
  expect(out.b).toMatchObject({ shared: true, idle: true, port: out.a.port, pid: out.a.pid }); // the next start took it over
  expect(out.seen).toEqual({ port: out.a.port, linger: 3 });
  expect(out.stoppedAfter).toBeGreaterThan(0);   // stopped by its watcher once idle
  expect(out.regLeft).toBe(false);
  expect(out.c.shared).toBeUndefined();          // a fresh one after that
  expect(out.stoppedNow).toBe(1);
  expect(out.cGone).toBe(true);
}, 45000);

// 29 Sep, 22:02: a server stopped by hand, a new window's server registered the same port a
// moment later, and the old server's watcher then deleted the new one's files. The watcher and
// the app now remove a port's files only while they still name the server that quit.
test('a server that quits removes its port files only while they still name it; a newer server on the port keeps its own', () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-srv-own-'));
  const script = `
    import { spawn } from 'node:child_process';
    import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
    import { join } from 'node:path';
    const { HOME } = await import(${JSON.stringify(join(import.meta.dir, '../registry.mjs'))});
    if (HOME !== process.env.AGENTIC_HOME) { console.log(JSON.stringify({ error: 'wrong home ' + HOME })); process.exit(1); }
    const { WATCH, dropRegistration } = await import(${JSON.stringify(join(import.meta.dir, '../runtime/server.mjs'))});
    const reg = join(HOME, 'servers');
    // The watcher: its server, no window using it, 1 s of linger, looking every 1 s.
    const watched = async (namesIt) => {
      const port = namesIt ? 17610 : 17611;
      const R = join(reg, port + '.json'), U = join(reg, port + '.users');
      mkdirSync(U, { recursive: true });
      const srv = spawn('sleep', ['30']);
      const newer = spawn('sleep', ['30']);
      writeFileSync(R, JSON.stringify({ pid: namesIt ? srv.pid : newer.pid, owner: process.pid, port, ctx: 4096, model: 'm.gguf' }));
      writeFileSync(join(U, String(process.pid)), '');
      const w = spawn('/bin/sh', ['-c', WATCH, 'agentic-watch', String(srv.pid), U, R, '1', '1']);
      // this window leaves: the watcher stops the idle server, then ends
      const { rmSync } = await import('node:fs'); rmSync(join(U, String(process.pid)));
      const sig = await new Promise((r) => srv.on('exit', (c, s) => r(s)));
      await new Promise((r) => w.on('exit', r));
      newer.kill();
      return { sig, reg: existsSync(R), users: existsSync(U) };
    };
    const [own, newer] = await Promise.all([watched(true), watched(false)]);
    // The app's side (a server's exit, stopServer): the same rule.
    mkdirSync(join(reg, '17612.users'), { recursive: true });
    writeFileSync(join(reg, '17612.json'), JSON.stringify({ pid: 4242, port: 17612 }));
    const other = dropRegistration(17612, 999999);
    const left = existsSync(join(reg, '17612.json')) && existsSync(join(reg, '17612.users'));
    const mine = dropRegistration(17612, 4242);
    const gone = !existsSync(join(reg, '17612.json')) && !existsSync(join(reg, '17612.users'));
    console.log(JSON.stringify({ own, newer, app: { other, left, mine, gone, none: dropRegistration(17699, 1) } }));
  `;
  const r = spawnSync('bun', ['-e', script], { env: { ...process.env, AGENTIC_HOME: home }, encoding: 'utf8', timeout: 30000 });
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  expect(out.own).toEqual({ sig: 'SIGTERM', reg: false, users: false });   // its own files: removed
  expect(out.newer).toEqual({ sig: 'SIGTERM', reg: true, users: true });   // a newer server's: kept
  expect(out.app).toEqual({ other: false, left: true, mine: true, gone: true, none: false });
}, 40_000);

// Two windows (or two tests) starting a model at the same moment: both looked, both saw 17600 free, and
// the one whose server came second found the port taken and died while loading (3 Oct 2026: "Could not
// start the model: llama-server exited while loading (code 1)", and a start test that failed now and then).
// Here the stand-in server's first start has "someone else" take the port in that very moment.
test('a port taken between the look and the start: the model starts on the next port, with no crash said and no failed start', () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-port-'));
  const mod = (p) => JSON.stringify(join(import.meta.dir, '..', p));
  const mark = join(home, 'taken');
  // The first start: another program takes the port (a holder that answers /health like a ready server,
  // as another window's would), and this server, unable to listen, exits with code 1.
  const standIn = join(home, 'stand-in-server.mjs');
  writeFileSync(standIn, `#!/usr/bin/env bun
import { existsSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const mark = ${JSON.stringify(mark)};
if (!existsSync(mark)) {
  const holder = spawn(process.execPath, ['-e', 'Bun.serve({ port: ' + port + ', hostname: "127.0.0.1", fetch: () => new Response("{}") }); setTimeout(() => process.exit(0), 20000);'], { detached: true, stdio: 'ignore' });
  holder.unref();
  writeFileSync(mark, JSON.stringify({ port, holder: holder.pid }));
  await new Promise((r) => setTimeout(r, 60));
  process.exit(1);
}
Bun.serve({ port, hostname: '127.0.0.1', fetch: () => new Response('{}') });
`);
  const script = `
    import { mkdirSync, writeFileSync, readFileSync, chmodSync, copyFileSync } from 'node:fs';
    import { dirname } from 'node:path';
    const { HOME, SERVER_BIN, MODELS, DEFAULT_MODEL, modelPath } = await import(${mod('registry.mjs')});
    if (HOME !== (process.env.AGENTIC_HOME ?? process.env.BONSAI_HOME)) { console.log(JSON.stringify({ error: 'wrong home ' + HOME })); process.exit(1); }
    const model = MODELS[DEFAULT_MODEL];
    mkdirSync(dirname(SERVER_BIN), { recursive: true });
    copyFileSync(${JSON.stringify(standIn)}, SERVER_BIN);
    chmodSync(SERVER_BIN, 0o755);
    mkdirSync(dirname(modelPath(model)), { recursive: true });
    writeFileSync(modelPath(model), '');
    const { ModelServer } = await import(${mod('runtime/server.mjs')});
    const s = new ModelServer(model);
    const crashes = [];
    s.on('crash', (c) => crashes.push(c));
    let started = null, failed = null;
    try { started = await s.start({ ctx: 32768, share: false }); } catch (e) { failed = e.message; }
    await new Promise((r) => setTimeout(r, 400)); // a crash said late would still be counted
    const taken = JSON.parse(readFileSync(${JSON.stringify(mark)}, 'utf8'));
    const alive = Boolean(s.child && s.child.exitCode === null);
    await s.stop();
    try { process.kill(taken.holder, 'SIGKILL'); } catch {}
    console.log(JSON.stringify({ failed: failed ? failed.slice(0, 40) : null, first: taken.port, port: started?.port ?? null, alive, crashes: crashes.length }));
    process.exit(0);
  `;
  const r = spawnSync('bun', ['-e', script], { env: { ...process.env, AGENTIC_HOME: home }, encoding: 'utf8', timeout: 60000 });
  const out = JSON.parse(r.stdout.trim().split('\n').pop() || JSON.stringify({ error: r.stderr.slice(-300) }));
  expect(out).toMatchObject({ failed: null, alive: true, crashes: 0 });
  expect(out.port).toBeGreaterThan(out.first); // the next free one (the ones after may be taken too, on a busy Mac)
}, 90_000);
