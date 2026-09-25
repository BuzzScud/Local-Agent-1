import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './server.mjs';

test('/trades lists the trades', () => {
  assert.equal(handle('/trades').status, 200);
  assert.equal(handle('/trades').body.length, 2);
});

test('unknown routes are 404', () => {
  assert.equal(handle('/nope').status, 404);
});

test('/health says ok', () => {
  assert.deepEqual(handle('/health'), { status: 200, body: { ok: true } });
});
