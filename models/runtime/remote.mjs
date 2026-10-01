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
import { CLAUDE_HOST, CLAUDE_CTX, claudeProbe } from './claude.mjs';

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

// AGENTIC_REMOTE_KEY stands in for any remote's key (not a web search service's).
const envKey = (id) => (process.env.AGENTIC_REMOTE_KEY && !String(id).startsWith('search-') ? process.env.AGENTIC_REMOTE_KEY : null);
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

// The end of a key, for the form (••••3f9a): enough to tell two keys apart.
export const keyEnd = (key) => (key && key.length >= 12 ? key.slice(-4) : '');

// ---- the SSH tunnel -----------------------------------------------------------------------------

export const TUNNEL_PORTS = [17650, 17699];
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
export async function probe({ url, kind = 'llama', key = null, model = '', reply = false, autoPick = true, signal, timeoutMs = 8000 }) {
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
      steps.push({ ok: true, text: `model ${out.model}${out.ctx ? ` · ${Math.round(out.ctx / 1024)}k context` : ''}` });
    }
    if (reply) {
      const t1 = Date.now();
      const t = AbortSignal.timeout(Math.max(timeoutMs, 60_000));
      const ask = (limit) => fetch(`${norm(url)}/v1/chat/completions`, {
        method: 'POST', signal: signal ? AbortSignal.any([signal, t]) : t,
        headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model: out.model ?? 'coding', messages: [{ role: 'user', content: 'Reply with the single word: ready' }], ...limit, stream: false, ...(kind === 'llama' ? { chat_template_kwargs: { enable_thinking: false } } : {}) }),
      });
      let res = await ask({ max_tokens: 8 });
      let j = await res.json().catch(() => null);
      // A server that wants max_completion_tokens (OpenAI's reasoning models) is asked that way, with room to think.
      if (res.status === 400 && /max_completion_tokens/.test(j?.error?.message ?? '')) { res = await ask({ max_completion_tokens: 512 }); j = await res.json().catch(() => null); }
      if (!res.ok) return fail(`it would not answer: ${res.status} ${(j?.error?.message ?? '').slice(0, 140)}`.trim());
      const said = String(j?.choices?.[0]?.message?.content ?? '').trim().replace(/\s+/g, ' ').slice(0, 24);
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
export const GENERIC_REMOTE = {
  id: 'remote', name: 'Remote model', by: '', file: null, bytes: 0,
  sampling: {}, thinkingSampling: {},
  thinkingDefault: false, thinkingEffort: 'high',
  thinkingLevels: [
    { id: 'low', label: 'Low', effort: null, note: 'answers straight away' },
    { id: 'high', label: 'High', effort: 'high', note: 'asks the model to think first (one that cannot answers without it)' },
  ],
  thinkingBudget: 4096,
  maxCtx: 131_072,
};

// The settings the agent runs a remote with: the matching model's here when
// the server runs one of ours (by its file, else its name), else GENERIC_REMOTE.
// Its name says where it runs; it takes no memory on this Mac.
export function remoteModel(r, info = {}) {
  const file = info.file ? basename(info.file) : null;
  const name = String(info.model ?? r?.model ?? '').toLowerCase();
  const ours = Object.values(MODELS);
  const base = (file && ours.find((m) => m.file === file))
    ?? (name && ours.find((m) => name.includes(m.file.toLowerCase().replace(/\.gguf$/, '')) || name === m.id))
    ?? null;
  const where = remoteLabel(r);
  const ctx = r?.context || (r?.kind === 'claude' && info.ctx ? Math.min(info.ctx, CLAUDE_CTX) : info.ctx) || null;
  const common = { id: 'remote', remote: { kind: r?.kind ?? 'llama', label: where, source: sourceOf(r) }, bytes: 0, draft: null, slots: info.slots ?? 1 };
  if (base) return { ...base, ...common, base: base.id, name: `${base.name} · ${where}`, maxCtx: ctx ?? base.maxCtx };
  return { ...GENERIC_REMOTE, ...common, name: `${info.model || r?.model || 'Remote model'} · ${where}`, maxCtx: ctx ?? GENERIC_REMOTE.maxCtx };
}

// ---- connecting ---------------------------------------------------------------------------------

// Opens the remote for use: the tunnel when it goes by SSH, the key from the
// Keychain, the check; registers the endpoint so every call carries the key.
// Answers { url, ctx, slots, model (the settings), info, stop() }, or throws
// with the reason in plain words. The context used: the one typed in the form,
// else the server's, else 32k.
export async function connectRemote(r, { signal, ssh = 'ssh', key = undefined } = {}) {
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
    const info = await probe({ url, kind: r.kind, key: secret, model: r.model, signal });
    if (!info.ok) throw new Error(info.error);
    const model = remoteModel(r, info);
    // Claude: the server's own (1M today), kept to CLAUDE_CTX unless the form asks for more.
    const ctx = r.context || (r.kind === 'claude' ? Math.min(info.ctx ?? CLAUDE_CTX, CLAUDE_CTX) : info.ctx) || 32_768;
    setEndpoint(url, { remote: true, kind: r.kind, key: secret, model: info.model ?? 'coding', label: remoteLabel(r) });
    return {
      // vision: it can take a picture (a llama.cpp server says so; OpenAI-compatible and Claude: yes)
      url, ctx, slots: r.kind === 'llama' ? info.slots : 1, model, info, tunnel, vision: info.vision !== false,
      stop: () => { dropEndpoint(url); tunnel?.stop(); },
    };
  } catch (e) {
    tunnel?.stop();
    throw e;
  }
}
