// K2 Horizon 7B (added 30 Sep 2026): its tool calls written as text, its own
// thinking tags, its template switches and its engine. The strings below are
// what its chat template writes (models/templates/k2-horizon.jinja in IFM's
// llama.cpp, branch model/K2Horizon).
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, toolCallInText, beforeCall, CALL_MARK } from '../src/agent/agent.mjs';
import { splitThink } from '../src/agent/think-tags.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, thinkingKwargs, thinkingLevel, engineOf, ENGINES } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';

const k2 = MODELS.k2;
const xmlCall = '<ifm|tool_calls>\n<ifm|tool_call>Read\n<ifm|arg_key>path</ifm|arg_key>\n<ifm|arg_value>package.json</ifm|arg_value>\n</ifm|tool_call>\n</ifm|tool_calls>';

test('a K2 tool call written as text: xml, xml_typed and json, the text before it kept', () => {
  expect(toolCallInText(`Let me look first.\n${xmlCall}`)).toEqual({ name: 'Read', args: '{"path":"package.json"}', before: 'Let me look first.' });
  // A value that is not text is written as JSON; a text value as it is.
  const many = '<ifm|tool_calls>\n<ifm|tool_call>Edit\n<ifm|arg_key>path</ifm|arg_key>\n<ifm|arg_value>a.mjs</ifm|arg_value>\n<ifm|arg_key>old</ifm|arg_key>\n<ifm|arg_value>x = 1\ny = 2</ifm|arg_value>\n<ifm|arg_key>all</ifm|arg_key>\n<ifm|arg_value>true</ifm|arg_value>\n</ifm|tool_call>\n</ifm|tool_calls>';
  expect(JSON.parse(toolCallInText(many).args)).toEqual({ path: 'a.mjs', old: 'x = 1\ny = 2', all: true });
  // xml_typed: the type decides, so a text "42" stays text.
  const typed = '<ifm|tool_calls>\n<ifm|tool_call>Bash\n<ifm|arg_key>command</ifm|arg_key>\n<ifm|arg_type>string</ifm|arg_type>\n<ifm|arg_value>42</ifm|arg_value>\n<ifm|arg_key>timeout</ifm|arg_key>\n<ifm|arg_type>integer</ifm|arg_type>\n<ifm|arg_value>30</ifm|arg_value>\n</ifm|tool_call>\n</ifm|tool_calls>';
  expect(JSON.parse(toolCallInText(typed).args)).toEqual({ command: '42', timeout: 30 });
  // json
  const json = 'ok\n<ifm|tool_calls>\n<ifm|tool_call>{"name": "Grep", "arguments": {"pattern": "TODO"}}</ifm|tool_call>\n</ifm|tool_calls>';
  expect(toolCallInText(json)).toEqual({ name: 'Grep', args: '{"pattern":"TODO"}', before: 'ok' });
  // Two calls: the first is the one read (only the first runs, as for the other models).
  expect(toolCallInText(`${xmlCall.replace('</ifm|tool_calls>', '')}<ifm|tool_call>List\n</ifm|tool_call>\n</ifm|tool_calls>`).name).toBe('Read');
  // Broken json, or no name: no call.
  expect(toolCallInText('<ifm|tool_call>{"name": </ifm|tool_call>')).toBe(null);
  expect(toolCallInText('<ifm|tool_call>\n</ifm|tool_call>')).toBe(null);
  // Qwen's and the 27B's still read as before.
  expect(toolCallInText('<tool_call>{"name":"Read","arguments":{"path":"a"}}</tool_call>').name).toBe('Read');
  expect(toolCallInText('<tool_call><function=Read><parameter=path>a</parameter></function></tool_call>').name).toBe('Read');
});

test('the text before a call is cut at every kind of call mark', () => {
  expect(beforeCall(`Reading it.\n${xmlCall}`)).toBe('Reading it.\n');
  expect(beforeCall('Here.<ifm|tool_call>Read\n')).toBe('Here.');
  expect(beforeCall('Before<tool_call>{}')).toBe('Before');
  expect(beforeCall('no call')).toBe('no call');
  expect(CALL_MARK.test('<ifm|tool_calls>')).toBe(true);
});

const collect = async (events, opts) => {
  async function* gen() { for (const e of events) yield e; }
  const out = [];
  for await (const e of splitThink(gen(), k2.thinkTags, opts)) out.push(e);
  // Pieces of the same kind side by side are joined, as the agent joins them.
  const joined = [];
  for (const e of out) {
    const last = joined.at(-1);
    if (last && last.type === e.type && (e.type === 'text' || e.type === 'reasoning')) last.text += e.text;
    else joined.push({ ...e });
  }
  return joined;
};
// Text cut into small pieces, as a stream sends it (tags cut in two included).
const pieces = (type, s, n = 5) => (s.match(new RegExp(`[\\s\\S]{1,${n}}`, 'g')) ?? []).map((text) => ({ type, text }));

test('thinking split by the server already: passed on as it is', async () => {
  const out = await collect([...pieces('reasoning', 'I should read it.'), ...pieces('text', 'Reading.'), { type: 'done', finish: 'stop' }], { thinking: true });
  expect(out).toEqual([{ type: 'reasoning', text: 'I should read it.' }, { type: 'text', text: 'Reading.' }, { type: 'done', finish: 'stop' }]);
});

test('all in the answer: the thinking before its closing tag goes to thinking', async () => {
  const out = await collect([...pieces('text', 'Check the file first.</ifm|think_fast>\n\nHere it is.'), { type: 'done' }], { thinking: true });
  expect(out).toEqual([{ type: 'reasoning', text: 'Check the file first.' }, { type: 'text', text: 'Here it is.' }, { type: 'done' }]);
});

test('all as thinking (the server waits for the other closing tag): the answer and its call come out as the answer', async () => {
  const out = await collect([...pieces('reasoning', `Plan: read package.json.\n</ifm|think_faster>\nLet me look.\n${xmlCall}`, 7), { type: 'done' }], { thinking: true });
  expect(out[0]).toEqual({ type: 'reasoning', text: 'Plan: read package.json.\n' });
  expect(out[1].type).toBe('text');
  expect(toolCallInText(out[1].text)).toEqual({ name: 'Read', args: '{"path":"package.json"}', before: 'Let me look.' });
});

test('thinking off: the answer stays the answer; stray tags are left out; a tool call passes through', async () => {
  const tool = { type: 'tool', index: 0, id: 'c1', name: 'Read', args: '{}' };
  const out = await collect([...pieces('text', '<ifm|think>\n</ifm|think>\nHello there.'), tool, { type: 'done' }], { thinking: false });
  expect(out).toEqual([{ type: 'text', text: 'Hello there.' }, tool, { type: 'done' }]);
  // A "<" that is not a tag is kept.
  const lt = await collect([...pieces('text', 'if a < b and c <ifm'), { type: 'done' }], { thinking: false });
  expect(lt[0]).toEqual({ type: 'text', text: 'if a < b and c <ifm' });
});

test('K2 sends its tool-call format and only the efforts its template takes', () => {
  expect(thinkingKwargs(k2, false)).toEqual({ tool_call_format: 'xml', enable_thinking: false });
  expect(thinkingKwargs(k2, true, 'medium')).toEqual({ tool_call_format: 'xml', enable_thinking: true, reasoning_effort: 'medium' });
  expect(thinkingKwargs(k2, true, 'high')).toEqual({ tool_call_format: 'xml', enable_thinking: true, reasoning_effort: 'high' });
  // An effort it has no level for (another model's "xhigh") falls back to its own High.
  expect(thinkingKwargs(k2, true, 'xhigh').reasoning_effort).toBe('high');
  for (const lv of k2.thinkingLevels) if (lv.effort) expect(['high', 'medium', 'low']).toContain(lv.effort);
  expect(thinkingLevel(k2, false).id).toBe('low');
  // The other models send nothing new.
  expect(thinkingKwargs(MODELS.qwen, false)).toEqual({ enable_thinking: false });
});

test('K2 runs on IFM\'s engine, even when AGENTIC_ENGINE points the others elsewhere', () => {
  expect(engineOf(k2)).toBe(ENGINES.ifm);
  expect(ENGINES.ifm.commit).toMatch(/^[0-9a-f]{40}$/);
  const was = process.env.AGENTIC_ENGINE;
  try {
    process.env.AGENTIC_ENGINE = 'prism';
    expect(engineOf(k2).id).toBe('ifm');
    expect(engineOf(MODELS.qwen).id).toBe('prism');
  } finally {
    if (was === undefined) delete process.env.AGENTIC_ENGINE; else process.env.AGENTIC_ENGINE = was;
  }
  // The third model in /model; no vision add-on; the layout from its file.
  expect(Object.keys(MODELS)).toEqual(['gemma', 'qwen', 'k2', 'bonsai', 'constantkv']);
  expect(k2.vision).toBeUndefined();
  expect(k2).toMatchObject({ attnLayers: 36, kvHeads: 8, headDim: 128, bytes: 6_466_075_008 });
});

test('a whole K2 turn: thinking "as thinking", a call written in it, run, then the answer', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-k2-'));
  cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
  const fake = await startFakeServer([
    { reasoning: `The user wants the name. Read package.json.\n</ifm|think_fast>\nLet me look.\n${xmlCall}` },
    // The demo project has no package.json: the answer says so (since 4 Oct 2026 one that leaves out a missing file the request names goes back).
    { reasoning: 'Got it.</ifm|think_fast>\npackage.json is not there; the folder is the demo project.' },
  ]);
  const events = [];
  const agent = new Agent({ url: fake.url, model: k2, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: true, effort: 'medium', mode: 'edits', flows: false, ask: async () => ({ choice: 'yes' }) });
  for (const t of ['assistant', 'tool']) agent.on(t, (e) => events.push({ type: t, ...e }));
  const reason = await agent.send('what is the package called? read package.json', {});
  await fake.close();
  expect(reason).toBe('done');
  // (The first Read is the app's own look at the project before the model's first step.)
  expect(events.filter((e) => e.type === 'tool').at(-1)).toMatchObject({ label: 'Read', arg: 'package.json' });
  // The history keeps the thinking apart from what it said, and the call as a real call.
  const first = agent.messages.find((m) => m.role === 'assistant' && m.tool_calls?.[0]?.function.arguments.includes('package.json'));
  expect(first.reasoning_content).toBe('The user wants the name. Read package.json.');
  expect(first.tool_calls[0].function).toEqual({ name: 'Read', arguments: '{"path":"package.json"}' });
  expect(first.content).not.toContain('ifm|');
  // Every request told the template its tool-call format and the Medium effort.
  const req = fake.requests.find((r) => r.messages?.length);
  expect(req.chat_template_kwargs).toEqual({ tool_call_format: 'xml', enable_thinking: true, reasoning_effort: 'medium' });
  expect(events.filter((e) => e.type === 'assistant').at(-1).text).toContain('demo');
});
