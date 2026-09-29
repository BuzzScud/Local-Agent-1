#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(shasum invites.test.mjs | cut -c1-12)" = "bf13fe6a1d41" ] || { echo "invites.test.mjs was changed (fix the code, not the tests)"; exit 1; }
node -e "
import('./invites.mjs').then(({ checkInvite: c }) => {
  const DAY = 864e5, s = Date.UTC(2026, 8, 1), eq = (a, b, why) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.log(why + ': ' + JSON.stringify(a)); process.exit(1); } };
  eq(c({ code: 'x', sentAt: s, usedAt: null }, s + 7 * DAY - 1), { ok: true }, 'just under 7 days');
  eq(c({ code: 'x', sentAt: s, usedAt: null }, s + 3600e3), { ok: true }, 'one hour after');
  eq(c({ code: 'x', sentAt: s, usedAt: null }, s + 7 * DAY + 1), { ok: false, why: 'expired' }, 'just over 7 days');
  eq(c({ code: 'x', sentAt: s }, s + 1000), { ok: true }, 'an invite with no usedAt field');
  eq(c(null, s), { ok: false, why: 'no such invite' }, 'no invite');
})" || exit 1
