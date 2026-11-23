// hearth's API, as hearth (20 Nov 2026, the owner: a task took 5 minutes and failed; then "ensure that 2b,4b, 9b and 27b
// are all used, based on avaiblilty ... there should be no waiting"). A stand-in for hearth's door, as it is on live (it
// lists only "hearth" and says every model only does plain completion) and as its next version is (it lists the sizes):
// connecting, what each call sends (its thinking, its model list, the side-job header), one call at a time on a door
// without side jobs, why a call waits, and which helper job goes to which size.
import { test, expect, afterAll } from 'bun:test';
import { createServer } from 'node:http';
import { connectRemote, endpointOf, dropEndpoint, hearthList, remoteModel, remoteLevels, thinkingLevel, HEARTH_CTX, HEARTH_JOBS, DEFAULT_REMOTE, GENERIC_REMOTE } from '../../models/index.mjs';
import { streamChat, withTurn } from '../src/agent/client.mjs';
import { Agent } from '../src/agent/agent.mjs';

const drain = async (it) => { const out = []; for await (const e of it) out.push(e); return out; };
const KEY = 'hk_test-hearth-door-key-0123456789abcdef';

// The door: /door/api/… like Ollama's, behind the key. sizes: whether it lists hearth-2b … (the new door). slowMs: how long a
// chat takes. waitFirst: a piece saying why it waits before the answer (the new door's line). seen: each chat's body, its
// side-job header and when it came and ended.
function door({ sizes = false, slowMs = 0, waitFirst = false } = {}) {
  const seen = [];
  const s = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const json = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.headers.authorization !== `Bearer ${KEY}`) return json(401, { error: "That key isn't one of hearth's." });
    const p = req.url.replace(/^\/door/, '');
    const names = ['hearth', ...(sizes ? ['hearth-2b', 'hearth-4b', 'hearth-9b'] : [])];
    const roleOf = (id) => (id === 'hearth' ? 'code' : 'fast');
    const capsOf = (id) => (id === 'hearth' ? ['completion', 'tools', 'thinking'] : ['completion', 'tools']);
    const paramsOf = (id) => (id === 'hearth' ? '27B' : id.replace(/^hearth-/, '').toUpperCase());
    if (p === '/api/version') return json(200, { version: '0.40.0' });
    if (p === '/v1/models') return json(200, { object: 'list', data: names.map((id) => ({ id, object: 'model', owned_by: 'hearth', ...(sizes ? { role: roleOf(id), capabilities: capsOf(id) } : {}) })) });
    if (p === '/api/tags') return json(200, { models: names.map((name) => ({ name, model: name, size: 0, digest: '', details: { format: 'gguf', family: '', parameter_size: paramsOf(name) }, ...(sizes ? { role: roleOf(name), capabilities: capsOf(name) } : {}) })) });
    if (p === '/api/ps') return json(200, { models: names.map((name) => ({ name, model: name, size: 0, digest: '', context_length: name === 'hearth' ? 200000 : 32768 })) });
    if (p === '/api/show') return json(200, { details: {}, model_info: { 'general.basename': 'hearth', 'general.context_length': 200000 }, capabilities: sizes ? ['completion', 'tools', 'thinking'] : ['completion'] });
    if (p === '/api/chat') {
      const body = JSON.parse(b || '{}');
      const row = { body, side: req.headers['x-hearth-job'] ?? null, at: Date.now(), end: null };
      seen.push(row);
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      if (waitFirst) res.write(`${JSON.stringify({ model: body.model, message: { role: 'assistant', content: '' }, done: false, hearth: { waiting: 'Poseidon is busy with a staff chat', ahead: 1 } })}\n`);
      if (slowMs) await Bun.sleep(slowMs);
      res.write(`${JSON.stringify({ model: 'bonsai-2:2b', message: { role: 'assistant', content: 'Done.' }, done: false })}\n`);
      row.end = Date.now();
      res.end(`${JSON.stringify({ model: 'bonsai-2:2b', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 10, eval_count: 2 })}\n`);
      return;
    }
    json(404, { error: 'Not found.' });
  });
  return new Promise((ok) => s.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${s.address().port}/door`, seen, close: () => new Promise((d) => { s.closeAllConnections?.(); s.close(d); }) })));
}
const open = [];
afterAll(async () => { for (const d of open) await d.close(); });
const hearthRemote = (base) => ({ ...DEFAULT_REMOTE, source: 'hearth', kind: 'openai', connect: 'http', address: `${base}/v1`, model: 'hearth', key: true, keyEnd: 'cdef', keyId: 'hearth' });

test('a size goes as its list, first choice first, with only the sizes this door has', () => {
  expect(hearthList('hearth-2b')).toBe('hearth-2b,hearth-4b,hearth-9b,hearth');
  expect(hearthList('hearth-4b')).toBe('hearth-4b,hearth-9b,hearth-2b,hearth');
  expect(hearthList('hearth-9b')).toBe('hearth-9b,hearth,hearth-4b');
  expect(hearthList('hearth-2b', ['hearth-9b'])).toBe('hearth-9b,hearth');
  expect(hearthList('hearth')).toBe('hearth');
  expect(hearthList('bonsai-2:27b@poseidon')).toBe('bonsai-2:27b@poseidon');
  // worker and lookup (22 Nov 2026): hearth 3.0's helpers, the 9b for a change with its tests, the 2b for one thing looked up.
  expect(HEARTH_JOBS).toEqual({ side: 'hearth-2b', btw: 'hearth-2b', review: 'hearth-9b', helpers: 'hearth-4b', worker: 'hearth-9b', lookup: 'hearth-2b' });
});

test('on the door as it is: hearth thinks and takes tools whatever it says, works in 128k, and takes one call at a time', async () => {
  const d = await door({ slowMs: 400 });
  open.push(d);
  const c = await connectRemote(hearthRemote(d.base), { key: KEY });
  try {
    const ep = endpointOf(c.url);
    expect(ep).toMatchObject({ ollama: true, hearth: true, hearthSizes: [], tools: true, thinks: true });
    expect(c.ctx).toBe(HEARTH_CTX);
    expect(c.hearth).toBe(true);
    const model = remoteModel(hearthRemote(d.base), c.info);
    expect(model.thinkingEffort).toBe('medium');
    expect(model.thinkingLevels.map((l) => l.id)).toEqual(['off', 'low', 'medium', 'high']);
    // Named for one server ("hearth@poseidon") it is hearth all the same: its levels, Medium, thinking on.
    const at = remoteModel({ ...hearthRemote(d.base), model: 'hearth@poseidon' }, { ...c.info, model: 'hearth@poseidon', ollama: { ...c.info.ollama, id: 'hearth@poseidon' } });
    expect([at.thinkingEffort, at.thinkingLevels.map((l) => l.id), at.thinkingDefault]).toEqual(['medium', ['off', 'low', 'medium', 'high'], true]);
    // coding -p uses thinkingLevel then Boolean(lv.effort): a completion-only door, or ollama left unpatched,
    // still thinks at Medium (the after run of 20 Nov 2026 sent think: false on every step).
    const pick = (m) => { const lv = thinkingLevel(m, m.thinkingDefault ?? true, m.thinkingEffort); return [Boolean(lv.effort), lv.id, lv.effort]; };
    expect(pick(model)).toEqual([true, 'medium', 'medium']);
    expect(pick(at)).toEqual([true, 'medium', 'medium']);
    const raw = remoteModel({ ...hearthRemote(d.base), model: 'hearth@poseidon' }, { model: 'hearth@poseidon', ollama: { known: true, thinking: false, chat: true, id: 'hearth@poseidon', family: '' } });
    expect(pick(raw)).toEqual([true, 'medium', 'medium']);
    expect(remoteModel(hearthRemote(d.base), { model: 'hearth' })).toMatchObject({ thinkingDefault: true, thinkingEffort: 'medium' });
    // The conversation's step and a side job sent at once: the door sees the second only after the first ended (here each
    // new job from a key took the running one's place).
    const step = drain(streamChat({ url: c.url, conversation: 'c1', messages: [{ role: 'user', content: 'fix it' }], tools: [{ type: 'function', function: { name: 'Read', parameters: { type: 'object' } } }], thinking: true, effort: 'medium', model, sampling: {}, maxTokens: 100 }));
    await Bun.sleep(50);
    const side = drain(streamChat({ url: c.url, messages: [{ role: 'user', content: 'sum it up' }], thinking: false, model, sampling: {}, maxTokens: 600, what: 'a summary' }));
    await Promise.all([step, side]);
    expect(d.seen).toHaveLength(2);
    expect(d.seen[1].at).toBeGreaterThanOrEqual(d.seen[0].end);
    // Each says how much to think: the step at its level, the side job not at all. No hold of its own (the door keeps it).
    expect(d.seen.map((r) => [r.body.model, r.body.think, r.side, 'keep_alive' in r.body, Boolean(r.body.tools)])).toEqual([['hearth', 'medium', null, false, true], ['hearth', false, 'side', false, false]]);
    // No size on this door, so no helper job goes to one.
    const me = { url: c.url, isHelper: false, router: null, helperJobs: {}, subagents: true, conversation: 'c1' };
    for (const k of ['hearthUse', 'onHearth', 'helperUse', 'btwUse', 'sideUse', 'profileUse']) me[k] = Agent.prototype[k].bind(me);
    expect([me.sideUse(), me.helperUse('review'), me.hearthUse('helpers')]).toEqual([undefined, undefined, undefined]);
  } finally { c.stop(); }
});

test('on the door with sizes: side jobs and helpers go to their size with the side header, beside the step, and a wait says why', async () => {
  const d = await door({ sizes: true, slowMs: 300, waitFirst: true });
  open.push(d);
  const c = await connectRemote(hearthRemote(d.base), { key: KEY });
  try {
    expect(endpointOf(c.url)).toMatchObject({ hearth: true, hearthSizes: ['hearth-2b', 'hearth-4b', 'hearth-9b'] });
    expect(c.info.modelRows.find((m) => m.id === 'hearth')).toMatchObject({ role: 'code', capabilities: expect.arrayContaining(['completion', 'tools', 'thinking']) });
    expect(c.info.modelRows.find((m) => m.id === 'hearth-2b')).toMatchObject({ role: 'fast', capabilities: expect.arrayContaining(['completion', 'tools']) });
    const model = remoteModel(hearthRemote(d.base), c.info);
    // Which size does which job (the owner's picks), as the agent asks for it.
    const me = { url: c.url, isHelper: false, router: null, helperJobs: {}, subagents: true, conversation: 'c1' };
    for (const k of ['hearthUse', 'onHearth', 'helperUse', 'btwUse', 'sideUse', 'profileUse']) me[k] = Agent.prototype[k].bind(me);
    expect([me.sideUse()?.model, me.btwUse()?.model, me.helperUse('review')?.model, me.hearthUse('helpers')?.model, me.helperUse('pictures')]).toEqual(['hearth-2b', 'hearth-2b', 'hearth-9b', 'hearth-4b', undefined]);
    // A question handed to a helper first goes to the explore helper's size, with no profiles and with profiles that give
    // the job nothing of its own (22 Nov 2026: it asked the profiles alone, so on hearth it never ran).
    me.firstHelperUse = Agent.prototype.firstHelperUse.bind(me);
    me.modelName = () => 'hearth';
    expect(me.firstHelperUse()?.model).toBe('hearth-4b');
    me.router = { active: () => true, helper: () => undefined };
    expect(me.firstHelperUse()?.model).toBe('hearth-4b');
    me.router = null;
    // Held on one server (hearth@poseidon-seats), every job is on that model: no search is handed to a helper first.
    const held = { ...me, url: c.url, modelName: () => 'hearth', isHelper: false, helpersElsewhere: () => true, router: null };
    for (const k of ['hearthUse', 'onHearth', 'firstHelperUse', 'handFirst']) held[k] = Agent.prototype[k].bind(held);
    held.firstHelperUse = () => ({ url: c.url, model: 'hearth' });
    expect(await held.handFirst('where is the tax rate set?', 'question', undefined)).toBe(false);
    // A profile that sends side jobs elsewhere is left aside on hearth; one on hearth itself is kept.
    me.router = { active: () => true, helper: () => undefined };
    me.profileUse = () => ({ url: 'http://127.0.0.1:9/elsewhere', model: 'bonsai-2:9b' });
    expect(me.helperUse('side').model).toBe('hearth-2b');
    me.profileUse = () => ({ url: c.url, model: 'hearth-9b' });
    expect(me.helperUse('side').model).toBe('hearth-9b');
    me.router = null;
    // The step and a side job on the 2b at once: both reach the door together (it runs side jobs beside the step).
    const t0 = Date.now();
    const [stepEvs] = await Promise.all([
      drain(streamChat({ url: c.url, conversation: 'c1', messages: [{ role: 'user', content: 'fix it' }], thinking: true, effort: 'high', model, sampling: {}, maxTokens: 100 })),
      drain(streamChat({ url: c.url, messages: [{ role: 'user', content: 'sum it up' }], thinking: false, model, sampling: {}, maxTokens: 600, use: me.sideUse(), what: 'a summary' })),
    ]);
    expect(Math.abs(d.seen[1].at - d.seen[0].at)).toBeLessThan(250);
    expect(Date.now() - t0).toBeLessThan(550);
    const byModel = Object.fromEntries(d.seen.map((r) => [r.body.model, [r.body.think, r.side]]));
    expect(byModel).toEqual({ hearth: ['high', null], 'hearth-2b,hearth-4b,hearth-9b,hearth': [false, 'side'] });
    // While it waited, the door said why, once, before the answer.
    expect(stepEvs.filter((e) => e.type === 'queued')).toEqual([{ type: 'queued', why: 'Poseidon is busy with a staff chat', ahead: 1 }]);
    expect(stepEvs.findIndex((e) => e.type === 'queued')).toBeLessThan(stepEvs.findIndex((e) => e.type === 'text'));
  } finally { c.stop(); }
});

test('hearth works in 128k, its levels are its four, and a model elsewhere is as before', () => {
  expect(HEARTH_CTX).toBe(131072);
  expect(remoteLevels({ known: true, thinking: true, id: 'hearth', family: '' }).map((l) => [l.id, l.effort])).toEqual([['off', null], ['low', 'low'], ['medium', 'medium'], ['high', 'high']]);
  expect(remoteLevels({ known: true, thinking: true, id: 'qwen3.5:9b', family: 'qwen35' }).map((l) => l.label)).toEqual(['Off', 'On']);
  expect(GENERIC_REMOTE.thinkingEffort).toBe('high');
});

test('at most so many at a time, in order, and one stopped while it waits leaves the line', async () => {
  const order = [];
  const job = (name, ms) => async function* () { order.push(`${name}+`); await Bun.sleep(ms); order.push(`${name}-`); yield { type: 'done' }; };
  const ctl = new AbortController();
  const runs = [drain(withTurn('k', 1, null, job('a', 60))), drain(withTurn('k', 1, ctl.signal, job('b', 10))).catch(() => 'stopped'), drain(withTurn('k', 1, null, job('c', 10)))];
  await Bun.sleep(20);
  ctl.abort();
  const out = await Promise.all(runs);
  expect(out[1]).toBe('stopped');
  expect(order).toEqual(['a+', 'a-', 'c+', 'c-']);
  // The line is gone once it is empty: the next one starts at once.
  const t0 = Date.now();
  await drain(withTurn('k', 1, null, job('d', 5)));
  expect(Date.now() - t0).toBeLessThan(100);
});

afterAll(() => { for (const d of open) dropEndpoint(d.base); });
