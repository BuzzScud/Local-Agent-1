// Who decides: the app (as before) or the model (agent/way.mjs), on the walkthrough's own
// example, the tax question, and the pieces each way changes.
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, AUTO, MAX_CALLS } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { toolSchemas, MODEL_TOOL_DEFS } from '../src/agent/tools.mjs';
import { wayPrompt, hooksOn, hooksFrom, changeHooks, hookRows, HOOKS, MODEL_HOOKS, MODEL_TOOL_LINES, ONE_AT_A_TIME, ANSWER_HABIT } from '../src/agent/way.mjs';
import { decide } from '../src/agent/permissions.mjs';
import { AutoSave } from '../src/app/autosave.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';

const model = MODELS[DEFAULT_MODEL];
const Q = "Which function computes tax in this project, and what is its default rate? Don't change any files.";
const BILLING = `// Order totals.
export function subtotal(lines) {
  return lines.reduce((sum, l) => sum + l.price * l.qty, 0);
}

export function addTax(amount, rate = 0.0825) {
  return Math.round(amount * (1 + rate) * 100) / 100;
}
`;
const CHECKOUT = `import { subtotal, addTax } from './billing.mjs';

export function total(lines) {
  return addTax(subtotal(lines));
}
`;
// The walkthrough's project: two code files and a package.json (a code project).
function taxProject() {
  const d = mkdtempSync(join(tmpdir(), 'agentic-way-'));
  writeFileSync(join(d, 'billing.mjs'), BILLING);
  writeFileSync(join(d, 'checkout.mjs'), CHECKOUT);
  writeFileSync(join(d, 'package.json'), '{"name":"shop","type":"module"}\n');
  return d;
}

async function agentOn(way, replies, { mode = 'ask', answer = 'yes', hooks, memory = null, cwd = taxProject(), flows = true } = {}) {
  const fake = await startFakeServer(replies);
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, ctx: 32768, mode, flows, way, hooks, memory,
    ask: async (req) => { events.push({ type: 'ask', name: req.name, kind: req.kind }); return { choice: answer }; } });
  for (const t of ['assistant', 'tool', 'note', 'sorted', 'route', 'way']) agent.on(t, (e) => events.push({ type: t, ...e }));
  return { agent, fake, events, cwd };
}
const chats = (fake) => fake.requests.filter((r) => r.stream && r.messages);
const toolsOf = (events) => events.filter((e) => e.type === 'tool');

test('the prompt on Model: its own tool lines and the answer habit; back to App word for word', () => {
  const app = systemPrompt({ cwd: taxProject(), git: 'test' });
  expect(app).toContain(ONE_AT_A_TIME);
  const m = wayPrompt(app, 'model');
  expect(m).not.toContain(ONE_AT_A_TIME);
  expect(m).toContain(MODEL_TOOL_LINES);
  expect(m).toContain(ANSWER_HABIT);
  expect(wayPrompt(m, 'model')).toBe(m);
  expect(wayPrompt(m, 'app')).toBe(app);
  expect(wayPrompt(app, 'app')).toBe(app);
  // The session's part (after SESSION_MARK) is the same both ways: only the shared part changes.
  expect(m.slice(m.indexOf('This session\n'))).toBe(app.slice(app.indexOf('This session\n')));
});

test('the tools: nine on App, fourteen on Model, Read with paths only on Model', () => {
  const names = (w) => toolSchemas(w).map((t) => t.function.name);
  expect(names('app')).toEqual(['Read', 'List', 'Search', 'Edit', 'Write', 'Bash', 'TodoWrite', 'Ask', 'Jobs']);
  // Jobs (background commands, 3 Oct 2026) after each way's own tools.
  expect(names('model')).toEqual([...names('app').slice(0, -1), ...MODEL_TOOL_DEFS.map((d) => d.name), 'Jobs']);
  expect(toolSchemas('app')[0].function.parameters.properties.paths).toBeUndefined();
  expect(toolSchemas('model')[0].function.parameters.properties.paths.type).toBe('array');
});

test('the tax question on App: sorted by word rules, the files read for the model, one call a reply', async () => {
  const { agent, fake, events, cwd } = await agentOn('app', [{ text: 'The function is addTax in billing.mjs; its default rate is 0.0825 (8.25%).' }]);
  expect(await agent.send(Q)).toBe('done');
  await fake.close();
  expect(events.find((e) => e.type === 'sorted')?.text).toMatch(/question/);
  // Both files were given before the model's first word (given: the app read them).
  expect(toolsOf(events).filter((t) => t.given).map((t) => t.arg).sort()).toEqual(['billing.mjs', 'checkout.mjs']);
  const first = chats(fake)[0];
  expect(first.parallel_tool_calls).toBe(false);
  expect(first.tools.map((t) => t.function.name)).not.toContain('Map');
  expect(readFileSync(join(cwd, 'billing.mjs'), 'utf8')).toBe(BILLING);
});

test('the tax question on Model: no sorting, nothing read ahead; it reads both files in one reply, then answers', async () => {
  const { agent, fake, events, cwd } = await agentOn('model', [
    { tools: [{ name: 'Read', args: { path: 'billing.mjs' } }, { name: 'Read', args: { path: 'checkout.mjs' } }] },
    { text: 'addTax in billing.mjs computes tax; its default rate is 0.0825 (8.25%). Used once: checkout.mjs calls it in total(). addTax(100) = 108.25.' },
  ]);
  expect(await agent.send(Q)).toBe('done');
  await fake.close();
  expect(events.some((e) => e.type === 'sorted' || e.type === 'route')).toBe(false);
  const reqs = chats(fake);
  // Two model replies: the reads, then the answer. No sort request, no clarify request before them.
  expect(reqs.length).toBe(2);
  expect(reqs[0].parallel_tool_calls).toBe(true);
  // CodeSearch only when the code search can run, which it cannot here (shootout-fixes.test.mjs, 4 Oct 2026).
  expect(reqs[0].tools.map((t) => t.function.name)).toEqual(expect.arrayContaining(['Map', 'Rename', 'TestFirst', 'Remember']));
  expect(reqs[0].tools.map((t) => t.function.name)).not.toContain('CodeSearch');
  // The first request holds only the system prompt and the question: nothing read ahead.
  expect(reqs[0].messages.map((m) => m.role)).toEqual(['system', 'user']);
  expect(reqs[0].messages[0].content).toContain(MODEL_TOOL_LINES);
  const reads = toolsOf(events);
  expect(reads.map((t) => [t.label, t.arg, Boolean(t.given)])).toEqual([['Read', 'billing.mjs', false], ['Read', 'checkout.mjs', false]]);
  // The second request: one assistant message with both calls, then a result for each, in order.
  const m = reqs[1].messages;
  const call = m.find((x) => x.role === 'assistant' && x.tool_calls);
  expect(call.tool_calls.map((c) => JSON.parse(c.function.arguments).path)).toEqual(['billing.mjs', 'checkout.mjs']);
  const results = m.filter((x) => x.role === 'tool');
  expect(results.map((r) => r.tool_call_id)).toEqual(call.tool_calls.map((c) => c.id));
  expect(results[0].content).toContain('addTax');
  expect(results[1].content).toContain('total(lines)');
  expect(readFileSync(join(cwd, 'billing.mjs'), 'utf8')).toBe(BILLING);
  // The settled record names no kind: nothing sorted it.
  expect(agent.lessons.at(-1).kind).toBe(null);
});

test('Read with paths (one call for Gemma, which sends one call a reply): each file on screen, one result', async () => {
  const { agent, fake, events } = await agentOn('model', [{ tool: { name: 'Read', args: { paths: ['billing.mjs', 'checkout.mjs'] } } }, { text: 'addTax, 0.0825.' }]);
  await agent.send(Q);
  await fake.close();
  expect(toolsOf(events).map((t) => t.arg)).toEqual(['billing.mjs', 'checkout.mjs']);
  const result = chats(fake)[1].messages.filter((x) => x.role === 'tool');
  expect(result.length).toBe(1);
  expect(result[0].content).toMatch(/billing\.mjs \(\d+ lines\)[\s\S]*checkout\.mjs \(\d+ lines\)/);
  // Both count as read: an Edit of either is allowed next (Claude Code's rule, read before edit).
  expect(agent.readFiles.size).toBe(2);
});

test('a question on App locks the files; on Model your mode decides (ask: the edit asks, no stops it)', async () => {
  const edit = { tool: { name: 'Edit', args: { path: 'billing.mjs', old_text: 'rate = 0.0825', new_text: 'rate = 0.09' } } };
  const read = { tool: { name: 'Read', args: { path: 'billing.mjs' } } };
  const a = await agentOn('app', [edit, { text: 'addTax, 0.0825.' }], { mode: 'edits' });
  await a.agent.send(Q);
  await a.fake.close();
  expect(toolsOf(a.events).find((t) => t.label === 'Update')?.view.message).toBe('A question changes no files');
  const m = await agentOn('model', [read, edit, { text: 'unused' }], { mode: 'ask', answer: 'no' });
  expect(await m.agent.send(Q)).toBe('declined');
  await m.fake.close();
  expect(m.events.filter((e) => e.type === 'ask').map((e) => e.name)).toEqual(['Edit']);
  expect(readFileSync(join(m.cwd, 'billing.mjs'), 'utf8')).toBe(BILLING);
  // Plan mode is the lock on both ways.
  const p = await agentOn('model', [read, edit, { text: 'addTax, 0.0825.' }], { mode: 'plan' });
  await p.agent.send(Q);
  await p.fake.close();
  expect(toolsOf(p.events).find((t) => t.label === 'Update')?.view.message).toMatch(/plan mode/);
});

test('a call that ends the turn ends the rest of its reply: each gets a result that says so', async () => {
  const m = await agentOn('model', [
    { tool: { name: 'Read', args: { path: 'billing.mjs' } } },
    { tools: [{ name: 'Edit', args: { path: 'billing.mjs', old_text: 'rate = 0.0825', new_text: 'rate = 0.09' } }, { name: 'Read', args: { path: 'checkout.mjs' } }] },
  ], { mode: 'ask', answer: 'no' });
  expect(await m.agent.send('make the tax rate 9% in billing.mjs')).toBe('declined');
  await m.fake.close();
  const results = m.agent.messages.filter((x) => x.role === 'tool');
  expect(results.at(-1).content).toBe('Not run: a call before it in the same reply ended the turn.');
  expect(toolsOf(m.events).map((t) => t.arg)).toEqual(['billing.mjs', 'billing.mjs']); // the second Read never ran
});

test('the hooks: on Model an empty answer stands unless the Empty reply hook is on; on App it always goes back', async () => {
  const empty = [{ text: '' }, { text: 'addTax, 0.0825.' }];
  const off = await agentOn('model', empty);
  await off.agent.send(Q);
  await off.fake.close();
  expect(chats(off.fake).length).toBe(1);
  expect(off.events.find((e) => e.type === 'note')?.text).toMatch(/empty answer.*\/hooks on empty/);
  const on = await agentOn('model', empty, { hooks: ['empty'] });
  await on.agent.send(Q);
  await on.fake.close();
  expect(chats(on.fake).length).toBe(2);
  expect(chats(on.fake)[1].messages.at(-1).content).toBe(`${AUTO} Reply to the user now, in one to three sentences.`);
  const app = await agentOn('app', empty);
  await app.agent.send(Q);
  await app.fake.close();
  expect(chats(app.fake).length).toBe(2);
});

test('the hooks: "you said what you will do" goes back on App, not on Model with the hook off', async () => {
  const replies = () => [{ tool: { name: 'Read', args: { path: 'billing.mjs' } } }, { text: 'Now I will update the rate in billing.mjs.' }, { text: 'Stopping here.' }];
  const app = await agentOn('app', replies(), { mode: 'edits', flows: false });
  await app.agent.send('make the tax rate configurable in billing.mjs');
  await app.fake.close();
  const model = await agentOn('model', replies(), { mode: 'edits' });
  await model.agent.send('make the tax rate configurable in billing.mjs');
  await model.fake.close();
  const nudged = (a) => a.agent.messages.some((x) => x.role === 'user' && String(x.content).includes('did not do it'));
  expect(nudged(app)).toBe(true);
  expect(nudged(model)).toBe(false);
  expect(chats(model.fake).length).toBe(2);
});

test('the plan question before the first change on auto-accept: App asks it, Model does not (the plan hook)', async () => {
  const replies = () => [{ tool: { name: 'Read', args: { path: 'billing.mjs' } } }, { tool: { name: 'Edit', args: { path: 'billing.mjs', old_text: 'rate = 0.0825', new_text: 'rate = 0.09' } } }, { text: 'Done: 9%.' }];
  const app = await agentOn('app', replies(), { mode: 'edits', flows: false });
  await app.agent.send('set the default tax rate in billing.mjs to 0.09');
  await app.fake.close();
  expect(app.events.filter((e) => e.type === 'ask').map((e) => e.kind)).toContain('plan');
  const model = await agentOn('model', replies(), { mode: 'edits' });
  await model.agent.send('set the default tax rate in billing.mjs to 0.09');
  await model.fake.close();
  expect(model.events.filter((e) => e.type === 'ask')).toEqual([]);
  expect(readFileSync(join(model.cwd, 'billing.mjs'), 'utf8')).toContain('rate = 0.09');
});

test('a greeting on Model goes to the model with its tools (no word rule answers it)', async () => {
  const m = await agentOn('model', [{ text: 'Hello! What would you like to work on?' }]);
  await m.agent.send('hello');
  await m.fake.close();
  expect(chats(m.fake)[0].tool_choice).toBe('auto');
  expect(chats(m.fake)[0].parallel_tool_calls).toBe(true);
});

test('Map: the project map when the model asks for it', async () => {
  const d = taxProject();
  for (const n of ['a', 'b', 'c']) writeFileSync(join(d, `${n}.mjs`), `export function ${n}One() { return 1; }\n`);
  const m = await agentOn('model', [{ tool: { name: 'Map', args: {} } }, { text: 'Five code files.' }], { cwd: d });
  await m.agent.send('what is in this project?');
  await m.fake.close();
  const result = chats(m.fake)[1].messages.find((x) => x.role === 'tool').content;
  expect(result).toMatch(/^Code files in the project/);
  expect(result).toContain('billing.mjs');
  expect(result).toContain('addTax');
  expect(toolsOf(m.events)[0]).toMatchObject({ label: 'Map', view: { kind: 'list' } });
});

test('CodeSearch with the code search off says so and points at Search', async () => {
  const m = await agentOn('model', [{ tool: { name: 'CodeSearch', args: { query: 'computes tax' } } }, { text: 'ok' }]);
  await m.agent.send('where is tax computed?');
  await m.fake.close();
  expect(chats(m.fake)[1].messages.find((x) => x.role === 'tool').content).toMatch(/code search is off here.*Use Search/);
});

test('Rename: the built-in rename, run when the model calls it; refused in plan mode', async () => {
  const m = await agentOn('model', [{ tool: { name: 'Rename', args: { from: 'addTax', to: 'withTax' } } }, { text: 'Renamed.' }], { mode: 'edits' });
  await m.agent.send('addTax should be called withTax');
  await m.fake.close();
  expect(readFileSync(join(m.cwd, 'billing.mjs'), 'utf8')).toContain('export function withTax(');
  expect(readFileSync(join(m.cwd, 'checkout.mjs'), 'utf8')).toContain('return withTax(subtotal(lines));');
  expect(chats(m.fake)[1].messages.find((x) => x.role === 'tool').content).toMatch(/^Renamed addTax to withTax: 3 uses in 2 files/);
  const p = await agentOn('model', [{ tool: { name: 'Rename', args: { from: 'addTax', to: 'withTax' } } }, { text: 'Plan mode.' }], { mode: 'plan' });
  await p.agent.send('addTax should be called withTax');
  await p.fake.close();
  expect(readFileSync(join(p.cwd, 'billing.mjs'), 'utf8')).toBe(BILLING);
  expect(toolsOf(p.events)[0].view.message).toMatch(/plan mode/);
});

test('TestFirst outside a code project hands the work back to the model', async () => {
  const d = mkdtempSync(join(tmpdir(), 'agentic-way-empty-'));
  const m = await agentOn('model', [{ tool: { name: 'TestFirst', args: { task: 'fix the bug' } } }, { text: 'ok' }], { cwd: d, mode: 'edits' });
  await m.agent.send('fix the bug');
  await m.fake.close();
  expect(chats(m.fake)[1].messages.find((x) => x.role === 'tool').content).toMatch(/works in a project folder with code/);
});

test('Remember: the model saves one fact, a line says so; nothing is saved with the memory off', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-way-home-'));
  const before = process.env.AGENTIC_MEMORY_SAVE;
  delete process.env.AGENTIC_MEMORY_SAVE;
  try {
    const m = await agentOn('model', [{ tool: { name: 'Remember', args: { fact: 'This shop project runs its checks with node --test.', about: 'project' } } }, { text: 'Noted.' }], { memory: { home, embedder: null } });
    await m.agent.send('we always run the checks with node --test here');
    await m.fake.close();
    expect(m.events.find((e) => e.type === 'note' && /^Memory: 1 saved/.test(e.text))).toBeTruthy();
    const dir = join(m.cwd, '.agentic', 'memory');
    const saved = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md').map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    expect(saved).toContain('runs its checks with node --test');
  } finally { if (before === undefined) delete process.env.AGENTIC_MEMORY_SAVE; else process.env.AGENTIC_MEMORY_SAVE = before; }
  const off = await agentOn('model', [{ tool: { name: 'Remember', args: { fact: 'The user likes short answers.', about: 'you' } } }, { text: 'ok' }]);
  await off.agent.send('I like short answers');
  await off.fake.close();
  expect(chats(off.fake)[1].messages.find((x) => x.role === 'tool').content).toMatch(/^Not saved: the memory is off/);
});

test('switching the way mid-conversation changes the prompt and the tools for the next message', async () => {
  const { agent, fake, events } = await agentOn('app', [{ text: 'one' }, { text: 'two' }]);
  await agent.send('what does billing.mjs do?');
  expect(agent.setWay('model')).toBe(true);
  expect(agent.setWay('model')).toBe(false);
  expect(events.filter((e) => e.type === 'way').map((e) => e[0] ?? e)).toHaveLength(1);
  expect(agent.messages[0].content).toContain(MODEL_TOOL_LINES);
  await agent.send('and checkout.mjs?');
  await fake.close();
  const [a, b] = chats(fake).slice(-2);
  expect(a.tools.length).toBe(9);
  expect(b.tools.length).toBe(14); // the app's eight, the model's own four (no CodeSearch: the code search is off here), Jobs, and Agent (a helper)
  expect(b.tools.at(-1).function.name).toBe('Agent');
  agent.setWay('app');
  expect(agent.messages[0].content).toContain(ONE_AT_A_TIME);
});

test('at most MAX_CALLS calls of one reply run', async () => {
  const many = Array.from({ length: MAX_CALLS + 3 }, () => ({ name: 'List', args: { path: '.' } }));
  const m = await agentOn('model', [{ tools: many }, { text: 'ok' }]);
  await m.agent.send('list the folder');
  await m.fake.close();
  expect(toolsOf(m.events).length).toBe(MAX_CALLS);
  expect(chats(m.fake)[1].messages.filter((x) => x.role === 'tool').length).toBe(MAX_CALLS);
});

test('the hooks list, /hooks and the permission rules of the new tools', () => {
  expect(hooksOn('all').size).toBe(HOOKS.length);
  expect([...hooksOn('empty, tests nope')]).toEqual(['empty', 'tests']);
  expect(hooksOn(undefined).size).toBe(0);
  expect([...hooksFrom({}, {})]).toEqual(MODEL_HOOKS);
  expect([...hooksFrom({ hooks: [] }, {})]).toEqual([]);
  expect([...hooksFrom({ hooks: ['layout', 'empty'] }, {})]).toEqual(['empty', 'layout']);
  expect([...hooksFrom({ hooks: ['layout'] }, { AGENTIC_HOOKS: 'off' })]).toEqual([]);
  const r = changeHooks(new Set(), 'on', '1', {});
  expect(r.changed).toBe(true);
  expect([...r.on]).toEqual(['empty']);
  expect(changeHooks(r.on, 'on', 'empty', {}).changed).toBe(false);
  expect(changeHooks(new Set(), 'on', 'nothing', {}).text).toMatch(/no hook "nothing"/);
  expect(changeHooks(new Set(), 'on', 'all', { AGENTIC_HOOKS: 'off' }).text).toMatch(/AGENTIC_HOOKS=off/);
  expect(hookRows(new Set(['tests']), 'model')[3][0][0][0]).toMatch(/on/);
  expect(hookRows(new Set(), 'model')[0][0][0][0]).toMatch(/off/);
  expect(decide('Map', {}, { mode: 'plan' }).decision).toBe('allow');
  expect(decide('Remember', {}, { mode: 'plan' }).decision).toBe('allow');
  expect(decide('TestFirst', {}, { mode: 'plan' }).decision).toBe('deny');
  expect(decide('Rename', {}, { mode: 'edits' }).decision).toBe('allow');
});

test('the save after a task (and at quit) is the app deciding: off while the model decides', () => {
  const agent = { memory: { home: '/tmp' }, way: 'model', lessons: [], slots: { side: 1 } };
  const before = process.env.AGENTIC_MEMORY_SAVE;
  delete process.env.AGENTIC_MEMORY_SAVE;
  try {
    expect(new AutoSave({ agent }).on).toBe(false);
    expect(new AutoSave({ agent: { ...agent, way: 'app' } }).on).toBe(true);
  } finally { if (before !== undefined) process.env.AGENTIC_MEMORY_SAVE = before; }
});
