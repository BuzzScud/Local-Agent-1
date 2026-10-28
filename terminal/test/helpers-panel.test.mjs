// Helpers on a smaller model (28 Oct 2026): the panel's rows, /subagents <model>, the Agent tool offered when the
// profiles send helpers to another model, and a helper's progress as events.
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';

process.env.AGENTIC_MEMORY_SAVE = 'off';
const { helperRows, withHelper, shownHelpers, KEEP_DONE_MS } = await import('../src/app/helpers-panel.mjs');
const { helpersTo, PROFILES_FILE } = await import('../src/app/profiles.mjs');
const { useHelperModel } = await import('../src/app/subagents-cmd.mjs');
const { Agent } = await import('../src/agent/agent.mjs');
const { systemPrompt, HELPER_LINE } = await import('../src/agent/prompt.mjs');
const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');

const t0 = 1_000_000;

test('the panel: a running helper, a side job, then done rows that stay a moment; the memory line; nothing when empty', () => {
  expect(helperRows([])).toBeNull();
  let list = withHelper([], { id: 'a1', kind: 'Explore', model: 'bonsai-2:4b', steps: 0, last: '', started: t0 }, t0);
  list = withHelper(list, { id: 'a1', kind: 'Explore', model: 'bonsai-2:4b', steps: 3, last: 'Read(src/cart.mjs)', started: t0 }, t0 + 9000);
  list = withHelper(list, { id: 'memory-note', kind: 'Side job', what: 'memory note', model: 'bonsai-2:2b', started: t0 + 10000 }, t0 + 10000);
  const loaded = [{ name: 'bonsai-2:9b', size: 4.1e9 }, { name: 'bonsai-2:4b', size: 2.1e9 }];
  const p = helperRows(list, { loaded, now: t0 + 12000 });
  expect(p.title).toBe('Helpers · 1 helper · 1 side job · the conversation waits for the report');
  expect(p.rows).toEqual([
    { mark: '●', running: true, kind: 'Explore', model: 'bonsai-2:4b', what: 'step 3 · Read(src/cart.mjs)', secs: 12 },
    { mark: '●', running: true, kind: 'Side job', model: 'bonsai-2:2b', what: 'memory note · writing', secs: 2 },
  ]);
  expect(p.memory).toBe('Memory 6.2 GB · bonsai-2:9b 4.1 · bonsai-2:4b 2.1');
  list = withHelper(list, { id: 'a1', kind: 'Explore', model: 'bonsai-2:4b', steps: 5, last: 'Search(discount)', started: t0, done: true, secs: 23, reason: 'done' }, t0 + 23000);
  list = withHelper(list, { id: 'memory-note', kind: 'Side job', what: 'memory note', model: 'bonsai-2:2b', started: t0 + 10000, done: true, secs: 4 }, t0 + 21000);
  const q = helperRows(list, { now: t0 + 24000 });
  expect(q.rows.map((r) => [r.mark, r.what, r.secs])).toEqual([['✓', 'done · 5 steps', 23], ['✓', 'memory note · saved', 4]]);
  expect(q.title).toBe('Helpers · 1 helper · 1 side job');
  expect(q.memory).toBeNull();
  expect(shownHelpers(list, t0 + 21000 + KEEP_DONE_MS + 1).map((h) => h.id)).toEqual(['a1']);
  expect(helperRows(list, { now: t0 + 23000 + KEEP_DONE_MS + 1 })).toBeNull();
  const stopped = withHelper([], { id: 'b', kind: 'Explore', model: 'bonsai-2:4b', steps: 2, started: t0, done: true, secs: 5, reason: 'limit' }, t0);
  expect(helperRows(stopped, { now: t0 + 1000 }).rows[0]).toMatchObject({ mark: '✗', what: 'stopped: limit · 2 steps' });
});

test('helpersTo: a profile of that model on the server is used, or one is made; Helpers it starts points at it', () => {
  const S = { kind: 'openai', source: 'machine', address: 'http://localhost:11434', port: null, connect: 'http', keyId: 'default' };
  const data = { profiles: { Bonsai: { server: S, model: 'bonsai-2:9b', backup: null, spillAfter: 0 } }, uses: { 'ai:main': 'Bonsai' } };
  const a = helpersTo(data, 'bonsai-2:4b', S);
  expect([a.name, a.made, a.data.uses['ai:helpers'], a.data.uses['ai:main']]).toEqual(['Helpers · bonsai-2:4b', true, 'Helpers · bonsai-2:4b', 'Bonsai']);
  expect(a.data.profiles['Helpers · bonsai-2:4b']).toEqual({ server: S, model: 'bonsai-2:4b', backup: null, spillAfter: 0 });
  const b = helpersTo({ ...data, profiles: { ...data.profiles, Small: { server: S, model: 'bonsai-2:2b', backup: null, spillAfter: 0 } } }, 'bonsai-2:2b', S);
  expect([b.name, b.made, Object.keys(b.data.profiles).length]).toEqual(['Small', false, 2]);
});

test('/subagents <model>: written to profiles.json on the conversation\'s server; not for this Mac\'s own model or the same model', async () => {
  rmSync(PROFILES_FILE(), { force: true });
  const said = [];
  const remote = { kind: 'openai', source: 'machine', address: 'http://localhost:11434', connect: 'http', model: 'bonsai-2:9b', use: true };
  const agent = { url: 'http://127.0.0.1:9', modelName: () => 'bonsai-2:9b', helpersAway: { conv: 'x', on: false } };
  const self = { push: (m) => said.push(m.text), settings: { remote }, model: { name: 'bonsai-2:9b', remote: { model: 'bonsai-2:9b' } }, agent };
  expect(await useHelperModel(self, 'bonsai-2:4b')).toBe(true);
  const saved = JSON.parse(readFileSync(PROFILES_FILE(), 'utf8'));
  expect(saved.uses['ai:helpers']).toBe('Helpers · bonsai-2:4b');
  expect(saved.profiles['Helpers · bonsai-2:4b']).toMatchObject({ model: 'bonsai-2:4b', server: { address: 'http://localhost:11434' } });
  expect(said.at(-1)).toBe('Helpers it starts → bonsai-2:4b ("Helpers · bonsai-2:4b", made now). From the next message bonsai-2:9b has the Agent tool and hands reading and searching to it; side jobs: /profiles.');
  expect(agent.helpersAway).toBeNull(); // the next message looks again
  expect(await useHelperModel(self, 'bonsai-2:9b')).toBe(false);
  expect(said.at(-1)).toContain("is the conversation's own model");
  expect(await useHelperModel({ ...self, model: { name: 'Qwen3.5 9B' } }, 'bonsai-2:4b')).toBe(false);
  expect(said.at(-1)).toContain('runs on this Mac');
  rmSync(PROFILES_FILE(), { force: true });
});

test('the Agent tool and its line come when the helpers run on another model, once a conversation; never with subagents off', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-helpers-'));
  const model = { ...MODELS[DEFAULT_MODEL], remote: { model: 'bonsai-2:9b' } };
  const make = (o = {}) => new Agent({ url: 'http://127.0.0.1:9', model, cwd, system: systemPrompt({ cwd, git: 'none' }), memory: false, flows: false, way: 'app', instructions: 'local', ...o });
  let to = { model: 'bonsai-2:4b' };
  const router = { active: () => true, helper: () => to };
  const a = make();
  expect(a.agentsOn()).toBe(false); // no router: as before
  a.router = router;
  expect(a.helpersElsewhere()).toBe(true);
  expect(a.tools().map((t) => t.function.name)).toContain('Agent');
  a.refreshNotes();
  expect(a.messages[0].content).toContain(HELPER_LINE);
  to = undefined; // the same model, or its server not reached yet: kept for this conversation
  expect(a.helpersElsewhere()).toBe(true);
  a.reset();
  expect(a.helpersElsewhere()).toBe(false);
  a.refreshNotes();
  expect(a.messages[0].content).not.toContain(HELPER_LINE);
  const off = make({ subagents: false });
  off.router = { active: () => true, helper: () => ({ model: 'bonsai-2:4b' }) };
  expect(off.agentsOn()).toBe(false);
  expect(systemPrompt({ cwd, git: 'none', helperLine: true })).toContain(`\n${HELPER_LINE}\n`);
  expect(systemPrompt({ cwd, git: 'none' })).not.toContain(HELPER_LINE);
});

test('a helper says how it goes: its model, each step, and how it ended', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-helpers-'));
  writeFileSync(join(cwd, 'a.mjs'), 'export const parse = (s) => JSON.parse(s);\n');
  const fake = await startFakeServer([
    { tool: { name: 'Agent', args: { description: 'find parse', prompt: 'Find where parse is defined; report file:line.', kind: 'explore' } } },
    { tool: { name: 'Read', args: { path: 'a.mjs' } } },
    { text: 'parse is in a.mjs:1.' },
    { text: 'It is in a.mjs, line 1.' },
  ]);
  try {
    const a = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd, system: systemPrompt({ cwd, git: 'none' }), memory: false, flows: false, way: 'model', thinking: false, verify: false, hooks: [], mode: 'edits', confirmPlan: false, checkIns: false });
    const seen = [];
    a.on('helper', (e) => seen.push(e));
    await a.send('where is parse defined? use a helper');
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen[0]).toMatchObject({ kind: 'Explore', steps: 0, last: '' });
    expect(seen.some((e) => e.steps === 1 && e.last === 'Read(a.mjs)')).toBe(true);
    expect(seen.at(-1)).toMatchObject({ done: true, reason: 'done', steps: 1 });
    expect(new Set(seen.map((e) => e.id)).size).toBe(1);
    expect(typeof seen[0].model).toBe('string');
  } finally { await fake.close(); }
});

test('helpers on another model of the conversation’s own Ollama service name it on each call; the conversation’s model stays', async () => {
  // 28 Oct 2026, the Bonsai helpers check: moved there by its profile, a helper connected 2B at 9B's address, and the
  // conversation went on on 2B. No model runs here: the helper's send is stood in for.
  const { setEndpoint, dropEndpoint, endpointOf } = await import('../../models/index.mjs');
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-helpers-'));
  writeFileSync(join(cwd, 'a.mjs'), 'export const parse = (s) => JSON.parse(s);\n'); // what its report cites
  const url = 'http://127.0.0.1:9';
  const other = 'http://127.0.0.2:9';
  setEndpoint(url, { remote: true, kind: 'openai', ollama: true, model: 'bonsai-2:9b' });
  setEndpoint(other, { remote: true, kind: 'openai', ollama: true, model: 'qwen3.6' });
  const model = { ...MODELS[DEFAULT_MODEL], remote: { model: 'bonsai-2:9b' } };
  const send = Agent.prototype.send;
  const helpers = [];
  Agent.prototype.send = async function (...a) {
    if (!this.isHelper) return send.apply(this, a);
    helpers.push({ ownUse: this.ownUse, router: this.router });
    this.emit('assistant', { final: true, text: 'It is in a.mjs:1.' });
    return 'done';
  };
  try {
    let to = { url, model: 'bonsai-2:2b' };
    const a = new Agent({ url, model, cwd, system: systemPrompt({ cwd, git: 'none' }), memory: false, flows: false, way: 'app', instructions: 'local' });
    a.router = { active: () => true, helper: () => to };
    const seen = [];
    a.on('helper', (e) => seen.push(e));
    const r = await a.runHelper('h1', { prompt: 'Find parse; report file:line.', kind: 'explore' }, { label: 'Agent', arg: 'find parse' });
    expect(helpers[0].ownUse).toMatchObject({ model: 'bonsai-2:2b', numCtx: 32_768 });
    expect(helpers[0].router).toBeNull(); // never moved by a profile: no second connection at this address
    expect(endpointOf(url).model).toBe('bonsai-2:9b');
    expect(seen.at(-1)).toMatchObject({ model: 'bonsai-2:2b', done: true });
    expect(r.text).toContain('on bonsai-2:2b');
    to = { url: other, model: 'qwen3.6' }; // another server: its profile moves it there, as before
    a.helpersAway = null;
    await a.runHelper('h2', { prompt: 'Find parse.', kind: 'explore' }, { label: 'Agent', arg: 'find parse' });
    expect(helpers[1].ownUse).toBeUndefined();
    expect(helpers[1].router).toBe(a.router);
  } finally {
    Agent.prototype.send = send;
    dropEndpoint(url);
    dropEndpoint(other);
  }
});

test('a helper on the smaller model: short instructions, thinking as the conversation, its report checked and sent back once', async () => {
  // 28 Oct 2026, the owner's picks after the Bonsai helpers check. No model runs: the helper's send is stood in for.
  const { setEndpoint, dropEndpoint } = await import('../../models/index.mjs');
  const { SMALL_HELPER } = await import('../src/agent/agent-said.mjs');
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-helpers-'));
  writeFileSync(join(cwd, 'panel.mjs'), '// The panel.\nexport const KEEP_DONE_MS = 6000;\n');
  const url = 'http://127.0.0.1:9';
  setEndpoint(url, { remote: true, kind: 'openai', ollama: true, model: 'bonsai-2:9b' });
  const model = { ...MODELS[DEFAULT_MODEL], remote: { model: 'bonsai-2:9b' } };
  const send = Agent.prototype.send;
  const seen = [];
  const reports = ['It is `saveRow` in panel.mjs:9.', 'KEEP_DONE_MS, panel.mjs:2: 6 seconds.'];
  Agent.prototype.send = async function (prompt, ...a) {
    if (!this.isHelper) return send.call(this, prompt, ...a);
    seen.push({ prompt, system: this.messages[0].content, thinking: this.thinking });
    this.emit('assistant', { final: true, text: reports[seen.length - 1] });
    return 'done';
  };
  try {
    const a = new Agent({ url, model, cwd, system: systemPrompt({ cwd, git: 'none' }), memory: false, flows: false, way: 'app', instructions: 'local', thinking: true });
    a.router = { active: () => true, helper: () => ({ url, model: 'bonsai-2:2b' }) };
    const r = await a.runHelper('h1', { prompt: 'How long does a done row stay?', kind: 'explore' }, { label: 'Agent', arg: 'rows' });
    expect(seen[0].system.startsWith(SMALL_HELPER)).toBe(true);
    expect(seen[0].system).toContain('copy that line from the Read result');
    expect(seen[0].system).not.toContain('Agentic Coder, a coding assistant in the user');
    expect(seen[0].thinking).toBe(true); // without it 2B's reports covered one part of two (28 Oct 2026)
    expect(seen[1].prompt).toContain('`saveRow` is not in the project');
    expect(seen[1].prompt).toContain('panel.mjs:9 is past the end');
    expect(seen).toHaveLength(2);
    expect(r.text).toContain('KEEP_DONE_MS, panel.mjs:2: 6 seconds.');
    expect(r.text).toContain('  panel.mjs:2  export const KEEP_DONE_MS = 6000;');
    expect(r.text).not.toContain('Not confirmed');
  } finally {
    Agent.prototype.send = send;
    dropEndpoint(url);
  }
});

test('a question with helpers on the smaller model is searched by a helper first; a request for work is not', async () => {
  const { setEndpoint, dropEndpoint } = await import('../../models/index.mjs');
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-helpers-'));
  const url = 'http://127.0.0.1:9';
  setEndpoint(url, { remote: true, kind: 'openai', ollama: true, model: 'bonsai-2:9b' });
  const model = { ...MODELS[DEFAULT_MODEL], remote: { model: 'bonsai-2:9b' } };
  const run = Agent.prototype.runHelper;
  const asked = [];
  Agent.prototype.runHelper = async function (id, args) { asked.push(args); return { text: `The explore helper's report (1 step, 2 s, on bonsai-2:2b):\nparse is in a.mjs:1.` }; };
  try {
    const a = new Agent({ url, model, cwd, system: systemPrompt({ cwd, git: 'none' }), memory: false, flows: false, way: 'app', instructions: 'local' });
    expect(await a.handFirst('where is parse defined?', 'question')).toBe(false); // no router: as before
    a.router = { active: () => true, helper: () => ({ url, model: 'bonsai-2:2b' }) };
    expect(await a.handFirst('fix the bug in cart.mjs', 'fix')).toBe(false);
    const before = a.messages.length;
    expect(await a.handFirst('where is parse defined?', 'question')).toBe(true);
    expect(asked[0]).toMatchObject({ kind: 'explore' });
    expect(asked[0].prompt).toContain('The user asked: "where is parse defined?"');
    expect(asked[0].prompt).toContain('for every part of the question');
    const [call, result] = a.messages.slice(before);
    expect(call.tool_calls[0].function.name).toBe('Agent');
    expect(result).toMatchObject({ role: 'tool', tool_call_id: call.tool_calls[0].id });
    expect(result.content).toContain('parse is in a.mjs:1.');
  } finally {
    Agent.prototype.runHelper = run;
    dropEndpoint(url);
  }
});

test('the helpers’ model is loaded ahead at the size its calls name, after the conversation’s own', async () => {
  const { setEndpoint, dropEndpoint } = await import('../../models/index.mjs');
  const got = [];
  const server = Bun.serve({ port: 0, async fetch(req) { got.push({ path: new URL(req.url).pathname, body: await req.json() }); return Response.json({ done: true }); } });
  const url = `http://127.0.0.1:${server.port}`;
  setEndpoint(url, { remote: true, kind: 'openai', ollama: true, model: 'bonsai-2:9b' });
  const was = process.env.AGENTIC_WARM_HELPER;
  try {
    const cwd = mkdtempSync(join(tmpdir(), 'agentic-helpers-'));
    const a = new Agent({ url, model: { ...MODELS[DEFAULT_MODEL], remote: { model: 'bonsai-2:9b' } }, cwd, system: systemPrompt({ cwd, git: 'none' }), memory: false, flows: false, way: 'app', instructions: 'local' });
    a.router = { active: () => true, helper: () => ({ url, model: 'bonsai-2:2b' }) };
    a.warmHelper(); // off in the tests (test-env.mjs)
    await Bun.sleep(100);
    expect(got).toHaveLength(0);
    process.env.AGENTIC_WARM_HELPER = 'on';
    a.warmHelper();
    for (let i = 0; i < 50 && got.length < 2; i++) await Bun.sleep(20);
    // The conversation's own model first, at its own size, then the helpers' (both fit only in that order).
    expect(got.map((g) => g.body.model)).toEqual(['bonsai-2:9b', 'bonsai-2:2b']);
    expect(got[1]).toMatchObject({ path: '/api/generate', body: { model: 'bonsai-2:2b', options: { num_ctx: 32_768 }, keep_alive: '30m' } });
  } finally {
    if (was === undefined) delete process.env.AGENTIC_WARM_HELPER; else process.env.AGENTIC_WARM_HELPER = was;
    dropEndpoint(url);
    server.stop(true);
  }
});

test('a helper that only reads is not sent back for saying it is done with no file changed', async () => {
  // 28 Oct 2026: the send-back cost a 2B helper a whole re-read of its conversation (14.5 s), and it can change nothing.
  const { asksForWork, claimsDone } = await import('../src/agent/agent-said.mjs');
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-helpers-'));
  writeFileSync(join(cwd, 'a.mjs'), 'export const parse = (s) => JSON.parse(s);\n');
  const task = 'Find where parse is defined; then write a short report with file:line.'; // "write": it reads as work
  const done = 'Done: parse is defined in a.mjs at line 1.';
  expect(asksForWork(task)).toBe(true);
  expect(claimsDone(done)).toBe(true);
  const fake = await startFakeServer([
    { tool: { name: 'Agent', args: { description: 'find parse', prompt: task, kind: 'explore' } } },
    { tool: { name: 'Read', args: { path: 'a.mjs' } } },
    { text: done },
    { text: 'It is in a.mjs, line 1.' },
  ]);
  try {
    // The check that sends "done" with nothing changed back (said-done), switched on: the helper takes its parent's.
    const a = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd, system: systemPrompt({ cwd, git: 'none' }), memory: false, flows: false, way: 'model', thinking: false, verify: false, hooks: ['said-done'], mode: 'edits', confirmPlan: false, checkIns: false });
    const ended = [];
    a.on('helper', (e) => { if (e.done) ended.push(e); });
    await a.send('where is parse defined? use a helper');
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ reason: 'done', steps: 1 });
    expect(a.messages.filter((m) => m.role === 'assistant' && m.content).at(-1).content).toBe('It is in a.mjs, line 1.');
  } finally { await fake.close(); }
});
