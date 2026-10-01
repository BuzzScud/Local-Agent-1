// A model on another machine (/remote, models/runtime/remote.mjs) and
// `coding serve` (models/runtime/serve.mjs): the address, the key, the SSH
// tunnel, the check, and what the served model is started with. Fake servers
// and a fake ssh; the real Keychain is never touched (a key file in a temp home).
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, statSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';

// A throwaway home before the models part is loaded (it reads AGENTIC_HOME once): nothing here reaches the real ~/.agentic-coder.
process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-remote-home-'));
process.env.AGENTIC_REMOTE_KEYSTORE = 'file';
const { parseAddress, isPrivateHost, directUrl, remoteLabel, remoteProblem, remoteRisk, sshArgs, openTunnel, probe, pickRemoteModel, connectRemote, endpointOf, authHeaders, remoteModel, GENERIC_REMOTE, validSshDest, validKey, keyEnd, warmUp, serveArgs, lanAddresses, serverArgs, MODELS, HOME } = await import('../index.mjs');
test('the tests run in a throwaway home', () => { expect(HOME).not.toBe(join(homedir(), '.agentic-coder')); });

// A stand-in remote: /health open, the rest behind `key` (as llama-server
// --api-key); /props and /v1/models say what it runs; a chat answers one word.
// seen: every request's path and key header. (The terminal's own fake server
// is not imported: this part reaches the terminal only through its index.)
function startFakeServer(_replies, { key = null, props = false } = {}) {
  const seen = [];
  const server = createServer(async (req, res) => {
    seen.push({ path: req.url, method: req.method, auth: req.headers.authorization ?? null });
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/health') return json(200, { status: 'ok' });
    if (key && req.headers.authorization !== `Bearer ${key}`) return json(401, { error: { message: 'Invalid API Key' } });
    if (props && req.url === '/props') return json(200, { default_generation_settings: { n_ctx: 32768 }, total_slots: 2, model_path: '/models/gemma-4-12B-it-qat-UD-Q4_K_XL.gguf' });
    if (props && req.url === '/v1/models') return json(200, { object: 'list', data: [{ id: 'fake-model', context_length: 65536 }] });
    for await (const _ of req) { /* the body is not needed */ }
    return json(200, { choices: [{ message: { content: 'ready' } }] });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    ok({ url: `http://127.0.0.1:${port}`, port, seen, close: () => new Promise((r) => server.close(r)) });
  }));
}

const R = (o) => ({ use: true, address: '', port: null, connect: 'http', kind: 'llama', model: '', context: 0, key: false, keyEnd: '', ...o });

test('an address: an IP, a name, a port, a whole https address with a path (its /v1 dropped), IPv6; not other schemes or passwords', () => {
  expect(parseAddress('192.168.1.40')).toEqual({ scheme: null, host: '192.168.1.40', port: null, path: '' });
  expect(parseAddress(' gpu-box:9000 ')).toEqual({ scheme: null, host: 'gpu-box', port: 9000, path: '' });
  expect(parseAddress('https://api.example.com/api/v1/')).toEqual({ scheme: 'https', host: 'api.example.com', port: null, path: '/api' });
  expect(parseAddress('[::1]:8081')).toEqual({ scheme: null, host: '::1', port: 8081, path: '' });
  expect(parseAddress('fd12::5')).toEqual({ scheme: null, host: 'fd12::5', port: null, path: '' });
  expect(parseAddress('ftp://x.example')).toBe(null);
  expect(parseAddress('http://me:pw@x.example')).toBe(null);
  expect(parseAddress('')).toBe(null);
});

test('where the calls go: llama.cpp on 8080 unless a port is given; https from the Connect row or the address; the label is short', () => {
  expect(directUrl(R({ address: '192.168.1.40' }))).toBe('http://192.168.1.40:8080');
  expect(directUrl(R({ address: '192.168.1.40', port: 9000 }))).toBe('http://192.168.1.40:9000');
  expect(directUrl(R({ address: 'gpu.example', connect: 'https', kind: 'openai' }))).toBe('https://gpu.example');
  expect(directUrl(R({ address: 'https://api.example.com/api/v1', kind: 'openai' }))).toBe('https://api.example.com/api');
  expect(directUrl(R({ address: '::1', port: 8081 }))).toBe('http://[::1]:8081');
  expect(remoteLabel(R({ address: '192.168.1.40' }))).toBe('192.168.1.40');
  expect(remoteLabel(R({ address: '192.168.1.40', port: 9000 }))).toBe('192.168.1.40:9000');
  expect(remoteLabel(R({ address: 'studio', connect: 'ssh' }))).toBe('studio (ssh)');
});

test('private addresses (home, Tailscale, .local, a bare name) are told from the internet; open http is allowed and not warned', () => {
  for (const h of ['localhost', '127.0.0.1', '10.0.0.5', '172.20.1.1', '192.168.1.40', '100.101.12.7', 'studio.local', 'box.tail1234.ts.net', 'gpu-box', '::1', 'fd12:3456::1']) expect([h, isPrivateHost(h)]).toEqual([h, true]);
  for (const h of ['8.8.8.8', '172.32.0.1', '100.128.0.1', 'api.example.com', '2001:db8::1']) expect([h, isPrivateHost(h)]).toEqual([h, false]);
  expect(remoteRisk(R({ address: '203.0.113.9' }))).toBe(null);
  expect(remoteRisk(R({ address: '203.0.113.9', key: true }))).toBe(null);
  expect(remoteRisk(R({ address: '192.168.1.40' }))).toBe(null);
  expect(remoteRisk(R({ address: '203.0.113.9', connect: 'https' }))).toBe(null);
  expect(remoteRisk(R({ address: 'https://203.0.113.9' }))).toBe(null);
  expect(remoteRisk(R({ address: 'user@203.0.113.9', connect: 'ssh' }))).toBe(null);
});

test('what stops a remote before anything is sent: no address, a bad one, a bad port, an ssh address that is an option', () => {
  expect(remoteProblem(R({}))).toBe('it has no address yet');
  expect(remoteProblem(R({ address: 'ftp://x' }))).toMatch(/not an IP/);
  expect(remoteProblem(R({ address: '10.0.0.5', port: 70000 }))).toMatch(/port/);
  expect(remoteProblem(R({ address: '-oProxyCommand=touch /tmp/x', connect: 'ssh' }))).toMatch(/SSH address/);
  expect(validSshDest('me@studio')).toBe(true);
  expect(validSshDest('orbit')).toBe(true);
  expect(validSshDest('a b')).toBe(false);
  expect(validSshDest('-oBatchMode')).toBe(false); // an ssh option, not an address: only the leading-dash rule stops this one
  expect(remoteProblem(R({ address: 'me@studio', connect: 'ssh' }))).toBe(null);
});

test('a key is one printable line; only a long one shows its end', () => {
  expect(validKey('ac-abc123_-.~')).toBe(true);
  expect(validKey('has space')).toBe(false);
  expect(validKey('two\nlines')).toBe(false);
  expect(validKey('')).toBe(false);
  expect(keyEnd('sk-0123456789abcdef')).toBe('cdef');
  expect(keyEnd('short')).toBe('');
});

test('the key is kept in a file readable by you only when the Keychain is not used, and never in settings.json', () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-remote-'));
  const script = `const m = await import(${JSON.stringify(join(import.meta.dir, '..', 'runtime', 'remote.mjs'))});
    const where = m.saveKey('test-test-0123456789');
    console.log(JSON.stringify({ where, store: m.keyStore(), read: m.readKey() }));
    m.removeKey(); console.log(JSON.stringify({ after: m.readKey() }));`;
  const r = spawnSync('bun', ['-e', script], { encoding: 'utf8', env: { ...process.env, AGENTIC_HOME: home, AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: '' } });
  const [a, b] = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
  expect(a).toEqual({ where: 'file', store: 'file', read: 'test-test-0123456789' });
  expect(b).toEqual({ after: null });
  expect(statSync(join(home, 'remote-keys.json')).mode & 0o777).toBe(0o600);
  // AGENTIC_REMOTE_KEY wins (a script, a test)
  const e = spawnSync('bun', ['-e', script.replace("m.saveKey('test-test-0123456789')", "'env'")], { encoding: 'utf8', env: { ...process.env, AGENTIC_HOME: home, AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: 'from-env-key' } });
  expect(JSON.parse(e.stdout.trim().split('\n')[0]).read).toBe('from-env-key');
});

test('each service keeps its key under its own name (a key saved before Run on stays under "default"), and connecting reads the right one', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-remote-'));
  const remote = JSON.stringify(join(import.meta.dir, '..', 'runtime', 'remote.mjs'));
  const script = `const m = await import(${remote});
    m.saveKey('test-claude-0123456789', 'claude'); m.saveKey('test-old-0123456789');
    console.log(JSON.stringify({ claude: m.readKey('claude'), old: m.readKey(), machine: m.readKey('machine'), search: m.readKey('search-brave') }));`;
  const run = (env) => JSON.parse(spawnSync('bun', ['-e', script], { encoding: 'utf8', env: { ...process.env, AGENTIC_HOME: home, AGENTIC_REMOTE_KEYSTORE: 'file', ...env } }).stdout.trim());
  expect(run({ AGENTIC_REMOTE_KEY: '' })).toEqual({ claude: 'test-claude-0123456789', old: 'test-old-0123456789', machine: null, search: null });
  // AGENTIC_REMOTE_KEY stands in for any remote's key, never a web search service's
  expect(run({ AGENTIC_REMOTE_KEY: 'from-env-key' })).toEqual({ claude: 'from-env-key', old: 'from-env-key', machine: 'from-env-key', search: null });
  const { sourceOf, keyIdOf, REMOTE_SOURCES } = await import('../index.mjs');
  expect(REMOTE_SOURCES).toEqual(['claude', 'machine', 'openai']);
  expect([sourceOf({ kind: 'claude' }), sourceOf({ kind: 'openai' }), sourceOf({ kind: 'llama' }), sourceOf({ kind: 'openai', source: 'machine' })]).toEqual(['claude', 'openai', 'machine', 'machine']);
  expect([keyIdOf({ key: true }), keyIdOf({ keyId: 'claude' })]).toEqual(['default', 'claude']);
  // connecting reads the key under the remote's own name (saved here only in a throwaway home:
  // run in one process after a file that loaded the models part first, HOME can be the real one)
  if (HOME === join(homedir(), '.agentic-coder')) throw new Error('not in a throwaway home: the key would land in the real one');
  const fake = await startFakeServer([], { key: 'test-machine-0123456789', props: true });
  const { saveKey } = await import('../index.mjs');
  saveKey('test-machine-0123456789', 'machine');
  const c = await connectRemote(R({ source: 'machine', keyId: 'machine', address: fake.url, kind: 'llama', key: true, keyEnd: '6789' }));
  expect(endpointOf(fake.url)).toMatchObject({ key: 'test-machine-0123456789' });
  expect(c.model.remote).toEqual({ kind: 'llama', label: `127.0.0.1:${fake.port}`, source: 'machine' });
  c.stop();
  await fake.close();
});

test('the ssh command: no password prompt, fails when the port cannot be forwarded, local end on this Mac only, the address after --', () => {
  const a = sshArgs({ dest: 'me@studio', remotePort: 8080, localPort: 17650 });
  expect(a).toEqual(expect.arrayContaining(['-N', 'BatchMode=yes', 'ExitOnForwardFailure=yes', '-L', '127.0.0.1:17650:127.0.0.1:8080']));
  expect(a.slice(-2)).toEqual(['--', 'me@studio']);
});

// A fake ssh: reads -L 127.0.0.1:<local>:<host>:<port> and forwards that port, as ssh would.
function fakeSsh(dir, { fail = null } = {}) {
  const file = join(dir, fail ? 'ssh-fail' : 'ssh');
  const body = fail
    ? `#!/bin/sh\necho "${fail}" >&2\nexit 255\n`
    : `#!/usr/bin/env bun\nimport { createServer, connect } from 'node:net';\nconst l = process.argv[process.argv.indexOf('-L') + 1].split(':');\ncreateServer((c) => { const u = connect(Number(l[3]), l[2]); c.pipe(u); u.pipe(c); c.on('error', () => {}); u.on('error', () => {}); }).listen(Number(l[1]), l[0]);\n`;
  writeFileSync(file, body);
  chmodSync(file, 0o755);
  return file;
}

test('the SSH tunnel: opened on a free local port, the model reached through it, closed after; a refused ssh says why', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-ssh-'));
  const fake = await startFakeServer([], { props: true });
  const t = await openTunnel({ dest: 'me@studio', remotePort: fake.port, ssh: fakeSsh(dir) });
  expect(t.port).toBeGreaterThanOrEqual(17650);
  expect((await fetch(`${t.url}/health`)).ok).toBe(true);
  t.stop();
  await new Promise((r) => setTimeout(r, 300));
  await expect(fetch(`${t.url}/health`)).rejects.toThrow();
  await expect(openTunnel({ dest: 'me@studio', remotePort: fake.port, ssh: fakeSsh(dir, { fail: 'me@studio: Permission denied (publickey).' }) })).rejects.toThrow('ssh to me@studio stopped: me@studio: Permission denied (publickey).');
  await fake.close();
});

test('the check on llama.cpp: reached, the key refused or taken, what it runs (context, slots, file), one word back', async () => {
  const fake = await startFakeServer([], { key: 'test-right-0123456789', props: true });
  const none = await probe({ url: fake.url, kind: 'llama' });
  expect(none.ok).toBe(false);
  expect(none.error).toBe('this server needs an API key');
  const wrong = await probe({ url: fake.url, kind: 'llama', key: 'sk-wrong' });
  expect(wrong.error).toBe('the API key was not accepted');
  const right = await probe({ url: fake.url, kind: 'llama', key: 'test-right-0123456789', reply: true });
  expect(right.ok).toBe(true);
  expect(right).toMatchObject({ ctx: 32768, slots: 2, file: '/models/gemma-4-12B-it-qat-UD-Q4_K_XL.gguf' });
  expect(right.steps.map((s) => s.text)).toEqual([expect.stringMatching(/^reached in \d+ ms$/), 'the key was accepted', 'runs gemma-4-12B-it-qat-UD-Q4_K_XL.gguf · 32k context · 2 slots', expect.stringMatching(/^answered ".*" in [\d.]+ s$/)]);
  expect(fake.seen.filter((x) => x.path !== '/health').every((x) => x.auth === null || x.auth.startsWith('Bearer '))).toBe(true);
  await fake.close();
});

test('when several models are listed and none named: a coder over vision and embeddings, a :latest tag over a quant; Connect uses that one', () => {
  expect(pickRemoteModel([])).toBe(null);
  expect(pickRemoteModel(['only'])).toBe('only');
  expect(pickRemoteModel(['llava:latest', 'laguna-xs-2.1:bf16', 'laguna-xs-2.1:latest', 'nomic-embed-text'])).toBe('laguna-xs-2.1:latest');
  expect(pickRemoteModel(['alpha:latest', 'coder:30b', 'tiny:3b'])).toBe('coder:30b');
  expect(pickRemoteModel(['llava:latest', 'bakllava'])).toBe('llava:latest');
});

test('the check on an OpenAI-compatible server: its model list, the one it has picked, its context; a wrong address says so', async () => {
  const fake = await startFakeServer([], { key: 'test-right-0123456789', props: true });
  const r = await probe({ url: fake.url, kind: 'openai', key: 'test-right-0123456789', reply: true });
  expect(r.ok).toBe(true);
  expect(r).toMatchObject({ models: ['fake-model'], model: 'fake-model', ctx: 65536 });
  const keyless = await probe({ url: fake.url, kind: 'openai' });
  expect(keyless.error).toMatch(/but it needs an API key$/);
  await fake.close();
  // Several models, none named: picks a coder and asks it (Connect no longer stops for the Model row).
  const many = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') { res.end(JSON.stringify({ data: ['llava:latest', 'coder:7b', 'tiny:3b'].map((id) => ({ id })) })); return; }
    for await (const _ of req) { /* body unused */ }
    res.end(JSON.stringify({ choices: [{ message: { content: 'ready' } }] }));
  });
  await new Promise((r) => many.listen(0, '127.0.0.1', r));
  try {
    const picked = await probe({ url: `http://127.0.0.1:${many.address().port}`, kind: 'openai', reply: true });
    expect(picked.ok).toBe(true);
    expect(picked.model).toBe('coder:7b');
    expect(picked.steps.map((s) => s.text)).toEqual([
      expect.stringMatching(/^reached in \d+ ms$/),
      'using coder:7b of 3',
      'model coder:7b',
      expect.stringMatching(/^answered "ready"/),
    ]);
    // The form passes autoPick: false so Connect can open the list instead of guessing.
    const listed = await probe({ url: `http://127.0.0.1:${many.address().port}`, kind: 'openai', reply: true, autoPick: false });
    expect(listed.ok).toBe(false);
    expect(listed.needModel).toBe(true);
    expect(listed.models).toEqual(['llava:latest', 'coder:7b', 'tiny:3b']);
    expect(listed.model).toBe(null);
    expect(listed.error).toMatch(/^pick a model: it has 3/);
  } finally { await new Promise((r) => many.close(r)); }
  // A port nothing listens on (taken and let go at once).
  const free = createServer();
  await new Promise((r) => free.listen(0, '127.0.0.1', r));
  const port = free.address().port;
  await new Promise((r) => free.close(r));
  const gone = await probe({ url: `http://127.0.0.1:${port}`, kind: 'llama', timeoutMs: 2000 });
  expect(gone.error).toBe('nothing is listening at that address and port');
});

test('connecting registers the address with its key and kind (every call then carries the key); stop takes it away', async () => {
  const fake = await startFakeServer([], { key: 'test-right-0123456789', props: true });
  const c = await connectRemote(R({ address: fake.url, kind: 'llama', key: true, keyEnd: '6789' }), { key: 'test-right-0123456789' });
  expect(c).toMatchObject({ url: fake.url, ctx: 32768, slots: 2 });
  expect(c.model).toMatchObject({ id: 'remote', base: 'gemma', name: `${MODELS.gemma.name} · 127.0.0.1:${fake.port}`, bytes: 0, remote: { kind: 'llama' } });
  expect(endpointOf(fake.url)).toMatchObject({ remote: true, kind: 'llama', key: 'test-right-0123456789' });
  expect(authHeaders(`${fake.url}/`)).toEqual({ authorization: 'Bearer test-right-0123456789' });
  c.stop();
  expect(endpointOf(fake.url)).toBe(null);
  await expect(connectRemote(R({ address: fake.url, key: true }), { key: 'sk-wrong' })).rejects.toThrow('the API key was not accepted');
  await expect(connectRemote(R({ address: '' }))).rejects.toThrow('The remote is not set up: it has no address yet. Open /remote');
  await fake.close();
});

test('a remote runs with our settings when it serves one of our models, else with plain ones; the form’s Context wins', () => {
  const ours = remoteModel(R({ address: '10.0.0.5' }), { file: '/x/gemma-4-12B-it-qat-UD-Q4_K_XL.gguf', ctx: 65536, slots: 2 });
  expect(ours).toMatchObject({ base: 'gemma', sampling: MODELS.gemma.sampling, thinkingLevels: MODELS.gemma.thinkingLevels, maxCtx: 65536, slots: 2, draft: null });
  const other = remoteModel(R({ address: 'https://api.example.com/v1', kind: 'openai', context: 16384 }), { model: 'some/model', ctx: 131072 });
  expect(other).toMatchObject({ id: 'remote', name: 'some/model · api.example.com', sampling: {}, thinkingLevels: GENERIC_REMOTE.thinkingLevels, maxCtx: 16384 });
});

test('the warm-up on a remote llama.cpp reads the instructions into its memory and saves nothing on its disk; an OpenAI-compatible one is not warmed', async () => {
  const fake = await startFakeServer([], { props: true });
  const c = await connectRemote(R({ address: fake.url }));
  const route = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    route.push(String(u).replace(fake.url, ''));
    if (String(u).endsWith('/apply-template')) return new Response(JSON.stringify({ prompt: 'SYSTEM\nMARK here\u0001USER\u0001' }), { status: 200 });
    return orig(u, init);
  };
  try {
    const r = await warmUp({ url: c.url, model: c.model, system: 'x', tools: [], thinking: false, sessionMark: 'MARK' });
    expect(r).toEqual({ restored: false, remote: true });
    expect(route).toEqual(['/apply-template', '/completion']);
  } finally { globalThis.fetch = orig; c.stop(); }
  const o = await connectRemote(R({ address: fake.url, kind: 'openai' }));
  const before = fake.seen.length;
  expect(await warmUp({ url: o.url, model: o.model, system: 'x', tools: [], thinking: false, sessionMark: 'MARK' })).toEqual({ restored: false, skipped: true });
  expect(fake.seen.length).toBe(before);
  o.stop();
  await fake.close();
});

test('coding serve: open to the network behind its key (or this Mac only), https with a certificate; the addresses others use', () => {
  expect(serveArgs({ keyFile: '/k' })).toEqual({ host: '0.0.0.0', keyFile: '/k', https: false, args: ['--api-key-file', '/k'] });
  expect(serveArgs({ local: true, keyFile: '/k', cert: '/c.pem', certKey: '/k.pem' })).toEqual({ host: '127.0.0.1', keyFile: '/k', https: true, args: ['--api-key-file', '/k', '--ssl-cert-file', '/c.pem', '--ssl-key-file', '/k.pem'] });
  const a = serverArgs(MODELS.gemma, { ctx: 32768, port: 8080, host: '0.0.0.0' });
  expect(a[a.indexOf('--host') + 1]).toBe('0.0.0.0');
  expect(serverArgs(MODELS.gemma, { ctx: 32768, port: 17600 })[serverArgs(MODELS.gemma, { ctx: 32768, port: 17600 }).indexOf('--host') + 1]).toBe('127.0.0.1');
  const ifaces = { lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }], en0: [{ address: '192.168.1.40', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }], utun4: [{ address: '100.101.12.7', family: 'IPv4', internal: false }], en5: [{ address: '169.254.3.3', family: 'IPv4', internal: false }] };
  expect(lanAddresses(ifaces)).toEqual([{ address: '192.168.1.40', where: 'en0, this network' }, { address: '100.101.12.7', where: 'Tailscale' }]);
});

test('coding serve’s key: made once, readable by you only, kept across starts; --new-key replaces it', () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-serve-'));
  const run = (fresh) => JSON.parse(spawnSync('bun', ['-e', `const m = await import(${JSON.stringify(join(import.meta.dir, '..', 'runtime', 'serve.mjs'))}); console.log(JSON.stringify(m.serveKey({ fresh: ${fresh} })));`], { encoding: 'utf8', env: { ...process.env, AGENTIC_HOME: home } }).stdout);
  const first = run(false);
  expect(first.made).toBe(true);
  expect(first.key).toMatch(/^ac-[A-Za-z0-9_-]{32}$/);
  expect(run(false)).toEqual({ key: first.key, made: false });
  const again = run(true);
  expect(again.key).not.toBe(first.key);
  expect(readFileSync(join(home, 'serve.key'), 'utf8')).toBe(`${again.key}\n`);
  expect(statSync(join(home, 'serve.key')).mode & 0o777).toBe(0o600);
});

test('a server on another address answering 401 to everything but /health (llama-server --api-key) is told apart from a wrong kind', async () => {
  const s = createServer((req, res) => { res.writeHead(req.url === '/health' ? 404 : 401); res.end(); });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${s.address().port}`;
  expect((await probe({ url, kind: 'llama' })).error).toMatch(/answered 404: is it a llama\.cpp server\?/);
  s.close();
});

test('the Test row on a server that wants max_completion_tokens (OpenAI’s reasoning models): asked again that way, and it answers', async () => {
  const asked = [];
  const s = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'reasoner' }] })); return; }
    const body = JSON.parse(b);
    asked.push(Object.keys(body).filter((k) => /tokens/.test(k)));
    if ('max_tokens' in body) { res.writeHead(400); res.end(JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } })); return; }
    res.end(JSON.stringify({ choices: [{ message: { content: 'ready' } }] }));
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const r = await probe({ url: `http://127.0.0.1:${s.address().port}`, kind: 'openai', reply: true });
  s.close();
  expect(r.ok).toBe(true);
  expect(asked).toEqual([['max_tokens'], ['max_completion_tokens']]);
  expect(r.steps.at(-1).text).toMatch(/^answered "ready"/);
});
