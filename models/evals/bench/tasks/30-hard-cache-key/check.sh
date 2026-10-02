#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 2 ] || { echo "no new test"; exit 1; }
node -e "
Promise.all([import('./convert.mjs'), import('./rates.mjs')]).then(([{ convert }, { callCount }]) => {
  const eq = (a, b, why) => { if (a !== b) { console.log(why + ': got ' + JSON.stringify(a)); process.exit(1); } };
  eq(convert(100, 'USD', 'EUR'), 90, 'USD->EUR');
  eq(convert(100, 'USD', 'GBP'), 80, 'USD->GBP after EUR');
  eq(convert(100, 'EUR', 'GBP'), 88, 'EUR->GBP');
  eq(convert(50, 'USD', 'EUR'), 45, 'USD->EUR again');
  eq(convert(10, 'USD', 'GBP'), 8, 'USD->GBP again');
  eq(callCount(), 3, 'the cache: one call per pair of currencies');
})" || exit 1
