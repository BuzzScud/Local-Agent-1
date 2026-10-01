// `coding serve` itself, with the stand-in llama-server (fake-llama-server.mjs)
// in a throwaway home: it starts behind a new key, prints what to type into
// /remote, answers only with that key, a `coding -p` with /remote on gets its
// answer through it, a busy port is refused, and ctrl+c stops it cleanly. The
// real model does the same in the Remote check (models/evals/tools/remote-check.mjs).
import { test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { ENGINE, MODELS, DEFAULT_MODEL } from '../../models/index.mjs';

// The model on this Mac in these tests is the default one (its file, name and size).
const D = MODELS[DEFAULT_MODEL];
const DN = D.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // its name inside a pattern
const DGB = `${(D.bytes / 1e9).toFixed(1)} GB`;

const CLI = join(import.meta.dir, '..', 'src', 'cli.jsx');
const T = 90_000;
const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });
const quiet = { AGENTIC_NO_UPDATE: '1', AGENTIC_MEMORY_SAVE: 'off', AGENTIC_NO_MEMORY: '1', AGENTIC_HELPERS: 'off', AGENTIC_NO_OPEN: '1' };

function homes() {
  const base = mkdtempSync(join(tmpdir(), 'agentic-serve-'));
  const serveHome = join(base, 'serve-home'), clientHome = join(base, 'client-home'), proj = join(base, 'project');
  for (const d of [join(serveHome, 'engine', ENGINE.tag), join(serveHome, 'models'), clientHome, proj]) mkdirSync(d, { recursive: true });
  symlinkSync(join(import.meta.dir, 'fake-llama-server.mjs'), join(serveHome, 'engine', ENGINE.tag, 'llama-server'));
  writeFileSync(join(serveHome, 'models', D.file), 'stand-in');
  writeFileSync(join(proj, 'README.md'), 'hi\n');
  writeFileSync(join(clientHome, 'trust.json'), JSON.stringify({ [proj]: new Date().toISOString() }));
  return { base, serveHome, clientHome, proj };
}
// Runs `coding …` to its end: { code, out, err }.
function run(args, { cwd, env }) {
  const p = Bun.spawn(['bun', CLI, ...args], { cwd, env: { ...process.env, ...quiet, ...env }, stdout: 'pipe', stderr: 'pipe' });
  return Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]).then(([out, err, code]) => ({ out, err, code }));
}
// Starts `coding serve` and waits for its "ctrl+c stops it"; { p, out(), stop() }.
async function startServe(args, { cwd, env }) {
  const p = Bun.spawn(['bun', CLI, 'serve', ...args], { cwd, env: { ...process.env, ...quiet, ...env }, stdout: 'pipe', stderr: 'pipe' });
  let text = '';
  const read = async (stream) => { const dec = new TextDecoder(); for await (const c of stream) text += dec.decode(c); };
  read(p.stdout); read(p.stderr);
  const t0 = Date.now();
  while (!text.includes('ctrl+c stops it') && p.exitCode === null && Date.now() - t0 < 30_000) await Bun.sleep(100);
  return { p, out: () => text, stop: async () => { p.kill('SIGINT'); await p.exited; } };
}

test('coding serve: a new key readable by you only, the form’s values printed, only /health without the key, a remote answer through it, ctrl+c stops it', async () => {
  const { serveHome, clientHome, proj } = homes();
  const port = await freePort();
  const s = await startServe(['--local', '--port', String(port), '--ctx', '8k'], { cwd: proj, env: { AGENTIC_HOME: serveHome } });
  const text = s.out();
  expect(text).toContain('ctrl+c stops it');
  const key = readFileSync(join(serveHome, 'serve.key'), 'utf8').trim();
  expect(key).toMatch(/^ac-[A-Za-z0-9_-]{32}$/);
  expect(statSync(join(serveHome, 'serve.key')).mode & 0o777).toBe(0o600);
  for (const line of ['Type this into /remote over there:', 'Run on    My other computer', 'Reach by  SSH tunnel', `API key   ${key}`, `Port      ${port}   (behind More)`, 'The key was made now']) expect(text).toContain(line);
  expect(text).not.toContain('macOS may ask'); // --local opens nothing to the network
  const reg = JSON.parse(readFileSync(join(serveHome, 'servers', `${port}.json`), 'utf8'));
  expect(reg.serve).toEqual({ host: '127.0.0.1', keyFile: join(serveHome, 'serve.key'), https: false });
  // the stand-in was started with the key file and the address serve asked for
  const url = `http://127.0.0.1:${port}`;
  expect((await fetch(`${url}/health`)).status).toBe(200);
  expect((await fetch(`${url}/props`)).status).toBe(401);
  expect((await fetch(`${url}/props`, { headers: { authorization: `Bearer ${key}` } })).status).toBe(200);
  // Agentic Coder with /remote on answers through it
  writeFileSync(join(clientHome, 'settings.json'), JSON.stringify({ remote: { use: true, address: '127.0.0.1', port, connect: 'http', kind: 'llama', model: '', context: 0, key: true, keyEnd: key.slice(-4) } }));
  const r = await run(['-p', 'hello', '--no-flows'], { cwd: proj, env: { AGENTIC_HOME: clientHome, AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: key } });
  expect(r.out.trim()).toBe('Hello from the stand-in model.');
  expect(r.err).toContain(`· On the remote model: ${D.name} · 127.0.0.1:${port}`); // coding serve serves the default model
  // started again, it keeps its key; a port in use is refused
  const busy = await run(['serve', '--local', '--port', String(port)], { cwd: proj, env: { AGENTIC_HOME: serveHome } });
  expect(busy.code).toBe(1);
  expect(busy.err).toContain(`coding serve: port ${port} is in use; pick another with --port`);
  await s.stop();
  await Bun.sleep(500);
  expect(readdirSync(join(serveHome, 'servers')).filter((f) => f.endsWith('.json'))).toEqual([]);
  expect((await fetch(`${url}/health`).then((x) => x.status, () => 'gone'))).toBe('gone');
}, T);

test('coding serve on the network: it listens on every address, says where others reach it and that macOS may ask; --new-key replaces the key', async () => {
  const { serveHome, proj } = homes();
  const port = await freePort();
  const args = join(serveHome, 'args.jsonl');
  const first = await startServe(['--port', String(port), '--ctx', '8k'], { cwd: proj, env: { AGENTIC_HOME: serveHome, FAKE_LLAMA_ARGS: args } });
  const k1 = readFileSync(join(serveHome, 'serve.key'), 'utf8').trim();
  expect(first.out()).toContain('Reach by  Home network (http)');
  expect(first.out()).toContain('macOS may ask whether llama-server may accept incoming connections');
  expect(first.out()).toContain('Plain http is for a home network or Tailscale');
  await first.stop();
  const started = JSON.parse(readFileSync(args, 'utf8').trim().split('\n')[0]);
  expect(started[started.indexOf('--host') + 1]).toBe('0.0.0.0');
  expect(started[started.indexOf('--api-key-file') + 1]).toBe(join(serveHome, 'serve.key'));
  const again = await startServe(['--port', String(port), '--new-key'], { cwd: proj, env: { AGENTIC_HOME: serveHome } });
  const k2 = readFileSync(join(serveHome, 'serve.key'), 'utf8').trim();
  await again.stop();
  expect(k2).not.toBe(k1);
  const bad = await run(['serve', '--wat'], { cwd: proj, env: { AGENTIC_HOME: serveHome } });
  expect(bad.code).toBe(2);
  expect(bad.out).toContain('--local           this machine only: reach it with an SSH tunnel');
}, T);
