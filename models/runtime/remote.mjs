// A model on another machine (/remote): its address, its API key, the SSH
// tunnel when it is reached that way, and a check that it answers. The
// terminal keeps the remote in use in settings.json ("remote"), one saved
// set-up per service ("remotes": claude, machine, openai), and each one's key
// in the macOS Keychain under its own name (keyIdOf); every call to a model
// server asks endpointOf(url) for the key and the kind of server, so the rest
// of the app keeps passing a plain url.
//   kind 'llama':  llama.cpp's llama-server (`coding serve` on the other
//                  machine, or one you started): everything works as it does
//                  on this Mac, the thinking switch and the side slot included.
//   kind 'openai': any OpenAI-compatible server (vLLM, Ollama, LM Studio,
//                  OpenRouter, OpenAI…): only the standard fields are sent.
//   kind 'claude': the Claude API, through Anthropic's Messages API and its
//                  official SDK (claude.mjs); the address defaults to Anthropic's.
//   connect 'http' | 'https' | 'ssh': 'ssh' opens `ssh -L` to the machine and
//                  talks to the model through it (no port open to the network).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { createConnection } from 'node:net';
import { basename, join } from 'node:path';
import { HOME, MODELS } from '../registry.mjs';
import { CLAUDE_HOST, CLAUDE_CTX, CLAUDE_MODELS, claudeProbe } from './claude.mjs';
import { ollamaModel, ollamaCtx, floorCtx, isOutOfMemory } from './ollama.mjs';

export const REMOTE_KINDS = ['llama', 'openai', 'claude'];
// The address used: what was typed, or Anthropic's for a Claude API remote left blank.
const addressOf = (r) => String(r?.address ?? '').trim() || (r?.kind === 'claude' ? CLAUDE_HOST : '');
export const CONNECTS = ['http', 'https', 'ssh'];
// What a remote is, as /remote's Run on row names it: the Claude API, another
// computer running llama.cpp (coding serve), or another OpenAI-compatible service.
export const REMOTE_SOURCES = ['claude', 'machine', 'openai'];
// A remote saved before the Run on row has no source: its kind says which.
export const sourceOf = (r) => (REMOTE_SOURCES.includes(r?.source) ? r.source : r?.kind === 'claude' ? 'claude' : r?.kind === 'openai' ? 'openai' : 'machine');
// The name its key is kept under: its service's (a key saved before is under 'default').
export const keyIdOf = (r) => r?.keyId || 'default';
// llama-server's own default port (and `coding serve`'s).
export const SERVE_PORT = 8080;
export const DEFAULT_REMOTE = { use: false, address: '', port: null, connect: 'http', kind: 'llama', model: '', context: 0, key: false, keyEnd: '' };

// ---- the address -------------------------------------------------------------------------------

// What was typed in the Address row: an IP or a name, with or without a
// scheme, a port and a path ("192.168.1.40", "gpu:8080", or a hosted API's
// address with https:// and /api/v1 after its name). The path loses a last
// "/v1": the calls add it.
export function parseAddress(text) {
  let t = String(text ?? '').trim();
  if (!t) return null;
  // A bare IPv6 address ("fd12::5"): its port goes in the Port row.
  if (/^[0-9a-f]*:[0-9a-f:]*:[0-9a-f.]*$/i.test(t)) t = `[${t}]`;
  const m = /^([a-z][a-z0-9+.-]*):\/\//i.exec(t);
  const scheme = m ? m[1].toLowerCase() : null;
  if (scheme && scheme !== 'http' && scheme !== 'https') return null;
  let u;
  try { u = new URL(scheme ? t : `http://${t}`); } catch { return null; }
  if (!u.hostname || u.username || u.password || u.search || u.hash) return null;
  const path = u.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
  return { scheme, host: u.hostname.replace(/^\[|\]$/g, ''), port: u.port ? Number(u.port) : null, path };
}

// A host on this Mac, the home network, a VPN like Tailscale, or a .local
// name: plain http to it never crosses the internet.
export function isPrivateHost(host) {
  const h = String(host ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return false;
  if (h === 'localhost' || /\.(local|lan|home\.arpa|internal|ts\.net)$/.test(h) || !h.includes('.') && !h.includes(':')) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
  }
  return h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h);
}

// The owner's own other computer: coding serve (llama.cpp) reached at a private address or over SSH.
// Facts about the user go in full only there (terminal opening.mjs); an Ollama service on the home
// network, any OpenAI-compatible service and the Claude API are someone else's machine (3 Oct 2026).
export const ownMachine = (r) => r?.kind === 'llama' && (r.connect === 'ssh' || isPrivateHost(parseAddress(addressOf(r))?.host ?? ''));

// An SSH destination as ssh takes it: a name from ~/.ssh/config, host or
// user@host (a port goes in the config). Never an option ("-o…").
export const validSshDest = (dest) => /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9._:[\]-]+$/.test(String(dest ?? '')) && !String(dest).startsWith('-');

// Where the calls go for a remote reached directly (http/https); null when the address is not usable.
export function directUrl(r) {
  const a = parseAddress(addressOf(r));
  if (!a) return null;
  // The Claude API is https only (an http:// typed in full, a local stand-in say, is taken as typed).
  const scheme = a.scheme ?? (r.connect === 'https' || r.kind === 'claude' ? 'https' : 'http');
  const port = a.port ?? r.port ?? (r.kind === 'llama' && !a.scheme ? SERVE_PORT : null);
  const host = a.host.includes(':') ? `[${a.host}]` : a.host;
  return `${scheme}://${host}${port ? `:${port}` : ''}${a.path}`;
}

// The remote in one short name for the screen: the host (and port when it is not the usual).
export function remoteLabel(r) {
  const address = addressOf(r);
  if (!address) return 'no address';
  if (r.connect === 'ssh' && r.kind !== 'claude') return `${address} (ssh)`;
  const a = parseAddress(address);
  if (!a) return address;
  const port = a.port ?? r.port;
  return `${a.host}${port && port !== SERVE_PORT ? `:${port}` : ''}`;
}

// What is wrong with a remote before anything is sent: one plain sentence, or null.
export function remoteProblem(r) {
  if (!addressOf(r)) return 'it has no address yet';
  if (r.kind === 'claude' && r.connect === 'ssh') return 'the Claude API is reached over https, not an SSH tunnel (Connect: https)';
  if (r.connect === 'ssh') {
    if (!validSshDest(r.address.trim())) return 'the SSH address should be a name from ~/.ssh/config, host or user@host';
    return null;
  }
  const a = parseAddress(addressOf(r));
  if (!a) return 'the address is not an IP, a name or an http(s) address';
  if (r.port != null && !(Number.isInteger(r.port) && r.port > 0 && r.port < 65536)) return 'the port should be a number from 1 to 65535';
  return null;
}

// Kept so the form, Connect and Doctor still call one place. Open http to an
// address on the internet is allowed (a keyed server of yours); the form does
// not warn.
export function remoteRisk(_r) {
  return null;
}

// ---- the endpoints: key and kind by address -----------------------------------------------------

const ENDPOINTS = new Map();
const norm = (url) => String(url ?? '').replace(/\/+$/, '');
// ep: { remote (on another machine), kind: 'llama' | 'openai', key, model (the name the server wants), label }
export function setEndpoint(url, ep) { ENDPOINTS.set(norm(url), { ...ep }); }
export function dropEndpoint(url) { ENDPOINTS.delete(norm(url)); }
export const endpointOf = (url) => (url ? ENDPOINTS.get(norm(url)) ?? null : null);
export function authHeaders(url) {
  const key = endpointOf(url)?.key;
  return key ? { authorization: `Bearer ${key}` } : {};
}
// A call to a model server with its key, when it has one.
export function modelFetch(url, path, init = {}) {
  return fetch(`${norm(url)}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...authHeaders(url) } });
}

// ---- the key ------------------------------------------------------------------------------------

// Kept in the macOS Keychain (never in settings.json, the logs, or a saved
// conversation). AGENTIC_REMOTE_KEY wins over it (a script, a test);
// AGENTIC_REMOTE_KEYSTORE=file keeps it in ~/.agentic-coder/remote-keys.json
// (readable by you only), which is also the fallback off macOS.
const SERVICE = 'agentic-coder-remote';
const SECURITY = '/usr/bin/security';
const keyFile = () => join(HOME, 'remote-keys.json');
export const keyStore = () => (process.platform === 'darwin' && process.env.AGENTIC_REMOTE_KEYSTORE !== 'file' && existsSync(SECURITY) ? 'keychain' : 'file');
// A key the server can take in a header: printable, no spaces or line breaks.
export const validKey = (key) => typeof key === 'string' && /^[\x21-\x7e]{1,4096}$/.test(key);

// AGENTIC_REMOTE_KEY stands in for any remote's key (not a web search service's, nor an MCP server's).
const envKey = (id) => (process.env.AGENTIC_REMOTE_KEY && !/^(search|mcp)-/.test(String(id)) ? process.env.AGENTIC_REMOTE_KEY : null);
export function readKey(id = 'default') {
  if (envKey(id)) return envKey(id);
  if (keyStore() === 'keychain') {
    const r = spawnSync(SECURITY, ['find-generic-password', '-a', id, '-s', SERVICE, '-w'], { encoding: 'utf8', timeout: 10_000 });
    return r.status === 0 ? r.stdout.replace(/\n$/, '') || null : null;
  }
  try { return JSON.parse(readFileSync(keyFile(), 'utf8'))[id] ?? null; } catch { return null; }
}

// label: what Keychain Access shows for it (the web search keys have their own).
export function saveKey(key, id = 'default', label = 'Agentic Coder remote model') {
  if (!validKey(key)) throw new Error('an API key is one line of letters, digits and symbols, with no spaces');
  if (keyStore() === 'keychain') {
    // Through security's own command line (-i), so the key is never in a
    // process's arguments, which any program on the Mac can list.
    const q = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    spawnSync(SECURITY, ['-i'], { input: `add-generic-password -U -a ${q(id)} -s ${q(SERVICE)} -l ${q(label)} -w ${q(key)}\n`, encoding: 'utf8', timeout: 10_000 });
    if (readKey(id) !== key && !envKey(id)) throw new Error('the Keychain did not keep the key');
    return 'keychain';
  }
  let all = {};
  try { all = JSON.parse(readFileSync(keyFile(), 'utf8')); } catch {}
  all[id] = key;
  mkdirSync(HOME, { recursive: true });
  writeFileSync(keyFile(), `${JSON.stringify(all)}\n`, { mode: 0o600 });
  chmodSync(keyFile(), 0o600);
  return 'file';
}

export function removeKey(id = 'default') {
  if (keyStore() === 'keychain') { spawnSync(SECURITY, ['delete-generic-password', '-a', id, '-s', SERVICE], { stdio: 'ignore', timeout: 10_000 }); return; }
  try {
    const all = JSON.parse(readFileSync(keyFile(), 'utf8'));
    delete all[id];
    writeFileSync(keyFile(), `${JSON.stringify(all)}\n`, { mode: 0o600 });
  } catch {}
}

// A secret longer than a key, kept the same way (an MCP server's sign-in: its client and its tokens,
// as JSON). Stored as base64url, one line, so it goes through security's command line like a key.
const SECRET_MAX = 32 * 1024;
export function saveSecret(text, id, label = 'Agentic Coder') {
  const b64 = Buffer.from(String(text), 'utf8').toString('base64url');
  if (b64.length > SECRET_MAX) throw new Error('that is too long to keep');
  if (keyStore() === 'keychain') {
    const q = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    spawnSync(SECURITY, ['-i'], { input: `add-generic-password -U -a ${q(id)} -s ${q(SERVICE)} -l ${q(label)} -w ${q(b64)}\n`, encoding: 'utf8', timeout: 10_000 });
    if (readSecret(id) !== String(text)) throw new Error('the Keychain did not keep it');
    return 'keychain';
  }
  let all = {};
  try { all = JSON.parse(readFileSync(keyFile(), 'utf8')); } catch {}
  all[id] = b64;
  mkdirSync(HOME, { recursive: true });
  writeFileSync(keyFile(), `${JSON.stringify(all)}\n`, { mode: 0o600 });
  chmodSync(keyFile(), 0o600);
  return 'file';
}
export function readSecret(id) {
  let b64 = null;
  if (keyStore() === 'keychain') { const r = spawnSync(SECURITY, ['find-generic-password', '-a', id, '-s', SERVICE, '-w'], { encoding: 'utf8', timeout: 10_000 }); b64 = r.status === 0 ? r.stdout.replace(/\n$/, '') : null; }
  else { try { b64 = JSON.parse(readFileSync(keyFile(), 'utf8'))[id] ?? null; } catch { b64 = null; } }
  if (!b64) return null;
  try { return Buffer.from(b64, 'base64url').toString('utf8'); } catch { return null; }
}

// The end of a key, for the form (••••3f9a): enough to tell two keys apart.
export const keyEnd = (key) => (key && key.length >= 12 ? key.slice(-4) : '');

// ---- the SSH tunnel -----------------------------------------------------------------------------

const TUNNEL_PORTS = [17650, 17699];
// No password prompt (the window cannot show one): a key or the ssh agent,
// as `ssh <dest>` in Terminal would use. The tunnel ends when this app does.
export function sshArgs({ dest, remotePort, localPort }) {
  return ['-N', '-T', '-o', 'ExitOnForwardFailure=yes', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
    '-L', `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`, '--', dest];
}

const portOpen = (port) => new Promise((resolve) => {
  const sock = createConnection({ port, host: '127.0.0.1' });
  sock.once('connect', () => { sock.destroy(); resolve(true); });
  sock.once('error', () => resolve(false));
});

// Opens `ssh -L` to the remote; answers { url, port, stop() } once the
// local end takes connections, or throws with what ssh said.
export async function openTunnel({ dest, remotePort = SERVE_PORT, ssh = 'ssh', timeoutMs = 20_000 }) {
  if (!validSshDest(dest)) throw new Error('the SSH address should be a name from ~/.ssh/config, host or user@host');
  let localPort = TUNNEL_PORTS[0];
  while (await portOpen(localPort)) { localPort++; if (localPort > TUNNEL_PORTS[1]) throw new Error(`no free port for the tunnel between ${TUNNEL_PORTS.join(' and ')}`); }
  const child = spawn(ssh, sshArgs({ dest, remotePort, localPort }), { stdio: ['ignore', 'ignore', 'pipe'] });
  let said = '';
  child.stderr.on('data', (d) => { said = `${said}${d}`.slice(-600); });
  let exited = null;
  child.once('exit', (code) => { exited = code ?? 1; });
  child.once('error', (e) => { exited = 1; said = e.message; });
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (exited !== null) throw new Error(`ssh to ${dest} stopped: ${said.trim().split('\n').filter(Boolean).at(-1) ?? `code ${exited}`}`);
    if (await portOpen(localPort)) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  if (exited === null && !(await portOpen(localPort))) { child.kill(); throw new Error(`ssh to ${dest} did not connect in ${Math.round(timeoutMs / 1000)} s`); }
  // The tunnel ends with this app; a stopped one takes its exit hook with it (a reconnect makes a new one).
  const onExit = () => { try { child.kill('SIGTERM'); } catch {} };
  process.once('exit', onExit);
  const stop = () => { process.off('exit', onExit); onExit(); };
  return { url: `http://127.0.0.1:${localPort}`, port: localPort, child, stop, alive: () => exited === null };
}

// ---- the check ----------------------------------------------------------------------------------

async function getJson(url, path, { key, signal, timeoutMs }) {
  const t = AbortSignal.timeout(timeoutMs);
  const res = await fetch(`${norm(url)}${path}`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: signal ? AbortSignal.any([signal, t]) : t });
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, body };
}

// Why an Ollama service gave no word in time, from what it has loaded now (/api/ps).
const GB = (b) => (b ? `${(b / 1e9).toFixed(0)} GB` : '');
async function notLoaded({ url, key, model, bytes, limit, out }) {
  const mins = `${Math.round(limit / 60_000) || 1} min`;
  // Its size on the service's disk (the list says; the model's own entry only does once loaded).
  if (!bytes) { try { bytes = ((await getJson(url, '/api/tags', { key, timeoutMs: 4000 })).body?.models ?? []).find((m) => m.name === model)?.size ?? 0; } catch {} }
  const size = bytes ? ` (${GB(bytes)})` : '';
  let held = [];
  try { held = ((await getJson(url, '/api/ps', { key, timeoutMs: 4000 })).body?.models ?? []).filter((m) => m.name && m.name !== model); } catch {}
  out.loaded = held.map((m) => m.name);
  if (!held.length) return `no answer in ${mins}: the service did not get ${model}${size} loaded. Try again in a minute, or pick a smaller model`;
  const big = held.sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0];
  // Kept for ever: its "until" is years away (Ollama's keep_alive -1).
  const forever = Date.parse(big.expires_at ?? '') - Date.now() > 365 * 86_400_000;
  return `no answer in ${mins}: the service did not load ${model}${size}. It keeps ${big.name} loaded${big.size ? ` (${GB(big.size)}${forever ? ', set to stay for ever' : ''})` : ''}, which may leave no room: pick ${big.name}, which is ready, or free the service first`;
}

const why = (e) => {
  const m = `${e?.cause?.code ?? ''} ${e?.cause?.message ?? ''} ${e?.message ?? ''}`;
  if (/Timeout|timed out|aborted/i.test(m)) return 'no answer in time';
  if (/ECONNREFUSED|Connection refused|Unable to connect/i.test(m)) return 'nothing is listening at that address and port';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|resolve/i.test(m)) return 'that name was not found';
  if (/certificate|CERT_|self.signed|TLS|SSL/i.test(m)) return 'its https certificate was not accepted';
  if (/EHOSTUNREACH|ENETUNREACH|No route/i.test(m)) return 'that address cannot be reached from this Mac';
  if (/socket connection was closed|ECONNRESET|socket hang up|other side closed/i.test(m)) return 'it closed the connection (the server may have stopped)';
  return (e?.message ?? String(e)).slice(0, 160);
};
const timedOut = (e) => why(e) === 'no answer in time';

// The context a server gives each conversation, from what it reports: llama-server's
// /props, else a model list's own field (OpenRouter, vLLM, LM Studio, llama.cpp's meta).
const ctxOf = (m) => m?.context_length ?? m?.max_model_len ?? m?.max_context_length ?? m?.meta?.n_ctx ?? m?.meta?.n_ctx_train ?? null;

// The model an OpenAI-compatible server should be asked for when none was
// named: skip embeddings and vision if it has a text model, prefer a coder
// name and a :latest tag. One name, or null when the list is empty.
export function pickRemoteModel(ids) {
  const list = (ids ?? []).filter(Boolean);
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const skip = /embed|embedding|rerank|\bbge[-_]|e5-|minilm|nomic-embed|mxbai|gte-|arctic-embed/i;
  const vision = /llava|bakllava|moondream|minicpm-v|\bclip\b|:vision\b/i;
  const good = /coder|codeqwen|qwen|llama|gemma|mistral|phi|deepseek|starcoder|codestral|command-r|glm|kimi|hermes|dolphin|mixtral|granite|smollm|olmo|wizard|magicoder|openchat|nous|orca|falcon|vicuna|yi-|internlm|solar/i;
  const usable = list.filter((id) => !skip.test(id));
  const text = usable.filter((id) => !vision.test(id));
  const pool = text.length ? text : usable.length ? usable : list;
  let best = pool[0], bestS = -1;
  for (const id of pool) {
    let s = 0;
    if (good.test(id)) s += 10;
    // A coder beats a general model of the same family (llama4 was suggested over qwen3-coder-next, 2 Oct 2026).
    if (/coder|codestral|starcoder|codeqwen/i.test(id)) s += 5;
    if (/:latest$/.test(id) || !id.includes(':')) s += 2;
    if (/instruct|chat|-it\b/i.test(id)) s += 1;
    if (s > bestS) { bestS = s; best = id; }
  }
  return best;
}

// Whether the remote answers, with its key, and what it runs. Answers
// { ok, steps: [{ ok, text }], ctx, slots, models, model, file, ms, error, needModel }.
// reply: also ask for a two-word answer (the form's Connect), which proves the
// whole way works (a hosted model may charge a fraction of a cent for it).
// autoPick: when several models are listed and none named, pick a text/coder
// one (the CLI, connectRemote). The form passes false so you can pick from the list.
// numCtx: on an Ollama service, the context the model is to run at (the word is asked
// for at it, so the model is not loaded at the service's own just for the check).
// onStep({ steps, waiting }): told before the one word is asked for, the only long wait (a service
// may first load the model): what was found so far, and what is waited for.
// replyMs: how long the one word may take (a test gives less).
export async function probe({ url, kind = 'llama', key = null, model = '', numCtx = null, reply = false, autoPick = true, signal, timeoutMs = 8000, onStep = null, replyMs = null }) {
  const steps = [];
  const out = { ok: false, steps, ctx: null, slots: 1, models: [], model: model || null, file: null, ms: null, error: null, needModel: false, vision: kind !== 'llama' };
  const fail = (text) => { steps.push({ ok: false, text }); out.error = text; return out; };
  if (kind === 'claude') return claudeProbe({ url, key, model, reply, signal, timeoutMs, why });
  const t0 = Date.now();
  try {
    if (kind === 'llama') {
      const h = await getJson(url, '/health', { signal, timeoutMs });
      if (h.status === 503) return fail('the server is up but its model is still loading; try again in a minute');
      if (!h.ok && h.status !== 401) return fail(`the address answered ${h.status}: is it a llama.cpp server? (Ollama, LM Studio, vLLM…: More → Server: OpenAI-compatible)`);
      out.ms = Date.now() - t0;
      steps.push({ ok: true, text: `reached in ${out.ms} ms` });
      const p = await getJson(url, '/props', { key, signal, timeoutMs });
      if (p.status === 401 || p.status === 403) return fail(key ? 'the API key was not accepted' : 'this server needs an API key');
      if (!p.ok || !p.body) return fail(`it did not say what it runs (/props answered ${p.status})`);
      steps.push({ ok: true, text: key ? 'the key was accepted' : 'no key needed' });
      out.file = p.body.model_path ?? null;
      out.ctx = p.body.default_generation_settings?.n_ctx ?? null;
      out.slots = p.body.total_slots ?? 1;
      out.vision = Boolean(p.body.modalities?.vision);
      out.model = model || (out.file ? basename(out.file) : null);
      steps.push({ ok: true, text: `runs ${out.file ? basename(out.file) : 'a model'}${out.ctx ? ` · ${Math.round(out.ctx / 1024)}k context` : ''}${out.slots > 1 ? ` · ${out.slots} slots` : ''}` });
    } else {
      const r = await getJson(url, '/v1/models', { key, signal, timeoutMs });
      out.ms = Date.now() - t0;
      if (r.status === 401 || r.status === 403) return fail(key ? `reached in ${out.ms} ms, but the API key was not accepted` : `reached in ${out.ms} ms, but it needs an API key`);
      if (!r.ok || !Array.isArray(r.body?.data)) return fail(`the address answered ${r.status} to /v1/models: is it an OpenAI-compatible server? (with a path like /api/v1 when it has one)`);
      steps.push({ ok: true, text: `reached in ${out.ms} ms${key ? ' · the key was accepted' : ''}` });
      out.models = r.body.data.map((m) => m.id).filter(Boolean);
      const named = String(model ?? '').trim();
      if (named && !out.models.includes(named) && out.models.length) steps.push({ ok: true, text: `"${named}" is not in its list of ${out.models.length}; it is asked for anyway` });
      out.model = named || ((autoPick || out.models.length === 1) ? pickRemoteModel(out.models) : null);
      if (!out.model) {
        out.needModel = out.models.length > 0;
        return fail(out.models.length
          ? `pick a model: it has ${out.models.length} (${out.models.slice(0, 3).join(', ')}${out.models.length > 3 ? '…' : ''})`
          : 'it listed no models');
      }
      if (!named && out.models.length > 1) steps.push({ ok: true, text: `using ${out.model} of ${out.models.length}` });
      const picked = r.body.data.find((m) => m.id === out.model);
      out.ctx = ctxOf(picked);
      // What it costs, when the list says (OpenRouter: dollars a token, as text): the cost meter's price.
      const pin = Number(picked?.pricing?.prompt), pout = Number(picked?.pricing?.completion);
      if (Number.isFinite(pin) && Number.isFinite(pout)) out.price = { in: pin * 1e6, out: pout * 1e6 };
      // An Ollama service says more than its model list: what the model can do
      // (pictures, thinking, tools) and the context it runs at (ollama.mjs).
      const o = await ollamaModel({ url, key, model: out.model, signal, timeoutMs: Math.min(timeoutMs, 5000) }).catch(() => null);
      if (o) {
        out.ollama = o;
        if (o.known) out.vision = o.vision;
        out.ctx ??= numCtx || ollamaCtx(o);
      }
      steps.push({ ok: true, text: `model ${out.model}${out.ctx ? ` · ${Math.round(out.ctx / 1024)}k context` : ''}` });
    }
    if (reply) {
      const t1 = Date.now();
      // An OpenAI-compatible service may first load the model (Ollama: tens of GB from its disk).
      const limit = replyMs ?? Math.max(timeoutMs, kind === 'openai' ? 180_000 : 60_000);
      const t = AbortSignal.timeout(limit);
      onStep?.({ steps: steps.slice(), waiting: out.ollama ? `asking ${out.model} for one word (the service may first load it: up to ${Math.round(limit / 60_000) || 1} min)` : 'asking it for one word' });
      const headers = { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) };
      const words = [{ role: 'user', content: 'Reply with the single word: ready' }];
      let res, j, said;
      if (out.ollama) {
        // Ollama's own chat, the one that takes a context (the agent's requests go the same way):
        // no thinking first (gpt-oss cannot turn it off, so its least), a few words back.
        const gptoss = /gpt-?oss/i.test(`${out.ollama.family} ${out.model}`);
        try {
          res = await fetch(`${norm(url)}/api/chat`, {
            method: 'POST', signal: signal ? AbortSignal.any([signal, t]) : t, headers,
            body: JSON.stringify({ model: out.model, messages: words, stream: false, ...(gptoss ? { think: 'low' } : out.ollama.thinking ? { think: false } : {}), options: { num_predict: gptoss ? 512 : 8, ...(numCtx ? { num_ctx: numCtx } : {}) } }),
          });
        } catch (e) {
          if (signal?.aborted || !timedOut(e)) throw e;
          // No word in time: the service did not get the model loaded. What it holds instead says
          // why, and what would answer at once (3 Oct 2026: a 52 GB model asked of a service that
          // kept a 23 GB one loaded for ever; the form only said "no answer in time").
          return fail(await notLoaded({ url, key, model: out.model, bytes: out.ollama.bytes, limit, out }));
        }
        j = await res.json().catch(() => null);
        const why = typeof j?.error === 'string' ? j.error : j?.error?.message ?? '';
        if (!res.ok) return fail(isOutOfMemory(why) ? `the service has no room to load ${out.model} (out of GPU memory): pick a smaller model or a smaller context` : `it would not answer: ${res.status} ${why.slice(0, 140)}`.trim());
        said = j?.message?.content;
      } else {
        const ask = (limit) => fetch(`${norm(url)}/v1/chat/completions`, {
          method: 'POST', signal: signal ? AbortSignal.any([signal, t]) : t, headers,
          body: JSON.stringify({ model: out.model ?? 'coding', messages: words, ...limit, stream: false, ...(kind === 'llama' ? { chat_template_kwargs: { enable_thinking: false } } : {}) }),
        });
        res = await ask({ max_tokens: 8 });
        j = await res.json().catch(() => null);
        // A server that wants max_completion_tokens (OpenAI's reasoning models) is asked that way, with room to think.
        if (res.status === 400 && /max_completion_tokens/.test(j?.error?.message ?? '')) { res = await ask({ max_completion_tokens: 512 }); j = await res.json().catch(() => null); }
        if (!res.ok) return fail(`it would not answer: ${res.status} ${(j?.error?.message ?? '').slice(0, 140)}`.trim());
        said = j?.choices?.[0]?.message?.content;
      }
      said = String(said ?? '').trim().replace(/\s+/g, ' ').slice(0, 24);
      steps.push({ ok: true, text: `answered "${said || '…'}" in ${((Date.now() - t1) / 1000).toFixed(1)} s` });
    }
    out.ok = true;
    return out;
  } catch (e) {
    if (signal?.aborted) throw e;
    return fail(why(e));
  }
}

// ---- the model's settings -----------------------------------------------------------------------

// A model this repo has no folder for: the server's own sampling, Low or High effort.
// A model on /remote thinks unless you say otherwise (the owner's pick, 3 Oct 2026: "always leave on
// thinking as the default, and turn it off when a model has no thinking"): thinkingDefault is on, and
// off for a model the service says cannot think (remoteModel). Your own pick for a model is kept for it.
export const GENERIC_REMOTE = {
  id: 'remote', name: 'Remote model', by: '', file: null, bytes: 0,
  sampling: {}, thinkingSampling: {},
  thinkingDefault: true, thinkingEffort: 'high',
  thinkingLevels: [
    { id: 'low', label: 'Low', effort: null, note: 'answers straight away' },
    { id: 'high', label: 'High', effort: 'high', note: 'asks the model to think first (one that cannot answers without it)' },
  ],
  thinkingBudget: 4096,
  maxCtx: 131_072,
};

// The effort levels of a model on an Ollama service, from what it can do (o:
// ollama.mjs's entry), named as the model has them (2 Oct 2026, the user's
// pick): None when it cannot think (asked to, Ollama refuses the request);
// Low, Medium and High for gpt-oss, whose think takes three steps and is never
// off (Low is its least); Off and Max for Laguna (Poolside shipped no steps in
// between); Off and On for the rest (Ollama's think is true or false). The ids
// stay low / medium / high, so a level chosen on one model carries to the next.
// A model whose abilities are not listed keeps GENERIC_REMOTE's.
export function remoteLevels(o) {
  const [low, high] = GENERIC_REMOTE.thinkingLevels;
  if (!o?.known) return GENERIC_REMOTE.thinkingLevels;
  if (!o.thinking) return [{ ...low, label: 'None', note: 'answers straight away: this model cannot think first' }];
  if (/gpt-?oss/i.test(`${o.family} ${o.id}`)) return [{ ...low, note: 'thinks briefly first: gpt-oss always thinks, this is its least' }, { id: 'medium', label: 'Medium', effort: 'medium', note: 'thinks for a while first · gpt-oss has three levels' }, { ...high, note: 'thinks longest first · slow, and it can loop' }];
  if (/laguna/i.test(`${o.family} ${o.id}`)) return [{ ...low, label: 'Off' }, { ...high, label: 'Max', note: 'thinks between its tool calls for as long as it needs: Laguna has only off and max' }];
  return [{ ...low, label: 'Off' }, { ...high, label: 'On', note: 'thinks first: this model has no steps, only on or off' }];
}

// Whether a model can think at all: a level that thinks, or no levels said (it is asked, and one that
// cannot answers without it).
export const canThink = (m) => (m?.thinkingLevels?.length ? m.thinkingLevels.some((l) => l.effort) : true);

// Big-model mode (1 Oct 2026, the user's pick): a model on an Ollama service
// with 30B parameters or more (by its total, so Qwen3.6 35B-A3B counts) that
// can call tools reads files 400 lines at a time and has more steps, tries and
// command output. These are /effort's defaults for it; what you saved there
// still wins. Models on this Mac and smaller remote ones keep today's.
// Who decides: Model, as in Claude Code (3 Oct 2026, the owner's ask: "i want it to run just like you").
// On 1 Oct the model deciding did worse (qwen3-coder-next, 22 of the Practice 28 against 26, 73% more
// time), so it had been taken back out; with the remote harness of 3 Oct (the opening read, a step's
// reads in one reply, Write over a file it read, the recoveries) Qwen3.6 35B on the hard tasks passed 5
// of 9 in 1,188 s deciding, 4 of 9 in 1,888 s with the app deciding, and 3 of 9 in 1,483 s before.
export const BIG_PARAMS = 30;
export const BIG_HARNESS = { steps: 80, tries: 12, outputLines: 160, read: { whole: 400, part: 400, max: 1000 }, way: 'model' };
// "36.0B", "268.10M", "13B", "1.2T" → billions (0 when not said).
export const paramsB = (s) => {
  const m = /^([\d.]+)\s*([KMBT])/i.exec(String(s ?? '').trim());
  return m ? Number(m[1]) * { K: 1e-6, M: 1e-3, B: 1, T: 1e3 }[m[2].toUpperCase()] : 0;
};
// Who decides, by model kind: a word found in the model's family or name ('qwen35moe', 'coder'), the
// longest that fits. Every kind is 'model' until a measurement of that kind says otherwise (the fix
// plan's M1: so far 9 hard tasks, once, on one kind, against 28 tasks on another saying the opposite);
// a measured kind gets its own line here, and /effort's saved row still wins over both.
export const BIG_WAYS = { default: 'model' };
export function bigWay(o, ways = BIG_WAYS) {
  const name = `${o?.family ?? ''} ${o?.id ?? ''}`.toLowerCase();
  const hit = Object.keys(ways).filter((k) => k !== 'default' && name.includes(k.toLowerCase())).sort((a, b) => b.length - a.length)[0];
  return ways[hit ?? 'default'] ?? 'model';
}
// The profile for an Ollama model's entry (ollama.mjs), or null.
export const bigHarness = (o, ways = BIG_WAYS) => (o?.known && o.chat && o.tools && paramsB(o.params) >= BIG_PARAMS ? { ...BIG_HARNESS, way: bigWay(o, ways) } : null);

// The settings the agent runs a remote with: the matching model's here when
// the server runs one of ours (by its file, else its name), else GENERIC_REMOTE
// (with an Ollama model's own effort levels). Its name says where it runs; it
// takes no memory on this Mac. remote.model: the name the server knows it by.
export function remoteModel(r, info = {}) {
  const file = info.file ? basename(info.file) : null;
  const name = String(info.model ?? r?.model ?? '').toLowerCase();
  const ours = Object.values(MODELS);
  const base = (file && ours.find((m) => m.file === file))
    ?? (name && ours.find((m) => name.includes(m.file.toLowerCase().replace(/\.gguf$/, '')) || name === m.id))
    ?? null;
  const where = remoteLabel(r);
  const ctx = r?.context || (r?.kind === 'claude' && info.ctx ? Math.min(info.ctx, CLAUDE_CTX) : info.ctx) || null;
  const o = info.ollama ?? null;
  const common = { id: 'remote', remote: { kind: r?.kind ?? 'llama', label: where, source: sourceOf(r), model: info.model || r?.model || null, ollama: o?.version ?? null, mine: ownMachine(r) }, bytes: 0, draft: null, slots: info.slots ?? 1 };
  if (base) return { ...base, ...common, base: base.id, name: `${base.name} · ${where}`, maxCtx: ctx ?? base.maxCtx, thinkingDefault: canThink(base) };
  // On, at the model's own level (gpt-oss: Medium, its maker's default; its High is slow and can loop),
  // unless the service says it cannot think.
  const levels = o?.known ? { thinkingLevels: remoteLevels(o), thinkingEffort: o.thinking ? (/gpt-?oss/i.test(`${o.family} ${o.id}`) ? 'medium' : 'high') : 'low', thinkingDefault: Boolean(o.thinking) } : {};
  // An Ollama model's longest context is its own (/effort's Context row goes up to it).
  // A big one carries big-model mode (bigHarness).
  const harness = bigHarness(o);
  return { ...GENERIC_REMOTE, ...levels, ...common, ...(harness ? { harness } : {}), name: `${info.model || r?.model || 'Remote model'} · ${where}`, maxCtx: o?.ctx || ctx || GENERIC_REMOTE.maxCtx };
}

// ---- connecting ---------------------------------------------------------------------------------

// The context an Ollama model is asked to run at (num_ctx): its own from /effort
// (r.contexts, by model), else /remote's Context row, else null: the service's own.
export const ollamaCtxOf = (r, model) => Number(r?.contexts?.[model]) || Number(r?.context) || null;

// Opens the remote for use: the tunnel when it goes by SSH, the key from the
// Keychain, the check; registers the endpoint so every call carries the key.
// On an Ollama service it is talked to in Ollama's own chat (its OpenAI-style one
// cannot name a context), with the context it is to run at.
// Answers { url, ctx, slots, model (the settings), info, stop() }, or throws
// with the reason in plain words. The context used: the one typed in the form,
// else the server's, else 32k.
// serviceSize: a cold Ollama model is left to load at the service's own size, which the caller
// then reads and pins (the app's preloadRemote); without it, the request names the floor.
export async function connectRemote(r, { signal, ssh = 'ssh', key = undefined, serviceSize = false } = {}) {
  const problem = remoteProblem(r);
  if (problem) throw new Error(`The remote is not set up: ${problem}. Open /remote`);
  const secret = key === undefined ? (r.key ? readKey(keyIdOf(r)) : null) : key;
  if (r.key && !secret) throw new Error('The remote\'s API key is missing from the Keychain. Enter it again in /remote');
  let tunnel = null;
  let url;
  if (r.connect === 'ssh' && r.kind !== 'claude') {
    tunnel = await openTunnel({ dest: r.address.trim(), remotePort: r.port ?? SERVE_PORT, ssh });
    url = tunnel.url;
  } else url = directUrl(r);
  try {
    const info = await probe({ url, kind: r.kind, key: secret, model: r.model, numCtx: r.kind === 'openai' ? ollamaCtxOf(r, r.model) : null, signal });
    if (!info.ok) throw new Error(info.error);
    const model = remoteModel(r, info);
    const o = info.ollama ?? null;
    // Every request names the context, so the model is never loaded again behind the agent's back:
    // its own (or /remote's), else the size it is loaded at now, else the least the agent works in
    // (floorCtx). Before, a cold model (coding -p, the bench) was named nothing and loaded at the
    // service's own 4k while the agent planned for 32k, and one loaded at 4k stayed at 4k.
    const loadedOk = o?.loaded && o.loadedCtx >= floorCtx(o) ? o.loadedCtx : null;
    const numCtx = o ? ollamaCtxOf(r, info.model) || loadedOk || (serviceSize && !o.loaded ? null : floorCtx(o)) : null;
    // Claude: the server's own (1M today), kept to CLAUDE_CTX unless the form asks for more.
    const ctx = numCtx || r.context || (r.kind === 'claude' ? Math.min(info.ctx ?? CLAUDE_CTX, CLAUDE_CTX) : info.ctx) || 32_768;
    // price: dollars a million tokens, in and out (the cost meter, terminal spend.mjs); free: a service of your own.
    const price = r.kind === 'claude' ? CLAUDE_MODELS.find((m) => m.id === info.model)?.price ?? null : info.price ?? null;
    const free = !price && (Boolean(o) || r.kind === 'llama' || isPrivateHost(parseAddress(r.address ?? '')?.host ?? ''));
    // keepAlive -1: the service keeps the model loaded until told (the window unloads it as it closes),
    // not Ollama's 5 idle minutes (the user's pick, 2 Oct 2026).
    setEndpoint(url, { remote: true, kind: r.kind, key: secret, model: info.model ?? 'coding', label: remoteLabel(r), price, free, ...(o ? { ollama: true, numCtx, thinks: o.thinking, tools: o.tools, family: o.family, keepAlive: -1 } : {}) });
    return {
      // vision: it can take a picture (a llama.cpp server says so; OpenAI-compatible and Claude: yes)
      url, ctx, numCtx, slots: r.kind === 'llama' ? info.slots : 1, model, info, tunnel, vision: info.vision !== false,
      stop: () => { dropEndpoint(url); tunnel?.stop(); },
    };
  } catch (e) {
    tunnel?.stop();
    throw e;
  }
}
