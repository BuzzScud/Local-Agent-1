// /remote's form, Design 1 of docs/design rounds/agentic-coder-remote-connect-2-designs-2026-10-03.html (the
// owner's pick, 3 Oct 2026). Their window, on server-1 through the door: the service saved but not in use,
// /remote, → to Another service, ↑, enter. ↑ from Run on landed on Save only and enter saved without
// connecting, and the line ("Another service saved … This window stays on this Mac") read as if something
// else used the model. Now ↑ lands on Connect, enter connects from any row, Save only asks "Connect now?",
// and the lines name server-1. On a pretend Ollama service (fake-ollama.mjs); the window is shown as
// "on server-1" by the session record a door window leaves (sessions.mjs).
import { test, expect } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';
import { fakeOllama } from './fake-ollama.mjs';

const NO_ENV_KEYS = { AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: '', ANTHROPIC_API_KEY: '' };
const right = (n) => Array.from({ length: n }, () => [{ key: 'right' }, { sleep: 90 }]).flat();
const settingsOf = (base) => JSON.parse(readFileSync(join(base, 'home', 'settings.json'), 'utf8'));
const flat = (t) => t.replace(/\s+/g, ' ');
// The service saved, not in use; the window in a session another Mac has a window on (as server-1's own shows it).
function onServer1(base, url) {
  const svc = { source: 'openai', address: url, port: null, connect: 'http', kind: 'openai', model: 'coder:30b', context: 0, key: false, keyEnd: '', keyId: 'openai' };
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { ...svc, use: false }, remotes: { openai: svc } }));
  mkdirSync(join(base, 'home', 'background'), { recursive: true });
  writeFileSync(join(base, 'home', 'background', 'demo-1.json'), JSON.stringify({ name: 'demo-1', pid: process.pid, viewers: 2, local: 1, shared: { mac: 'server-1', with: ['christians-mac-mini'] } }));
  return { ...NO_ENV_KEYS, AGENTIC_MODEL_AT_START: 'off', AGENTIC_IN_HOST: 'demo-1' };
}
const open = [{ wait: '? for shortcuts' }, { sleep: 2300 }, { snapshot: 'start' }, { type: '/remote' }, { key: 'enter' }, { wait: 'Remote model' }, { sleep: 200 }];

test('their keys, ↑ then enter, now connect: ↑ from Run on lands on Connect; the form says where the window runs, by the Mac’s name', async () => {
  const { cwd, env, base } = setup();
  const svc = await fakeOllama();
  const label = svc.url.replace('http://', '');
  const r = await runInPty({ cwd, env: { ...env, ...onServer1(base, svc.url) }, args: ['--no-flows'], timeoutMs: 60_000, steps: [
    ...open, { snapshot: 'open' },
    ...right(3), { sleep: 200 }, { snapshot: 'service' },
    { key: 'up' }, { sleep: 200 }, { snapshot: 'up' },
    { key: 'enter' }, { wait: 'On the remote:', ms: 20_000 }, { sleep: 300 }, { snapshot: 'on' },
    ...quit,
  ] });
  await svc.close();
  const s = r.snapshots;
  expect(s.start).toContain('⇄ on server-1'); // the footer, before the form covers it
  expect(s.open).toMatch(/Remote model\s+this window runs on server-1 · its own model is off/);
  expect(s.service).toMatch(/Run on\s+◀ Another service\s+▶/);
  expect(s.service).toContain('Enter connects from any row. Typing changes the row you are on. Nothing changes unless it works.');
  expect(s.service).toContain('enter connects · ↑↓ rows · ←→ change · type to edit a row · esc closes');
  // ↑: the button row, on Connect (Save only is beside it, not under it)
  expect(s.up).toMatch(/❯\s+Connect\s+Save only\s+checks it answers, saves it, then this window uses coder:30b there/);
  expect(flat(s.on)).toContain(`On the remote: coder:30b · ${label} · OpenAI-compatible`);
  expect(flat(s.on)).toContain('your prompts and files go there');
  expect(settingsOf(base).remote).toMatchObject({ source: 'openai', use: true });
}, T);

test('Save only asks “Connect now?” as the app’s questions do, naming server-1; Connect now connects', async () => {
  const { cwd, env, base } = setup();
  const svc = await fakeOllama();
  const label = svc.url.replace('http://', '');
  const r = await runInPty({ cwd, env: { ...env, ...onServer1(base, svc.url) }, args: ['--no-flows'], timeoutMs: 60_000, steps: [
    ...open, ...right(3), { key: 'up' }, { sleep: 120 }, { key: 'right' }, { sleep: 200 }, { snapshot: 'save' },
    { key: 'enter' }, { wait: 'now?' }, { sleep: 300 }, { snapshot: 'ask' },
    { key: 'down' }, { sleep: 200 }, { snapshot: 'notNow' }, { key: 'up' }, { sleep: 150 },
    { key: 'enter' }, { wait: 'On the remote:', ms: 20_000 }, { sleep: 300 }, { snapshot: 'on' },
    ...quit,
  ] });
  await svc.close();
  const s = r.snapshots;
  expect(s.save).toMatch(/❯\s+Connect\s+Save only\s+keeps it, without connecting · server-1 stays on its own model/);
  expect(flat(s.ask)).toContain(`Saved: Another service (${label}). This window is still on server-1’s own model, which is off.`);
  expect(s.ask).toContain(`Connect to ${label} now?`);
  expect(s.ask).toMatch(/❯ 1\. Connect now {2}\(recommended\)/);
  expect(s.ask).toContain('ⓘ checks it answers, then this window uses coder:30b there');
  expect(s.ask).toContain('Enter pick · ↑/↓ move · Esc not now');
  expect(s.notNow).toMatch(/❯ 2\. Not now/);
  expect(s.notNow).toContain('ⓘ it stays saved: /remote service connects it any time');
  expect(flat(s.on)).toContain('On the remote: coder:30b');
  expect(settingsOf(base).remote).toMatchObject({ source: 'openai', use: true });
}, T);

test('Save only, then esc: left saved and not connected, and it says how; then enter on Run on itself connects', async () => {
  const { cwd, env, base } = setup();
  const svc = await fakeOllama();
  let chatsAfterEsc = -1;
  const r = await runInPty({ cwd, env: { ...env, ...onServer1(base, svc.url) }, args: ['--no-flows'], timeoutMs: 60_000, steps: [
    ...open, ...right(3), { key: 'up' }, { sleep: 120 }, { key: 'right' }, { sleep: 120 },
    { key: 'enter' }, { wait: 'now?' }, { sleep: 200 }, { key: 'esc' }, { wait: 'Left saved' }, { sleep: 300 }, { snapshot: 'left' },
    { fn: () => { chatsAfterEsc = svc.chats().length; } },
    { type: '/remote' }, { key: 'enter' }, { wait: 'Remote model' }, { sleep: 200 }, ...right(3), { sleep: 150 },
    { key: 'enter' }, { wait: 'On the remote:', ms: 20_000 }, { sleep: 300 }, { snapshot: 'on' },
    ...quit,
  ] });
  await svc.close();
  const s = r.snapshots;
  expect(flat(s.left)).toContain('Left saved, not connected. /remote service connects it any time.');
  expect(s.left).not.toContain('On the remote:');
  expect(chatsAfterEsc).toBe(0); // nothing was asked of the service
  expect(flat(s.on)).toContain('On the remote: coder:30b');
}, T);
