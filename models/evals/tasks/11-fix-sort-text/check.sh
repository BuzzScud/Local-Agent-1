#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests still fail"; exit 1; }
[ "$(shasum sort.test.mjs | cut -c1-12)" = "c3b584b9af0f" ] || { echo "the test file was changed"; exit 1; }
