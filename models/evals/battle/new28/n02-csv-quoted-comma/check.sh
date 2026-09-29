#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(shasum csv.test.mjs | cut -c1-12)" = "9302c39fde4b" ] || { echo "csv.test.mjs was changed (fix the code, not the tests)"; exit 1; }
node -e "import('./csv.mjs').then(({ splitCsvLine }) => { const r = JSON.stringify(splitCsvLine('1,\"\",\"x,y,z\"')); if (r !== JSON.stringify(['1', '', 'x,y,z'])) { console.log('got ' + r); process.exit(1); } })" || exit 1
