// An Ollama service (/remote, Another service): what each of its models is and
// can do. Its OpenAI-style /v1/models gives names only, so Ollama's own API is
// read too: /api/version says it is Ollama; /api/tags lists the models (size,
// family, parameters, quantization); /api/ps the ones loaded now and the
// context each runs at; /api/show each one's abilities (tools, thinking,
// vision, completion, embedding) and its longest context. A model's /api/show
// is read once per set of weights (its digest) and kept for the window.
// Everything here is best-effort: a server that is not Ollama answers null.
import { authHeaders } from './remote.mjs';

const norm = (url) => String(url ?? '').replace(/\/+$/, '');
// The headers a call carries: the key given (a check before the address is
// registered), else the registered one.
const headersOf = (url, key) => (key === undefined ? authHeaders(url) : key ? { authorization: `Bearer ${key}` } : {});

async function call(url, path, { key, signal, timeoutMs = 5000, body } = {}) {
  const t = AbortSignal.timeout(timeoutMs);
  const res = await fetch(`${norm(url)}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headersOf(url, key) },
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, t]) : t,
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

// Its version ("0.32.12"), or null when the address is not Ollama.
export async function ollamaVersion(url, opts = {}) {
  try {
    const v = await call(url, '/api/version', opts);
    return typeof v?.version === 'string' ? v.version : null;
  } catch { return null; }
}

// Until a model is loaded, the context it will run at is not known (the
// service's own setting decides, at most the model's longest): plan for no
// more than 32k, since Ollama cuts a longer prompt without saying so. A loaded
// model's is exact.
export const COLD_CTX = 32_768;
export const ollamaCtx = (m) => (m?.loadedCtx || Math.min(m?.ctx || COLD_CTX, COLD_CTX));
// The least context the agent works in: 32k, or the model's longest when that is less. The
// instructions and tools alone are about 5k tokens, and a service's own size can be Ollama's 4k
// (2 Oct 2026: qwen3.5:9b on a service, loaded at 4k, cut every prompt without saying so).
export const floorCtx = (m) => Math.min(m?.ctx || COLD_CTX, COLD_CTX);

// What /api/show says, kept by digest: the abilities (null on an Ollama too old
// to list them) and the longest context ("<family>.context_length").
const SHOWN = new Map();
const shownOf = (s) => ({
  caps: Array.isArray(s?.capabilities) ? s.capabilities : null,
  ctx: Object.entries(s?.model_info ?? {}).find(([k]) => k.endsWith('.context_length'))?.[1] ?? null,
  details: s?.details ?? {},
});

// One model as the rest of the app sees it. known: its abilities were listed;
// when not, it is taken as able to chat and use tools (as before this list).
function entryOf(id, { tag = null, shown = null, ps = null } = {}) {
  const d = { ...(shown?.details ?? {}), ...(tag?.details ?? {}) };
  const caps = shown?.caps ?? null;
  const has = (c, otherwise) => (caps ? caps.includes(c) : otherwise);
  return {
    id, family: d.family ?? '', params: d.parameter_size ?? '', quant: d.quantization_level ?? '',
    bytes: tag?.size ?? ps?.size ?? 0, digest: tag?.digest ?? ps?.digest ?? null, modified: tag?.modified_at ?? null,
    ctx: shown?.ctx ?? null, known: Boolean(caps),
    chat: has('completion', true), tools: has('tools', true), thinking: has('thinking', false), vision: has('vision', false), embedding: has('embedding', false),
    loaded: Boolean(ps), loadedCtx: ps?.context_length ?? null, sameAs: [],
  };
}

// A few calls at a time: a service with many models is not asked all at once.
async function each(list, n, fn) {
  const queue = [...list];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { while (queue.length) await fn(queue.shift()); }));
}

// The whole list: { version, models, at }, or null when the address is not Ollama.
export async function ollamaCatalog({ url, key, signal, timeoutMs = 8000 } = {}) {
  const version = await ollamaVersion(url, { key, signal, timeoutMs });
  if (!version) return null;
  const [tags, ps] = await Promise.all([
    call(url, '/api/tags', { key, signal, timeoutMs }).catch(() => null),
    call(url, '/api/ps', { key, signal, timeoutMs }).catch(() => null),
  ]);
  if (!Array.isArray(tags?.models)) return null;
  const loaded = new Map((ps?.models ?? []).map((m) => [m.name, m]));
  // One /api/show per set of weights not read yet (two names for the same weights share it).
  const need = [...new Map(tags.models.filter((m) => m.digest && !SHOWN.has(m.digest)).map((m) => [m.digest, m])).values()];
  await each(need, 6, async (m) => {
    const s = await call(url, '/api/show', { key, signal, timeoutMs, body: { model: m.name } }).catch(() => null);
    if (s) SHOWN.set(m.digest, shownOf(s));
  });
  const models = tags.models.map((m) => entryOf(m.name, { tag: m, shown: SHOWN.get(m.digest), ps: loaded.get(m.name) }));
  // The same weights under two names (deepseek-coder-v2:latest and :16b).
  for (const m of models) m.sameAs = models.filter((x) => x !== m && x.digest && x.digest === m.digest).map((x) => x.id);
  return { version, models, at: Date.now() };
}

// One model, for a check or a connect (three calls, not the whole list):
// { version, ...its entry }, or null when the address is not Ollama.
export async function ollamaModel({ url, key, model, signal, timeoutMs = 5000 } = {}) {
  if (!model) return null;
  const version = await ollamaVersion(url, { key, signal, timeoutMs });
  if (!version) return null;
  const [s, ps] = await Promise.all([
    call(url, '/api/show', { key, signal, timeoutMs, body: { model } }).catch(() => null),
    call(url, '/api/ps', { key, signal, timeoutMs }).catch(() => null),
  ]);
  const p = (ps?.models ?? []).find((m) => m.name === model) ?? null;
  return { version, ...entryOf(model, { shown: s ? shownOf(s) : null, ps: p }) };
}

// Where one model stands on the service now, from /api/ps alone (one light call, for the
// footer's GPU gauge every 30 s): its size, how much of it is in GPU memory (gpuPct under
// 100: the rest runs on the CPU, much slower), its context, when it unloads, and how long
// the call took (ms). { loaded: false, ms } when it is not loaded; null when the service
// does not answer or is not Ollama.
export async function ollamaPs({ url, key, model, signal, timeoutMs = 5000 } = {}) {
  const t0 = Date.now();
  let ps;
  try { ps = await call(url, '/api/ps', { key, signal, timeoutMs }); } catch { return null; }
  if (!Array.isArray(ps?.models)) return null;
  const ms = Date.now() - t0;
  const p = ps.models.find((m) => m.name === model || m.model === model);
  if (!p) return { loaded: false, ms };
  const size = p.size ?? 0;
  const vram = Number.isFinite(p.size_vram) ? p.size_vram : null;
  return { loaded: true, ms, size, vram, gpuPct: size && vram !== null ? Math.round(Math.min(1, vram / size) * 100) : null, ctx: p.context_length ?? null, until: p.expires_at ?? null };
}

// The words a service uses when a model does not fit in its GPU memory: llama.cpp's
// (CUDA, ROCm and Metal builds: "cudaMalloc failed: out of memory", "unable to allocate
// ROCm0 buffer") and Ollama's own check ("requires more system memory").
export const isOutOfMemory = (text) => /out of memory|failed to allocate|unable to allocate|cudaMalloc failed|resource allocation failed|requires more (?:system |gpu )?memory|insufficient memory|not enough memory/i.test(String(text ?? ''));

// Keep loaded's "while open": every request keeps the model this long, and the open window asks
// again before it runs out (App.jsx, with the footer's /api/ps look). A window that could not say
// it was closing (a crash, the Mac restarting, no network as it closed) leaves the model loaded at
// most this long, not for ever as keep_alive -1 did (3 Oct 2026: a 25 GB model was found kept).
export const OPEN_KEEP = '15m';
export const OPEN_KEEP_MS = 15 * 60_000;

// Loads a model on the service without asking it anything (an empty prompt),
// so a switch is not first felt on the next reply; numCtx: at that context (its
// cache is part of what has to fit), else at the service's own. Resolves once it
// is loaded; throws with the service's words when it cannot be.
// keepAlive: how long the service keeps it after (Ollama's keep_alive: '30m', OPEN_KEEP; -1 = until told).
export async function preloadOllama({ url, key, model, numCtx = null, keepAlive, signal, timeoutMs = 15 * 60_000 }) {
  const t = AbortSignal.timeout(timeoutMs);
  const res = await fetch(`${norm(url)}/api/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headersOf(url, key) },
    body: JSON.stringify({ model, prompt: '', stream: false, ...(numCtx ? { options: { num_ctx: numCtx } } : {}), ...(keepAlive !== undefined ? { keep_alive: keepAlive } : {}) }),
    signal: signal ? AbortSignal.any([signal, t]) : t,
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.error?.message ?? j?.error ?? `${res.status}`);
  return j;
}

// Lets a model go on the service now (keep_alive 0), so its memory is free for another.
// Best-effort: answers whether the service said yes.
export async function unloadOllama({ url, key, model, timeoutMs = 10_000 }) {
  try {
    const res = await fetch(`${norm(url)}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json', ...headersOf(url, key) }, body: JSON.stringify({ model, keep_alive: 0 }), signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch { return false; }
}

// A run that borrows a model of the service (a test's questions, the code map's labels; 3 Oct 2026, the
// owner's rule after a run left a 26 GB model loaded for an hour: never hold a model on the service
// after the work is done). Before it starts: whether the model was already loaded (then it is someone
// else's to keep). When it ends, finished or stopped: release() lets it go, but only when this run
// loaded it; unknown (the service did not say) counts as loaded by this run. Its own requests ask the
// service to keep the model RUN_KEEP at most, so even a run killed outright leaves it that long.
export const RUN_KEEP = '5m';
export async function borrowOllama({ url, key = null, model }) {
  const before = await ollamaPs({ url, key, model });
  const wasLoaded = before?.loaded === true;
  let done = false;
  return {
    wasLoaded,
    async release() {
      if (done) return null;
      done = true;
      if (wasLoaded) return false;
      return unloadOllama({ url, key, model });
    },
  };
}

// Everything /api/show says about one model, for the hub's Remote tab: its
// settings (temperature, stop words…), chat template, built-in system prompt,
// license, and how it is built (model_info: layers, heads, vocabulary…; the
// tokenizer's long word lists are left out), with /api/ps on it when loaded
// (GPU memory, context, when it unloads). null when the service does not know it.
export async function ollamaDetail({ url, key, model, signal, timeoutMs = 8000 } = {}) {
  if (!model) return null;
  const [s, ps] = await Promise.all([
    call(url, '/api/show', { key, signal, timeoutMs, body: { model } }).catch(() => null),
    call(url, '/api/ps', { key, signal, timeoutMs }).catch(() => null),
  ]);
  if (!s) return null;
  const p = (ps?.models ?? []).find((m) => m.name === model) ?? null;
  const scalars = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v)));
  // "stop "<|im_end|>"\ntemperature 0.7" → { stop: ['<|im_end|>'], temperature: '0.7' }
  const params = {};
  for (const line of String(s.parameters ?? '').split('\n')) {
    const m = /^(\S+)\s+(.*)$/.exec(line.trim());
    if (!m) continue;
    const v = m[2].replace(/^"(.*)"$/, '$1');
    params[m[1]] = m[1] in params ? [].concat(params[m[1]], v) : m[1] === 'stop' ? [v] : v;
  }
  return {
    id: model, details: s.details ?? {}, capabilities: Array.isArray(s.capabilities) ? s.capabilities : null,
    ctx: Object.entries(s.model_info ?? {}).find(([k]) => k.endsWith('.context_length'))?.[1] ?? null,
    params, template: String(s.template ?? ''), system: String(s.system ?? ''), license: String(s.license ?? '').slice(0, 40_000),
    info: scalars(s.model_info), projector: scalars(s.projector_info), modified: s.modified_at ?? null,
    loaded: p ? { vram: p.size_vram ?? null, size: p.size ?? null, ctx: p.context_length ?? null, until: p.expires_at ?? null } : null,
  };
}
