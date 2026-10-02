import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './api.mjs';

test('items have an id and a name only', () => {
  const { items } = handle();
  assert.deepEqual(items[0], { id: 1, name: 'item 1' });
});
test('the first page has 20 and a cursor', () => {
  const p = handle({});
  assert.equal(p.items.length, 20);
  assert.equal(p.nextCursor, 20);
});
test('after and limit', () => {
  assert.deepEqual(handle({ after: 20, limit: 5 }).items.map((i) => i.id), [21, 22, 23, 24, 25]);
  assert.equal(handle({ limit: 500 }).items.length, 100);
  assert.equal(handle({ after: 245, limit: 5 }).nextCursor, null);
});
