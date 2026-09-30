// End-to-end, the real app in a pseudo-terminal (see app.test.mjs). Here:
// /remote, the form for a model on another machine: filled in by keys and a
// paste, checked with Test, saved, then used; a remote saved as on is used
// from the start (nothing loads on this Mac); one that does not answer asks
// what to do. The key is kept in a file in the test's home, never the Keychain.
import { test, expect } from 'bun:test';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';

const KEY = 'test-remote-test-0123456789';
const settingsOf = (base) => JSON.parse(readFileSync(join(base, 'home', 'settings.json'), 'utf8'));
const down = (n) => Array.from({ length: n }, () => [{ key: 'down' }, { sleep: 70 }]).flat();

test('/remote: fill in the form (a pasted key), Test it, Save: the next message goes to the remote with its key, and only the key’s end is saved in settings', async () => {
  const { cwd, env, base } = setup();
  const here = await startFakeServer([]);
  const remote = await startFakeServer([{ text: 'Hello from the remote.' }], { key: KEY, props: true });
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_REMOTE_KEYSTORE: 'file' }, args: ['--url', here.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' },
    { type: '/remote' }, { key: 'enter' }, { wait: 'Remote model' }, { sleep: 150 }, { snapshot: 'form' },
    { key: 'right' }, { sleep: 80 }, // Use: Remote
    ...down(2), { type: '127.0.0.1' }, { sleep: 80 }, { key: 'enter' }, { sleep: 80 }, // Address
    ...down(1), { type: String(remote.port) }, { sleep: 80 }, { key: 'enter' }, { sleep: 80 }, // Port
    ...down(1), { key: `\x1b[200~${KEY}\n\x1b[201~` }, { sleep: 150 }, { snapshot: 'typingKey' }, { key: 'enter' }, { sleep: 80 }, // API key, pasted
    ...down(4), { key: 'enter' }, { wait: '✔ it works' }, { sleep: 150 }, { snapshot: 'tested' }, // Test
    ...down(1), { key: 'enter' }, { wait: 'On the remote:' }, { sleep: 200 }, { snapshot: 'on' }, // Save
    { type: 'hello' }, { key: 'enter' }, { wait: 'Hello from the remote.' },
    { type: '/doctor' }, { key: 'enter' }, { wait: 'Doctor · on a remote model' }, { sleep: 150 }, { snapshot: 'doctor' },
    ...quit,
  ] });
  await here.close();
  await remote.close();
  const form = r.snapshots.form;
  for (const row of ['Use', 'Connect', 'Address', 'Port', 'API key', 'Server', 'Model', 'Context', 'Test', 'Save']) expect(form).toContain(row);
  expect(form).toMatch(/Use\s+◀ This Mac\s+▶/);
  expect(form).toMatch(/Server\s+◀ llama\.cpp\s+▶/);
  expect(r.snapshots.typingKey).toContain(`${'•'.repeat(KEY.length)}`);
  expect(r.snapshots.typingKey).toContain(`${KEY.length} characters`);
  expect(r.snapshots.typingKey).not.toContain(KEY);
  expect(r.snapshots.tested).toMatch(/Test\s+✔ it works/);
  expect(r.snapshots.tested).toContain('the key was accepted');
  expect(r.snapshots.tested).toContain('runs gemma-4-12B-it-qat-UD-Q4_K_XL.gguf · 32k context · 2 slots');
  expect(r.snapshots.on).toContain(`On the remote: Gemma 4 12B QAT · 127.0.0.1:${remote.port} · llama.cpp`);
  expect(r.snapshots.on.replace(/\s+/g, ' ')).toContain(`now go to 127.0.0.1:${remote.port}; /remote switches back`);
  expect(r.snapshots.doctor).toContain('in the key file (••••6789)');
  // the chat went to the remote with the key; nothing went there without it but /health
  const chats = remote.seen.filter((x) => x.path === '/v1/chat/completions');
  expect(chats.length).toBeGreaterThan(0);
  expect(remote.seen.filter((x) => x.path !== '/health').every((x) => x.auth === `Bearer ${KEY}`)).toBe(true);
  expect(here.requests.filter((b) => JSON.stringify(b).includes('hello')).length).toBe(0);
  // saved: the key's end in settings.json, the key in its own file readable by you only
  const s = settingsOf(base);
  expect(s.remote).toEqual({ use: true, address: '127.0.0.1', port: remote.port, connect: 'http', kind: 'llama', model: '', context: 0, key: true, keyEnd: '6789' });
  expect(readFileSync(join(base, 'home', 'settings.json'), 'utf8')).not.toContain(KEY);
  expect(JSON.parse(readFileSync(join(base, 'home', 'remote-keys.json'), 'utf8'))).toEqual({ default: KEY });
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
  expect(r.snapshots.model).toMatch(/Remote · 127\.0\.0\.1:\d+\s+llama\.cpp · another machine\s+✔ in use/);
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
  expect(asked).toMatch(/Use Gemma 4 12B QAT on this Mac for now/);
  expect(asked).toContain('Open /remote');
  expect(r.snapshots.form).toMatch(/Use\s+◀ Remote\s+▶/);
  expect(r.snapshots.form).toMatch(new RegExp(`Port\\s+${port}`));
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

test('/remote with Server: Claude API: Test lists the models, Save, and the reply comes through Anthropic’s Messages API with the key in x-api-key', async () => {
  const { startFakeAnthropic } = await import('./fake-anthropic.mjs');
  const { cwd, env, base } = setup();
  const here = await startFakeServer([]);
  const claude = await startFakeAnthropic([{ text: 'ready' }, { thinking: 'A short hello will do.', text: 'Hello from Claude.' }]);
  const down = (n) => Array.from({ length: n }, () => [{ key: 'down' }, { sleep: 80 }]).flat();
  const right = (n) => Array.from({ length: n }, () => [{ key: 'right' }, { sleep: 80 }]).flat();
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_REMOTE_KEYSTORE: 'file' }, args: ['--url', here.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' },
    { type: '/remote' }, { key: 'enter' }, { wait: 'Remote model' }, { sleep: 150 },
    ...right(1), // Use: Remote
    ...down(2), { type: claude.url }, { sleep: 80 }, { key: 'enter' }, { sleep: 80 }, // Address: the stand-in
    ...down(2), { key: `\x1b[200~${claude.key}\x1b[201~` }, { sleep: 150 }, { key: 'enter' }, { sleep: 80 }, // API key
    ...down(1), ...right(2), { sleep: 150 }, { snapshot: 'kind' }, // Server: llama.cpp → OpenAI-compatible → Claude API
    ...down(3), { key: 'enter' }, { wait: '✔ it works' }, { sleep: 150 }, { snapshot: 'tested' },
    ...down(1), { key: 'enter' }, { wait: 'On the remote:' }, { sleep: 200 }, { snapshot: 'on' },
    { type: 'hello' }, { key: 'enter' }, { wait: 'Hello from Claude.' }, { sleep: 200 },
    ...quit,
  ] });
  await here.close();
  await claude.close();
  expect(r.snapshots.kind).toMatch(/Server\s+◀ Claude API\s+▶/);
  expect(r.snapshots.kind).toMatch(/Model\s+claude-opus-5-5/);
  expect(r.snapshots.tested).toContain('model claude-opus-5-5 · 1000k context');
  expect(r.snapshots.tested).toContain('answered "ready"');
  expect(r.snapshots.on.replace(/\s+/g, ' ')).toContain(`On the remote: claude-opus-5-5 · 127.0.0.1:${claude.port} · Claude API`);
  const posts = claude.seen.filter((s) => s.path.startsWith('/v1/messages'));
  expect(posts.length).toBeGreaterThanOrEqual(2);
  expect(claude.seen.every((s) => s.key === claude.key)).toBe(true);
  const chat = posts.at(-1).body;
  expect(chat).toMatchObject({ model: 'claude-opus-5-5', stream: true });
  expect(chat.system).toContain('Agentic Coder');
  expect(chat.tools.length).toBeGreaterThan(3);
  expect(settingsOf(base).remote).toMatchObject({ use: true, kind: 'claude', key: true });
}, T);
