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
const { openForm, rowsOf, moveRow, startEdit, editField, pasteField, commitEdit, toProfile, formWarning, connectionChanged, showValue, rowNote, rowChanged, modelChoices, savePlan, remotesOf, remoteChoices, withTest } = await import('../src/app/remote-form.mjs');
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
