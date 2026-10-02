// The hub's Remote tab (src/app/remote-hub.mjs, remote.html, remote-specialties.mjs):
// the saved services and their models, one model in full, Try it · Load · Unload,
// and what it shows when a service cannot be reached.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { familyNote, workedOut, categoryOf, categoryGroups } from '../src/app/remote-specialties.mjs';
import { countedRight } from '../src/app/remote-hub.mjs';

// A small Ollama: a loaded coder, a thinker, a chat-only model that counts wrong,
// an embedder, and one whose abilities are not listed.
const FAKE = `
  const M = [
    { name: 'qwen3-coder-next:latest', family: 'qwen3next', params: '79.7B', quant: 'Q4_K_M', size: 51.9e9, caps: ['completion', 'tools'], ctx: 262144 },
    { name: 'gpt-oss:120b', family: 'gptoss', params: '116.8B', quant: 'MXFP4', size: 65.4e9, caps: ['completion', 'tools', 'thinking'], ctx: 131072 },
    { name: 'deepseek-coder-v2:latest', family: 'deepseek2', params: '15.7B', quant: 'Q4_0', size: 8.9e9, caps: ['completion'], ctx: 163840, wrong: true },
    { name: 'embeddinggemma:latest', family: 'gemma3', params: '307.58M', quant: 'BF16', size: 0.6e9, caps: ['embedding'], ctx: 2048 },
    { name: 'laguna-xs-2.1:latest', family: 'laguna', params: '', quant: '', size: 4.4e9, caps: null },
  ];
  const loaded = new Set(['qwen3-coder-next:latest']);
  const seen = [];
  const by = (n) => M.find((m) => m.name === n);
  const det = (m) => ({ family: m.family, parameter_size: m.params, quantization_level: m.quant });
  const fake = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const u = new URL(req.url); const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    seen.push({ path: u.pathname, body });
    if (u.pathname === '/api/version') return Response.json({ version: '0.32.12' });
    if (u.pathname === '/api/tags') return Response.json({ models: M.map((m) => ({ name: m.name, size: m.size, digest: 'd-' + m.name, modified_at: '2026-09-28T12:00:00Z', details: det(m) })) });
    if (u.pathname === '/api/ps') return Response.json({ models: [...loaded].map((n) => ({ name: n, size: 58e9, size_vram: 58e9, context_length: 65536, expires_at: new Date(Date.now() + 240000).toISOString(), digest: 'd-' + n })) });
    if (u.pathname === '/api/show') { const m = by(body.model); return m ? Response.json({ details: det(m), parameters: 'stop "<|im_end|>"\\ntemperature 0.7\\ntop_k 20', template: '{{ .Prompt }}', license: 'Apache License 2.0', model_info: { 'general.architecture': m.family, [m.family + '.block_count']: 48, [m.family + '.context_length']: m.ctx, 'tokenizer.ggml.tokens': ['a', 'b'] }, ...(m.caps ? { capabilities: m.caps } : {}) }) : Response.json({ error: 'not found' }, { status: 404 }); }
    if (u.pathname === '/api/generate') { if (body.keep_alive === 0) loaded.delete(body.model); else loaded.add(body.model); return Response.json({ done: true }); }
    if (u.pathname === '/api/chat') { await Bun.sleep(300); const m = by(body.model); loaded.add(m.name); return Response.json({ message: { content: m.wrong ? '1, 2, 3, 4, 5…' : '1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20' }, done: true, total_duration: 1.5e9, load_duration: 1e9, eval_count: 40, eval_duration: 0.5e9 }); }
    return new Response('no', { status: 404 });
  } });
  const SVC = 'http://127.0.0.1:' + fake.port;
`;

// In its own process with its own home: the settings and the test record are read from it.
function inChild(body, { settings = null, record = null } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'agentic-remotehub-'));
  const home = join(base, 'home');
  mkdirSync(join(home, 'tests'), { recursive: true });
  if (record) writeFileSync(join(home, 'tests', 'record.jsonl'), `${record.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const src = (p) => JSON.stringify(join(import.meta.dir, '..', p));
  const script = `
    ${FAKE}
    const { writeFileSync, readFileSync, existsSync } = await import('node:fs');
    const settings = ${JSON.stringify(settings)};
    if (settings) writeFileSync(${JSON.stringify(join(home, 'settings.json'))}, JSON.stringify(settings).replaceAll('SVC', SVC));
    const { startWeightsServer } = await import(${src('src/app/weights.mjs')});
    const s = startWeightsServer({ path: null, docsDir: null, port: 0, cwd: ${JSON.stringify(base)} });
    const base = s.url.replace(/\\/$/, '');
    const get = async (p) => (await fetch(base + p)).json();
    const post = async (p, body, headers = {}) => { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };
    const until = async (fn) => { for (let i = 0; i < 100; i++) { if (await fn()) return true; await Bun.sleep(50); } return false; };
    const home = ${JSON.stringify(home)};
    const out = {};
    ${body}
    s.stop(); fake.stop(true);
    console.log(JSON.stringify(out));
  `;
  const r = spawnSync('bun', ['-e', script], { encoding: 'utf8', env: { ...process.env, AGENTIC_HOME: home, AGENTIC_MEMORY_SAVE: 'off', AGENTIC_REMOTE_KEYSTORE: 'file', ANTHROPIC_API_KEY: '' }, timeout: 30_000 });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

const OLLAMA = { source: 'openai', kind: 'openai', address: 'SVC', connect: 'http', model: 'qwen3-coder-next:latest', key: false, contexts: { 'qwen3-coder-next:latest': 65536 } };
const SAVED = { remote: { ...OLLAMA, use: true }, remotes: { openai: OLLAMA, claude: { source: 'claude', kind: 'claude', connect: 'https', model: 'claude-opus-5-5', key: false } } };

test('nothing saved with /remote: the page says how to connect one, and the hub serves it as its Remote tab', () => {
  const o = inChild(`
    out.data = await get('/remote.json');
    out.page = await (await fetch(base + '/remote')).text();
    out.hub = await (await fetch(base + '/')).text();
  `);
  expect(o.data).toEqual({ services: [], service: null, state: 'none' });
  expect(o.page).toContain('<title>Agentic Coder Remote</title>');
  expect(o.hub).toContain('<button data-tab="remote">Remote</button>');
});

test('an Ollama service: its models by category, biggest first, each with what it is good at; Claude saved without a key is not ready', () => {
  const o = inChild(`out.data = await get('/remote.json');`, { settings: SAVED });
  const d = o.data;
  expect(d.state).toBe('ok');
  expect(d.server).toBe('Ollama 0.32.12');
  expect(d.services.map((s) => [s.id, s.ready, s.inUse])).toEqual([['claude', false, false], ['openai', true, true]]);
  expect(d.services[0].problem).toContain('needs an API key');
  expect(d.services.some((s) => 'profile' in s)).toBe(false); // the saved set-up (and its key) stays on the hub's side
  // By what each is for, biggest first; loaded or not does not move a card.
  expect(d.groups.map((x) => [x.id, x.ids])).toEqual([
    ['coding', ['qwen3-coder-next:latest', 'deepseek-coder-v2:latest']],
    ['thinking', ['gpt-oss:120b']],
    ['helpers', ['embeddinggemma:latest']],
    ['unlisted', ['laguna-xs-2.1:latest']],
  ]);
  expect(d.groups.every((x) => x.ranked)).toBe(true);
  const q = d.models.find((m) => m.id === 'qwen3-coder-next:latest');
  expect(q.loaded).toBe(true);
  expect(q.specialties.note.family).toBe('Qwen 3 Coder (Alibaba)');
  expect(q.specialties.tags.map((t) => t.tag)).toEqual(['Coding', 'Runs the agent', 'Big', 'Long context']);
  expect(d.models.find((m) => m.id === 'laguna-xs-2.1:latest').specialties.note).toBe(null); // no note for a family we do not know
});

test('one model in full: its settings, template, license and build facts (no tokenizer lists), the context the app asks for, and the tests on it', () => {
  const o = inChild(`
    await get('/remote.json');
    out.q = await get('/remote/model.json?service=openai&id=' + encodeURIComponent('qwen3-coder-next:latest'));
    out.g = await get('/remote/model.json?service=openai&id=' + encodeURIComponent('gpt-oss:120b'));
    out.none = await get('/remote/model.json?service=openai&id=nope');
  `, { settings: SAVED, record: [{ id: 'tasks:1', at: '2026-10-01T22:59:00Z', kind: 'tasks', name: 'Big-model mode: off vs on', model: 'remote:qwen3-coder-next:latest', passed: 22, total: 28, secs: 2198, result: 'fail', note: 'off 26 of 28' }, { id: 'tasks:2', at: '2026-10-01T10:00:00Z', kind: 'tasks', name: 'Practice', model: 'qwen', passed: 3, total: 3, secs: 9, result: 'pass' }] });
  expect(o.q.inUse).toBe(true);
  expect(o.q.detail.params).toEqual({ stop: ['<|im_end|>'], temperature: '0.7', top_k: '20' });
  expect(o.q.detail.template).toBe('{{ .Prompt }}');
  expect(o.q.detail.license).toBe('Apache License 2.0');
  expect(o.q.detail.info['qwen3next.block_count']).toBe(48);
  expect('tokenizer.ggml.tokens' in o.q.detail.info).toBe(false);
  expect(o.q.detail.loaded.ctx).toBe(65536);
  expect([o.q.runsAt, o.q.runsAtFrom]).toEqual([65536, 'your /effort setting']);
  expect(o.q.big).toBe(true);
  expect(o.q.runs.map((r) => r.name)).toEqual(['Big-model mode: off vs on']); // only the runs on this model
  expect(o.g.levels.map((l) => l.label)).toEqual(['Low', 'Medium', 'High']); // gpt-oss: three steps
  expect(o.g.runsAt).toBe(32768); // not loaded, no /effort setting: the app's safe start
  expect(o.none.error).toContain('no such model');
});

test('Try it counts to 20 in the background: ✔ kept for the model; a wrong count is ✗; Load and Unload change what is loaded; another site cannot press them', () => {
  const o = inChild(`
    await get('/remote.json');
    out.start = await post('/remote/try', { service: 'openai', id: 'gpt-oss:120b' });
    out.again = await post('/remote/try', { service: 'openai', id: 'gpt-oss:120b' });
    await until(async () => !(await get('/remote.json')).models.find((m) => m.id === 'gpt-oss:120b').busy);
    out.after = (await get('/remote.json')).models.find((m) => m.id === 'gpt-oss:120b');
    out.chat = seen.find((x) => x.path === '/api/chat').body;
    await post('/remote/try', { service: 'openai', id: 'deepseek-coder-v2:latest' });
    await until(async () => !(await get('/remote.json')).models.find((m) => m.id === 'deepseek-coder-v2:latest').busy);
    out.wrong = (await get('/remote.json')).models.find((m) => m.id === 'deepseek-coder-v2:latest').tried;
    out.kept = JSON.parse(readFileSync(home + '/remote-tried.json', 'utf8'));
    await post('/remote/unload', { service: 'openai', id: 'qwen3-coder-next:latest' });
    await until(async () => !(await get('/remote.json')).models.find((m) => m.id === 'qwen3-coder-next:latest').loaded);
    await post('/remote/load', { service: 'openai', id: 'laguna-xs-2.1:latest' });
    await until(async () => (await get('/remote.json')).models.find((m) => m.id === 'laguna-xs-2.1:latest').loaded);
    const now = await get('/remote.json');
    out.loaded = now.models.filter((m) => m.loaded).map((m) => m.id).sort();
    out.foreign = await post('/remote/load', { service: 'openai', id: 'gpt-oss:120b' }, { origin: 'https://example.com' });
    out.unknown = await post('/remote/try', { service: 'openai', id: 'not-there' });
  `, { settings: SAVED });
  expect(o.start).toEqual({ status: 200, ok: true, started: 'try' });
  expect(o.again.status).toBe(409);
  expect(o.after.tried.ok).toBe(true);
  expect(o.after.tried.said).toBe('1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20');
  expect(o.after.tried.tokSecs).toBe(80);
  expect(o.after.tried.loadSecs).toBe(1);
  expect(o.chat.think).toBe('low'); // gpt-oss cannot turn thinking off: its least
  expect(o.wrong.ok).toBe(false);
  expect(Object.keys(o.kept.openai).sort()).toEqual(['deepseek-coder-v2:latest', 'gpt-oss:120b']);
  expect(o.loaded).toEqual(['deepseek-coder-v2:latest', 'gpt-oss:120b', 'laguna-xs-2.1:latest']); // the tries loaded two; qwen was unloaded
  expect(o.foreign.status).toBe(403);
  expect(o.unknown.status).toBe(404);
});

test('a service that stops answering: the list it gave last time, with its time, and the reason in plain words', () => {
  const o = inChild(`
    out.first = await get('/remote.json');
    fake.stop(true); await Bun.sleep(100);
    out.down = await get('/remote.json');
    out.seen = existsSync(home + '/remote-seen/openai.json');
  `, { settings: SAVED });
  expect(o.first.state).toBe('ok');
  expect(o.seen).toBe(true);
  expect(o.down.state).toBe('down');
  expect(o.down.why.length).toBeGreaterThan(10);
  expect(o.down.seenAt).toBeTruthy();
  expect(o.down.models.length).toBe(5);
  expect(o.down.groups.map((g) => g.id)).toEqual(o.first.groups.map((g) => g.id));
});

test('what a model is good at: the narrower family note first, the worked-out tags each with a reason', () => {
  expect(familyNote({ id: 'qwen3-coder:30b' }).family).toBe('Qwen 3 Coder (Alibaba)');
  expect(familyNote({ id: 'qwen3:8b' }).family).toBe('Qwen 3 (Alibaba)');
  expect(familyNote({ id: 'gpt-oss:120b' }).family).toContain('gpt-oss');
  expect(familyNote({ id: 'functiongemma:latest' }).family).toBe('FunctionGemma (Google)');
  expect(familyNote({ id: 'laguna-xs-2.1:latest', family: 'laguna' })).toBe(null);
  expect(workedOut({ id: 'embeddinggemma', embedding: true, known: true, params: '307.58M', ctx: 2048 }).map((t) => t.tag)).toEqual(['Search helper', 'Tiny']);
  expect(workedOut({ id: 'gpt-oss:120b', known: true, chat: true, tools: true, thinking: true, params: '116.8B', ctx: 131072 }).map((t) => t.tag)).toEqual(['Runs the agent', 'Thinks first', 'Big', 'Long context']);
  expect(workedOut({ id: 'phi4', known: true, chat: true, tools: false, params: '14.7B', ctx: 16384 }).map((t) => t.tag)).toEqual(['Chat only']);
  expect(workedOut({ id: 'laguna-xs-2.1', known: false, chat: true, tools: true }).map((t) => t.tag)).toEqual([]); // nothing listed: nothing claimed
});

test('Try it is right only when all twenty numbers come back in order', () => {
  expect(countedRight('1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20')).toBe(true);
  expect(countedRight('1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20.')).toBe(true);
  expect(countedRight('1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n16\n17\n18\n19\n20')).toBe(true);
  expect(countedRight('1 2 3 4 5 … 20')).toBe(false);
  expect(countedRight('')).toBe(false);
});

test('the categories: helpers and unlisted first, then coding, thinking, pictures, general; each biggest first', () => {
  expect(categoryOf({ id: 'functiongemma:latest', known: true, tools: true, params: '268.10M' })).toBe('helpers');
  expect(categoryOf({ id: 'embeddinggemma:latest', embedding: true, params: '307.58M' })).toBe('helpers');
  expect(categoryOf({ id: 'laguna-xs-2.1:latest', known: false })).toBe('unlisted');
  expect(categoryOf({ id: 'qwen3-coder:30b', known: true, tools: true, thinking: true })).toBe('coding'); // coding wins over thinking
  expect(categoryOf({ id: 'gpt-oss:120b', known: true, thinking: true })).toBe('thinking');
  expect(categoryOf({ id: 'llama4:latest', known: true, vision: true, tools: true })).toBe('pictures');
  expect(categoryOf({ id: 'phi4:latest', known: true, params: '14.7B' })).toBe('general');
  const g = categoryGroups([
    { id: 'qwen2.5-coder:14b', known: true, params: '14.8B' }, { id: 'qwen2.5-coder:32b', known: true, params: '32.8B' },
    { id: 'qwen3-coder-next:latest', known: true, params: '79.7B' }, { id: 'laguna-s', known: false, bytes: 14e9 }, { id: 'laguna-xs', known: false, bytes: 4e9 },
  ]);
  expect(g.map((x) => [x.id, x.ids])).toEqual([['coding', ['qwen3-coder-next:latest', 'qwen2.5-coder:32b', 'qwen2.5-coder:14b']], ['unlisted', ['laguna-s', 'laguna-xs']]]);
  expect(g.find((x) => x.id === 'unlisted').fold).toBe(true);
});
