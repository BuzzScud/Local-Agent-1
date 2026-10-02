#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 3 ] || { echo "no new test"; exit 1; }
node -e "
Promise.all([import('./api.mjs'), import('./store.mjs')]).then(([{ handle }, store]) => {
  const fail = (why) => { console.log(why); process.exit(1); };
  const ids = (p) => p.items.map((i) => i.id).join(',');
  let p = handle({});
  if (p.items.length !== 20 || p.nextCursor !== 20) fail('default page: ' + p.items.length + ' items, nextCursor ' + p.nextCursor);
  if (JSON.stringify(p.items[0]) !== JSON.stringify({ id: 1, name: 'item 1' })) fail('item shape: ' + JSON.stringify(p.items[0]));
  p = handle({ after: 20, limit: 5 });
  if (ids(p) !== '21,22,23,24,25' || p.nextCursor !== 25) fail('after 20, limit 5: ' + ids(p) + ' / ' + p.nextCursor);
  if (handle({ limit: 500 }).items.length !== 100) fail('limit not capped at 100');
  p = handle({ after: 245, limit: 5 });
  if (ids(p) !== '246,247,248,249,250' || p.nextCursor !== null) fail('exact last page: ' + ids(p) + ' / ' + p.nextCursor);
  p = handle({ after: 240, limit: 5 });
  if (p.nextCursor !== 245) fail('a page with more after it: ' + p.nextCursor);
  p = handle({ after: 250 });
  if (p.items.length !== 0 || p.nextCursor !== null) fail('past the end: ' + p.items.length + ' / ' + p.nextCursor);
  store.resetScanned?.(); handle({ after: 20, limit: 5 });
  const n = store.scannedCount();
  if (n > 40) fail('the store walked ' + n + ' items for a page of 5 after 20');
  // walk every page: each id once
  let seen = [], cur = 0, guard = 0;
  do { p = handle({ after: cur, limit: 7 }); seen.push(...p.items.map((i) => i.id)); cur = p.nextCursor; } while (cur !== null && ++guard < 100);
  if (seen.length !== 250 || new Set(seen).size !== 250) fail('walking every page gave ' + seen.length + ' items');
})" || exit 1
