// A service that says "too many requests" (/remote): the window waits and asks again instead of
// stopping, every window waits the time the service gave (one shared file), the busy answer is
// never mistaken for a conversation that is too long, and after the last try it says so plainly.
import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
// Never the real home: the shared file goes in a throwaway one (read at each use).
process.env.AGENTIC_HOME = mkdtempSync(join(tmpdir(), 'agentic-busy-home-'));
const { isBusy, retryAfterOf, retryAfterHeader, sharedUntil, markBusy, withBusyRetry } = await import('../src/agent/busy.mjs');
const { streamChat } = await import('../src/agent/client.mjs');
const { setEndpoint, dropEndpoint } = await import('../../models/index.mjs');

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'agentic-busy-')), 'remote-busy.json');
const collect = async (gen) => { const out = []; for await (const ev of gen) out.push(ev); return out; };

test('busy: a 429, 503 or 529 or its words is busy; a model with no room, a wrong key or a long conversation is not', () => {
  expect(isBusy({ status: 429, message: 'x' })).toBe(true);
  expect(isBusy({ status: 503, message: 'x' })).toBe(true);
  expect(isBusy({ status: 529, message: 'x' })).toBe(true);
  expect(isBusy({ message: 'Rate limit exceeded: free-models-per-min' })).toBe(true);
  expect(isBusy({ status: 503, message: 'the service has no room to load qwen (out of GPU memory)' })).toBe(false);
  expect(isBusy({ status: 401, message: 'did not accept the API key' })).toBe(false);
  expect(isBusy({ status: 400, message: 'the conversation exceeds the model\'s context window' })).toBe(false);
});

test('busy: the wait the service asked for, from its header or its words', () => {
  expect(retryAfterHeader('20')).toBe(20);
  expect(retryAfterHeader(new Date(Date.now() + 30_000).toUTCString())).toBeGreaterThan(25);
  expect(retryAfterHeader(null)).toBe(null);
  expect(retryAfterOf({ message: 'Rate limit exceeded. Try again in 20 seconds.' })).toBe(20);
  expect(retryAfterOf({ message: 'please retry after 1500ms' })).toBe(1.5);
  expect(retryAfterOf({ message: 'try again in 2 minutes' })).toBe(120);
  expect(retryAfterOf({ retryAfter: 7, message: 'try again in 20 seconds' })).toBe(7);
});

test('busy: the shared file — a later time wins, old entries go, a past time is no wait', () => {
  const file = tmpFile();
  const now = Date.now();
  markBusy('svc', now + 5000, { file });
  markBusy('svc', now + 2000, { file }); // earlier: the later time stays
  markBusy('old', now - 10, { file, now: now - 20 });
  expect(sharedUntil('svc', { file })).toBe(now + 5000);
  expect(sharedUntil('other', { file })).toBe(0);
  markBusy('svc2', now + 100, { file });
  expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')))).not.toContain('old');
});

test('busy: asks again after a wait, and the second window waits the same time before it asks', async () => {
  const file = tmpFile();
  let calls = 0;
  const make = () => (async function* () { calls++; if (calls < 3) throw Object.assign(new Error('429'), { status: 429 }); yield { type: 'text', text: 'ok' }; })();
  const evs = await collect(withBusyRetry(make, { key: 'svc', file, waits: [0.05, 0.05, 0.05, 0.05] }));
  expect(evs.filter((e) => e.type === 'busy').map((e) => [e.next, e.of, e.shared])).toEqual([[2, 5, false], [3, 5, false]]);
  expect(evs.at(-1)).toEqual({ type: 'text', text: 'ok' });
  // Another window, told the service is busy for 300 ms: it waits first, then asks once.
  markBusy('svc', Date.now() + 300, { file });
  let asked = null;
  const t0 = Date.now();
  const other = await collect(withBusyRetry(() => (async function* () { asked = Date.now(); yield { type: 'text', text: 'hi' }; })(), { key: 'svc', file }));
  expect(other[0]).toMatchObject({ type: 'busy', shared: true, next: 1 });
  expect(asked - t0).toBeGreaterThanOrEqual(250);
});

test('busy: after the last try it stops with plain words, marked busy; a reply already begun is never asked again', async () => {
  const file = tmpFile();
  const always = () => (async function* () { throw Object.assign(new Error('429'), { status: 429 }); })();
  let err = null;
  try { await collect(withBusyRetry(always, { key: 's', file, waits: [0.01, 0.01, 0.01, 0.01] })); } catch (e) { err = e; }
  expect(err.busy).toBe(true);
  expect(err.message).toContain('The service stayed busy (5 tries');
  expect(err.message).toContain('Nothing was lost');
  let n = 0;
  const midway = () => (async function* () { n++; yield { type: 'text', text: 'half' }; throw Object.assign(new Error('429'), { status: 429 }); })();
  err = null;
  try { await collect(withBusyRetry(midway, { key: 's2', file, waits: [0.01] })); } catch (e) { err = e; }
  expect(n).toBe(1);
  expect(err.status).toBe(429);
  // A service asking for longer than two minutes (a daily quota) is not waited for.
  const quota = () => (async function* () { throw Object.assign(new Error('429'), { status: 429, retryAfter: 3600 }); })();
  err = null;
  try { await collect(withBusyRetry(quota, { key: 's3', file })); } catch (e) { err = e; }
  expect(err.message).toContain('asked to wait 60 minutes');
});

test('busy: streamChat on a remote OpenAI-style service waits through two 429s (its Retry-After) and gives the answer', async () => {
  let n = 0;
  const server = createServer(async (req, res) => {
    for await (const _ of req) {}
    n++;
    if (n <= 2) { res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' }); res.end('{"error":{"message":"Rate limit exceeded: too many requests"}}'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  setEndpoint(url, { remote: true, kind: 'openai', model: 'm', label: `busy-test-${Date.now()}` });
  process.env.AGENTIC_BUSY_WAITS = '0.05,0.05,0.05,0.05';
  try {
    const evs = await collect(streamChat({ url, messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 }));
    expect(evs.filter((e) => e.type === 'busy')).toHaveLength(2);
    expect(evs.find((e) => e.type === 'text')?.text).toBe('hello');
    expect(n).toBe(3);
    expect(readFileSync(join(process.env.AGENTIC_HOME, 'remote-busy.json'), 'utf8')).toContain('busy-test-');
  } finally { delete process.env.AGENTIC_BUSY_WAITS; dropEndpoint(url); server.close(); }
}, 120_000);
