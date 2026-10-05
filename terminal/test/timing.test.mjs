// Where a request's time goes (agent/timing.mjs, 5 Oct 2026): each model reply with what the service says it
// spent reading and writing, each side call, each tool run; the sums and the bench's line.
import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-timing-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { replyTiming, toolTiming, timeOf, timeLine, slowReads, timelineFrom } = await import('../src/agent/timing.mjs');
const { Agent } = await import('../src/agent/agent.mjs');
const { runHeadless } = await import('../src/headless.mjs');
const { complete, timers } = await import('../src/flows/llm.mjs');
const { fakeOllama } = await import('./fake-ollama.mjs');
const { MODELS, DEFAULT_MODEL, setEndpoint, dropEndpoint } = await import('../../models/index.mjs');

const local = MODELS[DEFAULT_MODEL];
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentic-timing-'));
  writeFileSync(join(dir, 'notes.txt'), 'Hello wrold\n');
});
const onService = async (opts = {}) => {
  const svc = await fakeOllama(opts);
  setEndpoint(svc.url, { remote: true, kind: 'openai', ollama: true, thinks: true, model: 'coder:30b', numCtx: 65536, keepAlive: -1, free: true });
  return svc;
};
const remote = (extra = {}) => ({ ...local, remote: { model: 'coder:30b' }, ...extra });

test('a reply: what the service says it spent, and the rest as waiting; without its numbers, up to the first word and after', () => {
  const served = replyTiming({ start: 0, end: 10_000, timings: { prompt_n: 61_200, prompt_ms: 3000, predicted_ms: 5000, load_ms: 500 }, out: 200, fresh: 900, think: 120, thinkSecs: 2.04 });
  expect(served).toEqual({ kind: 'reply', start: 0, secs: 10, out: 200, fresh: 900, think: 120, thinkSecs: 2, prompt: 61_200, load: 0.5, read: 3, write: 5, wait: 1.5 });
  // Cut short (no numbers come): the time to its first word, and writing after it.
  expect(replyTiming({ start: 0, end: 9000, firstToken: 4000, cut: 'thought past the cap' })).toEqual({ kind: 'reply', start: 0, secs: 9, out: 0, cut: 'thought past the cap', before: 4, write: 5 });
  expect(toolTiming({ name: 'Bash', start: 1000, end: 3500, error: true })).toEqual({ kind: 'tool', name: 'Bash', start: 1000, secs: 2.5, error: true });
});

test('a run added up: writing, thinking, reading, tools by name, the app the rest; the line and the slow reads', () => {
  const entries = [
    replyTiming({ start: 0, end: 10_000, timings: { prompt_n: 9000, prompt_ms: 8000, predicted_ms: 2000 }, fresh: 9000 }),
    toolTiming({ name: 'Read', start: 10_000, end: 10_500 }),
    replyTiming({ start: 11_000, end: 71_000, timings: { prompt_n: 40_000, prompt_ms: 38_000, predicted_ms: 20_000 }, fresh: 900, think: 300, thinkSecs: 9 }),
    toolTiming({ name: 'Bash', start: 71_000, end: 101_000 }),
    replyTiming({ kind: 'call', what: 'listing the cases', start: 101_000, end: 111_000, timings: { prompt_n: 2000, prompt_ms: 1000, predicted_ms: 9000 } }),
    replyTiming({ start: 111_000, end: 211_000, firstToken: 113_000, cut: 'thought past the cap', think: 4100, thinkSecs: 98 }),
  ];
  const t = timeOf(entries, 220);
  expect(t).toMatchObject({ secs: 220, replies: 3, calls: 1, tools: 2, read: 47, write: 129, think: 107, wait: 2, before: 2, callSecs: 10, toolSecs: 30.5, byTool: { Bash: 30, Read: 0.5 }, cut: 1, cutSecs: 100, app: 9.5 });
  expect(Object.keys(t.byTool)).toEqual(['Bash', 'Read']); // the longest first
  expect(timeLine(t)).toBe('time 220 s: writing 129 s (thinking 107 s), reading 47 s, before the first word 2 s (not split), waiting 2 s, tools 31 s (Bash 30 s, Read 1 s), the app 10 s; 1 side call 10 s of it; 1 reply cut short and asked again (100 s)');
  expect(slowReads(entries)).toEqual(['reply 2: 38 s reading, 900 new tokens of 40,000', 'reply 1: 8 s reading, 9,000 new tokens of 9,000']);
  expect(timelineFrom(entries.slice(0, 2), 0)).toEqual([{ at: 0, kind: 'reply', secs: 10, out: 0, fresh: 9000, prompt: 9000, load: 0, read: 8, write: 2, wait: 0 }, { at: 10, kind: 'tool', name: 'Read', secs: 0.5 }]);
});

test('on a service: each reply with its reading and writing, each tool, and a reply cut short; new tokens counted from the last reply', async () => {
  const svc = await onService();
  try {
    const a = new Agent({ url: svc.url, model: remote(), cwd: dir, system: 'x', memory: false, flows: false, mode: 'bypass', way: 'model', hooks: [], thinking: false, ctx: 32768 });
    const timing = [];
    a.on('timing', (e) => timing.push(e));
    expect(await a.send('fix the typo in notes.txt')).toBe('done');
    expect(readFileSync(join(dir, 'notes.txt'), 'utf8')).toBe('Hello world\n');
    expect(timing.map((e) => e.kind === 'tool' ? `${e.kind} ${e.name}` : e.kind)).toEqual(['reply', 'tool Read', 'reply', 'tool Edit', 'reply']);
    // The stand-in says it read for 1 s and wrote for 1 s every time.
    for (const r of timing.filter((e) => e.kind === 'reply')) expect(r).toMatchObject({ read: 1, write: 1, load: 0, prompt: 900 });
    const [first, second] = timing.filter((e) => e.kind === 'reply');
    expect(first.fresh).toBeGreaterThan(second.fresh); // the instructions and the request, then only the Read's result
    expect(second.fresh).toBeGreaterThan(0);
  } finally { dropEndpoint?.(svc.url); await svc.close(); }
  // Thinking past the cap: the reply cut short is one entry of its own, then the one asked for again.
  const over = await onService({ overthink: 60_000 });
  try {
    const a = new Agent({ url: over.url, model: remote({ thinkingBudget: 300 }), cwd: dir, system: 'x', memory: false, flows: false, mode: 'bypass', way: 'model', hooks: [], thinking: true, ctx: 65536 });
    const timing = [];
    a.on('timing', (e) => timing.push(e));
    await a.send('hello');
    expect(timing.map((e) => e.cut ?? 'whole')).toEqual(['thought past the cap', 'whole']);
    expect(timing[0].think).toBeGreaterThan(300);
    expect(timing[0].read).toBeUndefined(); // no numbers came for it
  } finally { dropEndpoint?.(over.url); await over.close(); }
});

test('a side call says what it was for and what it spent', async () => {
  const svc = await onService();
  const got = [];
  const timer = (e) => got.push(e);
  timers.add(timer);
  try {
    await complete({ url: svc.url, model: remote(), system: 'You answer.', user: 'hi', what: 'listing the cases' });
    await complete({ url: svc.url, model: remote(), system: 'You answer.', user: 'hi' });
  } finally { timers.delete(timer); dropEndpoint?.(svc.url); await svc.close(); }
  expect(got.map((e) => [e.kind, e.what, e.read, e.write])).toEqual([['call', 'listing the cases', 1, 1], ['call', 'a side call', 1, 1]]);
});

test('coding -p and the bench: the run gives its timeline from its start and the sums', async () => {
  const svc = await onService();
  try {
    const r = await runHeadless({ prompt: 'fix the typo in notes.txt', cwd: dir, url: svc.url, model: remote(), thinking: false, flows: false, autoApprove: true, way: 'model', lean: true });
    expect(r.reason).toBe('done');
    expect(r.timeline.map((e) => e.kind)).toEqual(['reply', 'tool', 'reply', 'tool', 'reply']);
    expect(r.timeline.every((e, i) => e.at >= 0 && (i === 0 || e.at >= r.timeline[i - 1].at) && e.start === undefined)).toBe(true);
    expect(r.time).toMatchObject({ replies: 3, tools: 2, read: 3, write: 3 });
    expect(Object.keys(r.time.byTool).sort()).toEqual(['Edit', 'Read']);
    expect(r.time.app).toBeGreaterThanOrEqual(0);
  } finally { dropEndpoint?.(svc.url); await svc.close(); }
});
