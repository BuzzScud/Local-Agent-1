// `coding connect`: the terminal-only way to use a model on another machine. The address (and
// key) are checked like /remote's Connect, and only a good answer is saved: settings.json says the
// remote is on, the key goes to the key file, and nothing is downloaded. The installer's step 5
// runs this command. All in a throwaway home (a stand-in server, never the real ~/.agentic-coder).
import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';

const home = mkdtempSync(join(tmpdir(), 'agentic-connect-home-'));
process.env.AGENTIC_HOME ??= home;
process.env.AGENTIC_REMOTE_KEYSTORE = 'file';
const { connectCli, parseConnectArgs } = await import('../src/app/connect-cli.mjs');
const { loadSettings } = await import('../src/app/store.mjs');
const { readKey, HOME } = await import('../../models/index.mjs');

const KEY = 'test-connect-0123456789';
const run = async (argv, { ask = null } = {}) => {
  const lines = [];
  const code = await connectCli(argv, { settings: loadSettings(), ask, out: (t) => lines.push(t), err: (t) => lines.push(t) });
  return { code, text: lines.join('') };
};
// A typed-in conversation: each question takes the next answer.
const typed = (...answers) => ({ line: async () => answers.shift() ?? '', secret: async () => answers.shift() ?? '' });

test('runs in a throwaway home', () => { expect(HOME).toBe(process.env.AGENTIC_HOME); expect(HOME).not.toContain('.agentic-coder'); });

test('the words after "coding connect"', () => {
  expect(parseConnectArgs(['10.0.0.5:60009', '--key', 'k'])).toMatchObject({ address: '10.0.0.5:60009', key: 'k', server: 'llama' });
  expect(parseConnectArgs(['--no-key', '--server', 'openai', '--model', 'm'])).toMatchObject({ key: '', server: 'openai', model: 'm' });
  expect(parseConnectArgs(['--wat']).bad).toEqual(['--wat']);
  expect(parseConnectArgs(['--server', 'x']).bad).toEqual(['--server x']);
});

test('a server with a key: checked, then saved with the remote on and the key kept', async () => {
  const fake = await startFakeServer([{ text: 'ready' }], { key: KEY, props: true });
  try {
    // The address as typed, with a scheme and a port, like http://host:60009.
    const { code, text } = await run([fake.url, '--key', KEY]);
    expect(text).toContain('the key was accepted');
    expect(text).toContain('Saved');
    expect(code).toBe(0);
    const s = loadSettings();
    expect(s.remote).toMatchObject({ use: true, source: 'machine', kind: 'llama', key: true });
    expect(s.remote.address).toBe(fake.url);
    expect(readKey('machine')).toBe(KEY);
    expect(JSON.stringify(s)).not.toContain(KEY);
  } finally { await fake.close(); }
});

test('a wrong key saves nothing and says so', async () => {
  const before = JSON.stringify(loadSettings().remote);
  const fake = await startFakeServer([{ text: 'ready' }], { key: KEY, props: true });
  try {
    const { code, text } = await run([fake.url, '--key', 'test-wrong-0123456789']);
    expect(code).toBe(1);
    expect(text).toContain('✗');
    expect(text).toContain('Nothing saved');
    expect(JSON.stringify(loadSettings().remote)).toBe(before);
    expect(readKey('machine')).toBe(KEY);
  } finally { await fake.close(); }
});

test('asked in a terminal: the address, then the hidden key', async () => {
  const fake = await startFakeServer([{ text: 'ready' }], { key: KEY, props: true });
  try {
    const { code, text } = await run([], { ask: typed(fake.url, KEY) });
    expect(code).toBe(0);
    expect(text).toContain('Saved');
  } finally { await fake.close(); }
});

test('a server that is off: not saved unless asked to (--save-anyway, or yes at the question)', async () => {
  const gone = 'http://127.0.0.1:9';
  const a = await run([gone, '--no-key']);
  expect(a.code).toBe(1);
  expect(a.text).toContain('--save-anyway');
  const b = await run([gone, '--no-key', '--save-anyway']);
  expect(b.code).toBe(0);
  expect(loadSettings().remote.address).toBe(gone);
  // In a terminal: do not try again, do save.
  const c = await run([gone, '--no-key'], { ask: typed('n', 'y') });
  expect(c.code).toBe(0);
  expect(c.text).toContain('not reached yet');
});

test('no terminal and no address: a plain message, nothing saved', async () => {
  const { code, text } = await run([]);
  expect(code).toBe(2);
  expect(text).toContain('give the address');
});

test('plain http to an address on the internet is allowed, with one warning', async () => {
  // The check is stubbed: no real address is reached from a test.
  const lines = [];
  const code = await connectCli(['http://203.0.113.7:60009', '--key', KEY], {
    settings: loadSettings(), ask: null, out: (t) => lines.push(t), err: (t) => lines.push(t),
    check: async () => ({ ok: true, steps: [{ ok: true, text: 'stand-in' }], models: [], ctx: 32768, slots: 1 }),
  });
  const text = lines.join('');
  expect(code).toBe(0);
  expect(text).toContain('unencrypted');
  expect(text).toContain('Saved');
  expect(loadSettings().remote).toMatchObject({ use: true, address: 'http://203.0.113.7:60009' });
});

// An Ollama-like server: no /health, an open /v1/models with several models, answers "ready".
const ollama = () => new Promise((ok) => {
  const srv = createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ object: 'list', data: ['alpha:latest', 'coder:30b', 'tiny:3b'].map((id) => ({ id })) })); return; }
    if (req.url === '/v1/chat/completions') { for await (const _ of req); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'ready' } }] })); return; }
    res.statusCode = 404; res.end('404 page not found');
  });
  srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((d) => { srv.closeAllConnections?.(); srv.close(d); }) }));
});

test('an Ollama-like server (no llama.cpp /health, several models): found by itself, asks which model in a terminal', async () => {
  const srv = await ollama();
  try {
    const { code, text } = await run([srv.url, '--no-key'], { ask: typed('2') });
    expect(text).toContain('3 models');
    expect(text).toContain('coder:30b');
    expect(code).toBe(0);
    expect(loadSettings().remote).toMatchObject({ use: true, kind: 'openai', model: 'coder:30b', key: false });
  } finally { await srv.close(); }
});

test('the same with no terminal: it names the models and says --model, saving nothing', async () => {
  const srv = await ollama();
  const before = JSON.stringify(loadSettings().remote);
  try {
    const { code, text } = await run([srv.url, '--no-key']);
    expect(code).toBe(1);
    expect(text).toContain('--model NAME');
    expect(JSON.stringify(loadSettings().remote)).toBe(before);
    const ok = await run([srv.url, '--no-key', '--model', 'tiny:3b']);
    expect(ok.code).toBe(0);
    expect(loadSettings().remote).toMatchObject({ kind: 'openai', model: 'tiny:3b' });
  } finally { await srv.close(); }
});

test('nothing was downloaded: no model files came into the home', () => {
  expect(existsSync(join(HOME, 'models')) ? readdirSync(join(HOME, 'models')) : []).toEqual([]);
  expect(readFileSync(join(HOME, 'settings.json'), 'utf8')).toContain('"use": true');
});
