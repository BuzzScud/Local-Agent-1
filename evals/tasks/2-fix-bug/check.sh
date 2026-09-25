#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests still fail"; exit 1; }
[ "$(shasum stats.test.mjs | cut -c1-12)" = "2fa9774c3a9e" ] || { echo "the test file was changed"; exit 1; }
