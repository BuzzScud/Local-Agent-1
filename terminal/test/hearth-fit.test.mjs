// Agentic Coder on hearth's API, made to fit (21 Nov 2026, the hearth fit audit: a `coding -p` run did its work, then sent
// one more call that waited 940 s in the door's line and never ended or printed anything). On a stand-in door: a wait in
// the line is no word (the request is still stopped at its first-word limit), the app's own checks of a turn have a limit of
// their own and go to hearth's review size, and a run held on one server (hearth@poseidon) keeps every job there.
import { test, expect, afterAll } from 'bun:test';
import { createServer } from 'node:http';
import { connectRemote, endpointOf, dropEndpoint, setEndpoint, pickHearthModel, DEFAULT_REMOTE, probe, refusalOf } from '../../models/index.mjs';
import { watched, streamChat } from '../src/agent/client.mjs';
import { Agent } from '../src/agent/agent.mjs';
import { checkCall, ChecksPart } from '../src/agent/agent-checks.mjs';
import { reviewThink, reviewChange } from '../src/agent/helper-models.mjs';
import { ownSteps } from '../src/agent/second-look.mjs';

const KEY = 'hk_test-hearth-fit-key-0123456789abcdef';
const drain = async (it) => { const out = []; for await (const e of it) out.push(e); return out; };

// A door that lists the sizes and answers no chat: each waits in its line for ever, saying why every 40 ms.
function door() {
  const seen = [];
  const s = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const json = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.headers.authorization !== `Bearer ${KEY}`) return json(401, { error: 'no' });
    const p = req.url.replace(/^\/door/, '');
    const names = ['hearth', 'hearth-2b', 'hearth-4b', 'hearth-9b'];
    if (p === '/api/version') return json(200, { version: '0.40.0' });
    if (p === '/v1/models') return json(200, { object: 'list', data: names.map((id) => ({ id, object: 'model' })) });
    if (p === '/api/tags') return json(200, { models: names.map((name) => ({ name, model: name, details: { family: '', parameter_size: name === 'hearth' ? '27B' : name.slice(7).toUpperCase() } })) });
    if (p === '/api/ps') return json(200, { models: names.map((name) => ({ name, model: name, context_length: name === 'hearth' ? 131072 : 32768 })) });
    if (p === '/api/show') return json(200, { details: {}, model_info: { 'general.context_length': 131072 }, capabilities: ['completion', 'tools', 'thinking'] });
    if (p === '/api/chat') {
      seen.push({ body: JSON.parse(b || '{}'), side: req.headers['x-hearth-job'] ?? null });
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      const ping = setInterval(() => res.write(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: false, hearth: { waiting: 'Poseidon is busy with a staff chat', ahead: 2 } })}\n`), 40);
      req.on('close', () => clearInterval(ping));
      res.on('close', () => clearInterval(ping));
      return;
    }
    json(404, { error: 'Not found.' });
  });
  return new Promise((ok) => s.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${s.address().port}/door`, seen, close: () => new Promise((d) => { s.closeAllConnections?.(); s.close(d); }) })));
}
const open = [];
afterAll(async () => { for (const d of open) { await d.close(); dropEndpoint(d.base); } });

test('a wait in the line is no word: the request is still stopped at its first-word limit', async () => {
  const was = { f: process.env.AGENTIC_FIRST_WORD_SECS, q: process.env.AGENTIC_QUIET_SECS };
  process.env.AGENTIC_FIRST_WORD_SECS = '0.4';
  process.env.AGENTIC_QUIET_SECS = '0.15';
  try {
    // pings every 50 ms, never a word: before, each ping put the quiet limit back and it never ended
    const pings = (sig) => (async function* () { while (!sig.aborted) { await Bun.sleep(50); yield { type: 'queued', why: 'busy', ahead: 1 }; } throw sig.reason; })();
    const t0 = Date.now();
    const err = await drain(watched(pings, null, 'hearth')).catch((e) => e);
    expect(err?.stalled).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(380);
    expect(Date.now() - t0).toBeLessThan(1500);
    // once a word has come, a quiet stretch is a stall as before
    const words = (sig) => (async function* () { yield { type: 'text', text: 'a' }; await Bun.sleep(400); if (sig.aborted) throw sig.reason; yield { type: 'done' }; })();
    const e2 = await drain(watched(words, null, 'hearth')).catch((e) => e);
    expect(e2?.stalled).toBe(true);
  } finally {
    for (const [k, v] of [['AGENTIC_FIRST_WORD_SECS', was.f], ['AGENTIC_QUIET_SECS', was.q]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('a check of a turn on a remote has a limit of its own; on this Mac it is as it was', async () => {
  const was = process.env.AGENTIC_CHECK_SECS;
  process.env.AGENTIC_CHECK_SECS = '0.1';
  try {
    const url = 'http://127.0.0.1:9/fit-remote';
    setEndpoint(url, { kind: 'openai', ollama: true, model: 'x' });
    const c = checkCall({ url, onHearth: () => ({ model: 'hearth-9b' }) }, 'review', null);
    expect(c.use).toEqual({ model: 'hearth-9b' });
    await Bun.sleep(180);
    expect([c.signal.aborted, c.timedOut()]).toEqual([true, true]);
    c.done();
    dropEndpoint(url);
    const outer = new AbortController();
    const here = checkCall({ url: 'http://127.0.0.1:17600', onHearth: () => ({ model: 'hearth-9b' }) }, 'review', outer.signal);
    expect([here.use, here.signal === outer.signal, here.timedOut()]).toEqual([undefined, true, false]);
  } finally { if (was === undefined) delete process.env.AGENTIC_CHECK_SECS; else process.env.AGENTIC_CHECK_SECS = was; }
});

test('on hearth the checks go to the review size as side jobs, and one that waits in the line is skipped with a line', async () => {
  const d = await door();
  open.push(d);
  const c = await connectRemote({ ...DEFAULT_REMOTE, source: 'hearth', kind: 'openai', connect: 'http', address: `${d.base}/v1`, model: 'hearth', key: true, keyEnd: 'cdef', keyId: 'hearth' }, { key: KEY });
  const was = process.env.AGENTIC_CHECK_SECS;
  process.env.AGENTIC_CHECK_SECS = '0.5';
  try {
    expect(endpointOf(c.url)).toMatchObject({ hearth: true, hearthSizes: ['hearth-2b', 'hearth-4b', 'hearth-9b'] });
    const notes = [];
    const me = { url: c.url, model: { remote: { model: 'hearth' } }, slots: null, isHelper: false, router: null, conversation: 'c1', emit: (t, e) => { if (t === 'note') notes.push(e.text); },
      messages: [{ role: 'user', content: 'Make applyDiscount never go below 0.' }], turn: { diffs: '+ return Math.max(0, x);', request: 'Make applyDiscount never go below 0.' } };
    for (const k of ['hearthUse', 'onHearth']) me[k] = Agent.prototype[k].bind(me);
    for (const k of ['verifyDone', 'listCases']) me[k] = ChecksPart.prototype[k].bind(me);
    const t0 = Date.now();
    const [done, listed] = await Promise.all([me.verifyDone('Done.', null), me.listCases(null)]);
    expect(Date.now() - t0).toBeLessThan(2500);
    expect([done, listed]).toEqual([null, []]);
    expect(notes).toEqual(expect.arrayContaining([expect.stringContaining('Checking it did everything: no answer in 0.5 s'), expect.stringContaining('Listing the cases: no answer in 0.5 s')]));
    expect(d.seen.map((r) => [r.body.model, r.side])).toEqual([['hearth-9b,hearth,hearth-4b', 'side'], ['hearth-9b,hearth,hearth-4b', 'side']]);
  } finally { c.stop(); if (was === undefined) delete process.env.AGENTIC_CHECK_SECS; else process.env.AGENTIC_CHECK_SECS = was; }
});

test('a run held on one server (hearth@poseidon) keeps every helper job on that model there, each a side job', () => {
  const url = 'http://127.0.0.1:9/fit-held';
  const me = { url };
  me.hearthUse = Agent.prototype.hearthUse.bind(me);
  setEndpoint(url, { kind: 'openai', ollama: true, hearth: true, hearthSizes: ['hearth-2b', 'hearth-4b', 'hearth-9b'], model: 'hearth@poseidon' });
  expect(['side', 'btw', 'review', 'helpers'].map((j) => [me.hearthUse(j)?.model, me.hearthUse(j)?.side])).toEqual([['hearth@poseidon', true], ['hearth@poseidon', true], ['hearth@poseidon', true], ['hearth@poseidon', true]]);
  expect(me.hearthUse('pictures')).toBeUndefined();
  // not held: the sizes, as before
  setEndpoint(url, { kind: 'openai', ollama: true, hearth: true, hearthSizes: ['hearth-2b', 'hearth-4b', 'hearth-9b'], model: 'hearth' });
  expect(['side', 'review', 'helpers'].map((j) => [me.hearthUse(j)?.model, me.hearthUse(j)?.side])).toEqual([['hearth-2b', undefined], ['hearth-9b', undefined], ['hearth-4b', undefined]]);
  dropEndpoint(url);
});

test('on hearth the memory is cleaned up before the door would refuse it; your Clean up at and other services as before', async () => {
  const { HEARTH_CLEAN_AT } = await import('../src/agent/agent.mjs');
  const url = 'http://127.0.0.1:9/fit-room';
  const cap = (over) => Object.getOwnPropertyDescriptor(Agent.prototype, 'cleanCap').get.call({ url, ctx: 131072, workRoom: 0, model: { remote: { model: 'hearth' } }, ...over });
  setEndpoint(url, { kind: 'openai', ollama: true, hearth: true, model: 'hearth' });
  expect(HEARTH_CLEAN_AT).toBe(102400);
  // the door's line: a prompt and 4,096 of reply over 131,072 is refused, and a whole reply needs 16,384
  expect(cap()).toBe(102400);
  expect(HEARTH_CLEAN_AT + 16384).toBeLessThan(131072);
  expect(cap({ workRoom: 65536 })).toBe(65536);
  setEndpoint(url, { kind: 'openai', ollama: true, model: 'qwen' });
  expect(cap()).toBe(131072);
  dropEndpoint(url);
});

test('a hearth model named with its server keeps the server through Connect', async () => {
  expect(pickHearthModel(['hearth', 'hearth-2b'], 'hearth@poseidon-seats')).toBe('hearth@poseidon-seats');
  expect(pickHearthModel(['hearth/oto', 'hearth/lite'], 'hearth@neptune')).toBe('hearth/oto@neptune');
  expect([pickHearthModel(['hearth'], 'hearth'), pickHearthModel(['hearth'], 'hearth@'), pickHearthModel(['hearth'], '')]).toEqual(['hearth', 'hearth', 'hearth']);
  const d = await door();
  open.push(d);
  const c = await connectRemote({ ...DEFAULT_REMOTE, source: 'hearth', kind: 'openai', connect: 'http', address: `${d.base}/v1`, model: 'hearth@poseidon-seats', key: true, keyEnd: 'cdef', keyId: 'hearth' }, { key: KEY });
  try { expect(endpointOf(c.url).model).toBe('hearth@poseidon-seats'); } finally { c.stop(); }
});

// 21 Nov 2026: a run on Triton reached hearth by its public address for a few seconds (the server's name lookup asked a
// public DNS server too, and that answer won). hearth's web server refuses any address outside hearth's network with its
// own 403 page, before a key is read; the app said "the API key was not accepted" and "change it in /remote".
const APACHE_403 = '<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN">\n<html><head>\n<title>403 Forbidden</title>\n</head><body>\n<h1>Forbidden</h1>\n<p>You don\'t have permission to access this resource.</p>\n</body></html>\n';
test('a 403 says what it is: the service\'s own words, or a web server in front that refused this machine; a 401 is the key', async () => {
  expect(refusalOf(401, '{"error":"That key isn\'t one of hearth\'s."}')).toEqual({ kind: 'key', text: 'the API key was not accepted' });
  expect(refusalOf(403, '')).toEqual({ kind: 'key', text: 'the API key was not accepted' });
  expect(refusalOf(403, '{"error":"This key is paused."}')).toEqual({ kind: 'refused', text: 'it refused this request (403): This key is paused.' });
  expect(refusalOf(403, '{"error":{"message":"This key doesn\'t reach hearth."}}').text).toBe('it refused this request (403): This key doesn\'t reach hearth.');
  expect(refusalOf(403, APACHE_403)).toEqual({ kind: 'address', text: 'a web server in front of it refused this machine\'s address (403) before any key was read' });
  expect(refusalOf(403, APACHE_403, { hearth: true }).text).toContain('hearth\'s API answers on hearth\'s network only (the VPN or the house)');

  // A stand-in for hearth behind its web server: `shut` is what every request gets ('page': the web server's 403; 'words': the door's own).
  let shut = null;
  const d = await door();
  open.push(d);
  const front = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    if (shut === 'page') { res.writeHead(403, { 'content-type': 'text/html; charset=iso-8859-1' }); return res.end(APACHE_403); }
    if (shut === 'words') { res.writeHead(403, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'This key is paused.' })); }
    const up = await fetch(`${d.base.replace(/\/door$/, '')}${req.url}`, { method: req.method, headers: { authorization: req.headers.authorization ?? '', 'content-type': 'application/json' }, body: req.method === 'GET' ? undefined : b });
    res.writeHead(up.status, { 'content-type': up.headers.get('content-type') ?? 'application/json' });
    res.end(await up.text());
  });
  await new Promise((ok) => front.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${front.address().port}/door`;
  open.push({ base, close: () => new Promise((ok) => { front.closeAllConnections?.(); front.close(ok); }) });
  try {
    // Connect's check
    shut = 'page';
    const page = await probe({ url: `${base}/v1`, kind: 'openai', key: KEY, hearth: true });
    expect(page.ok).toBe(false);
    expect(page.error).toMatch(/^reached in \d+ ms, but a web server in front of it refused this machine's address \(403\) before any key was read: hearth's API answers on hearth's network only/);
    expect(page.error).not.toContain('API key was not accepted');
    shut = 'words';
    expect((await probe({ url: `${base}/v1`, kind: 'openai', key: KEY, hearth: true })).error).toMatch(/^reached in \d+ ms, but it refused this request \(403\): This key is paused\.$/);
    shut = null;
    expect((await probe({ url: `${base}/v1`, kind: 'openai', key: 'hk_wrong-key-0123456789', hearth: true })).error).toMatch(/^reached in \d+ ms, but the API key was not accepted$/);

    // A step of a run
    const c = await connectRemote({ ...DEFAULT_REMOTE, source: 'hearth', kind: 'openai', connect: 'http', address: `${base}/v1`, model: 'hearth', key: true, keyEnd: 'cdef', keyId: 'hearth' }, { key: KEY });
    const step = () => drain(streamChat({ url: c.url, conversation: 'c1', messages: [{ role: 'user', content: 'hi' }], thinking: false, model: c.model, sampling: {}, maxTokens: 50 })).catch((e) => e);
    shut = 'page';
    const e1 = await step();
    expect(e1.status).toBe(403);
    expect(e1.message).toContain('a web server in front of it refused this machine\'s address (403) before any key was read');
    expect(e1.message).not.toContain('API key');
    expect(e1.message).not.toContain('/remote');
    shut = 'words';
    const e2 = await step();
    expect(e2.message).toContain('it refused this request (403): This key is paused.');
    expect(e2.message).not.toContain('did not accept the API key');
    c.stop?.();
  } finally { shut = null; }
});

// 21 Nov 2026, run 5 of the hearth fit check: all the work right, and two checks still failed on these.
test('on hearth the second opinion asks for no thinking; one that only thought is asked once more without', async () => {
  expect(reviewThink({ thinks: true, model: 'hearth@poseidon-seats' }, { hearth: true })).toBe(false);
  expect(reviewThink({ thinks: true, model: 'qwen3.6:35b' }, { ollama: true })).toBe(true);
  expect(reviewThink({ thinks: true, model: 'gpt-oss:20b', family: 'gptoss' }, { ollama: true })).toBe('low');
  expect(reviewThink({ thinks: false, model: 'llava' }, { ollama: true })).toBe(undefined);
  // a service that takes no thinking cap: 3,000 tokens of thinking and no word, then LGTM with thinking off
  const sent = [];
  const send = async (a) => { sent.push({ think: a.use.think, maxTokens: a.maxTokens }); return sent.length === 1 ? { text: '', secs: 142 } : { text: 'LGTM', secs: 6 }; };
  const r = await reviewChange({ url: 'http://127.0.0.1:9', use: { model: 'qwen3.6:35b', thinks: true }, request: 'fix it', diff: '+ x', send });
  expect(sent).toEqual([{ think: true, maxTokens: 3000 }, { think: false, maxTokens: 500 }]);
  expect(r).toMatchObject({ ok: true, findings: [], secs: 148 });
  expect(r.empty).toBeUndefined();
  // one that answered is not asked again
  const once = [];
  await reviewChange({ url: 'http://127.0.0.1:9', use: { model: 'qwen3.6:35b', thinks: true }, request: 'fix it', diff: '+ x', send: async (a) => { once.push(a.use.think); return { text: '- a.mjs: off by one', secs: 3 }; } });
  expect(once).toEqual([true]);
});

test('what the app read for the model is among the steps the second look is shown', () => {
  const me = { cwd: process.cwd(), messages: [], turn: { reads: new Map() }, readFiles: new Set(), ctxUsed: 0, emit() {} };
  for (const k of ['sawForIt', 'giveRead', 'pretend']) me[k] = Agent.prototype[k].bind(me);
  me.giveRead('src/checkout.mjs', { path: 'src/checkout.mjs' }, 'export function checkout() {}', {});
  me.pretend({ name: 'Search', args: { pattern: 'checkout' }, body: 'src/checkout.mjs:1', view: {} });
  me.turn.callLog.push({ function: { name: 'Read', arguments: JSON.stringify({ path: 'src/cart.mjs' }) } }); // the model's own
  const steps = ownSteps([{ role: 'assistant', tool_calls: me.turn.callLog }]);
  expect(steps).toHaveLength(3);
  expect(steps[0]).toContain('src/checkout.mjs');
  expect(steps[1]).toContain('checkout');
  expect(steps[2]).toContain('src/cart.mjs');
});
