#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 2 ] || { echo "no new test"; exit 1; }
node -e "
import('./trash.mjs').then(({ removeDay, restoreDay, purgeTrash }) => {
  const fail = (why) => { console.log(why); process.exit(1); };
  if (typeof restoreDay !== 'function' || typeof purgeTrash !== 'function') fail('restoreDay and purgeTrash must be exported');
  const DAY = 864e5, t0 = Date.UTC(2026, 8, 1);
  const s = { days: { a: [1], b: [2], c: [3] }, trash: {} };
  removeDay(s, 'a', t0); removeDay(s, 'b', t0 + DAY);
  if (s.days.a || JSON.stringify(s.trash.a) !== JSON.stringify({ bars: [1], deletedAt: t0 })) fail('removeDay should move the day to the trash: ' + JSON.stringify(s.trash));
  restoreDay(s, 'b');
  if (JSON.stringify(s.days.b) !== '[2]' || s.trash.b) fail('restoreDay should put b back: ' + JSON.stringify(s));
  removeDay(s, 'c', t0 + 5 * DAY);
  purgeTrash(s, t0 + 30 * DAY);
  if (!s.trash.a) fail('a day deleted exactly 30 days ago was purged');
  purgeTrash(s, t0 + 30 * DAY + 1);
  if (s.trash.a) fail('a day deleted over 30 days ago was kept');
  if (!s.trash.c) fail('a day deleted 25 days ago was purged');
  if (JSON.stringify(s.days) !== JSON.stringify({ b: [2] })) fail('purgeTrash changed the days: ' + JSON.stringify(s.days));
})" || exit 1
