// The calculator link (terminal/src/web/calc-link.mjs, 8 Oct 2026) on a pretend Thesis calculator that behaves as
// the real one was read to: a login gives a session, the websocket opens it itself (sessionReady), a session it
// does not know gets "Unknown or expired session" and close 1008. Each test makes one thing go wrong: the network
// drops (same session back, no new sign-in), the session runs out (signs in again), it goes quiet (the heartbeat
// notices), a wrong password (tried once), sign-in errors and a refused new session (each filed once), this Mac
// waking from sleep, and signing in again before a stated expiry. Then the reports (seven design requests once,
// nothing secret in them, never twice), the two places it runs (the web and its own service, one socket), the
// formulas on its session, and the hub's Calculator tab.
import { test, expect, afterAll } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_MEMORY_SAVE = 'off';
// A short folder: a socket's path must stay under 104 bytes.
const base = mkdtempSync(join('/tmp', 'acw-calc-'));
process.env.AGENTIC_WEB_HOME = join(base, 'web');
process.env.AGENTIC_LAUNCH_DIR = join(base, 'launch');
const { CalcLink, DESIGN, PROBLEMS, linkHost, askLink, serveLink, sockPath, expiryOf, savedState } = await import('../src/web/calc-link.mjs');
const { storyOf, dayOf } = await import('../src/web/calc-story.mjs');
const { formulasClient } = await import('../src/tools/calculator.mjs');
const { calcHub } = await import('../src/app/calc-hub.mjs');
const { calcPlist, statusLines, programNow } = await import('../src/web/calc-cmd.mjs');
const { loadSettings, saveSettings, settingsFile } = await import('../src/web/config.mjs');

const stops = [];
afterAll(async () => { for (const s of stops.reverse()) await s(); });
const PASS = 'pw-secret-1';
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await Bun.sleep(15); } throw new Error(`waited ${ms} ms for ${fn}`); };
let n = 0;
const dirOf = () => { const d = join(base, `link-${++n}`); mkdirSync(d, { recursive: true }); return d; };
const FAST = { heartbeatMs: 80, pongWaitMs: 120, openWaitMs: 250, baseWaitMs: 20, maxWaitMs: 200, minLifeMs: 500 };

// ---- the pretend calculator --------------------------------------------------------------------

function fakeThesis({ lifeMs = null, expiresIn = null } = {}) {
  const st = { attempts: 0, logins: 0, sessions: new Map(), sockets: new Set(), requests: [], loginFail: 0, refuseNew: false, formulaCalls: 0 };
  const valid = (id) => st.sessions.has(id) && (!lifeMs || Date.now() - st.sessions.get(id) < lifeMs);
  const bearer = (req) => /Bearer (\S+)/.exec(req.headers.get('authorization') ?? '')?.[1];
  const opts = {
    hostname: '127.0.0.1',
    async fetch(req, srv) {
      const u = new URL(req.url);
      if (u.pathname === '/health') return Response.json({ ok: true, service: 'thesis-web-api' });
      if (u.pathname === '/api/login') {
        st.attempts++;
        if (st.loginFail > 0) { st.loginFail--; return Response.json({ ok: false, message: 'upstream down' }, { status: 503 }); }
        const b = await req.json();
        if (b.userName !== 'me' || b.password !== PASS) return Response.json({ ok: false, message: 'Invalid credentials' }, { status: 401 });
        st.logins++;
        const id = `sess-${st.logins}-${crypto.randomUUID()}`;
        st.sessions.set(id, Date.now());
        return Response.json({ ok: true, sessionId: id, ...(expiresIn ? { expiresIn } : {}) });
      }
      if (u.pathname === '/ws') { if (srv.upgrade(req, { data: { id: u.searchParams.get('sessionId') } })) return; return new Response('no', { status: 400 }); }
      if (u.pathname === '/api/requests') {
        if (!valid(bearer(req))) return Response.json({ ok: false, message: 'Invalid session token' }, { status: 401 });
        if (req.method === 'GET') return Response.json({ ok: true, requests: [...st.requests].reverse() });
        const b = await req.json();
        const r = { id: st.requests.length + 1, ...b };
        st.requests.push(r);
        return Response.json({ ok: true, request: r });
      }
      if (u.pathname === '/api/formulas') {
        st.formulaCalls++;
        if (!valid(bearer(req))) return Response.json({ ok: false, message: 'Invalid session token' }, { status: 401 });
        return Response.json({ ok: true, formulas: [{ name: 'golden', expression: 'phi' }] });
      }
      return Response.json({ error: 'not found' }, { status: 404 });
    },
    websocket: {
      open(ws) {
        if (!valid(ws.data.id) || st.refuseNew) { ws.send(JSON.stringify({ type: 'error', message: 'Unknown or expired session' })); ws.close(1008, 'unauthorized'); return; }
        st.sockets.add(ws);
        ws.send(JSON.stringify({ type: 'sessionReady', sessionId: ws.data.id, state: 'ready' }));
      },
      message() {},
      close(ws) { st.sockets.delete(ws); },
    },
  };
  let srv = Bun.serve({ port: 0, ...opts });
  const port = srv.port;
  const t = {
    url: `http://127.0.0.1:${port}`, st, port,
    // The network goes: the server is gone, its sessions kept (as for a blip on the way).
    down() { srv.stop(true); },
    up() { srv = Bun.serve({ port, ...opts }); },
    // Every session runs out: the open sockets are told so and closed as the real server does.
    expireAll() { st.sessions.clear(); for (const ws of st.sockets) { ws.send(JSON.stringify({ type: 'error', message: 'Unknown or expired session' })); ws.close(1008, 'unauthorized'); } },
  };
  stops.push(() => srv.stop(true));
  return t;
}

// A TCP pass-through that can go quiet: nothing through either way, nothing closed (a dead Wi-Fi, a sleeping router).
function quietProxy(targetPort) {
  let quiet = false;
  const srv = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: {
    async open(c) {
      c.data = { buf: [] };
      c.data.up = await Bun.connect({ hostname: '127.0.0.1', port: targetPort, socket: { data(_, d) { if (!quiet) c.write(d); }, close() { c.end(); } } });
      for (const b of c.data.buf) c.data.up.write(b);
    },
    data(c, d) { if (quiet) return; if (c.data.up) c.data.up.write(d); else c.data.buf.push(d); },
    close(c) { c.data.up?.end(); },
  } });
  stops.push(() => srv.stop(true));
  return { url: `http://127.0.0.1:${srv.port}`, quiet: (q) => { quiet = q; } };
}

const linkTo = (calc, o = {}) => {
  const cfg = { url: calc.url, user: 'me', pass: PASS, ...o.cfg };
  const l = new CalcLink({ config: () => cfg, dir: o.dir ?? dirOf(), fileDesign: o.fileDesign ?? false, ...FAST, ...o.opts });
  l.cfgRef = cfg;
  stops.push(() => l.stop());
  return l;
};
const live = (l) => until(() => l.state === 'live');

// ---- the connection --------------------------------------------------------------------------

test('signs in, goes live when the calculator opens the session, and shares that one session', async () => {
  const c = fakeThesis();
  const l = linkTo(c);
  l.start();
  await live(l);
  expect(c.st.logins).toBe(1);
  expect(await l.sessionId()).toStartWith('sess-1-');
  const st = l.status();
  expect(st).toMatchObject({ state: 'live', words: 'Live', user: 'me', url: c.url, hasPass: true });
  expect(JSON.stringify(st)).not.toContain(PASS); // never the password,
  expect(JSON.stringify(st)).not.toContain(await l.sessionId()); // nor the session
  expect(st.events[0].text).toContain('Live');
});

test('the network drops: it notices, waits, and reconnects with the SAME session (no new sign-in)', async () => {
  const c = fakeThesis();
  const l = linkTo(c);
  l.start();
  await live(l);
  const first = await l.sessionId();
  c.down();
  await until(() => l.state === 'waiting' || l.state === 'connecting');
  expect(l.status().counts.drops).toBe(1);
  await Bun.sleep(300); // a few tries while it is gone, each waiting longer
  expect(l.attempt).toBeGreaterThan(1);
  c.up();
  await live(l);
  expect(c.st.logins).toBe(1);
  expect(await l.sessionId()).toBe(first);
  expect(l.status().counts.reconnects).toBe(1);
  expect(l.status().events.map((e) => e.text).join('\n')).toMatch(/The connection (dropped|could not open)/);
});

test('the session runs out (close 1008): it signs in again by itself, and learns how long a session lasts', async () => {
  const c = fakeThesis();
  const l = linkTo(c);
  l.start();
  await live(l);
  await Bun.sleep(120);
  c.expireAll();
  await until(() => c.st.logins === 2);
  await live(l);
  expect(l.status().lifetimes).toHaveLength(1);
  expect(l.status().lifetimes[0]).toBeGreaterThanOrEqual(100);
  expect(l.status().events.map((e) => e.text).join('\n')).toContain('The session ran out after');
  expect(l.status().events[0].text).toContain('Live');
  // Next time it signs in again at 4/5 of what it saw, before the calculator refuses it: here the life seen was too short to plan on.
  expect(l.status().session.refreshAt).toBeNull();
});

test('a connection that goes quiet without closing is noticed by the heartbeat and opened again', async () => {
  const c = fakeThesis();
  const p = quietProxy(c.port);
  const l = linkTo({ url: p.url });
  l.start();
  await live(l);
  await until(() => l.pongSeen); // the calculator answers pings, so a missed one counts
  p.quiet(true);
  await until(() => l.state !== 'live', 2000);
  expect(l.status().counts.missedBeats).toBe(1);
  expect(l.status().lastDrop.code).toBe(4000);
  await Bun.sleep(400); // tries while quiet never open (each one given up after its wait)
  expect(l.state).not.toBe('live');
  p.quiet(false);
  await live(l);
  expect(c.st.logins).toBe(1); // same session
});

test('a wrong password is tried ONCE, then it waits for a new login (no lock-out); the right one goes live', async () => {
  const c = fakeThesis();
  const l = linkTo(c, { cfg: { pass: 'wrong' } });
  l.start();
  await until(() => l.state === 'login-wrong');
  await Bun.sleep(400);
  expect(c.st.attempts).toBe(1);
  expect(l.words()).toContain('username or password is wrong');
  await expect(l.sessionId()).rejects.toThrow(/wrong/);
  expect(l.reload()).toBe(false); // the same login: nothing
  // With no login saved, Reconnect now and Sign in again only say so: no sign-in with an empty name.
  const none = linkTo(c, { cfg: { user: null, pass: null } });
  none.start();
  none.reconnectNow();
  none.signInNow();
  await Bun.sleep(100);
  expect(none.state).toBe('no-login');
  expect(c.st.attempts).toBe(1);
  l.cfgRef.pass = PASS;
  expect(l.reload()).toBe(true);
  await live(l);
  expect(c.st.logins).toBe(1);
});

test('this Mac waking from sleep ends a long wait for the next try at once', async () => {
  const c = fakeThesis();
  const l = linkTo(c, { opts: { baseWaitMs: 5000, maxWaitMs: 5000, heartbeatMs: 60_000 } });
  c.down();
  l.start();
  await until(() => l.state === 'waiting');
  expect(l.nextTryAt - Date.now()).toBeGreaterThan(3000);
  c.up();
  l.lastTick = Date.now() - 10 * 60_000; // the last beat was 10 minutes ago: the Mac slept
  await l.heartbeat();
  await live(l);
  expect(l.status().events.map((e) => e.text).join('\n')).toContain('this Mac slept');
});

test('a stated expiry (expiresIn) is used: it signs in again BEFORE the session runs out, with no drop', async () => {
  const c = fakeThesis({ expiresIn: 1, lifeMs: 1000 });
  const l = linkTo(c);
  l.start();
  await live(l);
  expect(expiryOf({ expiresIn: 1 }, 0)).toBe(1000);
  expect(l.status().session.refreshAt - l.status().session.at).toBe(800);
  await until(() => c.st.logins === 2, 2500);
  await live(l);
  expect(l.status().counts.drops ?? 0).toBe(0);
  expect(l.status().counts.refreshed).toBe(1);
  expect(l.status().events.map((e) => e.text)).toContain('Signed in again before the session runs out');
});

// ---- the reports ------------------------------------------------------------------------------

test('the seven sign-in design requests are filed once with the first session; nothing secret is in them', async () => {
  const c = fakeThesis();
  const dir = dirOf();
  const l = linkTo(c, { dir, fileDesign: true });
  l.start();
  await until(() => c.st.requests.length === 7);
  await until(() => l.status().reports.every((r) => r.status === 'filed'));
  expect(c.st.requests.map((r) => r.kind)).toEqual(Array(7).fill('feature'));
  expect(c.st.requests.map((r) => r.title)).toEqual(DESIGN.map((d) => d.title));
  const sent = JSON.stringify(c.st.requests);
  expect(sent).not.toContain(PASS);
  expect(sent).not.toContain(await l.sessionId());
  expect(c.st.requests[0].description).toContain('Filed by the calculator link in Agentic Coder');
  expect(l.status().reports.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  // Started again on the same record: none filed twice.
  l.stop();
  const again = linkTo(c, { dir, fileDesign: true });
  again.start();
  await live(again);
  await Bun.sleep(150);
  expect(c.st.requests).toHaveLength(7);
  // A new record (the folder wiped) on a server that already has them: matched by title, not filed again.
  const fresh = linkTo(c, { fileDesign: true });
  fresh.start();
  await until(() => fresh.status().reports.length === 7 && fresh.status().reports.every((r) => r.status === 'filed'));
  expect(c.st.requests).toHaveLength(7);
  expect(fresh.status().reports[0].note).toBe('already on the server');
});

test('the expiry request is left out when the login reply says when the session ends', async () => {
  const c = fakeThesis({ expiresIn: 3600 });
  const l = linkTo(c, { fileDesign: true });
  l.start();
  await until(() => c.st.requests.length === 6);
  await Bun.sleep(100);
  expect(c.st.requests.map((r) => r.title)).not.toContain('Say how long a session lasts');
});

test('sign-in answering server errors 3 times in a row is filed as an issue, once, when sign-in works again', async () => {
  const c = fakeThesis();
  c.st.loginFail = 3;
  const l = linkTo(c);
  l.start();
  await live(l);
  await until(() => c.st.requests.length === 1);
  expect(c.st.requests[0]).toMatchObject({ kind: 'issue', title: PROBLEMS['login-server-error'].title });
  expect(c.st.requests[0].description).toContain('answered 503 3 times in a row');
  expect(c.st.attempts).toBe(4);
});

test('a new session refused by the websocket is filed once, and never turns into a sign-in loop', async () => {
  const c = fakeThesis();
  c.st.refuseNew = true;
  const l = linkTo(c);
  l.start();
  await Bun.sleep(600);
  expect(c.st.logins).toBeLessThanOrEqual(6); // 20 ms, 40, 80, 160, 200…: it waits longer each time
  expect(c.st.logins).toBeGreaterThanOrEqual(2);
  c.st.refuseNew = false;
  await live(l);
  await until(() => c.st.requests.length === 1);
  await Bun.sleep(100);
  expect(c.st.requests).toHaveLength(1);
  expect(c.st.requests[0].title).toBe('A new session is refused by the websocket');
  expect(l.status().reports[0].seen).toBeGreaterThan(1);
});

// ---- the formulas on the link's session ---------------------------------------------------------

test('formulas use the link\'s session; a 401 makes the link sign in again for everyone, and the call goes through', async () => {
  const c = fakeThesis();
  let skew = 0;
  const l = linkTo(c, { opts: { now: () => Date.now() + skew } });
  l.start();
  await live(l);
  const f = formulasClient({ url: c.url, user: 'me', pass: PASS, link: { session: () => l.sessionId(), rejected: (id, o) => l.rejected(id, o) } });
  expect((await f.search({ q: 'gold' })).formulas[0].name).toBe('golden');
  expect(c.st.logins).toBe(1); // the link's, not one of its own
  skew = 60_000; // a minute later, the calculator forgets the session
  c.st.sessions.clear();
  expect((await f.search({ q: 'gold' })).formulas[0].name).toBe('golden');
  expect(c.st.logins).toBe(2);
  await live(l);
  expect(l.status().reports).toEqual([]); // an old session refused is no problem to file
  // No link for this login (null): it signs in by itself, as before.
  const own = formulasClient({ url: c.url, user: 'me', pass: PASS, link: { session: async () => null, rejected: async () => null } });
  expect((await own.search({})).formulas).toHaveLength(1);
  expect(c.st.logins).toBe(3);
});

// ---- one link, two places ---------------------------------------------------------------------

test('the web runs it; its own service takes the socket over; back to the web: the service leaves', async () => {
  const c = fakeThesis();
  const sock = join(base, 'h.sock');
  const dir = dirOf();
  const calc = { url: c.url, user: 'me', pass: PASS, link: 'web' };
  const opts = { readCalc: () => calc, sock, dir, every: 3_600_000, linkOpts: { ...FAST, fileDesign: false } };
  const web = linkHost({ where: 'web', ...opts });
  stops.push(() => web.stop());
  await web.tick();
  await until(async () => (await askLink('/status', { sock }))?.state === 'live');
  expect((await askLink('/status', { sock })).where).toBe('web');
  expect((statSync(sock).mode & 0o777).toString(8)).toBe('600');
  // A second web copy for the same login uses this one's session through the socket.
  const other = linkHost({ where: 'web', ...opts });
  stops.push(() => other.stop());
  await other.tick();
  expect(other.link()).toBeNull();
  expect(await other.session()).toBe(await web.session());
  // A copy for another address or user never takes this one's session.
  const stranger = linkHost({ where: 'web', ...opts, readCalc: () => ({ ...calc, user: 'someone-else' }) });
  stops.push(() => stranger.stop());
  expect(await stranger.session()).toBeNull();
  // Its own service: it asks the web to hand over, then answers on the socket itself.
  calc.link = 'service';
  let left = 0;
  const svc = linkHost({ where: 'service', ...opts, onLeave: () => { left++; } });
  stops.push(() => svc.stop());
  await web.tick();
  expect(web.link()).toBeNull();
  await svc.tick();
  await until(async () => (await askLink('/status', { sock }))?.where === 'service' && svc.link()?.state === 'live');
  expect(await other.session()).toBe(await svc.session());
  // Back inside the web: the service stops its link and leaves; the web starts its own.
  calc.link = 'web';
  await svc.tick();
  expect(left).toBe(1);
  expect(existsSync(sock)).toBe(false);
  await web.tick();
  await until(async () => (await askLink('/status', { sock }))?.where === 'web');
  expect(c.st.logins).toBe(3); // one sign-in each time it moves (web, service, web), none in between
});

test('a socket left by a copy that did not stop is taken over; one answering is not', async () => {
  const sock = join(base, 's.sock');
  writeFileSync(sock, '');
  const fake = { status: () => ({ state: 'idle', where: 'web', reports: [], events: [] }) };
  const s = await serveLink(fake, { sock });
  expect(s).not.toBeNull();
  expect((await askLink('/status', { sock })).state).toBe('idle');
  expect(await serveLink(fake, { sock })).toBeNull();
  s.stop();
  expect(await askLink('/status', { sock })).toBeNull();
  expect(sockPath('/a/very/long/path/'.repeat(8))).toMatch(/^\/tmp\/acw-calc-[0-9a-f]{12}\.sock$/);
});

// ---- the hub's Calculator tab and coding calc ----------------------------------------------------

test('the hub tab: status from the socket, the login saved (0600, never shown), where it runs switched with launchctl', async () => {
  const c = fakeThesis();
  saveSettings({ calc: { url: c.url, user: null, pass: null, link: 'web' } });
  const calls = [];
  const hub = calcHub({ run: (a) => { calls.push(a.join(' ')); return { status: a[0] === 'print' ? 113 : 0, stdout: '', stderr: '' }; }, program: ['/usr/local/bin/bun', '/x/cli.jsx'] });
  const go = (path, body, origin) => hub.route(new Request(`http://127.0.0.1:1${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }), new URL(`http://127.0.0.1:1${path}`));
  let v = await (await go('/calc.json')).json();
  expect(v).toMatchObject({ where: 'web', link: null, login: { url: c.url, user: null, hasPass: false } });
  expect((await go('/calc/login', { pass: 'x' }, 'http://evil.example')).status).toBe(403);
  // The web runs the link (its host, as server.mjs makes it); the hub's login reaches it.
  const web = linkHost({ where: 'web', every: 3_600_000, linkOpts: { ...FAST, fileDesign: false } });
  stops.push(() => web.stop());
  await web.tick();
  expect((await askLink('/status')).state).toBe('no-login');
  const r = await go('/calc/login', { url: `${c.url}/`, user: 'me', pass: PASS });
  expect(r.status).toBe(200);
  expect(await r.text()).not.toContain(PASS);
  expect(loadSettings().calc).toMatchObject({ url: c.url, user: 'me', pass: PASS });
  expect((statSync(settingsFile()).mode & 0o777).toString(8)).toBe('600');
  await until(async () => (await askLink('/status'))?.state === 'live');
  v = await (await go('/calc.json')).json();
  expect(v.link).toMatchObject({ state: 'live', user: 'me', where: 'web' });
  expect((await go('/calc/reconnect', {})).status).toBe(200);
  await until(async () => (await askLink('/status'))?.state === 'live');
  // Its own background service: the setting, the LaunchAgent's file, launchctl.
  v = await (await go('/calc/where', { where: 'service' })).json();
  expect(v.where).toBe('service');
  expect(calls.some((x) => x.startsWith('bootstrap gui/'))).toBe(true);
  const plist = readFileSync(join(process.env.AGENTIC_LAUNCH_DIR, 'com.agentic-coder.calc-link.plist'), 'utf8');
  expect(plist).toContain('<string>/x/cli.jsx</string><string>calc</string><string>run</string>');
  expect(plist).toContain('<key>KeepAlive</key>');
  await web.tick();
  expect(web.link()).toBeNull(); // the web let go of it: the service's turn
  v = await (await go('/calc/where', { where: 'web' })).json();
  expect(v.where).toBe('web');
  expect(existsSync(join(process.env.AGENTIC_LAUNCH_DIR, 'com.agentic-coder.calc-link.plist'))).toBe(false);
  expect(calcPlist({ program: ['/app'] })).not.toContain('AGENTIC_WEB_HOME</key><string>undefined');
  const lines = statusLines(null, { where: 'service', service: { loaded: false } });
  expect(lines[0]).toContain('not running');
  expect((await go('/calc/where', { where: 'somewhere' })).status).toBe(409);
});

test('coding calc run says in its log why it stopped: a SIGTERM (the service switched off) is not a crash', async () => {
  const { spawn } = await import('node:child_process');
  const home = mkdtempSync(join('/tmp', 'acw-run-'));
  // set to run as the service (no address: it waits for one), or it leaves at once for the web
  mkdirSync(join(home, 'web'), { recursive: true });
  writeFileSync(join(home, 'web', 'settings.json'), JSON.stringify({ calc: { link: 'service' } }));
  const child = spawn('bun', [join(import.meta.dir, '..', 'src', 'cli.jsx'), 'calc', 'run'], { env: { ...process.env, AGENTIC_HOME: home, AGENTIC_WEB_HOME: join(home, 'web'), AGENTIC_MEMORY_SAVE: 'off' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const exited = new Promise((r) => child.on('exit', r));
  for (let i = 0; i < 100 && !out.includes('the background service started'); i++) await Bun.sleep(50);
  await Bun.sleep(300); // its signal handlers are set just after that line
  expect(out).not.toContain('so the service stops');
  child.kill('SIGTERM');
  const code = await exited;
  expect(out).toContain('the background service started');
  expect(out).toContain('calc link: the service was told to stop (SIGTERM');
  expect(code).toBe(0);
}, 15_000);

// ---- the Calculator tab, "2 · Chain" (9 Oct 2026): the log as a story, the last 24 hours, the top bar --------------

const H = 3_600_000;
const T0 = Date.parse('2026-10-08T21:00:00-04:00');
// The owner's real link of 8–9 Oct 2026, its events as it saved them (the web copy stopped with the Mac's restart).
const REAL = [
  [7, 'stopped', 'Stopped (stopped)'], [251, 'stopped', 'Stopped (handed over)'], [252, 'stopped', 'Stopped (stopped)'], [253, 'stopped', 'Stopped (handed over)'], [254, 'stopped', 'Stopped (stopped)'],
  [7334, 'stopped', 'Stopped (the login changed)'], [7334.4, 'signin', 'Signed in'], [7335, 'live', 'Live: the calculator opened the session'],
  ...DESIGN.map((d, i) => [7336 + i * 0.02, 'report', `Filed a feature request: ${d.title}`]),
  [15215, 'drop', 'The connection dropped (close 1006 "Connection ended"): reconnecting'], [15216, 'drop', 'The connection dropped (close 1006 "Connection ended"): reconnecting'],
  [15218, 'drop', 'The connection dropped (close 1006 "Connection ended"): reconnecting'], [15222, 'drop', 'The connection dropped (close 1006 "Connection ended"): reconnecting'],
  [15229, 'live', 'Live: the calculator opened the session'],
].map(([s, kind, text]) => ({ at: T0 + s * 1000, kind, text }));
const BOOT = T0 + 11 * H + 54 * 60_000; // 08:54 the next morning

test('the log as a story: one row per outage, the reports as one, a new login with its sign-in, a restart', () => {
  const rows = storyOf(REAL, { now: BOOT + 30 * 60_000, bootAt: BOOT });
  expect(rows.map((r) => r.text)).toEqual([
    'This Mac restarted',
    'Dropped, back 14 s later',
    'Filed 7 feature requests with the calculator',
    'New login saved · signed in · live',
    'Switched where it runs, back and forth',
    'Stopped',
  ]);
  expect(rows[0]).toMatchObject({ kind: 'restart', lane: 'prob', sub: 'the link did not start again' });
  expect(rows[1]).toMatchObject({ kind: 'outage', lane: 'prob', sub: 'the network · close 1006 “Connection ended” · 4 tries' });
  expect(rows[2]).toMatchObject({ kind: 'report', lane: 'rep', n: 7 });
  expect(rows[4].sub).toBe('4 steps in 3 s');
  // still down: one row that counts its tries so far; a session that ran out is a new sign-in, not an outage
  const down = storyOf([...REAL.slice(0, -1)], { now: T0 + 15225_000 });
  expect(down[0]).toMatchObject({ kind: 'down', text: 'Dropped: trying again', sub: 'the network · close 1006 “Connection ended” · 4 tries so far' });
  const renew = storyOf([{ at: T0, kind: 'start', text: 'Started as its own background service' }, { at: T0 + 1000, kind: 'signin', text: 'Signed in' }, { at: T0 + 2000, kind: 'live', text: 'Live' },
    { at: T0 + 2 * H, kind: 'drop', text: 'The session ran out after 2 h (close 1008 "unauthorized"): signing in again' }, { at: T0 + 2 * H + 500, kind: 'signin', text: 'Signed in again: the session had run out' }, { at: T0 + 2 * H + 900, kind: 'live', text: 'Live' },
    { at: T0 + 3 * H, kind: 'report', text: 'Problem seen: Sessions run out within minutes. It is filed once, with the next session' }]);
  expect(renew.map((r) => r.text)).toEqual(['Problem seen: Sessions run out within minutes', 'The session ran out: signed in again', 'Started as its background service · signed in · live']);
  expect(renew[1].sub).toBe('it lasted 2 h');
  // a restart the service started with
  const back = storyOf([...REAL, { at: BOOT + 40_000, kind: 'start', text: 'Started as its own background service' }], { now: BOOT + H, bootAt: BOOT });
  expect(back.find((r) => r.kind === 'restart').sub).toBe('the link started with it');
});

test('the last 24 hours: live, the drop, no record after its last word, not running since the restart; a kept "still running" mark ends what is not known', () => {
  const now = BOOT + 30 * 60_000;
  const d = dayOf(REAL, { now, bootAt: BOOT });
  expect(d.to - d.from).toBe(24 * H);
  const kinds = d.segs.map((x) => x.s);
  expect(kinds).toEqual(['none', 'off', 'up', 'down', 'up', 'none', 'off']);
  expect(d.segs[3].b - d.segs[3].a).toBe(14_000);
  expect(d.segs.at(-1)).toMatchObject({ s: 'off', a: BOOT, b: now });
  // with the mark the link now keeps each minute: live until then, not running after
  const kept = dayOf(REAL, { now, bootAt: BOOT, aliveAt: BOOT - 60_000 });
  expect(kept.segs.map((x) => x.s).slice(-2)).toEqual(['up', 'off']);
  expect(kept.segs.at(-1).a).toBe(BOOT - 60_000 + 1);
  // running: the state carries on to now
  expect(dayOf(REAL, { now, running: true }).segs.at(-1)).toMatchObject({ s: 'up', b: now });
  // started again 48 minutes after the restart (as on 9 Oct): not running from the restart until then, live after
  const late = [...REAL, { at: BOOT + 48 * 60_000, kind: 'signin', text: 'Signed in' }, { at: BOOT + 48 * 60_000 + 400, kind: 'live', text: 'Live' }];
  const again = dayOf(late, { now: BOOT + H, bootAt: BOOT, running: true });
  expect(again.segs.map((x) => x.s).slice(-4)).toEqual(['up', 'none', 'off', 'up']);
  expect(again.segs.at(-2)).toMatchObject({ a: BOOT, b: BOOT + 48 * 60_000 + 400 });
  expect(storyOf(late, { now: BOOT + H, bootAt: BOOT }).find((r) => r.kind === 'restart').sub).toBe('the link was not running until it was started again, 48 min later');
});

test('the link keeps a "still running" mark and a start line; the saved counts show only on their own day', async () => {
  const c = fakeThesis();
  const dir = dirOf();
  const l = linkTo(c, { dir, opts: { where: 'service' } });
  l.start();
  await live(l);
  await until(() => l.status().aliveAt);
  const st = l.status();
  expect(st.startedAt).toBeGreaterThan(0);
  expect(st.events.at(-1)).toMatchObject({ kind: 'start', text: 'Started as its own background service' });
  expect(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).aliveAt).toBe(st.aliveAt);
  l.stop();
  const s = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ ...s, counts: { day: '2026-10-08', drops: 1 }, reports: { a: { key: 'a', title: 'T', text: 'what was sent', status: 'filed' } } }));
  expect(savedState(dir, Date.parse('2026-10-09T09:00:00-04:00')).counts).toEqual({});
  expect(savedState(dir, Date.parse('2026-10-08T12:00:00-04:00')).counts).toMatchObject({ drops: 1 });
  expect(savedState(dir).reports[0].text).toBe('what was sent');
  expect(savedState(dir).aliveAt).toBe(st.aliveAt);
});

test('the tab: its story, the last 24 hours and this Mac\'s start; the top bar\'s brief; a first login on a Mac starts its background service', async () => {
  const c = fakeThesis();
  saveSettings({ calc: { url: null, user: null, pass: null, link: null } });
  const calls = [];
  const run = (a) => { calls.push(a.join(' ')); return { status: a[0] === 'print' ? 113 : 0, stdout: '', stderr: '' }; };
  let clock = BOOT + H; // the tab's clock: the morning of 9 Oct, then the real one for the link that runs now
  const hub = calcHub({ run, program: ['/app'], boot: () => BOOT, now: () => clock ?? Date.now() });
  const go = (path, body) => hub.route(new Request(`http://127.0.0.1:1${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), new URL(`http://127.0.0.1:1${path}`));
  expect(await (await go('/calc/brief.json')).json()).toMatchObject({ set: false, running: false, words: 'no login saved' });
  const v = await (await go('/calc.json')).json();
  expect(v).toMatchObject({ bootAt: BOOT, now: BOOT + H, link: null });
  expect(Array.isArray(v.story) && v.day.segs.length >= 1).toBe(true);
  // the first login: its own background service (on a Mac), the LaunchAgent written and loaded
  await go('/calc/login', { url: c.url, user: 'me', pass: PASS });
  if (process.platform === 'darwin') {
    expect(loadSettings().calc.link).toBe('service');
    expect(calls.some((x) => x.startsWith('bootstrap gui/'))).toBe(true);
    expect(readFileSync(join(process.env.AGENTIC_LAUNCH_DIR, 'com.agentic-coder.calc-link.plist'), 'utf8')).toContain('<string>/app</string><string>calc</string><string>run</string>');
  }
  expect(await (await go('/calc/brief.json')).json()).toMatchObject({ set: true, running: false, tone: 'bad', words: 'not running' });
  // a place picked already is never changed by a new login
  calls.length = 0;
  saveSettings({ calc: { ...loadSettings().calc, link: 'web' } });
  await go('/calc/login', { pass: 'another' });
  expect(loadSettings().calc.link).toBe('web');
  expect(calls.some((x) => x.startsWith('bootstrap'))).toBe(false);
  // running and live: the brief says so
  clock = null;
  saveSettings({ calc: { url: c.url, user: 'me', pass: PASS, link: 'web' } });
  const web = linkHost({ where: 'web', every: 3_600_000, linkOpts: { ...FAST, fileDesign: false } });
  stops.push(() => web.stop());
  await web.tick();
  await until(async () => (await askLink('/status'))?.state === 'live');
  expect(await (await go('/calc/brief.json')).json()).toMatchObject({ set: true, running: true, tone: 'ok', words: 'live' });
  const live = await (await go('/calc.json')).json();
  expect(live.story[0].text).toContain('Started inside the web');
  expect(live.day.segs.at(-1).s).toBe('up');
  web.stop();
});

test('the background service runs the installed app when there is one, never a working copy that may go away', () => {
  const home = mkdtempSync(join('/tmp', 'acw-home-'));
  expect(programNow({ argv: ['bun', '/Users/x/worktrees/a/terminal/src/cli.jsx'], execPath: '/bun', home })).toEqual(['/bun', '/Users/x/worktrees/a/terminal/src/cli.jsx']);
  expect(programNow({ argv: ['bun', '/Users/x/Desktop/a/cli.jsx'], execPath: '/bun', home })).toBeNull();
  mkdirSync(join(home, '.agentic-coder', 'app'), { recursive: true });
  writeFileSync(join(home, '.agentic-coder', 'app', 'agentic-coder'), '');
  expect(programNow({ argv: ['bun', '/Users/x/worktrees/a/terminal/src/cli.jsx'], execPath: '/bun', home })).toEqual([join(home, '.agentic-coder', 'app', 'agentic-coder')]);
});
