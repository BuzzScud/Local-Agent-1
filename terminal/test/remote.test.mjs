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
const { openForm, moveRow, startEdit, editField, pasteField, commitEdit, toProfile, formWarning, connectionChanged, showValue, rowNote, REMOTE_ROWS } = await import('../src/app/remote-form.mjs');
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

test('the form opens on what is saved; ←→ moves a choice row and stops at its ends; the Model row walks the server’s list after a Test', () => {
  let f = openForm({ address: '10.0.0.5', key: true, keyEnd: '3f9a' });
  expect(REMOTE_ROWS.map((r) => r.label)).toEqual(['Use', 'Connect', 'Address', 'Port', 'API key', 'Server', 'Model', 'Context', 'Test', 'Save']);
  expect(['use', 'connect', 'address', 'port', 'key', 'kind', 'model', 'context', 'test'].map((id) => showValue(f, id))).toEqual(['This Mac', 'http', '10.0.0.5', '8080', '••••••••3f9a', 'llama.cpp', 'the one it runs', 'from server', 'enter to check']);
  f = moveRow(f, 'use', 1);
  expect(f.values.use).toBe(true);
  expect(moveRow(f, 'use', 1).values.use).toBe(true); // stops at the end
  f = moveRow(moveRow(f, 'connect', 1), 'connect', 1);
  expect(showValue(f, 'connect')).toBe('SSH tunnel');
  expect(rowNote(f, 'address')).toBe('user@host, or a name from ~/.ssh/config');
  f = moveRow(f, 'context', 1);
  expect(showValue(f, 'context')).toBe('8k');
  expect(moveRow(f, 'model', 1)).toBe(f); // no list yet
  f = { ...f, test: { ok: true, steps: [], models: ['a', 'b', 'c'] } };
  expect(moveRow(moveRow(f, 'model', 1), 'model', 1).values.model).toBe('b');
  expect(rowNote(f, 'model')).toBe('←→ picks one of the 3 it has');
});

test('editing a row: typed and pasted text at the cursor; a key loses its spaces and breaks, a port keeps its digits; a whole https address sets Connect', () => {
  let f = openForm({});
  f = startEdit(f, 'address');
  for (const ch of 'gpu.example') f = { ...f, editing: editField(f.editing, ch, {}) };
  f = { ...f, editing: editField(f.editing, '', { backspace: true }) };
  f = { ...f, editing: editField(f.editing, '', { leftArrow: true }) };
  f = { ...f, editing: editField(f.editing, 'X', {}) };
  expect(f.editing).toMatchObject({ value: 'gpu.exampXl', cursor: 10 });
  f = { ...f, editing: editField(f.editing, 'u', { ctrl: true }) };
  expect(f.editing.value).toBe('l');
  f = { ...f, editing: pasteField({ id: 'address', value: '', cursor: 0 }, 'https://api.example.com/api/v1\n') };
  f = commitEdit(f);
  expect(f.values).toMatchObject({ address: 'https://api.example.com/api/v1', connect: 'https' });
  const k = pasteField({ id: 'key', value: '', cursor: 0 }, '  sk-abc\n def  ');
  expect(k.value).toBe('sk-abcdef');
  expect(pasteField({ id: 'port', value: '', cursor: 0 }, ' 90a80 ').value).toBe('9080');
  // the key starts empty; enter on an empty key = no key
  let g = startEdit(openForm({ key: true, keyEnd: 'abcd' }), 'key');
  expect(g.editing.value).toBe('');
  g = commitEdit(g);
  expect(g.key).toBe('');
  expect(showValue(g, 'key')).toBe('none');
  expect(toProfile(g)).toMatchObject({ key: false, keyEnd: '' });
});

test('what Save keeps: never the key itself; a new key shows as dots and its end; what counts as pointing somewhere else', () => {
  let f = openForm({ ...DEFAULT_REMOTE, address: '10.0.0.5', use: true });
  f = commitEdit({ ...startEdit(f, 'key'), editing: { id: 'key', value: 'test-new-0123456789abcd', cursor: 21 } });
  expect(showValue(f, 'key')).toBe('••••••••abcd');
  const r = toProfile(f);
  expect(r).toEqual({ use: true, address: '10.0.0.5', port: null, connect: 'http', kind: 'llama', model: '', context: 0, key: true, keyEnd: 'abcd' });
  expect(JSON.stringify(r)).not.toContain('test-new');
  expect(connectionChanged(f.saved, r, false)).toBe(false);
  expect(connectionChanged(f.saved, r, true)).toBe(true);
  expect(connectionChanged(f.saved, { ...r, port: 9000 }, false)).toBe(true);
});

test('the warning under the form: a problem that stops Save when Use is Remote, plain http to the internet, a key with a space', () => {
  expect(formWarning(openForm({ use: true }))).toEqual({ tone: 'error', text: 'Not ready: it has no address yet.' });
  expect(formWarning(openForm({ use: false }))).toBe(null);
  expect(formWarning(openForm({ use: true, address: '203.0.113.9' })).text).toMatch(/^⚠ plain http to 203\.0\.113\.9/);
  expect(formWarning(openForm({ use: true, address: '192.168.1.40' }))).toBe(null);
  expect(formWarning({ ...openForm({ address: '10.0.0.5' }), key: 'has space' }).tone).toBe('error');
});
