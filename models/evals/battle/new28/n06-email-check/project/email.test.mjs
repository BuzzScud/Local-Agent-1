import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEmail } from './email.mjs';

test('good ones', () => { for (const e of ['a@b.co', 'first.last@mail.example.com']) assert.equal(isEmail(e), true, e); });
test('bad ones', () => { for (const e of ['a@b', 'a@@b.com', 'a b@c.com', '@b.com', 'a@.com', 'a@b.']) assert.equal(isEmail(e), false, e); });
