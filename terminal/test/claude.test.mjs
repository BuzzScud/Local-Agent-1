// A remote that is the Claude API (Server: Claude API in /remote): the agent's
// conversation as one Messages API request (claude.mjs), Claude's stream as the
// agent's events, its thinking sent back unchanged with the reply it came with,
// the key in x-api-key, and the check the form's Test row runs. Against a
// stand-in Claude API (fake-anthropic.mjs): no key, no bill.
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { startFakeAnthropic } from './fake-anthropic.mjs';

// A throwaway home before the models part is loaded (it reads AGENTIC_HOME once).
process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-claude-home-'));
process.env.AGENTIC_REMOTE_KEYSTORE = 'file';
const { claudeParams, strictSchema } = await import('../src/agent/claude.mjs');
const { streamChat } = await import('../src/agent/client.mjs');
const { complete } = await import('../src/flows/llm.mjs');
const { setEndpoint, dropEndpoint, connectRemote, probe, claudeCaps, GENERIC_REMOTE, directUrl, remoteLabel, remoteProblem, remoteRisk, HOME } = await import('../../models/index.mjs');
const { openForm, moveRow, showValue, rowNote, toProfile } = await import('../src/app/remote-form.mjs');

test('the tests run in a throwaway home', () => { expect(HOME).not.toBe(join(homedir(), '.agentic-coder')); });

const drain = async (it) => { const out = []; for await (const ev of it) out.push(ev); return out; };
const TOOLS = [{ type: 'function', function: { name: 'Read', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }];
const R = (o) => ({ use: true, address: '', port: null, connect: 'https', kind: 'claude', model: '', context: 0, key: true, keyEnd: '', ...o });

test('the address: blank means Anthropic’s, https only; no tunnel; a stand-in typed in full is taken as typed', () => {
  expect(directUrl(R({}))).toBe('https://api.anthropic.com');
  expect(directUrl(R({ connect: 'http' }))).toBe('https://api.anthropic.com');
  expect(directUrl(R({ address: 'http://127.0.0.1:9999' }))).toBe('http://127.0.0.1:9999');
  expect(remoteLabel(R({}))).toBe('api.anthropic.com');
  expect(remoteProblem(R({}))).toBe(null);
  expect(remoteProblem(R({ connect: 'ssh' }))).toMatch(/https, not an SSH tunnel/);
  expect(remoteRisk(R({}))).toBe(null);
});

test('what each model takes: Opus 5.5 always thinks and binds its thinking; Haiku 4.5 thinks by budget and has no effort', () => {
  expect(claudeCaps('claude-opus-5-5')).toEqual({ adaptive: true, alwaysThinks: true, binding: true, effort: true, budget: false, structured: true, fallbacks: true, webTools: '20260209' });
  expect(claudeCaps('claude-sonnet-5-5')).toMatchObject({ adaptive: true, alwaysThinks: false, binding: true, fallbacks: true });
  expect(claudeCaps('claude-opus-4-8')).toMatchObject({ adaptive: true, binding: false, structured: true, fallbacks: false });
  expect(claudeCaps('claude-opus-4-7')).toMatchObject({ adaptive: true, structured: false });
  expect(claudeCaps('claude-haiku-4-5')).toMatchObject({ adaptive: false, effort: false, budget: true, structured: true });
});

test('the request: system hoisted, tool calls and results paired (results first), no sampling, effort from Effort, thinking bound, fallbacks, cached', () => {
  const messages = [
    { role: 'system', content: 'You are Agentic Coder.' },
    { role: 'user', content: 'what is in a.txt?' },
    { role: 'assistant', content: 'Let me look.', tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'Read', arguments: '{"path":"a.txt"}' } }] },
    { role: 'tool', tool_call_id: 'toolu_1', content: 'hello' },
    { role: 'tool', tool_call_id: 'toolu_gone', content: 'a result nobody asked for' },
    { role: 'user', content: 'and b?' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'toolu_2', type: 'function', function: { name: 'Read', arguments: 'not json' } }] },
  ];
  const p = claudeParams({ model: 'claude-opus-5-5', messages, tools: TOOLS, thinking: false, maxTokens: 500 });
  expect(p.system).toBe('You are Agentic Coder.');
  expect(p.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
  expect(p.messages[1].content).toEqual([{ type: 'text', text: 'Let me look.' }, { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { path: 'a.txt' } }]);
  expect(p.messages[2].content).toEqual([{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'hello' }, { type: 'text', text: 'and b?' }]);
  expect(p.messages[3].content).toEqual([{ type: 'tool_use', id: 'toolu_2', name: 'Read', input: { raw: 'not json' } }]);
  expect(p.messages[4].content).toEqual([{ type: 'tool_result', tool_use_id: 'toolu_2', content: '(not run)', is_error: true }]); // never ends on the assistant
  for (const k of ['temperature', 'top_p', 'top_k', 'min_p']) expect(k in p).toBe(false);
  expect(p.output_config).toEqual({ effort: 'low' });
  expect(p.thinking).toEqual({ type: 'adaptive', display: 'omitted', block_binding: { prefix_mismatch_behavior: 'drop_block' } });
  expect(p.betas).toEqual(['thinking-binding-controls-2026-08-01', 'server-side-fallback-2026-07-01']);
  expect(p.fallbacks).toBe('default');
  expect(p.cache_control).toEqual({ type: 'ephemeral' });
  expect(p.tools[0]).toEqual({ name: 'Read', description: 'Read a file', input_schema: TOOLS[0].function.parameters, eager_input_streaming: true });
  expect(p.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
  // When the model decides (agent/way.mjs), several calls a reply are allowed.
  expect(claudeParams({ model: 'claude-opus-5-5', messages, tools: TOOLS, parallel: true }).tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: false });
  expect(p.max_tokens).toBe(4500); // the answer asked for, plus room for the thinking it always does
  const high = claudeParams({ model: 'claude-opus-5-5', messages, tools: TOOLS, toolChoice: 'none', thinking: true, effort: 'high', maxTokens: 500 });
  expect([high.output_config.effort, high.thinking.display, high.tool_choice.type, high.max_tokens]).toEqual(['high', 'summarized', 'none', 16_500]);
  const haiku = claudeParams({ model: 'claude-haiku-4-5', messages, thinking: true, maxTokens: 500 });
  expect(haiku.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
  expect('output_config' in haiku || 'fallbacks' in haiku || 'betas' in haiku).toBe(false);
  expect(haiku.max_tokens).toBeGreaterThan(4096);
  const old = claudeParams({ model: 'claude-opus-4-8', messages, thinking: false, maxTokens: 500 });
  expect('thinking' in old).toBe(false); // Low on a model that thinks only when asked: no thinking
});

test('a JSON answer is held to its schema where the model can (objects closed, limits left out); stop words go as stop sequences', () => {
  const schema = { type: 'object', properties: { kind: { type: 'string', enum: ['a', 'b'], maxLength: 9 }, n: { type: 'integer', minimum: 1 }, list: { type: 'array', items: { type: 'object', properties: { x: { type: 'string' } } }, minItems: 1 } }, required: ['kind'] };
  expect(strictSchema(schema)).toEqual({ type: 'object', properties: { kind: { type: 'string', enum: ['a', 'b'] }, n: { type: 'integer' }, list: { type: 'array', items: { type: 'object', properties: { x: { type: 'string' } }, additionalProperties: false } } }, required: ['kind'], additionalProperties: false });
  const msgs = [{ role: 'user', content: 'sort this' }];
  const p = claudeParams({ model: 'claude-opus-5-5', messages: msgs, maxTokens: 60, extra: { response_format: { type: 'json_schema', json_schema: { name: 'answer', schema } }, stop: ['<tool_call>', ' '] } });
  expect(p.output_config.format).toEqual({ type: 'json_schema', schema: strictSchema(schema) });
  expect(p.stop_sequences).toEqual(['<tool_call>']);
  expect('format' in (claudeParams({ model: 'claude-opus-4-7', messages: msgs, extra: { response_format: { type: 'json_schema', json_schema: { schema } } } }).output_config ?? {})).toBe(false);
});

test('streamed: thinking, text and a tool call come as the agent’s events, the key goes in x-api-key, and the thinking goes back unchanged with its reply', async () => {
  const fake = await startFakeAnthropic([
    { thinking: 'I should read a.txt first.', text: 'Reading it.', tool: { name: 'Read', args: { path: 'a.txt' } } },
    { text: 'It says hello.' },
  ]);
  setEndpoint(fake.url, { remote: true, kind: 'claude', key: fake.key, model: 'claude-opus-5-5', label: 'claude' });
  try {
    const messages = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'what is in a.txt?' }];
    const evs = await drain(streamChat({ url: fake.url, messages, tools: TOOLS, thinking: true, effort: 'high', model: GENERIC_REMOTE, sampling: { temperature: 1 }, maxTokens: 800 }));
    expect(evs.filter((e) => e.type === 'reasoning').map((e) => e.text).join('')).toBe('I should read a.txt first.');
    expect(evs.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('Reading it.');
    const tools = evs.filter((e) => e.type === 'tool');
    expect(tools[0]).toMatchObject({ index: 0, id: 'toolu_1', name: 'Read' });
    expect(tools.map((t) => t.args).join('')).toBe('{"path":"a.txt"}');
    expect(evs.at(-1)).toMatchObject({ type: 'done', finish: 'tool_calls', usage: { prompt_tokens: 2101, completion_tokens: 30 } });
    const first = fake.seen.find((s) => s.path.startsWith('/v1/messages'));
    expect(first.key).toBe(fake.key);
    expect(first.beta).toBe('thinking-binding-controls-2026-08-01,server-side-fallback-2026-07-01');
    expect(first.body).toMatchObject({ stream: true, model: 'claude-opus-5-5', thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: 'high' } });
    expect('temperature' in first.body).toBe(false);
    // the agent keeps the reply its own way; the next request carries the thinking block, signature and all, first in that turn
    messages.push({ role: 'assistant', content: 'Reading it.', tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'Read', arguments: '{"path":"a.txt"}' } }] }, { role: 'tool', tool_call_id: 'toolu_1', content: 'hello' });
    const next = await drain(streamChat({ url: fake.url, messages, tools: TOOLS, thinking: true, effort: 'high', model: GENERIC_REMOTE, maxTokens: 800 }));
    expect(next.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('It says hello.');
    const sent = fake.seen.filter((s) => s.path.startsWith('/v1/messages'))[1].body.messages[1].content;
    expect(sent[0]).toEqual({ type: 'thinking', thinking: 'I should read a.txt first.', signature: 'sig-1' });
    expect(sent.map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use']);
  } finally { dropEndpoint(fake.url); await fake.close(); }
});

test('a field a model refuses (named in its 400) is left out and the request goes again; a wrong key and a refusal say so plainly', async () => {
  const fake = await startFakeAnthropic([
    { error: { status: 400, type: 'invalid_request_error', message: 'output_config.effort: effort is not supported on this model' } },
    { text: 'fine' },
    { stop: 'refusal' },
  ]);
  setEndpoint(fake.url, { remote: true, kind: 'claude', key: fake.key, model: 'claude-opus-4-8' });
  try {
    const evs = await drain(streamChat({ url: fake.url, messages: [{ role: 'user', content: 'hi' }], model: GENERIC_REMOTE, maxTokens: 50 }));
    expect(evs.find((e) => e.type === 'text').text).toBe('fine');
    const posts = fake.seen.filter((s) => s.path.startsWith('/v1/messages'));
    expect(posts.map((p) => Boolean(p.body.output_config?.effort))).toEqual([true, false]);
    const refused = await drain(streamChat({ url: fake.url, messages: [{ role: 'user', content: 'hi' }], model: GENERIC_REMOTE, maxTokens: 50 }));
    expect(refused.find((e) => e.type === 'text').text).toMatch(/^\(Claude declined this request/);
    expect('output_config' in (fake.seen.at(-1).body ?? {})).toBe(false); // remembered for this model
  } finally { dropEndpoint(fake.url); }
  setEndpoint(fake.url, { remote: true, kind: 'claude', key: 'test-wrong-key-000000000', model: 'claude-opus-5-5' });
  try {
    await expect(drain(streamChat({ url: fake.url, messages: [{ role: 'user', content: 'hi' }], model: GENERIC_REMOTE, maxTokens: 50 }))).rejects.toThrow('the remote model (Claude API) did not accept the API key (401); change it in /remote');
  } finally { dropEndpoint(fake.url); await fake.close(); }
});

test('a JSON answer through complete(): held to the schema and parsed', async () => {
  const fake = await startFakeAnthropic([{ text: '{"kind":"fix"}' }]);
  setEndpoint(fake.url, { remote: true, kind: 'claude', key: fake.key, model: 'claude-sonnet-5-5' });
  try {
    const r = await complete({ url: fake.url, model: GENERIC_REMOTE, system: 's', user: 'u', maxTokens: 60, temperature: 0, schema: { type: 'object', properties: { kind: { type: 'string' } }, required: ['kind'] } });
    expect(r.json).toEqual({ kind: 'fix' });
    const body = fake.seen.at(-1).body;
    expect(body.output_config.format.schema.additionalProperties).toBe(false);
    expect('temperature' in body).toBe(false);
  } finally { dropEndpoint(fake.url); await fake.close(); }
});

test('the check (/remote’s Test, connecting): the key, the model list and its context, one word back; the context kept to 200k', async () => {
  const fake = await startFakeAnthropic([{ text: 'ready' }]);
  const url = fake.url;
  const ok = await probe({ url, kind: 'claude', key: fake.key, reply: true });
  expect(ok.ok).toBe(true);
  expect(ok).toMatchObject({ model: 'claude-opus-5-5', ctx: 1_000_000, models: ['claude-opus-5-5', 'claude-haiku-4-5'] });
  expect(ok.steps.map((s) => s.text)).toEqual([expect.stringMatching(/^reached in \d+ ms · the key was accepted$/), 'model claude-opus-5-5 · 1000k context', expect.stringMatching(/^answered "ready" in [\d.]+ s$/)]);
  expect((await probe({ url, kind: 'claude', key: 'test-wrong-key-000000000' })).error).toBe('the API key was not accepted');
  const other = await probe({ url, kind: 'claude', key: fake.key, model: 'claude-made-up-9' });
  expect(other.steps[1].text).toBe('"claude-made-up-9" is not in its list of 2; it is asked for anyway');
  const c = await connectRemote(R({ address: url, key: true }), { key: fake.key });
  expect([c.ctx, c.slots, c.model.name]).toEqual([200_000, 1, `claude-opus-5-5 · 127.0.0.1:${fake.port}`]);
  c.stop();
  await fake.close();
});

test('the form: Run on ◀ Claude API ▶ shows Anthropic’s address, https, the default model and what the key is', () => {
  let f = openForm({ remote: { use: true, kind: 'openai', connect: 'ssh', address: 'gpu' } }, { on: true });
  expect(showValue(f, 'source')).toBe('Another service');
  f = { ...moveRow(moveRow(f, 'source', -1), 'source', -1), more: true }; // past My other computer
  const env = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    expect(['source', 'address', 'model', 'key'].map((id) => showValue(f, id))).toEqual(['Claude API', 'api.anthropic.com', 'Opus 5.5', 'none']);
    expect(toProfile(f)).toMatchObject({ source: 'claude', kind: 'claude', connect: 'https', model: 'claude-opus-5-5' });
    // with ANTHROPIC_API_KEY set, a blank key row uses it
    process.env.ANTHROPIC_API_KEY = 'test-env-key-0123456789';
    expect(showValue(f, 'key')).toBe('ANTHROPIC_API_KEY');
    expect(rowNote(f, 'key')).toMatch(/^console\.anthropic\.com → API keys · kept in the .+ · blank: ANTHROPIC_API_KEY$/);
  } finally { if (env === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = env; }
  expect(rowNote(f, 'context')).toMatch(/at most 200k/);
  expect(rowNote(f, 'source')).toBe('Anthropic’s models · billed to your API key');
});
