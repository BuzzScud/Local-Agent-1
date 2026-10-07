// End-to-end, the real app in a pseudo-terminal (see app.test.mjs). Here:
// /remote, the form for where the model runs: Run on first, then only that
// service's rows, filled in by keys and a paste; Connect checks first and
// changes nothing when that fails, else saves and switches; /remote claude
// asks only for the key; each service keeps its own key and is a /model row.
// A remote saved as on is used from the start (nothing loads on this Mac); one
// that does not answer asks what to do. The keys are kept in a file in the
// test's home, never the Keychain.
import { test, expect } from 'bun:test';
import { readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
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
    ...right(1), { sleep: 100 }, // More opens (→: with an address, enter connects)
    ...down(1), { type: String(remote.port) }, { sleep: 80 }, { key: 'enter' }, { sleep: 80 }, { snapshot: 'more' }, // Port
    ...down(4), { key: 'enter' }, { wait: 'it did not work' }, { sleep: 150 }, { snapshot: 'failed' }, // Connect (past Memory sent): the wrong key
    { fn: () => { afterFail = existsSync(join(base, 'home', 'settings.json')) ? settingsOf(base).remote ?? null : null; } },
    ...up(7), { key: `\x1b[200~${KEY}\x1b[201~` }, { sleep: 150 }, { key: 'enter' }, { sleep: 80 }, // API key again
    ...down(6), { key: 'enter' }, { wait: 'On the remote:' }, { sleep: 200 }, { snapshot: 'on' }, // Connect
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
  for (const row of ['Address', 'Reach by', 'API key', 'More']) expect(hasRow(computer, row)).toBe(true);
  expect(computer).toMatch(/│ [ ❯]\s+Connect\s+Save only\s/); // one row: Connect · Save only
  for (const row of ['Port', 'Server', 'Context']) expect(hasRow(computer, row)).toBe(false); // behind More
  expect(computer).not.toContain('Not ready'); // nothing tried yet
  expect(r.snapshots.typingKey).toContain(`${'•'.repeat('test-wrong-0123456789'.length)}`);
  expect(r.snapshots.typingKey).not.toContain('test-wrong-0123456789');
  expect(r.snapshots.more).toMatch(new RegExp(`Port\\s+${remote.port}`));
  expect(r.snapshots.more).toMatch(/Server\s+◀ llama\.cpp\s+▶/);
  expect(r.snapshots.failed).toMatch(/Connect\s+Save only\s+✗ it did not work/);
  expect(r.snapshots.failed).toContain('the API key was not accepted');
  expect(afterFail).toBe(null); // nothing saved by a Connect that did not work
  expect(r.snapshots.on).toContain(`On the remote: Gemma 4 12B QAT · 127.0.0.1:${remote.port} · llama.cpp`);
  expect(r.snapshots.on.replace(/\s+/g, ' ')).toContain('your prompts and files go there; /remote switches back');
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

test('coding -p on an Ollama service: a model that can think thinks unless you say otherwise; one that cannot is not asked; its own Effort, or --no-think, wins', async () => {
  const { fakeOllama } = await import('./fake-ollama.mjs');
  const { cwd, env, base } = setup();
  const srv = await fakeOllama();
  const cli = join(import.meta.dir, '..', 'src', 'cli.jsx');
  const r0 = { source: 'openai', kind: 'openai', connect: 'http', address: srv.url, port: null, context: 0, key: false, keyEnd: '', keyId: 'openai' };
  const think = async (model, { args = [], tuned } = {}) => {
    writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ thinking: false, remote: { ...r0, model, use: true, ...(tuned ? { tuned } : {}) } }));
    const before = srv.chats().length;
    const p = Bun.spawn(['bun', cli, '-p', 'hello', '--no-flows', ...args], { cwd, env: { ...process.env, ...env, AGENTIC_NO_UPDATE: '1', AGENTIC_MEMORY_SAVE: 'off', AGENTIC_NO_MEMORY: '1' }, stdout: 'pipe', stderr: 'pipe' });
    await p.exited;
    return srv.chats().slice(before).filter((c) => c.stream)[0]?.think;
  };
  // (The shared thinking: false is this Mac's models'; a model on /remote has its own.)
  expect(await think('thinker:35b')).toBe(true);
  expect(await think('tiny:3b')).toBe(undefined);
  expect(await think('thinker:35b', { args: ['--no-think'] })).toBe(false);
  expect(await think('thinker:35b', { tuned: { 'thinker:35b': { level: 'low' } } })).toBe(false);
  await srv.close();
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
    ...down(1), ...right(1), { sleep: 100 }, // More opens (→: with a key, enter connects)
    ...down(1), { type: claude.url }, { sleep: 80 }, { key: 'enter' }, { sleep: 80 }, // Address: the stand-in (enter: on to Context)
    ...down(2), { key: 'enter' }, { wait: 'On the remote:' }, { sleep: 200 }, { snapshot: 'on' }, // Connect (past Memory sent)
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
  expect(r.snapshots.ready).toMatch(/❯\s+Connect\s+Save only\s+checks the key and asks for one word/);
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

// A fuller Ollama: its own API too (/api/version, /api/tags, /api/ps, /api/show, /api/generate,
// /api/chat streamed a JSON object a line, saying which model answered and how many replies so far).
// A model loads at the num_ctx asked for, else at the service's own (serviceCtx, at most its longest);
// one asked to load at more than it fits (fits) answers 500 out of memory, as a GPU service does.
const OLLAMA_MODELS = [
  { name: 'tiny:3b', family: 'llama', params: '3.2B', caps: ['completion', 'tools'], ctx: 131072, size: 2.0e9, at: '2026-07-01' },
  { name: 'coder:30b', family: 'qwen3moe', params: '30.5B', caps: ['completion', 'tools'], ctx: 262144, size: 18.6e9, at: '2025-12-20' },
  { name: 'oldchat:14b', family: 'phi3', params: '14.7B', caps: ['completion'], ctx: 16384, size: 9.1e9, at: '2025-12-24' },
  { name: 'embed:latest', family: 'gemma3', params: '307.58M', caps: ['embedding'], ctx: 2048, size: 0.6e9, at: '2026-06-16' },
  { name: 'huge:120b', family: 'laguna', params: '117.6B', caps: ['completion', 'tools'], ctx: 262144, size: 75.2e9, at: '2026-07-23', fits: 65536 },
  { name: 'giant:400b', family: 'laguna', params: '400B', caps: ['completion', 'tools'], ctx: 262144, size: 240.0e9, at: '2026-07-24', fits: 0 },
];
const fullOllama = ({ serviceCtx = 65536, models = OLLAMA_MODELS } = {}) => new Promise((ok) => {
  const loaded = new Map([['tiny:3b', 131072]]);
  const chats = [];
  const named = []; // each chat's tool names
  const thinks = []; // each chat's think (absent: undefined)
  const predicts = []; // each chat's num_predict
  const keeps = []; // each chat's keep_alive
  const loads = [];
  const OOM = 'llama-server process has terminated: exit status 1: cudaMalloc failed: out of memory\nalloc_tensor_range: failed to allocate ROCm0 buffer of size 74995960832\nerror loading model: unable to allocate ROCm0 buffer';
  // What a request with these options loads the model at, or null when it does not fit.
  const loadAt = (m, options) => { const at = options?.num_ctx ?? Math.min(m.ctx, serviceCtx); return m.fits !== undefined && at > m.fits ? null : at; };
  const srv = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const body = b ? JSON.parse(b) : {};
    const json = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    const m = models.find((x) => x.name === body.model);
    if (req.url === '/api/version') return json(200, { version: '0.32.12' });
    if (req.url === '/api/tags') return json(200, { models: models.map((x) => ({ name: x.name, size: x.size, digest: `d-${x.name}`, modified_at: `${x.at}T12:00:00Z`, details: { family: x.family, parameter_size: x.params, quantization_level: 'Q4_K_M' } })) });
    if (req.url === '/api/ps') return json(200, { models: [...loaded].map(([name, ctx]) => ({ name, size: models.find((x) => x.name === name).size, context_length: ctx })) });
    if (req.url === '/api/show') return m ? json(200, { details: { family: m.family, parameter_size: m.params, quantization_level: 'Q4_K_M' }, model_info: { [`${m.family}.context_length`]: m.ctx }, capabilities: m.caps }) : json(404, { error: 'not found' });
    if (req.url === '/api/generate') {
      await new Promise((r) => setTimeout(r, 300));
      const at = loadAt(m, body.options);
      loads.push({ model: body.model, numCtx: body.options?.num_ctx ?? null, ok: at !== null });
      if (at === null) return json(500, { error: OOM });
      loaded.set(body.model, at);
      return json(200, { model: body.model, response: '', done: true, done_reason: 'load' });
    }
    if (req.url === '/v1/models') return json(200, { object: 'list', data: models.map((x) => ({ id: x.name, object: 'model', owned_by: 'library' })) });
    if (req.url === '/api/chat') {
      if (!body.stream) return json(200, { model: body.model, message: { role: 'assistant', content: 'ready' }, done: true });
      chats.push({ model: body.model, tools: 'tools' in body, numCtx: body.options?.num_ctx ?? null });
      named.push((body.tools ?? []).map((x) => x.function?.name ?? x.name));
      thinks.push(body.think);
      predicts.push(body.options?.num_predict ?? null);
      keeps.push(body.keep_alive);
      if (body.tools && !m.caps.includes('tools')) return json(400, { error: `registry.ollama.ai/library/${body.model} does not support tools` });
      const at = loadAt(m, body.options);
      if (at === null) return json(500, { error: OOM });
      loaded.set(body.model, at);
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write(`${JSON.stringify({ model: body.model, message: { role: 'assistant', content: `From ${body.model}, reply ${chats.length}.` }, done: false })}\n`);
      res.write(`${JSON.stringify({ model: body.model, message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 900, prompt_eval_duration: 1e9, eval_count: 6, eval_duration: 1e8 })}\n`);
      return res.end();
    }
    json(404, { error: 'not found' });
  });
  srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${srv.address().port}`, port: srv.address().port, chats, named, thinks, predicts, keeps, loads, loaded, close: () => new Promise((d) => { srv.closeAllConnections?.(); srv.close(d); }) }));
});

test('on an Ollama service: the footer names the model and where it runs; /model is the service’s list; another model is switched to in place (loaded first, the chat kept); one without tools asks, then answers in words', async () => {
  const { cwd, env, base } = setup();
  const srv = await fullOllama();
  const r0 = { source: 'openai', address: srv.url, port: null, connect: 'http', kind: 'openai', model: 'tiny:3b', context: 0, key: false, keyEnd: '', keyId: 'openai' };
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { ...r0, use: true }, remotes: { openai: r0 } }));
  // This Mac's group lists only the models whose file is here: a stand-in for Qwen's.
  mkdirSync(join(base, 'home', 'models'), { recursive: true });
  writeFileSync(join(base, 'home', 'models', MODELS.qwen.file), 'stand-in');
  const where = `127.0.0.1:${srv.port}`;
  let loadsAtMenu = -1;
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS }, args: ['--no-flows'], timeoutMs: 50_000, steps: [
    { wait: 'On the remote:', ms: 20_000 }, { sleep: 300 }, { snapshot: 'start' },
    { type: 'one' }, { key: 'enter' }, { wait: 'From tiny:3b, reply 1.' }, { sleep: 200 },
    { type: '/model' }, { key: 'enter' }, { wait: 'Loaded on the service' }, { sleep: 300 }, { snapshot: 'list' },
    { type: 'coder' }, { sleep: 200 }, { snapshot: 'filtered' },
    // enter: its own settings first; nothing loads until enter there
    { key: 'enter' }, { wait: 'coder:30b · its own settings' }, { sleep: 300 }, { snapshot: 'menu' }, { fn: () => { loadsAtMenu = srv.loads.filter((l) => l.model === 'coder:30b').length; } },
    { key: 'enter' }, { wait: 'Now on coder:30b' }, { wait: 'coder:30b is loaded on the service' }, { sleep: 300 }, { snapshot: 'switched' },
    { type: 'two' }, { key: 'enter' }, { wait: 'From coder:30b, reply 2.' }, { sleep: 200 },
    { type: '/model' }, { key: 'enter' }, { wait: 'Loaded on the service' }, { sleep: 200 },
    { type: 'oldchat' }, { sleep: 200 }, { key: 'enter' }, { wait: 'cannot use tools' }, { sleep: 150 }, { snapshot: 'ask' },
    { key: 'down' }, { sleep: 80 }, { key: 'enter' }, { wait: 'oldchat:14b · its own settings' }, { sleep: 200 }, { key: 'enter' }, { wait: 'Now on oldchat:14b' }, { sleep: 200 },
    { type: 'three' }, { key: 'enter' }, { wait: 'From oldchat:14b, reply 3.' }, { sleep: 200 }, { snapshot: 'words' },
    ...quit,
  ] });
  await srv.close();
  const s = r.snapshots;
  // the footer: the model, where it runs
  expect(s.start).toMatch(new RegExp(`● tiny:3b on ${where.replace('.', '\\.')}`));
  // /model: the service's list, the one in use marked, what each can do; the chat-only model and this Mac folded
  expect(s.list).toContain('Model · Another service');
  expect(s.list).toMatch(/Ollama 0\.32\.12/);
  expect(s.list).toMatch(/❯ tiny:3b\s+3\.2B\s+Q4_K_M\s+128k\s+tools\s+2\.0 GB\s+not tried\s+✔ in use/);
  expect(s.list).toMatch(/Can run the agent/);
  expect(s.list).toMatch(/coder:30b\s+30\.5B MoE\s+Q4_K_M\s+256k\s+tools\s+18\.6 GB/);
  expect(s.list).toMatch(/▸ Chat only\s+1 on the service/);
  expect(s.list).toMatch(/▸ This Mac\s+1 model\b/); // the models whose file is on this Mac: Qwen's stand-in only
  expect(s.list).not.toContain('embed:latest');
  expect(s.filtered).toMatch(/Filter\s+coder/);
  expect(s.filtered).toMatch(/❯ coder:30b/);
  expect(s.filtered).toContain('Not loaded yet: it loads as you switch (18.6 GB), so the first reply may wait.');
  // its own settings before the switch: the model's rows, its Thinking (it cannot think), no Thinking cap, nothing loaded yet
  expect(s.menu).toMatch(/coder:30b · its own settings\s+nothing loads until you press enter/);
  expect(s.menu).toContain('Nothing suggested for it on the ranks page');
  expect(s.menu).toMatch(/Thinking\s+◀ None\s+▶\s+answers straight away: this model cannot think first/);
  expect(s.menu).toMatch(/Steps per request\s+◀ 80\s+▶\s+default/); // a big model's
  expect(s.menu).toMatch(/Thinking cap\s+not on a service: Ollama has no thinking limit, so Reply length holds the thinking and the answer/);
  expect(s.menu).toMatch(/Reply length\s+◀ auto\s+▶\s+default · up to 32k a reply/);
  expect(s.menu).toMatch(/Temperature\s+◀ its own\s+▶/);
  expect(s.menu).toMatch(/Keep loaded\s+◀ while open\s+▶/);
  expect(s.menu).not.toContain('Embedder');
  expect(loadsAtMenu).toBe(0);
  expect(srv.loads.filter((l) => l.model === 'coder:30b').length).toBeGreaterThan(0);
  // switched in place: loaded on the service, its context read once loaded, the footer follows, the pick kept
  expect(s.switched).toMatch(/coder:30b is loaded on the service \(\d+ s\) · 64k context/);
  expect(s.switched).toMatch(new RegExp(`● coder:30b on ${where.replace('.', '\\.')}`));
  expect(srv.loaded.get('coder:30b')).toBe(65536);
  // a model without tools asks first, then answers in words: it is never sent the tools (the service said it cannot use them)
  expect(s.ask).toMatch(/oldchat:14b cannot use tools/);
  expect(s.ask).toMatch(/Switch to oldchat:14b anyway/);
  // the chat was kept across both switches, in Ollama's own chat: one model answered each message
  expect(srv.chats.map((c) => [c.model, c.tools])).toEqual([['tiny:3b', true], ['coder:30b', true], ['oldchat:14b', false]]);
  const saved = settingsOf(base);
  expect(saved.remote).toMatchObject({ use: true, source: 'openai', model: 'oldchat:14b' });
  expect(saved.remotes.openai.model).toBe('oldchat:14b');
}, T);

test('big-model mode: switching to a 30B+ model that calls tools turns it on (more steps, tries and output, the app still deciding, said in a note and in /effort); back to a small one turns it off; nothing is saved', async () => {
  const { cwd, env, base } = setup();
  const srv = await fullOllama();
  const r0 = { source: 'openai', address: srv.url, port: null, connect: 'http', kind: 'openai', model: 'tiny:3b', context: 0, key: false, keyEnd: '', keyId: 'openai' };
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { ...r0, use: true }, remotes: { openai: r0 } }));
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS }, args: ['--no-flows'], timeoutMs: 50_000, steps: [
    { wait: 'On the remote:', ms: 20_000 }, { sleep: 300 },
    { type: '/model' }, { key: 'enter' }, { wait: 'Loaded on the service' }, { sleep: 300 }, { snapshot: 'list' },
    { type: 'coder' }, { sleep: 200 }, { key: 'enter' }, { wait: 'its own settings' }, { sleep: 150 }, { key: 'enter' }, { wait: 'Big-model mode for coder:30b' }, { wait: 'coder:30b is loaded on the service' }, { sleep: 300 }, { snapshot: 'switched' },
    { type: 'one' }, { key: 'enter' }, { wait: 'From coder:30b, reply 1.' }, { sleep: 200 },
    { type: '/effort' }, { key: 'enter' }, { wait: 'Use shared' }, { sleep: 200 }, { snapshot: 'panel' }, { key: 'esc' }, { sleep: 300 },
    { type: '/model' }, { key: 'enter' }, { wait: 'Loaded on the service' }, { sleep: 200 },
    { type: 'tiny' }, { sleep: 200 }, { key: 'enter' }, { wait: 'its own settings' }, { sleep: 150 }, { key: 'enter' }, { wait: 'Big-model mode off' }, { sleep: 300 }, { snapshot: 'back' },
    { type: 'two' }, { key: 'enter' }, { wait: 'From tiny:3b, reply 2.' }, { sleep: 200 },
    ...quit,
  ] });
  await srv.close();
  const s = r.snapshots;
  const flat = (x) => x.replace(/\s+/g, ' ');
  // the list marks the big ones (the in-use small one is marked in use)
  expect(s.list).toMatch(/coder:30b\s+30\.5B MoE.*18\.6 GB\s+not tried\s+big/);
  expect(s.list).toMatch(/huge:120b.*\s+big/);
  expect(s.list).not.toMatch(/tiny:3b.*\bbig\b/);
  // on: said in a note of a line, the new values
  expect(flat(s.switched)).toContain('Big-model mode for coder:30b: the model decides, 12 tries, 80 steps, 160-line output, 400-line reads · /effort');
  // /effort shows the new defaults as the defaults
  expect(s.panel).toMatch(/Who decides\s+◀ Model\s+▶\s+default · it sorts, looks and saves for itself, like Claude Code/);
  expect(s.panel).toMatch(/Steps per request\s+◀ 80\s+▶\s+default/);
  // the big model decides, as Claude Code does (3 Oct 2026): it is offered the Agent tool (helpers); the small one is not
  expect(srv.chats.map((c) => c.model)).toEqual(['coder:30b', 'tiny:3b']);
  expect(srv.named[0]).toContain('Agent');
  expect(srv.named[1]).not.toContain('Agent');
  // off again: from → to back
  expect(flat(s.back)).toContain('Big-model mode off: Who decides Model → App · Tries per fix 12 → 8 · Steps per request 80 → 40 · Command output 160 lines → 80 lines.');
  // defaults only: nothing written to the saved limits, nor kept for either model (the menus were left as they were)
  expect(settingsOf(base).limits ?? {}).toEqual({});
  expect(settingsOf(base).remote.tuned ?? {}).toEqual({});
}, T);

test('a service whose own size is less than the agent works in (Ollama’s 4k): the model it loads is loaded again at 32k, kept for it, and every request names it', async () => {
  const { cwd, env, base } = setup();
  const srv = await fullOllama({ serviceCtx: 4096 });
  const r0 = { source: 'openai', address: srv.url, port: null, connect: 'http', kind: 'openai', model: 'tiny:3b', context: 0, key: false, keyEnd: '', keyId: 'openai' };
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { ...r0, use: true }, remotes: { openai: r0 } }));
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS }, args: ['--no-flows'], timeoutMs: 40_000, steps: [
    { wait: 'On the remote:', ms: 20_000 }, { sleep: 300 },
    { type: '/model' }, { key: 'enter' }, { wait: 'Loaded on the service' }, { sleep: 200 },
    { type: 'coder' }, { sleep: 150 }, { key: 'enter' }, { wait: 'its own settings' }, { sleep: 150 }, { key: 'enter' }, { wait: 'coder:30b is loaded on the service' }, { sleep: 300 }, { snapshot: 'loaded' },
    { type: 'one' }, { key: 'enter' }, { wait: 'From coder:30b, reply 1.' }, { sleep: 200 },
    ...quit,
  ] });
  await srv.close();
  const s = r.snapshots;
  expect(s.loaded).toMatch(/coder:30b is loaded on the service \(\d+ s\) · 32k context\. Kept at that size for it; \/effort’s Context row changes it\./);
  // the service's own first (4k), then again at the floor; the reply named it
  expect(srv.loads.filter((l) => l.model === 'coder:30b').map((l) => l.numCtx)).toEqual([null, 32768]);
  expect(srv.loaded.get('coder:30b')).toBe(32768);
  expect(srv.chats.at(-1)).toEqual({ model: 'coder:30b', tools: true, numCtx: 32768 });
  expect(settingsOf(base).remote.contexts).toMatchObject({ 'coder:30b': 32768 });
}, T);

test('a model that does not fit on the service: tried again at half the context until it does (that size kept for it); one that never fits goes back, a message sent meanwhile waits for it; /effort’s Context is the model’s own', async () => {
  const { cwd, env, base } = setup();
  const srv = await fullOllama({ serviceCtx: 262144 });
  const r0 = { source: 'openai', address: srv.url, port: null, connect: 'http', kind: 'openai', model: 'tiny:3b', context: 0, key: false, keyEnd: '', keyId: 'openai' };
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { ...r0, use: true }, remotes: { openai: r0 } }));
  const where = `127.0.0.1:${srv.port}`.replace('.', '\\.');
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS }, args: ['--no-flows'], timeoutMs: 55_000, steps: [
    { wait: 'On the remote:', ms: 20_000 }, { sleep: 300 },
    // huge: 256k and 128k do not fit, 64k does
    { type: '/model' }, { key: 'enter' }, { wait: 'Loaded on the service' }, { sleep: 200 },
    { type: 'huge' }, { sleep: 150 }, { key: 'enter' }, { wait: 'its own settings' }, { sleep: 150 }, { key: 'enter' }, { wait: 'huge:120b is loaded on the service' }, { sleep: 300 }, { snapshot: 'fitted' },
    { type: 'one' }, { key: 'enter' }, { wait: 'From huge:120b, reply 1.' }, { sleep: 200 },
    // giant: never fits; "two" is sent while it is loading, waits, and goes to huge once it is back
    { type: '/model' }, { key: 'enter' }, { wait: 'Loaded on the service' }, { sleep: 200 },
    { type: 'giant' }, { sleep: 150 }, { key: 'enter' }, { wait: 'its own settings' }, { sleep: 150 }, { key: 'enter' }, { sleep: 250 },
    { type: 'two' }, { key: 'enter' }, { sleep: 150 }, { snapshot: 'waiting' },
    { wait: 'Back on huge:120b' }, { wait: 'From huge:120b, reply 2.' }, { sleep: 300 }, { snapshot: 'back' },
    // /effort: the Context row is huge's own 64k, no memory sum of this Mac; ← 32k, enter: it loads again at 32k
    // (no search rows on a service: Thinking, Who decides, then Context)
    { type: '/effort' }, { key: 'enter' }, { wait: 'Effort and limits' }, { sleep: 200 },
    ...down(2), { sleep: 100 }, { snapshot: 'panel' },
    { key: 'left' }, { sleep: 100 }, { key: 'enter' }, { wait: '· 32k context.' }, { sleep: 300 }, { snapshot: 'smaller' },
    ...quit,
  ] });
  await srv.close();
  const s = r.snapshots;
  expect(s.fitted).toMatch(/huge:120b did not fit on the service at 256k context: trying 128k…/);
  expect(s.fitted).toMatch(/huge:120b did not fit on the service at 128k context: trying 64k…/);
  expect(s.fitted).toMatch(/huge:120b is loaded on the service \(\d+ s\) · 64k context\. Kept at that size for it; \/effort’s Context row changes it\./);
  expect(srv.loads.filter((l) => l.model === 'huge:120b').slice(0, 3).map((l) => [l.numCtx, l.ok])).toEqual([[null, false], [131072, false], [65536, true]]);
  expect(srv.chats[0]).toEqual({ model: 'huge:120b', tools: true, numCtx: 65536 });
  // giant: every size down to 32k, then back on huge; the message waited, and went to huge, never to giant
  expect(s.waiting).toMatch(/⏵ Queued: two\s+· sends once the model has loaded on the service/);
  expect(s.waiting).toMatch(/◐ giant:400b loading on the service · 240\.0 GB/);
  expect(srv.loads.filter((l) => l.model === 'giant:400b').map((l) => l.numCtx)).toEqual([null, 131072, 65536, 32768]);
  expect(s.back.replace(/\s+/g, ' ')).toContain('giant:400b did not load on the service: the service has no room for it (its weights alone are 240.0 GB), even at 32k context, next to the models it keeps loaded. Back on huge:120b.');
  expect(s.back).toMatch(new RegExp(`● huge:120b on ${where}`));
  expect(srv.chats.map((c) => c.model)).toEqual(['huge:120b', 'huge:120b']);
  expect(s.back).not.toMatch(/stopped answering|connecting again/);
  // /effort on the service: the model's own context, said in its words, never NaN
  expect(s.panel).toMatch(/❯ Context\s+◀ 64k\s+▶\s+↻? ?64k on the service · huge:120b loads again at this size/);
  expect(s.panel).not.toContain('NaN');
  // the search is the service's own (/subagents): its rows are not in /effort there
  expect(s.panel).toMatch(/Not here\s+Thinking cap: Ollama has none, Reply length holds it all · Search: the service’s own/);
  for (const row of ['Embedder', 'Retriever', 'Reranker']) expect(s.panel).not.toContain(row);
  expect(s.smaller).toMatch(/Context 64k → 32k for huge:120b, kept for it/);
  expect(srv.loads.at(-1)).toEqual({ model: 'huge:120b', numCtx: 32768, ok: true });
  const saved = settingsOf(base);
  expect(saved.remote.contexts).toEqual({ 'huge:120b': 32768 });
  expect(saved.remotes.openai.contexts).toEqual({ 'huge:120b': 32768 });
  expect(saved.remote.model).toBe('huge:120b');
}, T);

// /model's menu (2 Oct 2026, the user's picks): enter on a model on the service opens its own settings first
// (the model's real Thinking choices, its rows, the ranks page's values suggested beside them, no Thinking cap);
// nothing loads until enter there, which switches with them. Each model keeps its own: another model has the
// shared ones, and the first one's come back with it. On the model in use the menu saves at once.
const MENU_MODELS = [
  { name: 'tiny:3b', family: 'llama', params: '3.2B', caps: ['completion', 'tools'], ctx: 131072, size: 2.0e9, at: '2026-07-01' },
  { name: 'laguna-s-2.1:latest', family: 'laguna', params: '117.6B', caps: ['completion', 'tools', 'thinking'], ctx: 262144, size: 75.2e9, at: '2026-07-23' },
];
test('/model on a service: a model’s own settings come first (Thinking Off · Max, suggested values, s fills them in), nothing loads until enter; they are kept for it alone and come back with it', async () => {
  const { cwd, env, base } = setup();
  const srv = await fullOllama({ serviceCtx: 262144, models: MENU_MODELS });
  const r0 = { source: 'openai', address: srv.url, port: null, connect: 'http', kind: 'openai', model: 'tiny:3b', context: 0, key: false, keyEnd: '', keyId: 'openai' };
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { ...r0, use: true }, remotes: { openai: r0 } }));
  let lagunaLoadsAtMenu = -1;
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS }, args: ['--no-flows'], timeoutMs: 60_000, steps: [
    { wait: 'On the remote:', ms: 20_000 }, { sleep: 300 },
    { type: '/model' }, { key: 'enter' }, { wait: 'Loaded on the service' }, { sleep: 300 },
    { type: 'laguna' }, { sleep: 200 }, { key: 'enter' }, { wait: 'laguna-s-2.1:latest · its own settings' }, { sleep: 300 }, { snapshot: 'menu' },
    { fn: () => { lagunaLoadsAtMenu = srv.loads.filter((l) => l.model === 'laguna-s-2.1:latest').length; } },
    { key: 's' }, { sleep: 200 }, { snapshot: 'filled' },
    ...down(5), { key: 'left' }, { sleep: 100 }, // Keep loaded: while open → 30 min
    { key: 'enter' }, { wait: 'Now on laguna-s-2.1:latest' }, { wait: 'laguna-s-2.1:latest is loaded on the service' }, { sleep: 300 }, { snapshot: 'switched' },
    { type: 'one' }, { key: 'enter' }, { wait: 'From laguna-s-2.1:latest, reply 1.' }, { sleep: 200 },
    // the model in use: its menu saves at once (Steps 80 → 120)
    { type: '/model' }, { key: 'enter' }, { wait: 'Loaded on the service' }, { sleep: 200 }, { key: 'enter' }, { wait: 'in use · enter saves' }, { sleep: 200 }, { snapshot: 'inUse' },
    ...down(7), { key: 'right' }, { sleep: 100 }, { key: 'enter' }, { wait: 'Kept for laguna-s-2.1:latest alone' }, { sleep: 200 }, { snapshot: 'saved' },
    // another model: the shared settings (and big-model mode off)
    { type: '/model' }, { key: 'enter' }, { wait: 'Loaded on the service' }, { sleep: 200 },
    { type: 'tiny' }, { sleep: 150 }, { key: 'enter' }, { wait: 'tiny:3b · its own settings' }, { sleep: 200 }, { snapshot: 'tinyMenu' }, { key: 'enter' }, { wait: 'Big-model mode off' }, { sleep: 300 }, { snapshot: 'back' },
    // (laguna thinks at Max, so Look first sent its replies back for more: count none of them)
    { type: 'two' }, { key: 'enter' }, { wait: 'From tiny:3b, reply' }, { sleep: 200 },
    // laguna's come back in its menu; esc goes back to the list, esc again closes it, nothing switched
    { type: '/model' }, { key: 'enter' }, { wait: 'Loaded on the service' }, { sleep: 200 },
    { type: 'laguna' }, { sleep: 150 }, { key: 'enter' }, { wait: 'laguna-s-2.1:latest · its own settings' }, { sleep: 200 }, { snapshot: 'again' },
    { key: 'esc' }, { wait: 'Model · Another service' }, { sleep: 200 }, { snapshot: 'list' }, { key: 'esc' }, { sleep: 100 }, { key: 'esc' }, { sleep: 200 },
    ...quit,
  ] });
  await srv.close();
  const s = r.snapshots;
  const flat = (x) => x.replace(/\s+/g, ' ');
  // the menu: its Thinking choices with the suggested one, the suggested rows, the line on why, no Thinking cap; nothing loaded yet
  expect(s.menu).toMatch(/laguna-s-2\.1:latest · its own settings\s+nothing loads until you press enter/);
  expect(flat(s.menu)).toContain('Suggested: starved by the defaults: it thinks long, runs long tool loops and long builds · ranks page, not measured here');
  // a model on /remote thinks unless you say otherwise (3 Oct 2026): Max, its On, before anything is saved; Look first follows it
  expect(s.menu).toMatch(/Look first\s+◀ auto\s+▶\s+default · follows Thinking: 30 s/);
  expect(s.menu).toMatch(/❯ Thinking\s+◀ Max\s+▶\s+✓ suggested · thinks between its tool calls/);
  expect(s.menu).toMatch(/Context\s+◀ auto\s+▶\s+suggested 128k · default · the service's own/);
  expect(s.menu).toMatch(/Steps per request\s+◀ 80\s+▶\s+✓ suggested · default · stops a request after 80 tool steps/);
  expect(s.menu).toMatch(/Command timeout\s+◀ 2 min\s+▶\s+suggested 10 min · default/);
  expect(s.menu).toMatch(/Thinking cap\s+not on a service: Ollama has no thinking limit, so Reply length holds the thinking and the answer/);
  expect(s.menu).toMatch(/Reply length\s+◀ auto\s+▶\s+suggested 32k tokens · default · up to 32k a reply/);
  expect(s.menu).toContain('s suggested · enter switches to it · esc back to the list');
  expect(lagunaLoadsAtMenu).toBe(0);
  // s: every suggested value filled in, marked as not saved yet
  expect(s.filled).toMatch(/Thinking\s+◀ Max\s+▶\s+✓ suggested/); // already its default: nothing to fill
  expect(s.filled).toMatch(/Context\s+◀ 128k\s+▶ •\s+✓ suggested · 128k on the service · laguna-s-2\.1:latest loads at this size as you switch/);
  expect(s.filled).toMatch(/Command timeout\s+◀ 10 min\s+▶ •\s+✓ suggested/);
  expect(s.filled).toMatch(/Reply length\s+◀ 32k tokens\s+▶ •\s+✓ suggested · up to 32k a reply, thinking and answer together/);
  // the switch: loaded at its own context, its own settings in use, and it thinks (Max: think true)
  expect(srv.loads.find((l) => l.model === 'laguna-s-2.1:latest')).toEqual({ model: 'laguna-s-2.1:latest', numCtx: 131072, ok: true });
  expect(flat(s.switched)).toContain('Big-model mode for laguna-s-2.1:latest (its own settings): the model decides, reply length 32k tokens, keep loaded 30 min, 12 tries, 80 steps, 160-line output, command timeout 10 min');
  expect(srv.chats[0]).toEqual({ model: 'laguna-s-2.1:latest', tools: true, numCtx: 131072 });
  expect(srv.thinks[0]).toBe(true);
  // its Reply length and Keep loaded reach the service with each request
  expect(srv.predicts[0]).toBe(32768);
  expect(srv.keeps[0]).toBe(1800);
  // on the model in use: the same menu, saved at once and kept for it alone
  expect(s.inUse).toMatch(/laguna-s-2\.1:latest · its own settings\s+in use · enter saves, from its next step/);
  expect(s.inUse).toMatch(/Thinking\s+◀ Max\s+▶\s+✓ suggested/);
  expect(flat(s.saved)).toContain('Saved: Steps per request 80 → 120. In use from the next step; kept for next time. Kept for laguna-s-2.1:latest alone.');
  // another model: the shared ones; it cannot think
  expect(s.tinyMenu).toMatch(/Thinking\s+◀ None\s+▶/);
  expect(s.tinyMenu).toMatch(/Command timeout\s+◀ 2 min\s+▶/);
  expect(flat(s.back)).toContain('Big-model mode off: Who decides Model → App · Reply length 32k tokens → auto · Keep loaded 30 min → while open · Tries per fix 12 → 8 · Steps per request 120 → 40 · Command output 160 lines → 80 lines · Command timeout 10 min → 2 min.');
  const tinyAt = srv.chats.findIndex((c) => c.model === 'tiny:3b');
  expect(tinyAt).toBeGreaterThan(0);
  expect(srv.thinks[tinyAt]).toBe(undefined); // tiny cannot think: nothing asked
  expect(srv.predicts[tinyAt]).toBe(32768); // Reply length auto on a service: 32k (SERVICE_REPLY), room for a file
  expect(srv.keeps[tinyAt]).toBe('15m');
  // laguna's own came back with it; esc went back to the list, and nothing switched
  expect(s.again).toMatch(/Thinking\s+◀ Max\s+▶ \s/);
  expect(s.again).toMatch(/Context\s+◀ 128k\s+▶/);
  expect(s.again).toMatch(/Steps per request\s+◀ 120\s+▶/);
  expect(s.again).toMatch(/Command timeout\s+◀ 10 min\s+▶/);
  expect(s.again).toMatch(/Reply length\s+◀ 32k tokens\s+▶/);
  expect(s.again).toMatch(/Keep loaded\s+◀ 30 min\s+▶/);
  expect(s.list).toMatch(/Filter\s+laguna/); // the list as it was left
  expect(s.list).toMatch(/❯ laguna-s-2\.1:latest/);
  const saved = settingsOf(base);
  expect(saved.remote.model).toBe('tiny:3b');
  expect(saved.remote.tuned).toEqual({ 'laguna-s-2.1:latest': { limits: { replyTokens: 32768, keepLoaded: 1800, timeoutSecs: 600, steps: 120 } } }); // Max is its default: no level to keep
  expect(saved.remotes.openai.tuned).toEqual(saved.remote.tuned);
  expect(saved.remote.contexts).toEqual({ 'laguna-s-2.1:latest': 131072 });
  // nothing of it in the shared limits
  expect(saved.limits ?? {}).toEqual({});
}, T);

test('Connect on a service that is slow to answer: the line says what was found, what it waits for and counts the seconds; esc stops the request', async () => {
  const { cwd, env, base } = setup();
  const here = await startFakeServer([]);
  // A service that lists one model and takes 6 s over its one word (a model loading); it notes a request dropped before the answer.
  let dropped = false;
  const slow = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ object: 'list', data: [{ id: 'slow-model' }] })); return; }
    if (req.method === 'GET') { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return; }
    const t = setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'ready' } }] })); }, 6000);
    res.on('close', () => { if (!res.writableEnded) { dropped = true; clearTimeout(t); } });
    req.resume();
  });
  await new Promise((r) => slow.listen(0, '127.0.0.1', r));
  const svc = { source: 'openai', address: `http://127.0.0.1:${slow.address().port}`, connect: 'http', kind: 'openai', model: 'slow-model', key: false };
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remotes: { openai: svc } }));
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS }, args: ['--url', here.url, '--no-flows'], timeoutMs: 60_000, steps: [
    { wait: '? for shortcuts' },
    { type: '/remote' }, { key: 'enter' }, { wait: 'Remote model' }, { sleep: 150 },
    ...right(3), { sleep: 150 }, { snapshot: 'service' }, // Run on: Another service, as saved
    ...down(5), { sleep: 100 }, { key: 'enter' }, // Connect
    { wait: 'esc stops', ms: 10_000 }, { sleep: 2300 }, { snapshot: 'waiting' },
    { key: 'esc' }, { sleep: 2500 },
    { fn: () => { if (!dropped) throw new Error('the request was not stopped when the form closed'); } },
    ...quit,
  ] });
  await here.close();
  slow.closeAllConnections?.();
  slow.close();
  expect(r.snapshots.service).toMatch(/Run on\s+◀ Another service/);
  expect(r.snapshots.service).toContain('slow-model');
  const line = r.snapshots.waiting.split('\n').find((l) => l.includes('esc stops')) ?? '';
  expect(line).toMatch(/✔ reached in \d+ ms · ✔ model slow-model.* · asking it for one word… [2-5] s · esc stops/);
  expect(r.snapshots.waiting).toMatch(/Connect\s+Save only\s+checking…/);
  expect(dropped).toBe(true);
  expect(r.code).toBe(0);
}, T);
