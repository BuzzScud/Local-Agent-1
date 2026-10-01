// The hub's Arena tab (src/app/hub.html, the /arena route in src/app/weights.mjs): the tab is the
// arena runner's own page, so the hub starts the runner when it is not up and sends the tab there, with
// the hub's address (the Arena's Record button shows the hub's record page) and what /test asked for.
// A runner from before the Arena is swapped for this code's, but only while it is idle. The old
// Tests and Battle tabs open the Arena; the record page has no Run tab any more. The runner runs in
// practice mode here (no model); its own tests: models/test/arena.test.mjs.
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// A throwaway home and a port of its own, set before the hub (and the models part) load.
const HOME = mkdtempSync(join(tmpdir(), 'agentic-hub-run-'));
const PORT = 20000 + Math.floor(Math.random() * 20000);
process.env.AGENTIC_HOME = HOME;
process.env.AGENTIC_BATTLE_PORT = String(PORT);
process.env.AGENTIC_TEST_RECORD = join(HOME, 'record.jsonl');
process.env.AGENTIC_BATTLE_FAKE = '1'; // the runner the hub starts is in practice mode too
process.env.AGENTIC_BATTLE_FAKE_MS = '40';
const { startWeightsServer } = await import('../src/app/weights.mjs');
const REPO = join(import.meta.dir, '..', '..');
const O = `http://127.0.0.1:${PORT}`;
const get = async (p) => (await fetch(`${O}${p}`)).json();
const until = async (fn, ms = 30_000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 120)); } };
// A runner from before the Arena: its ping says nothing of `arena`. BUSY names a file that makes it
// say a battle is running.
const BUSY = join(HOME, 'busy');
const OLD = `const http = require('node:http'), fs = require('node:fs');
fs.mkdirSync(process.argv[1], { recursive: true }); fs.writeFileSync(process.argv[1] + '/runner.pid', String(process.pid));
http.createServer((q, s) => { s.setHeader('content-type', 'application/json');
  if (q.url === '/api/ping') return s.end('{"ok":true}');
  if (q.url === '/api/state') return s.end(JSON.stringify({ running: fs.existsSync(process.argv[2]) ? { battle: 'x', side: 'A' } : null, paused: true, queue: ['n02'] }));
  s.statusCode = q.method === 'POST' ? 403 : 404; s.end(q.method === 'POST' ? '{"error":"wrong origin"}' : '{"error":"not found"}'); }).listen(Number(process.argv[3]), '127.0.0.1');
process.on('SIGTERM', () => { fs.rmSync(process.argv[1] + '/runner.pid', { force: true }); process.exit(0); });`;
let old = null;
let hub = null;
beforeAll(async () => {
  old = spawn('node', ['-e', OLD, join(HOME, 'battle'), BUSY, String(PORT)], { stdio: 'ignore' });
  await until(async () => { try { return (await get('/api/ping')).ok && existsSync(join(HOME, 'battle', 'runner.pid')); } catch { return false; } });
  hub = startWeightsServer({ path: null, docsDir: null, port: 0, cwd: HOME });
});
afterAll(() => {
  try { old?.kill('SIGTERM'); } catch {}
  try { hub?.stop(); } catch {}
  try { process.kill(Number(readFileSync(join(HOME, 'battle', 'runner.pid'), 'utf8')), 'SIGTERM'); } catch {}
});
const hubGet = (p) => fetch(`${hub.url.replace(/\/$/, '')}${p}`, { redirect: 'manual' });

test('a runner from before the Arena: left alone while something runs in it (the tab says why), swapped for this code\'s once it is idle', async () => {
  writeFileSync(BUSY, '');
  const busy = await hubGet('/arena');
  expect(busy.status).toBe(200);
  const said = await busy.text();
  expect(said).toContain('The Arena did not start');
  expect(said).toContain('the runner running now is from before the Arena, and something is running in it');
  expect((await get('/api/ping')).arena).toBeUndefined(); // still the old one
  rmSync(BUSY);
  const r = await hubGet('/arena');
  expect(r.status).toBe(302);
  expect((await get('/api/ping')).arena).toBe(true);
  expect(Number(readFileSync(join(HOME, 'battle', 'runner.pid'), 'utf8'))).not.toBe(old.pid);
}, 60_000);

test('the Arena tab goes to the runner\'s own page, with the hub\'s address and what /test asked for; /battle is the same; the old run routes are gone', async () => {
  const origin = hub.url.replace(/\/$/, '');
  const r = await hubGet('/arena?test=sorting&model=qwen&n=12&think=on&new=1&record=1&evil=x');
  expect(r.status).toBe(302);
  const to = new URL(r.headers.get('location'));
  expect(to.origin).toBe(O);
  expect(Object.fromEntries(to.searchParams)).toEqual({ hub: origin, test: 'sorting', model: 'qwen', n: '12', think: 'on', new: '1', record: '1' });
  const b = await hubGet('/battle');
  expect([b.status, new URL(b.headers.get('location')).searchParams.get('hub')]).toEqual([302, origin]);
  // The page it lands on is the Arena, and it knows each model's panel.
  const page = await (await fetch(`${O}/`)).text();
  expect(page).toContain('<title>Arena</title>');
  const st = await get('/api/state');
  expect([st.fake, Object.keys(st.panel.models)]).toEqual([true, ['gemma', 'qwen', 'k2', 'bonsai', 'constantkv']]); // every model in /model
  for (const p of ['/tests/run.json', '/tests/run', '/tests/stop']) expect([p, (await hubGet(p)).status]).toEqual([p, 404]);
  // The record is still the hub's own page (the Arena shows it over itself), with the record's data.
  expect((await hubGet('/tests')).status).toBe(200);
  expect(Array.isArray((await (await hubGet('/tests.json')).json()).rows)).toBe(true);
}, 60_000);

test('the hub has one Arena tab where Tests and Battle were, and an address that names either opens it', () => {
  const html = readFileSync(join(REPO, 'terminal', 'src', 'app', 'hub.html'), 'utf8');
  expect(html).toContain('<button data-tab="arena">Arena</button>');
  expect(html).not.toContain('data-tab="tests"');
  expect(html).not.toContain('data-tab="battle"');
  expect(html).toContain("const ALIAS = { tests: 'arena', battle: 'arena', builder: 'arena' };");
  expect(html).toContain("return show(`/arena${a ? `?${a}` : ''}`");
});

test('the record page has no Run tab: a ▶ in its grid sends that test to the Arena', () => {
  const html = readFileSync(join(REPO, 'terminal', 'src', 'app', 'tests.html'), 'utf8');
  expect(html).not.toContain('id="runpane"');
  expect(html).not.toContain('/tests/run');
  expect(html).not.toContain('rt-panel');
  expect(html).toContain("parent.postMessage({ agentic: 'arena-pick', test: g.dataset.run, model: g.dataset.model }, '*')");
  expect(html).toContain('/?tab=arena&run=1&test=');
});
