import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, safeArgs } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../src/server/models.mjs';
import { startFakeServer } from './fake-server.mjs';
import { demoReplies } from './demo-script.mjs';

const model = MODELS[DEFAULT_MODEL];
const project = () => { const d = mkdtempSync(join(tmpdir(), 'bonsai-agent-')); cpSync(join(import.meta.dir, '..', 'demo-project'), d, { recursive: true }); return d; };

async function run(replies, { answer = 'yes', mode = 'edits', ctx = 32768, abortAfterMs, fakeOpts } = {}) {
  const cwd = project();
  const fake = await startFakeServer(replies, fakeOpts);
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: true, ctx, mode, flows: false, ask: async (req) => { events.push({ type: 'ask', name: req.name }); return { choice: answer }; } });
  for (const t of ['assistant', 'tool', 'note', 'todos', 'compacted']) agent.on(t, (e) => events.push({ type: t, ...e }));
  agent.on('mode', (m) => events.push({ type: 'mode', mode: m }));
  const ac = new AbortController();
  if (abortAfterMs) setTimeout(() => ac.abort(), abortAfterMs);
  const reason = await agent.send('add a --json flag to export.mjs', { signal: ac.signal });
  await fake.close();
  return { reason, events, agent, cwd, fake };
}

test('the whole --json task: real edits, real test run', async () => {
  const { reason, events, cwd } = await run(demoReplies);
  expect(reason).toBe('done');
  const tools = events.filter((e) => e.type === 'tool');
  expect(tools.map((t) => t.label)).toEqual(['Read', 'Update Todos', 'Update', 'Read', 'Update', 'Bash']);
  expect(tools.every((t) => !t.error)).toBe(true);
  expect(readFileSync(join(cwd, 'export.mjs'), 'utf8')).toContain("argv.includes('--json')");
  expect(tools.at(-1).view.lines.join('\n')).toMatch(/ℹ pass 3/);
});

test('asks before edits in ask mode; "always" switches to auto-edit', async () => {
  const { events, agent } = await run(demoReplies, { mode: 'ask', answer: 'always' });
  // Edit asked once; after "always" the second edit went straight through. Bash still asks.
  expect(events.filter((e) => e.type === 'ask').map((e) => e.name)).toEqual(['Edit', 'Bash']);
  expect(events.filter((e) => e.type === 'mode').map((e) => e.mode)).toEqual(['edits']);
  expect(agent.mode).toBe('edits');
});

test('saying no stops the turn and tells the model', async () => {
  const { reason, agent, cwd } = await run(demoReplies, { mode: 'ask', answer: 'no' });
  expect(reason).toBe('declined');
  expect(agent.messages.find((m) => m.role === 'tool' && m.content.startsWith('The user said no'))).toBeTruthy();
  expect(readFileSync(join(cwd, 'export.mjs'), 'utf8')).not.toContain('--json');
});

test('repeating the same call stops as stuck', async () => {
  const same = { tool: { name: 'Read', args: { path: 'export.mjs' } } };
  const { reason, events } = await run([same, same, same, same, same, same]);
  expect(reason).toBe('stuck');
  expect(events.find((e) => e.type === 'note').text).toContain('kept repeating');
});

test('bad arguments come back as an error the model can fix', async () => {
  const replies = [{ tool: { name: 'Edit', args: { path: 'export.mjs' } } }, { text: 'Sorry, done.' }];
  const { reason, agent } = await run(replies);
  expect(reason).toBe('done');
  expect(agent.messages.find((m) => m.role === 'tool').content).toContain('Edit needs "old_text"');
});

test('a tool call written as text still runs', async () => {
  const replies = [{ text: 'Reading.\n<tool_call>\n{"name": "Read", "arguments": {"path": "export.mjs"}}\n</tool_call>' }, { text: 'It prints CSV.' }];
  const { events } = await run(replies);
  expect(events.filter((e) => e.type === 'tool').map((e) => e.label)).toEqual(['Read']);
});

test('a reply that repeats itself is cut off and retried', async () => {
  const replies = [{ text: `Here: ${'// '.repeat(120)}` }, { text: 'Done.' }];
  const { reason, events } = await run(replies);
  expect(reason).toBe('done');
  expect(events.some((e) => e.type === 'note' && e.text.includes('repeating'))).toBe(true);
});

test('esc (abort) stops the turn', async () => {
  const slow = [{ reasoning: 'x '.repeat(400), text: 'done' }];
  const { reason } = await run(slow, { abortAfterMs: 150, fakeOpts: { delayMs: 20, chunk: 2 } });
  expect(reason).toBe('interrupted');
});

test('old tool output is trimmed when memory fills', async () => {
  const read = { tool: { name: 'Read', args: { path: 'export.mjs' } } };
  const replies = [read, { tool: { name: 'Read', args: { path: 'export.test.mjs' } } }, { tool: { name: 'List', args: {} } }, { tool: { name: 'Read', args: { path: 'trades.json' } } }, { tool: { name: 'Search', args: { pattern: 'toCsv' } } }, { tool: { name: 'Read', args: { path: 'export.mjs' } } }, { text: 'ok' }];
  const { agent, events } = await run(replies, { ctx: 1500 });
  expect(events.some((e) => e.type === 'note' && /Trimmed|Summariz/.test(e.text))).toBe(true);
  expect(agent.messages.some((m) => m.role === 'tool' && m.content.startsWith('[older output removed'))
    || agent.messages.some((m) => m.content?.startsWith?.('Summary of the work so far'))).toBe(true);
});

test('blocked commands never run, even in auto mode', async () => {
  const replies = [{ tool: { name: 'Bash', args: { command: 'rm -rf node_modules' } } }, { text: 'ok' }];
  const { events } = await run(replies);
  const t = events.find((e) => e.type === 'tool');
  expect(t.view.kind).toBe('denied');
  expect(t.view.message).toContain('rm -rf');
});

test('a reply that only announces the next step gets a "go ahead"', async () => {
  const replies = [{ text: 'I need to change main(). First, I will add the flag:' }, { tool: { name: 'Read', args: { path: 'export.mjs' } } }, { text: 'Done: it prints JSON now.' }];
  const { reason, agent, events } = await run(replies);
  expect(reason).toBe('done');
  expect(agent.messages.some((m) => m.role === 'user' && m.content.startsWith('Go ahead'))).toBe(true);
  expect(events.filter((e) => e.type === 'tool').length).toBe(1);
});

test('a finished answer is not nudged', async () => {
  const { agent } = await run([{ text: 'Done. All 3 tests pass.' }]);
  expect(agent.messages.some((m) => m.role === 'user' && m.content.startsWith('Go ahead'))).toBe(false);
});

test('a tool error never ends the turn (Edit on a folder)', async () => {
  const replies = [{ tool: { name: 'Edit', args: { path: '.', old_text: 'toCsv', new_text: 'toTable', replace_all: true } } }, { text: 'I will search instead. Done.' }];
  const { reason, agent } = await run(replies);
  expect(reason).toBe('done');
  expect(agent.messages.find((m) => m.role === 'tool').content).toContain('is a folder');
});

test('a tool call written inside the thinking still runs', async () => {
  const replies = [{ reasoning: 'Let me look.\n<tool_call>\n{"name": "Read", "arguments": {"path": "export.mjs"}}\n</tool_call>' }, { text: 'It prints CSV.' }];
  const { reason, events } = await run(replies);
  expect(reason).toBe('done');
  expect(events.filter((e) => e.type === 'tool').map((e) => e.label)).toEqual(['Read']);
});

test('announcing the next step is spotted even with file names in the sentence', async () => {
  const { announcesNextStep } = await import('../src/agent/agent.mjs');
  expect(announcesNextStep('The test expects 2.5. Let me fix the `median` function in `project/stats.mjs` to handle even counts.')).toBe(true);
  expect(announcesNextStep('First, I will add the flag:')).toBe(true);
  expect(announcesNextStep('Done. All 3 tests pass.')).toBe(false);
  expect(announcesNextStep('It listens on port 8790, set in src/config.mjs.')).toBe(false);
});

test('done after an edit without testing: the tests run, and a failure sends it back', async () => {
  const replies = [
    { tool: { name: 'Read', args: { path: 'export.mjs' } } },
    { tool: { name: 'Edit', args: { path: 'export.mjs', old_text: "  return toCsv(rows);", new_text: "  return toCsv(rows).toUpperCase();" } } },
    { text: 'Done.' },                                   // → tests run automatically, they fail
    { tool: { name: 'Edit', args: { path: 'export.mjs', old_text: "  return toCsv(rows).toUpperCase();", new_text: "  return toCsv(rows);" } } },
    { text: 'Fixed.' },                                  // → tests run again, pass
  ];
  const { reason, events, agent } = await run(replies);
  expect(reason).toBe('done');
  const bash = events.filter((e) => e.type === 'tool' && e.label === 'Bash');
  expect(bash.length).toBe(2);
  expect(bash[0].error).toBe(true);
  expect(bash[1].error).toBeFalsy();
  expect(agent.messages.some((m) => m.role === 'user' && m.content.startsWith('The tests fail'))).toBe(true);
});

test('an edit repeated after it was applied is recognised', () => {
  const r = findEditLocal('a\nconsole.log(JSON.stringify(x));\n', 'console.log(x);', 'console.log(JSON.stringify(x));');
  expect(r.error).toContain('already in the file');
});
import { findEdit as findEditLocal } from '../src/agent/tools.mjs';

test('an existing file must be read before it is edited', async () => {
  const replies = [
    { tool: { name: 'Edit', args: { path: 'export.mjs', old_text: '  return toCsv(rows);', new_text: '  return toCsv(rows); // x' } } },
    { tool: { name: 'Read', args: { path: 'export.mjs' } } },
    { tool: { name: 'Edit', args: { path: 'export.mjs', old_text: '  return toCsv(rows);', new_text: '  return toCsv(rows); // x' } } },
    { tool: { name: 'Bash', args: { command: 'node --test' } } },
    { text: 'Done.' },
  ];
  const { events, cwd } = await run(replies);
  const tools = events.filter((e) => e.type === 'tool');
  expect(tools[0].view.message).toContain('Read export.mjs first');
  expect(tools[2].error).toBeFalsy();
  expect(readFileSync(join(cwd, 'export.mjs'), 'utf8')).toContain('// x');
});

test("a tool call in the 27B's own format, written as text, still runs", async () => {
  const replies = [{ text: 'Reading.\n<tool_call>\n<function=Read>\n<parameter=path>\nexport.mjs\n</parameter>\n</function>\n</tool_call>' }, { text: 'It prints CSV.' }];
  const { events, agent } = await run(replies);
  expect(events.filter((e) => e.type === 'tool').map((e) => e.label)).toEqual(['Read']);
  expect(JSON.parse(agent.messages.find((m) => m.tool_calls).tool_calls[0].function.arguments)).toEqual({ path: 'export.mjs' });
});

test('a garbled tool call is kept as {} so later requests stay valid', () => {
  expect(safeArgs('{"path":"a.mjs"}')).toBe('{"path":"a.mjs"}');
  expect(safeArgs('{"path": ')).toBe('{}');
  expect(safeArgs('[1,2]')).toBe('{}');
  expect(safeArgs('')).toBe('{}');
});

test('with thinking on, each request asks for "medium" thinking', async () => {
  const { fake } = await run([{ text: 'It prints CSV.' }]);
  expect(fake.requests.find((r) => r.stream).chat_template_kwargs).toEqual({ enable_thinking: true, reasoning_effort: 'medium' });
});
