import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUser } from './handlers/user.mjs';
import { placeOrder } from './handlers/order.mjs';
import { sendInvoice } from './handlers/invoice.mjs';

test('createUser checks the email', () => {
  assert.deepEqual(createUser('ann', 'ann@x.io'), { ok: true, user: { name: 'ann', email: 'ann@x.io' } });
  assert.deepEqual(createUser('ann', 'ann.x.io'), { ok: false, error: 'bad email' });
});
test('placeOrder checks the email', () => {
  assert.equal(placeOrder('a@b.co', [1]).ok, true);
  assert.deepEqual(placeOrder('a@@b.co', [1]), { ok: false, error: 'bad email' });
});
test('sendInvoice trims and lowers the email', () => {
  assert.deepEqual(sendInvoice(' Bob@Example.COM ', 10), { ok: true, to: 'bob@example.com', amount: 10 });
});
