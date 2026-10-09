// Agentic Coder Web (terminal/src/web/, 8 Oct 2026): the calculator's two fixes, the fair line, the
// accounts, and the server over HTTP with pretend services: nobody in without signing in, two users
// kept apart (an admin may look), the AI gateway (Laguna only after a yes, nothing unloaded, a silent
// service's request moved to the stand-in and said), the Laguna question for a request too big, the
// tools server (MCP over HTTP, and Agentic Coder's own MCP hub connecting to it), the chat with the
// calculator, and a real Agentic Coder run in a user's folder: it asks before a command, runs it
// after a yes, and the next message carries the conversation on.
import { test, expect, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

process.env.AGENTIC_MEMORY_SAVE = 'off';
const base = mkdtempSync(join(tmpdir(), 'agentic-web-'));
process.env.AGENTIC_WEB_HOME = join(base, 'web');
const { calculate, formulasClient, fixExpression } = await import('../src/tools/calculator.mjs');
const { FairQueue } = await import('../src/web/queue.mjs');
const { Auth, sha } = await import('../src/web/auth.mjs');
const { openDb } = await import('../src/web/db.mjs');
const { startWeb } = await import('../src/web/server.mjs');
const { saveSettings } = await import('../src/web/config.mjs');
const { launchPlist, parseArgs } = await import('../src/web/main.mjs');
const { roleOf, accessOf, fitFor, warningsOf, isLastResort } = await import('../src/web/models.mjs');

const stops = [];
afterAll(async () => { for (const s of stops.reverse()) await s(); });

// ---- pretend services -----------------------------------------------------------------------

// The calculator as it behaves (8 Oct 2026): a failed sum answers 200 with ok: true at the top;
// phi breaks; formulas need a session, which runs out after one use here.
function fakeCalc() {
  let logins = 0;
  const sessions = new Set();
  const s = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === '/health') return Response.json({ ok: true });
    if (u.pathname === '/api/calculate/capabilities') return Response.json({ ok: true, supportedFunctions: ['sqrt', 'ln', 'pow'], supportedConstants: ['pi', 'e', 'phi'] });
    if (u.pathname === '/api/calculate') {
      const { expression, variables = {} } = await req.json();
      const norm = String(expression).replace(/\^/g, '**').replace(/\bsqrt\(/g, 'Math.sqrt(');
      if (/\bphi\b/.test(expression)) return Response.json({ ok: true, evaluation: { ok: false, value: "Cannot read properties of undefined (reading 'sqrt')", normalized: 'Math.Math.sqrt' } });
      if (!/^[\d\s+\-*/().a-zA-Z_]*$/.test(norm.replace(/Math\.sqrt/g, ''))) return Response.json({ ok: true, evaluation: { ok: false, value: 'Unexpected token' } });
      try {
        const value = Function(...Object.keys(variables), `return (${norm});`)(...Object.values(variables));
        return Response.json({ ok: true, evaluation: { ok: Number.isFinite(value), value: Number.isFinite(value) ? value : 'not a number', normalized: norm }, analysis: { tokenCount: 3 } });
      } catch (e) { return Response.json({ ok: true, evaluation: { ok: false, value: e.message, normalized: norm } }); }
    }
    if (u.pathname === '/api/login') { const b = await req.json(); if (b.userName !== 'calc' || b.password !== 'secret') return Response.json({ error: 'no' }, { status: 401 }); logins++; const t = `s${logins}`; sessions.add(t); return Response.json({ ok: true, sessionId: t }); }
    if (u.pathname === '/api/formulas') {
      const t = /Bearer (\S+)/.exec(req.headers.get('authorization') ?? '')?.[1];
      if (!sessions.has(t)) return Response.json({ error: 'Missing bearer token' }, { status: 401 });
      sessions.delete(t);
      return Response.json({ ok: true, formulas: [{ name: 'golden', expression: 'phi' }], q: u.searchParams.get('q') });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  } });
  stops.push(() => s.stop(true));
  return { url: `http://127.0.0.1:${s.port}`, logins: () => logins };
}

// An Ollama service with the models given ({ name, gb, loaded: ctx, pinned, busy }), whose chats
// follow `reply(body)` → { content } | { tool: [name, args] } | null (null: never answers).
function fakeOllama(models, reply = () => ({ content: 'ok' })) {
  const seen = [];
  const s = Bun.serve({ port: 0, hostname: '127.0.0.1', idleTimeout: 0, async fetch(req) {
    const u = new URL(req.url);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : null;
    seen.push({ path: u.pathname, body });
    const m = models.find((x) => x.name === body?.model);
    if (u.pathname === '/api/version') return Response.json({ version: '0.32.12' });
    if (u.pathname === '/api/tags') return Response.json({ models: models.map((x) => ({ name: x.name, size: x.gb * 1e9, digest: `${s.port}-${x.name}`, details: { family: 'qwen3', parameter_size: '9B' } })) });
    if (u.pathname === '/api/ps') return Response.json({ models: models.filter((x) => x.loaded).map((x) => ({ name: x.name, size_vram: x.gb * 1e9, context_length: x.loaded, expires_at: x.pinned ? '2318-01-01T00:00:00Z' : new Date(Date.now() + (x.busy ? -600_000 : 300_000)).toISOString() })) });
    if (u.pathname === '/api/show') return m ? Response.json({ details: { family: 'qwen3', parameter_size: '9B' }, model_info: { 'qwen3.context_length': m.ctx ?? 262144 }, capabilities: m.caps ?? ['completion', 'tools'] }) : Response.json({ error: 'not found' }, { status: 404 });
    if (u.pathname === '/api/generate') {
      // keep_alive -1: kept for good; 0: let go (as Ollama does)
      if (m && body.keep_alive === 0) m.loaded = 0;
      else if (m) { m.loaded ||= 32768; if (body.keep_alive === -1) m.pinned = true; }
      return Response.json({ model: body.model, response: '', done: true, done_reason: body.keep_alive === 0 ? 'unload' : 'load' });
    }
    if (u.pathname === '/api/chat') {
      const r = reply(body);
      if (r === null) return new Promise(() => {}); // a service that never gives a word
      const msg = r.tool ? { role: 'assistant', content: '', tool_calls: [{ function: { name: r.tool[0], arguments: r.tool[1] } }] } : { role: 'assistant', content: r.content };
      const last = { model: body.model, message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 900, prompt_eval_duration: 1e9, eval_count: 12, eval_duration: 1e8, total_duration: 2e9 };
      if (body.stream === false) return Response.json({ ...last, message: msg });
      return new Response(`${JSON.stringify({ model: body.model, message: msg, done: false })}\n${JSON.stringify(last)}\n`, { headers: { 'content-type': 'application/x-ndjson' } });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  } });
  stops.push(() => s.stop(true));
  return { url: `http://127.0.0.1:${s.port}`, seen, chats: () => seen.filter((x) => x.path === '/api/chat').map((x) => x.body) };
}

const lastOf = (body) => body.messages?.at(-1);
const toolDone = (body) => lastOf(body)?.role === 'tool';

// ---- the calculator ---------------------------------------------------------------------------

test('the calculator: a failed sum is a failure, phi works, a letter may be plain arithmetic, a value that is not is refused', async () => {
  const c = fakeCalc();
  expect(fixExpression('phi^2 + alphi')).toBe('((1+sqrt(5))/2)^2 + alphi');
  expect(await calculate({ url: c.url, expression: '2*x+1', variables: { x: 3 } })).toMatchObject({ ok: true, value: 7 });
  const phi = await calculate({ url: c.url, expression: 'phi^2' });
  expect(phi.ok).toBe(true);
  expect(phi.value).toBeCloseTo(2.618034, 5);
  expect(phi.sent).toBe('((1+sqrt(5))/2)^2');
  // ok: true at the top, the error in evaluation.value: a failure here
  expect(await calculate({ url: c.url, expression: '2 + ;' })).toMatchObject({ ok: false, error: 'Unexpected token' });
  const pay = await calculate({ url: c.url, expression: 'P*r/(1-(1+r)^-n)', variables: { P: 250000, r: '0.06/12', n: 360 } });
  expect(pay.ok).toBe(true);
  expect(pay.value).toBeCloseTo(1498.876, 2);
  expect(await calculate({ url: c.url, expression: 'x+1', variables: { x: 'rm -rf ~' } })).toMatchObject({ ok: false });
  expect(await calculate({ url: c.url, expression: '' })).toMatchObject({ ok: false });
  await expect(calculate({ url: 'http://127.0.0.1:1', expression: '1+1' })).rejects.toThrow();
});

test('formulas: one login for everyone, made again once when the calculator says it has run out', async () => {
  const c = fakeCalc();
  const f = formulasClient({ url: c.url, user: 'calc', pass: 'secret' });
  expect((await f.search({ q: 'golden' })).formulas[0].name).toBe('golden');
  expect(await f.search({ q: 'again' })).toMatchObject({ q: 'again' });
  expect(c.logins()).toBe(2);
  await expect(formulasClient({ url: c.url }).search({})).rejects.toThrow(/no calculator login/);
});

// ---- the line ---------------------------------------------------------------------------------

test('the line: one run a person, two at once, and nobody\'s second run starts before everyone else\'s first', () => {
  let t = 0;
  const q = new FairQueue({ limits: () => ({ perUser: 1, total: 2 }), now: () => ++t });
  const started = [];
  const add = (id, user) => q.add({ id, user, start: () => started.push(id) });
  expect(add('a1', 'ann')).toBe(0);
  expect(add('a2', 'ann')).toBe(1);
  expect(add('b1', 'bob')).toBe(0);
  expect(add('c1', 'cy')).toBe(1);
  // cy has run nothing yet: cy goes before ann's second
  expect(q.place('c1')).toBe(1);
  expect(q.place('a2')).toBe(2);
  q.done('a1');
  expect(started).toEqual(['a1', 'b1', 'c1']);
  q.done('b1');
  expect(started).toEqual(['a1', 'b1', 'c1', 'a2']);
  q.done('zz');
  expect(q.snapshot().running.map((r) => r.id).sort()).toEqual(['a2', 'c1']);
});

// ---- accounts ---------------------------------------------------------------------------------

test('accounts: the first admin from the setup link, sign-in, five wrong tries wait a minute, invites once, a reset ends other sign-ins, keys', async () => {
  const db = openDb(':memory:');
  const a = new Auth(db);
  const setup = a.setupLink();
  expect(setup.ok).toBe(true);
  expect(a.inviteInfo(setup.token)).toMatchObject({ name: 'admin', role: 'admin' });
  expect((await a.acceptInvite(setup.token, { name: 'boss', password: 'short' })).ok).toBe(false);
  const first = await a.acceptInvite(setup.token, { name: 'boss', password: 'a long password' });
  expect(first.ok).toBe(true);
  expect(first.user.role).toBe('admin');
  expect(a.setupLink()).toBe(null);
  expect((await a.acceptInvite(setup.token, { name: 'again', password: 'a long password' })).ok).toBe(false);
  // stored as hashes only
  const row = db.query('select pass from users where name = ?1').get('boss');
  expect(row.pass.startsWith('$argon2id$')).toBe(true);
  expect(db.query('select count(*) as n from sessions where hash = ?1').get(sha(first.token)).n).toBe(1);
  for (let i = 0; i < 5; i++) expect((await a.signIn('boss', 'wrong one', '1.2.3.4')).ok).toBe(false);
  expect(await a.signIn('boss', 'a long password', '1.2.3.4')).toMatchObject({ ok: false, locked: true });
  expect((await a.signIn('boss', 'a long password', '203.0.113.8')).ok).toBe(true);
  expect((await a.signIn('nobody', 'a long password', '203.0.113.8')).ok).toBe(false);
  expect(a.invite({ name: '../x' }).ok).toBe(false);
  const inv = a.invite({ name: 'sam', by: first.user.id });
  expect(a.inviteInfo(inv.token)).toMatchObject({ name: 'sam', role: 'user', by: 'boss' });
  const sam = await a.acceptInvite(inv.token, { password: 'sams password' });
  expect(sam.user).toMatchObject({ name: 'sam', role: 'user' });
  const k = a.newKey(sam.user.id, 'scripts');
  expect(k.key).toMatch(/^acw_[A-Za-z0-9]{32}$/);
  const req = (h) => new Request('http://x/', { headers: h });
  expect(a.who(req({ authorization: `Bearer ${k.key}` })).user.name).toBe('sam');
  expect(a.who(req({ cookie: `${a.cookie}=${sam.token}` })).user.name).toBe('sam');
  // another copy's cookie of the same value is not this copy's sign-in
  expect(new Auth(db, { id: 'other' }).who(req({ cookie: `${a.cookie}=${sam.token}` }))).toBe(null);
  const reset = a.resetLink(sam.user.id);
  const after = await a.useReset(reset.token, 'a new password!');
  expect(after.ok).toBe(true);
  expect(a.who(req({ cookie: `${a.cookie}=${sam.token}` }))).toBe(null);
  expect(a.who(req({ authorization: `Bearer ${k.key}` })).user.name).toBe('sam');
  expect((await a.useReset(reset.token, 'another password')).ok).toBe(false);
  expect(a.deleteKey(sam.user.id, k.id)).toBe(true);
  expect(a.who(req({ authorization: `Bearer ${k.key}` }))).toBe(null);
  // a run's token is not a key
  expect(a.who(req({ authorization: 'Bearer acr_made_up' }))).toBe(null);
  db.close();
});

test('coding web: its options, and the login item it writes runs the installed app', () => {
  expect(parseArgs([])).toMatchObject({ cmd: 'run', port: 60020 });
  expect(parseArgs(['run', '--port', '0', '--server', '--host', '0.0.0.0'])).toMatchObject({ port: 0, mode: 'server', hosts: ['0.0.0.0'] });
  expect(parseArgs(['invite', 'sam', '--admin'])).toMatchObject({ cmd: 'invite', name: 'sam', admin: true });
  expect(() => parseArgs(['--what'])).toThrow();
  const p = launchPlist({ program: ['/Users/x/.agentic-coder/app/agentic-coder'], port: 60020 });
  expect(p).toContain('<string>/Users/x/.agentic-coder/app/agentic-coder</string><string>web</string><string>run</string><string>--port</string><string>60020</string>');
  expect(p).toContain('<key>RunAtLoad</key><true/>');
});

// ---- the server ---------------------------------------------------------------------------------

// The web on its own port, with pretend services; signs up an admin (boss) and a user (sam).
async function web({ ai1, ai2, calcUrl, settings = {}, runExtra, mode } = {}) {
  const home = mkdtempSync(join(base, 'home-'));
  process.env.AGENTIC_WEB_HOME = home;
  saveSettings({ services: [{ url: ai1.url }, ...(ai2 ? [{ url: ai2.url }] : [])], calc: { url: calcUrl, user: 'calc', pass: 'secret' }, ...settings });
  const w = startWeb({ port: 0, hosts: ['127.0.0.1'], log: () => {}, runExtra, mode });
  stops.push(() => w.stop());
  const B = `http://127.0.0.1:${w.port}`;
  const call = async (path, { jar, key, method = 'GET', body, origin = true, raw } = {}) => {
    const headers = { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(jar?.c ? { cookie: jar.c } : {}), ...(key ? { authorization: `Bearer ${key}` } : {}), ...(origin && method !== 'GET' ? { origin: B } : {}) };
    const res = await fetch(`${B}${path}`, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const set = res.headers.get('set-cookie');
    if (jar && set) jar.c = set.split(';')[0];
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  const boss = {}, sam = {};
  await call(w.setupPath.replace('/invite/', '/api/invite/'), { jar: boss, method: 'POST', body: { name: 'boss', password: 'boss password 1' } });
  const inv = await call('/api/admin/invite', { jar: boss, method: 'POST', body: { name: 'sam' } });
  await call(inv.json.path.replace('/invite/', '/api/invite/'), { jar: sam, method: 'POST', body: { password: 'sam password 1' } });
  return { w, B, call, boss, sam, home };
}

const MODELS = [{ name: 'qwen-main', gb: 24, loaded: 120000, pinned: true }, { name: 'laguna-xs-2.1:q8_0', gb: 36, loaded: 120000, pinned: true }, { name: 'small', gb: 2 }];

test('nobody gets in without signing in or a key, and a change made with the cookie must come from the page', async () => {
  const ai1 = fakeOllama(MODELS);
  const { call, sam, boss } = await web({ ai1, calcUrl: fakeCalc().url, settings: { models: { default: 'qwen-main' } } });
  expect((await call('/api/chats')).status).toBe(401);
  expect((await call('/api/tags')).status).toBe(401);
  expect((await call('/mcp', { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, origin: false })).status).toBe(401);
  expect((await call('/api/me', { jar: sam })).json.user).toMatchObject({ name: 'sam', role: 'user' });
  expect((await call('/api/keys', { jar: sam, method: 'POST', body: { name: 'x' }, origin: false })).status).toBe(403);
  expect((await call('/api/admin/users', { jar: sam })).status).toBe(403);
  expect((await call('/api/admin/users', { jar: boss })).json.users.map((u) => u.name)).toEqual(['boss', 'sam']);
  expect((await call('/api/signin', { method: 'POST', body: { name: 'sam', password: 'wrong' } })).status).toBe(401);
  // the settings a page sees never hold the calculator's password
  const s = await call('/api/admin/settings', { jar: boss });
  expect(JSON.stringify(s.json)).not.toContain('secret');
  expect(s.json.settings.calc.hasPass).toBe(true);
  // a run's token works only for the gateway
  expect((await call('/api/chats', { key: 'acr_made_up' })).status).toBe(401);
});

test('two copies on one Mac never sign each other out: each has its own cookie', async () => {
  const ai1 = fakeOllama(MODELS);
  const a = await web({ ai1, calcUrl: fakeCalc().url });
  const b = await web({ ai1, calcUrl: fakeCalc().url });
  const nameOf = (jar) => jar.c.split('=')[0];
  expect(nameOf(a.boss)).toMatch(/^acw_[A-Za-z0-9]{10}$/);
  expect(nameOf(a.boss)).not.toBe(nameOf(b.boss));
  // the browser sends both cookies to both copies (same address, other port): each still knows its own
  const both = { c: `${a.boss.c}; ${b.boss.c}` };
  expect((await a.call('/api/me', { jar: both })).json.user?.name).toBe('boss');
  expect((await b.call('/api/me', { jar: both })).json.user?.name).toBe('boss');
  // and the id stays the same after a restart (settings.json)
  expect(JSON.parse(readFileSync(join(a.home, 'settings.json'), 'utf8')).instance).toBe(nameOf(a.boss).slice(4));
});

test('two users never see each other\'s folder; an admin may read it; nothing leaves the folder, by path, link or .zip', async () => {
  const ai1 = fakeOllama(MODELS);
  const { call, sam, boss, w } = await web({ ai1, calcUrl: fakeCalc().url });
  expect((await call('/api/files/upload?path=notes/plan.md', { jar: sam, method: 'PUT', raw: 'sam plan' })).json).toMatchObject({ ok: true, path: 'notes/plan.md' });
  expect((await call('/api/files/show?path=notes/plan.md', { jar: sam })).json.text).toBe('sam plan');
  // boss's own folder does not have it; boss as admin may read sam's
  expect((await call('/api/files/show?path=notes/plan.md', { jar: boss })).status).toBe(404);
  expect((await call('/api/files/show?path=notes/plan.md&user=sam', { jar: boss })).json.text).toBe('sam plan');
  // a user may not read another's, nor write into another's even as admin
  expect((await call('/api/files/show?path=plan.md&user=boss', { jar: sam })).status).toBe(403);
  expect((await call('/api/files/upload?path=x.md&user=sam', { jar: boss, method: 'PUT', raw: 'x' })).status).toBe(403);
  expect((await call('/api/files/show?path=x.md&user=sam', { jar: boss })).status).toBe(404);
  // out of the folder
  for (const p of ['../../settings.json', '/etc/hosts', 'notes/../../x']) expect((await call(`/api/files/show?path=${encodeURIComponent(p)}`, { jar: sam })).status).toBe(404);
  expect((await call(`/api/files/upload?path=${encodeURIComponent('../escape.txt')}`, { jar: sam, method: 'PUT', raw: 'x' })).json.ok).toBe(false);
  const samWork = w.runner.dirs(2).work;
  symlinkSync('/etc', join(samWork, 'out'));
  expect((await call('/api/files/show?path=out/hosts', { jar: sam })).status).toBe(404);
  expect((await call('/api/files/upload?path=out/x', { jar: sam, method: 'PUT', raw: 'x' })).json.ok).toBe(false);
  // a .zip whose entries climb out is not unpacked
  const z = mkdtempSync(join(base, 'zip-'));
  mkdirSync(join(z, 'a'));
  writeFileSync(join(z, 'evil.txt'), 'x');
  spawnSync('/usr/bin/zip', ['-q', join(z, 'evil.zip'), '../evil.txt'], { cwd: join(z, 'a') });
  const bad = await call('/api/files/upload?path=evil.zip&unzip=1', { jar: sam, method: 'PUT', raw: readFileSync(join(z, 'evil.zip')) });
  expect(bad.json).toMatchObject({ ok: false });
  writeFileSync(join(z, 'good.txt'), 'fine');
  spawnSync('/usr/bin/zip', ['-q', join(z, 'good.zip'), 'good.txt'], { cwd: z });
  expect((await call('/api/files/upload?path=in/good.zip&unzip=1', { jar: sam, method: 'PUT', raw: readFileSync(join(z, 'good.zip')) })).json).toMatchObject({ ok: true, unpacked: 1 });
  expect((await call('/api/files/show?path=in/good.txt', { jar: sam })).json.text).toBe('fine');
  expect((await call('/api/files', { jar: sam })).json.files.map((f) => f.path)).toEqual(expect.arrayContaining(['in/good.txt', 'notes/plan.md']));
});

test('the gateway: Laguna only for an admin, nothing unloads a model, a loaded model keeps its size, and each request is counted', async () => {
  const ai1 = fakeOllama(MODELS, () => ({ content: 'hello' }));
  const { call, sam, boss, w } = await web({ ai1, calcUrl: fakeCalc().url, settings: { models: { default: 'qwen-main' } } });
  const samKey = (await call('/api/keys', { jar: sam, method: 'POST', body: { name: 'k' } })).json.key;
  const tags = (await call('/api/tags', { key: samKey })).json.models.map((m) => m.name);
  expect(tags).toContain('qwen-main');
  expect(tags).not.toContain('laguna-xs-2.1:q8_0');
  expect((await call('/api/models', { jar: boss })).json.models.find((m) => m.name === 'laguna-xs-2.1:q8_0').lastResort).toBe(true);
  const lag = await call('/api/chat', { key: samKey, method: 'POST', body: { model: 'laguna-xs-2.1:q8_0', messages: [{ role: 'user', content: 'hi' }] } });
  expect(lag.status).toBe(403);
  expect(lag.json.error).toMatch(/last resort/);
  const bossKey = (await call('/api/keys', { jar: boss, method: 'POST', body: { name: 'k' } })).json.key;
  expect((await call('/api/chat', { key: bossKey, method: 'POST', body: { model: 'laguna-xs-2.1:q8_0', messages: [{ role: 'user', content: 'hi' }], stream: false } })).json.message.content).toBe('hello');
  // keep_alive 0 never reaches the service; the size it is loaded at is kept; kept for ever stays so
  await call('/api/chat', { key: samKey, method: 'POST', body: { model: 'qwen-main', messages: [{ role: 'user', content: 'hi' }], keep_alive: 0, options: { num_ctx: 8192 } } });
  const sent = ai1.chats().at(-1);
  expect(sent.keep_alive).toBe(-1);
  expect(sent.options.num_ctx).toBe(120000);
  // a load of a loaded model is answered here
  const before = ai1.seen.length;
  expect((await call('/api/generate', { key: samKey, method: 'POST', body: { model: 'qwen-main' } })).json.done_reason).toBe('load');
  expect(ai1.seen.slice(before).some((x) => x.path === '/api/generate')).toBe(false);
  // the OpenAI shape too
  expect((await call('/v1/models', { key: samKey })).json.data.map((m) => m.id)).toContain('qwen-main');
  expect((await call('/api/pull', { key: samKey, method: 'POST', body: { model: 'x' } })).status).toBe(404);
  const used = w.db.query('select sum(requests) as n from usage where user = 2').get().n;
  expect(used).toBe(1);
});

test('a request with no first word moves to the stand-in on the other service, says so, and the next one goes straight there', async () => {
  const ai1 = fakeOllama(MODELS, () => null);
  const ai2 = fakeOllama([{ name: 'stand-in', gb: 9, loaded: 32768 }], () => ({ content: 'from AI 2' }));
  const { call, sam, w } = await web({ ai1, ai2, calcUrl: fakeCalc().url, settings: { models: { default: 'qwen-main' }, spill: { after: 0.2, to: { service: 1, model: 'stand-in' } } } });
  w.gateway.readSpeed.set(0, 1e9);
  const notes = [];
  const who = { user: { id: 2, name: 'sam', role: 'user' }, via: 'run', run: { token: 'acr_t', service: 0, note: (t) => notes.push(t) } };
  const t0 = Date.now();
  const res = await w.gateway.handle(who, { method: 'POST', path: '/api/chat', body: { model: 'qwen-main', messages: [{ role: 'user', content: 'hi' }] } });
  const text = await res.text();
  expect(text).toContain('from AI 2');
  expect(Date.now() - t0).toBeLessThan(3000);
  expect(notes[0]).toMatch(/^AI 1 gave no first word in \d+ s: this step went to stand-in on AI 2\.$/);
  expect(ai2.chats()[0].model).toBe('stand-in');
  const n1 = ai1.chats().length;
  await (await w.gateway.handle(who, { method: 'POST', path: '/api/chat', body: { model: 'qwen-main', messages: [{ role: 'user', content: 'again' }] } })).text();
  expect(ai1.chats().length).toBe(n1);
  expect(ai2.chats().length).toBe(2);
  expect(w.db.query('select spills from usage where user = 2').get().spills).toBe(2);
  // Laguna is never the stand-in
  expect((await call('/api/admin/settings', { jar: (await (async () => { const j = {}; await call('/api/signin', { jar: j, method: 'POST', body: { name: 'boss', password: 'boss password 1' } }); return j; })()), method: 'PUT', body: { spill: { after: 60, to: { service: 0, model: 'laguna-xs-2.1:q8_0' } } } })).status).toBe(400);
  void sam;
});

test('a request too big for the default model asks before Laguna, and Stop ends it with nothing read', async () => {
  const ai1 = fakeOllama(MODELS);
  const { call, sam } = await web({ ai1, calcUrl: fakeCalc().url, settings: { models: { default: 'qwen-main' } } });
  const big = 'word '.repeat(110000 * 3.6 / 5);
  const r = await call('/api/chats', { jar: sam, method: 'POST', body: { text: big, model: 'qwen-main', service: 0 } });
  expect(r.json.asking).toMatch(/^switch-/);
  const chat = await call(`/api/chats/${r.json.id}`, { jar: sam });
  const ask = chat.json.events.find((e) => e.t === 'ask');
  expect(ask).toMatchObject({ kind: 'switch', to: 'laguna-xs-2.1:q8_0', room: 100000 });
  expect(chat.json.state.state).toBe('asking');
  expect((await call(`/api/chats/${r.json.id}/answer`, { jar: sam, method: 'POST', body: { id: ask.id, choice: 'yes' } })).status).toBe(409);
  expect((await call(`/api/chats/${r.json.id}/answer`, { jar: sam, method: 'POST', body: { id: ask.id, choice: 'stop' } })).json.ok).toBe(true);
  const after = await call(`/api/chats/${r.json.id}`, { jar: sam });
  expect(after.json.events.at(-1)).toMatchObject({ t: 'end', reason: 'stopped' });
  expect(after.json.state).toBe(null);
  expect(ai1.chats().length).toBe(0);
});

test('the tools server: MCP over HTTP with a key, and Agentic Coder\'s own MCP hub connects to a run\'s address', async () => {
  const ai1 = fakeOllama(MODELS);
  const { call, sam, w, B } = await web({ ai1, calcUrl: fakeCalc().url });
  const key = (await call('/api/keys', { jar: sam, method: 'POST', body: { name: 'k' } })).json.key;
  const rpc = async (m, path = '/mcp', k = key) => (await call(path, { key: k, method: 'POST', body: { jsonrpc: '2.0', id: 1, ...m }, origin: false })).json;
  expect((await rpc({ method: 'initialize', params: { protocolVersion: '2025-06-18' } })).result.protocolVersion).toBe('2025-06-18');
  expect((await rpc({ method: 'initialize', params: { protocolVersion: '2099-01-01' } })).result.protocolVersion).toBe('2025-11-25');
  expect((await rpc({ method: 'tools/list' })).result.tools.map((t) => t.name)).toEqual(['calculate', 'calculator_functions', 'formulas']);
  const r = (await rpc({ method: 'tools/call', params: { name: 'calculate', arguments: { expression: 'phi^2' } } })).result;
  expect(r.isError).toBe(false);
  expect(r.structuredContent.value).toBeCloseTo(2.618, 3);
  expect((await rpc({ method: 'tools/call', params: { name: 'formulas', arguments: { q: 'gold' } } })).result.structuredContent.formulas[0].name).toBe('golden');
  expect((await rpc({ method: 'nope' })).error.code).toBe(-32601);
  // a run's own address: only with a live run token
  expect((await call('/mcp/run/acr_nope', { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, origin: false })).status).toBe(403);
  const token = w.auth.runToken({ user: 2, run: 'r_x', service: 0 });
  const home = mkdtempSync(join(base, 'hub-'));
  writeFileSync(join(home, 'mcp.json'), JSON.stringify({ servers: { calculator: { url: `${B}/mcp/run/${token}`, auth: 'none' } } }));
  const was = process.env.AGENTIC_HOME;
  process.env.AGENTIC_HOME = home;
  try {
    const { openMcp } = await import('../src/app/mcp-start.mjs');
    const m = openMcp(mkdtempSync(join(base, 'proj-')));
    const state = await new Promise((ok) => { m.hub.on('state', (s) => { if (s.state === 'connected' || s.state === 'failed') ok(s); }); setTimeout(() => ok({ state: 'timeout' }), 8000); });
    expect(state.state).toBe('connected');
    expect(m.hub.catalog().map((t) => t.name)).toEqual(['mcp__calculator__calculate', 'mcp__calculator__calculator_functions', 'mcp__calculator__formulas']);
    await m.hub.close?.();
    await m.hub.stopAll?.();
  } finally { process.env.AGENTIC_HOME = was; }
});

test('the chat: your AI calls the calculator and answers with its number', async () => {
  const ai1 = fakeOllama(MODELS, (b) => (toolDone(b) ? { content: `It is ${JSON.parse(lastOf(b).content).value}.` } : { tool: ['calculate', { expression: '2^10' }] }));
  const { call, sam } = await web({ ai1, calcUrl: fakeCalc().url, settings: { models: { default: 'qwen-main' } } });
  const key = (await call('/api/keys', { jar: sam, method: 'POST', body: { name: 'k' } })).json.key;
  const r = await call('/api/v1/chat', { key, method: 'POST', body: { model: 'qwen-main', messages: [{ role: 'user', content: 'What is 2^10?' }] }, origin: false });
  const events = r.text.trim().split('\n').map((l) => JSON.parse(l));
  expect(events.find((e) => e.t === 'tool' && e.out)?.out).toMatchObject({ ok: true, value: 1024 });
  expect(events.at(-1)).toMatchObject({ t: 'done', text: 'It is 1024.' });
  expect(ai1.chats()[0].tools.map((t) => t.function.name)).toContain('calculate');
});

// The tests' own switches go to the run's process too (it starts with a clean environment).
const SWITCHES = Object.fromEntries(['AGENTIC_HELPERS', 'AGENTIC_DESIGN', 'AGENTIC_LAYOUT', 'AGENTIC_STUDIO', 'AGENTIC_TRYOUT', 'AGENTIC_SECOND_LOOK', 'AGENTIC_OPEN', 'AGENTIC_LAST_MODE', 'AGENTIC_PAGE_READ', 'AGENTIC_DESKTOP_DEFAULT', 'AGENTIC_MEMORY_SAVE', 'NODE_ENV'].filter((k) => process.env[k] != null).map((k) => [k, process.env[k]]));

test('a run: Agentic Coder works in the user\'s own folder through the gateway, asks before a command, runs it after a yes, and the next message carries the conversation on', async () => {
  const ai1 = fakeOllama([{ name: 'coder', gb: 9, loaded: 32768, pinned: true }], (b) => {
    if (!b.tools?.length) return { content: 'ok' };
    const said = String([...b.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
    if (/what did you write/i.test(said)) return { content: b.messages.some((m) => /echo hi > out\.txt/.test(JSON.stringify(m.tool_calls ?? ''))) ? 'Earlier I ran echo hi > out.txt.' : 'I do not remember.' };
    return toolDone(b) ? { content: 'Done: out.txt holds hi.' } : { tool: ['Bash', { command: 'echo hi > out.txt', description: 'write the file' }] };
  });
  const { call, sam, w } = await web({ ai1, calcUrl: fakeCalc().url, settings: { models: { default: 'coder' } }, runExtra: { env: SWITCHES, home: { thinking: false, effort: 'low' } } });
  const r = await call('/api/chats', { jar: sam, method: 'POST', body: { text: 'Write hi into out.txt with a command.', model: 'coder', service: 0 } });
  expect(r.json.ok).toBe(true);
  const id = r.json.id;
  const until = async (fn, ms = 45_000) => { const t0 = Date.now(); for (;;) { const c = (await call(`/api/chats/${id}`, { jar: sam })).json; const v = fn(c); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out: ${JSON.stringify(c.events.slice(-4))}`); await Bun.sleep(150); } };
  const ask = await until((c) => c.events.find((e) => e.t === 'ask'));
  expect(ask).toMatchObject({ name: 'Bash' });
  expect(ask.text).toContain('echo hi > out.txt');
  // nothing ran before the yes
  const work = w.runner.dirs(2).work;
  expect(existsSync(join(work, 'out.txt'))).toBe(false);
  // another user cannot answer it
  expect((await call(`/api/chats/${id}/answer`, { jar: { c: null }, method: 'POST', body: { id: ask.id, choice: 'yes' } })).status).toBe(401);
  expect((await call(`/api/chats/${id}/answer`, { jar: sam, method: 'POST', body: { id: ask.id, choice: 'yes' } })).json.ok).toBe(true);
  const end = await until((c) => c.events.find((e) => e.t === 'end'));
  expect(end.reason).toBe('done');
  expect(readFileSync(join(work, 'out.txt'), 'utf8').trim()).toBe('hi');
  // every model request came through the gateway with the run's token, and the run's home is the user's own
  expect(ai1.chats().length).toBeGreaterThan(0);
  const runHome = JSON.parse(readFileSync(join(w.runner.dirs(2).home, 'settings.json'), 'utf8'));
  expect(runHome.remote.address).toBe(`http://127.0.0.1:${w.port}`);
  expect(realpathSync(Object.keys(JSON.parse(readFileSync(join(w.runner.dirs(2).home, 'trust.json'), 'utf8')))[0])).toBe(realpathSync(work));
  // the next message carries the conversation on
  expect((await call(`/api/chats/${id}/send`, { jar: sam, method: 'POST', body: { text: 'What did you write?' } })).json.ok).toBe(true);
  const second = await until((c) => c.events.filter((e) => e.t === 'end').length === 2 && c.events);
  expect(second.filter((e) => e.t === 'text').map((e) => e.text).join('\n')).toContain('Earlier I ran echo hi > out.txt.');
  expect(w.db.query("select count(*) as n from runs where status = 'done'").get().n).toBe(2);
}, 120_000);

// ---- Admin › Models (8 Oct 2026, round 2: "a clear interface for admins to change the selected models") ----

test('the jobs and who may pick: old settings still read, the last resort is admins\', and each job says whether a model fits', () => {
  const old = { models: { default: 'qwen-main', lastResort: ['laguna-xs-2.1:q8_0'], blocked: ['bad'] }, spill: { after: 60, to: { service: 1, model: 'stand-in' } } };
  expect(roleOf(old, 'tasks')).toEqual({ service: null, model: 'qwen-main' });
  expect(roleOf(old, 'chat')).toEqual({ service: null, model: 'qwen-main' });
  expect(roleOf(old, 'standIn')).toEqual({ service: 1, model: 'stand-in' });
  expect(roleOf(old, 'lastResort')).toEqual({ service: null, model: 'laguna-xs-2.1:q8_0' });
  expect(roleOf(old, 'helper')).toBe(null);
  expect(accessOf(old, 0, 'bad')).toBe('off');
  expect(accessOf(old, 0, 'laguna-xs-2.1:q8_0')).toBe('admin');
  expect(accessOf(old, 0, 'qwen-main')).toBe('all');
  const now = { ...old, models: { ...old.models, roles: { lastResort: { service: 0, model: 'big' }, chat: { service: 1, model: 'small' } }, access: { '0|qwen-main': 'admin' } } };
  expect(isLastResort(now, 'laguna-xs-2.1:q8_0', 0)).toBe(false);
  expect(isLastResort(now, 'big', 0)).toBe(true);
  expect(isLastResort(now, 'big', 1)).toBe(false);
  expect(roleOf(now, 'chat')).toEqual({ service: 1, model: 'small' });
  expect(accessOf(now, 0, 'qwen-main')).toBe('admin');
  expect(accessOf(now, 1, 'qwen-main')).toBe('all');
  const m = (caps, more = {}) => ({ caps: { chat: true, tools: true, thinking: false, vision: false, embedding: false, ...caps }, maxCtx: 262144, gb: 9, ...more });
  expect(fitFor('tasks', m({})).level).toBe('ok');
  expect(fitFor('tasks', m({ tools: false }))).toMatchObject({ level: 'warn', why: ['no tools: a run will most likely fail'] });
  expect(fitFor('chat', m({ chat: false, embedding: true })).level).toBe('no');
  expect(fitFor('tasks', m({}, { maxCtx: 8192 })).why).toContain('it reads only 8k at once');
  expect(fitFor('lastResort', m({}, { maxCtx: 131072 }), { tasksCtx: 131072 }).level).toBe('warn');
  expect(fitFor('lastResort', m({}, { maxCtx: 262144 }), { tasksCtx: 120000 }).level).toBe('ok');
  expect(fitFor('standIn', m({}), { service: 0, standInService: 0 }).level).toBe('warn');
  expect(fitFor('helper', m({}, { gb: 36 })).level).toBe('warn');
  expect(fitFor('tasks', null).level).toBe('no');
  expect(warningsOf(m({ tools: false }))).toEqual(['no tools: tasks will likely fail']);
  expect(warningsOf(m({ tools: false }), { mac: false })).toEqual(['no tools: no calculator']);
  expect(warningsOf(m({ chat: false, embedding: true }))).toEqual(['cannot chat: it will fail']);
});

const CAPS_MODELS = () => [
  { name: 'qwen-main', gb: 24, loaded: 120000, pinned: true, caps: ['completion', 'tools', 'thinking'], ctx: 262144 },
  { name: 'laguna-xs-2.1:q8_0', gb: 36, loaded: 120000, pinned: true, caps: ['completion', 'tools', 'thinking'], ctx: 262144 },
  { name: 'coder-notools', gb: 7, caps: ['completion'], ctx: 16384 },
  { name: 'embed', gb: 0.6, loaded: 2048, caps: ['embedding'], ctx: 2048 },
  { name: 'tiny', gb: 2, caps: ['completion', 'tools'], ctx: 131072 },
];

test('Admin › Models: every model with what it can do, the jobs with their fit, who may pick, and the change log', async () => {
  const ai1 = fakeOllama(CAPS_MODELS());
  const ai2 = fakeOllama([{ name: 'stand-in', gb: 9, loaded: 32768, caps: ['completion', 'tools'], ctx: 262144 }]);
  const { call, sam, boss } = await web({ ai1, ai2, calcUrl: fakeCalc().url, settings: { models: { default: 'qwen-main' } } });
  expect((await call('/api/admin/models', { jar: sam })).status).toBe(403);
  const b = (await call('/api/admin/models?refresh=1', { jar: boss })).json;
  expect(b.services.map((x) => [x.label, x.ok, x.count])).toEqual([['AI 1', true, 5], ['AI 2', true, 1]]);
  const by = (n) => b.models.find((m) => m.name === n);
  expect(by('qwen-main')).toMatchObject({ caps: { tools: true, thinking: true }, maxCtx: 262144, loaded: true, pinned: true, roles: ['tasks', 'chat'] });
  expect(by('coder-notools').warnings).toEqual(['no tools: tasks will likely fail']);
  expect(by('embed').caps.chat).toBe(false);
  expect(by('laguna-xs-2.1:q8_0')).toMatchObject({ access: 'admin', roles: ['lastResort'] });
  expect(b.roles.find((r) => r.id === 'tasks')).toMatchObject({ pick: { service: 0, model: 'qwen-main' }, fit: { level: 'ok' } });
  expect(b.roles.find((r) => r.id === 'tasks').choices.find((c) => c.model === 'embed').fit).toBe('no');
  expect(b.roles.find((r) => r.id === 'tasks').choices.find((c) => c.model === 'coder-notools').fit).toBe('warn');
  // jobs: what cannot do a job is refused with why; a warning is allowed and shown
  const role = (body) => call('/api/admin/models/role', { jar: boss, method: 'PUT', body });
  expect((await role({ role: 'tasks', service: 0, model: 'embed' })).json.error).toMatch(/cannot chat/);
  expect((await role({ role: 'tasks', service: 0, model: 'nope' })).status).toBe(400);
  const warned = (await role({ role: 'chat', service: 0, model: 'coder-notools' })).json;
  expect(warned.roles.find((r) => r.id === 'chat')).toMatchObject({ pick: { model: 'coder-notools' }, fit: { level: 'warn' } });
  expect((await role({ role: 'standIn', service: 0, model: 'laguna-xs-2.1:q8_0' })).json.error).toMatch(/cannot be the same/);
  expect((await role({ role: 'helper', service: 0, model: 'laguna-xs-2.1:q8_0' })).json.error).toMatch(/cannot be the Helper/);
  const set = (await role({ role: 'standIn', service: 1, model: 'stand-in', after: 45 })).json;
  expect(set.roles.find((r) => r.id === 'standIn')).toMatchObject({ pick: { service: 1, model: 'stand-in' }, after: 45, fit: { level: 'ok' } });
  expect((await role({ role: 'tasks', model: '' })).status).toBe(400);
  // who may pick: off is refused for a model with a job; admins-only hides it from users and refuses them
  const access = (body) => call('/api/admin/models/access', { jar: boss, method: 'PUT', body });
  expect((await access({ service: 0, model: 'qwen-main', access: 'off' })).json.error).toMatch(/Tasks default/);
  expect((await access({ service: 0, model: 'tiny', access: 'admin' })).json.ok).toBe(true);
  expect((await call('/api/models', { jar: sam })).json.models.map((m) => m.name)).not.toContain('tiny');
  expect((await call('/api/models', { jar: boss })).json.models.map((m) => m.name)).toContain('tiny');
  const samKey = (await call('/api/keys', { jar: sam, method: 'POST', body: { name: 'k' } })).json.key;
  expect((await call('/api/chat', { key: samKey, method: 'POST', body: { model: 'tiny', messages: [{ role: 'user', content: 'hi' }] } })).json.error).toMatch(/admins only/);
  expect((await access({ service: 0, model: 'tiny', access: 'off' })).json.ok).toBe(true);
  expect((await call('/api/models', { jar: boss })).json.models.map((m) => m.name)).not.toContain('tiny');
  // the users' picker: the default and the warnings
  const mine = (await call('/api/models', { jar: sam })).json;
  expect(mine).toMatchObject({ default: 'qwen-main', defaultService: 0 });
  expect(mine.models.find((m) => m.name === 'coder-notools').warnings).toEqual(['no tools: tasks will likely fail']);
  const log = (await call('/api/admin/models', { jar: boss })).json.log.map((l) => `${l.user} · ${l.what} · ${l.detail}`);
  expect(log).toEqual(expect.arrayContaining(['boss · role · Chat default: coder-notools on AI 1', 'boss · role · Stand-in: stand-in on AI 2 · after 45 s', 'boss · access · tiny on AI 1: admins only', 'boss · access · tiny on AI 1: off']));
});

test('Test, keep and let go: one timed answer, kept for good, and no letting go while it answers', async () => {
  let release;
  const held = new Promise((ok) => { release = ok; });
  const models = CAPS_MODELS();
  const ai1 = fakeOllama(models, (b) => (b.messages?.[0]?.content === 'hold' ? null : { content: 'ok' }));
  const { call, boss, w } = await web({ ai1, calcUrl: fakeCalc().url, settings: { models: { default: 'qwen-main' } } });
  const t = (await call('/api/admin/models/test', { jar: boss, method: 'POST', body: { service: 0, model: 'tiny' } })).json;
  expect(t).toMatchObject({ ok: true, text: 'ok' });
  expect(typeof t.firstMs).toBe('number');
  expect((await call('/api/admin/models/test', { jar: boss, method: 'POST', body: { service: 0, model: 'embed' } })).json.error).toMatch(/embedding/);
  // keep: loaded for good (keep_alive -1)
  await call('/api/admin/models/keep', { jar: boss, method: 'POST', body: { service: 0, model: 'tiny', keep: true } });
  expect(ai1.seen.filter((x) => x.path === '/api/generate').at(-1).body).toMatchObject({ model: 'tiny', keep_alive: -1 });
  // let go: refused while a request is answering on it, done after
  const bossKey = (await call('/api/keys', { jar: boss, method: 'POST', body: { name: 'k' } })).json.key;
  const ac = new AbortController();
  const hanging = fetch(`http://127.0.0.1:${w.port}/api/chat`, { method: 'POST', signal: ac.signal, headers: { authorization: `Bearer ${bossKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'tiny', messages: [{ role: 'user', content: 'hold' }] }) }).catch(() => null);
  await Bun.sleep(150);
  const busy = await call('/api/admin/models/letgo', { jar: boss, method: 'POST', body: { service: 0, model: 'tiny' } });
  expect(busy.status).toBe(409);
  expect(busy.json.error).toMatch(/answering 1 request/);
  ac.abort(); release(); await hanging;
  await Bun.sleep(100);
  const gone = await call('/api/admin/models/letgo', { jar: boss, method: 'POST', body: { service: 0, model: 'tiny' } });
  expect(gone.json.ok).toBe(true);
  expect(ai1.seen.filter((x) => x.path === '/api/generate').at(-1).body).toMatchObject({ model: 'tiny', keep_alive: 0 });
  expect(gone.json.models.find((m) => m.name === 'tiny').loaded).toBe(false);
  expect(gone.json.log.map((l) => l.what)).toEqual(expect.arrayContaining(['let go', 'keep loaded', 'test']));
  void held;
});

test('a chat whose model was switched off carries on with the default, and says so', async () => {
  const ai1 = fakeOllama(CAPS_MODELS(), (b) => ({ content: `answer from ${b.model}` }));
  const { call, sam, boss } = await web({ ai1, calcUrl: fakeCalc().url, mode: 'server', settings: { models: { default: 'qwen-main' } } });
  const r = await call('/api/chats', { jar: sam, method: 'POST', body: { text: 'hello', model: 'tiny', service: 0 } });
  const id = r.json.id;
  const until = async (n) => { for (let i = 0; i < 100; i++) { const c = (await call(`/api/chats/${id}`, { jar: sam })).json; if (c.events.filter((e) => e.t === 'end').length >= n) return c.events; await Bun.sleep(50); } throw new Error('no end'); };
  expect((await until(1)).at(-1)).toMatchObject({ t: 'end', final: 'answer from tiny' });
  await call('/api/admin/models/access', { jar: boss, method: 'PUT', body: { service: 0, model: 'tiny', access: 'off' } });
  expect((await call(`/api/chats/${id}/send`, { jar: sam, method: 'POST', body: { text: 'again' } })).json.ok).toBe(true);
  const ev = await until(2);
  expect(ev.find((e) => e.t === 'note')?.text).toBe('tiny is no longer available here, so this chat goes on with qwen-main.');
  expect(ev.at(-1)).toMatchObject({ t: 'end', final: 'answer from qwen-main' });
  // picking it by name is refused
  expect((await call(`/api/chats/${id}/send`, { jar: sam, method: 'POST', body: { text: 'x', model: 'tiny', service: 0 } })).json.error).toMatch(/switched off/);
});

test('a web run\'s side jobs go to the admin\'s Helper, through the gateway, even when its person may not pick that model', async () => {
  const ai1 = fakeOllama([{ name: 'coder', gb: 9, loaded: 32768, pinned: true, caps: ['completion', 'tools'], ctx: 262144 }, { name: 'tiny', gb: 2, loaded: 32768, caps: ['completion', 'tools'], ctx: 131072 }], (b) => {
    if (!b.tools?.length) return { content: '{"verdict":"ok","problems":[]}' };
    return toolDone(b) ? { content: 'Done: out.txt holds hi.' } : { tool: ['Bash', { command: 'echo hi > out.txt', description: 'write the file' }] };
  });
  const env = { ...SWITCHES };
  delete env.AGENTIC_SECOND_LOOK; // the second look is a side job: on here
  const { call, sam, boss } = await web({ ai1, calcUrl: fakeCalc().url, settings: { models: { default: 'coder' } }, runExtra: { env, home: { thinking: false, effort: 'low' } } });
  await call('/api/admin/models/role', { jar: boss, method: 'PUT', body: { role: 'helper', service: 0, model: 'tiny' } });
  // sam may not pick it (admins only; "nobody" is refused for a model that has a job)
  expect((await call('/api/admin/models/access', { jar: boss, method: 'PUT', body: { service: 0, model: 'tiny', access: 'off' } })).status).toBe(400);
  expect((await call('/api/admin/models/access', { jar: boss, method: 'PUT', body: { service: 0, model: 'tiny', access: 'admin' } })).json.ok).toBe(true);
  expect((await call('/api/models', { jar: sam })).json.models.map((m) => m.name)).not.toContain('tiny');
  const r = await call('/api/chats', { jar: sam, method: 'POST', body: { text: 'Write hi into out.txt with a command.', model: 'coder', service: 0 } });
  const id = r.json.id;
  for (let i = 0; i < 300; i++) {
    const c = (await call(`/api/chats/${id}`, { jar: sam })).json;
    const ask = c.events.find((e) => e.t === 'ask' && !c.events.some((x) => x.t === 'answered' && String(x.id) === String(e.id)));
    if (ask) await call(`/api/chats/${id}/answer`, { jar: sam, method: 'POST', body: { id: ask.id, choice: 'yes' } });
    if (c.events.some((e) => e.t === 'end')) break;
    await Bun.sleep(150);
  }
  const models = ai1.chats().map((b) => b.model);
  expect(models).toContain('coder');
  expect(models).toContain('tiny');
}, 120_000);

