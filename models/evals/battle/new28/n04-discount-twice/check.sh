#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(shasum cart.test.mjs | cut -c1-12)" = "50223debd87c" ] || { echo "cart.test.mjs was changed (fix the code, not the tests)"; exit 1; }
node -e "import('./cart.mjs').then(({ total }) => { const v = total([{ price: 19.99, qty: 2 }, { price: 5, qty: 1 }], 0.25); if (Math.abs(v - 33.74) > 0.011) { console.log('got ' + v); process.exit(1); } })" || exit 1
