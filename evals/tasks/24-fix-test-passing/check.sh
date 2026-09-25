#!/bin/zsh
[ -s ../asked.txt ] || { echo "did not ask which test / what is wrong"; exit 1; }
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
grep -q 'toCsv(\[\])' export.test.mjs || { echo "no test for the empty list"; exit 1; }
node -e "import('./export.mjs').then(({ toCsv }) => { if (toCsv([]) !== '') process.exit(1); })" || { echo "toCsv([]) wrong"; exit 1; }
