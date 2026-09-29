import { test } from 'node:test';
import assert from 'node:assert/strict';
import { table } from './report.mjs';

test('a text table', () => { assert.equal(table([{ name: 'ann', score: 3 }]), 'ann  3'); });
test('csv', async () => {
  const { csv } = await import('./report.mjs');
  assert.equal(csv([{ name: 'ann', score: 3 }]), 'name,score\nann,3');
});
