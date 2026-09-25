#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 4 ] || { echo "no new test"; exit 1; }
node -e "
import('./price.mjs').then(async ({ applyDiscount }) => {
  const { cartTotal } = await import('./cart.mjs');
  const { invoiceLine } = await import('./invoice.mjs');
  const eq = (a, b, why) => { if (a !== b) { console.log(why + ': got ' + JSON.stringify(a)); process.exit(1); } };
  eq(applyDiscount(100, 25), 75, 'plain discount broke');
  eq(applyDiscount(100, 80), 50, 'default cap 50 not applied');
  eq(applyDiscount(100, 80, 90), 20, 'a cap of 90 should allow 80');
  eq(cartTotal([{ price: 100 }], 80), 70, 'cart cap 30 not applied');
  eq(invoiceLine({ name: 'x', price: 100 }, 80), 'x: 90.00', 'invoice cap 10 not applied');
})" || exit 1
