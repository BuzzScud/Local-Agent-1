// The hub's Tests tab, ▶ Run a test (src/app/tests.html, the routes in src/app/weights.mjs): the hub
// passes the page's asks to the Battle arena's runner with the runner's key, and refuses any other
// site; a runner from before test runs is restarted, but only while it is idle. The runner runs in
// practice mode here (no model); its own tests: models/test/run-a-test.test.mjs.
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
const { RUN_TESTS } = await import('../../models/index.mjs');
const REPO = join(import.meta.dir, '..', '..');
const O = `http://127.0.0.1:${PORT}`;
const get = async (p) => (await fetch(`${O}${p}`)).json();
const until = async (fn, ms = 30_000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 120)); } };
const idle = () => until(async () => { const j = (await get('/api/testrun')).job; return !j || !['waiting', 'running'].includes(j.status); });
// A runner from before test runs: it knows /api/state but not /api/testrun. BUSY names a file that
// makes it say a battle is running.
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

test('a runner from before this update: left alone while a battle runs (the page says why), restarted once it is idle', async () => {
  const H = hub.url.replace(/\/$/, '');
  writeFileSync(BUSY, '');
  const busy = await fetch(`${H}/tests/run.json`);
  expect(busy.status).toBe(409);
  const b = await busy.json();
  expect(b.error).toContain('from before this update and a battle is using it');
  expect(b.catalog.length).toBe(RUN_TESTS.length); // the page can still show the tests
  expect(old.exitCode).toBeNull(); // not stopped
  rmSync(BUSY);
  const look = await (await fetch(`${H}/tests/run.json`)).json();
  expect(look.up).toBe(true);
  expect(look.job).toBeNull();
  expect(old.exitCode).toBe(0); // stopped with SIGTERM, the way the runner keeps its line of tests
  expect(Number(readFileSync(join(HOME, 'battle', 'runner.pid'), 'utf8'))).not.toBe(old.pid);
  expect(existsSync(join(HOME, 'battle', 'runner.token'))).toBe(true);
}, 30_000);

test('the hub passes the Tests tab\'s asks along with the key: the list, a run started, and nothing from another site', async () => {
  const H = hub.url.replace(/\/$/, '');
  const look = await (await fetch(`${H}/tests/run.json`)).json();
  expect(look.up).toBe(true);
  expect(look.catalog.map((t) => t.id)).toEqual(RUN_TESTS.map((t) => t.id));
  expect(look.job).toBeNull();
  const evil = await fetch(`${H}/tests/run`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{"test":"unit"}' });
  expect(evil.status).toBe(403);
  expect((await fetch(`${H}/tests/run`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"test":"unit"}' })).status).toBe(415);
  const ok = await fetch(`${H}/tests/run`, { method: 'POST', headers: { 'content-type': 'application/json', origin: H }, body: JSON.stringify({ test: 'task', model: 'gemma', n: 12, think: true }) });
  expect(ok.status).toBe(200);
  await idle();
  const j = (await get('/api/testrun')).job;
  expect(j).toMatchObject({ test: 'task', n: 12, think: true, status: 'done' }); // the switch's choice goes along
  expect(j.lines.join('\n')).toContain('12-feature-currency');
  // The page: the tab and its pane, and it asks the hub (never the runner's address) for everything.
  const page = await (await fetch(`${H}/tests`)).text();
  expect(page).toContain('id="runpane"');
  expect(page).toContain("fetch('/tests/run.json'");
  expect(page).not.toContain(':8758');
  const stop = await fetch(`${H}/tests/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(stop.status).toBe(409); // nothing is running now
}, 60_000);
