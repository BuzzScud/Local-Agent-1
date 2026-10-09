// /btw only on a remote (3 Oct 2026, the owner's picks), in the real app in a pseudo-terminal:
// off and out of the / menu on this Mac's own model; on a pretend Ollama service the lowest
// model answers, or, where the service loads no second model, the main one after one short try.
import { test, expect } from 'bun:test';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInPty } from './pty.mjs';
import { setup, quit, ON_REMOTE } from './app-setup.mjs';
import { fakeOllama } from './fake-ollama.mjs';
import { ENGINE, MODELS, DEFAULT_MODEL } from '../../models/index.mjs';

const NO_ENV_KEYS = { AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: '', ANTHROPIC_API_KEY: '' };
const menuRows = (s) => s.split('\n').map((l) => /^\s{2}(?:❯ | {2})(\/[a-z:-]+)\s/.exec(l)?.[1]).filter(Boolean); // the names in the / menu's list
const onService = (base, svc) => {
  const r0 = { source: 'openai', address: svc.url, port: null, connect: 'http', kind: 'openai', model: 'coder:30b', context: 0, key: false, keyEnd: '', keyId: 'openai' };
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { ...r0, use: true }, remotes: { openai: r0 } }));
};
const sides = (svc) => svc.chats().filter((b) => /asked with \/btw/.test(String(b.messages?.[0]?.content ?? '')));

test('on this Mac’s own model: /btw is not in the / menu, and typed in full it says it works on a remote', async () => {
  const { cwd, env, base } = setup();
  const home = join(base, 'home');
  mkdirSync(join(home, 'engine', ENGINE.tag), { recursive: true });
  mkdirSync(join(home, 'models'), { recursive: true });
  symlinkSync(join(import.meta.dir, 'fake-llama-server.mjs'), join(home, 'engine', ENGINE.tag, 'llama-server'));
  writeFileSync(join(home, 'models', MODELS[DEFAULT_MODEL].file), 'stand-in');
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS, AGENTIC_MODEL_AT_START: 'off' }, args: ['--no-flows'], timeoutMs: 60_000, steps: [
    { wait: '? for shortcuts' }, { sleep: 500 },
    { type: '/' }, { wait: 'Open the Help page in the browser' }, { sleep: 250 }, { snapshot: 'menu' },
    { type: 'btw what are you doing?' }, { sleep: 150 }, { key: 'enter' },
    { wait: '/btw works on a remote model' }, { sleep: 200 }, { snapshot: 'said' },
    ...quit,
  ] });
  expect(menuRows(r.snapshots.menu)).not.toContain('/btw');
  expect(menuRows(r.snapshots.menu)).toContain('/remote');
  expect(r.snapshots.said).toContain('/btw works on a remote model: /remote connects one');
  expect(r.snapshots.said).not.toContain('Answering');
  expect(r.code).toBe(0);
}, 90_000);

test('on an Ollama service: /btw is in the menu, the lowest model answers, and the panel says who did', async () => {
  const { cwd, env, base } = setup();
  const svc = await fakeOllama();
  onService(base, svc);
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS }, args: ['--no-flows'], timeoutMs: 60_000, steps: [
    { wait: ON_REMOTE, ms: 25_000 }, { wait: '? for shortcuts' }, { sleep: 300 },
    { type: '/' }, { wait: 'Open the Help page in the browser' }, { sleep: 250 }, { snapshot: 'menu' },
    { type: 'btw what are you doing?' }, { sleep: 150 }, { key: 'enter' },
    { wait: 'Side answer by tiny:3b.', ms: 20_000 }, { wait: 'answered by tiny:3b' }, { sleep: 200 }, { snapshot: 'answered' },
    { key: 'esc' }, { sleep: 300 },
    ...quit,
  ] });
  await svc.close();
  expect(menuRows(r.snapshots.menu)).toContain('/btw');
  expect(r.snapshots.answered).toMatch(/answered by tiny:3b · c to copy · f to send to main · Esc to close/);
  expect(sides(svc).map((b) => b.model)).toEqual(['tiny:3b']);
  expect(r.code).toBe(0);
}, 90_000);

test('on a service that loads no second model: one short try of the lowest, said, then the main model answers; the next question goes straight to it', async () => {
  const { cwd, env, base } = setup();
  const svc = await fakeOllama({ stuck: ['tiny:3b', 'words:7b', 'jsontext:14b'], sideDelay: 1500 });
  onService(base, svc);
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS, AGENTIC_BTW_TRY_MS: '700' }, args: ['--no-flows'], timeoutMs: 70_000, steps: [
    { wait: ON_REMOTE, ms: 25_000 }, { wait: '? for shortcuts' }, { sleep: 300 },
    { type: '/btw what are you doing?' }, { key: 'enter' },
    { wait: 'tiny:3b is not ready on the service; coder:30b answers', ms: 15_000 }, { snapshot: 'falling' },
    { wait: 'Side answer by coder:30b.', ms: 20_000 }, { wait: 'answered by coder:30b' }, { sleep: 200 }, { snapshot: 'answered' },
    { key: 'esc' }, { sleep: 300 },
    { type: '/btw and now?' }, { key: 'enter' }, { wait: 'Side answer by coder:30b.', ms: 20_000 }, { sleep: 200 },
    { key: 'esc' }, { sleep: 300 },
    ...quit,
  ] });
  await svc.close();
  expect(r.snapshots.falling).toContain('tiny:3b is not ready on the service; coder:30b answers…');
  expect(r.snapshots.answered).toMatch(/answered by coder:30b/);
  // The lowest was tried once, never again; both questions were answered by the main model.
  expect(sides(svc).map((b) => b.model)).toEqual(['tiny:3b', 'coder:30b', 'coder:30b']);
  expect(r.code).toBe(0);
}, 100_000);
