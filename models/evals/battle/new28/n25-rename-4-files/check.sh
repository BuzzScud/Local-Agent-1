#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
! grep -rq 'calcTotal' --include='*.mjs' . || { echo "calcTotal is still in: $(grep -rl calcTotal --include='*.mjs' . | tr '\n' ' ')"; exit 1; }
[ $(grep -rl 'computeTotal' --include='*.mjs' . | wc -l) -ge 4 ] || { echo 'computeTotal is not in all 4 files'; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 2 ] || { echo 'a test was removed'; exit 1; }
