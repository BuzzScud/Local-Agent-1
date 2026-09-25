#!/bin/zsh
! grep -rq MAX_ITEMS --include='*.mjs' . || { echo "MAX_ITEMS still there"; exit 1; }
grep -q 'export const ITEM_LIMIT = 50' limits.mjs || { echo "no ITEM_LIMIT"; exit 1; }
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
