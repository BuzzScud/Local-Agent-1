import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowed } from './routes.mjs';

test('a member reads and writes but cannot see the users', () => {
  const m = { role: 'member' };
  assert.equal(allowed(m, 'GET /api/bars'), true);
  assert.equal(allowed(m, 'POST /api/bars'), true);
  assert.equal(allowed(m, 'GET /api/users'), false);
});
