import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transition } from './status.mjs';

const o = (status) => ({ id: 1, status, at: [] });

test('the allowed moves', () => {
  assert.equal(transition(o('new'), 'paid').status, 'paid');
  assert.equal(transition(o('paid'), 'shipped').status, 'shipped');
  assert.equal(transition(o('shipped'), 'delivered').status, 'delivered');
});
test('cancelling refunds only once paid', () => {
  assert.equal(transition(o('new'), 'cancelled').refund, false);
  assert.equal(transition(o('paid'), 'cancelled').refund, true);
});
test('other moves throw', () => {
  assert.throws(() => transition(o('new'), 'shipped'), /^Error: cannot go from new to shipped$/);
  assert.throws(() => transition(o('delivered'), 'paid'), /cannot go from delivered to paid/);
  assert.throws(() => transition(o('cancelled'), 'paid'), /cannot go from cancelled to paid/);
});
test('unknown statuses throw', () => {
  assert.throws(() => transition(o('lost'), 'paid'), /unknown status lost/);
  assert.throws(() => transition(o('new'), 'gone'), /unknown status gone/);
});
test('a new order each time, with its steps', () => {
  const a = o('new');
  const b = transition(a, 'paid');
  assert.deepEqual(a, o('new'));
  assert.deepEqual(b.at, [{ status: 'paid', step: 1 }]);
  assert.equal('refund' in b, false);
});
