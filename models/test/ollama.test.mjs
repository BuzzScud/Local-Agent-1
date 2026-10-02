// An Ollama service's own list (models/runtime/ollama.mjs): what each model is
// and can do, which are loaded and at what context, read from /api/version,
// /api/tags, /api/ps and /api/show; the check and the settings a remote then
// runs with (pictures, context, effort levels); loading a model ahead of a reply.
// A fake Ollama; the real Keychain and home are never touched.
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-ollama-home-'));
process.env.AGENTIC_REMOTE_KEYSTORE = 'file';
const { ollamaCatalog, ollamaModel, ollamaPs, ollamaCtx, preloadOllama, isOutOfMemory, COLD_CTX, probe, remoteModel, remoteLevels, ollamaCtxOf, connectRemote, endpointOf, GENERIC_REMOTE, BIG_HARNESS, bigHarness, paramsB, HOME } = await import('../index.mjs');
test('the tests run in a throwaway home', () => { expect(HOME).not.toBe(join(homedir(), '.agentic-coder')); });

// The models as Ollama 0.32 describes them. loaded: in /api/ps at that context.
const MODELS = [
  { name: 'tiny:3b', family: 'llama', params: '3.2B', quant: 'Q4_K_M', size: 2.0e9, caps: ['completion', 'tools'], ctx: 131072, loaded: 131072, at: '2026-07-01' },
  { name: 'coder:30b', family: 'qwen3moe', params: '30.5B', quant: 'Q4_K_M', size: 18.6e9, caps: ['completion', 'tools'], ctx: 262144, at: '2025-12-20' },
  { name: 'thinker:35b', family: 'qwen35moe', params: '36.0B', quant: 'Q4_K_M', size: 23.9e9, caps: ['completion', 'vision', 'tools', 'thinking'], ctx: 262144, at: '2026-06-15' },
  { name: 'gpt-oss:120b', family: 'gptoss', params: '116.8B', quant: 'MXFP4', size: 65.4e9, caps: ['completion', 'tools', 'thinking'], ctx: 131072, at: '2025-12-20' },
  { name: 'oldchat:14b', family: 'phi3', params: '14.7B', quant: 'Q4_K_M', size: 9.1e9, caps: ['completion'], ctx: 16384, at: '2025-12-24', digest: 'same' },
  { name: 'oldchat:latest', family: 'phi3', params: '14.7B', quant: 'Q4_K_M', size: 9.1e9, caps: ['completion'], ctx: 16384, at: '2025-12-24', digest: 'same' },
  { name: 'embed:latest', family: 'gemma3', params: '307.58M', quant: 'BF16', size: 0.6e9, caps: ['embedding'], ctx: 2048, at: '2026-06-16' },
];
// seen: every request's method and path (and the model a POST names); bodies: the POSTs' bodies.
// gpu: the share of each loaded model in GPU memory (/api/ps size_vram).
function fakeOllama({ caps = true, gpu = 1 } = {}) {
  const seen = [];
  const bodies = [];
  const server = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const body = b ? JSON.parse(b) : {};
    seen.push({ method: req.method, path: req.url, model: body.model ?? null });
    if (req.method === 'POST') bodies.push({ path: req.url, ...body });
    const json = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    const m = MODELS.find((x) => x.name === body.model);
    if (req.url === '/api/version') return json(200, { version: '0.32.12' });
    if (req.url === '/api/tags') return json(200, { models: MODELS.map((x) => ({ name: x.name, model: x.name, size: x.size, digest: x.digest ?? `d-${x.name}`, modified_at: `${x.at}T12:00:00Z`, details: { family: x.family, parameter_size: x.params, quantization_level: x.quant } })) });
    if (req.url === '/api/ps') return json(200, { models: MODELS.filter((x) => x.loaded).map((x) => ({ name: x.name, model: x.name, size: x.size, size_vram: Math.round(x.size * gpu), digest: `d-${x.name}`, context_length: x.loaded, expires_at: '2318-06-11T12:00:00Z' })) });
    if (req.url === '/api/show') return m ? json(200, { details: { family: m.family, parameter_size: m.params, quantization_level: m.quant }, model_info: { [`${m.family}.context_length`]: m.ctx }, ...(caps ? { capabilities: m.caps } : {}) }) : json(404, { error: `model '${body.model}' not found` });
    if (req.url === '/api/generate') return m ? json(200, { model: m.name, response: '', done: true, done_reason: 'load' }) : json(404, { error: `model "${body.model}" not found, try pulling it first` });
    if (req.url === '/api/chat') return json(200, { model: body.model, message: { role: 'assistant', content: 'ready' }, done: true });
    if (req.url === '/v1/models') return json(200, { object: 'list', data: MODELS.map((x) => ({ id: x.name, object: 'model', owned_by: 'library' })) });
    json(404, { error: 'not found' });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}`, port: server.address().port, seen, bodies, close: () => new Promise((d) => server.close(d)) })));
}

test('the list: each model with its size, family, quantization, abilities, longest context and whether it is loaded; the same weights under two names are told', async () => {
  const s = await fakeOllama();
  try {
    const c = await ollamaCatalog({ url: s.url, key: null });
    expect(c.version).toBe('0.32.12');
    expect(c.models.map((m) => m.id)).toEqual(MODELS.map((m) => m.name));
    const by = Object.fromEntries(c.models.map((m) => [m.id, m]));
    expect(by['thinker:35b']).toMatchObject({ family: 'qwen35moe', params: '36.0B', quant: 'Q4_K_M', bytes: 23.9e9, ctx: 262144, known: true, chat: true, tools: true, thinking: true, vision: true, loaded: false, loadedCtx: null });
    expect(by['tiny:3b']).toMatchObject({ tools: true, thinking: false, vision: false, loaded: true, loadedCtx: 131072 });
    expect(by['oldchat:14b']).toMatchObject({ chat: true, tools: false, sameAs: ['oldchat:latest'] });
    expect(by['embed:latest']).toMatchObject({ chat: false, embedding: true });
    // /api/show once per set of weights: the twins share one, and a second read asks for none
    expect(s.seen.filter((x) => x.path === '/api/show').length).toBe(MODELS.length - 1);
    await ollamaCatalog({ url: s.url, key: null });
    expect(s.seen.filter((x) => x.path === '/api/show').length).toBe(MODELS.length - 1);
  } finally { await s.close(); }
});

test('a server that is not Ollama has no list (one GET, answered 404); an Ollama too old to list abilities takes every model as able to chat and use tools', async () => {
  const other = createServer((req, res) => { res.writeHead(404); res.end('{}'); });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${other.address().port}`;
  expect(await ollamaCatalog({ url, key: null })).toBe(null);
  expect(await ollamaModel({ url, key: null, model: 'x' })).toBe(null);
  other.close();
  const old = await fakeOllama({ caps: false });
  try {
    const m = await ollamaModel({ url: old.url, key: null, model: 'oldchat:latest' });
    expect(m).toMatchObject({ known: false, chat: true, tools: true, thinking: false, vision: false });
    expect(remoteLevels(m)).toBe(GENERIC_REMOTE.thinkingLevels);
  } finally { await old.close(); }
});

test('the footer’s GPU gauge: /api/ps alone gives a loaded model’s share in GPU memory, its context and the call’s time; a model not loaded says so; not Ollama is null', async () => {
  const s = await fakeOllama();
  const spill = await fakeOllama({ gpu: 0.62 });
  const other = createServer((req, res) => { res.writeHead(404); res.end('{}'); });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  try {
    const on = await ollamaPs({ url: s.url, key: null, model: 'tiny:3b' });
    expect(on).toMatchObject({ loaded: true, size: 2.0e9, vram: 2.0e9, gpuPct: 100, ctx: 131072, until: '2318-06-11T12:00:00Z' });
    expect(on.ms).toBeGreaterThanOrEqual(0);
    expect((await ollamaPs({ url: spill.url, key: null, model: 'tiny:3b' })).gpuPct).toBe(62);
    expect(await ollamaPs({ url: s.url, key: null, model: 'coder:30b' })).toMatchObject({ loaded: false });
    expect(s.seen.map((x) => x.path)).toEqual(['/api/ps', '/api/ps']); // one call each, nothing else
    expect(await ollamaPs({ url: `http://127.0.0.1:${other.address().port}`, key: null, model: 'tiny:3b' })).toBe(null);
  } finally { await s.close(); await spill.close(); other.close(); }
});

test('the context planned for: a loaded model’s own; a cold one no more than 32k until it is loaded (Ollama cuts a longer prompt without a word)', () => {
  expect(COLD_CTX).toBe(32768);
  expect(ollamaCtx({ loadedCtx: 131072, ctx: 131072 })).toBe(131072);
  expect(ollamaCtx({ loadedCtx: null, ctx: 262144 })).toBe(32768);
  expect(ollamaCtx({ loadedCtx: null, ctx: 16384 })).toBe(16384);
  expect(ollamaCtx({})).toBe(32768);
});

test('effort levels follow what the model can do: Low only when it cannot think, Low and High when it can, three for gpt-oss', () => {
  expect(remoteLevels({ known: true, thinking: false, family: 'llama', id: 'tiny:3b' }).map((l) => [l.id, l.effort])).toEqual([['low', null]]);
  expect(remoteLevels({ known: true, thinking: true, family: 'qwen35moe', id: 'thinker:35b' }).map((l) => l.id)).toEqual(['low', 'high']);
  expect(remoteLevels({ known: true, thinking: true, family: 'gptoss', id: 'gpt-oss:120b' }).map((l) => [l.id, l.effort])).toEqual([['low', null], ['medium', 'medium'], ['high', 'high']]);
});

test('the check on an Ollama service: pictures, context and levels come from the service, and the remote runs with them', async () => {
  const s = await fakeOllama();
  try {
    const url = s.url;
    const coder = await probe({ url, kind: 'openai', model: 'coder:30b' });
    expect(coder.ok).toBe(true);
    expect(coder.vision).toBe(false); // an OpenAI-compatible server was taken as able to see; this model cannot
    expect(coder.ctx).toBe(32768); // cold: 32k until it is loaded, not its 256k
    expect(coder.ollama).toMatchObject({ version: '0.32.12', id: 'coder:30b', tools: true, thinking: false });
    expect(coder.steps.at(-1).text).toBe('model coder:30b · 32k context');
    const tiny = await probe({ url, kind: 'openai', model: 'tiny:3b' });
    expect(tiny.ctx).toBe(131072); // loaded: the context it runs at
    const thinker = await probe({ url, kind: 'openai', model: 'thinker:35b' });
    expect(thinker.vision).toBe(true);
    const r = { source: 'openai', kind: 'openai', address: url, model: 'coder:30b', context: 0 };
    const m = remoteModel(r, coder);
    expect(m.name).toBe(`coder:30b · ${url.replace('http://', '')}`);
    expect(m.remote).toEqual({ kind: 'openai', label: url.replace('http://', ''), source: 'openai', model: 'coder:30b', ollama: '0.32.12' });
    expect(m.thinkingLevels.map((l) => l.id)).toEqual(['low']);
    expect(m.thinkingEffort).toBe('low');
    expect(remoteModel({ ...r, model: 'thinker:35b' }, thinker).thinkingLevels.map((l) => l.id)).toEqual(['low', 'high']);
    // a remote that is not Ollama keeps the plain levels
    expect(remoteModel(r, { model: 'x' }).thinkingLevels).toBe(GENERIC_REMOTE.thinkingLevels);
  } finally { await s.close(); }
});

test('loading a model ahead of a reply: an empty prompt to /api/generate; one the service cannot load says why', async () => {
  const s = await fakeOllama();
  try {
    const j = await preloadOllama({ url: s.url, key: null, model: 'coder:30b' });
    expect(j.done_reason).toBe('load');
    expect(s.seen.at(-1)).toEqual({ method: 'POST', path: '/api/generate', model: 'coder:30b' });
    await expect(preloadOllama({ url: s.url, key: null, model: 'gone:1b' })).rejects.toThrow('model "gone:1b" not found, try pulling it first');
  } finally { await s.close(); }
});

test('out of GPU memory, in the words a service uses (llama.cpp’s CUDA and ROCm builds, Ollama’s own check)', () => {
  expect(isOutOfMemory('llama-server process has terminated: exit status 1: cudaMalloc failed: out of memory\nalloc_tensor_range: failed to allocate ROCm0 buffer of size 74995960832')).toBe(true);
  expect(isOutOfMemory('error loading model: unable to allocate ROCm0 buffer')).toBe(true);
  expect(isOutOfMemory('model requires more system memory (75.0 GiB) than is available (40.2 GiB)')).toBe(true);
  expect(isOutOfMemory('llama-server process has terminated: exit status 2')).toBe(false);
  expect(isOutOfMemory('model "x" not found, try pulling it first')).toBe(false);
});

test('the context a model runs at: its own from /effort, else /remote’s Context row, else the service’s (null); loading one ahead at it', async () => {
  const r = { context: 0, contexts: { 'coder:30b': 65536 } };
  expect([ollamaCtxOf(r, 'coder:30b'), ollamaCtxOf(r, 'tiny:3b'), ollamaCtxOf({ ...r, context: 16384 }, 'tiny:3b'), ollamaCtxOf(null, 'x')]).toEqual([65536, null, 16384, null]);
  const s = await fakeOllama();
  try {
    await preloadOllama({ url: s.url, key: null, model: 'coder:30b', numCtx: 65536 });
    await preloadOllama({ url: s.url, key: null, model: 'tiny:3b' });
    expect(s.bodies.slice(-2).map((b) => b.options ?? null)).toEqual([{ num_ctx: 65536 }, null]);
  } finally { await s.close(); }
});

test('connecting to an Ollama service: its own chat with the model’s context, and the address registered as Ollama with what the model can do', async () => {
  const s = await fakeOllama();
  try {
    const r = { source: 'openai', kind: 'openai', connect: 'http', address: s.url, model: 'gpt-oss:120b', context: 0, contexts: { 'gpt-oss:120b': 65536 }, key: false };
    const res = await probe({ url: s.url, kind: 'openai', model: 'gpt-oss:120b', numCtx: 65536, reply: true });
    expect(res.ok).toBe(true);
    expect(res.steps.at(-1).text).toMatch(/^answered "ready"/);
    // the word asked for in Ollama's chat, at that context (gpt-oss at its least thinking, room for it)
    expect(s.bodies.at(-1)).toMatchObject({ path: '/api/chat', model: 'gpt-oss:120b', stream: false, think: 'low', options: { num_predict: 512, num_ctx: 65536 } });
    expect(s.seen.some((x) => x.path === '/v1/chat/completions')).toBe(false);
    const c = await connectRemote(r);
    expect([c.numCtx, c.ctx, c.model.maxCtx]).toEqual([65536, 65536, 131072]);
    expect(endpointOf(c.url)).toMatchObject({ ollama: true, numCtx: 65536, thinks: true, tools: true, family: 'gptoss', model: 'gpt-oss:120b' });
    c.stop();
    // one with no context of its own, loaded: the size it is loaded at is named (so it is not loaded again)
    const t = await connectRemote({ ...r, model: 'tiny:3b' });
    expect([t.numCtx, t.ctx]).toEqual([131072, 131072]);
    expect(endpointOf(t.url)).toMatchObject({ ollama: true, numCtx: 131072, thinks: false });
    t.stop();
    // a cold one: none until it is loaded (the service's own), 32k planned for meanwhile
    const cold = await connectRemote({ ...r, model: 'coder:30b' });
    expect([cold.numCtx, cold.ctx]).toEqual([null, 32768]);
    cold.stop();
  } finally { await s.close(); }
});

test('big-model mode: a model of 30B or more (by its total) that can call tools; not a small one, a chat-only one, an embedder or one whose abilities are not listed', async () => {
  expect([paramsB('36.0B'), paramsB('30.5B'), paramsB('13B'), paramsB('1.2T'), paramsB(''), paramsB(undefined)]).toEqual([36, 30.5, 13, 1200, 0, 0]);
  expect(paramsB('268.10M')).toBeCloseTo(0.2681, 6);
  const s = await fakeOllama();
  try {
    const c = await ollamaCatalog({ url: s.url, key: null });
    const big = Object.fromEntries(c.models.map((m) => [m.id, Boolean(bigHarness(m))]));
    expect(big).toEqual({ 'tiny:3b': false, 'coder:30b': true, 'thinker:35b': true, 'gpt-oss:120b': true, 'oldchat:14b': false, 'oldchat:latest': false, 'embed:latest': false });
    // abilities not listed (an older Ollama): no mode, whatever the size
    expect(bigHarness({ ...c.models.find((m) => m.id === 'gpt-oss:120b'), known: false })).toBe(null);
    // connecting: the remote model carries it (the app's /effort defaults read it); a small one does not
    const r = { source: 'openai', kind: 'openai', connect: 'http', address: s.url, model: 'gpt-oss:120b', context: 0, key: false };
    const g = await connectRemote(r);
    expect(g.model.harness).toEqual(BIG_HARNESS);
    expect(BIG_HARNESS).toEqual({ steps: 80, tries: 12, outputLines: 160, read: { whole: 400, part: 400, max: 1000 } }); // the app still decides
    g.stop();
    const t = await connectRemote({ ...r, model: 'tiny:3b' });
    expect(t.model.harness).toBeUndefined();
    t.stop();
  } finally { await s.close(); }
});
