// The calculator link (8 Oct 2026, the owner: "a daemon that connects to this API … detect that the
// connection dropped and restore it … refresh the token or session whenever necessary … if it's having
// an issue with the authentication system design, submit a bug or feature request").
// One always-on connection to the Thesis calculator: signed in with the owner's calculator login (the
// web settings' calc row), its websocket kept open, and that one session shared by everything that
// needs a sign-in (formulas, the request box). It runs in one place only, picked by settings.calc.link:
//   'web'      inside Agentic Coder Web (the default): it runs while the web runs
//   'service'  its own background service (coding calc on: a LaunchAgent that runs coding calc run)
// Whichever runs it answers on a local control socket (<web home>/calc-link/link.sock), which the hub's
// Calculator tab, /calc, coding calc and the other place read; the socket is also the lock.
//
// The server as read on 8 Oct 2026 (the owner's calculator and its /api/docs):
//   POST /api/login {userName, password} → {ok, sessionId}; a wrong login → 401 "Invalid credentials".
//   No refresh route and no sign-out: a new session is a new sign-in with the saved password.
//   ws://host/ws?sessionId=…&userName=… : the server opens the session itself and sends sessionReady.
//   A session it does not know or that ran out → {type: 'error', message: 'Unknown or expired session'}
//   and close 1008 "unauthorized". Any other close is the network.
//   POST /api/requests {kind: issue|feature, title, description} and GET /api/requests (yours, newest
//   first) with the session as a Bearer token: where the reports go. That store may be wiped, so the
//   link keeps its own record and never files one problem twice.
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { webHome, loadSettings } from './config.mjs';

export const HEARTBEAT_MS = 20_000;
const TIMEOUT_MS = 15_000;

export const linkDir = () => join(webHome(), 'calc-link');
// macOS keeps a socket's path under 104 bytes: a long web home's socket goes in /tmp under its hash.
export function sockPath(dir = linkDir()) {
  const p = join(dir, 'link.sock');
  return p.length <= 100 ? p : join('/tmp', `acw-calc-${createHash('sha256').update(dir).digest('hex').slice(0, 12)}.sock`);
}
export const linkWhere = (calc) => (calc?.link === 'service' ? 'service' : 'web');
const clean = (u) => (u ? String(u).replace(/\/+$/, '') : null);

// ---- the reports ------------------------------------------------------------------------------

const FOOT = '\n\nFiled by the calculator link in Agentic Coder (it files each problem once).';
// The sign-in design problems found on 8 Oct 2026 in /api/docs and the live server, filed once after
// the first sign-in (the owner's pick). The expiry one is skipped when the login reply carries one.
export const DESIGN = [
  { key: 'design-refresh', kind: 'feature', title: 'Add a way to refresh a session',
    text: 'There is no route that renews or extends a session: POST /api/login is the only way to get a new sessionId. A client that stays connected for days therefore has to keep the user\'s password to sign in again whenever the session runs out. Please add a refresh route (for example POST /api/session/refresh, old session in, new session out) or a refresh token in the login reply.' },
  { key: 'design-expiry', kind: 'feature', title: 'Say how long a session lasts',
    text: 'The docs do not say how long a session lives, or whether activity (an open websocket, API calls) keeps it alive, and the login reply has no expiry. A client can only find out when the session is refused. Please return expiresAt (or expiresIn) with the sessionId and document the rule.' },
  { key: 'design-ws-address', kind: 'feature', title: 'Take the websocket session out of the address',
    text: 'The websocket takes the session in its address (/ws?sessionId=…&userName=…), so the session id lands in proxy and server access logs, where anyone who reads them can use it until it runs out. Please accept it in the first message (openSession) or in the Sec-WebSocket-Protocol header instead.' },
  { key: 'design-one-message', kind: 'feature', title: 'Tell an expired session from an unknown one',
    text: 'A refused websocket session gets {type: "error", message: "Unknown or expired session"} and close 1008 "unauthorized" in both cases, and REST answers 401 "Invalid session token" without a code. A client cannot tell a session that ran out (sign in again) from one the server never knew or revoked (stop and alert). Please give the two cases their own codes (for example close 4401 expired / 4403 unknown, and a code field in 401 replies).' },
  { key: 'design-sign-out', kind: 'feature', title: 'Add a sign-out route',
    text: 'The API lists no way to end a session (for example POST /api/logout). A client that signs in again, or stops for good, leaves its old session usable until it runs out by itself. Please add a route that ends the caller\'s session.' },
  { key: 'design-heartbeat', kind: 'feature', title: 'Document a heartbeat for the websocket',
    text: 'The websocket contract has no ping or heartbeat message, and the docs do not say whether websocket ping frames are answered or how long a quiet socket is kept open. A client cannot tell a connection that silently died from a session with nothing to say. Please document it, or add a ping/pong message type.' },
  { key: 'design-auth-docs', kind: 'feature', title: 'Document which routes need which sign-in',
    text: 'living_openapi.json has no securitySchemes and no security on any route, and the docs do not say where the admin API keys (/api/admin/api-keys) are accepted: as a Bearer token on /api/formulas and /api/requests? on the websocket? Please add the schemes to the OpenAPI document so clients and generated code know which credential each route takes.' },
];
// Problems the link runs into while it works: filed the first time each is seen.
export const PROBLEMS = {
  'rejected-after-sign-in': { kind: 'issue', title: 'A new session is refused by the websocket',
    text: (d) => `A session straight from POST /api/login was refused by the websocket ${secs(d.lived)} after the sign-in (close ${d.code}${d.reason ? ` "${d.reason}"` : ''}). The login said yes, so the websocket should accept the session it just gave out.` },
  'api-refuses-new-session': { kind: 'issue', title: 'A new session is refused by the API',
    text: (d) => `A session straight from POST /api/login was refused with 401 by ${d.path ?? 'an API route'} ${secs(d.age)} after the sign-in. The login said yes, so the routes that take a Bearer session should accept it.` },
  'login-server-error': { kind: 'issue', title: 'Sign-in answers a server error',
    text: (d) => `POST /api/login answered ${d.status} ${d.times} times in a row (the last at ${new Date(d.at).toISOString()}). A server error on sign-in leaves every client that must sign in again (there is no refresh route) without a session until it clears.` },
  'short-session': { kind: 'issue', title: 'Sessions run out within minutes',
    text: (d) => `Sessions ran out ${secs(d.lived)} after sign-in while the websocket was open and in use. With no refresh route, a client has to sign in again with the password this often. If this is meant, please say so in the docs (and see the request to state how long a session lasts).` },
};
const secs = (ms) => (ms < 90_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

// ---- the link ---------------------------------------------------------------------------------

const WORDS = {
  idle: 'Not started', 'no-address': 'No calculator address yet', 'no-login': 'No calculator login saved',
  'signing-in': 'Signing in', connecting: 'Connecting', live: 'Live', waiting: 'Trying again soon',
  'login-wrong': 'The calculator says the username or password is wrong', stopped: 'Stopped',
};

// config(): { url, user, pass } (read each time, so a new login is picked up by reload()).
export class CalcLink {
  constructor({ config, dir = linkDir(), where = 'web', log = () => {}, WS = globalThis.WebSocket, fetchFn = (...a) => fetch(...a),
    heartbeatMs = HEARTBEAT_MS, pongWaitMs = 10_000, openWaitMs = 10_000, baseWaitMs = 1000, maxWaitMs = 60_000, minLifeMs = 60_000, fileDesign = true, now = () => Date.now() } = {}) {
    Object.assign(this, { config, dir, where, log, WS, fetchFn, heartbeatMs, pongWaitMs, openWaitMs, baseWaitMs, maxWaitMs, minLifeMs, fileDesign, now });
    this.state = 'idle'; this.since = now();
    this.session = null; this.ws = null; this.attempt = 0; this.stopped = true;
    this.timer = null; this.beat = null; this.refreshTimer = null; this.pongTimer = null;
    this.waiters = new Set(); this.serverErrors = 0; this.healthMiss = 0; this.lastError = null; this.nextTryAt = null;
    this.saved = this.load();
  }

  cfg() { const c = this.config?.() ?? {}; return { url: clean(c.url), user: c.user || null, pass: c.pass || null }; }
  key() { const c = this.cfg(); return `${c.url}|${c.user}|${c.pass ? createHash('sha256').update(c.pass).digest('hex').slice(0, 16) : ''}`; }
  words() { return this.state === 'waiting' && this.nextTryAt ? `Trying again in ${Math.max(1, Math.round((this.nextTryAt - this.now()) / 1000))} s` : WORDS[this.state] ?? this.state; }

  // ---- what it keeps (no password, no session id): the reports, the session lengths seen, the day's counts, the last events
  load() {
    let s = {};
    try { s = JSON.parse(readFileSync(join(this.dir, 'state.json'), 'utf8')); } catch { /* a first start */ }
    return { reports: s.reports ?? {}, lifetimes: s.lifetimes ?? [], events: s.events ?? [], counts: s.counts ?? {}, designQueued: Boolean(s.designQueued) };
  }
  save() {
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const f = join(this.dir, 'state.json');
      writeFileSync(`${f}.tmp`, `${JSON.stringify(this.saved, null, 1)}\n`, { mode: 0o600 });
      renameSync(`${f}.tmp`, f);
    } catch (e) { this.log(`calc link: could not save its state (${e.message})`); }
  }
  event(kind, text) {
    this.saved.events.push({ at: this.now(), kind, text });
    if (this.saved.events.length > 120) this.saved.events.splice(0, this.saved.events.length - 120);
    this.log(`calc link: ${text}`);
    this.save();
  }
  count(k) {
    const day = new Date(this.now()).toLocaleDateString('en-CA');
    if (this.saved.counts.day !== day) this.saved.counts = { day };
    this.saved.counts[k] = (this.saved.counts[k] ?? 0) + 1;
  }
  set(state) {
    if (state !== this.state) { this.state = state; this.since = this.now(); }
    if (state === 'login-wrong' || state === 'no-login' || state === 'no-address' || state === 'stopped') this.fail(new Error(this.words()));
  }

  // ---- start, stop, a new login
  start() {
    this.stopped = false;
    this.started = this.key();
    const c = this.cfg();
    if (!c.url) { this.set('no-address'); return; }
    if (!c.user || !c.pass) { this.set('no-login'); return; }
    if (!this.beat) { this.lastTick = this.now(); this.beat = setInterval(() => this.heartbeat(), this.heartbeatMs); }
    this.signIn('start');
  }
  stop(why = 'stopped') {
    if (this.stopped && this.state === 'stopped') return;
    const was = this.state;
    this.stopped = true;
    clearInterval(this.beat); this.beat = null;
    this.clearTimers();
    this.closeWs(1000, why);
    this.session = null;
    this.set('stopped');
    if (was !== 'idle' && was !== 'stopped') this.event('stopped', `Stopped (${why})`);
  }
  // The login or address changed (the hub, Admin → Settings): start over with it; the same one: nothing.
  reload() {
    if (this.key() === this.started && this.state !== 'stopped') return false;
    this.stop('the login changed');
    this.attempt = 0; this.serverErrors = 0;
    this.start();
    return true;
  }
  // Asked for (the hub, /calc, Admin): with no address or login saved, only the check that says so.
  ready() { const c = this.cfg(); return Boolean(c.url && c.user && c.pass); }
  reconnectNow() {
    if (this.stopped || !this.ready()) return this.start();
    this.attempt = 0;
    this.event('asked', 'Reconnecting now (asked for)');
    if (this.session) { this.closeWs(1000, 'reconnect'); this.clearTimers(); this.connect(); } else this.signIn('asked');
  }
  signInNow() {
    if (this.stopped || !this.ready()) return this.start();
    this.attempt = 0;
    this.closeWs(1000, 'sign in again'); this.clearTimers();
    this.session = null;
    this.signIn('asked');
  }

  clearTimers() {
    clearTimeout(this.timer); this.timer = null; this.nextTryAt = null;
    clearTimeout(this.refreshTimer); this.refreshTimer = null;
    clearTimeout(this.pongTimer); this.pongTimer = null;
  }
  closeWs(code = 1000, reason = '') {
    const ws = this.ws; this.ws = null;
    if (ws) try { ws.close(code, reason); } catch { /* gone already */ }
  }

  // One call to the calculator: { ok, status, json } (throws only when it cannot be reached).
  async http(path, { method = 'GET', body, token } = {}) {
    const res = await this.fetchFn(`${this.cfg().url}${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let json = null;
    try { json = JSON.parse(await res.text()); } catch { /* not JSON */ }
    return { ok: res.ok, status: res.status, json };
  }

  // Try again after a wait that doubles each time (1 s, 2 s, 4 s … up to a minute), give or take a fifth,
  // so many clients coming back at once do not all knock at the same moment.
  later(why, fn) {
    if (this.stopped) return;
    const ms = Math.round(Math.min(this.maxWaitMs, this.baseWaitMs * 2 ** this.attempt) * (0.8 + Math.random() * 0.4));
    this.attempt++;
    this.lastError = why;
    clearTimeout(this.timer);
    this.nextTryAt = this.now() + ms;
    this.retry = fn;
    this.set('waiting');
    this.timer = setTimeout(() => { this.timer = null; this.nextTryAt = null; this.retry = null; fn(); }, ms);
  }

  // ---- signing in (there is no refresh: a new session is a new sign-in)
  signIn(why) {
    if (this.stopped) return null;
    if (this.signingIn) return this.signingIn;
    clearTimeout(this.timer); this.timer = null; this.nextTryAt = null;
    clearTimeout(this.refreshTimer); this.refreshTimer = null;
    this.set('signing-in');
    const c = this.cfg();
    if (!c.url || !c.user || !c.pass) { this.set(c.url ? 'no-login' : 'no-address'); return null; }
    this.signingIn = (async () => {
      let r;
      try { r = await this.http('/api/login', { method: 'POST', body: { userName: c.user, password: c.pass } }); } catch (e) {
        this.event('retry', `Could not reach the calculator to sign in (${e.name === 'TimeoutError' ? 'no answer in 15 s' : e.message})`);
        return this.later(`could not reach the calculator (${e.message})`, () => this.signIn('retry'));
      }
      if (this.stopped) return;
      if (r.status === 401 || r.status === 403) {
        // Never again by itself: a wrong password tried over and over can lock the account.
        this.lastError = r.json?.message ?? `the calculator answered ${r.status}`;
        this.event('wrong-login', `Sign-in refused (${this.lastError}): waiting for a new login`);
        this.set('login-wrong');
        return;
      }
      if (r.status >= 500) {
        this.serverErrors++;
        if (this.serverErrors >= 3) this.problem('login-server-error', { status: r.status, times: this.serverErrors, at: this.now() });
        this.event('retry', `Sign-in answered ${r.status} (a server error)`);
        return this.later(`sign-in answered ${r.status}`, () => this.signIn('retry'));
      }
      const id = r.json?.sessionId ?? r.json?.token ?? r.json?.session?.id ?? null;
      if (!r.ok || !id) {
        this.event('retry', `Sign-in answered ${r.status} without a session`);
        return this.later(`sign-in answered ${r.status} without a session`, () => this.signIn('retry'));
      }
      this.serverErrors = 0;
      const t = this.now();
      this.session = { id, at: t, expiresAt: expiryOf(r.json, t), wasLive: false };
      this.loginHasExpiry = this.session.expiresAt != null;
      this.count('signIns');
      this.event('signin', { start: 'Signed in', retry: 'Signed in', asked: 'Signed in again (asked for)', expired: 'Signed in again: the session had run out', refresh: 'Signed in again before the session runs out' }[why] ?? 'Signed in');
      this.wake();
      this.connect();
      this.fileReports();
    })().finally(() => { this.signingIn = null; });
    return this.signingIn;
  }

  // ---- the websocket
  connect() {
    if (this.stopped || !this.session) return;
    clearTimeout(this.timer); this.timer = null; this.nextTryAt = null;
    this.closeWs(1000, 'replaced');
    this.set('connecting');
    const c = this.cfg();
    const session = this.session;
    let ws;
    try { ws = new this.WS(`${c.url.replace(/^http/, 'ws')}/ws?sessionId=${encodeURIComponent(session.id)}&userName=${encodeURIComponent(c.user)}`); } catch (e) {
      return this.dropped({ code: 0, reason: e.message }, session);
    }
    this.ws = ws;
    this.pongSeen = false; this.healthMiss = 0;
    const openTimer = setTimeout(() => {
      if (this.ws !== ws || ws.readyState === 1) return;
      this.ws = null;
      try { ws.close(); } catch { /* never opened */ }
      this.dropped({ code: 0, reason: `no answer in ${Math.round(this.openWaitMs / 1000)} s` }, session);
    }, this.openWaitMs);
    ws.addEventListener('open', () => { clearTimeout(openTimer); });
    ws.addEventListener('message', (e) => {
      if (this.ws !== ws) return;
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'sessionReady') {
        const back = session.wasLive || this.saved.lastLive != null;
        session.wasLive = true; this.attempt = 0; this.lastError = null; this.healthMiss = 0;
        this.set('live');
        if (back && this.dropCount) this.count('reconnects');
        this.dropCount = 0;
        this.saved.lastLive = this.now();
        this.event('live', 'Live: the calculator opened the session');
        this.planRefresh();
      } else if (m.type === 'error' && /expired|unknown|session/i.test(String(m.message ?? ''))) session.gone = true;
    });
    ws.addEventListener('pong', () => { if (this.ws !== ws) return; this.pongSeen = true; clearTimeout(this.pongTimer); this.pongTimer = null; });
    ws.addEventListener('close', (e) => {
      clearTimeout(openTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      this.dropped({ code: e.code, reason: e.reason }, session);
    });
    ws.addEventListener('error', () => { /* a close follows */ });
  }

  // The connection closed by itself: a refused session signs in again, anything else reconnects with the same one.
  dropped({ code, reason }, session) {
    if (this.stopped) return;
    clearTimeout(this.pongTimer); this.pongTimer = null;
    clearTimeout(this.refreshTimer); this.refreshTimer = null;
    const wasLive = this.state === 'live';
    if (wasLive) { this.count('drops'); this.dropCount = (this.dropCount ?? 0) + 1; this.saved.lastDrop = { at: this.now(), code, reason: reason || null }; }
    const refused = code === 1008 || /unauthori[sz]ed/i.test(reason ?? '') || session?.gone;
    if (refused && session && this.session === session) {
      const lived = this.now() - session.at;
      this.session = null;
      if (session.wasLive) {
        this.saved.lifetimes = [...this.saved.lifetimes, lived].slice(-5);
        if (lived < 5 * 60_000 && this.saved.lifetimes.length >= 2 && this.saved.lifetimes.slice(-2).every((x) => x < 5 * 60_000)) this.problem('short-session', { lived });
      } else if (lived < 15_000) {
        this.problem('rejected-after-sign-in', { lived, code, reason });
        this.event('drop', `The calculator refused the new session (close ${code}${reason ? ` "${reason}"` : ''})`);
        return this.later('the calculator refused a new session', () => this.signIn('expired'));
      }
      this.event('drop', `The session ran out after ${secs(lived)} (close ${code}${reason ? ` "${reason}"` : ''}): signing in again`);
      this.signIn('expired');
      return;
    }
    const what = code === 4000 ? 'went quiet' : code === 0 ? 'could not open' : 'dropped';
    this.event('drop', `The connection ${what} (${code ? `close ${code}` : reason}${code && reason ? ` "${reason}"` : ''}): reconnecting`);
    this.later(`the connection ${what}`, () => this.connect());
  }

  // ---- the heartbeat: every 20 s a websocket ping (an answer within 10 s, or the connection is dead
  // without saying so); a server that never answers pings gets a /health check instead. A tick that comes
  // far too late means this Mac slept: check now, and a wait for a retry ends now.
  async heartbeat() {
    const t = this.now();
    const gap = t - (this.lastTick ?? t);
    this.lastTick = t;
    if (this.stopped) return;
    if (gap > this.heartbeatMs * 3) {
      this.event('woke', `Back after about ${secs(gap)} away (this Mac slept): checking the connection`);
      if (this.state === 'waiting' && this.retry) { const fn = this.retry; clearTimeout(this.timer); this.timer = null; this.nextTryAt = null; this.retry = null; this.attempt = 0; fn(); return; }
    }
    const ws = this.ws;
    if (!ws || ws.readyState !== 1 || this.state !== 'live') return;
    try { ws.ping(); } catch { /* a close follows */ }
    if (this.pongSeen) {
      // A pong still owed keeps its deadline: a new ping never moves it on.
      if (!this.pongTimer) this.pongTimer = setTimeout(() => { this.pongTimer = null; if (this.ws === ws) this.silent(ws); }, this.pongWaitMs);
    } else {
      const ok = await this.http('/health').then((r) => r.ok, () => false);
      this.healthMiss = ok ? 0 : this.healthMiss + 1;
      if (this.healthMiss >= 2 && this.ws === ws) this.silent(ws);
    }
  }
  silent(ws) {
    this.count('missedBeats');
    this.ws = null;
    try { ws.close(4000, 'no answer to the heartbeat'); } catch { /* gone */ }
    this.dropped({ code: 4000, reason: 'no answer to the heartbeat' }, this.session);
  }

  // ---- before the session runs out: at 4/5 of its life (the login reply's expiry, else the shortest one
  // seen), sign in again and move to the new session. Never sooner than a minute.
  planRefresh() {
    clearTimeout(this.refreshTimer); this.refreshTimer = null;
    const s = this.session;
    if (!s) return;
    const life = s.expiresAt ? s.expiresAt - s.at : this.saved.lifetimes.length ? Math.min(...this.saved.lifetimes) : null;
    if (!life || life < this.minLifeMs) { s.refreshAt = null; return; }
    s.refreshAt = s.at + Math.round(life * 0.8);
    this.refreshTimer = setTimeout(() => {
      if (this.stopped || this.session !== s) return;
      this.count('refreshed');
      this.closeWs(1000, 'refresh');
      this.session = null;
      this.signIn('refresh');
    }, Math.max(1000, s.refreshAt - this.now()));
  }

  // ---- the session for others: now if signed in, else wait (up to 15 s) for the next sign-in
  sessionId({ wait = 15_000 } = {}) {
    if (this.session && !this.session.gone) return Promise.resolve(this.session.id);
    if (['login-wrong', 'no-login', 'no-address', 'stopped'].includes(this.state)) return Promise.reject(new Error(`the calculator link: ${this.words()}`));
    return new Promise((res, rej) => {
      const w = { res, rej };
      w.t = setTimeout(() => { this.waiters.delete(w); rej(new Error(`the calculator link is down (${this.lastError ?? this.words()})`)); }, wait);
      this.waiters.add(w);
    });
  }
  wake() { for (const w of this.waiters) { clearTimeout(w.t); w.res(this.session.id); } this.waiters.clear(); }
  fail(e) { for (const w of this.waiters) { clearTimeout(w.t); w.rej(e); } this.waiters.clear(); }
  // A route answered 401 to this session: sign in again (a session refused right after its sign-in is a
  // problem to file, and waits like a drop so it never becomes a sign-in loop).
  rejected(id, { path } = {}) {
    if (this.session && this.session.id === id) {
      const age = this.now() - this.session.at;
      this.session = null;
      this.closeWs(1000, 'session refused');
      if (age < 15_000) {
        this.problem('api-refuses-new-session', { age, path });
        this.event('drop', `${path ?? 'The API'} refused the new session: signing in again shortly`);
        this.later('the API refused a new session', () => this.signIn('expired'));
      } else {
        this.event('drop', `${path ?? 'The API'} said the session had run out: signing in again`);
        this.signIn('expired');
      }
    }
    return this.sessionId();
  }

  // ---- the reports: each problem filed once (this record first, then the server's own list)
  problem(key, d = {}) {
    const p = PROBLEMS[key];
    const r = this.saved.reports[key];
    if (r) { r.seen = (r.seen ?? 1) + 1; r.lastSeen = this.now(); this.save(); return; }
    this.saved.reports[key] = { key, kind: p.kind, title: p.title, text: p.text(d), status: 'waiting', at: this.now(), seen: 1, tries: 0 };
    this.event('report', `Problem seen: ${p.title}. It is filed once, with the next session`);
    this.fileReports();
  }
  async fileReports() {
    if (this.filing || !this.session || this.stopped) return;
    if (this.fileDesign && !this.saved.designQueued) {
      for (const f of DESIGN) {
        if (f.key === 'design-expiry' && this.loginHasExpiry) continue;
        if (!this.saved.reports[f.key]) this.saved.reports[f.key] = { key: f.key, kind: f.kind, title: f.title, text: f.text, status: 'waiting', at: this.now(), seen: 1, tries: 0, design: true };
      }
      this.saved.designQueued = true;
      this.save();
    }
    const todo = Object.values(this.saved.reports).filter((r) => r.status === 'waiting' || (r.status === 'failed' && r.tries < 3));
    if (!todo.length) return;
    this.filing = true;
    const token = this.session.id;
    const c = this.cfg();
    // Nothing secret in a report: the password and the session never go in one, whatever the text.
    const scrub = (s) => [c.pass, token].filter((x) => x && x.length >= 4).reduce((t, x) => t.split(x).join('[hidden]'), String(s));
    try {
      let theirs = [];
      try { const l = await this.http('/api/requests', { token }); theirs = listOf(l.json); } catch { /* filed anyway */ }
      for (const r of todo) {
        if (this.stopped || !this.session) break;
        const same = theirs.find((x) => String(x?.title ?? '').trim().toLowerCase() === r.title.toLowerCase());
        if (same) { Object.assign(r, { status: 'filed', id: same.id ?? null, filedAt: this.now(), note: 'already on the server', error: null }); continue; }
        let res;
        try { res = await this.http('/api/requests', { method: 'POST', token, body: { kind: r.kind, title: scrub(r.title), description: scrub(`${r.text}${FOOT}`) } }); } catch (e) { res = { ok: false, status: 0, json: { message: e.message } }; }
        r.tries++;
        if (res.ok) {
          Object.assign(r, { status: 'filed', id: res.json?.request?.id ?? res.json?.id ?? res.json?.requestId ?? null, filedAt: this.now(), error: null });
          this.count('filed');
          this.event('report', `Filed ${r.kind === 'feature' ? 'a feature request' : 'an issue'}: ${r.title}`);
        } else {
          Object.assign(r, { status: 'failed', error: `${res.status || 'no answer'}: ${res.json?.message ?? res.json?.error ?? ''}`.trim() });
          if (res.status === 401) break;
        }
      }
    } finally { this.filing = false; this.save(); }
  }

  status() {
    const c = this.cfg();
    const s = this.session;
    const t = this.now();
    return {
      running: true, where: this.where, pid: process.pid, state: this.state, words: this.words(), since: this.since,
      url: c.url, user: c.user, hasPass: Boolean(c.pass),
      session: s ? { at: s.at, ageMs: t - s.at, expiresAt: s.expiresAt ?? null, refreshAt: s.refreshAt ?? null } : null,
      nextTryAt: this.nextTryAt, lastError: this.lastError, heartbeatMs: this.heartbeatMs, pings: Boolean(this.pongSeen),
      lifetimes: this.saved.lifetimes, lastDrop: this.saved.lastDrop ?? null, lastLive: this.saved.lastLive ?? null,
      counts: this.saved.counts.day === new Date(t).toLocaleDateString('en-CA') ? this.saved.counts : {},
      reports: Object.values(this.saved.reports).map(({ text, ...r }) => r),
      events: this.saved.events.slice(-60).reverse(),
    };
  }
}

// The expiry a login reply may carry (none did on 8 Oct 2026): expiresAt (a date or ms), expiresIn or ttl (s).
export function expiryOf(j, t = Date.now()) {
  const at = j?.expiresAt ?? j?.session?.expiresAt;
  if (at != null) { const ms = typeof at === 'number' ? (at < 1e12 ? at * 1000 : at) : Date.parse(at); if (Number.isFinite(ms) && ms > t) return ms; }
  const inS = j?.expiresIn ?? j?.ttl ?? j?.session?.expiresIn;
  if (Number.isFinite(Number(inS)) && Number(inS) > 0) return t + Number(inS) * 1000;
  return null;
}
const listOf = (j) => (Array.isArray(j) ? j : j?.requests ?? j?.items ?? j?.data ?? []);

// ---- the control socket --------------------------------------------------------------------------

// Ask whoever runs the link: its JSON, or null when nothing answers.
export async function askLink(path, { method = 'GET', body, sock = sockPath(), timeout = 2000 } = {}) {
  if (!existsSync(sock)) return null;
  try {
    const r = await fetch(`http://localhost${path}`, { unix: sock, method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
    return await r.json();
  } catch { return null; }
}

// Answer on the socket for this link (null: another one answers there already).
export async function serveLink(link, { sock = sockPath(), onHandover = () => {} } = {}) {
  mkdirSync(dirname(sock), { recursive: true, mode: 0o700 });
  if (existsSync(sock)) {
    if (await askLink('/status', { sock })) return null;
    rmSync(sock, { force: true }); // left by a copy that did not stop cleanly
  }
  const ok = (x) => Response.json(x, { headers: { 'cache-control': 'no-store' } });
  const body = async (req) => { try { return (await req.json()) ?? {}; } catch { return {}; } };
  let srv;
  try {
    srv = Bun.serve({ unix: sock, async fetch(req) {
      const p = new URL(req.url).pathname;
      if (p === '/status') return ok(link.status());
      if (req.method !== 'POST') return ok({ ok: false, error: 'not found' });
      if (p === '/session') { try { return ok({ ok: true, id: await link.sessionId() }); } catch (e) { return ok({ ok: false, error: e.message }); } }
      if (p === '/rejected') { const b = await body(req); try { return ok({ ok: true, id: await link.rejected(String(b.id ?? ''), { path: b.path }) }); } catch (e) { return ok({ ok: false, error: e.message }); } }
      if (p === '/reconnect') { link.reconnectNow(); return ok(link.status()); }
      if (p === '/signin') { link.signInNow(); return ok(link.status()); }
      if (p === '/reload') { link.reload(); return ok(link.status()); }
      if (p === '/handover') { setTimeout(onHandover, 10); return ok({ ok: true }); }
      return ok({ ok: false, error: 'not found' });
    } });
  } catch { return null; } // taken a moment ago by the other place
  try { chmodSync(sock, 0o600); } catch { /* not ours to change */ }
  return { stop: () => { srv.stop(true); rmSync(sock, { force: true }); } };
}

// ---- where it runs ---------------------------------------------------------------------------------

// The link in this process when it is this place's turn (settings.calc.link), checked every few seconds:
// where = 'web' (Agentic Coder Web) or 'service' (coding calc run). The service takes the socket over from
// the web; the web waits while the service has it. Off its turn, a place stops its link (the service then
// leaves: onLeave). readCalc(): the saved calc row, read fresh (the hub writes it). session()/rejected():
// for the formulas: this process's link, or the one the other place runs (same address and user only).
export function linkHost({ where, readCalc = () => loadSettings().calc, log = () => {}, every = 5000, sock = sockPath(), dir = linkDir(), linkOpts = {}, onLeave = () => {}, onCalc = () => {} } = {}) {
  let link = null, served = null, stopped = false, busy = null, lastCalc = '';
  const drop = (why) => {
    if (link) link.stop(why);
    served?.stop();
    link = null; served = null;
  };
  async function tick() {
    if (stopped) return;
    if (busy) return busy;
    busy = (async () => {
      const calc = readCalc() ?? {};
      const k = JSON.stringify(calc);
      if (k !== lastCalc) { lastCalc = k; onCalc(calc); }
      if (linkWhere(calc) !== where) {
        if (link) { log(`calc link: moving to ${linkWhere(calc) === 'service' ? 'its own background service' : 'the web'}`); drop('moved'); if (where === 'service') onLeave(); }
        else if (where === 'service') onLeave();
        return;
      }
      if (link) { link.reload(); return; }
      const other = await askLink('/status', { sock });
      if (other) {
        if (where !== 'service' || other.where === 'service') return; // the other place has it
        await askLink('/handover', { method: 'POST', sock });
        for (let i = 0; i < 40 && existsSync(sock); i++) await Bun.sleep(50);
      }
      const l = new CalcLink({ config: () => readCalc() ?? {}, where, log, dir, ...linkOpts });
      const s = await serveLink(l, { sock, onHandover: () => { log('calc link: handed over to the background service'); drop('handed over'); } });
      if (!s || stopped) { s?.stop(); return; }
      link = l; served = s;
      link.start();
    })().finally(() => { busy = null; });
    return busy;
  }
  const timer = setInterval(() => { tick().catch((e) => log(`calc link: ${e.message}`)); }, every);
  tick().catch((e) => log(`calc link: ${e.message}`));
  const theirs = async () => { const c = readCalc() ?? {}; const st = await askLink('/status', { sock }); return st && st.url === clean(c.url) && st.user === (c.user || null) ? st : null; };
  return {
    tick, link: () => link,
    async status() { return link ? link.status() : askLink('/status', { sock }); },
    // null: no link for this login anywhere (the caller signs in by itself, as before).
    async session() {
      if (link) return link.sessionId();
      if (!(await theirs())) return null;
      const r = await askLink('/session', { method: 'POST', sock, timeout: 17_000 });
      if (!r?.ok) throw new Error(r?.error ?? 'the calculator link did not answer');
      return r.id;
    },
    async rejected(id, o = {}) {
      if (link) return link.rejected(id, o);
      const r = await askLink('/rejected', { method: 'POST', body: { id, path: o.path }, sock, timeout: 17_000 });
      if (!r?.ok) throw new Error(r?.error ?? 'the calculator link did not answer');
      return r.id;
    },
    async act(what) { if (link) { ({ reconnect: () => link.reconnectNow(), signin: () => link.signInNow(), reload: () => link.reload() })[what]?.(); return link.status(); } return askLink(`/${what}`, { method: 'POST', sock }); },
    stop() { stopped = true; clearInterval(timer); drop('stopped'); },
  };
}

// What the link left behind when nothing runs it (the hub shows its reports and last events).
export function savedState(dir = linkDir()) {
  try { const s = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')); return { reports: Object.values(s.reports ?? {}).map(({ text, ...r }) => r), events: (s.events ?? []).slice(-60).reverse(), counts: s.counts ?? {}, lifetimes: s.lifetimes ?? [], lastDrop: s.lastDrop ?? null, lastLive: s.lastLive ?? null }; } catch { return { reports: [], events: [], counts: {}, lifetimes: [], lastDrop: null, lastLive: null }; }
}
