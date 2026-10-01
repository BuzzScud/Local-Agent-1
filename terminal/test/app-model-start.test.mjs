// End-to-end, the real app in a pseudo-terminal (see app.test.mjs), with the stand-in
// llama-server. The model is off when a window opens (the user's pick, 30 Sep 2026): a message
// waits, /start loads the model and sends it, /stop unloads it and gives the memory back,
// /autostart on loads it as the next window opens, and quitting leaves nothing loaded.
import { test, expect } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInPty } from './pty.mjs';
import { setup, quit } from './app-setup.mjs';
import { ENGINE, MODELS, DEFAULT_MODEL } from '../../models/index.mjs';

const D = MODELS[DEFAULT_MODEL]; // the stand-in plays the default model
function withStandInModel() {
  const { cwd, env, base } = setup();
  const home = join(base, 'home');
  mkdirSync(join(home, 'engine', ENGINE.tag), { recursive: true });
  mkdirSync(join(home, 'models'), { recursive: true });
  symlinkSync(join(import.meta.dir, 'fake-llama-server.mjs'), join(home, 'engine', ENGINE.tag, 'llama-server'));
  writeFileSync(join(home, 'models', D.file), 'stand-in');
  // Off at the start: the default, which setup() turns on for the other app tests.
  return { cwd, home, env: { ...env, AGENTIC_MODEL_AT_START: 'off' } };
}
// The model servers this home has loaded, and whether their processes are alive.
const servers = (home) => {
  try { return readdirSync(join(home, 'servers')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(home, 'servers', f), 'utf8'))); } catch { return []; }
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('the model is off at the start; a message waits for /start, which loads it and sends it; /stop unloads it', async () => {
  const { cwd, env, home } = withStandInModel();
  const seen = {};
  const r = await runInPty({ cwd, env, args: ['--no-flows'], timeoutMs: 90_000, steps: [
    { wait: '? for shortcuts' }, { sleep: 1500 }, { snapshot: 'off' },
    { fn: async () => { seen.atOpen = servers(home).length; } },
    { type: 'hello' }, { key: 'enter' }, { wait: 'The model is off. /start loads it' }, { sleep: 200 }, { snapshot: 'held' },
    { type: '/start' }, { key: 'enter' },
    { wait: 'Hello from the stand-in model.', ms: 45_000 }, { sleep: 300 },
    { fn: async () => { seen.loaded = servers(home); } },
    { type: '/start' }, { key: 'enter' }, { wait: 'is already loaded' },
    { type: '/stop' }, { key: 'enter' }, { wait: '/start loads it again', ms: 15_000 }, { sleep: 500 }, { snapshot: 'stopped' },
    { fn: async () => { seen.afterStop = servers(home); } },
    { type: '/stop' }, { key: 'enter' }, { wait: 'The model is already off' },
    { type: '/autostart on' }, { key: 'enter' }, { wait: 'Model at start on' },
    ...quit,
  ] });
  // At the start: nothing loaded; the start page and the footer say the model is off.
  expect(seen.atOpen).toBe(0);
  expect(r.snapshots.off).toMatch(new RegExp(`${D.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · off`));
  expect(r.snapshots.off).toContain('model off · /start');
  // The message waits, said once, with the Queued line.
  expect(r.snapshots.held).toContain('Queued: hello');
  expect(r.snapshots.held).toContain('sends once /start has loaded the model');
  // /start loaded the stand-in and the message went to it.
  expect(seen.loaded).toHaveLength(1);
  expect(alive(seen.loaded[0].pid)).toBe(false); // gone by now: /stop, then the quit
  // /stop: unloaded, its files gone, said on screen.
  expect(seen.afterStop).toEqual([]);
  expect(r.snapshots.stopped).toMatch(/is unloaded.*\/start loads it again/s);
  expect(r.snapshots.stopped).toContain('model off · /start');
  // /autostart on is kept for next time.
  expect(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')).modelAtStart).toBe(true);
}, 100_000);

test('with /autostart on the model loads as the window opens, and quitting unloads it at once', async () => {
  const { cwd, env, home } = withStandInModel();
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ modelAtStart: true }));
  const { AGENTIC_MODEL_AT_START, ...rest } = env; // the saved setting decides here
  const seen = {};
  const r = await runInPty({ cwd, env: rest, args: ['--no-flows'], timeoutMs: 90_000, steps: [
    { wait: ' · effort ', ms: 45_000 }, { wait: '? for shortcuts', ms: 45_000 }, { sleep: 500 },
    { fn: async () => { seen.loaded = servers(home); } },
    ...quit, { sleep: 1500 },
  ] });
  expect(r.text).not.toContain('model off');
  expect(seen.loaded).toHaveLength(1);
  // Quitting stopped it: no file left, the process gone (before: kept loaded for 30 minutes).
  expect(servers(home)).toEqual([]);
  expect(existsSync(join(home, 'servers', `${seen.loaded[0].port}.json`))).toBe(false);
  expect(alive(seen.loaded[0].pid)).toBe(false);
}, 100_000);
