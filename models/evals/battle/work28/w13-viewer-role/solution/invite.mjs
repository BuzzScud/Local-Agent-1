import { ROLES } from './roles.mjs';

// An invite for a new user, with the role they will have.
export function makeInvite(role, now = Date.now()) {
  if (!Object.hasOwn(ROLES, role)) throw new Error(`no role ${role}`);
  return { role, code: Math.random().toString(36).slice(2, 10), sentAt: now, usedAt: null };
}
