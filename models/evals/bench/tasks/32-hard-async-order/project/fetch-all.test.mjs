import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAll } from './fetch-all.mjs';

test('fetches every id', async () => {
  const got = await fetchAll([1, 2, 3], async (id) => id * 10);
  assert.deepEqual(got.sort((a, b) => a - b), [10, 20, 30]);
});
