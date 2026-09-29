import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Backoff } from './reconnect.mjs';

test('doubles up to 30 seconds', () => {
  const b = new Backoff();
  const waits = Array.from({ length: 8 }, () => b.next());
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

test('starts over after a good connection', () => {
  const b = new Backoff();
  b.next(); b.next(); b.next();
  b.connected();
  assert.equal(b.next(), 1000);
});
