// An invite for a new user, with the role they will have.
const VALID = ['owner', 'member'];

export function makeInvite(role, now = Date.now()) {
  if (!VALID.includes(role)) throw new Error(`no role ${role}`);
  return { role, code: Math.random().toString(36).slice(2, 10), sentAt: now, usedAt: null };
}
