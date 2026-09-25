import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byPrice } from './sort.mjs';

test('cheapest first', () => assert.deepEqual(byPrice([{ price: 9 }, { price: 100 }, { price: 20 }]).map((p) => p.price), [9, 20, 100]));
test('the input is not changed', () => { const a = [{ price: 2 }, { price: 1 }]; byPrice(a); assert.equal(a[0].price, 2); });
