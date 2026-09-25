import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cart } from './cart.mjs';
import { receipt } from './receipt.mjs';

test('total', () => assert.equal(new Cart().add('tea', 3, 2).add('cake', 4).getTotal(), 10));
test('receipt shows the total', () => assert.match(receipt(new Cart().add('tea', 3)), /Total: 3/));
