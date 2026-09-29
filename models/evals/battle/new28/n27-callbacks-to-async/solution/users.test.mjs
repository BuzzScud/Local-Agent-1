import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadUser } from './users.mjs';

test('finds a user', async () => {
  const user = await loadUser(1);
  assert.equal(user.name, 'Ann');
});
