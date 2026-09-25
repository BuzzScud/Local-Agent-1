import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDiscount } from './price.mjs';
import { cartTotal } from './cart.mjs';
import { invoiceLine } from './invoice.mjs';

test('applyDiscount takes a percentage off', () => {
  assert.equal(applyDiscount(100, 25), 75);
});

test('cartTotal sums discounted prices', () => {
  assert.equal(cartTotal([{ price: 100 }, { price: 50 }], 10), 135);
});

test('invoiceLine shows the discounted price', () => {
  assert.equal(invoiceLine({ name: 'desk', price: 200 }, 10), 'desk: 180.00');
});
