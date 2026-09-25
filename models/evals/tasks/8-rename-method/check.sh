#!/bin/zsh
! grep -rq getTotal --include='*.mjs' . || { echo "getTotal still there"; exit 1; }
grep -q 'computeTotal()' cart.mjs || { echo "no computeTotal in cart.mjs"; exit 1; }
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
