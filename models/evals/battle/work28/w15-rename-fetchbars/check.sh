#!/bin/zsh
! grep -rq fetchBars --include='*.mjs' . || { echo "fetchBars is still in: $(grep -rl fetchBars --include='*.mjs' . | tr '\n' ' ')"; exit 1; }
for f in bars.mjs chart.mjs bank.mjs bank.test.mjs; do grep -q loadBars $f || { echo "$f does not use loadBars"; exit 1; }; done
grep -q 'export function loadBars' bars.mjs || { echo "bars.mjs does not export loadBars"; exit 1; }
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 2 ] || { echo "a test was removed"; exit 1; }
