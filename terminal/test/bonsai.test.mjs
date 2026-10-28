// The hub's Bonsai tab (27 Oct 2026): what each request to an Ollama service is doing, recorded for the page to show
// live (agent/activity.mjs); Bonsai's model file read for its layers and real weights (app/bonsai-gguf.mjs); tools a
// model goes without (its own settings); Ollama's controls refusing a test run (app/ollama-control.mjs); the speed
// test (app/bonsai-speed.mjs); the routes (app/bonsai-hub.mjs); /bonsai in the / menu.
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { HOME, setEndpoint, dropEndpoint, GENERIC_REMOTE } from '../../models/index.mjs';
import { recorded, activeRequests, recentRequests, activityDir } from '../src/agent/activity.mjs';
import { streamChat } from '../src/agent/client.mjs';
import { readGguf, modelFacts, layerParts, q2Patch, ollamaBlobOf, halfToFloat } from '../src/app/bonsai-gguf.mjs';
import { readLimits, modelWithLimits, cleanToolsOff, TOOLS_SWITCHABLE } from '../src/app/limits.mjs';
import { canAct, settingsOf, envOf, stopOllama, restartOllama, setLogin } from '../src/app/ollama-control.mjs';
import { speedTest, readSpeeds } from '../src/app/bonsai-speed.mjs';
import { COMMANDS, WHEN_ROOM, matchCommands } from '../src/app/commands.mjs';
import { TOOLS_COMMANDS } from '../src/app/slash-tools.mjs';

const B = 'bonsai-2:9b';
const drain = async (it) => { const out = []; for await (const e of it) out.push(e); return out; };

// A small Ollama with Bonsai: streamed and whole chats with Ollama's own figures, its list, loading.
let svc;
beforeAll(async () => {
  svc = await new Promise((ok) => {
    const seen = [];
    const s = createServer(async (req, res) => {
      let b = ''; for await (const c of req) b += c;
      const body = b ? JSON.parse(b) : {};
      seen.push({ path: req.url, body });
      const json = (j) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.url === '/api/version') return json({ version: '0.40.11' });
      if (req.url === '/api/ps') return json({ models: [{ name: B, model: B, size: 4.13e9, size_vram: 4.13e9, context_length: 65536, expires_at: new Date(Date.now() + 6e5).toISOString() }] });
      if (req.url === '/api/generate') return json({ done: true });
      if (req.url === '/api/chat') {
        const n = body.messages?.length ?? 0;
        const fig = { prompt_eval_count: n > 2 ? 4600 : 4482, prompt_eval_duration: n > 2 ? 2e8 : 21.4e9, eval_count: 120, eval_duration: 4.3e9, load_duration: 1e7 };
        if (!body.stream) return json({ model: B, message: { role: 'assistant', content: 'I can read and change files.' }, done: true, ...fig });
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.write(`${JSON.stringify({ message: { role: 'assistant', content: '', thinking: 'Hmm.' }, done: false })}\n`);
        res.write(`${JSON.stringify({ message: { role: 'assistant', content: 'Four.' }, done: false })}\n`);
        res.end(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', ...fig })}\n`);
        return;
      }
      res.writeHead(404); res.end('{}');
    });
    s.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${s.address().port}`, seen, close: () => new Promise((d) => { s.closeAllConnections?.(); s.close(d); }) }));
  });
});
afterAll(async () => { await svc?.close(); });

test('a request to an Ollama service is recorded while it runs and when it ends: who asked, its phase, the service’s own figures', async () => {
  // a stream of its own: under way it is in the "now" list, done it is a line
  async function* slow() { yield { type: 'reasoning', text: 'a' }; await Bun.sleep(30); yield { type: 'text', text: 'b' }; yield { type: 'done', finish: 'stop', timings: { prompt_n: 4482, prompt_ms: 21400, predicted_n: 120, predicted_ms: 4300, load_ms: 10 } }; }
  const seen = [];
  for await (const ev of recorded(slow(), { model: B, url: 'x', who: 'conversation', messages: [{ role: 'user', content: '  what is   2+2?  ' }], tools: 9, think: true })) seen.push([ev.type, activeRequests({ model: B }).map((n) => n.phase)]);
  expect(seen[0]).toEqual(['reasoning', ['thinking']]);
  expect(seen[1]).toEqual(['text', ['writing']]);
  expect(activeRequests({ model: B })).toEqual([]);
  const [last] = recentRequests({ model: B, limit: 1 });
  expect(last).toMatchObject({ model: B, who: 'conversation', ask: 'what is 2+2?', tools: 9, think: true, readTok: 4482, readMs: 21400, wroteTok: 120, writeMs: 4300, thinkTok: 1, end: 'stop' });
  // a request that fails is a line too, and its "now" file goes
  async function* broken() { yield { type: 'text', text: 'x' }; throw new Error('model server: gone'); }
  await expect(drain(recorded(broken(), { model: B, url: 'x', who: 'the second look' }))).rejects.toThrow('gone');
  expect(recentRequests({ model: B, limit: 1 })[0]).toMatchObject({ who: 'the second look', end: 'error', error: 'model server: gone' });
  expect(activeRequests()).toEqual([]);
  // a "now" file left by a process that is gone is cleared when read
  mkdirSync(join(activityDir(), 'now'), { recursive: true });
  writeFileSync(join(activityDir(), 'now', '999999-1.json'), JSON.stringify({ id: '999999-1', pid: 999999, model: B, started: Date.now(), phase: 'reading' }));
  expect(activeRequests({ model: B })).toEqual([]);
  expect(existsSync(join(activityDir(), 'now', '999999-1.json'))).toBe(false);
});

test('the client records its Ollama requests: your conversation’s steps by their words, a side job by its name', async () => {
  const before = recentRequests({ limit: 100 }).length;
  setEndpoint(svc.url, { remote: true, kind: 'openai', key: null, model: B, label: 'this Mac', ollama: true, numCtx: 65536, thinks: true, tools: true, family: 'qwen35' });
  try {
    const model = { ...GENERIC_REMOTE, remote: { kind: 'openai', model: B, ollama: '0.40.11' } };
    await drain(streamChat({ url: svc.url, messages: [{ role: 'user', content: 'how fast are you?' }], model, sampling: {}, thinking: true, effort: 'high', maxTokens: 50, conversation: 'c1' }));
    await drain(streamChat({ url: svc.url, messages: [{ role: 'user', content: 'sort this' }], model, sampling: {}, thinking: false, maxTokens: 50, what: 'sorting a request' }));
  } finally { dropEndpoint(svc.url); }
  const rs = recentRequests({ model: B, limit: 2 });
  expect(recentRequests({ limit: 100 }).length).toBe(before + 2);
  expect(rs[1]).toMatchObject({ who: 'conversation', ask: 'how fast are you?', readTok: 4482, wroteTok: 120, end: 'stop' });
  expect(rs[0]).toMatchObject({ who: 'sorting a request', ask: '' });
  expect(Math.round(rs[1].readMs)).toBe(21400);
});

// A model file of three parts: GGUF v3, a Q2_0 matrix (two rows of 128 weights), a plain vector.
function tinyGguf(dir) {
  const parts = [];
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
  const str = (s) => Buffer.concat([u64(Buffer.byteLength(s)), Buffer.from(s)]);
  const kv = [['general.architecture', 8, str('qwen35')], ['qwen35.block_count', 4, u32(1)], ['qwen35.feed_forward_length', 4, u32(128)], ['qwen35.embedding_length', 4, u32(2)], ['qwen35.full_attention_interval', 4, u32(1)],
    ['tokenizer.ggml.tokens', 9, Buffer.concat([u32(8), u64(3), str('a'), str('b'), str('c')])]];
  parts.push(Buffer.from('GGUF'), u32(3), u64(2), u64(kv.length));
  for (const [k, t, v] of kv) parts.push(str(k), u32(t), v);
  parts.push(str('blk.0.ffn_down.weight'), u32(2), u64(128), u64(2), u32(42), u64(0));
  parts.push(str('blk.0.attn_norm.weight'), u32(1), u64(4), u32(0), u64(96));
  let head = Buffer.concat(parts);
  head = Buffer.concat([head, Buffer.alloc((32 - (head.length % 32)) % 32)]);
  // each block: scale 0x2000 (2^-7) then codes 0,1,2,0 again and again (byte 0x24, low bits first)
  const block = Buffer.concat([Buffer.from([0x00, 0x20]), Buffer.alloc(16, 0x24)]);
  const data = Buffer.concat([block, block, block, block, Buffer.alloc(96 - 72), Buffer.alloc(16)]);
  const blobs = join(dir, 'blobs'), man = join(dir, 'manifests', 'registry.ollama.ai', 'library', 'bonsai-2');
  mkdirSync(blobs, { recursive: true }); mkdirSync(man, { recursive: true });
  writeFileSync(join(blobs, 'sha256-abc'), Buffer.concat([head, data]));
  writeFileSync(join(man, '9b'), JSON.stringify({ layers: [{ mediaType: 'application/vnd.ollama.image.model', digest: 'sha256:abc' }] }));
}

test('Bonsai’s model file: found through Ollama’s manifest, its header read (the tokenizer only counted), a Q2_0 part decoded block by block', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-gguf-'));
  tinyGguf(dir);
  const file = ollamaBlobOf(B, { dir });
  expect(file).toBe(join(dir, 'blobs', 'sha256-abc'));
  expect(ollamaBlobOf('other:1b', { dir })).toBe(null);
  const g = readGguf(file);
  expect(g.version).toBe(3);
  expect(g.kv['tokenizer.ggml.tokens']).toEqual({ list: 3 });
  expect(g.tensors.map((t) => [t.name, t.dims, t.typeName])).toEqual([['blk.0.ffn_down.weight', [128, 2], 'Q2_0'], ['blk.0.attn_norm.weight', [4], 'F32']]);
  expect(modelFacts(g)).toMatchObject({ arch: 'qwen35', layers: 1, ffn: 128, width: 2, full: [0], vocab: 3, tensors: 2, params: 260, byType: { Q2_0: 1, F32: 1 } });
  expect(layerParts(g, 0)).toEqual([{ part: 'ffn_down.weight', shape: '128 × 2', kind: 'Q2_0' }, { part: 'attn_norm.weight', shape: '4', kind: 'F32' }]);
  const p = q2Patch(file, g, 'blk.0.ffn_down.weight', { rows: 5, cols: 70 });
  expect(p.rows).toHaveLength(2); // only the rows it has
  expect(p.rows[0]).toBe('0120'.repeat(18).slice(0, 70));
  expect(p.scales).toEqual([0.0078125, 0.0078125]);
  expect(() => q2Patch(file, g, 'blk.0.attn_norm.weight')).toThrow('stored as F32, not Q2_0');
  expect(halfToFloat(0x3c00)).toBe(1);
});

test('tools a model goes without: kept for it alone, never the ones it cannot work without, and left out of what it is offered', async () => {
  expect(cleanToolsOff(['Ask', 'Read', 'Bash', 'Jobs', 'Ask', 'Nope'])).toEqual(['Ask', 'Jobs']);
  expect(TOOLS_SWITCHABLE).not.toContain('Edit');
  const on = (name) => ({ ...GENERIC_REMOTE, remote: { kind: 'openai', model: name, ollama: '0.40.11' } });
  const settings = { remote: { tuned: { [B]: { toolsOff: ['Ask', 'Read', 'TodoWrite'] } } } };
  const v = readLimits(settings, on(B));
  expect(v.toolsOff).toEqual(['Ask', 'TodoWrite']);
  expect(modelWithLimits(on(B), v).toolsOff).toEqual(['Ask', 'TodoWrite']);
  expect(modelWithLimits(on('tiny:3b'), v).toolsOff).toBe(undefined); // another model given these values does not get them
  const { Agent } = await import('../src/agent/agent.mjs');
  const { systemPrompt } = await import('../src/agent/prompt.mjs');
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-tools-off-'));
  cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
  const names = (m) => new Agent({ url: 'http://127.0.0.1:9', model: m, cwd, system: systemPrompt({ cwd }), verify: false, flows: false }).tools().map((t) => t.function.name);
  const all = names(on(B)), fewer = names(modelWithLimits(on(B), v));
  expect(all).toContain('Ask');
  expect(fewer).not.toContain('Ask');
  expect(fewer).not.toContain('TodoWrite');
  expect(fewer).toContain('Read');
  expect(fewer.length).toBe(all.length - 2);
});

test('Ollama’s controls never act in a test run; its settings read from its environment and written back to one', async () => {
  expect(canAct()).toBe('not in a test run');
  expect(canAct({ NODE_ENV: 'test', AGENTIC_OLLAMA_CONTROL: 'test' })).toBe(null);
  expect(canAct({ AGENTIC_OLLAMA_CONTROL: 'off' })).toContain('switched off');
  await expect(stopOllama()).rejects.toThrow('not in a test run');
  await expect(restartOllama({ flash: true, kv: 'q8_0', ctx: 65536 })).rejects.toThrow('not in a test run');
  await expect(setLogin(true)).rejects.toThrow('not in a test run');
  expect(settingsOf({ OLLAMA_FLASH_ATTENTION: '1', OLLAMA_KV_CACHE_TYPE: 'q8_0', OLLAMA_CONTEXT_LENGTH: '65536' })).toEqual({ flash: true, kv: 'q8_0', ctx: 65536 });
  expect(settingsOf({})).toEqual({ flash: false, kv: 'f16', ctx: 0 });
  expect(envOf({ flash: false, kv: 'q4_0', ctx: 32768 })).toEqual({ OLLAMA_FLASH_ATTENTION: '0', OLLAMA_KV_CACHE_TYPE: 'q4_0', OLLAMA_CONTEXT_LENGTH: '32768' });
  expect(envOf({ flash: true, kv: 'nonsense', ctx: 0 })).toEqual({ OLLAMA_FLASH_ATTENTION: '1', OLLAMA_KV_CACHE_TYPE: 'q8_0' });
});

test('the speed test: a fresh prompt read from the start, then a later step that keeps it; asked at the context it is loaded at, kept', async () => {
  const from = svc.seen.length;
  const r = await speedTest({ url: svc.url, model: B, record: false });
  expect(r).toMatchObject({ model: B, ctx: 65536, readTokS: 209, writeTokS: 27.9, freshTok: 4482, freshSecs: 21.4, writeTok: 120, laterSecs: 4.5 });
  const chats = svc.seen.slice(from).filter((x) => x.path === '/api/chat');
  expect(chats).toHaveLength(2);
  expect(chats[0].body.options.num_ctx).toBe(65536); // never another size: that would load it again
  expect(chats[0].body.think).toBe(false);
  expect(chats[0].body.tools.length).toBeGreaterThan(5);
  expect(chats[0].body.messages[0].content).toMatch(/^Speed test 20\d\d-/); // its own first line: nothing reused
  expect(chats[1].body.messages[0].content).toBe(chats[0].body.messages[0].content);
  expect(readSpeeds().at(-1)).toEqual(r);
});

test('the hub’s Bonsai routes: the whole page, what changes by the second, tools switched off for it, the controls refused here', async () => {
  const was = process.env.AGENTIC_OLLAMA_URL, wasModels = process.env.OLLAMA_MODELS;
  process.env.AGENTIC_OLLAMA_URL = svc.url;
  process.env.OLLAMA_MODELS = mkdtempSync(join(tmpdir(), 'agentic-models-')); // never the Mac's own Ollama folder
  tinyGguf(process.env.OLLAMA_MODELS);
  const r0 = { source: 'machine', kind: 'openai', connect: 'http', address: svc.url, model: B, key: false, contexts: { [B]: 65536 }, tuned: { [B]: { limits: { steps: 120 } } } };
  writeFileSync(join(HOME, 'settings.json'), JSON.stringify({ remote: { ...r0, use: true }, remotes: { machine: r0 } }));
  writeFileSync(join(HOME, 'profiles.json'), JSON.stringify({ profiles: { Bonsai: { server: { kind: 'openai', source: 'machine', address: svc.url }, model: B }, Vision: { server: { kind: 'openai', source: 'openai', address: 'http://10.0.0.5:11434' }, model: 'llava:latest' } }, uses: { 'ai:main': 'Bonsai', 'ai:side': 'Bonsai', 'ai:pictures': 'Vision' } }));
  const { bonsaiHub } = await import('../src/app/bonsai-hub.mjs');
  const h = bonsaiHub({ cwd: HOME });
  const get = async (p) => (await h.route(new Request(`http://127.0.0.1:1${p}`), new URL(`http://127.0.0.1:1${p}`))).json();
  const post = async (p, body, origin) => { const r = await h.route(new Request(`http://127.0.0.1:1${p}`, { method: 'POST', body: JSON.stringify(body), headers: origin ? { origin } : {} }), new URL(`http://127.0.0.1:1${p}`)); return { status: r.status, ...(await r.json()) }; };
  try {
    const d = await get('/bonsai.json');
    expect(d.service).toEqual({ id: 'machine', inUse: true });
    expect(d.ollama).toMatchObject({ running: true, version: '0.40.11' });
    expect(d.live.loaded).toMatchObject({ gpuPct: 100, ctx: 65536 });
    expect(d.ctxOwn).toBe(65536);
    expect(d.own.rows).toEqual({ steps: 120 });
    expect(d.reads.set).toBe('small models (on this Mac)');
    expect(d.reads.tools.find((t) => t.name === 'Read')).toMatchObject({ can: false, on: true });
    expect(d.reads.tools.find((t) => t.name === 'Ask')).toMatchObject({ can: true, on: true });
    expect(d.uses.rows.map((u) => [u.label, u.bonsai])).toEqual([['Main', true], ['Side jobs', true], ['Pictures', false]]);
    expect(d.live.recent.length).toBeGreaterThan(0); // the requests of the tests above
    // tools off: kept for it alone, in both copies of the service, the rest of its own settings kept
    expect((await post('/bonsai/tools', { off: ['Ask', 'Read'] })).said).toContain('Off for Bonsai: Ask.');
    const saved = JSON.parse(readFileSync(join(HOME, 'settings.json'), 'utf8'));
    for (const s of [saved.remote, saved.remotes.machine]) expect(s.tuned[B]).toEqual({ limits: { steps: 120 }, toolsOff: ['Ask'] });
    expect((await get('/bonsai.json')).reads.tools.find((t) => t.name === 'Ask').on).toBe(false);
    await post('/bonsai/tools', { off: [] });
    expect(JSON.parse(readFileSync(join(HOME, 'settings.json'), 'utf8')).remote.tuned[B]).toEqual({ limits: { steps: 120 } });
    // Ollama is never changed from a test; another site cannot press anything
    const rs = await post('/bonsai/restart', { settings: { flash: true, kv: 'q8_0', ctx: 65536 } });
    expect([rs.status, rs.error]).toEqual([409, 'Ollama is not changed here: not in a test run']);
    expect((await post('/bonsai/unload', {}, 'https://example.com')).status).toBe(403);
    // its real weights: a layer's parts and a patch of one, from the file Ollama's manifest names
    const w = await get('/bonsai/weights.json?layer=9&part=ffn_down.weight');
    expect(w).toMatchObject({ layer: 0, part: 'ffn_down.weight', why: null });
    expect(w.patch.rows).toHaveLength(2);
    expect(w.patch.rows[0].slice(0, 8)).toBe('01200120');
    // no model file: said plainly
    process.env.OLLAMA_MODELS = mkdtempSync(join(tmpdir(), 'agentic-no-models-'));
    const r = await bonsaiHub({ cwd: HOME }).route(new Request('http://127.0.0.1:1/bonsai/weights.json'), new URL('http://127.0.0.1:1/bonsai/weights.json'));
    expect([r.status, (await r.json()).error]).toEqual([404, 'Bonsai’s model file was not found in Ollama’s folder']);
    const lv = await get('/bonsai/live.json');
    expect(Object.keys(lv).sort()).toEqual(['at', 'loaded', 'mac', 'now', 'recent', 'speedJob']);
  } finally {
    if (was === undefined) delete process.env.AGENTIC_OLLAMA_URL; else process.env.AGENTIC_OLLAMA_URL = was;
    if (wasModels === undefined) delete process.env.OLLAMA_MODELS; else process.env.OLLAMA_MODELS = wasModels;
  }
});

test('/bonsai: a page command beside /tune, in the / menu on a service, found by its first letters', () => {
  expect(COMMANDS.find((c) => c.name === 'bonsai').desc).toContain('updating live');
  expect(TOOLS_COMMANDS).toContain('bonsai');
  expect([...WHEN_ROOM].slice(0, 3)).toEqual(['jumptomac', 'tune', 'bonsai']);
  expect(matchCommands('/bo', { service: true, room: 18, remote: true }).map((c) => c.name)).toContain('bonsai');
  expect(matchCommands('/', { room: 60 }).map((c) => c.name)).not.toContain('bonsai');
});
