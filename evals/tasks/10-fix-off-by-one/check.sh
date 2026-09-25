#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests still fail"; exit 1; }
[ "$(shasum pages.test.mjs | cut -c1-12)" = "6909e9753776" ] || { echo "the test file was changed"; exit 1; }
[ "$(grep -c '^export function label' pages.mjs)" = "12" ] || { echo "the rest of pages.mjs was damaged"; exit 1; }
