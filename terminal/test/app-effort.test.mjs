// End-to-end, the real app in a pseudo-terminal (see app.test.mjs).
// Here: /effort, the panel with the Effort row, the search's rows and the
// limits that move up and down, kept in settings.json. (/increase was folded
// into it on 29 Sep 2026; the Search rows came the same day.)
import { test, expect } from 'bun:test';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';
import { ENGINE } from '../../models/index.mjs';

const settingsOf = (base) => JSON.parse(readFileSync(join(base, 'home', 'settings.json'), 'utf8'));
// The three Search rows (Embedder, Retriever, Reranker) sit between Effort and the limits.
const PAST_SEARCH = [{ key: 'down' }, { sleep: 80 }, { key: 'down' }, { sleep: 80 }, { key: 'down' }, { sleep: 80 }];

test('/effort: Effort and every limit with its cost, ←→ moves one, enter saves it for next time, Reset all puts them back', async () => {
  const { cwd, env, base } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' },
    { type: '/effort' }, { key: 'enter' }, { wait: 'Reset all' }, { sleep: 150 }, { snapshot: 'panel' },
    // Effort is the first row; down to Tries per fix, up one step (8 → 12), and Steps down one (40 → 20)
    ...PAST_SEARCH, { key: 'down' }, { sleep: 80 }, { key: 'down' }, { sleep: 80 }, { key: 'down' }, { sleep: 80 }, { key: 'right' }, { sleep: 80 }, { key: 'down' }, { sleep: 80 }, { key: 'left' }, { sleep: 230 }, { snapshot: 'moved' },
    { key: 'enter' }, { wait: 'Saved:' }, { sleep: 150 }, { snapshot: 'saved' },
    // opened again it shows the saved values; esc keeps them
    { type: '/effort' }, { key: 'enter' }, { wait: 'Reset all' }, { sleep: 150 }, { snapshot: 'again' }, { key: 'esc' }, { wait: 'Effort and limits kept as they were' },
    // up from the first row is Reset all
    { type: '/effort' }, { key: 'enter' }, { wait: 'Reset all' }, { key: 'up' }, { sleep: 80 }, { key: 'enter' }, { wait: 'Tries per fix 12 → 8' },
    ...quit,
  ] });
  await fake.close();
  const panel = r.snapshots.panel;
  for (const label of ['Effort and limits', 'Effort', '── Search', 'Embedder', 'Retriever', 'Reranker', '── Limits', 'Context', 'Thinking cap', 'Tries per fix', 'Steps per request', 'Command output', 'Command timeout', 'Trim at', 'Summarize at', 'Reset all']) expect(panel).toContain(label);
  expect(panel).toMatch(/Retriever\s+◀ Meaning\s+▶\s+default · by meaning alone/);
  expect(panel).toMatch(/Reranker\s+◀ Off\s+▶\s+default · the search’s own order/);
  expect(panel).toMatch(/Context\s+◀ auto\s+▶\s+↻ default · 32k, or 16k when memory is short/);
  expect(panel).toMatch(/Effort\s+◀ Low\s+▶\s+default · answers straight away/);
  expect(panel).toMatch(/Thinking cap\s+◀ 4,096 tokens ▶\s+↻ default · High only: not used while Effort is Low/); // Effort is Low
  expect(panel).toMatch(/Tries per fix\s+◀ 8/);
  expect(panel).toContain('↑↓ choose · ←→ change · enter saves · esc cancels · ↻ restarts model');
  expect(r.snapshots.moved).toMatch(/Tries per fix\s+◀ 12\s+▶ •/);
  expect(r.snapshots.moved).toMatch(/Steps per request\s+◀ 20\s+▶ •/);
  expect(r.snapshots.saved).toContain('Saved: Tries per fix 8 → 12 · Steps per request 40 → 20. In use from the next step; kept for next time.');
  expect(r.snapshots.again).toMatch(/Tries per fix\s+◀ 12\s+▶  /); // saved: no • any more
  expect(settingsOf(base).limits).toEqual({});
}, T);

test('/effort with a server given by --url: a new thinking cap is saved, and it says to restart that server', async () => {
  const { cwd, env, base } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' },
    { type: '/effort' }, { key: 'enter' }, { wait: 'Reset all' },
    ...PAST_SEARCH, { key: 'down' }, { sleep: 80 }, { key: 'down' }, { sleep: 80 }, { key: 'right' }, { sleep: 80 }, { key: 'enter' }, { wait: 'restart it yourself' },
    ...quit,
  ] });
  await fake.close();
  expect(r.text).toContain('Saved: Thinking cap 4,096 tokens → 8,192 tokens.');
  expect(settingsOf(base).limits).toEqual({ thinking: 8192 });
}, T);

test('/effort: High and two limits save with ONE enter; the Thinking cap wakes up on High and the note names the new cap', async () => {
  const { cwd, env, base } = setup();
  const fake = await startFakeServer([{ text: 'Hi.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' },
    { type: '/effort' }, { key: 'enter' }, { wait: 'moves a row' }, { sleep: 150 }, { snapshot: 'low' },
    // Effort → High (Thinking cap stops being dimmed), Thinking cap → 8,192, Tries → 12
    { key: 'right' }, { sleep: 100 }, { snapshot: 'high' },
    ...PAST_SEARCH, { key: 'down' }, { sleep: 80 }, { key: 'down' }, { sleep: 80 }, { key: 'right' }, { sleep: 80 }, { key: 'down' }, { sleep: 80 }, { key: 'right' }, { sleep: 230 }, { snapshot: 'moved' },
    { key: 'enter' }, { wait: 'restart it yourself' },
    { type: 'hi' }, { key: 'enter' }, { wait: 'Hi.' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.low).toMatch(/Thinking cap\s+◀ 4,096 tokens ▶\s+↻ default · High only: not used while Effort is Low/);
  expect(r.snapshots.high).toMatch(/❯ Effort\s+◀ High\s+▶ •\s+thinks first/);
  expect(r.snapshots.high).toMatch(/Thinking cap\s+◀ 4,096 tokens ▶\s+↻ default · up to ~5 min per think \(High only\)/);
  expect(r.snapshots.moved).toMatch(/Tries per fix\s+◀ 12\s+▶ •/);
  expect(r.text).toContain('Effort is high: it thinks first; stopped at 8,192 tokens.'); // the cap saved in the same enter
  expect(r.text).toContain('Saved: Thinking cap 4,096 tokens → 8,192 tokens · Tries per fix 8 → 12.');
  const saved = settingsOf(base);
  expect([saved.thinking, saved.effort]).toEqual([true, 'high']);
  expect(saved.limits).toEqual({ thinking: 8192, tries: 12 });
  expect(fake.requests.find((q) => q.stream && q.tools).chat_template_kwargs).toEqual({ enable_thinking: true, reasoning_effort: 'high' });
}, T);

test('Reset all puts Effort back to its default too, and Effort alone saves without a "Saved:" limits note', async () => {
  const { cwd, env, base } = setup();
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ thinking: true, effort: 'high', limits: { tries: 16 } }));
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' },
    // saved High + 16 tries → Reset all
    { type: '/effort' }, { key: 'enter' }, { wait: 'Reset all' }, { sleep: 150 }, { snapshot: 'saved' },
    { key: 'up' }, { sleep: 80 }, { key: 'enter' }, { wait: 'Tries per fix 16 → 8' }, { sleep: 150 },
    // Effort alone: Low → High, no limit touched
    { type: '/effort' }, { key: 'enter' }, { wait: 'Reset all' }, { sleep: 150 }, { key: 'right' }, { sleep: 80 }, { key: 'enter' }, { wait: 'Effort is high' }, { sleep: 200 },
    // nothing changed
    { type: '/effort' }, { key: 'enter' }, { wait: 'Reset all' }, { sleep: 150 }, { key: 'enter' }, { wait: 'Effort and limits unchanged' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.saved).toMatch(/❯ Effort\s+◀ High\s+▶\s+thinks first/);
  expect(r.snapshots.saved).toMatch(/Tries per fix\s+◀ 16\s+▶/);
  expect(r.text).toContain('Effort is low: it answers straight away'); // Reset all
  expect(r.text).not.toContain('Saved: Effort'); // Effort is said in its own note, not as a limit
  expect(r.text).toContain('Effort is high: it thinks first');
  const saved = settingsOf(base);
  expect([saved.thinking, saved.effort]).toEqual([true, 'high']);
  expect(saved.limits).toEqual({});
}, T);

test('/increase is gone: not in the "/" menu, and typing it is an unknown command; /effort is the one place', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' },
    { type: '/in' }, { sleep: 250 }, { snapshot: 'menu' },
    { type: 'crease' }, { key: 'enter' }, { wait: 'Unknown command /increase' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.menu).toMatch(/\/init\s/); // the "/in" list still has /init…
  expect(r.snapshots.menu).not.toContain('/increase'); // …and not /increase
  expect(r.text).toContain('Unknown command /increase. Type /help for the list.');
}, T);

test('saved limits are read at start: /stats lists them', async () => {
  const { cwd, env, base } = setup();
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ limits: { tries: 16, steps: 80 } }));
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' }, { type: '/stats' }, { key: 'enter' }, { wait: '/effort moves them' },
    ...quit,
  ] });
  await fake.close();
  expect(r.text).toContain('context auto · thinking cap 4,096 tokens · 16 tries · 80 steps · /effort moves them');
}, T);

test('/effort on a server Agentic Coder started: a new context and thinking cap restart it with both, and the window stays', async () => {
  const { cwd, env, base } = setup();
  const home = join(base, 'home');
  mkdirSync(join(home, 'engine', ENGINE.tag), { recursive: true });
  mkdirSync(join(home, 'models'), { recursive: true });
  symlinkSync(join(import.meta.dir, 'fake-llama-server.mjs'), join(home, 'engine', ENGINE.tag, 'llama-server'));
  writeFileSync(join(home, 'models', 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf'), 'stand-in');
  const argsFile = join(base, 'server-args.jsonl');
  const r = await runInPty({ cwd, env: { ...env, FAKE_LLAMA_ARGS: argsFile }, args: ['--no-flows'], timeoutMs: 120_000, steps: [
    { wait: '? for shortcuts', ms: 45_000 }, { waitGone: 'Starting Gemma', ms: 60_000 }, // ready: a restart is refused while the model still starts
    { type: '/effort' }, { key: 'enter' }, { wait: 'Reset all' },
    // Effort stays; Context auto → 16k → 32k → 64k; Thinking cap 4,096 → 8,192
    ...PAST_SEARCH, { key: 'down' }, { sleep: 80 }, { key: 'right' }, { sleep: 80 }, { key: 'right' }, { sleep: 80 }, { key: 'right' }, { sleep: 80 }, { key: 'down' }, { sleep: 80 }, { key: 'right' }, { sleep: 80 },
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

test('/effort while a reply is running: a change that needs a restart is refused and NOTHING changes, Effort included; when idle the same change saves', async () => {
  const { cwd, env, base } = setup();
  const home = join(base, 'home');
  mkdirSync(join(home, 'engine', ENGINE.tag), { recursive: true });
  mkdirSync(join(home, 'models'), { recursive: true });
  symlinkSync(join(import.meta.dir, 'fake-llama-server.mjs'), join(home, 'engine', ENGINE.tag, 'llama-server'));
  writeFileSync(join(home, 'models', 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf'), 'stand-in');
  const argsFile = join(base, 'server-args.jsonl');
  const r = await runInPty({ cwd, env: { ...env, FAKE_LLAMA_ARGS: argsFile, FAKE_LLAMA_REPLY_MS: '9000' }, args: ['--no-flows'], timeoutMs: 150_000, steps: [
    { wait: '? for shortcuts', ms: 45_000 }, { waitGone: 'Starting Gemma', ms: 60_000 }, // ready: a prompt now goes out, not into the queue
    // the reply is held open for 9 s; /effort runs at once, even now
    { type: 'hello' }, { key: 'enter' }, { sleep: 1500 },
    { type: '/effort' }, { key: 'enter' }, { wait: 'Reset all' }, { sleep: 150 },
    // Effort → High, Context auto → 16k (a restart), enter
    { key: 'right' }, { sleep: 80 }, ...PAST_SEARCH, { key: 'down' }, { sleep: 80 }, { key: 'right' }, { sleep: 230 },
    { key: 'enter' }, { wait: 'Nothing was changed' },
    { wait: 'Hello from the stand-in model.', ms: 30_000 }, { sleep: 500 },
    // idle now: the same change saves, and the server restarts once
    { type: '/effort' }, { key: 'enter' }, { wait: 'Reset all' }, { sleep: 150 },
    { key: 'right' }, { sleep: 80 }, ...PAST_SEARCH, { key: 'down' }, { sleep: 80 }, { key: 'right' }, { sleep: 230 },
    { key: 'enter' }, { wait: 'Restarting Gemma' },
    { wait: 'restarted: context 16k', ms: 45_000 },
    ...quit,
  ] });
  const starts = readFileSync(argsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const refused = r.text.indexOf('Nothing was changed');
  expect(refused).toBeGreaterThan(-1);
  expect(r.text).toContain('Agentic Coder is in the middle of a reply. Let it finish (or press esc), then save again in /effort. Nothing was changed.');
  // nothing was said as saved before the refusal, and the server was not restarted for it
  expect(r.text.slice(0, refused)).not.toContain('Effort is high');
  expect(r.text.slice(0, refused)).not.toContain('Saved:');
  expect(r.text.slice(refused)).toContain('Effort is high: it thinks first');
  expect(r.text.slice(refused)).toContain('Saved: Context auto → 16k.');
  expect(starts).toHaveLength(2); // the first start, and the one restart after the second save
  expect(starts[1][starts[1].indexOf('-c') + 1]).toBe('16384');
  const saved = settingsOf(base);
  expect([saved.thinking, saved.effort]).toEqual([true, 'high']);
  expect(saved.limits).toEqual({ context: 16384 });
}, 150_000);

test('/effort while the model is still starting: a Context change is refused and NOTHING changes, and a message queued meanwhile still gets its reply', async () => {
  const { cwd, env, base } = setup();
  const home = join(base, 'home');
  mkdirSync(join(home, 'engine', ENGINE.tag), { recursive: true });
  mkdirSync(join(home, 'models'), { recursive: true });
  symlinkSync(join(import.meta.dir, 'fake-llama-server.mjs'), join(home, 'engine', ENGINE.tag, 'llama-server'));
  writeFileSync(join(home, 'models', 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf'), 'stand-in');
  const argsFile = join(base, 'server-args.jsonl');
  // the stand-in takes 9 s to load, so the start-up window is long enough to act inside it
  const r = await runInPty({ cwd, env: { ...env, FAKE_LLAMA_ARGS: argsFile, FAKE_LLAMA_LOAD_MS: '9000' }, args: ['--no-flows'], timeoutMs: 120_000, steps: [
    { wait: '? for shortcuts', ms: 45_000 }, // the welcome shows this at once; the model is still loading
    { type: 'hello' }, { key: 'enter' }, { sleep: 600 }, // queued: "sends as soon as the model is ready"
    { type: '/effort' }, { key: 'enter' }, { wait: 'Reset all' }, { sleep: 150 },
    // Effort → High, Context auto → 16k (a restart), enter
    { key: 'right' }, { sleep: 80 }, ...PAST_SEARCH, { key: 'down' }, { sleep: 80 }, { key: 'right' }, { sleep: 230 },
    { key: 'enter' }, { wait: 'Nothing was changed' },
    // the queued message goes to the model that is still there (before, it went to the one just stopped)
    { wait: 'Hello from the stand-in model.', ms: 60_000 },
    ...quit,
  ] });
  const starts = readFileSync(argsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  expect(r.text).toContain('Agentic Coder is still starting. Wait until it is ready, then save again in /effort. Nothing was changed.');
  expect(r.text).not.toContain('Unable to connect');
  expect(r.text).not.toContain('Effort is high'); // Effort was part of the refused save
  expect(r.text).not.toContain('Saved:');
  expect(starts).toHaveLength(1); // no restart
  let saved = {};
  try { saved = settingsOf(base); } catch {}
  expect(saved.effort).toBeUndefined();
  expect(saved.thinking).toBeUndefined();
  expect(saved.limits ?? {}).toEqual({});
}, 150_000);


test('/effort Search rows: Retriever and Reranker save with one enter, no restart; a reranker not on this Mac says how to get it; /stats lists them', async () => {
  const { cwd, env, base } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Welcome' },
    { type: '/effort' }, { key: 'enter' }, { wait: 'Reset all' }, { sleep: 150 },
    // Effort → Embedder → Retriever: Hybrid; → Reranker: Qwen3 0.6B
    { key: 'down' }, { sleep: 80 }, { key: 'down' }, { sleep: 80 }, { key: 'right' }, { sleep: 80 }, { key: 'down' }, { sleep: 80 }, { key: 'right' }, { sleep: 230 }, { snapshot: 'moved' },
    { key: 'enter' }, { wait: 'Saved:' }, { sleep: 200 },
    { type: '/stats' }, { key: 'enter' }, { wait: 'retriever hybrid' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.moved).toMatch(/Retriever\s+◀ Hybrid\s+▶ •\s+meaning \+ words, merged \(RRF\)/);
  expect(r.snapshots.moved).toMatch(/❯ Reranker\s+◀ Qwen3 0\.6B\s+▶ •/);
  expect(r.text).toContain('Saved: Retriever Meaning → Hybrid · Reranker Off → Qwen3 0.6B. In use from the next step; kept for next time.');
  expect(r.text).not.toContain('Restarting'); // the search needs no restart
  expect(r.text).toContain('Qwen3-Reranker 0.6B is not on this Mac yet, so the reranker stays off: run coding setup (639 MB), then save it again in /effort.');
  expect(r.text).toMatch(/embedder (BGE-M3|Off) · retriever hybrid · reranker Qwen3 0\.6B/);
  expect(settingsOf(base).limits).toEqual({ retriever: 'hybrid', reranker: 'qwen3-reranker-0.6b' });
  // the panel fits a 24-row window with room to spare (at the window's height the screen redraws whole on every key)
  const lines = r.snapshots.moved.split('\n');
  const top = lines.findIndex((l) => l.includes('Effort and limits'));
  const bottom = lines.findIndex((l, i) => i > top && l.includes('↑↓ choose'));
  expect(bottom - top + 1 + 2).toBeLessThanOrEqual(22); // with its two border lines
}, T);
