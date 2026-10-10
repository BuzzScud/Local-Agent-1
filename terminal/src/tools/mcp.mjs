// The MCP hub (3 Oct 2026): your MCP servers, connected for as long as this session runs.
// MCP (the Model Context Protocol) lets a model use tools that live outside the app: a program
// on this Mac, or a service at an address. One hub per app process: the conversation and its
// helpers share each connection, and the servers stop when the app does.
//   - A server started as a program runs in the project folder with a clean environment (PATH,
//     HOME and the like, plus what its settings give it), behind the same fence the model's
//     commands run in (sandbox.mjs), with the internet and local services opened as /mcp says.
//     What it prints to its error stream goes to ~/.agentic-coder/logs/mcp-<name>.log.
//   - A server at an address is reached over Streamable HTTP (the older HTTP + SSE way when it
//     only speaks that), with its key in a header, or signed in (mcp-auth.mjs).
//   - Both protocol eras: 2026-07-28 (no hello, every request carries its version) is tried
//     first, 2025-11-25 (initialize) otherwise. The official client does the talking.
//   - Every step has a time limit; a call can be stopped (esc); a server that crashed is started
//     once more when it is next used.
// What the model sees of the tools, and what you allow, is in agent/mcp.mjs and permissions.mjs.
import { EventEmitter } from 'node:events';
import { appendFileSync, mkdirSync, statSync, renameSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { catalogOf, fingerprint, saysOf } from '../agent/mcp.mjs';
import { SANDBOX_EXEC, sandboxProfile, sandboxAvailable } from './sandbox.mjs';
import { preparedImage } from './media.mjs';

const CLIENT_INFO = { name: 'agentic-coder', version: '0.1.0' };
// How long a server may take to start and list its tools, and one call to finish.
const START_MS = 30_000;
const CALL_MS = 120_000;
// A call that keeps reporting progress may run on, up to this.
const CALL_MAX_MS = 15 * 60_000;
const PROBE_MS = 5000;
const LOG_MAX = 2 * 1024 * 1024;

// The official client, loaded at the first server (most windows have none).
let sdkP = null;
const sdk = () => (sdkP ??= Promise.all([import('@modelcontextprotocol/client'), import('@modelcontextprotocol/client/stdio')]).then(([core, stdio]) => ({ ...core, ...stdio })));

const tilde = (p) => (String(p).startsWith(homedir()) ? `~${String(p).slice(homedir().length)}` : String(p));
const untilde = (p) => (String(p).startsWith('~/') ? `${homedir()}${String(p).slice(1)}` : String(p));
const secs = (ms) => `${Math.round(ms / 1000)} s`;

// What makes a server's connection: a change to any of it starts the server again.
const stampOf = (s) => JSON.stringify([s.runs, s.command, s.args, s.env, s.keyEnv, s.sandbox, s.net, s.local, s.read, s.url, s.auth, s.header, s.on, s.hasKey, s.keyEnd, s.keyAt]);

// How a program server is started: { command, args, env, cwd, fenced }.
export function spawnSpec(server, { cwd, key = null, baseEnv = {}, sandbox = true } = {}) {
  const env = { ...baseEnv, ...(server.env ?? {}), ...(server.keyEnv && key ? { [server.keyEnv]: key } : {}) };
  if (server.sandbox !== false && sandbox && sandboxAvailable()) {
    const profile = sandboxProfile(cwd, { net: server.net === true, local: server.local ?? [], readOnly: (server.read ?? []).map(untilde) });
    return { command: SANDBOX_EXEC, args: ['-p', profile, server.command, ...(server.args ?? [])], env, cwd, fenced: true };
  }
  return { command: server.command, args: server.args ?? [], env, cwd, fenced: false };
}

// An error from the client or the server, in plain words.
function plainError(e, server, { timeoutMs } = {}) {
  const m = String(e?.message ?? e);
  const code = e?.code;
  if (code === 'ENOENT' || /ENOENT|posix_spawn/.test(m)) return `its program was not found: ${server?.command ?? ''} (is it installed, and on the PATH this app was started with?)`;
  if (code === 'EACCES') return `its program could not be run: ${server?.command ?? ''} (no permission)`;
  if (/requires authorization|HTTP 401|\b401\b|Unauthorized|needs you to sign in/i.test(m)) return server?.auth === 'oauth' ? 'it needs you to sign in: /mcp, then s on it' : 'it did not accept the key (401): change it in /mcp';
  if (/\b403\b/.test(m)) return 'it refused this key or sign-in (403)';
  if (code === 'REQUEST_TIMEOUT') return `it did not answer in ${secs(timeoutMs ?? START_MS)}`;
  if (code === 'CONNECTION_CLOSED') return 'it stopped (its log may say why)';
  if (/fetch failed|Unable to connect|ConnectionRefused|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|network/i.test(m)) return `it could not be reached${server?.url ? ` (${hostOf(server.url)})` : ''}`;
  return m.replace(/\s+/g, ' ').slice(0, 240);
}
const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };
const needsSignIn = (e) => e?.signin === true || e?.cause?.signin === true || /requires authorization|HTTP 401|\b401\b|Unauthorized|needs you to sign in/i.test(String(e?.message ?? e));

export class McpHub extends EventEmitter {
  // cwd: the project folder (a program server starts there). keyOf(server): its key, or null.
  // era / saveEra: the era a program server spoke last time (mcp-store.mjs), so its start is not
  // probed again. auth(server): an OAuth provider for a signed-in server (mcp-auth.mjs).
  // logFile(name): where a server's own messages go (null: nowhere).
  // allowed: { print(id), remember(id, print) }: the fingerprint each "always allow" was given for.
  constructor({ cwd, keyOf = () => null, era = () => null, saveEra = () => {}, auth = null, logFile = null, sandbox = true, startMs = START_MS, callMs = CALL_MS, allowed = null } = {}) {
    super();
    Object.assign(this, { cwd, keyOf, era, saveEra, auth, logFile, sandbox, startMs, callMs, allowed });
    this.servers = new Map(); // name → { cfg, state, error, client, tools, … }
  }

  moveTo(cwd) { this.cwd = cwd; }

  #entry(cfg) {
    let st = this.servers.get(cfg.name);
    if (!st) { st = { cfg, state: 'off', error: null, client: null, tools: [], prompts: [], era: null, version: null, info: null, fenced: false, starting: null, gen: 0, askers: [], changes: 0 }; this.servers.set(cfg.name, st); }
    return st;
  }
  #set(st, state, error = null) { st.state = state; st.error = error; this.emit('state', { name: st.cfg.name, state, error }); }
  #log(name, line) {
    const file = this.logFile?.(name);
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      try { if (statSync(file).size > LOG_MAX) renameSync(file, `${file}.1`); } catch { /* no log yet */ }
      appendFileSync(file, `${new Date().toISOString()} ${line.replace(/\s+$/, '')}\n`);
    } catch { /* a log that cannot be written stops nothing */ }
  }

  // The servers to have: each that is on is started (in the background), each that went or was
  // switched off is stopped, each whose settings changed is started again.
  configure(servers = []) {
    const want = new Map(servers.map((s) => [s.name, s]));
    for (const [name, st] of this.servers) if (!want.has(name)) { this.stop(name); this.servers.delete(name); }
    for (const cfg of servers) {
      const st = this.#entry(cfg);
      const same = stampOf(st.cfg) === stampOf(cfg);
      st.cfg = cfg;
      if (cfg.on === false) { if (st.state !== 'off') this.stop(cfg.name); continue; }
      if (same && (st.state === 'connected' || st.state === 'starting')) continue;
      this.start(cfg.name);
    }
  }

  // One client for a server: connected, with its tools listed. Throws in plain words.
  async #open(cfg, { signal, onClose, onChanged, ask, key: given } = {}) {
    const { Client, StreamableHTTPClientTransport, SSEClientTransport, StdioClientTransport, getDefaultEnvironment } = await sdk();
    // Its key: the one given (the form's Test, with a key typed but not saved yet), else the kept one.
    const key = given !== undefined ? given : cfg.auth === 'key' || cfg.keyEnv ? this.keyOf(cfg) : null;
    const make = () => {
      const client = new Client(CLIENT_INFO, {
        // A question of the server's own (elicitation) is taken only when someone is there to answer it.
        capabilities: ask ? { elicitation: { form: {}, url: {} } } : {},
        versionNegotiation: { mode: 'auto', probe: { timeoutMs: PROBE_MS } },
        ...(onChanged ? { listChanged: { tools: { onChanged } } } : {}),
      });
      if (ask) client.setRequestHandler('elicitation/create', (req) => ask(req.params));
      client.onerror = (e) => this.#log(cfg.name, `error: ${String(e?.message ?? e)}`);
      return client;
    };
    let client = make();
    let transport, fenced = false, prior = null, httpOptions = null;
    const program = () => {
      const spec = spawnSpec(cfg, { cwd: this.cwd, key, baseEnv: getDefaultEnvironment(), sandbox: this.sandbox });
      fenced = spec.fenced;
      const t = new StdioClientTransport({ command: spec.command, args: spec.args, env: spec.env, cwd: spec.cwd, stderr: 'pipe' });
      t.stderr?.on('data', (d) => this.#log(cfg.name, String(d)));
      return t;
    };
    // A start that failed leaves nothing running: the client is closed, and the transport too (a
    // program that never answered was never handed to the client, so only the transport can end it).
    const closed = async () => { try { await client.close(); } catch { /* it never opened */ } try { await transport?.close(); } catch { /* already gone */ } };
    if (cfg.runs === 'command') {
      transport = program();
      // The era it spoke last time: without it, the probe starts the program one more time.
      const known = this.era(cfg);
      if (known?.era === 'legacy') prior = { kind: 'legacy' };
      else if (known?.era === 'modern' && known.discover) prior = { kind: 'modern', discover: known.discover };
    } else {
      const header = cfg.header && cfg.header !== 'Authorization' && key ? { [cfg.header]: key } : null;
      httpOptions = { ...(cfg.auth === 'oauth' && this.auth ? { authProvider: this.auth(cfg) } : key && !header ? { authProvider: { token: async () => key } } : {}), ...(header ? { requestInit: { headers: header } } : {}) };
      transport = new StreamableHTTPClientTransport(new URL(cfg.url), httpOptions);
    }
    try {
      await client.connect(transport, { timeout: this.startMs, signal, ...(prior ? { prior } : {}) });
    } catch (e) {
      await closed();
      if (signal?.aborted) throw e;
      const status = e?.data?.status ?? Number(/\bHTTP (\d{3})\b/.exec(String(e?.message ?? ''))?.[1] ?? 0);
      if (prior) {
        // What it spoke last time no longer holds (the server was updated): asked afresh.
        prior = null;
        client = make();
        transport = program();
        await client.connect(transport, { timeout: this.startMs, signal }).catch(async (e2) => { await closed(); throw e2; });
      } else if (cfg.runs === 'address' && [400, 404, 405].includes(status)) {
        // A server that only speaks the older HTTP + SSE way answers the first POST with 400, 404 or 405.
        client = make();
        transport = new SSEClientTransport(new URL(cfg.url), httpOptions);
        await client.connect(transport, { timeout: this.startMs, signal }).catch(async () => { await closed(); throw e; });
      } else throw e;
    }
    client.onclose = () => onClose?.();
    const era = client.getProtocolEra?.() ?? 'legacy';
    if (cfg.runs === 'command' && !prior) this.saveEra(cfg, era, era === 'modern' ? client.getDiscoverResult?.() ?? null : null);
    const { tools } = await client.listTools(undefined, { timeout: this.startMs, signal });
    return { client, transport, tools, era, version: client.getNegotiatedProtocolVersion?.() ?? null, info: client.getServerVersion?.() ?? null, caps: client.getServerCapabilities?.() ?? {}, instructions: client.getInstructions?.() ?? '', fenced };
  }

  // Start (or start again) one server. Never throws: what went wrong is its state.
  start(name) {
    const st = this.servers.get(name);
    if (!st) return Promise.resolve(null);
    const gen = ++st.gen;
    st.abort?.abort();
    if (st.client) { const old = st.client; st.client = null; old.onclose = null; old.close().catch(() => {}); }
    this.#set(st, 'starting');
    const t0 = Date.now();
    // A start under way is let go when the server is stopped or started again (its program with it).
    const abort = (st.abort = new AbortController());
    st.starting = (async () => {
      try {
        const got = await this.#open(st.cfg, {
          signal: abort.signal,
          onClose: () => { if (st.gen === gen && st.state === 'connected') { st.client = null; this.#set(st, 'failed', 'it stopped (its log may say why)'); this.#log(name, 'the server stopped'); } },
          onChanged: (err, tools) => { if (st.gen === gen && !err && Array.isArray(tools)) this.#changed(st, tools); },
          ask: (params) => (st.askers.at(-1) ? st.askers.at(-1)(params) : { action: 'decline' }),
        });
        if (st.gen !== gen) { got.client.onclose = null; got.client.close().catch(() => {}); return st; }
        Object.assign(st, { client: got.client, tools: got.tools, era: got.era, version: got.version, info: got.info, caps: got.caps, fenced: got.fenced, instructions: got.instructions, ms: Date.now() - t0 });
        this.#log(name, `connected in ${Date.now() - t0} ms · ${got.version ?? got.era} · ${got.tools.length} tools${got.fenced ? ' · in its sandbox' : ''}`);
        this.#set(st, 'connected');
      } catch (e) {
        if (st.gen !== gen) return st;
        const why = plainError(e, st.cfg, { timeoutMs: this.startMs });
        this.#log(name, `did not start: ${why} (${String(e?.message ?? e).slice(0, 300)})`);
        this.#set(st, st.cfg.auth === 'oauth' && needsSignIn(e) ? 'signin' : 'failed', why);
      }
      return st;
    })();
    return st.starting;
  }

  #changed(st, tools) {
    const before = new Map(st.tools.map((t) => [t.name, fingerprint(t)]));
    const after = new Map(tools.map((t) => [t.name, fingerprint(t)]));
    const added = [...after.keys()].filter((n) => !before.has(n));
    const removed = [...before.keys()].filter((n) => !after.has(n));
    const changed = [...after.keys()].filter((n) => before.has(n) && before.get(n) !== after.get(n));
    st.tools = tools;
    if (!added.length && !removed.length && !changed.length) return;
    st.changes += 1;
    this.#log(st.cfg.name, `its tools changed: ${added.length} new, ${removed.length} gone, ${changed.length} changed`);
    this.emit('changed', { name: st.cfg.name, added, removed, changed });
  }

  async stop(name) {
    const st = this.servers.get(name);
    if (!st) return;
    st.gen += 1;
    st.abort?.abort();
    const c = st.client;
    st.client = null;
    st.tools = [];
    if (st.state !== 'off') this.#set(st, 'off');
    if (c) { c.onclose = null; try { await c.close(); } catch { /* already gone */ } }
  }
  async stopAll() { await Promise.all([...this.servers.keys()].map((n) => this.stop(n))); }

  // Wait for the servers still starting, at most this long. The names that were not ready in time.
  async ready(timeoutMs = 8000) {
    const starting = [...this.servers.values()].filter((s) => s.state === 'starting' && s.starting);
    if (!starting.length) return [];
    let timer;
    await Promise.race([Promise.allSettled(starting.map((s) => s.starting)), new Promise((r) => { timer = setTimeout(r, timeoutMs); })]);
    clearTimeout(timer);
    return starting.filter((s) => s.state === 'starting').map((s) => s.cfg.name);
  }

  // Each server as /mcp and /doctor show it.
  status() {
    return [...this.servers.values()].map((s) => ({ name: s.cfg.name, from: s.cfg.from ?? 'you', runs: s.cfg.runs, on: s.cfg.on !== false, state: s.state, error: s.error, tools: s.tools.length, off: s.tools.filter((t) => (s.cfg.marks?.off ?? []).includes(t.name)).length,
      reads: s.tools.filter((t) => s.cfg.marks?.reads?.[t.name] === fingerprint(t)).length, era: s.era, version: s.version, info: s.info, fenced: s.fenced, changes: s.changes, where: whereOf(s.cfg) }));
  }
  has(name) { return this.servers.has(name); }
  get size() { return this.servers.size; }
  connected() { return [...this.servers.values()].filter((s) => s.state === 'connected'); }
  // A server's tools as its server lists them now, each with its fingerprint and what it says of itself.
  toolsOf(name) { const s = this.servers.get(name); return (s?.tools ?? []).map((t) => ({ name: t.name, description: String(t.description ?? ''), print: fingerprint(t), says: saysOf(t) })); }
  // Every tool of every connected server, with your marks (agent/mcp.mjs catalogOf).
  catalog() { return catalogOf(this.connected().map((s) => ({ name: s.cfg.name, from: s.cfg.from, tools: s.tools, marks: s.cfg.marks }))); }
  setMarks(name, marks) { const s = this.servers.get(name); if (s) s.cfg = { ...s.cfg, marks }; }
  // The servers handed to Anthropic's connector on the Claude API (/mcp's On Claude row): a public
  // https address each, with its token (its key, or its sign-in's), read now.
  connectors() {
    return [...this.servers.values()].filter((s) => s.cfg.on !== false && s.cfg.runs === 'address' && s.cfg.claude === 'connector' && /^https:/.test(s.cfg.url)).map((s) => {
      let token = null;
      try { token = s.cfg.auth === 'key' ? this.keyOf(s.cfg) : s.cfg.auth === 'oauth' && this.auth ? this.auth(s.cfg).tokens()?.access_token ?? null : null; } catch { token = null; }
      return { name: s.cfg.name, url: s.cfg.url, token };
    });
  }
  // The connected servers that offer resources (@server:uri) and prompts (/server:prompt), by name.
  offers() { const on = this.connected(); return { resources: on.filter((s) => s.caps?.resources).map((s) => s.cfg.name), prompts: on.filter((s) => s.caps?.prompts).map((s) => s.cfg.name) }; }
  // What each connected server said about itself when it connected (its instructions), by name.
  notes() { return Object.fromEntries(this.connected().map((s) => [s.cfg.name, s.instructions ?? '']).filter(([, t]) => t)); }
  // A tool's fingerprint as its server lists it now (null: the server no longer has it, or is not connected).
  printOf(name, tool) { const s = this.servers.get(name); const t = s?.state === 'connected' ? s.tools.find((x) => x.name === tool) : null; return t ? fingerprint(t) : null; }
  stateOf(name) { const s = this.servers.get(name); return s ? { state: s.state, error: s.error, runs: s.cfg.runs, where: whereOf(s.cfg) } : null; }

  // A server that is connected, or started once more when it had stopped. Throws in plain words.
  async #live(name) {
    const st = this.servers.get(name);
    if (!st) throw new Error(`there is no MCP server "${name}"`);
    if (st.state === 'starting' && st.starting) await st.starting;
    if (st.state === 'failed' && st.cfg.on !== false && Date.now() - (st.retried ?? 0) > 10_000) { st.retried = Date.now(); await this.start(name); }
    if (st.state !== 'connected' || !st.client) throw new Error(st.state === 'off' ? `the MCP server "${name}" is switched off (/mcp)` : st.state === 'signin' ? `the MCP server "${name}" needs the user to sign in (/mcp)` : `the MCP server "${name}" is not running: ${st.error ?? 'it did not start'}`);
    return st;
  }

  // One tool call. ask(params): the server's own question to the user while it runs, answered
  // { action: 'accept', content } · { action: 'decline' } · { action: 'cancel' }.
  // The raw result ({ content, structuredContent, isError }); throws in plain words.
  async call(name, tool, args, { signal, timeoutMs, ask } = {}) {
    const st = await this.#live(name);
    const limit = timeoutMs ?? (st.cfg.timeout ? st.cfg.timeout * 1000 : this.callMs);
    if (ask) st.askers.push(ask);
    try {
      return await st.client.callTool({ name: tool, arguments: args ?? {} }, { signal, timeout: limit, resetTimeoutOnProgress: true, maxTotalTimeout: Math.max(limit, CALL_MAX_MS) });
    } catch (e) {
      if (signal?.aborted) throw Object.assign(new Error('Interrupted.'), { aborted: true });
      throw new Error(plainError(e, st.cfg, { timeoutMs: limit }));
    } finally {
      if (ask) st.askers.splice(st.askers.lastIndexOf(ask), 1);
    }
  }

  // A server's resources and prompts (the Level 1 extras: @server:uri and /server:prompt).
  async resources(name, { signal } = {}) { const st = await this.#live(name); if (!st.caps?.resources) return []; try { return (await st.client.listResources(undefined, { signal, timeout: this.startMs })).resources ?? []; } catch (e) { throw new Error(plainError(e, st.cfg)); } }
  async readResource(name, uri, { signal } = {}) { const st = await this.#live(name); try { return await st.client.readResource({ uri }, { signal, timeout: this.callMs }); } catch (e) { throw new Error(plainError(e, st.cfg, { timeoutMs: this.callMs })); } }
  async prompts(name, { signal } = {}) { const st = await this.#live(name); if (!st.caps?.prompts) return []; try { return (await st.client.listPrompts(undefined, { signal, timeout: this.startMs })).prompts ?? []; } catch (e) { throw new Error(plainError(e, st.cfg)); } }
  async prompt(name, prompt, args, { signal } = {}) { const st = await this.#live(name); try { return await st.client.getPrompt({ name: prompt, arguments: args ?? {} }, { signal, timeout: this.callMs }); } catch (e) { throw new Error(plainError(e, st.cfg, { timeoutMs: this.callMs })); } }

  // /mcp's Test: start a server once as the form has it now, list its tools, and let it go.
  // { ok, ms, era, version, fenced, tools: [{ name, description, says }], error }
  async test(cfg, { signal, key } = {}) {
    const t0 = Date.now();
    try {
      const got = await this.#open(cfg, { signal, ...(key !== undefined ? { key } : {}) });
      const tools = got.tools.map((t) => ({ name: t.name, description: String(t.description ?? ''), says: saysOf(t) }));
      got.client.onclose = null;
      got.client.close().catch(() => {});
      return { ok: true, ms: Date.now() - t0, era: got.era, version: got.version, fenced: got.fenced, info: got.info, tools };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, error: plainError(e, cfg, { timeoutMs: this.startMs }), signin: cfg.auth === 'oauth' && needsSignIn(e) };
    }
  }
}

// Where a server runs, in a few words (the /mcp list).
export function whereOf(s) {
  if (s.runs === 'address') return `${hostOf(s.url)} · ${s.auth === 'oauth' ? 'sign-in' : s.auth === 'key' ? 'a key' : 'no key'}`;
  const local = s.local === 'any' ? 'local services' : s.local?.length ? `127.0.0.1:${s.local.join(', ')}` : null;
  return `${String(s.command).split('/').pop()} · ${s.sandbox === false ? 'no sandbox' : ['sandbox', s.net ? 'internet' : null, local].filter(Boolean).join(' · ')}`;
}

// A picture a tool returned ({ data, mime }), as the conversation carries one (agent/images.mjs):
// made no larger than a model takes, by the picture helper. Where that helper is not built, a
// PNG or JPEG of ordinary size goes as it came. null: not a picture a model can be shown.
const PICTURE_KINDS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const PICTURE_MAX = 4 * 1024 * 1024; // of base64, as it came
export function pictureFor(pic, label = 'a picture from an MCP tool') {
  const ext = PICTURE_KINDS[String(pic?.mime ?? '').toLowerCase()];
  if (!ext || typeof pic.data !== 'string' || !pic.data) return null;
  const file = join(tmpdir(), `agentic-mcp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
  try {
    writeFileSync(file, Buffer.from(pic.data, 'base64'));
    return { ...preparedImage(file), path: label };
  } catch {
    return (ext === 'png' || ext === 'jpg') && pic.data.length <= PICTURE_MAX ? { path: label, mime: pic.mime, data: pic.data } : null;
  } finally { rmSync(file, { force: true }); }
}
