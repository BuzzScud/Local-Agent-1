import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summary } from './cart.mjs';

test('summary', () => {
  assert.equal(summary({ items: [{ price: 10, qty: 2 }, { price: 5, qty: 1 }], taxRate: 0.1 }), '2 items, total 27.50');
});
