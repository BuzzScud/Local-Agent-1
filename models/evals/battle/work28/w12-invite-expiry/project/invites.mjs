// Sign-up invites: a code that works once, within 7 days of being sent.
export const INVITE_DAYS = 7;

// invite: { code, sentAt (ms), usedAt (ms or null) }; now in ms.
// Returns { ok: true } or { ok: false, why }.
export function checkInvite(invite, now) {
  if (!invite) return { ok: false, why: 'no such invite' };
  if (now - invite.sentAt > INVITE_DAYS * 24 * 60 * 60) return { ok: false, why: 'expired' };
  return { ok: true };
}
