import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, safeArgs, claimsAlreadyThere, asksForWork, claimsDone, wantsDesktop, AUTO, CHECK_INS } from '../src/agent/agent.mjs';
// Agentic Coder's "go ahead" nudge, as it reads now (labelled as automatic).
const isNudge = (c) => c.startsWith(AUTO) && c.includes('did not do it');
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';
import { demoReplies } from './demo-script.mjs';

const model = MODELS[DEFAULT_MODEL];
const project = () => { const d = mkdtempSync(join(tmpdir(), 'agentic-agent-')); cpSync(join(import.meta.dir, '..', 'demo-project'), d, { recursive: true }); return d; };

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
  // On auto-accept the first edit is shown as a plan question first (answered yes).
  expect(tools.map((t) => t.label)).toEqual(['Read', 'Update Todos', 'Ask', 'Update', 'Read', 'Update', 'Bash']);
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

test('the same step twice: it asks you for a hint, and the hint goes to the model', async () => {
  const same = { tool: { name: 'Read', args: { path: 'export.mjs' } } };
  const cwd = project();
  const fake = await startFakeServer([same, same, { text: 'Done, the flags are read in export.mjs.' }]);
  const asked = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'edits', flows: false,
    ask: async (req) => { asked.push(req); return req.kind === 'stuck' ? { choice: 'answer', text: 'Look at parseArgs instead' } : { choice: 'yes' }; } });
  const reason = await agent.send('where are the flags read?');
  await fake.close();
  expect(reason).toBe('done');
  const q = asked.find((r) => r.kind === 'stuck');
  expect(q.args.question).toContain('same step twice');
  expect(agent.messages.some((m) => m.role === 'user' && m.content.includes('[Stuck]') && m.content.includes('parseArgs'))).toBe(true);
});

test('three errors in a row: it asks; "Stop here" ends the turn', async () => {
  const bad = (n) => ({ tool: { name: 'Read', args: { path: `missing-${n}.mjs` } } });
  const cwd = project();
  const fake = await startFakeServer([bad(1), bad(2), bad(3), bad(4)]);
  const asked = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'edits', flows: false,
    ask: async (req) => { asked.push(req); return req.kind === 'stuck' ? { choice: 'no' } : { choice: 'yes' }; } });
  const reason = await agent.send('where are the flags read?');
  await fake.close();
  expect(reason).toBe('declined');
  expect(asked.find((r) => r.kind === 'stuck').args.question).toContain('Three steps in a row failed');
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
    || agent.messages.some((m) => m.content?.includes?.('My memory filled up'))).toBe(true);
  // The request itself is never summarized away.
  expect(agent.messages.some((m) => m.role === 'user' && m.content === 'add a --json flag to export.mjs')).toBe(true);
});

test('blocked commands never run, even in auto mode', async () => {
  const replies = [{ tool: { name: 'Bash', args: { command: 'rm -rf node_modules' } } }, { text: 'ok' }];
  const { events } = await run(replies);
  const t = events.find((e) => e.type === 'tool');
  expect(t.view.kind).toBe('denied');
  expect(t.view.message).toContain('rm -rf');
});

test('mid-task, a reply that only announces the next step gets a "go ahead"', async () => {
  const replies = [{ tool: { name: 'Read', args: { path: 'export.mjs' } } }, { text: 'main() returns the CSV. Now I will add the flag:' }, { tool: { name: 'Read', args: { path: 'export.test.mjs' } } }, { text: 'Done: it prints JSON now.' }];
  const { reason, agent, events } = await run(replies);
  expect(reason).toBe('done');
  expect(agent.messages.filter((m) => m.role === 'user' && isNudge(m.content)).length).toBe(1);
  expect(events.filter((e) => e.type === 'tool').length).toBe(2);
});

test('before any tool has run, an announcement is not nudged: the turn ends', async () => {
  const { reason, agent, fake } = await run([{ text: 'I need to change main(). First, I will add the flag:' }, { text: 'never sent' }]);
  expect(reason).toBe('done');
  expect(agent.messages.some((m) => m.role === 'user' && isNudge(m.content))).toBe(false);
  expect(fake.remaining()).toBe(1);
});

test('a reply that asks you something ends the turn, even mid-task and after "I\'ll"', async () => {
  const replies = [{ tool: { name: 'Read', args: { path: 'export.mjs' } } }, { text: 'Should --json print one line or pretty-print? Give me a hint and I\'ll add it.' }, { text: 'never sent' }];
  const { reason, agent, fake } = await run(replies);
  expect(reason).toBe('done');
  expect(agent.messages.some((m) => m.role === 'user' && isNudge(m.content))).toBe(false);
  expect(fake.remaining()).toBe(1);
});

test('the screenshot of 2026-09-26: "hello, can you help me with something?" gets one answer, then Agentic Coder waits', async () => {
  const cwd = project();
  const answer = "Hello! Of course — I can help. What are you working on or trying to figure out? Give me a little detail and I'll dig in.";
  const fake = await startFakeServer([{ reasoning: 'The user is greeting me and asking for help.', text: answer }, { text: 'never sent' }]);
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: true, mode: 'ask', flows: true, ask: async () => ({ choice: 'yes' }) });
  for (const t of ['assistant', 'tool']) agent.on(t, (e) => events.push({ type: t, ...e }));
  const reason = await agent.send('hello , can you help me with something?');
  await fake.close();
  expect(reason).toBe('done');
  expect(fake.requests.length).toBe(1);                      // one reply, no second round
  expect(fake.requests[0].tool_choice).toBe('none');         // tools listed (warm cache) but not allowed
  expect(events.filter((e) => e.type === 'tool')).toEqual([]);
  expect(events.find((e) => e.type === 'assistant').text).toBe(answer);
  expect(agent.messages.some((m) => m.role === 'user' && isNudge(m.content))).toBe(false);
});

test('asksTheUser: a question or a request for input, not code', async () => {
  const { asksTheUser } = await import('../src/agent/agent.mjs');
  expect(asksTheUser("What are you working on? Give me a little detail and I'll dig in.")).toBe(true);
  expect(asksTheUser('Point me to the folder and I will look.')).toBe(true);
  expect(asksTheUser('Now I will update main() to add the flag.')).toBe(false);
  expect(asksTheUser('It uses a ternary, `a ? b : c`, then returns.')).toBe(false);
  expect(asksTheUser('```js\nconst x = y ? 1 : 2;\n```\nDone.')).toBe(false);
});

test('a finished answer is not nudged', async () => {
  const { agent } = await run([{ text: 'Done. All 3 tests pass.' }]);
  expect(agent.messages.some((m) => m.role === 'user' && isNudge(m.content))).toBe(false);
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
  // An offer that waits for the user is where the answer ends (it once went on to search the home folder).
  expect(announcesNextStep('1035. If you actually meant "how is multiplication implemented here" rather than the general concept, tell me and I\'ll dig into the specific file(s).')).toBe(false);
  expect(announcesNextStep('It listens on port 8790. Let me know if you want it changed.')).toBe(false);
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
  expect(agent.messages.some((m) => m.role === 'user' && m.content.startsWith(`${AUTO} The tests fail`))).toBe(true);
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
  expect(fake.requests.find((r) => r.stream).chat_template_kwargs).toEqual({ enable_thinking: true, reasoning_effort: 'high' }); // Gemma's only thinking level
});

test('the walk-out: commands and reads outside the project are refused, even auto-approved', async () => {
  const replies = [
    { tool: { name: 'Bash', args: { command: 'cd ~/Desktop/MAIN2026 && git status' } } },
    { tool: { name: 'Bash', args: { command: 'ls -la ~/Desktop/' } } },
    { tool: { name: 'Read', args: { path: '~/.ssh/config' } } },
    { tool: { name: 'List', args: { path: '../..' } } },
    { tool: { name: 'Bash', args: { command: 'ls' } } },
    { text: 'Done.' },
  ];
  const { events } = await run(replies);
  const tools = events.filter((e) => e.type === 'tool');
  // ~/.ssh/config is the real home file now (it was a missing "~" folder in the project), so it is refused as outside.
  expect(tools.slice(0, 4).map((t) => [t.view.kind, t.error])).toEqual([['denied', true], ['denied', true], ['denied', true], ['denied', true]]);
  expect(tools[0].view.message).toContain('outside the project folder');
  expect(tools[2].view.message).toContain('outside the project folder');
  expect(tools[4].error).toBeFalsy(); // inside still works
});

test('a created file is not "already in place": the model is sent back once', async () => {
  const replies = [
    { tool: { name: 'Write', args: { path: 'report.mjs', content: 'export const x = 1;\n' } } },
    { text: 'The report is already in place and verified.' },
    { text: 'I created report.mjs, which exports x.' },
  ];
  const { events, agent } = await run(replies);
  expect(agent.messages.some((m) => m.role === 'user' && /You created report\.mjs in this turn/.test(m.content))).toBe(true);
  expect(events.filter((e) => e.type === 'assistant' && e.final).at(-1).text).toBe('I created report.mjs, which exports x.');
});

// Qwen, 29 Sep: asked again for the weather page, it answered "Done" and wrote nothing.
test('"done" with no file changed: sent back once, then a note says nothing changed', async () => {
  const { events, agent } = await run([{ text: 'Done! export.mjs now has a --json flag.' }, { text: 'Done.' }]);
  expect(agent.messages.filter((m) => m.role === 'user' && m.content.startsWith(AUTO) && /no file was changed in this message/.test(m.content))).toHaveLength(1);
  expect(events.filter((e) => e.type === 'note').map((e) => e.text)).toContain('Nothing was changed for this request: no file was written or edited.');
});

test('"done" with no file changed: an honest second answer gets no note; a command that ran is not second-guessed', async () => {
  const honest = await run([{ text: 'Done.' }, { text: 'It was in export.mjs before this message; nothing changed now.' }]);
  expect(honest.events.filter((e) => e.type === 'note').some((e) => /Nothing was changed/.test(e.text))).toBe(false);
  expect(honest.events.filter((e) => e.type === 'assistant' && e.final)).toHaveLength(2);
  const ran = await run([{ tool: { name: 'Bash', args: { command: 'ls' } } }, { text: 'Done.' }]);
  expect(ran.agent.messages.some((m) => m.role === 'user' && /no file was changed in this message/.test(m.content))).toBe(false);
});

test('"done" with no file changed: on Model, only with the said-done hook on', () => {
  const agent = new Agent({ url: 'http://127.0.0.1:1', model, cwd: project(), system: 'x' });
  agent.way = 'model'; agent.hooks = new Set();
  expect(agent.hook('said-done')).toBe(false);
  agent.hooks = new Set(['said-done']);
  expect(agent.hook('said-done')).toBe(true);
  agent.way = 'app';
  expect(agent.hook('said-done')).toBe(true);
});

test('asksForWork and claimsDone', () => {
  for (const t of ['add a --json flag to export.mjs', 'make a weather widget page', 'fix the dead button']) expect([t, asksForWork(t)]).toEqual([t, true]);
  for (const t of ['what does export.mjs do?', 'why is the build slow']) expect([t, asksForWork(t)]).toEqual([t, false]);
  for (const t of ['Done.', 'I created weather.html with 5 scenarios.', 'Fixed: the button now swaps the data.']) expect([t, claimsDone(t)]).toEqual([t, true]);
  for (const t of ['Nothing was changed; it was already in export.mjs.', 'I could not find export.mjs.', 'I did not change anything yet.', 'Which file should I use?']) expect([t, claimsDone(t)]).toEqual([t, false]);
});

test('claimsAlreadyThere', () => {
  for (const t of ['The --json flag is already in place and verified', 'It already exists.', 'export.mjs already has a --json flag']) expect([t, claimsAlreadyThere(t)]).toEqual([t, true]);
  for (const t of ['I created export.mjs with a --json flag; node export.mjs --json prints valid JSON.', 'Added the flag; all 3 tests pass.']) expect([t, claimsAlreadyThere(t)]).toEqual([t, false]);
});

// Steering: check-ins while it explores, and the plan before the first edit.
async function steered(replies, ask, { mode = 'edits' } = {}) {
  const cwd = project();
  const fake = await startFakeServer(replies);
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode, flows: false,
    ask: async (req) => { events.push({ type: 'ask', name: req.name, kind: req.kind, question: req.args?.question }); return ask(req); } });
  for (const t of ['tool', 'note']) agent.on(t, (e) => events.push({ type: t, ...e }));
  const reason = await agent.send('add a --json flag to export.mjs');
  await fake.close();
  return { reason, events, cwd, fake };
}
const looks = (n) => Array.from({ length: n }, (_, i) => ({ tool: { name: 'Read', args: { path: i % 2 ? 'export.test.mjs' : 'export.mjs' } } }));
const lastUser = (req) => [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';

test('after 8 looks with no change it checks in, and the answer steers the next step', async () => {
  const { reason, events, fake } = await steered([...looks(8), { text: 'I will look at trades.json next.' }],
    (req) => (req.kind === 'checkin' ? { choice: 'answer', text: 'look at trades.json' } : { choice: 'yes' }));
  expect(reason).toBe('done');
  const checkins = events.filter((e) => e.type === 'ask' && e.kind === 'checkin');
  expect(checkins.length).toBe(1);
  expect(checkins[0].question).toMatch(/looked at 2 things .* Read export\.mjs; Read export\.test\.mjs\. Am I on the right track\?/);
  expect(lastUser(fake.requests[8])).toMatch(/\[Check-in\].*The user answered: look at trades\.json/);
});

test('a check-in answered "keep going" adds nothing; "Stop here" ends the turn', async () => {
  const go = await steered([...looks(8), { text: 'Done looking.' }], (req) => (req.kind === 'checkin' ? { choice: 'answer', text: 'Keep going' } : { choice: 'yes' }));
  expect(go.reason).toBe('done');
  expect(lastUser(go.fake.requests[8])).toBe('add a --json flag to export.mjs');
  const stop = await steered([...looks(8), { text: 'never reached' }], (req) => (req.kind === 'checkin' ? { choice: 'no' } : { choice: 'yes' }));
  expect(stop.reason).toBe('declined');
  expect(stop.fake.requests.length).toBe(CHECK_INS.steps); // it stops at the check-in (after six looks since 28 Sep)
});

test('on auto-accept the first edit is a plan question; an answer other than yes steers instead', async () => {
  const edit = { tool: { name: 'Edit', args: { path: 'export.mjs', old_text: '  return toCsv(rows);', new_text: "  if (argv.includes('--json')) return JSON.stringify(rows);\n  return toCsv(rows);" } } };
  const { events, cwd, fake } = await steered([{ tool: { name: 'Read', args: { path: 'export.mjs' } } }, edit, { text: 'OK, I will ask first.' }],
    (req) => (req.kind === 'plan' ? { choice: 'answer', text: 'add a test for it first' } : { choice: 'yes' }));
  const plan = events.find((e) => e.type === 'ask' && e.kind === 'plan');
  expect(plan.question).toMatch(/^Before I change anything: in export\.mjs, change "return toCsv\(rows\);" to "if \(argv\.includes/);
  expect(readFileSync(join(cwd, 'export.mjs'), 'utf8')).not.toContain('--json');
  expect(fake.requests[2].messages.at(-1).content).toContain('the user wrote: add a test for it first');
  // yes lets this message's edits through, asked once
  const ok = await steered([{ tool: { name: 'Read', args: { path: 'export.mjs' } } }, edit, { text: 'Done.' }], () => ({ choice: 'yes' }));
  expect(ok.events.filter((e) => e.type === 'ask').map((e) => e.kind)).toEqual(['plan']);
  expect(readFileSync(join(ok.cwd, 'export.mjs'), 'utf8')).toContain('--json');
});

// The test of 2026-09-26: "make a txt file on my Desktop with a short story,
// report back". The file was done, then a check shown the story cut at 1,500
// characters said it was "cut off at 'sti'", the note came as the user's, and
// 20 minutes of read-only checks followed, each asking first.
const STORY = `The lake had always been still.\n\n${'The water remembered what the land forgot, and the reeds kept the secret. '.repeat(20)}\n\nLike something that was still, somehow, alive.\n`;

test('the story test: the check sees the whole file, its note is labelled automatic, and "it is fine" ends the turn', async () => {
  const cwd = project();
  const replies = [
    { tool: { name: 'Write', args: { path: 'HELLO TEST 26 SEP.txt', content: STORY } } },
    { text: 'Done. I created HELLO TEST 26 SEP.txt with a short story about a monster in a lake.' },
    { text: '{"done": false, "missing": "the story may end mid-word"}' },   // the check (it can be wrong)
    { text: 'I looked: the file ends "…still, somehow, alive." It is complete.' },
    { text: 'never sent' },
  ];
  const fake = await startFakeServer(replies);
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'edits', flows: false, confirmPlan: false, ask: async () => ({ choice: 'yes' }) });
  const reason = await agent.send('make a txt file titled "HELLO TEST 26 SEP" with a short story about a monster in a lake, report back when done');
  await fake.close();
  expect(STORY.length).toBeGreaterThan(1500);
  expect(reason).toBe('done');
  const check = fake.requests.find((r) => r.messages.some((m) => /Is every part of the request done/.test(m.content ?? '')));
  expect(check.messages.at(-1).content).toContain('Like something that was still, somehow, alive.'); // the whole story, not cut at 1,500
  const note = agent.messages.find((m) => m.role === 'user' && m.content.startsWith(AUTO));
  expect(note.content).toMatch(/can be wrong.*If it is actually fine, say so in one sentence and stop/);
  expect(fake.remaining()).toBe(1); // it said it was fine and stopped: no more steps
});

test('a reply that asks you a question does not run the command that came with it', async () => {
  const replies = [
    { tool: { name: 'Read', args: { path: 'export.mjs' } } },
    { text: 'The file looks complete. Are you seeing it cut off in a specific app?', tool: { name: 'Bash', args: { command: 'tail -c 45 export.mjs | od -c' } } },
    { text: 'never sent' },
  ];
  const { reason, events, fake } = await run(replies);
  expect(reason).toBe('done');
  expect(events.filter((e) => e.type === 'tool').map((e) => e.name)).toEqual(['Read']); // the tail|od never ran
  expect(fake.remaining()).toBe(1);
});

// ————— The chart-bug lessons (26 Sep): thinking kept, cause kept, act on it —————
import { keyLines, namesAFix } from '../src/agent/agent.mjs';

test('keyLines keeps cause and fix sentences, skips hedges and chatter', () => {
  const thought = `Let me check the context of the symbol box. Hmm, maybe the menu is fixed.
So the problem: .hud has z-index:4 and the legend .tv-lg has z-index:4 too, and the legend comes later in the DOM.
The fix is to raise .hud to z-index:5 so its menu paints above the legend.
Now I will read the file again.`;
  const lines = keyLines(thought);
  expect(lines.length).toBe(2);
  expect(lines[0]).toContain('So the problem');
  expect(lines[1]).toContain('The fix is to raise .hud');
  expect(lines.some(namesAFix)).toBe(true);
  expect(keyLines('Maybe the fix is z-index. Let me look around a bit more first.')).toEqual([]);
});

test('its thinking goes back to the model on the next step', async () => {
  const replies = [
    { reasoning: 'The legend and the box are both z-index 4; that is why the list is covered by the legend.', tool: { name: 'Read', args: { path: 'export.mjs' } } },
    { text: 'Done looking.' },
  ];
  const { fake } = await run(replies);
  const assistant = fake.requests.at(-1).messages.find((m) => m.role === 'assistant' && m.tool_calls);
  expect(assistant.reasoning_content).toContain('both z-index 4');
});

test('reading the same unchanged part twice points back instead of re-reading', async () => {
  const read = { tool: { name: 'Read', args: { path: 'export.mjs' } } };
  const replies = [read, read, { text: 'ok' }];
  const { events, fake } = await run(replies);
  const reads = events.filter((e) => e.type === 'tool' && e.name === 'Read');
  expect(reads.length).toBe(2);
  expect(reads[1].view.kind).toBe('same');
  expect(lastToolResult(fake.requests.at(-1))).toContain('already read this part');
});
const lastToolResult = (req) => [...req.messages].reverse().find((m) => m.role === 'tool')?.content ?? '';

test('fixing a bug, it names the fix and keeps looking: one note says make the change now', async () => {
  const cause = 'So the problem: .hud has z-index:4 and the legend has z-index:4 as well. The fix is to raise .hud to z-index:5 in the stylesheet.';
  const replies = [
    { tool: { name: 'Read', args: { path: 'export.mjs' } } },
    { tool: { name: 'Read', args: { path: 'export.test.mjs' } } },
    { reasoning: cause, tool: { name: 'Read', args: { path: 'trades.json' } } },
    { text: 'I checked everything.' },
  ];
  const cwd = project();
  const fake = await startFakeServer(replies);
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: true, mode: 'edits', flows: false, confirmPlan: false, ask: async () => ({ choice: 'yes' }) });
  const reason = await agent.send('fix the bug: the symbol list is hidden behind the legend');
  await fake.close();
  expect(reason).toBe('done');
  const note = agent.messages.find((m) => m.role === 'user' && m.content.includes('make the smallest change'));
  expect(note.content).toStartWith(AUTO);
  expect(note.content).toContain('raise .hud to z-index:5');
});

test('summarizing keeps the request word for word and continues, not restarts', async () => {
  const request = 'fix the bug: the symbol list is hidden behind the legend rows "EMA 13 · 21" and "Vol"';
  const replies = [
    { reasoning: 'The cause is that both are z-index 4, so the later one wins.', tool: { name: 'Read', args: { path: 'export.mjs' } } },
    { text: 'Looked at the file.' },
    { text: 'It read export.mjs and worked out the layering.' }, // the summary
  ];
  const cwd = project();
  const fake = await startFakeServer(replies);
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: true, mode: 'edits', flows: false, confirmPlan: false, ask: async () => ({ choice: 'yes' }) });
  await agent.send(request);
  await agent.compact();
  await fake.close();
  expect(agent.messages[1].content).toBe(request); // word for word, not summarized
  const notes = agent.messages.find((m) => m.role === 'assistant' && m.content.includes('My memory filled up'));
  expect(notes.content).toContain('It read export.mjs');
  expect(notes.content).toContain('The cause is that both are z-index 4'); // the finding, kept word for word
  expect(agent.messages.at(-1).content).toStartWith(AUTO);
  expect(agent.messages.at(-1).content).toContain('Do not start the investigation over');
});

test('when memory fills, old thinking shrinks to its key lines; the newest steps keep theirs', async () => {
  const chatter = 'Let me look at the imports first and see how the file is put together before anything else. ';
  const cause = 'The cause is that toCsv drops the header row when the list is empty.';
  const looksWithThought = Array.from({ length: 5 }, (_, i) => ({ reasoning: chatter.repeat(8) + (i === 1 ? cause : ''), tool: { name: 'Read', args: { path: i % 2 ? 'export.test.mjs' : 'export.mjs' } } }));
  const { agent } = await run([...looksWithThought, { text: 'ok' }], { fakeOpts: { delayMs: 0, chunk: 256 } });
  agent.ctxUsed = agent.ctx * 0.9; // pretend the server reported a nearly full memory
  agent.compact = async () => {}; // only the trim is under test (the fake server is closed)
  await agent.fitContext();
  const thoughts = agent.messages.filter((m) => m.role === 'assistant' && 'reasoning_content' in m);
  expect(thoughts.length).toBeGreaterThan(3);
  for (const m of thoughts.slice(0, -3)) expect(m.reasoning_content ?? '').not.toContain(chatter); // shrunk
  expect(thoughts.some((m) => m.reasoning_content === cause)).toBe(true); // the cause line survived the shrink
  for (const m of thoughts.slice(-3)) expect(m.reasoning_content).toContain(chatter); // the newest keep theirs
});

// ————— Step 7 of the bug steps, enforced by the loop (26 Sep) —————
test('a fix with a named check runs that check after the change, not the whole suite', async () => {
  const replies = [
    { tool: { name: 'Read', args: { path: 'export.mjs' } } },
    { tool: { name: 'Edit', args: { path: 'export.mjs', old_text: '  return toCsv(rows);', new_text: "  if (argv.includes('--json')) return JSON.stringify(rows);\n  return toCsv(rows);" } } },
    { text: 'Fixed it.' },
    { text: '{"done": true, "missing": ""}' },
  ];
  const cwd = project();
  const fake = await startFakeServer(replies);
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'edits', flows: false, confirmPlan: false, ask: async () => ({ choice: 'yes' }) });
  agent.on('tool', (e) => events.push(e));
  await agent.send('fix the crash in export.mjs. This check fails now and must pass: `node export.mjs`');
  await fake.close();
  const bash = events.filter((e) => e.name === 'Bash').map((e) => e.arg);
  expect(bash).toEqual(['node export.mjs']); // the named check, not npm test
});

test('a layout-kind fix with no named check never auto-runs the test suite', async () => {
  const replies = [
    { tool: { name: 'Read', args: { path: 'export.mjs' } } },
    { tool: { name: 'Edit', args: { path: 'export.mjs', old_text: '  return toCsv(rows);', new_text: '  return toCsv(rows); // layer' } } },
    { text: 'Raised the layer.' },
    { text: '{"done": true, "missing": ""}' },
  ];
  const cwd = project();
  const fake = await startFakeServer(replies);
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'edits', flows: false, confirmPlan: false, ask: async () => ({ choice: 'yes' }) });
  agent.on('tool', (e) => events.push(e));
  await agent.send('fix it: the symbol list is hidden behind the legend, covered by it');
  await fake.close();
  expect(events.filter((e) => e.name === 'Bash').length).toBe(0); // a browser check is the model's job; the suite would only mislead
});

// ————— A cut-off Write that already holds a good part of the file (countdown card, 1 Oct) —————
test('keptPart: the whole lines a cut-off Write had sent, from 20 lines on; an escaped backslash is not a line break', async () => {
  const { keptPart, keptWriteNote, KEEP_FROM } = await import('../src/agent/agent.mjs');
  const lines = Array.from({ length: 25 }, (_, i) => `<p>line ${i + 1} "q" \\ end</p>`);
  const args = JSON.stringify({ path: 'card.html', content: `${lines.join('\n')}\n<div class="hal` }).slice(0, -2);
  const k = keptPart(args);
  expect(k.lines).toBe(25);
  expect(k.content).toBe(lines.join('\n'));
  expect(keptPart(JSON.stringify({ path: 'a.html', content: 'one\ntwo\nthree' }))).toBeNull(); // under KEEP_FROM lines
  expect(KEEP_FROM).toBe(20);
  // A literal backslash-n in the file (JSON "\\\\n") is not where a line ends.
  const tricky = `{"path":"a.js","content":"${Array.from({ length: 21 }, () => 'x').join('\\n')}\\nconst s = 'a\\\\nb`;
  expect(keptPart(tricky).content.endsWith("x")).toBe(true);
  expect(keptPart('{"path":"a.html"')).toBeNull();
  const note = keptWriteNote('card.html', k);
  expect(note).toContain('its first 25 lines');
  expect(note).toContain('Carry on from line 26');
  expect(note).toContain(lines.slice(-3).join('\n'));
});

test('a Write cut off at the reply limit with 30 whole lines saves them, and the model carries on with Edit', async () => {
  const lines = Array.from({ length: 30 }, (_, i) => `<p>part one, line ${i + 1}</p>`);
  const cut = { tool: { name: 'Write', args: { path: 'card.html', content: `${lines.join('\n')}\n<p>part one, li` } }, finish: 'length' };
  const replies = [cut,
    { tool: { name: 'Edit', args: { path: 'card.html', old_text: lines.slice(-2).join('\n'), new_text: `${lines.slice(-2).join('\n')}\n<p>part two</p>` } } },
    { text: 'The card is finished.' }, { text: '{"done": true, "missing": ""}' }];
  const cwd = project();
  const fake = await startFakeServer(replies);
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'edits', flows: false, confirmPlan: false, ask: async () => ({ choice: 'yes' }) });
  for (const t of ['tool', 'note', 'reply-dropped']) agent.on(t, (e) => events.push({ type: t, ...(e ?? {}) }));
  const reason = await agent.send('make card.html, a countdown card');
  await fake.close();
  expect(reason).toBe('done');
  // The cut reply's row goes first, then the note says what happens.
  const dropped = events.findIndex((e) => e.type === 'reply-dropped');
  const said = events.findIndex((e) => e.type === 'note' && /^File too long for one reply \(cut at .+\): saving its first 30 lines, then carrying on from there$/.test(e.text));
  expect(dropped).toBeGreaterThanOrEqual(0);
  expect(said).toBeGreaterThan(dropped);
  const writes = events.filter((e) => e.type === 'tool' && e.name === 'Write');
  expect(writes.length).toBe(1);
  expect(writes[0].error).toBeFalsy();
  const told = agent.messages.find((m) => m.role === 'user' && m.content.includes('Carry on from line 31'));
  expect(told.content).toStartWith(AUTO);
  expect(readFileSync(join(cwd, 'card.html'), 'utf8')).toBe(`${lines.join('\n')}\n<p>part two</p>`);
});

// ————— A Write too big for one reply (the finance-dashboard bug, 26 Sep) —————
test('a Write cut off at the reply limit never runs; the model is told to build the file in parts', async () => {
  const cut = { tool: { name: 'Write', args: { path: 'dashboard.html', content: '<html><head><style>body{margin:0' } }, finish: 'length' };
  const replies = [cut, { tool: { name: 'Write', args: { path: 'dashboard.html', content: '<html><!-- skeleton --></html>' } } }, { text: 'Skeleton written; adding sections next.' }, { text: '{"done": true, "missing": ""}' }];
  const cwd = project();
  const fake = await startFakeServer(replies);
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'edits', flows: false, confirmPlan: false, ask: async () => ({ choice: 'yes' }) });
  for (const t of ['tool', 'note']) agent.on(t, (e) => events.push({ type: t, ...e }));
  const reason = await agent.send('make dashboard.html, a finance dashboard');
  await fake.close();
  expect(reason).toBe('done');
  expect(events.some((e) => e.type === 'note' && /^File too long for one reply \(cut at .+\): asked it to build dashboard\.html in parts$/.test(e.text))).toBe(true);
  const note = agent.messages.find((m) => m.role === 'user' && m.content.includes('skeleton'));
  expect(note.content).toStartWith(AUTO);
  expect(note.content).toContain('dashboard.html');
  const writes = events.filter((e) => e.type === 'tool' && e.name === 'Write');
  expect(writes.length).toBe(1); // only the skeleton Write ran; the cut one never did
  expect(writes[0].error).toBeFalsy();
  expect(readFileSync(join(cwd, 'dashboard.html'), 'utf8')).toContain('skeleton');
});

test('three cut-off calls in a row stop the turn instead of looping for half an hour', async () => {
  const cut = { tool: { name: 'Write', args: { path: 'big.html', content: '<html>' } }, finish: 'length' };
  const cwd = project();
  const fake = await startFakeServer([cut, cut, cut, { text: 'never reached' }]);
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'edits', flows: false, confirmPlan: false, ask: async () => ({ choice: 'yes' }) });
  agent.on('note', (e) => events.push(e));
  const reason = await agent.send('make big.html');
  await fake.close();
  expect(reason).toBe('stuck');
  expect(events.some((e) => /cut off mid-call, so it stopped/.test(e.text))).toBe(true);
  expect(fake.remaining()).toBe(1);
});

// Qwen, 30 Sep, started from the home folder: "download it to my desktop" was saved as
// ~/media-player-card.html, "copied" onto itself, `open` was stopped by the fence, and the
// answer said it was on the Desktop. The Desktop step: sent back once with the command that
// moves it; from a project, the app offers a copy; on the app's screen the page then opens.
test('a request that wants its file on the Desktop, and the screen sizes that are not', () => {
  for (const t of ['Create a card. download it to my desktop when you are done', 'downlaod to my desktop', 'Make a page on my Desktop', 'save it in ~/Desktop', 'put the card on the desktop', 'save to desktop']) expect(wantsDesktop(t)).toBe(true);
  for (const t of ['make a desktop app', 'it looks broken on desktop', 'make the button bigger in the desktop view', 'check it on the desktop and mobile', 'fix the desktop layout', 'what is on the menu']) expect(wantsDesktop(t)).toBe(false);
});

const CARD = '<!doctype html><html><head><meta charset="utf-8"><title>Card</title></head><body><p>Midnight Drive</p></body></html>';
const desktopAgent = (fake, { cwd, home, ask, openPage }) => new Agent({ url: fake.url, model, cwd, home, system: systemPrompt({ cwd, git: 'test', tests: null }), thinking: false, mode: 'edits', flows: false, verify: false, confirmPlan: false, checkIns: false, ask, openPage });

test('from the home folder, a page asked for on the Desktop but saved beside it goes back once to be moved, then opens', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-home-'));
  mkdirSync(join(home, 'Desktop'));
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'card.html', content: CARD } } },
    { text: 'The card is ready on your Desktop at ~/card.html.' },
    { tool: { name: 'Bash', args: { command: 'mv card.html Desktop/card.html' } } },
    { text: 'Moved it: it is at ~/Desktop/card.html now.' },
    { text: 'never sent' },
  ]);
  const opened = [];
  const notes = [];
  const agent = desktopAgent(fake, { cwd: home, home, ask: async () => ({ choice: 'yes' }), openPage: (p) => { opened.push(p); } });
  agent.on('note', (e) => notes.push(e.text));
  const reason = await agent.send('Create a self-contained HTML file for a media player card. download it to my desktop when you are done');
  await fake.close();
  expect(reason).toBe('done');
  const back = fake.requests[2].messages.at(-1).content;
  expect(back).toStartWith(AUTO);
  expect(back).toContain('The request asks for the file on the Desktop, but ~/card.html is not on the Desktop. Move it there with Bash: mv card.html Desktop/card.html.');
  expect(notes).toContain('Asked for on the Desktop, but ~/card.html is not there; asked it to move it.');
  expect(existsSync(join(home, 'Desktop', 'card.html'))).toBe(true);
  expect(opened).toEqual([join(home, 'Desktop', 'card.html')]);
  expect(notes.at(-1)).toBe('Opened ~/Desktop/card.html in your browser.');
  expect(fake.remaining()).toBe(1); // sent back once, then done
});

test('from a project, a page asked for on the Desktop is offered to be copied there (as -v2 beside an older one), then opens', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-home-'));
  const cwd = join(home, 'shop');
  mkdirSync(cwd); mkdirSync(join(home, 'Desktop'));
  writeFileSync(join(home, 'Desktop', 'card.html'), 'the first one');
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'card.html', content: CARD } } },
    { text: 'I made card.html in this folder.' },
    { text: 'never sent' },
  ]);
  const asked = [];
  const opened = [];
  const ask = async (req) => {
    if (req.name !== 'Ask') return { choice: 'yes' };
    asked.push(req.args.question);
    return { choice: 'answer', text: req.args.options[0] };
  };
  const reason = await desktopAgent(fake, { cwd, home, ask, openPage: (p) => { opened.push(p); } }).send('make a media player card page and put it on my desktop');
  await fake.close();
  expect(reason).toBe('done');
  expect(fake.remaining()).toBe(1); // nothing sent back: the Desktop is outside this folder
  expect(asked).toEqual(['Copy card.html to your Desktop as card-v2.html? It is in ~/shop now.']);
  expect(readFileSync(join(home, 'Desktop', 'card.html'), 'utf8')).toBe('the first one'); // the original is kept
  expect(readFileSync(join(home, 'Desktop', 'card-v2.html'), 'utf8')).toBe(CARD);
  expect(opened).toEqual([join(home, 'Desktop', 'card-v2.html')]);
});

test('without the app\'s screen (coding -p, the benches) nothing is offered, copied or opened; a no leaves it where it is', async () => {
  // each run in a folder of its own: writing the same page again changes nothing
  const folders = () => {
    const home = mkdtempSync(join(tmpdir(), 'agentic-home-'));
    const cwd = join(home, 'shop');
    mkdirSync(cwd); mkdirSync(join(home, 'Desktop'));
    return { home, cwd };
  };
  const script = () => [{ tool: { name: 'Write', args: { path: 'card.html', content: CARD } } }, { text: 'I made card.html.' }];
  const asked = [];
  const ask = async (req) => { if (req.name === 'Ask') asked.push(req.args.question); return req.name === 'Ask' ? { choice: 'answer', text: 'No, leave it there' } : { choice: 'yes' }; };
  let fake = await startFakeServer(script());
  const first = folders();
  await desktopAgent(fake, { ...first, ask }).send('make a card page and put it on my desktop');
  await fake.close();
  expect(asked).toEqual([]);
  expect(existsSync(join(first.home, 'Desktop', 'card.html'))).toBe(false);
  const opened = [];
  fake = await startFakeServer(script());
  const second = folders();
  await desktopAgent(fake, { ...second, ask, openPage: (p) => { opened.push(p); } }).send('make a card page and put it on my desktop');
  await fake.close();
  expect(asked).toEqual(['Copy card.html to your Desktop? It is in ~/shop now.']);
  expect(existsSync(join(second.home, 'Desktop', 'card.html'))).toBe(false);
  expect(opened).toEqual([]);
});

// `open ~/media-player-card.html` was stopped by the fence with the files hint, whose words
// ("outside the project folder") made agent.mjs add "answer from the note now" (30 Sep).
test('a blocked app gets its own hint, without the words that send it back to the note', async () => {
  const { fenceHint } = await import('../src/tools/sandbox.mjs');
  const app = fenceHint('zsh:1: operation not permitted: open');
  expect(app).toContain('Apps cannot be started from here, so do not try again: say where the file is, with its full path.');
  expect(app).not.toMatch(/outside the project folder/);
  expect(fenceHint('zsh:1: operation not permitted: osascript')).toContain('Apps cannot be started');
  expect(fenceHint('cat: /Users/x/a.txt: Operation not permitted')).toContain('Files outside the project folder cannot be read or changed');
  expect(fenceHint('all fine')).toBe('');
});
