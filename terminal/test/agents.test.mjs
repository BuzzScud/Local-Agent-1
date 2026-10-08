// Helpers (subagents): the Agent tool hands one piece of work to a second agent
// with a fresh conversation, and only its report comes back. On this Mac it runs
// on the server's side slot; an explore helper only reads; a general one may edit
// (each change asked about as the mode says); several at once on the Claude API
// run side by side; esc stops one. Against stand-in servers (fake-server.mjs,
// fake-anthropic.mjs); the real model does it in the Subagent check.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { startFakeAnthropic } from './fake-anthropic.mjs';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-agents-home-'));
const { runHeadless } = await import('../src/headless.mjs');
const { MODELS, DEFAULT_MODEL, setEndpoint, dropEndpoint } = await import('../../models/index.mjs');
const { toolDefs, EXPLORE_TOOLS } = await import('../src/agent/tools.mjs');
const { Rewind } = await import('../src/app/rewind.mjs');
const { Agent } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const model = MODELS[DEFAULT_MODEL];

function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-agents-'));
  writeFileSync(join(cwd, 'a.mjs'), 'export const a = 1;\nexport function parse(x) {\n  return JSON.parse(x);\n}\n');
  writeFileSync(join(cwd, 'b.mjs'), 'import { parse } from "./a.mjs";\nexport const b = parse("2");\n');
  return cwd;
}
const run = (o) => { const events = []; return runHeadless({ thinking: false, flows: false, way: 'model', ctx: 32768, model, subagents: true, onEvent: (type, ev) => events.push({ type, ...ev }), ...o }).then((r) => ({ ...r, events })); };
const names = (req) => (req.tools ?? []).map((t) => t.function?.name ?? t.name);

test('the Agent tool is offered when the model decides, and on the Claude API; not on App, not inside a helper, not with "subagents": false', () => {
  expect(toolDefs('model', null, { agents: true }).map((d) => d.name)).toContain('Agent');
  expect(toolDefs('app').map((d) => d.name)).not.toContain('Agent');
  expect([...EXPLORE_TOOLS]).toEqual(['Read', 'List', 'Search', 'Map', 'CodeSearch', 'WebFetch', 'WebSearch', 'TodoWrite']);
});

test('an explore helper: its own conversation (none of yours), read-only tools, the side slot; its report comes back and shows as one step', async () => {
  const cwd = project();
  const fake = await startFakeServer([
    { tool: { name: 'Agent', args: { description: 'find the parser', prompt: 'Find where parse is defined and report the file and line.', kind: 'explore' } } },
    { tool: { name: 'Read', args: { path: 'a.mjs' } } },
    { tool: { name: 'Edit', args: { path: 'a.mjs', old_text: 'JSON.parse', new_text: 'JSON5.parse' } } },
    { text: 'parse is defined in a.mjs:2.' },
    { text: 'It is in a.mjs, line 2.' },
  ]);
  const r = await run({ prompt: 'where is parse defined? use a helper', cwd, url: fake.url, slots: { main: 0, side: 1 }, autoApprove: true });
  await fake.close();
  expect(r.finalText).toBe('It is in a.mjs, line 2.');
  const chats = fake.requests.filter((q) => q.stream);
  const [first, helper] = chats;
  expect(names(first)).toContain('Agent');
  expect(first.id_slot).toBe(0);
  // The helper: slot 1, the task as its only user message, the helper's part of the instructions, no Agent and nothing that changes files.
  expect(helper.id_slot).toBe(1);
  expect(helper.messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['Find where parse is defined and report the file and line.']);
  expect(helper.messages[0].content).toContain('# You are a helper');
  expect(names(helper).every((n) => EXPLORE_TOOLS.has(n))).toBe(true);
  // Its Edit was refused, and the file is as it was.
  expect(JSON.stringify(chats[3].messages)).toContain("Edit is not one of this helper's tools: it only reads.");
  expect(readFileSync(join(cwd, 'a.mjs'), 'utf8')).toContain('JSON.parse');
  // Back in the conversation: the report as the Agent call's result.
  expect(JSON.stringify(chats.at(-1).messages)).toContain("The explore helper's report (2 steps");
  expect(JSON.stringify(chats.at(-1).messages)).toContain('parse is defined in a.mjs:2.');
  const step = r.events.find((e) => e.type === 'tool' && e.name === 'Agent');
  expect([step.label, step.arg, step.view.kind, step.view.steps]).toEqual(['Explore', 'find the parser', 'agent', 2]);
  expect(step.view.content).toContain('⏺ Read(a.mjs)');
  expect(r.events.filter((e) => e.type === 'tool-running' && e.name === 'Agent').map((e) => e.arg)).toContain('find the parser · 1 step · Read(a.mjs)');
});

test('a general helper may change files: each change asked about as the mode says (here: said yes)', async () => {
  const cwd = project();
  const fake = await startFakeServer([
    { tool: { name: 'Agent', args: { description: 'rename the constant', prompt: 'In a.mjs change a = 1 to a = 2.', kind: 'general' } } },
    { tool: { name: 'Read', args: { path: 'a.mjs' } } },
    { tool: { name: 'Edit', args: { path: 'a.mjs', old_text: 'export const a = 1;', new_text: 'export const a = 2;' } } },
    { text: 'Changed a.mjs line 1: a = 2.' },
    { text: 'Done: a is 2 now.' },
  ]);
  const r = await run({ prompt: 'make a 2, with a helper', cwd, url: fake.url, autoApprove: true });
  await fake.close();
  expect(r.finalText).toBe('Done: a is 2 now.');
  expect(readFileSync(join(cwd, 'a.mjs'), 'utf8')).toContain('export const a = 2;');
  expect(names(fake.requests.filter((q) => q.stream)[1])).toContain('Edit');
});

test('without a yes (coding -p with no --yes), a general helper’s change is refused like any other, and the no ends the turn', async () => {
  const cwd = project();
  const fake = await startFakeServer([
    { tool: { name: 'Agent', args: { prompt: 'Change a = 1 to a = 3 in a.mjs.', kind: 'general' } } },
    { tool: { name: 'Read', args: { path: 'a.mjs' } } },
    { tool: { name: 'Edit', args: { path: 'a.mjs', old_text: 'export const a = 1;', new_text: 'export const a = 3;' } } },
  ]);
  const r = await run({ prompt: 'make a 3', cwd, url: fake.url, autoApprove: false });
  await fake.close();
  expect(readFileSync(join(cwd, 'a.mjs'), 'utf8')).toContain('export const a = 1;');
  expect(r.reason).toBe('declined'); // the no ends the turn, as a no to the conversation's own change does
  expect(r.events.find((e) => e.type === 'tool' && e.name === 'Agent').view.reason).toBe('you said no');
});

test('from the home folder, a helper sent to a project moves there ("Work in …?" yes) and works, with /rewind on (7 Oct 2026: it stopped on "this.rewind?.moved is not a function")', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-agents-fakehome-'));
  const cwd = join(home, 'shop');
  mkdirSync(cwd);
  writeFileSync(join(cwd, 'a.mjs'), 'export const a = 1;\n');
  const fake = await startFakeServer([
    { tool: { name: 'Agent', args: { description: 'change a', prompt: `In ${cwd} change a = 1 to a = 2 in a.mjs.`, kind: 'general' } } },
    { tool: { name: 'Read', args: { path: 'a.mjs' } } },
    { tool: { name: 'Edit', args: { path: 'a.mjs', old_text: 'export const a = 1;', new_text: 'export const a = 2;' } } },
    { text: 'Changed a.mjs: a = 2.' },
    { text: 'Done: a is 2 now.' },
  ]);
  const rewind = new Rewind({ home: mkdtempSync(join(tmpdir(), 'agentic-agents-rewind-')), session: 's1' });
  const asked = [];
  // The home folder is a folder of the test's own (Bun's homedir() keeps the real one), given to the Agent, and from it to its helper.
  const ask = async (req) => { const q = String(req.args?.question ?? ''); asked.push(q); return /^Work in /.test(q) ? { choice: 'yes', text: 'yes' } : { choice: 'yes' }; };
  const agent = new Agent({ url: fake.url, model, cwd: home, home, system: systemPrompt({ cwd: home, git: 'test', tests: null }), thinking: false, mode: 'edits', flows: false, verify: false, confirmPlan: false, checkIns: false, way: 'model', rewind, ask });
  const events = [];
  agent.on('tool', (ev) => events.push(ev));
  try {
    const reason = await agent.send('make a 2, with a helper');
    expect(asked.some((q) => q.startsWith('Work in ~/shop?'))).toBe(true);
    const step = events.find((e) => e.name === 'Agent');
    expect(step.view.content).not.toContain('It stopped');
    expect(readFileSync(join(cwd, 'a.mjs'), 'utf8')).toBe('export const a = 2;\n');
    expect(reason).toBe('done');
  } finally { await fake.close(); }
});

test('esc during a helper stops it and the turn', async () => {
  const cwd = project();
  const fake = await startFakeServer([
    { tool: { name: 'Agent', args: { prompt: 'Look around.', kind: 'explore' } } },
    { tool: { name: 'List', args: { path: '.' } } },
    { text: 'x'.repeat(4000) },
  ], { delayMs: 20, chunk: 2 });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 700);
  const r = await run({ prompt: 'look around with a helper', cwd, url: fake.url, signal: ac.signal, autoApprove: true });
  await fake.close();
  expect(r.reason).toBe('interrupted');
  expect(r.events.some((e) => e.type === 'tool' && e.name === 'Agent' && e.view?.reason === 'interrupted')).toBe(true);
});

test('on the Claude API two helpers in one reply run side by side, and each report goes back with its own call', async () => {
  const cwd = project();
  const fake = await startFakeAnthropic([
    { tools: [{ name: 'Agent', args: { description: 'one', prompt: 'Report ONE.' } }, { name: 'Agent', args: { description: 'two', prompt: 'Report TWO.' } }] },
    { text: 'report first', delayMs: 400 },
    { text: 'report second', delayMs: 400 },
    { text: 'Both helpers are done.' },
  ]);
  setEndpoint(fake.url, { key: fake.key, kind: 'claude', model: 'claude-opus-5-5' });
  try {
    const r = await run({ prompt: 'use two helpers', cwd, url: fake.url, autoApprove: true });
    expect(r.finalText).toBe('Both helpers are done.');
    const posts = fake.seen.filter((x) => x.path.startsWith('/v1/messages'));
    expect(posts[0].body.tools.map((t) => t.name ?? t.type)).toContain('Agent');
    const [h1, h2] = [posts[1], posts[2]];
    expect(h2.at).toBeLessThan(h1.end); // the second started before the first had answered
    const last = JSON.stringify(posts[3].body.messages);
    expect(last).toContain('report first');
    expect(last).toContain('report second');
  } finally { dropEndpoint(fake.url); await fake.close(); }
});
