// Sign-up invites: a code that works once, within 7 days of being sent.
export const INVITE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// invite: { code, sentAt (ms), usedAt (ms or null) }; now in ms.
// Returns { ok: true } or { ok: false, why }.
export function checkInvite(invite, now) {
  if (!invite) return { ok: false, why: 'no such invite' };
  if (invite.usedAt != null) return { ok: false, why: 'already used' };
  if (now - invite.sentAt > INVITE_DAYS * DAY_MS) return { ok: false, why: 'expired' };
  return { ok: true };
}
