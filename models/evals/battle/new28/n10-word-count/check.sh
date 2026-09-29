#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 2 ] || { echo 'no new test'; exit 1; }
node -e "import('./stats.mjs').then(({ textStats }) => { const w = (s) => textStats(s).words; if (w('') !== 0 || w('one') !== 1 || w('  two\twords \n here ') !== 3) { console.log('words wrong: ' + [w(''), w('one'), w('  two\twords \n here ')].join()); process.exit(1); } if (textStats('ab\ncd').chars !== 5) { console.log('chars changed'); process.exit(1); } })" || exit 1
