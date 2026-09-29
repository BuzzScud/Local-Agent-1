import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkInvite } from './invites.mjs';

const DAY = 24 * 60 * 60 * 1000;
const sentAt = Date.UTC(2026, 8, 1);

test('works for a week', () => {
  assert.deepEqual(checkInvite({ code: 'a', sentAt, usedAt: null }, sentAt + DAY), { ok: true });
  assert.deepEqual(checkInvite({ code: 'a', sentAt, usedAt: null }, sentAt + 8 * DAY), { ok: false, why: 'expired' });
});

test('works only once', () => {
  assert.deepEqual(checkInvite({ code: 'b', sentAt, usedAt: sentAt + 1000 }, sentAt + 2000), { ok: false, why: 'already used' });
});
