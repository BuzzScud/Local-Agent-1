// /btw on a remote (3 Oct 2026, the owner's picks): who answers a side question on a service (the
// lowest model that is ready, else the main one), how a service that never loads a second model is
// met, the Claude API's lowest model, and the question going out as a request of its own.
import { test, expect } from 'bun:test';
import { fakeOllama } from './fake-ollama.mjs';
import { startFakeAnthropic } from './fake-anthropic.mjs';

const { setEndpoint, dropEndpoint, ollamaCatalog } = await import('../../models/index.mjs');
const { askAside, sideChoice, lowModels, lowestClaude, SIDE_COPY } = await import('../src/agent/btw.mjs');

const M = (id, gb, params, more = {}) => ({ id, bytes: gb * 1e9, params, chat: true, tools: true, vision: false, embedding: false, loaded: false, ...more });
const SERVICE = [
  M('tiny-fn:latest', 0.3, '268.10M'), M('embed:latest', 0.6, '307.58M', { chat: false, embedding: true, tools: false }),
  M('small:3b', 2.0, '3.2B'), M('sees:7b', 4.7, '7B', { vision: true, tools: false }), M('mid:8b', 4.9, '8.0B'),
  M('main:35b', 23.9, '36.0B', { loaded: true }), M('big:80b', 51.7, '79.7B'),
];

test('the models that can take a side question: they chat, are no embedder or picture reader, a billion weights at least, smallest first', () => {
  expect(lowModels(SERVICE, 'main:35b').map((m) => m.id)).toEqual(['small:3b', 'mid:8b', 'big:80b']);
});

test('who answers on a service: a smaller model that is ready; else the lowest, tried once a session; else the main one', () => {
  // Nothing smaller is loaded, not tried yet: the lowest is tried.
  expect(sideChoice({ models: SERVICE, main: 'main:35b' })).toEqual({ model: 'small:3b', why: 'try' });
  // It would not load: the main one from then on.
  expect(sideChoice({ models: SERVICE, main: 'main:35b', tried: false })).toEqual({ model: null, why: 'main' });
  // A smaller one is loaded: it answers, whatever was tried (the smallest of the loaded).
  const up = SERVICE.map((m) => (m.id === 'mid:8b' ? { ...m, loaded: true } : m));
  expect(sideChoice({ models: up, main: 'main:35b', tried: false })).toEqual({ model: 'mid:8b', why: 'ready' });
  // The model /subagents names for side jobs comes before the lowest; loaded, it is ready.
  expect(sideChoice({ models: SERVICE, main: 'main:35b', picked: 'mid:8b' })).toEqual({ model: 'mid:8b', why: 'try' });
  expect(sideChoice({ models: up, main: 'main:35b', picked: 'mid:8b' })).toEqual({ model: 'mid:8b', why: 'ready' });
  // Never a bigger model than the main one, and the main one is already the lowest: itself.
  expect(sideChoice({ models: SERVICE, main: 'small:3b' })).toEqual({ model: null, why: 'main' });
  expect(sideChoice({ models: [], main: 'main:35b' })).toEqual({ model: null, why: 'main' });
});

test('the Claude API: its cheapest model, or none when the main one is it', () => {
  expect(lowestClaude('claude-opus-5-5')).toBe('claude-haiku-4-5');
  expect(lowestClaude('claude-haiku-4-5')).toBe(null);
});

// An agent as askAside needs it: the conversation, its memory, whether it is busy.
const agentOn = (url, more = {}) => ({
  url, model: { id: 'remote', name: 'coder:30b', sampling: {} }, ctx: 131072, ctxUsed: 90_000, busy: false, thinking: false, todos: [],
  messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'fix the shipping test' }, { role: 'assistant', content: 'The limit is 50 in src/shipping.mjs.' }],
  ...more,
});
const sides = (svc) => svc.chats().filter((b) => /asked with \/btw/.test(String(b.messages?.[0]?.content ?? '')));

test('on an Ollama service: the lowest model is tried once and answers; then it is ready and is asked at the context it is loaded at', async () => {
  const svc = await fakeOllama();
  setEndpoint(svc.url, { remote: true, kind: 'openai', ollama: true, model: 'coder:30b', numCtx: 131072, keepAlive: -1, free: true });
  try {
    const memo = {};
    const notes = [];
    const remote = { kind: 'openai', ollama: true, main: 'coder:30b', mainName: 'coder:30b', models: [], picked: null, memo };
    const r = await askAside({ agent: agentOn(svc.url), question: 'what did you find?', remote, onNote: (t) => notes.push(t) });
    expect(r).toMatchObject({ text: 'Side answer by tiny:3b.', who: 'tiny:3b' });
    expect(notes).toEqual(['Asking tiny:3b, the lowest model there…']);
    expect(memo.tried).toBe(true);
    const first = sides(svc)[0];
    expect(first.model).toBe('tiny:3b');
    expect(first.keep_alive).toBe('30m'); // tried cold: kept half an hour, not for ever
    expect(first.options.num_ctx).toBe(32768);
    expect(first.tools).toBeUndefined(); // one question, one answer, no tools
    // The copy is the question's own: the conversation's 90,000 tokens in use did not leave it "no room".
    expect(String(first.messages[1].content)).toContain('The limit is 50 in src/shipping.mjs.');
    expect(SIDE_COPY).toBe(12_000);
    // Again: it is loaded now, so it is simply asked, with no note and its keep-alive left alone.
    const again = await askAside({ agent: agentOn(svc.url), question: 'and now?', remote: { ...remote, models: (await ollamaCatalog({ url: svc.url })).models }, onNote: (t) => notes.push(t) });
    expect(again.who).toBe('tiny:3b');
    expect(notes).toHaveLength(1);
    expect(sides(svc)[1].keep_alive).toBeUndefined();
    expect(sides(svc)[1].options.num_ctx).toBe(svc.loaded.get('tiny:3b'));
  } finally { dropEndpoint(svc.url); await svc.close(); }
});

test('on a service that never loads a second model: one short try, said, then the main model answers, and it is not tried again; the main model busy: the panel is told what it waits for', async () => {
  const svc = await fakeOllama({ stuck: ['tiny:3b', 'words:7b', 'jsontext:14b'], sideDelay: 700 });
  setEndpoint(svc.url, { remote: true, kind: 'openai', ollama: true, model: 'coder:30b', numCtx: 131072, keepAlive: -1, free: true });
  try {
    const memo = {};
    const notes = [];
    const remote = { kind: 'openai', ollama: true, main: 'coder:30b', mainName: 'coder:30b', models: [], picked: null, memo };
    const t0 = Date.now();
    const r = await askAside({ agent: agentOn(svc.url), question: 'what did you find?', remote, onNote: (t) => notes.push(t), tryMs: 500 });
    expect(r).toMatchObject({ text: 'Side answer by coder:30b.', who: 'coder:30b' });
    expect(notes).toEqual(['Asking tiny:3b, the lowest model there…', 'tiny:3b is not ready on the service; coder:30b answers…']);
    expect(memo.tried).toBe(false);
    expect(Date.now() - t0).toBeLessThan(4000);
    // The main model was asked as it is loaded: its own context, no other keep-alive.
    const toMain = sides(svc).find((b) => b.model === 'coder:30b');
    expect(toMain.options.num_ctx).toBe(131072);
    expect(toMain.keep_alive).toBe(-1);
    // Again in the same session: straight to the main model. Busy with a reply, it answers when
    // that ends, and the panel is told so meanwhile.
    const before = sides(svc).filter((b) => b.model === 'tiny:3b').length;
    const busy = await askAside({ agent: agentOn(svc.url, { busy: true }), question: 'and now?', remote, onNote: (t) => notes.push(t), tryMs: 500, waitNoteMs: 200 });
    expect(busy.who).toBe('coder:30b');
    expect(sides(svc).filter((b) => b.model === 'tiny:3b').length).toBe(before);
    expect(notes.at(-1)).toBe('coder:30b is busy with its reply: this answers when that ends…');
  } finally { dropEndpoint(svc.url); await svc.close(); }
}, 20_000);

test('on the Claude API: the cheapest model answers, beside the main one', async () => {
  const fake = await startFakeAnthropic([{ text: 'A side answer.' }, { text: 'From the main one.' }]);
  setEndpoint(fake.url, { remote: true, kind: 'claude', key: fake.key, model: 'claude-opus-5-5', label: 'claude' });
  try {
    const agent = agentOn(fake.url, { model: { id: 'remote', name: 'Opus 5.5', sampling: {} }, ctx: 200_000, busy: true });
    const notes = [];
    const r = await askAside({ agent, question: 'what did you find?', remote: { kind: 'claude', ollama: false, main: 'claude-opus-5-5', mainName: 'Opus 5.5', memo: {} }, onNote: (t) => notes.push(t), waitNoteMs: 50 });
    expect(r).toMatchObject({ text: 'A side answer.', who: 'Haiku 4.5' });
    expect(fake.seen.at(-1).body.model).toBe('claude-haiku-4-5');
    expect(notes).toEqual([]); // the API answers both at once: nothing to wait for
    // The main model is Haiku already: it answers itself.
    setEndpoint(fake.url, { remote: true, kind: 'claude', key: fake.key, model: 'claude-haiku-4-5', label: 'claude' });
    const own = await askAside({ agent: { ...agent, busy: false }, question: 'and now?', remote: { kind: 'claude', ollama: false, main: 'claude-haiku-4-5', mainName: 'Haiku 4.5', memo: {} } });
    expect(own.who).toBe('Haiku 4.5');
    expect(fake.seen.at(-1).body.model).toBe('claude-haiku-4-5');
  } finally { dropEndpoint(fake.url); await fake.close(); }
});
