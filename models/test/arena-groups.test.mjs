// The Arena's groups (models/evals/battle/runner.mjs, 1 Oct 2026): each press of ▶ Run is one group,
// kept with its name, who, the effort and the settings; its runs carry its id, so the page's Results
// step shows what that press ran and any earlier one. End to end in practice mode (no model).
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const HOME = mkdtempSync(join(tmpdir(), 'agentic-arena-groups-'));
const PORT = 20000 + Math.floor(Math.random() * 20000);
process.env.AGENTIC_HOME = HOME;
process.env.AGENTIC_BATTLE_PORT = String(PORT);
process.env.AGENTIC_TEST_RECORD = join(HOME, 'record.jsonl');
const REPO = join(import.meta.dir, '..', '..');
const NODE = process.execPath.endsWith('bun') ? 'node' : process.execPath;
const RUNNER = join(REPO, 'models', 'evals', 'battle', 'runner.mjs');

let runner = null;
const O = `http://127.0.0.1:${PORT}`;
const get = async (p) => { const r = await fetch(`${O}${p}`); return { status: r.status, body: await r.json() }; };
const post = async (p, body) => { const r = await fetch(`${O}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: O }, body: JSON.stringify(body ?? {}) }); return { status: r.status, body: await r.json() }; };
const until = async (fn, ms = 30_000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 100)); } };
const idle = () => until(async () => { const s = (await get('/api/state')).body; return !s.running && (!s.line.length || s.paused) ? s : null; });
beforeAll(async () => {
  runner = spawn(NODE, [RUNNER], { env: { ...process.env, AGENTIC_BATTLE_FAKE: '1', AGENTIC_BATTLE_FAKE_MS: '40' }, stdio: 'ignore' });
  await until(async () => { try { return (await get('/api/ping')).body.arena; } catch { return false; } });
});
afterAll(() => { try { runner?.kill('SIGTERM'); } catch {} });

test('a press of ▶ Run is one group: named, its runs carry it, and its results come back by it', async () => {
  const st = (await get('/api/state')).body;
  const [t1, t2] = st.tests.filter((t) => t.suite === 'practice').slice(0, 2);
  const r = await post('/api/line', { name: 'Two practice tests and the unit tests', items: [{ kind: 'test', id: t1.id, who: 'gemma', think: true, settings: { tries: 4 } }, { kind: 'test', id: t2.id, who: 'gemma', think: true, settings: { tries: 4 } }, { kind: 'check', id: 'unit' }] });
  expect(r.body).toMatchObject({ ok: true, added: 3 });
  const id = r.body.batch;
  expect(id).toBeTruthy();
  expect((await get('/api/state')).body.batch).toBe(id);
  // While it runs, the run going now names its group.
  const live = await until(async () => { const s = (await get('/api/state')).body; return s.running?.batch === id ? s.running : null; });
  expect(live.batch).toBe(id);
  await idle();
  const b = (await get(`/api/batch?id=${id}`)).body;
  expect(b).toMatchObject({ id, name: 'Two practice tests and the unit tests', who: 'gemma', think: true, settings: { tries: 4 }, count: 3, done: 3, waiting: 0, status: 'done' });
  expect(b.items.map((x) => [x.kind, x.test, x.state])).toEqual([['test', t1.id, 'done'], ['test', t2.id, 'done'], ['check', 'unit', 'done']]);
  // A run on one model is named; each test's run is the one this press made (its own folder, its group).
  const [a1, a2, c] = b.items;
  expect(a1).toMatchObject({ mode: 'solo', order: { A: 'gemma' } });
  expect(typeof a1.runs.A.secs).toBe('number');
  expect(a1.match).not.toBe(a2.match);
  const m = (await get(`/api/match?id=${encodeURIComponent(a1.match)}`)).body;
  expect(m).toMatchObject({ batch: id, key: a1.key, think: true, settings: { tries: 4 } });
  expect(c).toMatchObject({ status: 'done', model: null });
  expect(c.job).toBeTruthy();
  expect(b.passed).toBe(b.items.filter((x) => (x.kind === 'check' ? x.result?.passed === x.result?.done : x.runs.A.pass === true)).length);
  // The list: newest first, without the items.
  const second = await post('/api/line', { items: [{ kind: 'test', id: t1.id, who: 'both' }] });
  await idle();
  const list = (await get('/api/batches')).body.batches;
  expect(list.map((x) => x.id)).toEqual([second.body.batch, id]);
  expect(list[0]).toMatchObject({ name: t1.title, who: 'both', vs: ['gemma', 'qwen'], count: 1, done: 1 });
  expect(list[0].items).toBeUndefined();
  // A battle in a group keeps its names hidden until the vote.
  const bat = (await get(`/api/batch?id=${second.body.batch}`)).body.items[0];
  expect(bat).toMatchObject({ mode: 'battle', order: null, vote: null });
  expect((await get('/api/batch?id=nope')).status).toBe(404);
}, 90_000);

test('a group cut short: what never ran shows as waiting while it waits, then left out; Clear all results clears the groups', async () => {
  await idle();
  const st = (await get('/api/state')).body;
  const r = await post('/api/line', { name: 'Practice 28', items: [{ kind: 'set', id: 'practice', who: 'qwen' }] });
  expect(r.body.added).toBeGreaterThan(5);
  await until(async () => (await get('/api/state')).body.running?.batch === r.body.batch);
  expect((await post('/api/stop', {})).status).toBe(200);
  await idle();
  const paused = (await get(`/api/batch?id=${r.body.batch}`)).body;
  expect(paused.status).toBe('paused');
  expect(paused.items.some((x) => x.state === 'waiting')).toBe(true);
  await post('/api/clearline', {});
  const cut = (await get(`/api/batch?id=${r.body.batch}`)).body;
  expect(cut.status).toBe('stopped');
  expect(cut.items.filter((x) => x.state === 'left').length).toBe(cut.count - cut.done);
  expect(st.tests.length).toBeGreaterThan(0);
  expect((await post('/api/clearresults', {})).body.ok).toBe(true);
  expect((await get('/api/batches')).body.batches).toEqual([]);
  expect((await get('/api/state')).body.batch).toBeNull();
}, 90_000);
