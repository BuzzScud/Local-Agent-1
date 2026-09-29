import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveAll } from './save.mjs';

test('every item is saved before saveAll finishes', async () => {
  const saved = [];
  const save = (x) => new Promise((ok) => setTimeout(() => { saved.push(x); ok(); }, 20));
  await saveAll([1, 2, 3], save);
  assert.equal(saved.length, 3);
});
