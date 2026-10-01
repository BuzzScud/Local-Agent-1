// End-to-end, the real app in a pseudo-terminal (see app.test.mjs), with the stand-in
// llama-server. The model is off when a window opens (the user's pick, 30 Sep 2026): a message
// waits, /start loads the model and sends it, /stop unloads it and gives the memory back,
// /autostart on loads it as the next window opens, and quitting leaves nothing loaded.
import { test, expect } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInPty, emulate } from './pty.mjs';
import { ASK_CURSOR } from '../src/app/mouse.mjs';
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
    { type: 'hello' }, { key: 'enter' }, { wait: 'The model is off. /start or ctrl+t loads it' }, { sleep: 200 }, { snapshot: 'held' },
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
  expect(r.snapshots.off).toContain('○ model off · ctrl+t start');
  // The message waits, said once, with the Queued line.
  expect(r.snapshots.held).toContain('Queued: hello');
  expect(r.snapshots.held).toContain('sends once /start has loaded the model');
  // /start loaded the stand-in and the message went to it.
  expect(seen.loaded).toHaveLength(1);
  expect(alive(seen.loaded[0].pid)).toBe(false); // gone by now: /stop, then the quit
  // /stop: unloaded, its files gone, said on screen.
  expect(seen.afterStop).toEqual([]);
  expect(r.snapshots.stopped).toMatch(/is unloaded.*\/start loads it again/s);
  expect(r.snapshots.stopped).toContain('○ model off · ctrl+t start');
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

// The model's label in the footer: ctrl+t switches it, and so does a click on it with /mouse on.
const NAME = D.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
test('ctrl+t starts and stops the model; the footer says which, with the memory it holds; in a reply the first press only asks', async () => {
  const { cwd, env, home } = withStandInModel();
  const seen = {};
  const r = await runInPty({ cwd, env: { ...env, FAKE_LLAMA_REPLY_MS: '6000' }, args: ['--no-flows'], timeoutMs: 90_000, steps: [
    { wait: '○ model off · ctrl+t start' },
    { key: '\x14' }, { wait: `${D.name} loading · ctrl+t stop` }, { snapshot: 'loading' },
    { wait: `● ${D.name}`, ms: 45_000 }, { wait: 'GB · ctrl+t stop', ms: 15_000 }, { snapshot: 'on' },
    { fn: async () => { seen.loaded = servers(home).length; } },
    { key: '\x14' }, { wait: 'is unloaded', ms: 15_000 }, { wait: '○ model off · ctrl+t start' },
    { fn: async () => { seen.afterStop = servers(home).length; } },
    // A reply under way: the first ctrl+t only asks, the second stops the reply and unloads.
    { key: '\x14' }, { wait: `● ${D.name}`, ms: 45_000 },
    { type: 'hello' }, { key: 'enter' }, { wait: 'esc to interrupt', ms: 15_000 },
    { key: '\x14' }, { wait: 'Press ctrl+t again to stop the reply' }, { snapshot: 'asked' },
    { fn: async () => { seen.stillLoaded = servers(home).length; } },
    { key: '\x14' }, { wait: 'is unloaded', ms: 15_000 }, { sleep: 300 },
    { fn: async () => { seen.afterReply = servers(home).length; } },
    ...quit,
  ] });
  expect(r.snapshots.loading).toMatch(new RegExp(`◐ ${NAME} loading · ctrl\\+t stop`));
  expect(r.snapshots.on).toMatch(new RegExp(`● ${NAME} · \\d+\\.\\d GB · ctrl\\+t stop`));
  expect(seen.loaded).toBe(1);
  expect(seen.afterStop).toBe(0);
  expect(seen.stillLoaded).toBe(1); // the first press during the reply changed nothing
  expect(seen.afterReply).toBe(0);
  expect(r.text).not.toContain('Hello from the stand-in model.'); // the reply was stopped
}, 100_000);

test('/mouse on: a click on the model\'s label in the footer starts it, and a click on it again stops it', async () => {
  const { cwd, env, home } = withStandInModel();
  const seen = {};
  // Terminal's part: the mouse report, then the answer to "where is the cursor?" (it sits in the prompt box).
  const click = async ({ write, raw }, word) => {
    const now = raw();
    const term = await emulate(now, 80, 24);
    const b = term.buffer.active;
    let at = null;
    for (let y = 0; y < term.rows && !at; y++) { const x = (b.getLine(b.baseY + y)?.translateToString(true) ?? '').indexOf(word); if (x >= 0) at = { col: x + 3, row: y + 1 }; }
    if (!at) throw new Error(`"${word}" is not on the screen`);
    const asked = now.split(ASK_CURSOR).length;
    write(`\x1b[<0;${at.col};${at.row}M`);
    for (let i = 0; i < 100 && raw().split(ASK_CURSOR).length === asked; i++) await new Promise((res) => setTimeout(res, 10));
    write(`\x1b[${term.buffer.active.cursorY + 1};${term.buffer.active.cursorX + 1}R`);
    await new Promise((res) => setTimeout(res, 50));
    write(`\x1b[<0;${at.col};${at.row}m`);
  };
  const r = await runInPty({ cwd, cols: 80, rows: 24, env, args: ['--no-flows'], timeoutMs: 90_000, steps: [
    { wait: '○ model off · ctrl+t start' },
    { type: '/mouse on' }, { key: 'enter' }, { wait: 'Mouse on' }, { sleep: 300 },
    { fn: (t) => click(t, '○ model off') }, { wait: `● ${D.name}`, ms: 45_000 }, { sleep: 500 },
    { fn: async () => { seen.loaded = servers(home).length; } },
    { fn: (t) => click(t, `● ${D.name}`) }, { wait: 'is unloaded', ms: 15_000 }, { sleep: 300 },
    { fn: async () => { seen.afterStop = servers(home).length; } },
    { snapshot: 'end' },
    ...quit,
  ] });
  expect(seen.loaded).toBe(1);
  expect(seen.afterStop).toBe(0);
  expect(r.snapshots.end).toContain('○ model off · ctrl+t start');
  expect(r.snapshots.end).not.toContain('[<0;'); // the reports were never typed
}, 100_000);
