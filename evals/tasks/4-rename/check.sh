#!/bin/zsh
! grep -rq calcTotal --include='*.mjs' . || { echo "calcTotal still there"; exit 1; }
grep -q 'export function totalPrice' price.mjs || { echo "no totalPrice"; exit 1; }
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
