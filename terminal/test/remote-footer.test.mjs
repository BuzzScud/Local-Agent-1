// The footer on a remote model (remote-footer.mjs, screen.jsx footerParts; design 2 of
// docs/design rounds/remote-footer-2-designs-2026-10-02.html, 2 Oct 2026): gauges in place of
// "? for shortcuts" once the first answer has a speed, no Mac's memory, what a narrow window drops
// first, the order from settings.json, the shortcuts and /meters on a remote; and the agent's
// figures behind them (the first token, a speed timed here when the service sends none, the last 8).
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-rf-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { gaugesOf, gaugeLine, dropOrder, spark, bar, meterWords, textOf, widthOf } = await import('../src/app/remote-footer.mjs');
const { footerParts, shortcutsOf, shortcutRows } = await import('../src/app/screen.jsx');
const { HOME } = await import('../../models/index.mjs');
test('the tests run in a throwaway home', () => { expect(HOME).not.toBe(join(homedir(), '.agentic-coder')); });

const ms = (state = 'on') => ({ remote: true, state, name: 'gpt-oss:120b', where: '203.0.113.7:60009', gb: null });
const G = { tps: 41, live: false, speeds: [41, 44, 39, 47, 43, 45, 40, 41], ttft: 1.2, ctxUsed: 49807, ctx: 131072, gpuPct: 100 };
const mac = { total: 16 * 2 ** 30, avail: 4.8 * 2 ** 30, level: 1 };
const row = (width, o = {}) => footerParts({ mode: 'edits', notice: null, width, modelState: ms(), gauges: G, mac, ...o });
const gaugesAt = (width, o) => textOf(row(width, o).gauges ?? []);

test('gauges take the left side once there is a speed, each width keeping what fits; the Mac\'s memory and the cost meter are never there', () => {
  expect(gaugesAt(80)).toBe('↓41 tok/s  ctx ▰▰▱▱ 38%  GPU ▰▰▰▰ 100%');
  expect(gaugesAt(100)).toBe(`↓41 tok/s ${spark(G.speeds)}  ctx ▰▰▰▱▱▱▱▱ 38%  GPU ▰▰▰▰▰▰▰▰ 100%`);
  expect(gaugesAt(120)).toBe(`↓41 tok/s ${spark(G.speeds)}  1.2 s to first  ctx ▰▰▰▱▱▱▱▱ 38% of 128k  GPU ▰▰▰▰▰▰▰▰ 100%`);
  expect(row(120).label).toBe('● gpt-oss:120b');
  expect(row(160).label).toBe('● gpt-oss:120b on 203.0.113.7:60009'); // where it runs comes back with room
  for (const w of [56, 80, 100, 120, 160]) {
    const p = row(w, { spend: '$0.03 this window' });
    expect([p.mac, p.spend]).toEqual(['', '']);
    expect(2 + widthOf(p.gauges) + 2).toBeLessThan(p.labelAt.from); // two cells clear of the right side
    expect(p.labelAt.to - p.labelAt.from + 1).toBe(p.label.length); // where a click lands (/mouse on)
  }
});

test('before the first answer, and with a note, a tip or shell mode, the left says what it says today; a service that is not answering shows no gauges', () => {
  expect(row(100, { gauges: null })).toMatchObject({ left: '? for shortcuts', gauges: null, mac: '' });
  expect(row(100, { notice: 'copied 3 lines' })).toMatchObject({ left: 'copied 3 lines', gauges: null });
  expect(row(100, { tip: 'Hit shift+tab to switch mode' }).gauges).toBe(null);
  expect(row(100, { inputMode: 'bash' }).gauges).toBe(null);
  const down = footerParts({ mode: 'edits', notice: null, width: 100, modelState: ms('down'), gauges: G, mac });
  expect(down).toMatchObject({ gauges: null, label: '✗ 203.0.113.7:60009 is not answering', mac: '' });
});

test('a spill onto the CPU: GPU in amber with "rest on CPU", the chart amber too, and GPU the last gauge to go', () => {
  const spill = { gauges: { ...G, gpuPct: 62 } };
  expect(gaugesAt(100, spill)).toBe('↓41 tok/s  ctx ▰▰▰▱▱▱▱▱ 38%  GPU ▰▰▰▰▰▰▰▰ 62% rest on CPU');
  expect(row(100, spill).gauges.filter((s) => s.tone === 'warn').map((s) => s.text)).toEqual(['▰▰▰', '62%', ' rest on CPU']);
  expect(gaugeLine({ ...G, gpuPct: 62 }).find((s) => s.text === spark(G.speeds)).tone).toBe('warn');
  // 53 columns: room for one gauge; the speed normally, GPU while it spills
  expect([gaugesAt(53), gaugesAt(53, spill)]).toEqual(['↓41 tok/s', 'GPU 62%']);
  expect(dropOrder()).toEqual(['cycle', 'where', 'ttft', 'ctxOf', 'spark', 'short', 'bars', 'gpu', 'ctx', 'speed', 'label']);
  expect(dropOrder(undefined, true).slice(-4)).toEqual(['ctx', 'speed', 'gpu', 'label']);
});

test('the colours: the speed green while it writes; the context amber from 70% and red from 85%; no GPU gauge without /api/ps (the Claude API, llama.cpp)', () => {
  expect(gaugeLine({ ...G, live: true })[1]).toEqual({ text: '41', tone: 'live' });
  const pctTone = (used) => gaugeLine({ ...G, ctxUsed: used }).find((s) => /%$/.test(s.text) && s.text !== '100%').tone;
  expect([pctTone(49807), pctTone(0.75 * 131072), pctTone(0.9 * 131072)]).toEqual(['value', 'warn', 'bad']);
  expect(textOf(gaugeLine({ ...G, gpuPct: null }))).not.toContain('GPU');
  expect(spark([41, 44, 39, 47])).toHaveLength(4);
  expect(spark([41, 41, 9, 11])).toMatch(/^[▇█]{2}[▁▂]{2}$/); // a spill's slow answers stand out
  expect([bar(0.38, 8), bar(0, 4), bar(0.001, 4)]).toEqual(['▰▰▰▱▱▱▱▱', '▱▱▱▱', '▰▱▱▱']);
});

test('settings.json footer.remote picks the gauges and their order; a narrow window drops from the end of it', () => {
  expect(gaugesOf(undefined)).toEqual(['speed', 'ttft', 'ctx', 'gpu']);
  expect(gaugesOf(['CTX', 'speed', 'nope', 'ctx'])).toEqual(['ctx', 'speed']);
  expect(gaugesAt(100, { gaugeList: ['ctx', 'speed'] })).toBe(`ctx ▰▰▰▱▱▱▱▱ 38% of 128k  ↓41 tok/s ${spark(G.speeds)}`);
  expect(gaugesAt(53, { gaugeList: ['ctx', 'speed'] })).toBe('ctx 38%');
  expect(row(100, { gaugeList: [] })).toMatchObject({ left: '? for shortcuts', gauges: null });
});

test('the shortcuts on a remote: ctrl+t switches the model, ctrl+r and ctrl+p for big models; this Mac\'s list is as it was', () => {
  const far = shortcutsOf(true).flat();
  expect(far).toEqual(expect.arrayContaining(['ctrl+t to switch the model', 'ctrl+r for a second opinion now', 'ctrl+p to compact now', '/meters for the whole server line']));
  expect(far).not.toContain('ctrl+t to start or stop the model');
  expect(shortcutsOf(false).flat()).toContain('ctrl+t to start or stop the model');
  expect([shortcutRows(false), shortcutRows(true)]).toEqual([8, 9]);
});

test('/meters on a remote: both speeds, the first token, GPU memory and how long it stays, the cost, the ping', () => {
  const kept = { loaded: true, ms: 24, size: 65.4e9, vram: 65.4e9, until: '2318-06-11T12:00:00Z' };
  expect(meterWords({ g: G, pps: 1900, server: kept, spend: '$0.12 this window' })).toEqual(['↓41 ↑1.9k tok/s', '1st token 1.2 s', 'GPU 65.4/65.4 GB · kept loaded', '$0.12 this window', 'ping 24 ms']);
  const now = Date.parse('2026-10-02T12:00:00Z');
  const soon = { loaded: true, ms: 9, size: 18.6e9, vram: 11.5e9, until: '2026-10-02T12:04:00Z' };
  expect(meterWords({ g: G, pps: 900, server: soon, now })).toEqual(['↓41 ↑900 tok/s', '1st token 1.2 s', 'GPU 11.5/18.6 GB · unloads in 4 min', 'ping 9 ms']);
  expect(meterWords({ server: { loaded: false, ms: 12 } })).toEqual(['ping 12 ms']); // before the first answer, nothing loaded
});

test('the agent times what the footer shows: the first token, the service\'s own speed or one timed here when it sends none, the last 8 of the model in use', async () => {
  const { startFakeServer } = await import('./fake-server.mjs');
  const { Agent } = await import('../src/agent/agent.mjs');
  const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');
  const { systemPrompt } = await import('../src/agent/prompt.mjs');
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-rf-'));
  const text = 'A reply long enough to be timed here. '.repeat(6);
  const agentOn = (url) => new Agent({ url, model: MODELS[DEFAULT_MODEL], cwd, system: systemPrompt({ cwd, git: 'test', tests: null }), thinking: false, ctx: 32768, mode: 'ask', flows: false, ask: async () => ({ choice: 'no' }) });
  // the Claude API and OpenRouter send no speed: it is timed from the first token to the end
  const quiet = await startFakeServer([{ text }], { timings: false, delayMs: 10, chunk: 4 });
  try {
    const a = agentOn(quiet.url);
    await a.send('hello');
    expect(a.stats.ttft).toBeGreaterThan(0);
    expect(a.stats.tps).toBeGreaterThan(0);
    expect(a.stats.tps).not.toBe(41.9);
    expect(a.stats.speeds.length).toBeGreaterThanOrEqual(1);
    expect(a.stats.speedsOf).toBe(MODELS[DEFAULT_MODEL].id);
  } finally { await quiet.close(); }
  // llama.cpp and Ollama send their own; another model's speeds start a list of their own
  const own = await startFakeServer([{ text }, { text }]);
  try {
    const a = agentOn(own.url);
    await a.send('hello');
    expect(a.stats.tps).toBe(41.9);
    expect(a.stats.speeds.at(-1)).toBe(41.9);
    a.stats.speedsOf = 'another-model';
    a.stats.speeds = [1, 2, 3];
    await a.send('again');
    expect(a.stats.speeds.every((v) => v === 41.9)).toBe(true);
    expect(a.stats.speedsOf).toBe(MODELS[DEFAULT_MODEL].id);
  } finally { await own.close(); }
});
