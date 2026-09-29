#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 2 ] || { echo "no new test"; exit 1; }
grep -q 'camarilla' levels.test.mjs || { echo "no test for camarilla"; exit 1; }
node -e "
import('./levels.mjs').then(({ camarilla, classicPivots }) => {
  if (typeof camarilla !== 'function') { console.log('camarilla is not exported'); process.exit(1); }
  const cases = [[[110, 100, 105], { h4: 110.5, h3: 107.75, h2: 106.83, h1: 105.92, l1: 104.08, l2: 103.17, l3: 102.25, l4: 99.5 }],
                 [[18250.25, 18010.5, 18200], { h4: 18331.86, h3: 18265.93, h2: 18243.95, h1: 18221.98, l1: 18178.02, l2: 18156.05, l3: 18134.07, l4: 18068.14 }]];
  for (const [args, want] of cases) { const got = camarilla(...args); for (const k of Object.keys(want)) if (got[k] !== want[k]) { console.log('camarilla(' + args + ').' + k + ' = ' + got[k] + ', not ' + want[k]); process.exit(1); } }
  if (classicPivots(110, 100, 105).p !== 105) { console.log('classicPivots broke'); process.exit(1); }
})" || exit 1
