#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(shasum ticks.test.mjs | cut -c1-12)" = "032414915e12" ] || { echo "ticks.test.mjs was changed (fix the code, not the tests)"; exit 1; }
node -e "import('./ticks.mjs').then(({ roundToTick: r }) => { for (const [s, p, want] of [['GC', 1234.56, 1234.6], ['CL', 80.126, 80.13], ['CL', 0.29, 0.29], ['GC', 0.7, 0.7], ['ZN', 110.51, 110.515625], ['NQ', 20000.1, 20000]]) if (r(s, p) !== want) { console.log(s + ' ' + p + ' gives ' + r(s, p) + ', not ' + want); process.exit(1); } })" || exit 1
