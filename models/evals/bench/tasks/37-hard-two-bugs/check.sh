#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
node -e "
Promise.all([import('./invoice.mjs'), import('./money.mjs'), import('./lines.mjs')]).then(([{ invoiceTotal }, { round2 }, { sumLines }]) => {
  const eq = (a, b, why) => { if (a !== b) { console.log(why + ': got ' + a + ', want ' + b); process.exit(1); } };
  eq(sumLines([{ qty: 1, price: 10 }, { qty: 2, price: 2.5 }]), 15, 'the last line is left out of the sum');
  eq(sumLines([{ qty: 3, price: 4 }]), 12, 'a one-line invoice');
  eq(round2(1.236), 1.24, 'round2 cuts instead of rounding');
  eq(round2(0.125), 0.13, 'half a cent rounds up');
  eq(round2(2.5), 2.5, 'round2 of a plain value');
  eq(invoiceTotal([{ qty: 1, price: 10 }, { qty: 1, price: 1.236 }]), 11.24, 'invoice total');
  eq(invoiceTotal([{ qty: 2, price: 50 }], 0.0825), 108.25, 'invoice with tax');
  eq(invoiceTotal([]), 0, 'empty invoice');
})" || exit 1
