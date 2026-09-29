import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total } from './cart.mjs';

test('a 10% discount on 100 is 90', () => { assert.equal(total([{ price: 100, qty: 1 }], 0.1), 90); });
test('no discount', () => { assert.equal(total([{ price: 5, qty: 3 }], 0), 15); });
