// End-to-end, the real app in a pseudo-terminal (see app.test.mjs).
// Here: /test (the hub's Tests tab on ▶ Run a test, this window's model picked, a test named or
// not), and a window beside a test run from that tab: like a battle, the run holds the memory, so
// the window waits at its start, lets its own model go, and loads it again when the run is over.
import { test, expect, afterAll } from 'bun:test';
import { mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';
import { ENGINE, MODELS, DEFAULT_MODEL } from '../../models/index.mjs';

// The model on this Mac in these tests is the default one (its file, name and size).
const D = MODELS[DEFAULT_MODEL];
const DN = D.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // its name inside a pattern
const DGB = `${(D.bytes / 1e9).toFixed(1)} GB`;

// A live process stands in for the test run (its hold names the run's own pid).
const standIn = spawn('sleep', ['300'], { stdio: 'ignore' });
afterAll(() => { try { standIn.kill(); } catch {} });
const hold = () => JSON.stringify({ pid: standIn.pid, state: 'running', kind: 'test', test: 'practice28', title: 'Practice 28 on Gemma 4 12B QAT', startedAt: Date.now() });
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

test('/test opens the Arena with this model as who runs it; a name or a task number picks the test; an unknown name says what there is', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  let hub = null; let page = null;
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_NO_OPEN: '1' }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: '/te' }, { wait: 'Pick a test in the Arena for this model' }, { sleep: 150 }, { snapshot: 'menu' }, { type: 'st' }, { sleep: 100 }, { key: 'enter' },
    { wait: 'The Arena opened in the browser at http://127.0.0.1:' },
    { fn: async ({ text }) => { const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(text)[0]; hub = await (await fetch(`${url}?tab=arena&run=1`)).text(); page = await (await fetch(`${url}tests`)).text(); } },
    { type: '/test practice 28' }, { key: 'enter' }, { wait: 'Practice 28 is picked' },
    { type: '/test 12' }, { key: 'enter' }, { wait: 'One practice task 12 is picked' },
    { type: '/test unit tests' }, { key: 'enter' }, { wait: 'Unit tests is picked' },
    { type: '/test nonsense' }, { key: 'enter' }, { wait: 'No test called "nonsense"' },
    ...quit,
  ] });
  await fake.close();
  const text = r.text.replace(/\s+/g, ' ');
  expect(r.snapshots.menu).toMatch(/\/test\s+Pick a test in the Arena for this model/);
  expect(text).toMatch(new RegExp(`\\?tab=arena&run=1&model=${D.id} · pick a test on ${DN}, then press Run · while it runs, ${DN} here is unloaded`));
  expect(text).toMatch(new RegExp(`&model=${D.id}&test=practice28 · Practice 28 is picked on ${DN}`));
  expect(text).toMatch(new RegExp(`&model=${D.id}&test=task&n=12 · One practice task 12 is picked on ${DN}`));
  expect(text).toMatch(/&model=none&test=unit · Unit tests is picked, then press Run/);
  expect(text).toContain('No test called "nonsense". Try one of: practice 28, one practice task, real requests, long task, work 28, new 28, my tests, my tests · easy, my tests · medium, my tests · hard, one of my tests, sorting check, plain questions check, done check, two at once, remote check, vision check, picture tokens, web check, mcp check, mcp check on a service, subagent check, auto & screen check, rules file old vs new, skills check, look first check, tool habits check, agents check, prompt old vs new, thinking old vs new, who decides: app vs model, big-model mode: off vs on, instructions: local vs remote, hard practice tasks, ui component battle, edited copy vs original, new model check, unit tests, repo check, weights reader check');
  expect(hub).toContain('runAsk'); // the hub hands the model and the test on to the Arena
  expect(page).not.toContain('id="runpane"'); // the record page has no Run tab: the Arena runs the tests
}, T);

test('the start waits while a test run holds the memory, and says it is a test run', async () => {
  const { cwd, env, home } = withStandInModel();
  writeFileSync(join(home, 'battle', 'running.json'), hold());
  const r = await runInPty({ cwd, env, args: ['--no-flows'], timeoutMs: 90_000, steps: [
    { wait: 'Waiting for a test run', ms: 20_000 }, { snapshot: 'waiting' },
    { fn: async () => { rmSync(join(home, 'battle', 'running.json'), { force: true }); } },
    { wait: '? for shortcuts', ms: 60_000 }, ...quit,
  ] });
  expect(r.snapshots.waiting.replace(/\s+/g, ' ')).toContain('Waiting for a test run: a test is running (Practice 28 on Gemma 4 12B QAT · just started). Only one model fits');
}, 100_000);

test('an open window lets its model go when a test run starts, and loads it again by itself when the run is over', async () => {
  const { cwd, env, home } = withStandInModel();
  const r = await runInPty({ cwd, env, args: ['--no-flows'], timeoutMs: 120_000, steps: [
    { wait: ' · effort ', ms: 45_000 }, { wait: '? for shortcuts', ms: 45_000 }, { sleep: 1500 },
    { fn: async () => { writeFileSync(join(home, 'battle', 'running.json'), hold()); } },
    { wait: 'is unloaded for now', ms: 15_000 }, { snapshot: 'released' },
    { fn: async () => { rmSync(join(home, 'battle', 'running.json'), { force: true }); } },
    { wait: 'is loaded again', ms: 60_000 }, ...quit,
  ] });
  expect(r.snapshots.released.replace(/\s+/g, ' ')).toContain('is unloaded for now: a test is running (Practice 28 on Gemma 4 12B QAT');
  expect(r.text.replace(/\s+/g, ' ')).toContain('when the test run is over');
  expect(r.text.replace(/\s+/g, ' ')).toContain(`The test run is over: ${D.name} is loaded again.`);
}, 130_000);
