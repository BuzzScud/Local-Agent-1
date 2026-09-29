import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadUser } from './users.mjs';

test('finds a user', (t, done) => {
  loadUser(1, (err, user) => { assert.equal(err, null); assert.equal(user.name, 'Ann'); done(); });
});
