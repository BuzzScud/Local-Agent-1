import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextContract } from './contracts.mjs';

test('rolls to the next quarter', () => {
  assert.equal(nextContract('NQH6'), 'NQM6');
  assert.equal(nextContract('ESU6'), 'ESZ6');
});

test('December rolls into March of the next year', () => {
  assert.equal(nextContract('NQZ6'), 'NQH7');
  assert.equal(nextContract('MNQZ6'), 'MNQH7');
});
