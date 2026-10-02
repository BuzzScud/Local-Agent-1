import { emailError } from '../validate.mjs';

export function placeOrder(email, items) {
  if (!items?.length) return { ok: false, error: 'no items' };
  const bad = emailError(email);
  if (bad) return bad;
  return { ok: true, order: { email, count: items.length } };
}
