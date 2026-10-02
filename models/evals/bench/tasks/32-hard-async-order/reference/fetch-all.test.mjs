import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAll } from './fetch-all.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('keeps the order of ids', async () => {
  const got = await fetchAll([1, 2, 3], async (id) => { await wait(30 - id * 10); return id * 10; });
  assert.deepEqual(got, [10, 20, 30]);
});

test('never more than 2 at once', async () => {
  let now = 0, most = 0;
  await fetchAll([1, 2, 3, 4, 5], async (id) => { now++; most = Math.max(most, now); await wait(10); now--; return id; });
  assert.equal(most, 2);
});

test('a failure rejects', async () => {
  await assert.rejects(fetchAll([1, 2], async (id) => { if (id === 2) throw new Error('down'); return id; }), /down/);
});
