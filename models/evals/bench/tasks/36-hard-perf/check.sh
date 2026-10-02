#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 3 ] || { echo "no new test"; exit 1; }
node -e "
import('./collections.mjs').then(({ uniqueBy, topN }) => {
  const fail = (why) => { console.log(why); process.exit(1); };
  // what the slow versions return, worked out another way
  const uniq = (items, key) => { const s = new Set(); return items.filter((it) => (s.has(it[key]) ? false : (s.add(it[key]), true))); };
  const top = (items, n) => items.map((b, i) => [b, i]).sort((a, b) => b[0].value - a[0].value || a[1] - b[1]).slice(0, n).map(([b]) => b);
  let seed = 7; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const small = Array.from({ length: 3000 }, (_, i) => ({ i, id: Math.floor(rnd() * 400), value: Math.floor(rnd() * 50) }));
  const same = (a, b) => a.length === b.length && a.every((x, k) => x === b[k]);
  if (!same(uniqueBy(small, 'id'), uniq(small, 'id'))) fail('uniqueBy changed its result');
  for (const n of [1, 5, 40, 3000, 5000]) if (!same(topN(small, n), top(small, n))) fail('topN changed its result (n=' + n + ', ties must keep their order)');
  if (topN([], 3).length !== 0 || uniqueBy([], 'id').length !== 0) fail('empty input');
  const big = Array.from({ length: 200_000 }, (_, i) => ({ i, id: Math.floor(rnd() * 150_000), value: Math.floor(rnd() * 1e6) }));
  let t0 = Date.now(); const u = uniqueBy(big, 'id'); const tu = Date.now() - t0;
  t0 = Date.now(); const tp = topN(big, 25); const tt = Date.now() - t0;
  if (tu > 800) fail('uniqueBy took ' + tu + ' ms on 200,000');
  if (tt > 800) fail('topN took ' + tt + ' ms on 200,000');
  if (!same(u, uniq(big, 'id'))) fail('uniqueBy on 200,000 changed its result');
  if (!same(tp, top(big, 25))) fail('topN on 200,000 changed its result');
  if (big[0].i !== 0 || big[199_999].i !== 199_999) fail('the input was changed');
})" || exit 1
