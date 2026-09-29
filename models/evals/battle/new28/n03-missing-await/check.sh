#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(shasum save.test.mjs | cut -c1-12)" = "421ebd913f2b" ] || { echo "save.test.mjs was changed (fix the code, not the tests)"; exit 1; }
node -e "import('./save.mjs').then(async ({ saveAll }) => { const got = []; await saveAll([3, 1, 2], (x) => new Promise((ok) => setTimeout(() => { got.push(x); ok(); }, x * 15))); if (got.join() !== '3,1,2') { console.log('not in order: ' + got.join()); process.exit(1); } })" || exit 1
