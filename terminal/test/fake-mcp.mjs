// A stand-in MCP server, for the tests and for the Arena's MCP check: no download, no account.
// It speaks both ways a real one is reached (a program's input and output, or an address) and
// both protocol eras: 2025-11-25 with its hello (initialize), and 2026-07-28 without one
// (server/discover, every request carrying its version, results with a resultType).
//
//   bun terminal/test/fake-mcp.mjs                       over input and output, the default spec
//   FAKE_MCP='{"era":"modern"}' bun …/fake-mcp.mjs       a spec as JSON (or FAKE_MCP_SPEC: a file)
//   startFakeMcp(spec) → { url, close(), log, setTools(), calls() }   at an address, in this process
//   fakeMcpCommand(spec) → { command, args, env }        how to start it as a program
//
// The spec: { era: 'legacy' | 'modern' | 'both', name, version, instructions, tools, resources,
// prompts, start: 'ok' | 'crash' | 'hang' | 'deaf' | 'garbage', changeAfter (tool calls before the list
// changes to tools2), token (an address: the Bearer token it wants), keyEnv + key (a program: the
// environment variable it wants and what must be in it), log (a file: one JSON line per message) }.
// A tool's `does` says what a call does: echo · text · add · picture · fail · crash · hang · slow ·
// structured · link · ask (it asks the user one thing first) · env (an environment variable) ·
// fetch (a web address, to see what its sandbox lets through).
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';

export const LEGACY = '2025-11-25';
export const MODERN = '2026-07-28';
const KEY = { version: 'io.modelcontextprotocol/protocolVersion', server: 'io.modelcontextprotocol/serverInfo', sub: 'io.modelcontextprotocol/subscriptionId' };

// A 2 × 2 red PNG: small enough to read in a test's output.
export const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8DAwMDAAAAGAQEAh2rPSgAAAABJRU5ErkJggg==';
// A square of one colour as a PNG (base64), big enough for a model to look at (the MCP check's logo).
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function solidPng(size = 96, [r, g, b] = [214, 40, 40]) {
  const row = Buffer.alloc(1 + size * 3);
  for (let i = 0; i < size; i++) { row[1 + i * 3] = r; row[2 + i * 3] = g; row[3 + i * 3] = b; }
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required });
export const DEFAULT_TOOLS = [
  { name: 'echo', description: 'Say back the text it is given.', inputSchema: obj({ text: { type: 'string', description: 'What to say back' } }, ['text']), annotations: { readOnlyHint: true }, does: 'echo' },
  { name: 'add', description: 'Add two numbers.', inputSchema: obj({ a: { type: 'number' }, b: { type: 'number' } }, ['a', 'b']), annotations: { readOnlyHint: true }, does: 'add' },
  { name: 'get_ticket', description: 'Read one ticket of the shop by its number: its title, state and who has it.', inputSchema: obj({ number: { type: 'integer', description: 'The ticket number' } }, ['number']), annotations: { readOnlyHint: true }, does: 'ticket' },
  { name: 'create_ticket', description: 'Open a new ticket in the shop tracker.', inputSchema: obj({ title: { type: 'string' }, body: { type: 'string' }, assignee: { type: 'string' } }, ['title']), annotations: { destructiveHint: false }, does: 'create' },
  { name: 'picture', description: 'The shop logo, as a picture.', inputSchema: obj(), annotations: { readOnlyHint: true }, does: 'picture' },
  { name: 'fail', description: 'A tool that always fails.', inputSchema: obj(), does: 'fail' },
  { name: 'slow', description: 'Answers after a while.', inputSchema: obj({ ms: { type: 'integer' } }), does: 'slow' },
  { name: 'structured', description: 'The stock of one item, as data.', inputSchema: obj({ item: { type: 'string' } }, ['item']), outputSchema: obj({ item: { type: 'string' }, left: { type: 'integer' } }, ['item', 'left']), does: 'structured' },
  { name: 'notes.link', description: 'A link to the release notes.', inputSchema: obj(), does: 'link' },
];
export const DEFAULT_SPEC = { era: 'legacy', name: 'fake-shop', version: '1.0.0', instructions: '', tools: DEFAULT_TOOLS, resources: [], prompts: [], start: 'ok' };

const text = (t) => ({ content: [{ type: 'text', text: String(t) }] });
const rpcError = (code, message, data) => Object.assign(new Error(message), { rpc: { code, message, ...(data !== undefined ? { data } : {}) } });

// One server's state and its answers. send(message): a notification or a request of the server's
// own, towards the client. ask(params): one question to the user (elicitation), its answer.
export function fakeServer(given = {}, { send = () => {}, ask = null, env = process.env } = {}) {
  const spec = { ...DEFAULT_SPEC, ...given };
  const state = { tools: spec.tools, calls: [], tickets: 142, era: null, changed: false, subs: new Set() };
  const eras = spec.era === 'both' ? [MODERN, LEGACY] : spec.era === 'modern' ? [MODERN] : [LEGACY];
  const modern = (params) => typeof params?._meta?.[KEY.version] === 'string' && params._meta[KEY.version] >= MODERN;
  // 2026-07-28: every result says its kind; a list or a read also says how long it may be kept (not at all).
  const done = (result, yes, kept = false) => (yes ? { resultType: 'complete', ...(kept ? { ttlMs: 0, cacheScope: 'private' } : {}), ...result } : result);
  const caps = { tools: { listChanged: true }, ...(spec.resources.length ? { resources: {} } : {}), ...(spec.prompts.length ? { prompts: {} } : {}) };
  const info = { name: spec.name, version: spec.version };
  const listed = (t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema ?? obj(), ...(t.title ? { title: t.title } : {}), ...(t.annotations ? { annotations: t.annotations } : {}), ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}) });

  function changeTools(tools) {
    state.tools = tools;
    state.changed = true;
    if (state.era === 'modern') for (const id of state.subs) send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: { _meta: { [KEY.sub]: id } } });
    else send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
  }

  async function call(name, args = {}, { signal, isModern, params }) {
    const t = state.tools.find((x) => x.name === name);
    if (!t) throw rpcError(-32602, `Unknown tool: ${name}`);
    if (spec.keyEnv && env[spec.keyEnv] !== spec.key) return { ...text(`No key: ${spec.keyEnv} is not set to the key this server wants.`), isError: true };
    state.calls.push({ name, args });
    if (spec.changeAfter && state.calls.length === spec.changeAfter && spec.tools2) setTimeout(() => changeTools(spec.tools2), 10);
    switch (t.does) {
      case 'echo': return text(args.text ?? '');
      case 'text': return text(t.text ?? '');
      case 'add': return text(Number(args.a) + Number(args.b));
      case 'ticket': return text(`Ticket #${args.number}: "Checkout total rounds 19.995 down to 19.99" · open · assigned to nobody`);
      case 'create': { state.tickets += 1; return text(`Ticket #${state.tickets} created: "${args.title}"${args.assignee ? `, assigned to ${args.assignee}` : ''}`); }
      case 'picture': return { content: [{ type: 'text', text: 'The shop logo:' }, { type: 'image', data: t.data ?? TINY_PNG, mimeType: t.mimeType ?? 'image/png' }] };
      case 'fail': return { ...text(t.text ?? 'The tracker said no: the ticket is locked.'), isError: true };
      case 'crash': setTimeout(() => process.exit(3), 5); return new Promise(() => {});
      case 'hang': return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(rpcError(-32800, 'cancelled'))));
      case 'slow': await new Promise((r) => setTimeout(r, Number(args.ms ?? t.ms ?? 300))); return text('done');
      case 'structured': return { content: [{ type: 'text', text: JSON.stringify({ item: args.item, left: 3 }) }], structuredContent: { item: args.item, left: 3 } };
      case 'link': return { content: [{ type: 'resource_link', uri: 'shop://notes/release', name: 'release notes', mimeType: 'text/markdown' }] };
      case 'env': return text(env[args.name] ?? '(not set)');
      case 'fetch': try { const r = await fetch(args.url, { signal: AbortSignal.timeout(4000) }); return text(`reached: ${r.status}`); } catch (e) { return { ...text(`not reached: ${e.cause?.code ?? e.message}`), isError: true }; }
      case 'ask': {
        const question = { mode: 'form', message: t.question ?? 'Which project should the ticket go to?', requestedSchema: obj({ project: { type: 'string', enum: ['shop-web', 'shop-api'] } }, ['project']) };
        // 2026-07-28: the question rides in the result; the call comes again with its answer.
        if (isModern) {
          const got = params?.inputResponses?.project;
          if (!got) return { resultType: 'input_required', inputRequests: { project: { method: 'elicitation/create', params: question } }, requestState: 'asked-project' };
          return got.action === 'accept' ? text(`Filed under ${got.content?.project}.`) : { ...text('Not filed: you declined.'), isError: true };
        }
        if (!ask) return { ...text('This server cannot ask here.'), isError: true };
        const got = await ask(question);
        return got?.action === 'accept' ? text(`Filed under ${got.content?.project}.`) : { ...text('Not filed: you declined.'), isError: true };
      }
      default: return text(`${name} ran.`);
    }
  }

  // One request's result (or a thrown rpc error); undefined for a notification.
  async function handle(msg, ctx = {}) {
    const { method, params } = msg;
    const isModern = modern(params);
    if (method === 'server/discover') {
      if (!eras.includes(MODERN)) throw rpcError(-32601, 'Method not found: server/discover');
      state.era = 'modern';
      return done({ supportedVersions: eras.filter((v) => v >= MODERN), capabilities: caps, ...(spec.instructions ? { instructions: spec.instructions } : {}), _meta: { [KEY.server]: info } }, true, true);
    }
    if (method === 'initialize') {
      if (!eras.includes(LEGACY)) throw rpcError(-32022, 'Unsupported protocol version', { supported: eras, requested: params?.protocolVersion });
      state.era = 'legacy';
      return { protocolVersion: LEGACY, capabilities: caps, serverInfo: info, ...(spec.instructions ? { instructions: spec.instructions } : {}) };
    }
    if (isModern && !eras.includes(MODERN)) throw rpcError(-32022, 'Unsupported protocol version', { supported: eras, requested: params._meta[KEY.version] });
    if (isModern) state.era = 'modern';
    switch (method) {
      case 'notifications/initialized': case 'notifications/cancelled': case 'notifications/roots/list_changed': return undefined;
      case 'ping': return done({}, isModern);
      case 'tools/list': return done({ tools: state.tools.map(listed) }, isModern, true);
      case 'tools/call': { const r = await call(params?.name, params?.arguments ?? {}, { ...ctx, isModern, params }); return r?.resultType ? r : done(r, isModern); }
      case 'resources/list': return done({ resources: spec.resources.map(({ text: _t, ...r }) => r) }, isModern, true);
      case 'resources/templates/list': return done({ resourceTemplates: [] }, isModern, true);
      case 'resources/read': {
        const r = spec.resources.find((x) => x.uri === params?.uri);
        if (!r) throw rpcError(-32002, `Resource not found: ${params?.uri}`);
        return done({ contents: [{ uri: r.uri, mimeType: r.mimeType ?? 'text/plain', text: r.text ?? '' }] }, isModern, true);
      }
      case 'prompts/list': return done({ prompts: spec.prompts.map(({ text: _t, ...p }) => p) }, isModern, true);
      case 'prompts/get': {
        const p = spec.prompts.find((x) => x.name === params?.name);
        if (!p) throw rpcError(-32602, `Unknown prompt: ${params?.name}`);
        const filled = String(p.text ?? '').replace(/\{(\w+)\}/g, (_, k) => params?.arguments?.[k] ?? `{${k}}`);
        return done({ description: p.description, messages: [{ role: 'user', content: { type: 'text', text: filled } }] }, isModern);
      }
      case 'subscriptions/listen': {
        // Held open: an acknowledgement now, the changes as they come, no result until it ends.
        state.subs.add(msg.id);
        send({ jsonrpc: '2.0', method: 'notifications/subscriptions/acknowledged', params: { ...(params?.notifications ? { notifications: params.notifications } : {}), _meta: { [KEY.sub]: msg.id } } });
        return new Promise(() => {});
      }
      default:
        if (msg.id === undefined) return undefined;
        throw rpcError(-32601, `Method not found: ${method}`);
    }
  }
  return { spec, state, handle, changeTools };
}

// ---- over a program's input and output -----------------------------------------------------------

export async function runStdio(spec = {}, { input = process.stdin, output = process.stdout } = {}) {
  const log = (dir, m) => { if (spec.log) try { appendFileSync(spec.log, `${JSON.stringify({ dir, pid: process.pid, ...m })}\n`); } catch {} };
  const write = (m) => { log('out', m); output.write(`${JSON.stringify(m)}\n`); };
  log('up', { start: spec.start ?? 'ok' });
  if (spec.start === 'crash') { process.stderr.write('fake-mcp: cannot start (told to crash)\n'); process.exit(7); }
  // deaf: it never answers and does not notice its input closing: only a signal ends it.
  if (spec.start === 'deaf') { setInterval(() => {}, 1000); return; }
  // It never answers; it still ends when it is told to (its input closed, or a signal).
  if (spec.start === 'hang') { input.resume(); input.on('end', () => process.exit(0)); setInterval(() => {}, 1000); return; }
  if (spec.start === 'garbage') output.write('Starting the fake server…\nnot json at all\n');
  const waiting = new Map(); // the server's own questions: id → resolve
  const running = new Map(); // the client's requests under way: id → AbortController
  const ask = (params) => new Promise((resolve) => { const id = `ask-${randomUUID().slice(0, 8)}`; waiting.set(id, resolve); write({ jsonrpc: '2.0', id, method: 'elicitation/create', params }); });
  const server = fakeServer(spec, { send: write, ask });
  process.stderr.write(`fake-mcp ${server.spec.name} up (${server.spec.era})\n`);
  let buf = '';
  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      log('in', msg);
      if (msg.method === undefined && waiting.has(msg.id)) { waiting.get(msg.id)(msg.result ?? { action: 'cancel' }); waiting.delete(msg.id); continue; }
      if (msg.method === 'notifications/cancelled') { running.get(msg.params?.requestId)?.abort(); continue; }
      const ac = new AbortController();
      if (msg.id !== undefined) running.set(msg.id, ac);
      server.handle(msg, { signal: ac.signal }).then((result) => { if (msg.id !== undefined && result !== undefined) write({ jsonrpc: '2.0', id: msg.id, result }); },
        (e) => { if (msg.id !== undefined) write({ jsonrpc: '2.0', id: msg.id, error: e.rpc ?? { code: -32603, message: e.message } }); })
        .finally(() => running.delete(msg.id));
    }
  });
  input.on('end', () => process.exit(0));
}

// How a test starts it as a program: { command, args, env }.
export function fakeMcpCommand(spec = {}) {
  return { command: process.execPath, args: [fileURLToPath(import.meta.url)], env: { FAKE_MCP: JSON.stringify(spec) } };
}

// ---- at an address (Streamable HTTP) --------------------------------------------------------------

export async function startFakeMcp(spec = {}, { port = 0 } = {}) {
  const seen = []; // every request: { method, headers, body }
  const streams = new Set(); // open event streams, for the server's own messages
  const waiting = new Map();
  let asker = null; // the stream a question goes out on (the call that asked)
  const send = (m) => { for (const res of streams) res.write(`event: message\ndata: ${JSON.stringify(m)}\n\n`); };
  const ask = (params) => new Promise((resolve) => {
    const id = `ask-${randomUUID().slice(0, 8)}`;
    waiting.set(id, resolve);
    const m = { jsonrpc: '2.0', id, method: 'elicitation/create', params };
    if (asker) asker.write(`event: message\ndata: ${JSON.stringify(m)}\n\n`); else send(m);
  });
  const server = fakeServer(spec, { send, ask });
  const session = randomUUID();
  const http = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* not JSON */ }
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (spec.log) try { appendFileSync(spec.log, `${JSON.stringify({ dir: 'in', http: req.method, headers: req.headers, body })}\n`); } catch {}
    const json = (status, value, headers = {}) => { const out = JSON.stringify(value); res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(out); };
    if (spec.token && req.headers.authorization !== `Bearer ${spec.token}`) { res.writeHead(401, { 'www-authenticate': 'Bearer' }); res.end('a key is needed'); return; }
    if (req.method === 'GET') {
      if (server.state.era !== 'legacy') { res.writeHead(405); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write(': open\n\n');
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }
    if (req.method === 'DELETE') { res.writeHead(200); res.end(); return; }
    if (req.method !== 'POST' || !body) { res.writeHead(400); res.end('a JSON-RPC message is expected'); return; }
    // The client's answer to a question of the server's.
    if (body.method === undefined && waiting.has(body.id)) { waiting.get(body.id)(body.result ?? { action: 'cancel' }); waiting.delete(body.id); res.writeHead(202); res.end(); return; }
    if (body.id === undefined) { await server.handle(body).catch(() => {}); res.writeHead(202); res.end(); return; }
    const ac = new AbortController();
    req.on('close', () => { if (!res.writableEnded) ac.abort(); });
    const asks = body.method === 'tools/call' && server.state.tools.find((t) => t.name === body.params?.name)?.does === 'ask' && !(typeof body.params?._meta?.[KEY.version] === 'string');
    const listens = body.method === 'subscriptions/listen';
    if (asks || listens) {
      // An event stream: the server's question (or its changes) first, the result when there is one.
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      if (asks) asker = res; else streams.add(res);
      req.on('close', () => { streams.delete(res); if (asker === res) asker = null; });
    }
    try {
      const result = await server.handle(body, { signal: ac.signal });
      const msg = { jsonrpc: '2.0', id: body.id, result };
      if (asks || listens) { res.write(`event: message\ndata: ${JSON.stringify(msg)}\n\n`); res.end(); if (asker === res) asker = null; }
      else json(200, msg, body.method === 'initialize' ? { 'mcp-session-id': session } : {});
    } catch (e) {
      const msg = { jsonrpc: '2.0', id: body.id, error: e.rpc ?? { code: -32603, message: e.message } };
      if (asks || listens) { res.write(`event: message\ndata: ${JSON.stringify(msg)}\n\n`); res.end(); }
      // 2026-07-28: an unsupported version is a 400 with the error as its body.
      else json(e.rpc?.code === -32022 ? 400 : 200, msg);
    }
  });
  await new Promise((resolve) => http.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${http.address().port}/mcp`,
    port: http.address().port,
    seen,
    server,
    calls: () => server.state.calls,
    setTools: (tools) => server.changeTools(tools),
    close: () => new Promise((resolve) => { for (const s of streams) s.end(); http.closeAllConnections?.(); http.close(() => resolve()); }),
  };
}

// Run as a program: the spec from FAKE_MCP (JSON) or FAKE_MCP_SPEC (a file).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let spec = {};
  try { spec = process.env.FAKE_MCP ? JSON.parse(process.env.FAKE_MCP) : process.env.FAKE_MCP_SPEC ? JSON.parse((await import('node:fs')).readFileSync(process.env.FAKE_MCP_SPEC, 'utf8')) : {}; } catch (e) { process.stderr.write(`fake-mcp: the spec is not JSON (${e.message})\n`); process.exit(2); }
  const port = process.argv.indexOf('--http');
  if (port >= 0) { const s = await startFakeMcp(spec, { port: Number(process.argv[port + 1]) || 0 }); process.stdout.write(`${s.url}\n`); }
  else runStdio(spec);
}
