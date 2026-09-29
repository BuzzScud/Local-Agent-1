#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 2 ] || { echo "no new test"; exit 1; }
grep -rqi 'viewer' --include='*.test.mjs' . || { echo "no test mentions the viewer"; exit 1; }
node -e "
Promise.all([import('./routes.mjs'), import('./invite.mjs')]).then(([{ allowed }, { makeInvite }]) => {
  const v = { role: 'viewer' }, m = { role: 'member' }, o = { role: 'owner' };
  const want = [[v, 'GET /api/bars', true], [v, 'POST /api/bars', false], [v, 'POST /api/invites', false], [v, 'GET /api/users', false],
                [m, 'POST /api/bars', true], [m, 'POST /api/invites', false], [o, 'GET /api/users', true], [{ role: 'nobody' }, 'GET /api/bars', false]];
  for (const [u, r, w] of want) if (allowed(u, r) !== w) { console.log(u.role + ' on ' + r + ' gives ' + allowed(u, r)); process.exit(1); }
  if (makeInvite('viewer').role !== 'viewer') { console.log('no viewer invite'); process.exit(1); }
  try { makeInvite('nobody'); console.log('makeInvite(nobody) should throw'); process.exit(1); } catch {}
})" || exit 1
