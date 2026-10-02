import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uniqueBy, topN } from './collections.mjs';

test('uniqueBy keeps the first of each key', () => {
  assert.deepEqual(uniqueBy([{ id: 1, v: 'a' }, { id: 2, v: 'b' }, { id: 1, v: 'c' }], 'id'), [{ id: 1, v: 'a' }, { id: 2, v: 'b' }]);
});
test('topN takes the highest', () => {
  assert.deepEqual(topN([{ value: 1 }, { value: 5 }, { value: 3 }], 2), [{ value: 5 }, { value: 3 }]);
});
test('200,000 items in well under a second', () => {
  const items = Array.from({ length: 200_000 }, (_, i) => ({ id: i % 50_000, value: (i * 7919) % 1000 }));
  const t0 = Date.now();
  assert.equal(uniqueBy(items, 'id').length, 50_000);
  assert.equal(topN(items, 10).length, 10);
  assert.ok(Date.now() - t0 < 1000);
});
