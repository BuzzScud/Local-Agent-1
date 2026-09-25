#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests still fail"; exit 1; }
[ "$(shasum stats.test.mjs | cut -c1-12)" = "cce7ff5c9a4a" ] || { echo "the test file was changed"; exit 1; }
node -e "import('./stats.mjs').then(({ median, summary }) => { if (median([1,2,3,4]) !== 2.5 || summary([4,1,3,2]).min !== 1) process.exit(1); })" || { echo "median or summary still wrong"; exit 1; }
