// The remote models in the Arena (models/evals/battle/remote-entrants.mjs, 3 Oct 2026): while /remote
// is connected (settings.json "remote", its `use` on), the service's models join the Who list; a test
// runs on one alone or battles it, takes no memory on this Mac, and a check stays on this Mac's models.
// A battle waiting in the line keeps its remote model when /remote goes off (never the default pair).
// Then one real run (run-one.mjs, no stand-in) on a pretend Ollama service: a cold model is loaded
// before the clock, kept 15 minutes rather than for good, and let go of after; the model in use is not.
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fakeOllama } from './fake-ollama.mjs';

const HOME = mkdtempSync(join(tmpdir(), 'agentic-arena-remote-'));
const PORT = 20000 + Math.floor(Math.random() * 20000);
const REPO = join(import.meta.dir, '..', '..');
const NODE = process.execPath.endsWith('bun') ? 'node' : process.execPath;
const BATTLE = join(REPO, 'models', 'evals', 'battle');
const ENV = { ...process.env, AGENTIC_HOME: HOME, AGENTIC_BATTLE_PORT: String(PORT), AGENTIC_TEST_RECORD: join(HOME, 'record.jsonl'), AGENTIC_MEMORY_SAVE: 'off' };
delete ENV.FORCE_COLOR;
const O = `http://127.0.0.1:${PORT}`;
const get = async (p) => (await fetch(`${O}${p}`)).json();
const post = async (p, body) => { const r = await fetch(`${O}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: O }, body: JSON.stringify(body ?? {}) }); return { status: r.status, body: await r.json() }; };
const until = async (fn, ms = 30_000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 100)); } };
const idle = () => until(async () => { const s = await get('/api/state'); return !s.running && (!s.line.length || s.paused) ? s : null; });
const line = (items) => post('/api/line', { items });
const connect = (use) => writeFileSync(join(HOME, 'settings.json'), JSON.stringify({ remote: { use, source: 'openai', kind: 'openai', connect: 'http', address: svc.url, model: 'coder:30b', key: false } }));
const R = (m) => `remote:openai:${m}`;

let svc = null;
let runner = null;
beforeAll(async () => {
  svc = await fakeOllama();
  connect(true);
  runner = spawn(NODE, [join(BATTLE, 'runner.mjs')], { env: { ...ENV, AGENTIC_BATTLE_FAKE: '1', AGENTIC_BATTLE_FAKE_MS: '60' }, stdio: 'ignore' });
  await until(async () => { try { return (await get('/api/ping')).arena; } catch { return false; } });
});
afterAll(async () => { try { runner?.kill('SIGTERM'); } catch {} await svc?.close(); });

test('connected: the service\'s models that chat and call tools join the Who list after the Mac\'s, the model in use first', async () => {
  const s = await until(async () => { const x = await get('/api/state'); return x.models.filter((m) => m.remote).length > 1 ? x : null; });
  const remote = s.models.filter((m) => m.remote);
  expect(s.models.findIndex((m) => m.remote)).toBe(s.models.filter((m) => !m.remote).length); // after every model of this Mac
  expect(remote.map((m) => m.id)).toEqual([R('coder:30b'), R('jsontext:14b'), R('words:7b'), R('tiny:3b'), R('thinker:35b')]); // no llava (no tools), no embedder
  expect(remote[0]).toMatchObject({ short: 'coder:30b', here: true });
  expect(new Set(remote.map((m) => m.short)).size).toBe(remote.length); // two sizes of one model never share a name
  expect(remote[0].name).toContain('coder:30b · ');
});

test('a test on a remote model alone: it runs and is named, holds no memory here; a battle with it names it once you vote', async () => {
  const id = (await post('/api/tests', { title: 'Remote question', kind: 'question', prompt: 'Which function computes tax?', checks: [{ type: 'answer-has', value: 'addTax' }] })).body.id;
  expect((await line([{ kind: 'test', id, who: R('tiny:3b') }])).body).toMatchObject({ ok: true, added: 1 });
  let held = false;
  await until(async () => { held ||= existsSync(join(HOME, 'battle', 'running.json')); const x = await get('/api/state'); return x.tests.find((t) => t.id === id)?.last?.[R('tiny:3b')]; });
  expect(held).toBe(false);
  await idle();
  // Gemma against it: either order, the names hidden until the vote, then counted for the remote model.
  expect((await line([{ kind: 'test', id, who: 'both', vs: ['gemma', R('tiny:3b')] }])).status).toBe(200);
  const live = await until(async () => { const x = await get('/api/state'); return x.running ? x.running : null; });
  expect(live.vs).toEqual(['gemma', R('tiny:3b')]);
  const t = await until(async () => (await get('/api/state')).tests.find((x) => x.id === id && x.latest?.mode === 'battle' && x.latest.status === 'done'));
  await idle();
  const v = await post('/api/vote', { id: t.latest.id, v: 'A' });
  expect(Object.values(v.body.order).sort()).toEqual(['gemma', R('tiny:3b')]);
  expect((await get('/api/state')).score.votes[v.body.order.A]).toBe(1);
});

test('a check runs on the models on this Mac only: a remote one for it is refused with why', async () => {
  const s = await get('/api/state');
  const c = s.checks.find((x) => x.model);
  const r = await line([{ kind: 'check', id: c.id, who: R('coder:30b') }]);
  expect(r.status).toBe(400);
  expect(r.body.error).toContain('on this Mac only');
  const b = await line([{ kind: 'check', id: c.id, who: 'both', vs: ['gemma', R('coder:30b')] }]);
  expect(b.status).toBe(400);
});

test('/remote off: its models leave the list and cannot be picked, but a battle already waiting keeps its remote model', async () => {
  const id = (await post('/api/tests', { title: 'Waiting battle', kind: 'question', prompt: 'Which rate does addTax use?', checks: [{ type: 'answer-has', value: 'rate' }] })).body.id;
  // A run on Gemma, then the battle; Stop on the first leaves the battle waiting (the line pauses).
  expect((await line([{ kind: 'test', id, who: 'gemma' }, { kind: 'test', id, who: 'both', vs: ['qwen', R('words:7b')] }])).body.added).toBe(2);
  await until(async () => (await get('/api/state')).running);
  await post('/api/stop');
  const paused = await idle();
  expect(paused.paused).toBe(true);
  expect(paused.line[0].vs).toEqual(['qwen', R('words:7b')]);
  connect(false);
  expect((await get('/api/state')).models.some((m) => m.remote)).toBe(false);
  const no = await line([{ kind: 'test', id, who: R('words:7b') }]);
  expect(no.status).toBe(400);
  expect(no.body.error).toContain('/remote');
  expect((await line([{ kind: 'test', id, who: 'both', vs: ['gemma', R('words:7b')] }])).status).toBe(400);
  await post('/api/resume');
  const r = await until(async () => { const x = await get('/api/state'); return x.running ? x.running : null; });
  expect(r.vs).toEqual(['qwen', R('words:7b')]); // not swapped for the default pair
  await idle();
  connect(true);
}, 60_000);

// One run as the runner starts it, without the stand-in.
const runOne = (model, name, env = {}) => new Promise((done) => {
  const t = join(HOME, 'tests-real', name);
  mkdirSync(join(t, 'project'), { recursive: true });
  writeFileSync(join(t, 'meta.json'), JSON.stringify({ id: name, kind: 'code', checks: [{ type: 'file-has', value: 'Hello world' }] }));
  writeFileSync(join(t, 'task.txt'), 'Please fix the typo in notes.txt.');
  writeFileSync(join(t, 'project', 'notes.txt'), 'Hello wrold\n');
  const out = join(HOME, 'out-real', name);
  const child = spawn(process.execPath, [join(BATTLE, 'run-one.mjs'), '--model', model, '--test', t, '--out', out, '--timeout', '120'], { cwd: REPO, env: { ...ENV, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  child.on('exit', (code) => {
    let result = null; try { result = JSON.parse(readFileSync(join(out, 'result.json'), 'utf8')); } catch {}
    const events = existsSync(join(out, 'events.jsonl')) ? readFileSync(join(out, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    done({ code, result, events, log });
  });
});

test('a real run on a cold model of the service: loaded first, kept 15 minutes, the test passes, then let go of', async () => {
  const from = svc.seen.length;
  const r = await runOne(R('tiny:3b'), 'cold');
  expect(r.code, r.log).toBe(0);
  expect(r.result).toMatchObject({ model: R('tiny:3b'), pass: true });
  expect(r.result.remote).toContain('tiny:3b');
  const notes = r.events.filter((e) => e.type === 'note').map((e) => e.text);
  expect(notes.indexOf('loading tiny:3b on the service')).toBeLessThan(notes.indexOf('loaded'));
  const asked = svc.seen.slice(from);
  const gens = asked.filter((x) => x.path === '/api/generate' && x.body.model === 'tiny:3b');
  expect(gens.map((x) => x.body.keep_alive)).toEqual(['15m', 0]); // loaded, then let go of
  const chats = asked.filter((x) => x.path === '/api/chat' && x.body.model === 'tiny:3b');
  expect(chats.length).toBeGreaterThan(0);
  expect(chats.every((x) => x.body.keep_alive === '15m')).toBe(true);
  expect(svc.loaded.has('tiny:3b')).toBe(false);
}, 120_000);

test('a real run on the model /remote uses (loaded): nothing loads first and it stays loaded after', async () => {
  const from = svc.seen.length;
  const r = await runOne(R('coder:30b'), 'warm');
  expect(r.code, r.log).toBe(0);
  expect(r.result.pass).toBe(true);
  expect(r.events.some((e) => e.type === 'note' && /^loading/.test(e.text))).toBe(false);
  expect(svc.seen.slice(from).some((x) => x.path === '/api/generate' && x.body.model === 'coder:30b')).toBe(false);
  expect(svc.loaded.has('coder:30b')).toBe(true);
}, 120_000);

test('a real run on a service that never loads the model (busy, no room): it names what is loaded there and ends with that reason', async () => {
  const busy = await fakeOllama({ noRoom: true });
  const keep = svc; svc = busy; connect(true);
  const r = await runOne(R('tiny:3b'), 'noroom', { AGENTIC_ARENA_LOAD_MINS: '0.03' });
  svc = keep; connect(true);
  await busy.close();
  expect(r.code).toBe(1);
  expect(r.result).toBeNull();
  const notes = r.events.filter((e) => e.type === 'note').map((e) => e.text);
  expect(notes).toContain('loading tiny:3b on the service · coder:30b is loaded there too: if both do not fit, the service waits until it is idle, then puts it aside');
  expect(notes).not.toContain('loaded');
  expect(r.log).toContain('tiny:3b did not load on the service in 0.03 minutes: coder:30b is loaded there, likely busy, with no room for both');
}, 30_000);

test('a real run with /remote off ends at once with the reason, and asks the service nothing', async () => {
  connect(false);
  const from = svc.seen.length;
  const r = await runOne(R('tiny:3b'), 'off');
  connect(true);
  expect(r.code).toBe(1);
  expect(r.result).toBeNull();
  expect(r.log).toContain('connect it again with /remote');
  expect(svc.seen.length).toBe(from);
}, 60_000);
