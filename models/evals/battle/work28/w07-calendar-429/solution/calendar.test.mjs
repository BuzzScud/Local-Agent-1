import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWeek } from './calendar.mjs';

// A stand-in response, like fetch's.
const reply = (status, body = null, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, json: async () => body });

test('loads the week', async () => {
  const week = await loadWeek('https://example.test/week.json', { fetchImpl: async () => reply(200, [{ title: 'CPI' }]) });
  assert.deepEqual(week, [{ title: 'CPI' }]);
});

test('waits after a 429 and tries again', async () => {
  const answers = [reply(429, null, { 'retry-after': '3' }), reply(200, ['ok'])];
  const slept = [];
  const week = await loadWeek('u', { fetchImpl: async () => answers.shift(), sleep: async (ms) => { slept.push(ms); } });
  assert.deepEqual(week, ['ok']);
  assert.deepEqual(slept, [3000]);
});
