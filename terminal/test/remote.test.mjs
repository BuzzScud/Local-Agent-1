// A model on another machine, from the terminal's side: every call carries the
// remote's key; an OpenAI-compatible remote gets only the standard fields (and
// a field it refuses is left out after); the /remote form's rows, editing and
// what it saves (remote-form.mjs). The app itself: app-remote.test.mjs.
import { test, expect } from 'bun:test';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';

// A throwaway home before the models part is loaded (it reads AGENTIC_HOME once): nothing here reaches the real ~/.agentic-coder.
process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-remote-home-'));
process.env.AGENTIC_REMOTE_KEYSTORE = 'file';
const { streamChat, openaiBody, refusedField } = await import('../src/agent/client.mjs');
const { decide, complete } = await import('../src/flows/llm.mjs');
const { setEndpoint, dropEndpoint, MODELS, GENERIC_REMOTE, DEFAULT_REMOTE, HOME } = await import('../../models/index.mjs');
const { openForm, rowsOf, moveRow, startEdit, editField, pasteField, commitEdit, toProfile, formWarning, connectionChanged, showValue, rowNote, rowChanged, modelChoices, savePlan, remotesOf, remoteChoices, withTest, openModelPick, movePick, commitPick, closePick } = await import('../src/app/remote-form.mjs');
test('the tests run in a throwaway home', () => { expect(HOME).not.toBe(join(homedir(), '.agentic-coder')); });

const drain = async (it) => { const out = []; for await (const ev of it) out.push(ev); return out; };

test('a remote llama.cpp gets the same body as this Mac’s, with its key in the header', async () => {
  const fake = await startFakeServer([{ text: 'hi' }], { key: 'test-remote-0123456789' });
  setEndpoint(fake.url, { remote: true, kind: 'llama', key: 'test-remote-0123456789', model: 'x.gguf', label: 'box' });
  try {
    const evs = await drain(streamChat({ url: fake.url, messages: [{ role: 'user', content: 'hi' }], model: MODELS.gemma, sampling: MODELS.gemma.sampling, thinking: false, maxTokens: 50, slot: 1 }));
    expect(evs.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('hi');
    const body = fake.requests.at(-1);
    expect(body).toMatchObject({ model: 'coding', cache_prompt: true, id_slot: 1, top_k: 64, chat_template_kwargs: { enable_thinking: false } });
    expect(fake.seen.at(-1).auth).toBe('Bearer test-remote-0123456789');
  } finally { dropEndpoint(fake.url); await fake.close(); }
});

test('an OpenAI-compatible remote: its model name, the standard fields only, the effort as reasoning_effort, thinking read from "reasoning"', async () => {
  const seen = [];
  const s = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    seen.push({ body: JSON.parse(b), auth: req.headers.authorization });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'thinking…' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${s.address().port}`;
  setEndpoint(url, { remote: true, kind: 'openai', key: 'test-hosted-0123456789', model: 'vendor/model-x', label: 'hosted' });
  try {
    const evs = await drain(streamChat({ url, messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function', function: { name: 'Read', parameters: {} } }], model: GENERIC_REMOTE, sampling: { temperature: 0.2, top_k: 20, min_p: 0 }, thinking: true, effort: 'high', thinkCap: 500, maxTokens: 50, slot: 0 }));
    expect(evs.map((e) => e.type)).toEqual(['reasoning', 'text', 'done']);
    const { body, auth } = seen[0];
    expect(auth).toBe('Bearer test-hosted-0123456789');
    expect(body).toMatchObject({ model: 'vendor/model-x', stream: true, max_tokens: 50, temperature: 0.2, reasoning_effort: 'high', tool_choice: 'auto', parallel_tool_calls: false });
    for (const k of ['cache_prompt', 'id_slot', 'chat_template_kwargs', 'thinking_budget_tokens', 'top_k', 'min_p']) expect(k in body).toBe(false);
  } finally { dropEndpoint(url); s.close(); }
});

test('a field the server refuses (named in its 400) is left out, then and for every call after; max_tokens becomes max_completion_tokens when asked', async () => {
  const bodies = [];
  const s = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const body = JSON.parse(b);
    bodies.push(body);
    if ('reasoning_effort' in body) { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":{"message":"Unsupported parameter: \'reasoning_effort\' is not supported with this model."}}'); return; }
    if ('max_tokens' in body) { res.writeHead(400); res.end('{"error":{"message":"Unsupported parameter: \'max_tokens\'. Use \'max_completion_tokens\' instead."}}'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'fine' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${s.address().port}`;
  setEndpoint(url, { remote: true, kind: 'openai', key: null, model: 'm' });
  try {
    const one = await drain(streamChat({ url, messages: [], model: GENERIC_REMOTE, sampling: {}, thinking: true, effort: 'high', maxTokens: 9 }));
    expect(one.find((e) => e.type === 'text').text).toBe('fine');
    expect(bodies.length).toBe(3);
    expect(bodies[2]).toMatchObject({ max_completion_tokens: 9 });
    expect('reasoning_effort' in bodies[2] || 'max_tokens' in bodies[2]).toBe(false);
    await drain(streamChat({ url, messages: [], model: GENERIC_REMOTE, sampling: {}, thinking: true, effort: 'high', maxTokens: 9 }));
    expect(bodies.length).toBe(4); // remembered: right the first time
  } finally { dropEndpoint(url); s.close(); }
  expect(refusedField(500, 'reasoning_effort', { reasoning_effort: 'high' })).toBe(null);
  expect(refusedField(400, 'model not found', { reasoning_effort: 'high' })).toBe(null);
  expect(openaiBody({ model: 'coding', cache_prompt: true, top_k: 5, temperature: 1 }, { model: 'm' })).toEqual({ model: 'm', temperature: 1 });
});

test('Ollama names the ability it lacks, not the field: "does not support thinking" leaves out reasoning_effort, "does not support tools" the tools; each model remembers its own', async () => {
  const bodies = [];
  // As Ollama 0.32 answers (1 Oct 2026): thinking refused by plain-tools, tools refused by chat-only, both taken by thinker.
  const s = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const body = JSON.parse(b);
    bodies.push(body);
    const no = (what) => { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: what, type: 'invalid_request_error' } })); };
    if (body.model === 'plain-tools' && body.reasoning_effort) return no('"plain-tools" does not support thinking');
    if (body.model === 'chat-only' && body.tools) return no('registry.ollama.ai/library/chat-only:latest does not support tools');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: body.model }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${s.address().port}`;
  const tools = [{ type: 'function', function: { name: 'Read', parameters: {} } }];
  const ask = async (model) => {
    setEndpoint(url, { remote: true, kind: 'openai', key: null, model, label: 'svc' });
    return (await drain(streamChat({ url, messages: [{ role: 'user', content: 'hi' }], tools, model: GENERIC_REMOTE, sampling: {}, thinking: true, effort: 'high', maxTokens: 9 }))).find((e) => e.type === 'text')?.text;
  };
  try {
    expect(await ask('plain-tools')).toBe('plain-tools');
    expect(bodies.slice(-2).map((x) => 'reasoning_effort' in x)).toEqual([true, false]);
    expect(await ask('chat-only')).toBe('chat-only');
    const [asked, again] = bodies.slice(-2);
    expect(['tools' in asked, 'tools' in again, 'tool_choice' in again, 'parallel_tool_calls' in again]).toEqual([true, false, false, false]);
    // another model at the same address still thinks and gets its tools: refusals are kept per model
    expect(await ask('thinker')).toBe('thinker');
    expect(bodies.at(-1)).toMatchObject({ model: 'thinker', reasoning_effort: 'high' });
    expect('tools' in bodies.at(-1)).toBe(true);
    const n = bodies.length;
    expect(await ask('plain-tools')).toBe('plain-tools');
    expect(bodies.length).toBe(n + 1); // remembered: right the first time
  } finally { dropEndpoint(url); s.close(); }
  // a 400 about one tool (its name, say) never takes the tools away
  expect(refusedField(400, "Invalid 'tools[0].function.name': string does not match pattern", { tools: [{}] })).toBe(null);
  expect(refusedField(400, '"x" does not support thinking', { tools: [{}] })).toBe(null); // nothing of it was sent
});

test('a model whose only level is Low (it cannot think) is sent no reasoning_effort, whatever effort was chosen for the others', async () => {
  const seen = [];
  const s = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    seen.push(JSON.parse(b));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${s.address().port}`;
  setEndpoint(url, { remote: true, kind: 'openai', key: null, model: 'tiny:3b', label: 'svc' });
  const lowOnly = { ...GENERIC_REMOTE, thinkingLevels: [GENERIC_REMOTE.thinkingLevels[0]], thinkingEffort: 'low' };
  try {
    await drain(streamChat({ url, messages: [], model: lowOnly, sampling: {}, thinking: true, effort: 'high', maxTokens: 9 }));
    expect('reasoning_effort' in seen[0]).toBe(false);
    await drain(streamChat({ url, messages: [], model: GENERIC_REMOTE, sampling: {}, thinking: true, effort: 'high', maxTokens: 9 }));
    expect(seen[1].reasoning_effort).toBe('high');
  } finally { dropEndpoint(url); s.close(); }
});

// An Ollama service's own chat (/api/chat), as Ollama 0.32 streams it: one JSON object a line,
// the thinking and the text in `message`, a tool call whole, the counts in the last line.
// reply(body) → { lines } (each an object), or { status, error } for a refusal.
function fakeOllamaChat(reply) {
  const bodies = [];
  const s = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const body = JSON.parse(b);
    bodies.push(body);
    const r = reply(body, bodies.length);
    if (r.status) { res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: r.error })); return; }
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.end(r.lines.map((l) => JSON.stringify(l)).join('\n'));
  });
  return new Promise((ok) => s.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${s.address().port}`, bodies, close: () => new Promise((d) => s.close(d)) })));
}
const done = (o = {}) => ({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 900, prompt_eval_duration: 2e9, eval_count: 40, eval_duration: 1e9, ...o });

test('an Ollama service is asked in its own chat: the context with every request, thinking as think, its tools only, the counts and speeds from the last line', async () => {
  const f = await fakeOllamaChat(() => ({ lines: [
    { message: { role: 'assistant', content: '', thinking: 'Look at the file.' }, done: false },
    { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'Read', arguments: { path: 'a.mjs' } } }] }, done: false },
    done(),
  ] }));
  const tools = [{ type: 'function', function: { name: 'Read', parameters: {} } }];
  const thinker = { ...GENERIC_REMOTE }; // Low and High
  try {
    setEndpoint(f.url, { remote: true, kind: 'openai', key: 'test-svc-0123456789', model: 'thinker:35b', label: 'svc', ollama: true, numCtx: 65536, thinks: true, tools: true, family: 'qwen35moe' });
    const evs = await drain(streamChat({ url: f.url, messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'read a.mjs' }], tools, model: thinker, sampling: { temperature: 0.6, top_k: 20, other: 1 }, thinking: true, effort: 'high', maxTokens: 2048, extra: { stop: ['</x>'] } }));
    expect(evs.map((e) => e.type)).toEqual(['reasoning', 'tool', 'done']);
    expect(evs[1]).toMatchObject({ index: 0, name: 'Read', args: '{"path":"a.mjs"}' });
    expect(evs[2]).toMatchObject({ finish: 'tool_calls', usage: { prompt_tokens: 900, completion_tokens: 40 }, timings: { prompt_n: 900, prompt_per_second: 450, predicted_n: 40, predicted_per_second: 40 } });
    const b = f.bodies[0];
    expect(b).toMatchObject({ model: 'thinker:35b', stream: true, think: true, tools, options: { num_ctx: 65536, num_predict: 2048, temperature: 0.6, top_k: 20, stop: ['</x>'] } });
    expect('other' in b.options).toBe(false);
    // Low on a model that thinks: told not to (else Qwen thinks anyway)
    await drain(streamChat({ url: f.url, messages: [], model: thinker, sampling: {}, thinking: false, maxTokens: 9 }));
    expect(f.bodies.at(-1).think).toBe(false);
    // a model that cannot think is not told either way; one that cannot use tools gets none; toolChoice none: none
    setEndpoint(f.url, { remote: true, kind: 'openai', key: null, model: 'oldchat:14b', label: 'svc', ollama: true, numCtx: null, thinks: false, tools: false, family: 'phi3' });
    await drain(streamChat({ url: f.url, messages: [], tools, model: { ...GENERIC_REMOTE, thinkingLevels: [GENERIC_REMOTE.thinkingLevels[0]], thinkingEffort: 'low' }, sampling: {}, thinking: true, effort: 'high', maxTokens: 9 }));
    const plain = f.bodies.at(-1);
    expect(['think' in plain, 'tools' in plain, 'num_ctx' in plain.options]).toEqual([false, false, false]);
    // gpt-oss cannot turn its thinking off: Low is its least, the others its own level
    setEndpoint(f.url, { remote: true, kind: 'openai', key: null, model: 'gpt-oss:120b', label: 'svc', ollama: true, numCtx: null, thinks: true, tools: true, family: 'gptoss' });
    const oss = { ...GENERIC_REMOTE, thinkingLevels: [{ id: 'low', effort: null }, { id: 'medium', effort: 'medium' }, { id: 'high', effort: 'high' }], thinkingEffort: 'high' };
    await drain(streamChat({ url: f.url, messages: [], model: oss, sampling: {}, thinking: true, effort: 'medium', maxTokens: 9 }));
    await drain(streamChat({ url: f.url, messages: [], model: oss, sampling: {}, thinking: false, maxTokens: 9 }));
    expect(f.bodies.slice(-2).map((x) => x.think)).toEqual(['medium', 'low']);
    // a JSON answer asked for: Ollama's format
    await drain(streamChat({ url: f.url, messages: [], model: oss, sampling: {}, thinking: false, maxTokens: 9, extra: { response_format: { type: 'json_schema', json_schema: { name: 'answer', schema: { type: 'object' } } } } }));
    expect(f.bodies.at(-1).format).toEqual({ type: 'object' });
  } finally { dropEndpoint(f.url); await f.close(); }
});

test('the conversation in Ollama’s form: a tool call’s arguments as an object, its result named by its tool, the thinking kept, pictures as base64 (a tool result’s after it)', async () => {
  const { ollamaMessages } = await import('../src/agent/images.mjs');
  const pic = { path: '/tmp/a.png', mime: 'image/png', data: 'AAAA', w: 10, h: 10 };
  const out = ollamaMessages([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'look', images: [pic] },
    { role: 'assistant', content: '', reasoning_content: 'hmm', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: '{"path":"b.png"}' } }], keep: true },
    { role: 'tool', tool_call_id: 'c1', content: 'a picture', images: [{ ...pic, data: 'BBBB' }] },
    { role: 'assistant', content: 'done', tool_calls: [{ id: 'c2', function: { name: 'Bash', arguments: 'not json' } }] },
  ]);
  expect(out).toEqual([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'look', images: ['AAAA'] },
    { role: 'assistant', content: '', thinking: 'hmm', tool_calls: [{ function: { name: 'Read', arguments: { path: 'b.png' } } }] },
    { role: 'tool', content: 'a picture', tool_name: 'Read' },
    { role: 'user', content: '(The picture that result showed.)', images: ['BBBB'] },
    { role: 'assistant', content: 'done', tool_calls: [{ function: { name: 'Bash', arguments: {} } }] },
  ]);
});

test('Ollama’s refusals: a model too old to list its abilities is asked again without tools; out of GPU memory is said plainly; an error answer carries its status', async () => {
  const f = await fakeOllamaChat((body, n) => {
    if (body.model === 'old:7b' && body.tools) return { status: 400, error: 'registry.ollama.ai/library/old:7b does not support tools' };
    if (body.model === 'huge:120b') return { status: 500, error: 'llama-server process has terminated: exit status 1: cudaMalloc failed: out of memory\nalloc_tensor_range: failed to allocate ROCm0 buffer of size 74995960832' };
    if (body.model === 'down:1b') return { status: 500, error: 'llama-server process has terminated: exit status 2' };
    return { lines: [{ message: { role: 'assistant', content: `ok ${n}` }, done: false }, done()] };
  });
  const tools = [{ type: 'function', function: { name: 'Read', parameters: {} } }];
  const ask = (model) => {
    setEndpoint(f.url, { remote: true, kind: 'openai', key: null, model, label: 'svc', ollama: true, numCtx: null, thinks: false, tools: true, family: 'llama' });
    return drain(streamChat({ url: f.url, messages: [], tools, model: GENERIC_REMOTE, sampling: {}, thinking: false, maxTokens: 9 }));
  };
  try {
    expect((await ask('old:7b')).find((e) => e.type === 'text').text).toBe('ok 2');
    expect(f.bodies.slice(-2).map((b) => 'tools' in b)).toEqual([true, false]);
    await ask('old:7b');
    expect('tools' in f.bodies.at(-1)).toBe(false); // remembered for that model
    const oom = await ask('huge:120b').catch((e) => e);
    expect(oom.message).toBe('the service has no room to load huge:120b (out of GPU memory): /model picks another, or /effort a smaller Context');
    expect(oom.status).toBe(500);
    // "terminated" in a server's answer is an answer, not a dropped connection: it carries its status
    const down = await ask('down:1b').catch((e) => e);
    expect(down.message).toMatch(/^remote model server \(svc\) 500: /);
    expect(down.status).toBe(500);
  } finally { dropEndpoint(f.url); await f.close(); }
});

test('a key the remote does not take: the error says so and points to /remote', async () => {
  const fake = await startFakeServer([], { key: 'test-right-0123456789' });
  setEndpoint(fake.url, { remote: true, kind: 'llama', key: 'test-wrong-0123456789', label: 'box' });
  try {
    await expect(drain(streamChat({ url: fake.url, messages: [], model: MODELS.gemma, sampling: {}, maxTokens: 5 }))).rejects.toThrow('the remote model (box) did not accept the API key (401); change it in /remote');
  } finally { dropEndpoint(fake.url); await fake.close(); }
});

test('a quick pick is not tried on an OpenAI-compatible remote (no template, tokens or chances there): the caller asks the usual way', async () => {
  const fake = await startFakeServer([{ text: '{"kind":"b"}' }]);
  setEndpoint(fake.url, { remote: true, kind: 'openai', key: 'k-0123456789ab', model: 'm' });
  try {
    expect(await decide({ url: fake.url, model: GENERIC_REMOTE, system: 's', user: 'u', options: ['a', 'b'] })).toBe(null);
    expect(fake.seen.length).toBe(0);
    const r = await complete({ url: fake.url, model: GENERIC_REMOTE, system: 's', user: 'u', maxTokens: 20 });
    expect(r.text).toBe('{"kind":"b"}');
    expect(fake.seen.at(-1).auth).toBe('Bearer k-0123456789ab');
  } finally { dropEndpoint(fake.url); await fake.close(); }
});

// ---- the form ----------------------------------------------------------------------------------

const labels = (f) => rowsOf(f).map((r) => r.label);
const at = (f, id) => ({ ...f, index: rowsOf(f).findIndex((r) => r.id === id) });

test('the form opens on This Mac with only Run on and Switch; → walks the services, each with only its rows, and More opens the rest', () => {
  let f = openForm({});
  expect(labels(f)).toEqual(['Run on', 'Switch']);
  expect([showValue(f, 'source'), showValue(f, 'go')]).toEqual(['This Mac', 'in use now']);
  expect(moveRow(f, 'source', -1)).toBe(f); // stops at the end
  f = moveRow(f, 'source', 1);
  expect(showValue(f, 'source')).toBe('Claude API');
  expect(labels(f)).toEqual(['Run on', 'API key', 'Model', 'More', 'Connect', 'Save only']);
  expect([showValue(f, 'model'), showValue(f, 'key')]).toEqual(['Opus 5.5', 'none']);
  expect(rowNote(f, 'more')).toBe('address, context');
  f = moveRow(f, 'more', 1);
  expect(labels(f)).toEqual(['Run on', 'API key', 'Model', 'More', 'Address', 'Context', 'Connect', 'Save only']);
  expect(showValue(f, 'address')).toBe('api.anthropic.com');
  f = moveRow(f, 'source', 1);
  expect(showValue(f, 'source')).toBe('My other computer');
  expect(f.more).toBe(false); // another service: More folded again
  expect(labels(f)).toEqual(['Run on', 'Address', 'Reach by', 'API key', 'More', 'Connect', 'Save only']);
  expect(rowNote(f, 'more')).toBe('port, server, model, context');
  f = moveRow(moveRow(f, 'connect', 1), 'connect', 1);
  expect(showValue(f, 'connect')).toBe('SSH tunnel');
  expect(rowNote(f, 'address')).toBe('user@host, or a name from ~/.ssh/config');
  f = moveRow(f, 'source', 1);
  expect(showValue(f, 'source')).toBe('Another service');
  expect(labels(f)).toEqual(['Run on', 'Address', 'API key', 'Model', 'More', 'Connect', 'Save only']);
  // nothing typed yet: no "Not ready" until a Connect was tried
  expect(formWarning(f)).toBe(null);
  expect(formWarning({ ...f, tried: true })).toEqual({ tone: 'error', text: 'Not ready: it has no address yet.' });
});

test('each service keeps its own rows: flipping Run on loses nothing typed; the Claude Model row steps through its list, and any other the key lists', () => {
  let f = moveRow(moveRow(openForm({}), 'source', 1), 'source', 1); // My other computer
  f = commitEdit({ ...startEdit(at(f, 'address'), 'address'), editing: { id: 'address', value: '192.168.1.40', cursor: 12 } });
  expect(f.index).toBe(rowsOf(f).findIndex((r) => r.id === 'connect')); // enter keeps it and goes to the next row
  f = moveRow(f, 'source', -1); // Claude API
  f = commitEdit({ ...startEdit(at(f, 'key'), 'key'), editing: { id: 'key', value: 'test-claude-0123456789wxyz', cursor: 26 } });
  expect(showValue(f, 'key')).toBe('••••••••wxyz');
  expect(rowChanged(f, 'key')).toBe(true);
  expect(modelChoices(f)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-haiku-4-5']);
  f = moveRow(f, 'model', 1);
  expect([showValue(f, 'model'), rowNote(f, 'model')]).toEqual(['Sonnet 5.5', 'quicker, half the price · $2 / $10']);
  f = moveRow(moveRow(moveRow(f, 'model', 1), 'model', 1), 'model', 1);
  expect(showValue(f, 'model')).toBe('Haiku 4.5'); // stops at the end
  f = withTest(f, { ok: false, steps: [], models: ['claude-opus-4-8', 'claude-haiku-4-5'] }, 1);
  expect(modelChoices(f).at(-1)).toBe('claude-opus-4-8');
  expect(showValue(moveRow(f, 'model', 1), 'model')).toBe('claude-opus-4-8');
  f = moveRow(f, 'source', 1); // back to the computer: its address is still there, the Claude key still waits
  expect(showValue(f, 'address')).toBe('192.168.1.40');
  expect(f.keys.claude).toBe('test-claude-0123456789wxyz');
  // an OpenAI-compatible server with one model, none named: that one
  let o = moveRow(f, 'source', 1);
  o = withTest(o, { ok: true, steps: [], models: ['only-one'] }, 2);
  expect(showValue(o, 'model')).toBe('only-one');
  // several models, Connect picked one: the Model row takes that name
  o = withTest(moveRow(f, 'source', 1), { ok: true, steps: [], models: ['llava:latest', 'coder:7b'], model: 'coder:7b' }, 2);
  expect(showValue(o, 'model')).toBe('coder:7b');
  // several models and none named: the list opens on a coder; enter takes it; down then enter takes the next
  let p = withTest(moveRow(f, 'source', 1), { ok: false, needModel: true, steps: [], models: ['llava:latest', 'coder:7b', 'tiny:3b'] }, 3);
  p = openModelPick(p, p.test.models);
  expect(p.pick.models).toEqual(['llava:latest', 'coder:7b', 'tiny:3b']);
  expect(p.pick.models[p.pick.index]).toBe('coder:7b');
  expect(p.pick.suggested).toBe('coder:7b');
  expect(showValue(commitPick(p), 'model')).toBe('coder:7b');
  expect(commitPick(p).pick).toBe(null);
  expect(showValue(commitPick(movePick(p, 1)), 'model')).toBe('tiny:3b');
  expect(closePick(p).pick).toBe(null);
  expect(showValue(closePick(p), 'go')).toBe('pick a model');
  expect(rowNote(p, 'model')).toMatch(/enter opens the list · ←→ picks one of the 3 it has/);
});

test('editing a row: typed and pasted text at the cursor; a key loses its spaces and breaks, a port keeps its digits; a whole https address sets Reach by', () => {
  let f = moveRow(moveRow(moveRow(openForm({}), 'source', 1), 'source', 1), 'source', 1); // Another service
  f = startEdit(at(f, 'address'), 'address');
  for (const ch of 'gpu.example') f = { ...f, editing: editField(f.editing, ch, {}) };
  f = { ...f, editing: editField(f.editing, '', { backspace: true }) };
  f = { ...f, editing: editField(f.editing, '', { leftArrow: true }) };
  f = { ...f, editing: editField(f.editing, 'X', {}) };
  expect(f.editing).toMatchObject({ value: 'gpu.exampXl', cursor: 10 });
  f = { ...f, editing: editField(f.editing, 'u', { ctrl: true }) };
  expect(f.editing.value).toBe('l');
  f = { ...f, editing: pasteField({ id: 'address', value: '', cursor: 0 }, 'http://192.168.1.9:11434\n') };
  f = commitEdit(f);
  expect(f.profiles.openai).toMatchObject({ address: 'http://192.168.1.9:11434', connect: 'http' });
  expect(rowNote(f, 'more')).toBe('reach by Home network (http)'); // a row behind More that differs is named on it
  const k = pasteField({ id: 'key', value: '', cursor: 0 }, '  sk-abc\n def  ');
  expect(k.value).toBe('sk-abcdef');
  expect(pasteField({ id: 'port', value: '', cursor: 0 }, ' 90a80 ').value).toBe('9080');
  // the key starts empty; enter on an empty key = no key
  let g = openForm({ remote: { use: true, address: '10.0.0.5', kind: 'llama', key: true, keyEnd: 'abcd' } }, { on: true });
  expect(showValue(g, 'source')).toBe('My other computer');
  g = commitEdit(startEdit(at(g, 'key'), 'key'));
  expect(g.keys.machine).toBe('');
  expect(showValue(g, 'key')).toBe('none');
  expect(toProfile(g)).toMatchObject({ key: false, keyEnd: '' });
  // /web's form (one set of values, one key) edits the same way, the cursor staying on its row
  const w = commitEdit({ ...startEdit({ values: { search: 'brave' }, key: null, index: 1 }, 'key'), editing: { id: 'key', value: 'test-brave-0123', cursor: 15 } });
  expect(w).toMatchObject({ key: 'test-brave-0123', index: 1, editing: null });
});

test('a remote saved before Run on opens as its service, its key under the old name; Connect with a new key saves it under the service and lets the old name go', () => {
  const old = { use: true, address: '10.0.0.5', port: null, connect: 'http', kind: 'llama', model: '', context: 0, key: true, keyEnd: '3f9a' };
  expect(remotesOf({ remote: old }).machine).toMatchObject({ source: 'machine', address: '10.0.0.5', key: true });
  expect(remotesOf({ remote: old }).claude).toBe(null);
  let f = openForm({ remote: old }, { on: true });
  expect([showValue(f, 'source'), showValue(f, 'key')]).toEqual(['My other computer', '••••••••3f9a']);
  expect(toProfile(f).keyId).toBe('default'); // still found where it was
  // Save only, nothing changed: the computer kept as it was, still in use
  let plan = savePlan(f, { remote: old });
  expect(plan.keys).toEqual([]);
  expect(plan.remote).toMatchObject({ source: 'machine', address: '10.0.0.5', use: true, keyId: 'default' });
  // a new key for it, and Connect: saved under "machine", the old entry removed
  f = commitEdit({ ...startEdit(at(f, 'key'), 'key'), editing: { id: 'key', value: 'test-new-0123456789abcd', cursor: 23 } });
  plan = savePlan(f, { remote: old }, { connect: true });
  expect(plan.keys).toEqual([{ op: 'save', id: 'machine', key: 'test-new-0123456789abcd', source: 'machine' }, { op: 'remove', id: 'default' }]);
  expect(plan.remotes.machine).toMatchObject({ keyId: 'machine', keyEnd: 'abcd' });
  expect(JSON.stringify(plan.remotes) + JSON.stringify(plan.remote)).not.toContain('test-new');
});

test('Connect and Save only: what is kept, and which remote is in use next', () => {
  const machine = { source: 'machine', address: '10.0.0.5', port: null, connect: 'http', kind: 'llama', model: '', context: 0, key: false, keyEnd: '', keyId: 'machine' };
  const settings = { remote: { ...machine, use: true }, remotes: { machine } };
  let f = moveRow(openForm(settings, { on: true }), 'source', -1); // Claude API, from the computer in use
  f = commitEdit({ ...startEdit(at(f, 'key'), 'key'), editing: { id: 'key', value: 'test-claude-0123456789wxyz', cursor: 26 } });
  // Save only: the Claude API kept with its key; the window stays on the computer
  let plan = savePlan(f, settings);
  expect(plan.remotes.claude).toMatchObject({ source: 'claude', kind: 'claude', model: 'claude-opus-5-5', key: true, keyEnd: 'wxyz', keyId: 'claude' });
  expect(plan.remotes.machine).toEqual(machine);
  expect(plan.remote).toEqual({ ...machine, use: true });
  expect(rowNote(f, 'keep')).toBe('keeps it · this window stays on My other computer');
  // Connect: the Claude API in use next
  plan = savePlan(f, settings, { connect: true });
  expect(plan.remote).toMatchObject({ source: 'claude', use: true, key: true });
  expect(connectionChanged(settings.remote, plan.remote, true)).toBe(true);
  // This Mac + Switch: the remotes kept, the last one off
  plan = savePlan(moveRow(f, 'source', -1), settings, { connect: true });
  expect(plan.remote).toMatchObject({ source: 'machine', use: false });
  expect(Object.keys(plan.remotes).sort()).toEqual(['claude', 'machine']);
  // Save only with no remote on: the one saved becomes the one /remote on finds
  plan = savePlan(f, { remotes: { machine } });
  expect(plan.remote).toMatchObject({ source: 'claude', use: false });
  // /model's rows: each service ready to switch to
  expect(remoteChoices({ remotes: { machine, claude: plan.remotes.claude, openai: { source: 'openai', kind: 'openai', address: '' } } }).map((r) => r.name)).toEqual(['Claude API · Opus 5.5', 'My other computer · 10.0.0.5']);
});

test('a Claude key: its ID (apikey_…) pasted for the key stops Connect and says where the real one is; another kind of key is worth a word; a proxy’s keys are its own', () => {
  const claude = (key, address = '') => {
    const f = { ...moveRow(openForm({}), 'source', 1), keys: { claude: key, machine: null, openai: null } };
    return address ? { ...f, profiles: { ...f.profiles, claude: { ...f.profiles.claude, address } } } : f;
  };
  expect(formWarning(claude('apikey_01TestTestTestTestTestAMMp'))).toEqual({ tone: 'error', text: 'That is the key’s ID (apikey_…), not the key. Make a key in console.anthropic.com → API keys and copy the sk-ant-… it shows once.' });
  expect(formWarning(claude('test-other-0123456789'))).toEqual({ tone: 'warn', text: 'A Claude API key starts with sk-ant-, and this one does not.' });
  expect(formWarning(claude(['sk', 'ant', 'api03', 'x'.repeat(24)].join('-')))).toBe(null); // the real shape (built here, so no key-like text sits in the file)
  expect(formWarning(claude('apikey_01TestTestTestTestTestAMMp', 'http://127.0.0.1:9000'))).toBe(null); // a proxy's address: its own keys
  expect(formWarning(claude(null))).toBe(null); // no key typed: nothing to say before Connect
});

test('the warning under the form: a key with a space; Claude needs no address; open http is not warned', () => {
  const on = (r) => openForm({ remote: { use: true, ...r } }, { on: true });
  expect(formWarning({ ...on({ kind: 'claude', key: true }), tried: true })).toBe(null);
  expect(formWarning(on({ address: '203.0.113.9' }))).toBe(null);
  expect(formWarning(on({ address: '203.0.113.9', key: true }))).toBe(null);
  expect(formWarning(on({ address: '192.168.1.40' }))).toBe(null);
  expect(formWarning({ ...on({ address: '10.0.0.5' }), keys: { claude: null, machine: 'has space', openai: null } }).tone).toBe('error');
});

test('the agent connects again only when the connection broke: a server that answers with an error (its words saying "terminated") is not reconnected to', async () => {
  const { Agent } = await import('../src/agent/agent.mjs');
  const { systemPrompt } = await import('../src/agent/prompt.mjs');
  const { cpSync } = await import('node:fs');
  let mode = 'answer';
  const s = createServer(async (req, res) => {
    for await (const _ of req);
    if (mode === 'drop') { req.socket.destroy(); return; }
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'llama-server process has terminated: exit status 1: cudaMalloc failed: out of memory', type: 'api_error' } }));
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${s.address().port}`;
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-reconnect-'));
  cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
  let waits = 0;
  const agent = new Agent({ url, model: MODELS.gemma, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, ctx: 32768, mode: 'edits', flows: false, ask: async () => ({ choice: 'yes' }), waitForServer: async () => { waits++; } });
  const notes = [];
  agent.on('note', (n) => notes.push(n));
  try {
    expect(await agent.send('hello')).toBe('error');
    expect(notes.find((n) => n.tone === 'error')?.text).toMatch(/^model server 500: .*out of memory/);
    expect(notes.some((n) => /stopped answering|restarting it/.test(n.text))).toBe(false);
    expect(waits).toBe(0);
    mode = 'drop';
    await agent.send('hello again');
    expect(waits).toBe(1); // a dropped connection: once, as before
  } finally { s.close(); }
});
