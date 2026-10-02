// End-to-end, the real app in a pseudo-terminal (see app.test.mjs). Here:
// /remote, the form for where the model runs: Run on first, then only that
// service's rows, filled in by keys and a paste; Connect checks first and
// changes nothing when that fails, else saves and switches; /remote claude
// asks only for the key; each service keeps its own key and is a /model row.
// A remote saved as on is used from the start (nothing loads on this Mac); one
// that does not answer asks what to do. The keys are kept in a file in the
// test's home, never the Keychain.
import { test, expect } from 'bun:test';
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';

// The model on this Mac in these tests is the default one (its file, name and size).
const D = MODELS[DEFAULT_MODEL];
const DN = D.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // its name inside a pattern
const DGB = `${(D.bytes / 1e9).toFixed(1)} GB`;

const KEY = 'test-remote-test-0123456789';
const settingsOf = (base) => JSON.parse(readFileSync(join(base, 'home', 'settings.json'), 'utf8'));
const down = (n) => Array.from({ length: n }, () => [{ key: 'down' }, { sleep: 70 }]).flat();
const up = (n) => Array.from({ length: n }, () => [{ key: 'up' }, { sleep: 70 }]).flat();
const right = (n) => Array.from({ length: n }, () => [{ key: 'right' }, { sleep: 80 }]).flat();
// No key from the shell running the tests stands in for the ones typed here.
const NO_ENV_KEYS = { AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: '', ANTHROPIC_API_KEY: '' };
// A row of the form on the screen (its label at the start of a line in the box).
const hasRow = (screen, label) => new RegExp(`│ [ ❯] ${label}\\s`).test(screen);

test('/remote: Run on My other computer, its rows filled in (a pasted key); a Connect that fails changes nothing, the next one saves and switches, and only the key’s end is in settings', async () => {
  const { cwd, env, base } = setup();
  const here = await startFakeServer([]);
  const remote = await startFakeServer([{ text: 'Hello from the remote.' }], { key: KEY, props: true });
  let afterFail = 'unread';
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS }, args: ['--url', here.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' },
    { type: '/remote' }, { key: 'enter' }, { wait: 'Remote model' }, { sleep: 150 }, { snapshot: 'form' },
    ...right(2), { sleep: 100 }, { snapshot: 'computer' }, // Run on: My other computer
    ...down(1), { type: '127.0.0.1' }, { sleep: 80 }, { key: 'enter' }, { sleep: 80 }, // Address (enter: on to Reach by)
    ...down(1), { key: `\x1b[200~test-wrong-0123456789\n\x1b[201~` }, { sleep: 150 }, { snapshot: 'typingKey' }, { key: 'enter' }, { sleep: 80 }, // API key, pasted (enter: on to More)
    { key: 'enter' }, { sleep: 100 }, // More opens
    ...down(1), { type: String(remote.port) }, { sleep: 80 }, { key: 'enter' }, { sleep: 80 }, { snapshot: 'more' }, // Port
    ...down(3), { key: 'enter' }, { wait: 'it did not work' }, { sleep: 150 }, { snapshot: 'failed' }, // Connect: the wrong key
    { fn: () => { afterFail = existsSync(join(base, 'home', 'settings.json')) ? settingsOf(base).remote ?? null : null; } },
    ...up(6), { key: `\x1b[200~${KEY}\x1b[201~` }, { sleep: 150 }, { key: 'enter' }, { sleep: 80 }, // API key again
    ...down(5), { key: 'enter' }, { wait: 'On the remote:' }, { sleep: 200 }, { snapshot: 'on' }, // Connect
    { type: 'hello' }, { key: 'enter' }, { wait: 'Hello from the remote.' },
    { type: '/doctor' }, { key: 'enter' }, { wait: 'Doctor · on a remote model' }, { sleep: 150 }, { snapshot: 'doctor' },
    ...quit,
  ] });
  await here.close();
  await remote.close();
  const form = r.snapshots.form;
  expect(form).toMatch(/Run on\s+◀ This Mac\s+▶/);
  expect(form).toMatch(/Switch\s+in use now/);
  for (const row of ['Address', 'API key', 'Connect', 'Save only']) expect(hasRow(form, row)).toBe(false); // This Mac has nothing to fill in
  const computer = r.snapshots.computer;
  expect(computer).toMatch(/Run on\s+◀ My other computer\s+▶/);
  for (const row of ['Address', 'Reach by', 'API key', 'More', 'Connect', 'Save only']) expect(hasRow(computer, row)).toBe(true);
  for (const row of ['Port', 'Server', 'Context']) expect(hasRow(computer, row)).toBe(false); // behind More
  expect(computer).not.toContain('Not ready'); // nothing tried yet
  expect(r.snapshots.typingKey).toContain(`${'•'.repeat('test-wrong-0123456789'.length)}`);
  expect(r.snapshots.typingKey).not.toContain('test-wrong-0123456789');
  expect(r.snapshots.more).toMatch(new RegExp(`Port\\s+${remote.port}`));
  expect(r.snapshots.more).toMatch(/Server\s+◀ llama\.cpp\s+▶/);
  expect(r.snapshots.failed).toMatch(/Connect\s+✗ it did not work/);
  expect(r.snapshots.failed).toContain('the API key was not accepted');
  expect(afterFail).toBe(null); // nothing saved by a Connect that did not work
  expect(r.snapshots.on).toContain(`On the remote: Gemma 4 12B QAT · 127.0.0.1:${remote.port} · llama.cpp`);
  expect(r.snapshots.on.replace(/\s+/g, ' ')).toContain(`now go to 127.0.0.1:${remote.port}; /remote switches back`);
  expect(r.snapshots.doctor).toContain('in the key file (••••6789)');
  // the chat went to the remote with the key; nothing went there with the right key but /health and the checks
  const chats = remote.seen.filter((x) => x.path === '/v1/chat/completions' && x.auth === `Bearer ${KEY}`);
  expect(chats.length).toBeGreaterThan(0);
  expect(here.requests.filter((b) => JSON.stringify(b).includes('hello')).length).toBe(0);
  // saved: the computer's set-up, its key's end, its key under its own name in a file readable by you only
  const saved = { source: 'machine', address: '127.0.0.1', port: remote.port, connect: 'http', kind: 'llama', model: '', context: 0, key: true, keyEnd: '6789', keyId: 'machine' };
  const s = settingsOf(base);
  expect(s.remote).toEqual({ ...saved, use: true });
  expect(s.remotes).toEqual({ machine: saved });
  expect(readFileSync(join(base, 'home', 'settings.json'), 'utf8')).not.toContain(KEY);
  expect(JSON.parse(readFileSync(join(base, 'home', 'remote-keys.json'), 'utf8'))).toEqual({ machine: KEY });
  expect(statSync(join(base, 'home', 'remote-keys.json')).mode & 0o777).toBe(0o600);
}, T);

test('a remote saved as on is used from the start: nothing loads on this Mac, the first message goes there with its key', async () => {
  const { cwd, env, base } = setup();
  const remote = await startFakeServer([{ text: 'Straight to the remote.' }], { key: KEY, props: true });
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { use: true, address: '127.0.0.1', port: remote.port, connect: 'http', kind: 'llama', model: '', context: 0, key: true, keyEnd: '6789' } }));
  writeFileSync(join(base, 'home', 'remote-keys.json'), JSON.stringify({ default: KEY }), { mode: 0o600 });
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_REMOTE_KEYSTORE: 'file' }, args: ['--no-flows'], steps: [
    { wait: 'On the remote:', ms: 20_000 }, { sleep: 200 }, { snapshot: 'on' },
    { type: 'hi' }, { key: 'enter' }, { wait: 'Straight to the remote.' },
    { type: '/model' }, { key: 'enter' }, { wait: 'Pick the model' }, { sleep: 150 }, { snapshot: 'model' }, { key: 'esc' },
    ...quit,
  ] });
  await remote.close();
  expect(r.snapshots.on).not.toContain('Could not start the model');
  expect(r.snapshots.on).not.toContain('coding setup');
  expect(r.snapshots.model).toMatch(/My other computer · 127\.0\.0\.1:\d+\s+llama\.cpp · another computer\s+✔ in use/);
  expect(remote.seen.some((x) => x.path === '/v1/chat/completions' && x.auth === `Bearer ${KEY}`)).toBe(true);
}, T);

test('a remote that does not answer at the start: nothing loads here; it says why and asks (again, this Mac, or the form)', async () => {
  const { cwd, env, base } = setup();
  const free = createServer();
  await new Promise((ok) => free.listen(0, '127.0.0.1', ok));
  const port = free.address().port;
  await new Promise((ok) => free.close(ok));
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { use: true, address: '127.0.0.1', port, connect: 'http', kind: 'llama', model: '', context: 0, key: false, keyEnd: '' } }));
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_REMOTE_KEYSTORE: 'file' }, args: ['--no-flows'], steps: [
    { wait: 'The remote model is not answering', ms: 20_000 }, { sleep: 200 }, { snapshot: 'asked' },
    { key: '3' }, { wait: 'Remote model' }, { sleep: 150 }, { snapshot: 'form' }, { key: 'esc' }, { wait: 'Remote kept as it was.' },
    ...quit,
  ] });
  const asked = r.snapshots.asked;
  expect(asked).toContain('Nothing is listening at that address and port. Nothing loads on this Mac unless you pick it.');
  expect(asked).toContain('Try again');
  expect(asked).toMatch(new RegExp(`Use ${DN} on this Mac for now`)); // the model on this Mac: the default
  expect(asked).toContain('Open /remote');
  expect(r.snapshots.form).toMatch(/Run on\s+◀ My other computer\s+▶/);
  expect(r.snapshots.form).toMatch(/Address\s+127\.0\.0\.1/);
  expect(r.snapshots.form).toMatch(new RegExp(`More\\s+▸\\s+port ${port}`)); // behind More, named on it
}, T);

test('the remote goes away in the middle: it tries to connect again once, then the reply stops and it asks what to do', async () => {
  const { cwd, env, base } = setup();
  const remote = await startFakeServer([{ text: 'First answer.' }], { key: KEY, props: true });
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { use: true, address: '127.0.0.1', port: remote.port, connect: 'http', kind: 'llama', model: '', context: 0, key: true, keyEnd: '6789' } }));
  writeFileSync(join(base, 'home', 'remote-keys.json'), JSON.stringify({ default: KEY }), { mode: 0o600 });
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_REMOTE_KEYSTORE: 'file' }, args: ['--no-flows'], steps: [
    { wait: 'On the remote:', ms: 20_000 },
    { type: 'one' }, { key: 'enter' }, { wait: 'First answer.' }, { sleep: 300 },
    { fn: () => remote.kill() }, { sleep: 200 },
    { type: 'two' }, { key: 'enter' }, { wait: 'The remote model is not answering', ms: 20_000 }, { sleep: 200 }, { snapshot: 'asked' },
    { key: 'esc' }, ...quit,
  ] });
  const t = r.snapshots.asked.replace(/\s+/g, ' ');
  expect(t).toContain('The remote model stopped answering; connecting again…');
  expect(t).toContain(`the remote model at 127.0.0.1:${remote.port} stopped answering: it closed the connection (the server may have stopped)`);
  expect(t).not.toContain('✔ in use');
  expect(t).toContain('Try again');
  await remote.close();
}, T);

test('coding -p follows /remote: the answer comes from the remote; --local would run here instead', async () => {
  const { cwd, env, base } = setup();
  const remote = await startFakeServer([{ text: 'Printed from the remote.' }], { key: KEY, props: true });
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { use: true, address: '127.0.0.1', port: remote.port, connect: 'http', kind: 'llama', model: '', context: 0, key: true, keyEnd: '6789' } }));
  writeFileSync(join(base, 'home', 'remote-keys.json'), JSON.stringify({ default: KEY }), { mode: 0o600 });
  const cli = join(import.meta.dir, '..', 'src', 'cli.jsx');
  const run = (args) => new Promise((ok) => { const p = Bun.spawn(['bun', cli, ...args], { cwd, env: { ...process.env, ...env, AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_NO_UPDATE: '1', AGENTIC_MEMORY_SAVE: 'off', AGENTIC_NO_MEMORY: '1' }, stdout: 'pipe', stderr: 'pipe' }); Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]).then(([out, err, code]) => ok({ out, err, code })); });
  const r = await run(['-p', 'hello', '--no-flows']);
  expect(r.out.trim()).toBe('Printed from the remote.');
  expect(r.err).toContain(`· On the remote model: Gemma 4 12B QAT · 127.0.0.1:${remote.port}`);
  expect(remote.seen.some((x) => x.path === '/v1/chat/completions' && x.auth === `Bearer ${KEY}`)).toBe(true);
  const local = await run(['-p', 'hello', '--no-flows', '--local']);
  expect(local.err).toContain('coding setup'); // no model here: it tried this Mac, not the remote
  await remote.close();
}, T);

test('/remote with Run on: Claude API: a key, a model from the list, its address behind More; Connect, and the reply comes through Anthropic’s Messages API with the key in x-api-key', async () => {
  const { startFakeAnthropic } = await import('./fake-anthropic.mjs');
  const { cwd, env, base } = setup();
  const here = await startFakeServer([]);
  const claude = await startFakeAnthropic([{ text: 'ready' }, { thinking: 'A short hello will do.', text: 'Hello from Claude.' }]);
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS }, args: ['--url', here.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' },
    { type: '/remote' }, { key: 'enter' }, { wait: 'Remote model' }, { sleep: 150 },
    ...right(1), { sleep: 100 }, { snapshot: 'claude' }, // Run on: Claude API
    ...down(1), { key: `\x1b[200~${claude.key}\x1b[201~` }, { sleep: 150 }, { key: 'enter' }, { sleep: 80 }, // API key (enter: on to Model)
    ...right(1), { sleep: 100 }, { snapshot: 'model' }, // Model: Opus 5.5 → Sonnet 5.5
    ...down(1), { key: 'enter' }, { sleep: 100 }, // More opens
    ...down(1), { type: claude.url }, { sleep: 80 }, { key: 'enter' }, { sleep: 80 }, // Address: the stand-in (enter: on to Context)
    ...down(1), { key: 'enter' }, { wait: 'On the remote:' }, { sleep: 200 }, { snapshot: 'on' }, // Connect
    { type: 'hello' }, { key: 'enter' }, { wait: 'Hello from Claude.' }, { sleep: 200 },
    ...quit,
  ] });
  await here.close();
  await claude.close();
  const c = r.snapshots.claude;
  expect(c).toMatch(/Run on\s+◀ Claude API\s+▶/);
  expect(c).toMatch(/Model\s+◀ Opus 5\.5\s+▶/);
  for (const row of ['Reach by', 'Port', 'Server', 'Address']) expect(hasRow(c, row)).toBe(false); // the Claude API has none of these (its address is behind More)
  expect(r.snapshots.model).toMatch(/Model\s+◀ Sonnet 5\.5\s+▶\s+•\s+quicker, half the price/);
  expect(r.snapshots.on.replace(/\s+/g, ' ')).toContain(`On the remote: claude-sonnet-5-5 · 127.0.0.1:${claude.port} · Claude API`);
  const posts = claude.seen.filter((s) => s.path.startsWith('/v1/messages'));
  expect(posts.length).toBeGreaterThanOrEqual(2);
  expect(posts[0].body).toMatchObject({ model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'Reply with the single word: ready' }] }); // Connect's check
  expect(claude.seen.every((s) => s.key === claude.key)).toBe(true);
  const chat = posts.at(-1).body;
  expect(chat).toMatchObject({ model: 'claude-sonnet-5-5', stream: true });
  expect(chat.system).toContain('Agentic Coder');
  expect(chat.tools.length).toBeGreaterThan(3);
  expect(settingsOf(base).remote).toMatchObject({ use: true, source: 'claude', kind: 'claude', model: 'claude-sonnet-5-5', key: true, keyId: 'claude' });
  expect(JSON.parse(readFileSync(join(base, 'home', 'remote-keys.json'), 'utf8'))).toEqual({ claude: claude.key });
}, T);

test('/remote claude with no key yet asks only for it, then Connect; the computer keeps its own key; /model lists both and switches back', async () => {
  const { startFakeAnthropic } = await import('./fake-anthropic.mjs');
  const { cwd, env, base } = setup();
  const remote = await startFakeServer([{ text: 'From the computer.' }, { text: 'The computer again.' }], { key: KEY, props: true });
  const claude = await startFakeAnthropic([{ text: 'ready' }, { text: 'From Claude.' }]);
  // the computer saved before Run on (its key under "default"); the Claude API saved with the stand-in's address and no key
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({
    remote: { use: true, address: '127.0.0.1', port: remote.port, connect: 'http', kind: 'llama', model: '', context: 0, key: true, keyEnd: '6789' },
    remotes: { claude: { source: 'claude', address: claude.url, port: null, connect: 'http', kind: 'claude', model: 'claude-opus-5-5', context: 0, key: false, keyEnd: '', keyId: 'claude' } },
  }));
  writeFileSync(join(base, 'home', 'remote-keys.json'), JSON.stringify({ default: KEY }), { mode: 0o600 });
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS }, args: ['--no-flows'], steps: [
    { wait: 'On the remote:', ms: 20_000 }, { sleep: 200 },
    { type: 'one' }, { key: 'enter' }, { wait: 'From the computer.' }, { sleep: 200 },
    { type: '/remote claude' }, { key: 'enter' }, { wait: 'Remote model' }, { sleep: 150 }, { snapshot: 'asked' },
    { key: `\x1b[200~${claude.key}\x1b[201~` }, { sleep: 150 }, { key: 'enter' }, { sleep: 100 }, { snapshot: 'ready' }, // the key; enter: on to Connect
    { key: 'enter' }, { wait: 'On the remote: claude-opus-5-5' }, { sleep: 200 },
    { type: 'two' }, { key: 'enter' }, { wait: 'From Claude.' }, { sleep: 200 },
    { type: '/model' }, { key: 'enter' }, { wait: 'Pick the model' }, { sleep: 150 }, { snapshot: 'model' },
    ...down(12), { key: 'enter' }, { wait: 'On the remote: Gemma' }, { sleep: 200 }, // the last row: the computer
    { type: 'three' }, { key: 'enter' }, { wait: 'The computer again.' }, { sleep: 200 },
    ...quit,
  ] });
  await remote.close();
  await claude.close();
  expect(r.snapshots.asked).toMatch(/Run on\s+◀ Claude API\s+▶/);
  expect(r.snapshots.asked).toMatch(/API key\s+█?\s*0 characters/); // typing in the key row straight away
  expect(r.snapshots.ready).toMatch(/❯ Connect\s+enter to connect/);
  expect(r.snapshots.model).toMatch(/Claude API · Opus 5\.5\s+Anthropic · billed to your key\s+✔ in use/);
  expect(r.snapshots.model).toMatch(/My other computer · 127\.0\.0\.1:\d+\s+llama\.cpp · another computer/);
  // each key under its own name: the computer's where it was, Claude's under "claude"
  expect(JSON.parse(readFileSync(join(base, 'home', 'remote-keys.json'), 'utf8'))).toEqual({ default: KEY, claude: claude.key });
  expect(remote.seen.filter((x) => x.path === '/v1/chat/completions').every((x) => x.auth === `Bearer ${KEY}`)).toBe(true);
  expect(claude.seen.every((x) => x.key === claude.key)).toBe(true);
  expect(settingsOf(base).remote).toMatchObject({ use: true, source: 'machine', keyId: 'default' });
}, T);

// An Ollama-like server: no llama.cpp /health, an open /v1/models with several models.
const ollama = () => new Promise((ok) => {
  const srv = createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ object: 'list', data: ['llava:latest', 'coder:30b', 'tiny:3b'].map((id) => ({ id })) })); return; }
    if (req.url === '/v1/chat/completions') { for await (const _ of req); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'ready' } }] })); return; }
    res.statusCode = 404; res.end('404 page not found');
  });
  srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((d) => { srv.closeAllConnections?.(); srv.close(d); }) }));
});

test('/remote Another service: Connect lists the models, a coder is highlighted, enter on another name connects with that one', async () => {
  const { cwd, env, base } = setup();
  const here = await startFakeServer([]);
  const srv = await ollama();
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS }, args: ['--url', here.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' },
    { type: '/remote' }, { key: 'enter' }, { wait: 'Remote model' }, { sleep: 150 },
    ...right(3), { sleep: 100 }, // Run on: Another service
    ...down(1), { type: srv.url }, { sleep: 80 }, { key: 'enter' }, { sleep: 80 }, // Address (enter: on to API key)
    ...down(3), { key: 'enter' }, { wait: 'has 3 models' }, { sleep: 150 }, { snapshot: 'list' }, // Connect → the list
    { key: 'down' }, { sleep: 80 }, { key: 'enter' }, { wait: 'On the remote:' }, { sleep: 200 }, { snapshot: 'on' },
    ...quit,
  ] });
  await here.close();
  await srv.close();
  const list = r.snapshots.list;
  expect(list).toMatch(/has 3 models/);
  expect(list).toContain('llava:latest');
  expect(list).toContain('coder:30b');
  expect(list).toContain('tiny:3b');
  expect(list).toMatch(/coder:30b\s+suggested/);
  expect(r.snapshots.on).toMatch(/On the remote: tiny:3b/);
  expect(settingsOf(base).remote).toMatchObject({ use: true, source: 'openai', kind: 'openai', model: 'tiny:3b', key: false });
}, T);

// A fuller Ollama: its own API too (/api/version, /api/tags, /api/ps, /api/show, /api/generate),
// and a chat that streams, saying which model answered. A model without tools refuses them as
// Ollama 0.32 does; one loaded by /api/generate then runs at 64k (as /api/ps says).
const fullOllama = () => new Promise((ok) => {
  const MODELS = [
    { name: 'tiny:3b', family: 'llama', params: '3.2B', caps: ['completion', 'tools'], ctx: 131072, size: 2.0e9, at: '2026-07-01' },
    { name: 'coder:30b', family: 'qwen3moe', params: '30.5B', caps: ['completion', 'tools'], ctx: 262144, size: 18.6e9, at: '2025-12-20' },
    { name: 'oldchat:14b', family: 'phi3', params: '14.7B', caps: ['completion'], ctx: 16384, size: 9.1e9, at: '2025-12-24' },
    { name: 'embed:latest', family: 'gemma3', params: '307.58M', caps: ['embedding'], ctx: 2048, size: 0.6e9, at: '2026-06-16' },
  ];
  const loaded = new Map([['tiny:3b', 131072]]);
  const chats = [];
  const srv = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const body = b ? JSON.parse(b) : {};
    const json = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    const m = MODELS.find((x) => x.name === body.model);
    if (req.url === '/api/version') return json(200, { version: '0.32.12' });
    if (req.url === '/api/tags') return json(200, { models: MODELS.map((x) => ({ name: x.name, size: x.size, digest: `d-${x.name}`, modified_at: `${x.at}T12:00:00Z`, details: { family: x.family, parameter_size: x.params, quantization_level: 'Q4_K_M' } })) });
    if (req.url === '/api/ps') return json(200, { models: [...loaded].map(([name, ctx]) => ({ name, size: MODELS.find((x) => x.name === name).size, context_length: ctx })) });
    if (req.url === '/api/show') return m ? json(200, { details: { family: m.family, parameter_size: m.params, quantization_level: 'Q4_K_M' }, model_info: { [`${m.family}.context_length`]: m.ctx }, capabilities: m.caps }) : json(404, { error: 'not found' });
    if (req.url === '/api/generate') { await new Promise((r) => setTimeout(r, 300)); loaded.set(body.model, Math.min(m.ctx, 65536)); return json(200, { model: body.model, response: '', done: true, done_reason: 'load' }); }
    if (req.url === '/v1/models') return json(200, { object: 'list', data: MODELS.map((x) => ({ id: x.name, object: 'model', owned_by: 'library' })) });
    if (req.url === '/v1/chat/completions') {
      chats.push({ model: body.model, tools: 'tools' in body, stream: Boolean(body.stream) });
      if (body.tools && !m.caps.includes('tools')) return json(400, { error: { message: `registry.ollama.ai/library/${body.model} does not support tools`, type: 'invalid_request_error' } });
      if (!body.stream) return json(200, { choices: [{ message: { content: '' } }] });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `From ${body.model}.` } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
      return res.end();
    }
    json(404, { error: 'not found' });
  });
  srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${srv.address().port}`, port: srv.address().port, chats, loaded, close: () => new Promise((d) => { srv.closeAllConnections?.(); srv.close(d); }) }));
});

test('on an Ollama service: the footer names the model and where it runs; /model is the service’s list; another model is switched to in place (loaded first, the chat kept); one without tools asks, then answers in words', async () => {
  const { cwd, env, base } = setup();
  const srv = await fullOllama();
  const r0 = { source: 'openai', address: srv.url, port: null, connect: 'http', kind: 'openai', model: 'tiny:3b', context: 0, key: false, keyEnd: '', keyId: 'openai' };
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { ...r0, use: true }, remotes: { openai: r0 } }));
  const where = `127.0.0.1:${srv.port}`;
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS }, args: ['--no-flows'], timeoutMs: 50_000, steps: [
    { wait: 'On the remote:', ms: 20_000 }, { sleep: 300 }, { snapshot: 'start' },
    { type: 'one' }, { key: 'enter' }, { wait: 'From tiny:3b.' }, { sleep: 200 },
    { type: '/model' }, { key: 'enter' }, { wait: 'Loaded on the service' }, { sleep: 300 }, { snapshot: 'list' },
    { type: 'coder' }, { sleep: 200 }, { snapshot: 'filtered' },
    { key: 'enter' }, { wait: 'Now on coder:30b' }, { wait: 'coder:30b is loaded on the service' }, { sleep: 300 }, { snapshot: 'switched' },
    { type: 'two' }, { key: 'enter' }, { wait: 'From coder:30b.' }, { sleep: 200 },
    { type: '/model' }, { key: 'enter' }, { wait: 'Loaded on the service' }, { sleep: 200 },
    { type: 'oldchat' }, { sleep: 200 }, { key: 'enter' }, { wait: 'cannot use tools' }, { sleep: 150 }, { snapshot: 'ask' },
    { key: 'down' }, { sleep: 80 }, { key: 'enter' }, { wait: 'Now on oldchat:14b' }, { sleep: 200 },
    { type: 'three' }, { key: 'enter' }, { wait: 'From oldchat:14b.' }, { sleep: 200 }, { snapshot: 'words' },
    ...quit,
  ] });
  await srv.close();
  const s = r.snapshots;
  // the footer: the model, where it runs
  expect(s.start).toMatch(new RegExp(`● tiny:3b on ${where.replace('.', '\\.')}`));
  // /model: the service's list, the one in use marked, what each can do; the chat-only model and this Mac folded
  expect(s.list).toContain('Model · Another service');
  expect(s.list).toMatch(/Ollama 0\.32\.12/);
  expect(s.list).toMatch(/❯ tiny:3b\s+3\.2B\s+Q4_K_M\s+128k\s+tools\s+2\.0 GB\s+✔ in use/);
  expect(s.list).toMatch(/Can run the agent/);
  expect(s.list).toMatch(/coder:30b\s+30\.5B MoE\s+Q4_K_M\s+256k\s+tools\s+18\.6 GB/);
  expect(s.list).toMatch(/▸ Chat only\s+1 on the service/);
  expect(s.list).toMatch(/▸ This Mac/);
  expect(s.list).not.toContain('embed:latest');
  expect(s.filtered).toMatch(/Filter\s+coder/);
  expect(s.filtered).toMatch(/❯ coder:30b/);
  expect(s.filtered).toContain('Not loaded yet: it loads as you switch (18.6 GB), so the first reply may wait.');
  // switched in place: loaded on the service, its context read once loaded, the footer follows, the pick kept
  expect(s.switched).toMatch(/coder:30b is loaded on the service \(\d+ s\) · 64k context/);
  expect(s.switched).toMatch(new RegExp(`● coder:30b on ${where.replace('.', '\\.')}`));
  expect(srv.loaded.get('coder:30b')).toBe(65536);
  // a model without tools asks first, then answers in words: its first ask with tools is refused, the next goes without
  expect(s.ask).toMatch(/oldchat:14b cannot use tools/);
  expect(s.ask).toMatch(/Switch to oldchat:14b anyway/);
  const old = srv.chats.filter((c) => c.model === 'oldchat:14b' && c.stream);
  expect(old.map((c) => c.tools)).toEqual([true, false]);
  // the chat was kept across both switches: one model answered each message
  expect(srv.chats.filter((c) => c.stream).map((c) => c.model)).toEqual(['tiny:3b', 'coder:30b', 'oldchat:14b', 'oldchat:14b']);
  const saved = settingsOf(base);
  expect(saved.remote).toMatchObject({ use: true, source: 'openai', model: 'oldchat:14b' });
  expect(saved.remotes.openai.model).toBe('oldchat:14b');
}, T);
