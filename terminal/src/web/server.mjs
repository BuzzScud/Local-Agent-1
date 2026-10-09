// Agentic Coder Web's server (8 Oct 2026, the owner's ask: "a web interface … a backend and tools
// server with API access … multi user support … route requests to my AI and calculator"). One Bun
// server gives:
//   the page                 /, /invite/<t>, /reset/<t> (page.html; it asks the API for the rest)
//   the page's API           /api/me, /api/signin, /api/chats…, /api/files…, /api/keys…, /api/admin/…
//   the API for keys         /api/v1/calc · formulas · models · chat · tasks · files
//   the AI gateway           Ollama's /api/tags, /api/chat… and the OpenAI shape /v1/… (gateway.mjs)
//   the tools server         /mcp (keys) and /mcp/run/<token> (this server's runs, loopback only)
// The Mac copy listens on this Mac and its Tailscale address only; the AI-server copy (mode
// 'server': chat + calculator) listens where it is told, behind a proxy that does https.
import { lanAddresses } from '../../../models/index.mjs';
import { rmSync, existsSync } from 'node:fs';
import PAGE from './page.html' with { type: 'text' };
import { loadSettings, saveSettings, publicSettings, userDir, settingsFile } from './config.mjs';
import { ROLES, ACCESS, roleOf, fitFor, isLastResort } from './models.mjs';
import { openDb, today } from './db.mjs';
import { Auth, sessionCookie, sameOrigin, validName, MIN_PASSWORD, randomWord } from './auth.mjs';
import { Gateway, GATEWAY_PATHS } from './gateway.mjs';
import { FairQueue } from './queue.mjs';
import { Runner } from './runner.mjs';
import { handleMcp } from './mcp-http.mjs';
import { chat as plainChat } from './chat.mjs';
import { calculate, capabilities, formulasClient } from '../tools/calculator.mjs';
import { linkHost } from './calc-link.mjs';
import { listFiles, showFile, fileResponse, putFile, removePath, zipResponse, MAX_UPLOAD } from './files.mjs';

export const WEB_PORT = 60020;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const bad = (error, status = 400) => json({ ok: false, error }, status);
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

export function startWeb({ port = WEB_PORT, hosts = null, mode = null, env = process.env, log = (s) => process.stdout.write(`${s}\n`), trustProxy = false, dbFile, runExtra = {} } = {}) {
  let settings = loadSettings(env);
  // The first start keeps what the environment gave (AGENTIC_AI_URLS, AGENTIC_CALC_URL…) in settings.json.
  if (!existsSync(settingsFile()) && (settings.services.length || settings.calc.url || settings.hosts.mac || settings.hosts.server)) settings = { ...saveSettings({ services: settings.services, calc: settings.calc, hosts: settings.hosts }), mode: settings.mode };
  // This copy's own id (its cookie's name): made once, kept in settings.json.
  if (!settings.instance) settings = { ...saveSettings({ instance: randomWord(10) }), mode: settings.mode };
  if (mode) settings.mode = mode;
  const getSettings = () => settings;
  const db = openDb(dbFile);
  const auth = new Auth(db, { id: settings.instance });
  const gateway = new Gateway({ settings: getSettings, db });
  const queue = new FairQueue({ limits: () => settings.limits });
  let formulas = null;
  // The calculator link (calc-link.mjs): signed in, its websocket kept open, its one session shared. It runs
  // here while settings.calc.link is 'web' (the default); as its own background service, this copy uses it
  // through its socket. A login or address saved elsewhere (the hub's Calculator tab) reaches this copy too.
  const link = env.AGENTIC_CALC_LINK === 'off' ? null : linkHost({ where: 'web', log, onCalc: (c) => {
    if (JSON.stringify(c) === JSON.stringify(settings.calc)) return;
    settings = { ...settings, calc: c }; formulas = null;
  } });
  const calc = () => ({ url: settings.calc.url, formulas: settings.calc.user && settings.calc.pass ? (formulas ??= formulasClient({ ...settings.calc, link })) : null });
  const linkLine = (st) => (st ? { state: st.state, words: st.words, since: st.since, where: st.where, drops: st.counts?.drops ?? 0, filed: st.reports.filter((r) => r.status === 'filed').length } : null);
  let boundPort = port;
  const runner = new Runner({ db, auth, gateway, settings: getSettings, queue, port: () => boundPort, mcpUrl: (token) => `http://127.0.0.1:${boundPort}/mcp/run/${token}`, calc, runExtra });
  const isMac = () => settings.mode !== 'server';

  const ipOf = (req, server) => {
    const direct = server.requestIP(req)?.address ?? '';
    if (trustProxy && req.headers.get('x-forwarded-for')) return req.headers.get('x-forwarded-for').split(',')[0].trim();
    return direct;
  };
  const secureOf = (req) => (trustProxy ? req.headers.get('x-forwarded-proto') === 'https' : new URL(req.url).protocol === 'https:');
  const pageFor = () => new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS } });
  const userOut = (u) => u && { id: u.id, name: u.name, role: u.role, created: u.created, seen: u.seen };

  // SSE: a chat's events after `after`, then each new one, with a ping every 15 s.
  const stream = (chat, after) => {
    let unsub = null, ping = null;
    const enc = new TextEncoder();
    return new Response(new ReadableStream({
      start(ctl) {
        const send = (e) => { try { ctl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { /* closed */ } };
        for (const e of runner.events(chat, after)) send(e);
        send({ n: 0, t: 'state', state: runner.stateOf(chat.id) });
        unsub = runner.subscribe(chat.id, send);
        ping = setInterval(() => { try { ctl.enqueue(enc.encode(': ping\n\n')); } catch { /* closed */ } }, 15_000);
      },
      cancel() { unsub?.(); clearInterval(ping); },
    }), { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
  };

  // The chat a request names, if this user may see it (their own; an admin sees everyone's: the owner's pick).
  const chatFor = (who, id, { write = false } = {}) => {
    const c = runner.chat(id);
    if (!c) return null;
    if (c.user === who.user.id) return c;
    return !write && who.user.role === 'admin' ? c : null;
  };
  // Whose folder: your own, or (an admin, reading only) another user's by name.
  const folderOf = (who, url, { write = false } = {}) => {
    const name = url.searchParams.get('user');
    if (!name || name === who.user.name) return runner.dirs(who.user.id).work;
    if (write || who.user.role !== 'admin') return null;
    const u = auth.userByName(name);
    return u ? runner.dirs(u.id).work : null;
  };

  async function route(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    const ip = ipOf(req, server);
    const loop = LOOPBACK.has(server.requestIP(req)?.address ?? '');
    const body = async () => { try { return await req.json(); } catch { return {}; } };

    // ---- the page ----
    if (method === 'GET' && (path === '/' || /^\/(invite|reset)\/[A-Za-z0-9]+$/.test(path))) return pageFor();
    if (path === '/favicon.ico') return new Response(null, { status: 204 });
    if (path === '/health') return json({ ok: true, mode: settings.mode });

    // ---- the tools server for this server's runs ----
    const runMcp = /^\/mcp\/run\/(acr_[A-Za-z0-9]+)$/.exec(path);
    if (runMcp) {
      if (!loop || !auth.runs.has(runMcp[1])) return bad('not yours', 403);
      return handleMcp(req, { calc });
    }

    // ---- who it is ----
    const who = auth.who(req);
    // A run's token only reaches the gateway, and only from this Mac.
    if (who?.via === 'run' && (!loop || !GATEWAY_PATHS.has(path))) return bad('not for runs', 403);
    // A change made with the cookie must come from this page.
    if (who?.via === 'cookie' && method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) return bad('that change did not come from this page', 403);

    // ---- signing in (no account needed) ----
    if (path === '/api/me' && method === 'GET') {
      return json({ ok: true, user: userOut(who?.user ?? null), mode: settings.mode, hosts: settings.hosts, setup: auth.userCount() === 0 });
    }
    if (path === '/api/signin' && method === 'POST') {
      if (!sameOrigin(req)) return bad('that did not come from this page', 403);
      const b = await body();
      const r = await auth.signIn(String(b.name ?? '').trim(), b.password, ip);
      if (!r.ok) return bad(r.error, r.locked ? 429 : 401);
      return json({ ok: true, user: userOut(r.user) }, 200, { 'set-cookie': sessionCookie(r.token, { name: auth.cookie, secure: secureOf(req) }) });
    }
    if (path === '/api/signout' && method === 'POST') {
      if (who?.via === 'cookie') auth.signOut(who.token);
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', { name: auth.cookie, clear: true, secure: secureOf(req) }) });
    }
    const inv = /^\/api\/invite\/([A-Za-z0-9]+)$/.exec(path);
    if (inv) {
      if (method === 'GET') { const i = auth.inviteInfo(inv[1]); return i ? json({ ok: true, ...i }) : bad('This invite link has been used or has expired. Ask the admin for a new one.', 404); }
      if (method === 'POST') {
        if (!sameOrigin(req)) return bad('that did not come from this page', 403);
        const b = await body();
        const r = await auth.acceptInvite(inv[1], { name: b.name, password: b.password });
        if (!r.ok) return bad(r.error);
        runner.dirs(r.user.id);
        return json({ ok: true, user: userOut(r.user) }, 200, { 'set-cookie': sessionCookie(r.token, { name: auth.cookie, secure: secureOf(req) }) });
      }
    }
    const rst = /^\/api\/reset\/([A-Za-z0-9]+)$/.exec(path);
    if (rst) {
      if (method === 'GET') { const i = auth.resetInfo(rst[1]); return i ? json({ ok: true, name: i.user.name }) : bad('This link has been used or has expired.', 404); }
      if (method === 'POST') {
        if (!sameOrigin(req)) return bad('that did not come from this page', 403);
        const r = await auth.useReset(rst[1], (await body()).password);
        return r.ok ? json({ ok: true, user: userOut(r.user) }, 200, { 'set-cookie': sessionCookie(r.token, { name: auth.cookie, secure: secureOf(req) }) }) : bad(r.error);
      }
    }

    if (!who) return GATEWAY_PATHS.has(path) || path.startsWith('/api/') || path === '/mcp' ? bad('sign in, or send an API key (Authorization: Bearer acw_…)', 401) : pageFor();
    const me = who.user;
    const admin = me.role === 'admin';

    // ---- the AI gateway (Ollama's API and the OpenAI shape) ----
    if (GATEWAY_PATHS.has(path)) return gateway.handle(who, { method, path, body: method === 'POST' ? await body() : null, signal: req.signal });
    // ---- the tools server for keys ----
    if (path === '/mcp') return handleMcp(req, { calc });

    // ---- you ----
    if (path === '/api/password' && method === 'POST') { const b = await body(); const r = await auth.changePassword(me.id, b.old, b.next); return r.ok ? json(r) : bad(r.error); }

    // ---- models and status ----
    if ((path === '/api/models' || path === '/api/v1/models') && method === 'GET') {
      const models = await gateway.modelsFor(me);
      const services = (await gateway.statuses()).map((st) => ({ id: st.id, label: st.label, ok: st.ok, error: st.error ?? null, busy: st.busy, count: st.models.length }));
      const def = roleOf(settings, isMac() ? 'tasks' : 'chat');
      const defAt = await gateway.serviceFor(def.model, def.service);
      return json({ ok: true, default: def.model, defaultService: defAt?.id ?? def.service, models, services, room: await runner.room() });
    }
    if (path === '/api/health' && method === 'GET') {
      const t0 = Date.now();
      let calcOk = false;
      try { calcOk = (await fetch(`${settings.calc.url}/health`, { signal: AbortSignal.timeout(5000) })).ok; } catch { /* not answering */ }
      const services = (await gateway.statuses()).map((st) => ({ id: st.id, label: st.label, ok: st.ok, busy: st.busy }));
      return json({ ok: true, services, calc: { ok: calcOk, ms: Date.now() - t0, set: Boolean(settings.calc.url), link: link ? linkLine(await link.status()) : null } });
    }

    // ---- the calculator ----
    if ((path === '/api/calc' || path === '/api/v1/calc') && method === 'POST') {
      const b = await body();
      try { return json(await calculate({ expression: b.expression, variables: b.variables, url: settings.calc.url, signal: req.signal })); } catch (e) { return bad(e.message, 502); }
    }
    if ((path === '/api/calc/functions' || path === '/api/v1/calc/functions') && method === 'GET') {
      try { return json(await capabilities({ url: settings.calc.url })); } catch (e) { return bad(e.message, 502); }
    }
    if (path === '/api/v1/formulas' && method === 'GET') {
      const f = calc().formulas;
      if (!f) return bad('Formulas need the calculator login, which an admin sets in Admin → Settings.', 409);
      try { return json(await f.search({ q: url.searchParams.get('q'), category: url.searchParams.get('category'), limit: url.searchParams.get('limit'), verifiedOnly: url.searchParams.get('verifiedOnly') === 'true' })); } catch (e) { return bad(e.message, 502); }
    }

    // ---- the plain chat for the API (NDJSON) ----
    if (path === '/api/v1/chat' && method === 'POST') {
      const b = await body();
      const model = String(b.model || roleOf(settings, 'chat').model);
      const messages = (Array.isArray(b.messages) ? b.messages : []).filter((m) => m && ['user', 'assistant'].includes(m.role)).map((m) => ({ role: m.role, content: String(m.content ?? '') }));
      if (!messages.length) return bad('send messages: [{ role: "user", content: "…" }]');
      const enc = new TextEncoder();
      return new Response(new ReadableStream({
        async start(ctl) {
          await plainChat({ gateway, who, model, messages, calc, signal: req.signal, say: (ev) => { try { ctl.enqueue(enc.encode(`${JSON.stringify(ev)}\n`)); } catch { /* gone */ } } });
          try { ctl.close(); } catch { /* gone */ }
        },
      }), { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
    }

    // ---- chats (the page) and tasks (the API) ----
    if ((path === '/api/chats') && method === 'GET') {
      const name = url.searchParams.get('user');
      if (name && name !== me.name) { if (!admin) return bad('not yours', 403); const u = auth.userByName(name); return u ? json({ ok: true, chats: runner.chatsOf(u.id), user: u.name }) : bad('no such user', 404); }
      return json({ ok: true, chats: runner.chatsOf(me.id) });
    }
    if ((path === '/api/chats' || path === '/api/v1/tasks') && method === 'POST') {
      const b = await body();
      if (path === '/api/v1/tasks' && !isMac()) return bad('tasks run only on the Mac copy; this copy has chat and the calculator', 409);
      const kind = isMac() ? 'agent' : 'chat';
      const chat = b.chat ? chatFor(who, b.chat, { write: true }) : runner.createChat(me, { title: b.title ?? b.prompt, kind });
      if (!chat) return bad('no such chat', 404);
      if (path === '/api/v1/tasks' || b.text || b.prompt) {
        const r = await runner.send(me, chat, { text: b.text ?? b.prompt, model: b.model, service: b.service });
        if (!r.ok) return bad(r.error);
        return json({ ok: true, id: chat.id, chat: runner.chat(chat.id), ...r });
      }
      return json({ ok: true, id: chat.id, chat });
    }
    const ch = /^\/api\/(?:chats|v1\/tasks)\/(c_[A-Za-z0-9_-]+)(?:\/(stream|events|send|answer|stop))?$/.exec(path);
    if (ch) {
      const write = ['send', 'answer', 'stop'].includes(ch[2]) || method === 'DELETE';
      const chat = chatFor(who, ch[1], { write });
      if (!chat) return bad('no such chat', 404);
      if (!ch[2] && method === 'GET') return json({ ok: true, chat, events: runner.events(chat), state: runner.stateOf(chat.id), owner: auth.userById(chat.user)?.name });
      if (!ch[2] && method === 'DELETE') { runner.deleteChat(chat); return json({ ok: true }); }
      if ((ch[2] === 'stream' || ch[2] === 'events') && method === 'GET') return stream(chat, Number(url.searchParams.get('after') ?? 0));
      if (ch[2] === 'send' && method === 'POST') { const b = await body(); const r = await runner.send(me, chat, { text: b.text, model: b.model, service: b.service }); return r.ok ? json(r) : bad(r.error, 409); }
      if (ch[2] === 'answer' && method === 'POST') { const b = await body(); const r = runner.answer(me, chat, b); return r.ok ? json(r) : bad(r.error, 409); }
      if (ch[2] === 'stop' && method === 'POST') { const r = runner.stop(chat); return r.ok ? json(r) : bad(r.error, 409); }
    }

    // ---- files (the Mac copy) ----
    if (path.startsWith('/api/files') || path.startsWith('/api/v1/files')) {
      if (!isMac()) return bad('this copy keeps no folders', 409);
      const v1 = /^\/api\/v1\/files(?:\/(.*))?$/.exec(path);
      const rel = v1 ? decodeURIComponent(v1[1] ?? '') : url.searchParams.get('path') ?? '';
      const write = method !== 'GET';
      const root = folderOf(who, url, { write });
      if (!root) return bad('not yours', 403);
      if (path === '/api/v1/files.zip' || path === '/api/files/zip') return zipResponse(root, `${url.searchParams.get('user') ?? me.name}-folder`);
      if (method === 'GET' && (path === '/api/files' || (v1 && !rel))) return json({ ok: true, ...listFiles(root) });
      if (method === 'GET' && path === '/api/files/show') { const r = await showFile(root, rel); return r instanceof Error ? bad(r.message, 404) : json({ ok: true, ...r }); }
      if (method === 'GET' && (path === '/api/files/get' || v1)) return fileResponse(root, rel) ?? bad('no such file', 404);
      if ((method === 'PUT' || method === 'POST') && (path === '/api/files/upload' || v1)) {
        const len = Number(req.headers.get('content-length') ?? 0);
        if (len > MAX_UPLOAD) return bad(`a file may be ${MAX_UPLOAD / 1024 / 1024} MB at most`, 413);
        const r = await putFile(root, rel, new Uint8Array(await req.arrayBuffer()), { unzip: url.searchParams.get('unzip') === '1' });
        return r instanceof Error ? bad(r.message) : json({ ok: true, ...r });
      }
      if (method === 'DELETE') { const r = removePath(root, rel); return r instanceof Error ? bad(r.message) : json({ ok: true, ...r }); }
    }

    // ---- API keys ----
    if (path === '/api/keys' && method === 'GET') return json({ ok: true, keys: auth.keys(me.id) });
    if (path === '/api/keys' && method === 'POST') { if (who.via === 'key') return bad('make keys from the page', 403); const r = auth.newKey(me.id, (await body()).name); return json({ ok: true, ...r }); }
    const key = /^\/api\/keys\/(\d+)$/.exec(path);
    if (key && method === 'DELETE') return auth.deleteKey(me.id, Number(key[1])) ? json({ ok: true }) : bad('no such key', 404);

    // ---- the admin ----
    if (path.startsWith('/api/admin/')) {
      if (!admin) return bad('admins only', 403);
      if (path === '/api/admin/users' && method === 'GET') {
        const runs = db.query('select user, count(*) as n from runs where queued > ?1 group by user').all(Date.now() - 7 * 864e5);
        return json({ ok: true, users: auth.users().map((u) => ({ ...u, runs: runs.find((r) => r.user === u.id)?.n ?? 0, keys: auth.keys(u.id).length })), invites: auth.invites() });
      }
      if (path === '/api/admin/invite' && method === 'POST') {
        const b = await body();
        const r = auth.invite({ name: String(b.name ?? '').trim(), role: b.role, by: me.id, days: settings.limits.inviteDays });
        return r.ok ? json({ ok: true, path: `/invite/${r.token}`, expires: r.expires }) : bad(r.error);
      }
      const au = /^\/api\/admin\/users\/(\d+)(?:\/(reset|role))?$/.exec(path);
      if (au) {
        const u = auth.userById(Number(au[1]));
        if (!u) return bad('no such user', 404);
        if (au[2] === 'reset' && method === 'POST') { const r = auth.resetLink(u.id); return json({ ok: true, path: `/reset/${r.token}`, expires: r.expires }); }
        if (au[2] === 'role' && method === 'POST') {
          const role = (await body()).role;
          if (u.role === 'admin' && role !== 'admin' && auth.admins() <= 1) return bad('there must be one admin at least');
          auth.setRole(u.id, role);
          return json({ ok: true });
        }
        if (!au[2] && method === 'DELETE') {
          if (u.id === me.id) return bad('you cannot delete yourself here');
          for (const c of runner.chatsOf(u.id)) runner.deleteChat(runner.chat(c.id));
          auth.deleteUser(u.id);
          rmSync(userDir(u.id), { recursive: true, force: true });
          return json({ ok: true });
        }
      }
      if (path === '/api/admin/queue' && method === 'GET') {
        const names = new Map(auth.users().map((u) => [u.id, u.name]));
        const q = queue.snapshot();
        return json({ ok: true, runs: runner.board(), queue: { running: q.running.map((r) => ({ ...r, name: names.get(r.user) })), waiting: q.waiting.map((r) => ({ ...r, name: names.get(r.user) })) }, requests: gateway.flights(), services: (await gateway.statuses()).map((st) => ({ id: st.id, label: st.label, ok: st.ok, busy: st.busy, loaded: [...st.loaded].map(([name, l]) => ({ name, ...l })) })), limits: settings.limits });
      }
      if (path === '/api/admin/usage' && method === 'GET') {
        const days = Math.max(1, Math.min(90, Number(url.searchParams.get('days') ?? 7)));
        const from = today(Date.now() - (days - 1) * 864e5);
        const rows = db.query('select u.name as name, sum(requests) as requests, sum(tokens_in) as tokensIn, sum(tokens_out) as tokensOut, sum(busy_ms) as busyMs, sum(spills) as spills from usage join users u on u.id = usage.user where day >= ?1 group by usage.user order by busyMs desc').all(from);
        const models = db.query('select u.name as name, model, sum(busy_ms) as busyMs from usage join users u on u.id = usage.user where day >= ?1 group by usage.user, model').all(from);
        const runs = db.query('select u.name as name, count(*) as runs, sum(laguna) as laguna from runs join users u on u.id = runs.user where queued >= ?1 group by runs.user').all(Date.parse(from));
        return json({ ok: true, from, rows: rows.map((r) => ({ ...r, runs: runs.find((x) => x.name === r.name)?.runs ?? 0, laguna: runs.find((x) => x.name === r.name)?.laguna ?? 0, model: models.filter((m) => m.name === r.name).sort((a, b) => b.busyMs - a.busyMs)[0]?.model ?? null })) });
      }
      // ---- Admin › Models: every model, the jobs, who may pick, Test, keep / let go, the log ----
      const logChange = (what, detail) => db.query('insert into model_log (at, user, what, detail) values (?1, ?2, ?3, ?4)').run(Date.now(), me.name, what, detail);
      const modelBoard = async (force) => {
        const statuses = await gateway.statuses({ force });
        const models = await gateway.modelsFor(me, { all: true });
        const find = (r) => (r ? models.find((m) => m.name === r.model && (r.service == null || m.service === r.service)) ?? null : null);
        const tasks = find(roleOf(settings, 'tasks'));
        const standIn = roleOf(settings, 'standIn');
        const runsOn = runner.board();
        const roles = ROLES.map((r) => {
          const pick = roleOf(settings, r.id);
          const m = find(pick);
          const fit = pick ? fitFor(r.id, m, { service: m?.service, tasksCtx: tasks?.ctx ?? null, standInService: r.id === 'standIn' ? (find(roleOf(settings, 'tasks'))?.service ?? null) : null }) : null;
          return { ...r, pick: pick ? { service: m?.service ?? pick.service, model: pick.model } : null, fit, after: r.id === 'standIn' ? settings.spill.after : undefined,
            choices: models.map((x) => ({ service: x.service, model: x.name, fit: fitFor(r.id, x, { service: x.service, tasksCtx: tasks?.ctx ?? null, standInService: r.id === 'standIn' ? (tasks?.service ?? null) : null }).level })) };
        });
        return {
          ok: true, room: await runner.room(),
          services: statuses.map((st) => ({ id: st.id, label: st.label, ok: st.ok, error: st.error ?? null, at: st.at, version: st.version ?? null, count: st.models.length, loadedGb: Math.round([...st.loaded.values()].reduce((a, l) => a + (l.gb ?? 0), 0) * 10) / 10 })),
          models: models.map((m) => ({ ...m, runs: runsOn.filter((b) => b.model === m.name).length, roles: ROLES.filter((r) => { const p = roleOf(settings, r.id); return p && p.model === m.name && (p.service == null || p.service === m.service); }).map((r) => r.id) })),
          roles, standIn: standIn ?? null,
          log: db.query('select at, user, what, detail from model_log order by id desc limit 40').all(),
        };
      };
      if (path === '/api/admin/models' && method === 'GET') return json(await modelBoard(url.searchParams.get('refresh') === '1'));
      if (path === '/api/admin/models/role' && method === 'PUT') {
        const b = await body();
        const role = ROLES.find((r) => r.id === b.role);
        if (!role) return bad('no such job');
        const roles = { ...(settings.models.roles ?? {}) };
        let detail;
        if (b.model == null || b.model === '') {
          if (b.role === 'tasks' || b.role === 'chat' || b.role === 'lastResort') return bad(`${role.label} needs a model`);
          roles[b.role] = null;
          detail = `${role.label}: none`;
        } else {
          const service = Number(b.service);
          const st = await gateway.status(service, { force: true });
          const m = st?.models.find((x) => x.name === b.model);
          if (!m) return bad(`${b.model} is not on ${st?.label ?? 'that service'} now`);
          const fit = fitFor(b.role, m, { service });
          if (fit.level === 'no') return bad(`${b.model} cannot be the ${role.label}: ${fit.why.join('; ')}`);
          const other = b.role === 'standIn' ? roleOf(settings, 'lastResort') : b.role === 'lastResort' ? roleOf(settings, 'standIn') : null;
          if (other && other.model === b.model && (other.service == null || other.service === service)) return bad('the stand-in and the last resort cannot be the same model');
          if (b.role === 'helper' && isLastResort(settings, b.model, service)) return bad('the last resort cannot be the Helper: it would run on every side job');
          const helperNow = roleOf(settings, 'helper');
          if (b.role === 'lastResort' && helperNow && helperNow.model === b.model && (helperNow.service == null || helperNow.service === service)) return bad(`${b.model} is the Helper: pick another Helper first`);
          roles[b.role] = { service, model: b.model };
          detail = `${role.label}: ${b.model} on ${st.label}`;
        }
        const patch = { models: { ...settings.models, roles } };
        if (b.role === 'standIn') patch.spill = { after: Math.max(10, Math.min(600, Number(b.after ?? settings.spill.after) || 60)), to: roles.standIn ?? null };
        if (b.role === 'tasks') patch.models.default = roles.tasks.model;
        if (b.role === 'lastResort') patch.models.lastResort = [roles.lastResort.model];
        settings = { ...saveSettings(patch), mode: settings.mode };
        logChange('role', `${detail}${b.role === 'standIn' ? ` · after ${patch.spill.after} s` : ''}`);
        return json(await modelBoard(false));
      }
      if (path === '/api/admin/models/access' && method === 'PUT') {
        const b = await body();
        if (!ACCESS.includes(b.access)) return bad('access is all, admin or off');
        const service = Number(b.service);
        const st = await gateway.status(service);
        if (!st?.models.some((x) => x.name === b.model)) return bad(`${b.model} is not on ${st?.label ?? 'that service'} now`);
        const inRole = ROLES.find((r) => { const p = roleOf(settings, r.id); return p && p.model === b.model && (p.service == null || p.service === service); });
        if (b.access === 'off' && inRole) return bad(`${b.model} is the ${inRole.label}: pick another model for that job first`);
        const access = { ...(settings.models.access ?? {}), [`${service}|${b.model}`]: b.access };
        settings = { ...saveSettings({ models: { ...settings.models, access } }), mode: settings.mode };
        logChange('access', `${b.model} on ${st.label}: ${b.access === 'all' ? 'everyone' : b.access === 'admin' ? 'admins only' : 'off'}`);
        return json({ ok: true });
      }
      if (path === '/api/admin/models/test' && method === 'POST') {
        const b = await body();
        const r = await gateway.test(Number(b.service), String(b.model));
        if (r.ok) logChange('test', `${b.model} on ${gateway.services()[Number(b.service)]?.label}: first word ${(r.firstMs / 1000).toFixed(1)} s${r.loadMs > 500 ? `, loading ${(r.loadMs / 1000).toFixed(1)} s` : ''}`);
        return json(r);
      }
      if ((path === '/api/admin/models/keep' || path === '/api/admin/models/letgo') && method === 'POST') {
        const b = await body();
        const service = Number(b.service);
        const label = gateway.services()[service]?.label ?? 'that service';
        if (path.endsWith('letgo')) {
          const runs = runner.board().filter((x) => x.model === b.model && x.state === 'running');
          if (runs.length) return bad(`${b.model} is working on ${runs.length} run(s) (${runs.map((x) => x.user).join(', ')}): let it go when they finish`, 409);
          const r = await gateway.letGo(service, String(b.model));
          if (!r.ok) return bad(r.error, 409);
          if (!r.already) logChange('let go', `${b.model} on ${label}`);
          return json(await modelBoard(true));
        }
        const r = await gateway.keep(service, String(b.model), { keep: b.keep !== false });
        if (!r.ok) return bad(r.error, 502);
        logChange(b.keep !== false ? 'keep loaded' : 'load', `${b.model} on ${label}`);
        return json(await modelBoard(true));
      }
      if (path === '/api/admin/settings' && method === 'GET') return json({ ok: true, settings: publicSettings(settings) });
      // The calculator link: what it is doing, and Reconnect now / Sign in again (where it runs is the hub's and coding calc's).
      if (path === '/api/admin/calc-link' && method === 'GET') return json({ ok: true, on: Boolean(link), link: link ? await link.status() : null });
      if ((path === '/api/admin/calc-link/reconnect' || path === '/api/admin/calc-link/signin') && method === 'POST') {
        if (!link) return bad('the calculator link is off on this copy (AGENTIC_CALC_LINK=off)', 409);
        const st = await link.act(path.endsWith('signin') ? 'signin' : 'reconnect');
        return st ? json({ ok: true, link: st }) : bad('the calculator link is not running: save a calculator login first', 409);
      }
      if (path === '/api/admin/settings' && method === 'PUT') {
        const b = await body();
        const patch = {};
        if (Array.isArray(b.services)) {
          const list = b.services.map((x) => String(x?.url ?? x ?? '').trim()).filter(Boolean);
          if (list.some((u) => !/^https?:\/\/[^\s/]+(:\d+)?\/?$/.test(u))) return bad('an AI service is an address like http://host:port');
          patch.services = list.map((u) => ({ url: u }));
        }
        if (b.calc) {
          const c = { ...settings.calc };
          if (b.calc.url !== undefined) { if (b.calc.url && !/^https?:\/\/[^\s/]+(:\d+)?\/?$/.test(b.calc.url)) return bad('the calculator is an address like http://host:port'); c.url = b.calc.url ? String(b.calc.url).replace(/\/+$/, '') : null; }
          if (b.calc.user !== undefined) c.user = b.calc.user || null;
          if (b.calc.pass) c.pass = String(b.calc.pass);
          if (b.calc.clearPass) c.pass = null;
          patch.calc = c;
          formulas = null;
        }
        if (b.limits) {
          const n = (v, lo, hi, d) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d; };
          const l = settings.limits;
          patch.limits = { perUser: n(b.limits.perUser, 1, 5, l.perUser), total: n(b.limits.total, 1, 8, l.total), runMins: n(b.limits.runMins, 5, 240, l.runMins), askMins: n(b.limits.askMins, 1, 240, l.askMins), inviteDays: n(b.limits.inviteDays, 1, 30, l.inviteDays) };
        }
        if (b.spill !== undefined) {
          const to = b.spill?.to;
          if (to && isLastResort(settings, to.model, to.service)) return bad('Laguna is never a stand-in');
          patch.spill = { after: Math.max(10, Math.min(600, Number(b.spill?.after ?? settings.spill.after))), to: to ? { service: Number(to.service), model: String(to.model) } : null };
        }
        if (b.models) patch.models = { ...settings.models, ...(b.models.default ? { default: String(b.models.default) } : {}), ...(Array.isArray(b.models.blocked) ? { blocked: b.models.blocked.map(String) } : {}) };
        if (b.runs) patch.runs = { webFetch: Boolean(b.runs.webFetch) };
        if (b.hosts) patch.hosts = { mac: b.hosts.mac || null, server: b.hosts.server || null };
        settings = { ...saveSettings(patch), mode: settings.mode };
        gateway.cache.clear();
        queue.pump();
        if (patch.calc) link?.tick();
        return json({ ok: true, settings: publicSettings(settings) });
      }
    }

    // ---- a password rule the page shows ----
    if (path === '/api/rules' && method === 'GET') return json({ ok: true, minPassword: MIN_PASSWORD, validName: '2–32 letters, digits, dots, dashes or underscores' });
    return bad('not found', 404);
  }

  const handler = async (req, server) => {
    try {
      const res = await route(req, server);
      if (!res.headers.has('x-content-type-options')) for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (k !== 'content-security-policy' || res.headers.get('content-type')?.startsWith('text/html')) res.headers.set(k, v);
      return res;
    } catch (e) {
      log(`web: ${req.method} ${new URL(req.url).pathname}: ${e.stack ?? e.message}`);
      return bad('something went wrong on the server', 500);
    }
  };
  // Where it listens: given, or this Mac and its Tailscale address (the Mac copy: Tailscale only).
  const where = hosts ?? (settings.mode === 'server' ? ['0.0.0.0'] : ['127.0.0.1', ...lanAddresses().filter((a) => a.where === 'Tailscale').map((a) => a.address)]);
  const servers = [];
  for (const hostname of where) {
    const s = Bun.serve({ port: boundPort, hostname, idleTimeout: 120, maxRequestBodySize: MAX_UPLOAD + 1024 * 1024, fetch: handler });
    boundPort = s.port;
    servers.push(s);
  }
  const setup = auth.setupLink();
  const base = settings.mode === 'server' && settings.hosts.server ? `https://${settings.hosts.server}` : `http://${where[0] === '0.0.0.0' ? 'localhost' : where.at(-1)}:${boundPort}`;
  if (setup) log(`No account yet. Make the first admin here (works once, for a day): ${base}/invite/${setup.token}`);
  return {
    port: boundPort, hosts: where, url: base, db, auth, gateway, runner, queue, settings: getSettings, setupPath: setup ? `/invite/${setup.token}` : null,
    link,
    async stop() { link?.stop(); for (const s of servers) s.stop(true); for (const id of [...runner.live.keys()]) runner.stop({ id, user: 0 }, { quiet: true }); db.close(); },
  };
}

export { validName };
