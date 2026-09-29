import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route } from '../src/routes/index.mjs';

test('health answers without signing in', async () => {
  const r = await route('GET', '/api/health', {});
  assert.equal(r.status, 200);
});
