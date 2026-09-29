import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, startedAt } from './server.mjs';

test('health says ok with the uptime', () => {
  const r = handle('GET', '/api/health', {}, startedAt + 5000);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.uptime, 5);
});

test('anything else is not found', () => {
  assert.equal(handle('GET', '/nope').status, 404);
});

test('health names the build from BUILD_SHA', () => {
  assert.equal(handle('GET', '/api/health', { BUILD_SHA: 'abcdef123456' }).body.build, 'abcdef1');
  assert.equal(handle('GET', '/api/health', {}).body.build, 'dev');
});
