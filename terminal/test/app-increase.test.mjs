// End-to-end, the real app in a pseudo-terminal (see app.test.mjs).
// Here: /increase, the panel of limits that move up and down, kept in settings.json.
import { test, expect } from 'bun:test';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';
import { ENGINE } from '../../models/index.mjs';

const settingsOf = (base) => JSON.parse(readFileSync(join(base, 'home', 'settings.json'), 'utf8'));

test('/increase: every limit with its cost, ←→ moves one, enter saves it for next time, Reset all puts them back', async () => {
  const { cwd, env, base } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' },
    { type: '/increase' }, { key: 'enter' }, { wait: 'Reset all' }, { sleep: 150 }, { snapshot: 'panel' },
    // down to Tries per fix, up one step (8 → 12), and Steps down one (40 → 20)
    { key: 'down' }, { sleep: 80 }, { key: 'down' }, { sleep: 80 }, { key: 'right' }, { sleep: 80 }, { key: 'down' }, { sleep: 80 }, { key: 'left' }, { sleep: 230 }, { snapshot: 'moved' },
    { key: 'enter' }, { wait: 'Saved:' }, { sleep: 150 }, { snapshot: 'saved' },
    // opened again it shows the saved values; esc keeps them
    { type: '/increase' }, { key: 'enter' }, { wait: 'Reset all' }, { sleep: 150 }, { snapshot: 'again' }, { key: 'esc' }, { wait: 'Limits kept as they were' },
    // up from the first row is Reset all
    { type: '/increase' }, { key: 'enter' }, { wait: 'Reset all' }, { key: 'up' }, { sleep: 80 }, { key: 'enter' }, { wait: 'Tries per fix 12 → 8' },
    ...quit,
  ] });
  await fake.close();
  const panel = r.snapshots.panel;
  for (const label of ['Limits', 'Context', 'Thinking cap', 'Tries per fix', 'Steps per request', 'Command output', 'Command timeout', 'Trim at', 'Summarize at', 'Reset all']) expect(panel).toContain(label);
  expect(panel).toMatch(/Context\s+◀ auto\s+▶\s+↻ default · 32k, or 16k when memory is short/);
  expect(panel).toMatch(/Thinking cap\s+◀ 4,096 tokens ▶\s+↻ default · up to ~5 min per think/);
  expect(panel).toMatch(/Tries per fix\s+◀ 8/);
  expect(panel).toContain('↑↓ choose · ←→ lower/raise · enter saves · esc cancels · ↻ restarts model');
  expect(r.snapshots.moved).toMatch(/Tries per fix\s+◀ 12\s+▶ •/);
  expect(r.snapshots.moved).toMatch(/Steps per request\s+◀ 20\s+▶ •/);
  expect(r.snapshots.saved).toContain('Saved: Tries per fix 8 → 12 · Steps per request 40 → 20. In use from the next step; kept for next time.');
  expect(r.snapshots.again).toMatch(/Tries per fix\s+◀ 12\s+▶  /); // saved: no • any more
  expect(settingsOf(base).limits).toEqual({});
}, T);

test('/increase with a server given by --url: a new thinking cap is saved, and it says to restart that server', async () => {
  const { cwd, env, base } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' },
    { type: '/increase' }, { key: 'enter' }, { wait: 'Reset all' },
    { key: 'down' }, { sleep: 80 }, { key: 'right' }, { sleep: 80 }, { key: 'enter' }, { wait: 'restart it yourself' },
    ...quit,
  ] });
  await fake.close();
  expect(r.text).toContain('Saved: Thinking cap 4,096 tokens → 8,192 tokens.');
  expect(settingsOf(base).limits).toEqual({ thinking: 8192 });
}, T);

test('saved limits are read at start: /stats lists them', async () => {
  const { cwd, env, base } = setup();
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ limits: { tries: 16, steps: 80 } }));
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' }, { type: '/stats' }, { key: 'enter' }, { wait: '/increase moves them' },
    ...quit,
  ] });
  await fake.close();
  expect(r.text).toContain('context auto · thinking cap 4,096 tokens · 16 tries · 80 steps · /increase moves them');
}, T);

test('/increase on a server Agentic Coder started: a new context and thinking cap restart it with both, and the window stays', async () => {
  const { cwd, env, base } = setup();
  const home = join(base, 'home');
  mkdirSync(join(home, 'engine', ENGINE.tag), { recursive: true });
  mkdirSync(join(home, 'models'), { recursive: true });
  symlinkSync(join(import.meta.dir, 'fake-llama-server.mjs'), join(home, 'engine', ENGINE.tag, 'llama-server'));
  writeFileSync(join(home, 'models', 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf'), 'stand-in');
  const argsFile = join(base, 'server-args.jsonl');
  const r = await runInPty({ cwd, env: { ...env, FAKE_LLAMA_ARGS: argsFile }, args: ['--no-flows'], timeoutMs: 120_000, steps: [
    { wait: '? for shortcuts', ms: 45_000 },
    { type: '/increase' }, { key: 'enter' }, { wait: 'Reset all' },
    // Context auto → 16k → 32k → 64k; Thinking cap 4,096 → 8,192
    { key: 'right' }, { sleep: 80 }, { key: 'right' }, { sleep: 80 }, { key: 'right' }, { sleep: 80 }, { key: 'down' }, { sleep: 80 }, { key: 'right' }, { sleep: 80 },
    { key: 'enter' }, { wait: 'Restarting Gemma' },
    { wait: 'restarted: context 64k · thinking cap 8,192 tokens', ms: 45_000 },
    { type: 'hello' }, { key: 'enter' }, { wait: 'Hello from the stand-in model.', ms: 45_000 },
    ...quit,
  ] });
  const starts = readFileSync(argsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const val = (a, flag) => a[a.indexOf(flag) + 1];
  expect(starts).toHaveLength(2);
  expect(val(starts[0], '--reasoning-budget')).toBe('4096');
  expect(val(starts[1], '-c')).toBe('65536');
  expect(val(starts[1], '--reasoning-budget')).toBe('8192');
  expect(r.text).toContain('Saved: Context auto → 64k · Thinking cap 4,096 tokens → 8,192 tokens. Restarting Gemma 4 12B QAT for it');
  expect(settingsOf(base).limits).toEqual({ context: 65536, thinking: 8192 });
}, 150_000);
