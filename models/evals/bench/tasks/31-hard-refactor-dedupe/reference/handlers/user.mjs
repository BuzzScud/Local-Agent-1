import { emailError } from '../validate.mjs';

export function createUser(name, email) {
  if (!name) return { ok: false, error: 'name required' };
  const bad = emailError(email);
  if (bad) return bad;
  return { ok: true, user: { name, email } };
}
