// What a window on hearth shows and keeps while hearth's 27b works (21 Nov 2026, the owner watching a finance dashboard
// asked of hearth: "why are we only seeing thinking?", then "fix the 3"). It planned for 5 minutes, passed the thinking
// cap and every word of the plan was thrown away; the window said "Writing… 16 words" while it wrote the file; after 5
// quiet minutes the request was stopped mid-file. Their picks: the plan kept for the whole request, 10 minutes of quiet
// on hearth, a big file added to the end in parts, hearth only.
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-hearth-see-home-'));

const { Agent } = await import('../src/agent/agent.mjs');
const { watched } = await import('../src/agent/client.mjs');
const { prepare, parseArgs, HEARTH_WRITE_DEF } = await import('../src/agent/tools.mjs');
const { MODELS, DEFAULT_MODEL, setEndpoint, dropEndpoint } = await import('../../models/index.mjs');
const { fakeOllama } = await import('./fake-ollama.mjs');

const local = MODELS[DEFAULT_MODEL];
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agentic-hearth-see-')); });

const drain = async (it) => { const out = []; for await (const e of it) out.push(e); return out; };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// A reply that starts, goes quiet for `quietMs` (a call being written), then ends.
const quietReply = (quietMs) => async function* (signal) {
  yield { type: 'text', text: 'Let me write the file.' };
  await new Promise((ok, no) => { const t = setTimeout(ok, quietMs); signal.addEventListener('abort', () => { clearTimeout(t); no(signal.reason); }, { once: true }); });
  yield { type: 'tool', index: 0, name: 'Write', args: '{}' };
  yield { type: 'done' };
};

const saved = {};
beforeEach(() => { for (const k of ['AGENTIC_QUIET_SECS', 'AGENTIC_WHOLE_QUIET_SECS']) saved[k] = process.env[k]; });
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

test('on hearth a quiet stretch after the answer began waits the longer limit; elsewhere it is a stall', async () => {
  process.env.AGENTIC_QUIET_SECS = '0.2';
  process.env.AGENTIC_WHOLE_QUIET_SECS = '3';
  // hearth (whole): 600 ms of quiet while the call is written is not a stall.
  const evs = await drain(watched(quietReply(600), null, 'hearth', { whole: true }));
  expect(evs.map((e) => e.type)).toEqual(['text', 'tool', 'done']);
  // Any other service: the same quiet stops it, as before.
  const err = await drain(watched(quietReply(600), null, 'The model server')).catch((e) => e);
  expect(err.stalled).toBe(true);
  expect(err.message).toMatch(/The model server sent nothing for 0 s, so the request was stopped/);
  // hearth past its own limit still stops.
  process.env.AGENTIC_WHOLE_QUIET_SECS = '0.3';
  const late = await drain(watched(quietReply(800), null, 'hearth', { whole: true })).catch((e) => e);
  expect(late.stalled).toBe(true);
});

test('the quiet limit on hearth is 10 minutes by default', async () => {
  delete process.env.AGENTIC_WHOLE_QUIET_SECS;
  const src = readFileSync(new URL('../src/agent/client.mjs', import.meta.url), 'utf8');
  expect(src).toContain("secsEnv('AGENTIC_WHOLE_QUIET_SECS', 600)");
  expect(src).toContain('{ whole: Boolean(ep?.hearth) }');
});

// The plan, kept: the stand-in thinks past the cap when asked to think.
test('on hearth, a reply that thinks past the cap keeps its plan for the rest of the request and acts with thinking off', async () => {
  const svc = await fakeOllama({ overthink: 60_000 });
  setEndpoint(svc.url, { remote: true, kind: 'openai', ollama: true, hearth: true, thinks: true, model: 'coder:30b', numCtx: 65536, keepAlive: -1, free: true });
  try {
    const a = new Agent({ url: svc.url, model: { ...local, thinkingBudget: 300, remote: { model: 'coder:30b' } }, cwd: dir, system: 'x', memory: false, flows: false, mode: 'bypass', way: 'model', hooks: [], thinking: true, ctx: 65536 });
    const notes = [];
    a.on('note', (e) => notes.push(e.text));
    expect(await a.send('hello')).toBe('done');
    const chats = svc.seen.filter((x) => x.path === '/api/chat').map((x) => x.body);
    expect(chats.map((b) => Boolean(b.think))).toEqual([true, false]);
    // The second ask carries what it had planned, on the end of the last message (nothing before it read again).
    const last = String(chats[1].messages.at(-1).content);
    expect(last).toContain('Your thinking went past its limit');
    expect(last).toContain('Part 0:');
    expect(String(chats[1].messages.at(-1).content).startsWith('hello')).toBe(true);
    expect(notes.some((t) => /its plan so far is kept and handed back, and it acts on it with thinking off for the rest of this request/.test(t))).toBe(true);
    // It stays: the next step of the same request still has it, and still does not think.
    await a.generate();
    const third = svc.seen.filter((x) => x.path === '/api/chat').at(-1).body;
    expect(third.think).toBeFalsy();
    expect(third.messages.some((m) => String(m.content).includes('Your thinking went past its limit'))).toBe(true);
  } finally { dropEndpoint?.(svc.url); await svc.close?.(); }
});

test("the screen's speed for a call still being written is the usual one, never a one-token reply's", async () => {
  const { usualSpeed } = await import('../src/agent/agent-model.mjs');
  expect(usualSpeed([18.2, 17.9, 1_000_000, 18.6])).toBe(18.2);
  expect(usualSpeed([18, 0, 1e6])).toBe(18);
  expect(usualSpeed([])).toBeNull();
  expect(usualSpeed(undefined)).toBeNull();
});

test('a very long plan keeps its start and its newest part', () => {
  const a = new Agent({ url: 'http://127.0.0.1:9', model: local, cwd: dir, system: 'x', memory: false, flows: false, hooks: [] });
  a.messages.push({ role: 'user', content: 'make the page' });
  const plan = `START ${'a'.repeat(30_000)} END`;
  expect(a.keepPlan(plan)).toBe(true);
  const said = a.messages.at(-1).content;
  expect(said).toContain('START');
  expect(said).toContain('END');
  expect(said.length).toBeLessThan(17_000);
  // Nothing to keep, or nowhere to put it.
  expect(a.keepPlan('   ')).toBe(false);
  a.messages.push({ role: 'assistant', content: 'ok' });
  expect(a.keepPlan('a plan')).toBe(false);
});

test('Write adds to the end of a file it wrote or read; never one it has not seen', () => {
  writeFileSync(join(dir, 'page.html'), '<!doctype html>\n<head>\n');
  const seen = { cwd: dir, rulesSet: 'remote', rewrite: () => true };
  const r = prepare('Write', { path: 'page.html', content: '<body>\n<h1>Budget</h1>\n', append: true }, seen);
  expect(r.error).toBeUndefined();
  expect(r.after).toBe('<!doctype html>\n<head>\n<body>\n<h1>Budget</h1>\n');
  expect(r.appended).toBe(true);
  expect(r.created).toBe(false);
  // A part with no line break before it starts on its own line.
  writeFileSync(join(dir, 'b.html'), '<div>');
  expect(prepare('Write', { path: 'b.html', content: '</div>\n', append: 'true' }, seen).after).toBe('<div>\n</div>\n');
  // Unfinished JavaScript in a part is not refused (the file is whole only after its last part).
  writeFileSync(join(dir, 'app.mjs'), 'export function f() {\n');
  expect(prepare('Write', { path: 'app.mjs', content: '  return 1;\n', append: true }, seen).error).toBeUndefined();
  // Not written or read in this conversation: read it first.
  const unseen = prepare('Write', { path: 'page.html', content: 'x', append: true }, { ...seen, rewrite: () => false });
  expect(unseen.error).toMatch(/was not written or read in this conversation. Read it first, then add to its end/);
  // No file yet: the first part makes it.
  const first = prepare('Write', { path: 'new.html', content: '<p>one</p>\n', append: true }, seen);
  expect(first).toMatchObject({ created: true, after: '<p>one</p>\n' });
});

test('append survives the argument cleanup', () => {
  expect(parseArgs('Write', JSON.stringify({ path: 'a.html', content: 'x', append: true }), 'model').args).toMatchObject({ path: 'a.html', content: 'x', append: true });
  expect(parseArgs('Write', JSON.stringify({ path: 'a.html', content: 'x' }), 'model').args.append).toBeUndefined();
});

test("hearth's Write offers append and says to write a big file in parts; every other service's Write is as it was", () => {
  setEndpoint('http://127.0.0.1:59101', { remote: true, kind: 'openai', ollama: true, hearth: true, model: 'hearth', numCtx: 131072, free: true });
  setEndpoint('http://127.0.0.1:59102', { remote: true, kind: 'openai', ollama: true, model: 'coder:30b', numCtx: 65536, free: true });
  try {
    const writeOf = (url) => new Agent({ url, model: { ...local, remote: { model: 'x' } }, cwd: dir, system: 'x', memory: false, flows: false, hooks: [] }).tools().find((t) => t.function.name === 'Write').function;
    const onHearth = writeOf('http://127.0.0.1:59101');
    expect(onHearth).toBe(HEARTH_WRITE_DEF);
    expect(onHearth.parameters.properties.append.type).toBe('boolean');
    expect(onHearth.description).toMatch(/write a file over about 150 lines in parts/);
    const elsewhere = writeOf('http://127.0.0.1:59102');
    expect(elsewhere.parameters.properties.append).toBeUndefined();
    expect(elsewhere.description).toMatch(/^Create a new file\. To change an existing file use Edit instead/);
  } finally { dropEndpoint?.('http://127.0.0.1:59101'); dropEndpoint?.('http://127.0.0.1:59102'); }
});

test('a Write that adds a part runs and says how long the file is now', async () => {
  const svc = await fakeOllama();
  setEndpoint(svc.url, { remote: true, kind: 'openai', ollama: true, hearth: true, model: 'coder:30b', numCtx: 65536, free: true });
  try {
    const a = new Agent({ url: svc.url, model: { ...local, remote: { model: 'coder:30b' } }, cwd: dir, system: 'x', memory: false, flows: false, mode: 'bypass', way: 'model', hooks: [], ctx: 65536 });
    const one = await a.runTool({ id: 'w1', name: 'Write', args: JSON.stringify({ path: 'page.html', content: '<!doctype html>\n<head>\n' }) });
    expect(one.text).toMatch(/^Created page\.html/);
    const two = await a.runTool({ id: 'w2', name: 'Write', args: JSON.stringify({ path: 'page.html', content: '</head>\n<body>Budget</body>\n', append: true }) });
    expect(two.error).toBeFalsy();
    expect(two.text).toMatch(/^Added to the end of page\.html \(\+2 −0 lines; 5 lines now\)/);
    expect(readFileSync(join(dir, 'page.html'), 'utf8')).toBe('<!doctype html>\n<head>\n</head>\n<body>Budget</body>\n');
  } finally { dropEndpoint?.(svc.url); await svc.close?.(); }
});
