// Sorting a request in one pass (decide() in flows/llm.mjs, modelSort() in
// flows/index.mjs): the kind is read from the chance the model gives each one,
// with nothing written; a rename, and a server that cannot give the chances,
// are asked the old way. A tiny server stands in for llama-server here: its
// "tokens" are the letters of the text, so every kind starts with its own one.
import { test, expect } from 'bun:test';
import { createServer } from 'node:http';
import { decide } from '../src/flows/llm.mjs';
import { modelSort, sortQuestion, KINDS, SORT_SYSTEM } from '../src/flows/index.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';

const model = MODELS[DEFAULT_MODEL];
const letters = (s) => Array.from(s).map((c) => c.codePointAt(0));

// chances: { kind: probability } for the letter each kind starts with.
function oddsServer(chances, { replies = [] } = {}) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const j = body ? JSON.parse(body) : {};
    requests.push({ path: req.url, ...j });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/apply-template') { res.end(JSON.stringify({ prompt: `<s>${j.messages[0].content}</s><u>${j.messages[1].content}</u><a>` })); return; }
    if (req.url === '/tokenize') { res.end(JSON.stringify({ tokens: letters(j.content) })); return; }
    if (req.url === '/completion') {
      const top = Object.entries(chances).map(([k, p]) => ({ id: k.codePointAt(0), token: k[0], logprob: Math.log(p) }));
      res.end(JSON.stringify({ content: '', completion_probabilities: [{ top_logprobs: top }] }));
      return;
    }
    // The old way (a written answer), for a rename's names.
    const reply = replies.shift() ?? '{"kind": "other"}';
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: reply }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => server.close(r)) })));
}

test('decide reads the chance of each option after the lead, from a prompt cut where they first differ', async () => {
  const s = await oddsServer({ change: 0.6, other: 0.3, fix: 0.05 });
  const d = await decide({ url: s.url, model, slot: 1, system: 'S', user: 'U', options: KINDS, lead: '{"kind": "' });
  expect(d.pick).toBe('change');
  expect(d.conf).toBeCloseTo(0.6 / 0.95, 5);
  expect(d.mass).toBeCloseTo(0.95, 5);
  const c = s.requests.find((r) => r.path === '/completion');
  expect(c.prompt).toEqual(letters('<s>S</s><u>U</u><a>{"kind": "'));
  expect([c.n_predict, c.id_slot, c.post_sampling_probs]).toEqual([1, 1, false]);
  expect(s.requests.find((r) => r.path === '/apply-template').chat_template_kwargs).toEqual({ enable_thinking: false });
  await s.close();
});

test('decide gives up when the options hold under half the chance (the model meant to write something else)', async () => {
  const s = await oddsServer({ change: 0.2, other: 0.1 });
  expect(await decide({ url: s.url, model, system: 'S', user: 'U', options: KINDS, lead: '{"kind": "' })).toBe(null);
  await s.close();
});

test('the model sorts from the chances, with nothing written', async () => {
  const s = await oddsServer({ question: 0.9, other: 0.1 });
  const r = await modelSort({ url: s.url, model, slot: 1 }, 'what does parse() return for an empty row');
  expect(r).toEqual({ kind: 'question', via: 'odds', sure: 0.9 });
  expect(s.requests.some((q) => q.messages && q.stream)).toBe(false);
  await s.close();
});

test('a rename sorted in one pass is asked for its two names on their own', async () => {
  const s = await oddsServer({ rename: 0.95, change: 0.05 }, { replies: ['{"from": "calc", "to": "total"}'] });
  const r = await modelSort({ url: s.url, model, slot: 1 }, 'calc should be called total');
  expect(r).toEqual({ kind: 'rename', via: 'odds', sure: 0.95, from: 'calc', to: 'total' });
  const names = s.requests.filter((q) => q.response_format);
  expect(names.length).toBe(1);
  expect(names[0].response_format.json_schema.schema.required).toEqual(['from', 'to']);
  await s.close();
});

test('a rename without both names is worked on as a change', async () => {
  const s = await oddsServer({ rename: 0.9, change: 0.1 }, { replies: ['{"from": "calc", "to": ""}'] });
  expect(await modelSort({ url: s.url, model, slot: 1 }, 'rename it')).toEqual({ kind: 'change', via: 'odds' });
  await s.close();
  // The same from a written answer (a server with no chances): names asked for when it left them out.
  const fake = await startFakeServer([{ text: '{"kind": "rename"}' }, { text: '{"from": "getTotal", "to": "computeTotal"}' }]);
  expect(await modelSort({ url: fake.url, model }, 'getTotal should be computeTotal')).toEqual({ kind: 'rename', from: 'getTotal', to: 'computeTotal', via: 'written' });
  await fake.close();
});

test('a server that cannot give the chances is asked the old way, and not tried again', async () => {
  const fake = await startFakeServer([{ text: '{"kind": "fix"}' }, { text: '{"kind": "change"}' }]);
  expect((await modelSort({ url: fake.url, model }, 'the totals are off')).kind).toBe('fix');
  const tries = fake.requests.length;
  expect((await modelSort({ url: fake.url, model }, 'add a --json flag')).kind).toBe('change');
  expect(fake.requests.length).toBe(tries + 1); // only the written answer this time
  await fake.close();
});

test('the sorter says what every kind means, before the request (so it is read once), and that a page in the code is a change', () => {
  for (const k of KINDS) expect(SORT_SYSTEM).toMatch(new RegExp(`\\b${k} \\(`));
  expect(SORT_SYSTEM).toMatch(/^You sort a request to a coding assistant into one kind\.\n\nKinds: /);
  expect(SORT_SYSTEM).toMatch(/change \([^)]*component or page inside the code/);
  expect(SORT_SYSTEM).toMatch(/other \([^)]*self-contained web page[^)]*run a command/);
  expect(sortQuestion('add a --json flag')).toBe('Request: add a --json flag');
});
