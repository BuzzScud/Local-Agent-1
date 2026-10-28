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
