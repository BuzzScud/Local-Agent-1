import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWeek } from './calendar.mjs';

// A stand-in response, like fetch's.
const reply = (status, body = null, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, json: async () => body });

test('loads the week', async () => {
  const week = await loadWeek('https://example.test/week.json', { fetchImpl: async () => reply(200, [{ title: 'CPI' }]) });
  assert.deepEqual(week, [{ title: 'CPI' }]);
});
