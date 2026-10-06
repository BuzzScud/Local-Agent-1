// The Arena's runner (models/evals/battle/runner.mjs), end to end in practice mode (no model): one
// line for everything you start. A test on both models is a battle (the names hidden until the vote);
// on one model it is a run of it alone (named, no vote); a check is one of run-tests.mjs's, and on
// both models it is two runs. A set goes in as its tests. Stop pauses the line. Only the Arena page
// itself may change anything. The page: terminal/test/hub-arena.test.mjs and arena-checks.test.mjs.
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const HOME = mkdtempSync(join(tmpdir(), 'agentic-arena-'));
const PORT = 20000 + Math.floor(Math.random() * 20000);
process.env.AGENTIC_HOME = HOME;
process.env.AGENTIC_BATTLE_PORT = String(PORT);
process.env.AGENTIC_TEST_RECORD = join(HOME, 'record.jsonl');
const REPO = join(import.meta.dir, '..', '..');
const NODE = process.execPath.endsWith('bun') ? 'node' : process.execPath;
const RUNNER = join(REPO, 'models', 'evals', 'battle', 'runner.mjs');

let runner = null;
const O = `http://127.0.0.1:${PORT}`;
const get = async (p, o = O) => (await fetch(`${o}${p}`)).json();
const post = async (p, body, origin = O, o = O) => { const r = await fetch(`${o}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body ?? {}) }); return { status: r.status, body: await r.json() }; };
const until = async (fn, ms = 30_000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 100)); } };
const idle = () => until(async () => { const s = await get('/api/state'); return !s.running && (!s.line.length || s.paused) ? s : null; });
const line = (items) => post('/api/line', { items });
beforeAll(async () => {
  runner = spawn(NODE, [RUNNER], { env: { ...process.env, AGENTIC_BATTLE_FAKE: '1', AGENTIC_BATTLE_FAKE_MS: '60' }, stdio: 'ignore' });
  await until(async () => { try { return (await get('/api/ping')).arena; } catch { return false; } });
});
afterAll(() => { try { runner?.kill('SIGTERM'); } catch {} });

test('a battle: both models run one after the other, the names stay hidden until the vote, the vote shows them', async () => {
  const made = await post('/api/tests', { title: 'Tax question', kind: 'question', prompt: 'Which function computes tax?', checks: [{ type: 'answer-has', value: 'addTax' }] });
  expect(made.status).toBe(200);
  const id = made.body.id;
  expect((await line([{ kind: 'test', id, who: 'both' }])).body).toMatchObject({ ok: true, added: 1 });
  // While it runs, the memory is held (the app reads this and waits), and the page is told what runs.
  expect(await until(() => existsSync(join(HOME, 'battle', 'running.json')))).toBe(true);
  const live = await until(async () => { const s = await get('/api/state'); return s.running?.match ? s.running : null; });
  expect(live).toMatchObject({ kind: 'test', test: id, who: 'both' });
  const t = await until(async () => (await get('/api/state')).tests.find((x) => x.id === id && x.latest?.status === 'done'));
  await idle();
  expect(existsSync(join(HOME, 'battle', 'running.json'))).toBe(false);
  expect(t.latest).toMatchObject({ mode: 'battle', order: null });
  expect([t.latest.runs.A.skipped, t.latest.runs.B.skipped]).toEqual([false, false]);
  // Before the vote nothing names a model: no result under either model, no pass counted, no run listed.
  expect(t.toVote).toBe(t.latest.id);
  expect(t.last).toEqual({});
  const s0 = await get('/api/state');
  expect([s0.score.passes, s0.score.votes]).toEqual([{ gemma: 0, qwen: 0, k2: 0, bonsai: 0, constantkv: 0 }, { gemma: 0, qwen: 0, k2: 0, bonsai: 0, constantkv: 0 }]); // every model in /model
  expect((await get(`/api/runs?test=${encodeURIComponent(id)}`)).runs).toEqual([]);
  const b = await get(`/api/match?id=${encodeURIComponent(t.latest.id)}`);
  expect(b.order).toBeNull();
  expect(b.runs.A.steps.length).toBeGreaterThan(0);
  // The vote: only from this page's own address, and then the names, everywhere.
  expect((await post('/api/vote', { id: b.id, v: 'A' }, 'https://evil.example')).status).toBe(403);
  const v = await post('/api/vote', { id: b.id, v: 'A' });
  expect(Object.values(v.body.order).sort()).toEqual(['gemma', 'qwen']);
  const st = await get('/api/state');
  expect(st.score.votes[v.body.order.A]).toBe(1);
  const after = st.tests.find((x) => x.id === id);
  expect(after.latest.order).toEqual(v.body.order);
  expect([after.toVote, Object.keys(after.last).sort()]).toEqual([null, ['gemma', 'qwen']]);
  expect((await get(`/api/runs?test=${encodeURIComponent(id)}`)).runs.map((r) => r.model).sort()).toEqual(['gemma', 'qwen']);
  // Practice runs are not written to the test record.
  expect(existsSync(join(HOME, 'record.jsonl'))).toBe(false);
}, 60_000);

test('a test on one model: named, no vote, kept beside the battles; thinking and the panel\'s settings go with it', async () => {
  const id = 'p02-fix-bug';
  expect((await line([{ kind: 'test', id, who: 'qwen', think: true, settings: { context: 16384, evil: 'x' } }])).status).toBe(200);
  const t = await until(async () => (await get('/api/state')).tests.find((x) => x.id === id && x.latest?.status === 'done'));
  await idle();
  expect(t.latest).toMatchObject({ mode: 'solo', order: { A: 'qwen' }, vote: null });
  expect(Object.keys(t.latest.runs)).toEqual(['A']);
  expect([t.toVote, Object.keys(t.last)]).toEqual([null, ['qwen']]);
  expect(t.last.qwen).toMatchObject({ match: t.latest.id, side: 'A', think: true });
  const m = await get(`/api/match?id=${encodeURIComponent(t.latest.id)}`);
  expect(m).toMatchObject({ mode: 'solo', think: true, settings: { context: 16384 }, order: { A: 'qwen' } }); // only the panel's own rows
  expect(m.runs.A).toMatchObject({ model: 'qwen', thinking: true });
  expect(existsSync(join(HOME, 'battle', 'battles', m.id, 'A', 'result.json'))).toBe(true);
  expect((await post('/api/vote', { id: m.id, v: 'A' })).status).toBe(400); // one model: nothing to vote on
  // The other model's run of it, later: both are listed, newest first, to put side by side.
  await line([{ kind: 'test', id, who: 'gemma' }]);
  await until(async () => (await get('/api/state')).tests.find((x) => x.id === id)?.last?.gemma);
  await idle();
  const runs = (await get(`/api/runs?test=${encodeURIComponent(id)}`)).runs;
  expect(runs.map((r) => [r.model, r.mode, r.think])).toEqual([['gemma', 'solo', false], ['qwen', 'solo', true]]);
  expect((await get('/api/state')).score.battles).toBe(1); // a run on one model is no battle
}, 60_000);

test('a check: it holds the memory as its own process, prints live and counts; on both models it is two runs; one with no model takes none', async () => {
  const r = await line([{ kind: 'check', id: 'requests', who: 'gemma', think: true, settings: { tries: 4 } }]);
  expect(r.body.added).toBe(1);
  const s = await until(async () => { const x = await get('/api/state'); return x.running?.job ? x : null; });
  expect(s.running).toMatchObject({ kind: 'check', test: 'requests', who: 'gemma', think: true });
  const live = await until(async () => { const j = (await get('/api/jobs?test=requests')).live; return j?.status === 'running' && j.count.done > 0 ? j : null; });
  expect(live).toMatchObject({ test: 'requests', model: 'gemma', modelName: 'Gemma 4 12B QAT', name: 'Real requests', think: true, settings: { tries: 4 } });
  expect(live.id).toMatch(/-requests-gemma-think-set(-\d+)?$/);
  expect(live.lines[0]).toBe('settings: {"tries":4}'); // what the run was handed
  const hold = JSON.parse(readFileSync(join(HOME, 'battle', 'running.json'), 'utf8'));
  expect(hold).toMatchObject({ kind: 'test', state: 'running', title: 'Real requests on Gemma 4 12B QAT · thinking on', pid: live.pid });
  await idle();
  const done = (await get('/api/jobs?test=requests')).jobs[0];
  expect(done).toMatchObject({ status: 'done', model: 'gemma' });
  expect(done.result).toMatchObject({ done: 28, total: 28 });
  expect((await get(`/api/job?id=${encodeURIComponent(done.id)}`)).lines.at(-1)).toBe('not recorded in the test record: a practice run (no model ran)');
  expect(existsSync(join(HOME, 'battle', 'running.json'))).toBe(false);
  // On both: Gemma's run, then Qwen's, tied as one pair. With no model: one run, no settings, no memory held.
  const both = await line([{ kind: 'check', id: 'sorting', who: 'both', think: true }, { kind: 'check', id: 'unit', who: 'both', think: true, settings: { tries: 4 } }]);
  expect(both.body.added).toBe(3);
  const st = await until(async () => { const x = await get('/api/state'); return !x.running && !x.line.length && x.done[0]?.test === 'unit' ? x : null; });
  const [unit, q, g] = st.done;
  expect([g.test, g.who, q.who, g.pair === q.pair && Boolean(g.pair)]).toEqual(['sorting', 'gemma', 'qwen', true]);
  expect([g.think, q.think]).toEqual([false, false]); // the sorting check never thinks
  expect(unit).toMatchObject({ kind: 'check', test: 'unit', who: null, think: false, settings: null, status: 'done' });
  const jobs = (await get('/api/jobs?test=sorting')).jobs;
  expect(jobs.map((j) => j.model)).toEqual(['qwen', 'gemma']);
  expect(st.checks.map((c) => c.id)).toEqual(['requests', 'long', 'sorting', 'questions', 'done', 'twoatonce', 'remote', 'vision', 'picturetokens', 'web', 'mcp', 'mcp-remote', 'subagent', 'loops', 'autoscreen', 'rulesfile', 'skills', 'lookfirst', 'habits', 'agents', 'prompt', 'thinking', 'way', 'big', 'remote-rules', 'hard', 'steps', 'ladder', 'components', 'edited', 'modelcheck', 'unit', 'check', 'reader', 'studio', 'constantkv', 'door', 'follow-through']); // the sets are not checks here
  expect(st.checks.find((c) => c.id === 'unit')).toMatchObject({ model: false, last: { none: null } });
}, 90_000);

test('a check with a big model of its own (ConstantKV) holds the memory like a model check, though it takes none of /model', async () => {
  await idle();
  const r = await line([{ kind: 'check', id: 'constantkv', who: 'qwen', think: true, settings: { tries: 4 } }]);
  expect(r.body.added).toBe(1);
  const live = await until(async () => { const j = (await get('/api/jobs?test=constantkv')).live; return j?.status === 'running' ? j : null; });
  expect(live).toMatchObject({ test: 'constantkv', model: null, think: false, settings: null });
  const hold = JSON.parse(readFileSync(join(HOME, 'battle', 'running.json'), 'utf8'));
  expect(hold).toMatchObject({ kind: 'test', state: 'running', title: 'ConstantKV check', pid: live.pid });
  await idle();
  const done = (await get('/api/jobs?test=constantkv')).jobs[0];
  expect(done).toMatchObject({ status: 'done', model: null });
  expect(done.result).toMatchObject({ done: 4, total: 4 });
  expect(existsSync(join(HOME, 'battle', 'running.json'))).toBe(false);
}, 60_000);

test('a set goes in as its tests; Stop pauses the line and Resume goes on; ✕ takes one out; Clear the line; a page test keeps its page; clear all results', async () => {
  const r = await line([{ kind: 'set', id: 'new28', who: 'both' }]);
  expect(r.body.added).toBe(28);
  const s = await until(async () => { const x = await get('/api/state'); return x.running ? x : null; });
  expect(s.running).toMatchObject({ kind: 'test', who: 'both', groupName: 'New 28', groupOf: 28 });
  expect(s.line.every((x) => x.group === s.running.group && x.test.startsWith('n'))).toBe(true);
  expect((await post('/api/stop')).status).toBe(200);
  const paused = await until(async () => { const x = await get('/api/state'); return !x.running && x.paused ? x : null; });
  expect(paused.line.length).toBeGreaterThan(20);
  expect(paused.tests.some((t) => t.latest?.status === 'stopped')).toBe(true);
  expect(JSON.parse(readFileSync(join(HOME, 'battle', 'state.json'), 'utf8')).line.length).toBe(paused.line.length); // kept: it outlives the runner
  expect((await post('/api/stop')).status).toBe(409); // nothing is running
  // ✕ on one, then Resume: the next one starts; Stop again and Clear the line.
  const gone = paused.line[1];
  expect((await post('/api/unqueue', { key: gone.key })).body.removed).toBe(1);
  await post('/api/resume');
  const again = await until(async () => { const x = await get('/api/state'); return x.running ? x : null; });
  expect([again.paused, again.running.test, again.line.some((x) => x.key === gone.key)]).toEqual([false, paused.line[0].test, false]);
  await post('/api/stop');
  await until(async () => { const x = await get('/api/state'); return !x.running && x.paused; });
  expect((await post('/api/clearline')).status).toBe(200);
  expect(await get('/api/state')).toMatchObject({ line: [], paused: false, running: null });
  // A test of yours needs a check; a page test keeps the page it made, and nothing outside it is served.
  expect((await post('/api/tests', { title: 'A page', kind: 'page', prompt: 'Make page.html', checks: [] })).body.error).toContain('tick at least one check');
  const page = await post('/api/tests', { title: 'A page', kind: 'page', prompt: 'Make page.html', checks: [{ type: 'offline' }] });
  await line([{ kind: 'test', id: page.body.id, who: 'gemma' }]);
  const done = await until(async () => (await get('/api/state')).tests.find((t) => t.id === page.body.id && t.latest?.status === 'done'));
  await idle();
  const b = await get(`/api/match?id=${encodeURIComponent(done.latest.id)}`);
  expect(b.runs.A.pages).toEqual(['page.html']);
  expect(await (await fetch(`${O}/files/${encodeURIComponent(b.id)}/A/page.html`)).text()).toContain('Practice page');
  expect((await fetch(`${O}/files/${encodeURIComponent(b.id)}/A/..%2F..%2Fbattle.json`)).status).toBe(404);
  // Deleting a test takes it out of the line too.
  await line([{ kind: 'set', id: 'work28', who: 'qwen' }, { kind: 'test', id: page.body.id, who: 'qwen' }]);
  await post('/api/stop');
  await until(async () => { const x = await get('/api/state'); return !x.running && x.paused; });
  expect((await get('/api/state')).line.at(-1).test).toBe(page.body.id);
  expect((await post('/api/tests/delete', { id: page.body.id })).status).toBe(200);
  const left = await get('/api/state');
  expect([left.line.some((x) => x.test === page.body.id), left.line.every((x) => x.test.startsWith('w') && x.who === 'qwen')]).toEqual([false, true]);
  await post('/api/clearline');
  // Clear all results: moved to trash, the score back to 0–0; refused while something runs.
  const cleared = await post('/api/clearresults');
  expect(cleared.body.moved).toBeGreaterThan(0);
  const after = await get('/api/state');
  expect([after.tests.filter((t) => t.latest).length, Object.values(after.score.votes), after.score.battles]).toEqual([0, [0, 0, 0, 0, 0], 0]);
  expect(readdirSync(join(HOME, 'battle', 'trash')).some((f) => f.startsWith('battles-'))).toBe(true);
  // Put back a New 28 test; a Practice 28 edit is saved as your copy, a test of its own beside the 28.
  await post('/api/tests', { id: 'n02-csv-quoted-comma', title: 'CSV', kind: 'code', prompt: 'Changed', checks: [] });
  expect((await get('/api/state')).tests.find((t) => t.id === 'n02-csv-quoted-comma').edited).toBeTruthy();
  expect((await post('/api/tests/reset', { id: 'n02-csv-quoted-comma' })).status).toBe(200);
  expect((await get('/api/state')).tests.find((t) => t.id === 'n02-csv-quoted-comma')).toMatchObject({ title: 'Fix a CSV line split on a quoted comma', edited: null });
  const c = await post('/api/tests', { id: 'p05-question', title: 'Port', kind: 'question', prompt: 'Which port? Say where it is set.', checks: [] });
  expect(c.body).toMatchObject({ id: 'p05b-question', n: 5, variant: 'b', copyOf: 'p05-question' });
  const s2 = await get('/api/state');
  expect(s2.tests.find((t) => t.id === 'p05b-question')).toMatchObject({ variant: 'b', copyOf: 'p05-question', suite: 'practice' });
  const sets = Object.fromEntries(s2.sets.map((x) => [x.id, x.ids]));
  expect(Object.keys(sets)).toEqual(['new28', 'work28', 'practice', 'mine']);
  expect([sets.new28.length, sets.work28.length, sets.practice.length, sets.practice.includes('p05b-question')]).toEqual([28, 28, 28, false]);
  expect(sets.mine.filter((id) => /^[nwp]\d/.test(id))).toEqual([]);
  // The kinds of the New 28 are sets too (the Pages, five of them).
  expect((await line([{ kind: 'set', id: 'page', who: 'both' }])).body.added).toBe(5);
  await post('/api/stop');
  await until(async () => { const x = await get('/api/state'); return !x.running; });
  await post('/api/clearline');
}, 120_000);

test('only the Arena page itself may change anything, and what cannot run is refused with why', async () => {
  for (const p of ['/api/line', '/api/stop', '/api/clearline', '/api/resume', '/api/unqueue', '/api/clearresults', '/api/tests']) expect([p, (await post(p, { items: [{ kind: 'check', id: 'unit' }] }, 'https://evil.example')).status]).toEqual([p, 403]);
  const no = async (item, why) => { const r = await line([item]); expect([r.status, r.body.error]).toEqual([400, why]); };
  await no({ kind: 'test', id: 'nope', who: 'both' }, 'no such test');
  await no({ kind: 'set', id: 'nope', who: 'both' }, 'no such set');
  await no({ kind: 'check', id: 'nope', who: 'gemma' }, 'no such check');
  await no({ kind: 'check', id: 'practice28', who: 'gemma' }, 'no such check'); // a set, run test by test
  await no({ kind: 'test', id: 'p02-fix-bug' }, 'pick who runs it: gemma, qwen, k2, bonsai, constantkv or both');
  await no({ kind: 'test', id: 'p02-fix-bug', who: 'llama' }, 'pick who runs it: gemma, qwen, k2, bonsai, constantkv or both'); // no such model in /model
  await no({ kind: 'page', id: 'x' }, 'an item is a test, a set or a check');
  expect((await line([])).body.error).toBe('nothing picked to run');
  expect((await get('/api/state')).line).toEqual([]); // one bad item: none of the press goes in
  expect((await get('/api/match?id=nope')).error).toBe('no such run');
  expect((await get('/api/job?id=..%2F..%2Fstate')).error).toBe('no such run');
  // The panel: each model's rows with the tests' defaults, for the page to draw.
  const panel = (await get('/api/state')).panel;
  expect(Object.keys(panel.models)).toEqual(['gemma', 'qwen', 'k2', 'bonsai', 'constantkv']); // every model in /model (practice mode: all count as here)
  expect(panel.models.gemma.defs.context).toBe(32768);
  expect(panel.models.qwen.rows.map((r) => r.id)).toEqual(expect.arrayContaining(['embedder', 'reranker', 'context', 'thinking', 'tries', 'steps']));
});

test('the line of a runner from before the Arena is carried over: its test runs first, then its battles, still paused', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-arena-old-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  mkdirSync(join(home, 'battle'), { recursive: true });
  writeFileSync(join(home, 'battle', 'state.json'), JSON.stringify({ queue: ['n01-date-one-day-early', 'n02-csv-quoted-comma'], paused: true, testLine: [{ key: 'u', test: 'unit', model: null, think: false, settings: null }], testDone: [] }));
  writeFileSync(join(home, 'battle', 'runner.token'), 'old-key');
  const old = spawn(NODE, [RUNNER], { env: { ...process.env, AGENTIC_HOME: home, AGENTIC_BATTLE_PORT: String(port), AGENTIC_BATTLE_FAKE: '1' }, stdio: 'ignore' });
  try {
    const o = `http://127.0.0.1:${port}`;
    await until(async () => { try { return (await get('/api/ping', o)).arena; } catch { return false; } });
    const s = await get('/api/state', o);
    expect(s.paused).toBe(true);
    expect(s.line.map((x) => [x.kind, x.test, x.who])).toEqual([['check', 'unit', null], ['test', 'n01-date-one-day-early', 'both'], ['test', 'n02-csv-quoted-comma', 'both']]);
    expect(existsSync(join(home, 'battle', 'runner.token'))).toBe(false); // no key any more: the page's own address is the check
    const kept = JSON.parse(readFileSync(join(home, 'battle', 'state.json'), 'utf8'));
    expect([kept.queue, kept.testLine, kept.line.length]).toEqual([undefined, undefined, 3]);
  } finally { old.kill('SIGTERM'); }
}, 30_000);

test('a test of your own with a level: its level is a set, it stops at its level\'s time on one model and at 10 minutes in a battle', async () => {
  const { saveTest } = await import('../evals/battle/store.mjs');
  const made = saveTest({ title: 'Easy card', kind: 'page', prompt: 'Build an HTML page with one card.', checks: [{ type: 'page-made', value: '' }, { type: 'count', value: 'button>=2' }], level: 'easy' }, join(HOME, 'battle'));
  const s = await get('/api/state');
  const t = s.tests.find((x) => x.id === made.id);
  expect(t).toMatchObject({ level: 'easy', limit: 300 });
  expect(t.checks.map((c) => c.label)).toEqual(['A page was made', 'The page has at least 2 buttons']); // the Test builder's checks, in words
  // The level is a set of its own, listed only when it has tests.
  expect(s.sets.map((x) => x.id)).toEqual(['new28', 'work28', 'practice', 'mine', 'mine-easy']);
  expect(s.sets.find((x) => x.id === 'mine-easy')).toMatchObject({ name: 'My tests · Easy', level: 'easy', ids: [made.id] });
  expect((await line([{ kind: 'set', id: 'mine-hard', who: 'qwen' }])).body.error).toBe('My tests · Hard has no tests yet');
  // On one model: its level's 5 minutes. In a battle: 10, whatever its level.
  expect((await line([{ kind: 'set', id: 'mine-easy', who: 'qwen' }])).body).toMatchObject({ ok: true, added: 1 });
  const solo = await until(async () => (await get('/api/state')).tests.find((x) => x.id === made.id && x.latest?.status === 'done'));
  await idle();
  expect((await get(`/api/match?id=${encodeURIComponent(solo.latest.id)}`))).toMatchObject({ mode: 'solo', limit: 300, order: { A: 'qwen' } });
  expect((await line([{ kind: 'test', id: made.id, who: 'both' }])).body).toMatchObject({ ok: true, added: 1 });
  const both = await until(async () => (await get('/api/state')).tests.find((x) => x.id === made.id && x.latest?.mode === 'battle' && x.latest?.status === 'done'));
  await idle();
  expect((await get(`/api/match?id=${encodeURIComponent(both.latest.id)}`))).toMatchObject({ mode: 'battle', limit: 600 });
});

test('every model in /model: any one runs a test alone, any two battle (vs), a pair that is not two of them is the default pair', async () => {
  const s = await get('/api/state');
  expect(s.models.map((m) => [m.id, m.here])).toEqual([['gemma', true], ['qwen', true], ['k2', true], ['bonsai', true], ['constantkv', true]]); // practice mode: every file counts as here
  expect(s.pair).toEqual(['gemma', 'qwen']);
  const made = await post('/api/tests', { title: 'Rate question', kind: 'question', prompt: 'Which rate does addTax use?', checks: [{ type: 'answer-has', value: 'rate' }] });
  const id = made.body.id;
  // K2 against Bonsai: those two run, in either order, and the vote names them.
  expect((await line([{ kind: 'test', id, who: 'both', vs: ['k2', 'bonsai'] }])).body).toMatchObject({ ok: true, added: 1 });
  const live = await until(async () => { const x = await get('/api/state'); return x.running ? x.running : null; });
  expect(live).toMatchObject({ who: 'both', vs: ['k2', 'bonsai'] });
  const t = await until(async () => (await get('/api/state')).tests.find((x) => x.id === id && x.latest?.status === 'done'));
  await idle();
  const v = await post('/api/vote', { id: t.latest.id, v: 'B' });
  expect(Object.values(v.body.order).sort()).toEqual(['bonsai', 'k2']);
  expect((await get('/api/state')).score.votes[v.body.order.B]).toBe(1);
  // Bonsai alone.
  expect((await line([{ kind: 'test', id, who: 'bonsai' }])).status).toBe(200);
  await until(async () => (await get(`/api/runs?test=${encodeURIComponent(id)}`)).runs.filter((r) => r.model === 'bonsai').length === 2);
  await idle();
  // A pair that is not two different models in /model: the default pair runs.
  for (const vs of [['k2', 'k2'], ['k2', 'nope'], ['k2']]) {
    expect((await line([{ kind: 'test', id, who: 'both', vs }])).status).toBe(200);
    const r = await until(async () => { const x = await get('/api/state'); return x.running ? x.running : null; });
    expect(r.vs).toEqual(['gemma', 'qwen']);
    await until(async () => { const x = await get('/api/state'); return !x.running && !x.line.length; });
  }
}, 90_000);
