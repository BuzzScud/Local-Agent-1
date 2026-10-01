// End-to-end, the real app in a pseudo-terminal (see app.test.mjs).
// Here: /arena (and /battle, its name before), and a window beside a battle in the Arena: only one model
// fits, so a window waits while a battle holds the memory, lets its own model go when one
// starts, and loads it again by itself when the battle is over; a message waits meanwhile.
import { test, expect, afterAll } from 'bun:test';
import { mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';
import { ENGINE, MODELS, DEFAULT_MODEL } from '../../models/index.mjs';

// The stand-in plays the default model (its file name and its name on screen).
const D = MODELS[DEFAULT_MODEL];
const DN = D.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // its name inside a pattern

// A live process stands in for the arena's runner (the hold names the runner's pid).
const standIn = spawn('sleep', ['300'], { stdio: 'ignore' });
afterAll(() => { try { standIn.kill(); } catch {} });
const hold = (home) => JSON.stringify({ pid: standIn.pid, state: 'running', test: 'n01', title: 'Fix a bug', run: 1, of: 2, startedAt: Date.now() });
function withStandInModel() {
  const { cwd, env, base } = setup();
  const home = join(base, 'home');
  mkdirSync(join(home, 'engine', ENGINE.tag), { recursive: true });
  mkdirSync(join(home, 'models'), { recursive: true });
  mkdirSync(join(home, 'battle'), { recursive: true });
  symlinkSync(join(import.meta.dir, 'fake-llama-server.mjs'), join(home, 'engine', ENGINE.tag, 'llama-server'));
  writeFileSync(join(home, 'models', D.file), 'stand-in');
  return { cwd, env, home };
}

test('/settings → Arena opens the hub on the Arena tab and says a run there unloads this window\'s model until it is over; /battle still opens it', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  let hub = null;
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_NO_OPEN: '1' }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: '/settings' }, { key: 'enter' }, { wait: 'Everything not in the / menu' },
    ...Array.from({ length: 12 }, () => [{ key: 'down' }, { sleep: 60 }]).flat(), { sleep: 200 }, { snapshot: 'menu' }, { key: 'enter' },
    { wait: 'The Arena opened in the browser at http://127.0.0.1:' },
    { fn: async ({ text }) => { const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(text)[0]; hub = await (await fetch(`${url}?tab=arena`)).text(); } },
    { type: '/battle' }, { key: 'enter' }, { sleep: 600 }, { snapshot: 'old' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.menu).toMatch(/❯ Arena\s+\d+ tests? · \d+ runs?\s+run a test on one model, or battle two/);
  expect(r.text.replace(/\s+/g, ' ')).toContain('?tab=arena · run a test on one model, or battle two with it, one model at a time, each run stopped at 10 min');
  expect(hub).toContain('<button data-tab="arena">Arena</button>');
  expect((r.text.match(/The Arena opened in the browser at/g) ?? []).length).toBe(2); // /battle opened it too
  expect(r.text).not.toContain('Unknown command /battle');
}, T);

test('the start waits while a battle holds the memory; a message typed then goes once the battle is over', async () => {
  const { cwd, env, home } = withStandInModel();
  writeFileSync(join(home, 'battle', 'running.json'), hold(home));
  const r = await runInPty({ cwd, env, args: ['--no-flows'], timeoutMs: 90_000, steps: [
    { wait: 'Waiting for a battle', ms: 20_000 }, { snapshot: 'waiting' },
    { type: 'hello' }, { key: 'enter' }, { wait: 'sends as soon as the model is ready' },
    { fn: async () => { rmSync(join(home, 'battle', 'running.json'), { force: true }); } },
    { wait: 'Hello from the stand-in model.', ms: 60_000 }, ...quit,
  ] });
  expect(r.snapshots.waiting.replace(/\s+/g, ' ')).toContain('Waiting for a battle: a battle is running (Fix a bug · run 1 of 2 · at most 10 min left of this run). Only one model fits');
  expect(r.text).toContain('Hello from the stand-in model.');
}, 100_000);

test('an open window lets its model go when a battle starts, and loads it again by itself when the battle is over', async () => {
  const { cwd, env, home } = withStandInModel();
  const r = await runInPty({ cwd, env, args: ['--no-flows'], timeoutMs: 120_000, steps: [
    { wait: ' · effort ', ms: 45_000 }, { wait: '? for shortcuts', ms: 45_000 }, { sleep: 1500 },
    { fn: async () => { writeFileSync(join(home, 'battle', 'running.json'), hold(home)); } },
    { wait: 'is unloaded for now', ms: 15_000 }, { snapshot: 'released' },
    { type: 'hi again' }, { key: 'enter' }, { wait: 'sends as soon as the model is ready' },
    { fn: async () => { rmSync(join(home, 'battle', 'running.json'), { force: true }); } },
    { wait: 'is loaded again', ms: 60_000 },
    { wait: 'Hello from the stand-in model.', ms: 30_000 }, ...quit,
  ] });
  expect(r.snapshots.released.replace(/\s+/g, ' ')).toContain('is unloaded for now: a battle is running (Fix a bug · run 1 of 2');
  expect(r.text.replace(/\s+/g, ' ')).toContain(`The battle is over: ${D.name} is loaded again.`);
  expect(r.text).toContain('Hello from the stand-in model.');
}, 130_000);
