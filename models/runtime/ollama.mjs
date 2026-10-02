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

// The words a service uses when a model does not fit in its GPU memory: llama.cpp's
// (CUDA, ROCm and Metal builds: "cudaMalloc failed: out of memory", "unable to allocate
// ROCm0 buffer") and Ollama's own check ("requires more system memory").
export const isOutOfMemory = (text) => /out of memory|failed to allocate|unable to allocate|cudaMalloc failed|requires more (?:system |gpu )?memory|insufficient memory|not enough memory/i.test(String(text ?? ''));

// Loads a model on the service without asking it anything (an empty prompt),
// so a switch is not first felt on the next reply; numCtx: at that context (its
// cache is part of what has to fit), else at the service's own. Resolves once it
// is loaded; throws with the service's words when it cannot be.
export async function preloadOllama({ url, key, model, numCtx = null, signal, timeoutMs = 15 * 60_000 }) {
  const t = AbortSignal.timeout(timeoutMs);
  const res = await fetch(`${norm(url)}/api/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headersOf(url, key) },
    body: JSON.stringify({ model, prompt: '', stream: false, ...(numCtx ? { options: { num_ctx: numCtx } } : {}) }),
    signal: signal ? AbortSignal.any([signal, t]) : t,
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.error?.message ?? j?.error ?? `${res.status}`);
  return j;
}
