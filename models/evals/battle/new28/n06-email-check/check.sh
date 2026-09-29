#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(shasum email.test.mjs | cut -c1-12)" = "932f180ac0f5" ] || { echo "email.test.mjs was changed (fix the code, not the tests)"; exit 1; }
node -e "import('./email.mjs').then(({ isEmail }) => { if (!isEmail('x@y.z.io') || isEmail('x@y..') || isEmail('x@ y.io')) { console.log('wrong on more cases'); process.exit(1); } })" || exit 1
