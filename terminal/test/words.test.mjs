import { test, expect } from 'bun:test';
import { sweep } from './sweep.mjs';

test('trigger words: 140 requests go where they should, and none throws', () => {
  const out = sweep();
  expect(out.rows.filter((r) => r.error)).toEqual([]);
  expect(out.bad.map((b) => `${b.text} → ${b.got}`)).toEqual([]);
  expect(out.total).toBeGreaterThanOrEqual(140);
});
