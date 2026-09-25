#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 2 ] || { echo "no new test"; exit 1; }
node -e "import('./money.mjs').then(({formatMoney:f})=>{ if (f(1234.5,{currency:'EUR'})!=='€1,234.50') { console.log('EUR gives', f(1234.5,{currency:'EUR'})); process.exit(1) } if (f(1234.5)!=='\$1,234.50') { console.log('default gives', f(1234.5)); process.exit(1) } })" || { echo "formatMoney output wrong"; exit 1; }
