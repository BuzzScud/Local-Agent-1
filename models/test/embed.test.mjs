// The embedder (runtime/embed.mjs) against a stand-in server: a text asked
// for again is answered from its cache (one request: the memory, Claude's
// notes and the code search each look the same words up).
import { test, expect } from 'bun:test';
import { createServer } from 'node:http';
import { Embedder, EMBEDDERS, DEFAULT_EMBEDDER } from '../index.mjs';

function fakeEmbeddings() {
  const asked = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const { input } = JSON.parse(body);
    asked.push(input);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: input.map((t, index) => ({ index, embedding: [t.length, 1, 0] })) }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, asked, close: () => new Promise((r) => server.close(r)) })));
}

test('a text asked for again comes from the cache: only new texts go to the server, in order, once each', async () => {
  const fake = await fakeEmbeddings();
  const e = new Embedder(undefined, { url: fake.url });
  const [a] = await e.embed(['fix the chart bug']);
  expect(a.length).toBe(3);
  expect(Math.hypot(...a)).toBeCloseTo(1, 5);
  const [b, c, d] = await e.embed(['fix the chart bug', 'a new text', 'a new text']);
  expect(b).toBe(a);
  expect(c).toBe(d);
  expect(fake.asked).toEqual([['fix the chart bug'], ['a new text']]);
  // More than 16 new texts still go in batches of 16.
  await e.embed(Array.from({ length: 20 }, (_, i) => `text ${i}`));
  expect(fake.asked.slice(2).map((x) => x.length)).toEqual([16, 4]);
  await fake.close();
});

test('with too little memory free the embedder does not start and says why', async () => {
  // A file name no running server has, so one loaded by another window is not shared.
  const m = { ...EMBEDDERS[DEFAULT_EMBEDDER], file: 'not-loaded-anywhere.gguf' };
  await expect(new Embedder(m).start({ free: () => 0.5e9 })).rejects.toThrow('only 0.5 GB of memory is free and it needs about 1.1 GB');
});
