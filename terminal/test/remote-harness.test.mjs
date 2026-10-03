// The harness for a model on another machine (the remote set, 3 Oct 2026, from the hard tasks on
// Qwen3.6 35B on a service): several calls a reply, Read of several paths on both ways, Write over a
// file it has read, thinking that leaks into the answer, the turn's notes kept in its request for the
// service's prompt cache, gpt-oss's thinking level held, and a test run's passing tests folded.
import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-remote-harness-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { Agent, leakedThinking } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { parseArgs } = await import('../src/agent/tools.mjs');
const { squeezeTests, SQUEEZE_FROM } = await import('../src/tools/run.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL, setEndpoint, dropEndpoint } = await import('../../models/index.mjs');

const local = MODELS[DEFAULT_MODEL];
const remote = { ...local, remote: { model: 'big-coder' } };
let proj;
beforeEach(() => {
  proj = mkdtempSync(join(tmpdir(), 'agentic-remote-harness-'));
  writeFileSync(join(proj, 'a.txt'), 'alpha\n');
  writeFileSync(join(proj, 'b.txt'), 'beta\n');
});
const agentOn = (url, model, extra = {}) => new Agent({ url, model, cwd: proj, system: systemPrompt({ cwd: proj, git: 'none' }), memory: false, flows: false, verify: false, mode: 'bypass', confirmPlan: false, ...extra });
const results = (a) => a.messages.filter((m) => m.role === 'tool' && !m.opening).map((m) => m.content);

test('several calls in one reply all run on the remote set; on this Mac only the first', async () => {
  const two = { tools: [{ name: 'Read', args: { path: 'a.txt' } }, { name: 'Read', args: { path: 'b.txt' } }] };
  const fake = await startFakeServer([two, { text: 'Done.' }, two, { text: 'Done.' }], { delayMs: 0 });
  try {
    const r = agentOn(fake.url, remote);
    await r.send('what is in a.txt and b.txt?');
    expect(results(r).join('\n')).toContain('alpha');
    expect(results(r).join('\n')).toContain('beta');
    const l = agentOn(fake.url, local);
    await l.send('what is in a.txt and b.txt?');
    expect(results(l).join('\n')).toContain('alpha');
    expect(results(l).join('\n')).not.toContain('beta');
  } finally { fake.close(); }
});

test('Read takes several paths on App too, a list sent as a string of JSON among them', () => {
  expect(parseArgs('Read', JSON.stringify({ paths: '["a.txt", "b.txt"]' }), 'app').args).toEqual({ paths: ['a.txt', 'b.txt'] });
  expect(parseArgs('Read', JSON.stringify({ paths: '["a.txt", "b.txt"]' }), 'model').args).toEqual({ paths: ['a.txt', 'b.txt'] });
  expect(parseArgs('Read', JSON.stringify({ files: ['a.txt'] }), 'app').args).toEqual({ path: 'a.txt' });
  expect(parseArgs('Read', JSON.stringify({ paths: 'a.txt, b.txt' }), 'app').args).toEqual({ paths: ['a.txt', 'b.txt'] });
  expect(parseArgs('Read', JSON.stringify({}), 'app').error).toContain('Read needs "path"');
});

test('Write replaces a file the remote model has read; unread, or on this Mac, it is turned back', async () => {
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'a.txt', content: 'unread\n' } } }, { text: 'Stopped.' },
    { tool: { name: 'Read', args: { path: 'a.txt' } } }, { tool: { name: 'Write', args: { path: 'a.txt', content: 'gamma\n' } } }, { text: 'Done.' },
    { tool: { name: 'Read', args: { path: 'b.txt' } } }, { tool: { name: 'Write', args: { path: 'b.txt', content: 'delta\n' } } }, { text: 'Done.' },
  ], { delayMs: 0 });
  try {
    const r = agentOn(fake.url, remote);
    await r.send('replace a.txt with the word unread');
    expect(results(r).at(-1)).toContain('Read it first: then Write may replace it whole');
    expect(readFileSync(join(proj, 'a.txt'), 'utf8')).toBe('alpha\n');
    await r.send('replace a.txt with gamma');
    expect(readFileSync(join(proj, 'a.txt'), 'utf8')).toBe('gamma\n');
    const l = agentOn(fake.url, local);
    await l.send('replace b.txt with delta');
    expect(results(l).at(-1)).toContain('Use Edit to change the part that needs changing');
    expect(readFileSync(join(proj, 'b.txt'), 'utf8')).toBe('beta\n');
  } finally { fake.close(); }
});

test('thinking that leaks into the answer is thinking: taken out, and a reply of only that is sent back once to act', async () => {
  expect(leakedThinking('plain answer')).toBe(null);
  expect(leakedThinking('Use <think> tags like this.')).toBe(null); // words about the tag, not thinking
  expect(leakedThinking('<|mask_start|><think>\nI should read b.txt\n<|mask_end|>')).toEqual({ thought: 'I should read b.txt', text: '' });
  expect(leakedThinking('<think>why</think>\nThe answer.')).toEqual({ thought: 'why', text: 'The answer.' });
  const fake = await startFakeServer([
    { tool: { name: 'Read', args: { path: 'a.txt' } } },
    { text: '<|mask_start|><think>\nNow b.txt. Let me read it.\n<|mask_end|>' },
    { tool: { name: 'Read', args: { path: 'b.txt' } } },
    { text: 'a.txt says alpha and b.txt says beta.' },
  ], { delayMs: 0 });
  try {
    const a = agentOn(fake.url, remote, { way: 'model', hooks: [] });
    const notes = [];
    a.on('note', (n) => notes.push(n.text));
    await a.send('what is in a.txt and b.txt?');
    expect(notes).toContain('The reply was only thinking, written out as text; asked it to take the next step.');
    expect(results(a).join('\n')).toContain('beta');
    expect(a.messages.at(-1).content).toBe('a.txt says alpha and b.txt says beta.');
    expect(a.messages.some((m) => m.role === 'assistant' && String(m.content).includes('<think>'))).toBe(false);
  } finally { fake.close(); }
});

test('the notes that went with a request stay in it after its turn, so the next message starts from what the service has cached', async () => {
  const fake = await startFakeServer([{ text: 'Fixed.' }, { text: 'Sure.' }], { delayMs: 0 });
  try {
    const a = agentOn(fake.url, remote);
    await a.send('fix the bug in a.txt: the word is wrong');
    const sent = fake.requests.filter((r) => r.tools?.length);
    const first = sent[0].messages.find((m) => m.role === 'user').content;
    expect(first.length).toBeGreaterThan('fix the bug in a.txt: the word is wrong'.length); // the bug's steps went with it
    await a.send('thanks, and what about b.txt?');
    const again = fake.requests.filter((r) => r.tools?.length).at(-1).messages.find((m) => m.role === 'user').content;
    expect(again).toBe(first);
    // On this Mac they come and go, as before.
    const l = agentOn(fake.url, local);
    await l.send('fix the bug in a.txt: the word is wrong');
    expect(l.messages.find((m) => m.role === 'user').content).toBe('fix the bug in a.txt: the word is wrong');
  } finally { fake.close(); }
});

test('gpt-oss on an Ollama service keeps its thinking level through the turn; other models step down after a change', () => {
  const url = 'http://127.0.0.1:1';
  try {
    setEndpoint(url, { ollama: true, model: 'gpt-oss:120b', family: 'gptoss' });
    const g = new Agent({ url, model: remote, cwd: proj, system: 'x', effort: 'high', memory: false });
    g.turn = { changed: true };
    expect(g.stepEffort()).toBe('high');
    setEndpoint(url, { ollama: true, model: 'qwen3-coder-next:latest', family: 'qwen3next' });
    expect(g.stepEffort()).toBe('medium');
  } finally { dropEndpoint(url); }
});

test("a test run's passing tests fold into one line; failures, what the tests printed and the totals stay", () => {
  const spec = [...Array.from({ length: 10 }, (_, i) => `✔ adds ${i} (0.1ms)`), 'debug line', '✖ breaks (0.7ms)', 'ℹ tests 11', 'ℹ pass 10', 'ℹ fail 1'];
  expect(squeezeTests(spec)).toEqual(['(10 passing tests not shown)', 'debug line', '✖ breaks (0.7ms)', 'ℹ tests 11', 'ℹ pass 10', 'ℹ fail 1']);
  const tap = ['TAP version 13', ...Array.from({ length: 9 }, (_, i) => [`# Subtest: t${i}`, `ok ${i + 1} - t${i}`, '  ---', '  duration_ms: 0.1', "  type: 'test'", '  ...']).flat(), '# Subtest: bad', 'not ok 10 - bad', '  ---', '  error: boom', '  ...', '# pass 9', '# fail 1'];
  expect(squeezeTests(tap)).toEqual(['TAP version 13', '(9 passing tests not shown)', '# Subtest: bad', 'not ok 10 - bad', '  ---', '  error: boom', '  ...', '# pass 9', '# fail 1']);
  // Fewer passing lines than SQUEEZE_FROM: as it was.
  const few = [...Array.from({ length: SQUEEZE_FROM - 1 }, (_, i) => `✔ t${i}`), 'ℹ pass 7'];
  expect(squeezeTests(few)).toEqual(few);
});

test('an answer that is the change written as code, with nothing changed, is sent back once to make it; an ls before it does not count as a change', async () => {
  const fake = await startFakeServer([
    { tool: { name: 'Bash', args: { command: 'ls -la' } } },
    { text: 'Here is the fix:\n```js\n// a.txt\nalpha\nis now\ngamma\n```' },
    { tool: { name: 'Read', args: { path: 'a.txt' } } },
    { tool: { name: 'Write', args: { path: 'a.txt', content: 'gamma\n' } } },
    { text: 'Changed a.txt to gamma.' },
  ], { delayMs: 0 });
  try {
    const a = agentOn(fake.url, remote, { way: 'model', hooks: ['said-done'] });
    const notes = [];
    a.on('note', (n) => notes.push(n.text));
    await a.send('change the word in a.txt to gamma');
    expect(notes).toContain('It wrote the change in its answer, but no file changed; asked it to make the change.');
    expect(readFileSync(join(proj, 'a.txt'), 'utf8')).toBe('gamma\n');
  } finally { fake.close(); }
});

test('a tool call the service could not read is written again, twice at most, instead of ending the message', async () => {
  const fake = await startFakeServer([
    { error: 'XML syntax error on line 17: unexpected EOF' },
    { tool: { name: 'Read', args: { path: 'a.txt' } } },
    { text: 'It says alpha.' },
  ], { delayMs: 0 });
  try {
    const a = agentOn(fake.url, remote, { way: 'model', hooks: [] });
    const notes = [];
    a.on('note', (n) => notes.push(n.text));
    expect(await a.send('what is in a.txt?')).toBe('done');
    expect(notes.some((t) => t.startsWith('The service could not read the tool call it wrote (XML syntax error'))).toBe(true);
    expect(a.messages.at(-1).content).toBe('It says alpha.');
  } finally { fake.close(); }
  const stuck = await startFakeServer(Array.from({ length: 4 }, () => ({ error: 'XML syntax error on line 3: unexpected EOF' })), { delayMs: 0 });
  try {
    const a = agentOn(stuck.url, remote, { way: 'model', hooks: [] });
    expect(await a.send('what is in a.txt?')).toBe('error');
    expect(stuck.requests.filter((r) => r.stream).length).toBe(3); // the first and two more
  } finally { stuck.close(); }
});

test('on an Ollama service each conversation starts with a line of its own, new with /clear; elsewhere the instructions go as they are', async () => {
  const { ownStart } = await import('../src/agent/client.mjs');
  const msgs = [{ role: 'system', content: 'You are Agentic Coder.' }, { role: 'user', content: 'hi' }];
  expect(ownStart(msgs, 'ab12cd34')[0].content).toBe('Conversation ab12cd34.\nYou are Agentic Coder.');
  expect(ownStart(msgs, 'ab12cd34')[1]).toBe(msgs[1]);
  expect(msgs[0].content).toBe('You are Agentic Coder.'); // the conversation itself is not changed
  expect(ownStart(msgs, undefined)).toBe(msgs);
  const a = new Agent({ url: 'http://127.0.0.1:1', model: remote, cwd: proj, system: 'x', memory: false });
  const b = new Agent({ url: 'http://127.0.0.1:1', model: remote, cwd: proj, system: 'x', memory: false });
  expect(a.conversation).toMatch(/^[0-9a-f]{8}$/);
  expect(a.conversation).not.toBe(b.conversation);
  const before = a.conversation;
  a.reset();
  expect(a.conversation).not.toBe(before);
});

test('AGENTIC_OWN_START: on for every model of an Ollama service unless set; off for none; auto only for the kinds where the mixing was seen', async () => {
  const { ownStartOn, OWN_START_KINDS } = await import('../src/agent/client.mjs');
  const qwen = { ollama: true, family: 'qwen35moe', model: 'qwen3.6:35b' }, coder = { ollama: true, family: 'qwen3moe', model: 'qwen3-coder-next:latest' };
  expect(OWN_START_KINDS).toEqual(['qwen35moe']);
  for (const ep of [qwen, coder, { ollama: true }]) expect(ownStartOn(ep, {})).toBe(true); // as before the switch
  expect([ownStartOn(qwen, { AGENTIC_OWN_START: 'on' }), ownStartOn(coder, { AGENTIC_OWN_START: 'ON' })]).toEqual([true, true]);
  for (const v of ['off', 'OFF', '0', 'false']) expect([v, ownStartOn(qwen, { AGENTIC_OWN_START: v })]).toEqual([v, false]);
  expect([ownStartOn(qwen, { AGENTIC_OWN_START: 'auto' }), ownStartOn(coder, { AGENTIC_OWN_START: 'auto' }), ownStartOn({ ollama: true }, { AGENTIC_OWN_START: 'auto' })]).toEqual([true, false, false]);
  // what a request to the service carries, each way
  const { fakeOllama } = await import('./fake-ollama.mjs');
  const svc = await fakeOllama();
  const keep = process.env.AGENTIC_OWN_START;
  try {
    const { connectRemote } = await import('../../models/index.mjs');
    const { streamChat } = await import('../src/agent/client.mjs');
    const first = async (model) => {
      const g = await connectRemote({ source: 'openai', kind: 'openai', connect: 'http', address: svc.url, model, context: 0, key: false });
      for await (const ev of streamChat({ url: g.url, conversation: 'ab12cd34', messages: [{ role: 'system', content: 'You are Agentic Coder.' }, { role: 'user', content: 'hi' }], model: g.model })) void ev;
      g.stop();
      return svc.chats().at(-1).messages[0].content;
    };
    delete process.env.AGENTIC_OWN_START;
    expect(await first('coder:30b')).toBe('Conversation ab12cd34.\nYou are Agentic Coder.');
    process.env.AGENTIC_OWN_START = 'off';
    expect(await first('coder:30b')).toBe('You are Agentic Coder.');
    process.env.AGENTIC_OWN_START = 'auto'; // coder:30b's kind (qwen3moe) is not on the list; thinker:35b's (qwen35moe) is
    expect(await first('coder:30b')).toBe('You are Agentic Coder.');
    expect(await first('thinker:35b')).toBe('Conversation ab12cd34.\nYou are Agentic Coder.');
  } finally { if (keep === undefined) delete process.env.AGENTIC_OWN_START; else process.env.AGENTIC_OWN_START = keep; await svc.close(); }
});

test('a call written out as text: under a name of its own it runs as the tool it means; only arguments, it runs only when the tool just looks', async () => {
  const { bareCallInText } = await import('../src/agent/agent.mjs');
  const names = ['Read', 'List', 'Search', 'Edit', 'Write', 'Bash', 'TodoWrite', 'Ask'];
  const call = (t) => bareCallInText(t, names);
  expect(call('{"name":"read_files","args":{"paths":["a.txt","b.txt"]}}')).toEqual({ name: 'Read', args: '{"paths":["a.txt","b.txt"]}', before: '' });
  expect(call('{"name":"run_command","args":{"command":"npm test"}}')?.name).toBe('Bash'); // named: the model meant a call
  expect(call('{"file":"a.txt"}')).toEqual({ name: 'Read', args: '{"file":"a.txt"}', before: '' });
  expect(call('{"pattern":"total","path":"src"}')?.name).toBe('Search');
  expect(call('{"command":"rm -rf x"}')).toBe(null); // only arguments: never a command
  expect(call('Here is the config: {"path": "a.txt"}')).toBe(null);
  expect(call('{"v":"2"}')).toBe(null);
  expect(call('{"name":"fly_to_moon","args":{}}')).toBe(null);
  const fake = await startFakeServer([{ text: '{"name":"read_files","args":{"paths":["a.txt","b.txt"]}}' }, { text: 'alpha and beta.' }], { delayMs: 0 });
  try {
    const a = agentOn(fake.url, remote, { way: 'model', hooks: [] });
    await a.send('what is in a.txt and b.txt?');
    expect(results(a).join('\n')).toContain('beta');
  } finally { fake.close(); }
});

// A call written as text under a name of its own ("run_command", "write_file") runs as the tool it means
// (3 Oct 2026). It must pass the same lock as a real call: asked about, allowed or refused alike, in
// each of the five modes, for the three tools that change things.
test('a call written as text under another name gets the decision a real call gets, in every mode', async () => {
  const { MODES } = await import('../src/agent/permissions.mjs');
  const cases = [
    ['Bash', { command: 'touch made.txt' }, 'run_command'],
    ['Write', { path: 'new.txt', content: 'hello\n' }, 'write_file'],
    ['Edit', { path: 'a.txt', old_text: 'alpha', new_text: 'ALPHA' }, 'str_replace'],
  ];
  const outcome = async (mode, reply) => {
    writeFileSync(join(proj, 'a.txt'), 'alpha\n');
    for (const f of ['made.txt', 'new.txt']) rmSync(join(proj, f), { force: true });
    const fake = await startFakeServer([reply, { text: 'Done.' }, { text: 'Done.' }, { text: 'Done.' }], { delayMs: 0 });
    const asked = [];
    try {
      const a = agentOn(fake.url, remote, { way: 'model', hooks: [], mode, ask: async (req) => { asked.push(`${req.name}: ${req.arg ?? ''}`); return { choice: 'no' }; } });
      await a.send('do it');
      const steps = a.messages.filter((m) => m.role === 'assistant' && m.tool_calls?.length && !m.tool_calls.some((c) => String(c.id).startsWith('opening_'))).flatMap((m) => m.tool_calls.map((c) => c.function.name));
      return { asked, steps, made: existsSync(join(proj, 'made.txt')), wrote: existsSync(join(proj, 'new.txt')), a: readFileSync(join(proj, 'a.txt'), 'utf8'), said: results(a).map((r) => r.replace(/\s+/g, ' ').slice(0, 80)) };
    } finally { fake.close(); }
  };
  const seen = {};
  for (const mode of MODES) for (const [tool, args, alias] of cases) {
    const real = await outcome(mode, { tools: [{ name: tool, args }] });
    const text = await outcome(mode, { text: JSON.stringify({ name: alias, arguments: args }) });
    expect([mode, tool, text]).toEqual([mode, tool, real]);
    expect(real.steps[0]).toBe(tool); // the text call ran as the tool it means (text equals real, above)
    seen[`${mode} ${tool}`] = real;
  }
  // The lock is a real one, so the sameness above means something: Manual asks about the command and
  // a "no" leaves the files alone; Bypass asks nothing, runs the command and writes the file. (The
  // edit is turned away in both forms alike: the file was not read first.)
  expect(seen['ask Bash'].asked).toHaveLength(1);
  expect([seen['ask Bash'].made, seen['ask Write'].wrote, seen['ask Edit'].a]).toEqual([false, false, 'alpha\n']);
  expect([seen['bypass Bash'], seen['bypass Write'], seen['bypass Edit']].map((r) => r.asked.length)).toEqual([0, 0, 0]);
  expect([seen['bypass Bash'].made, seen['bypass Write'].wrote]).toEqual([true, true]);
}, 120_000);
