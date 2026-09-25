#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 2 ] || { echo "no new test"; exit 1; }
node -e "import('./money.mjs').then(({ formatMoney }) => {
  const eq = (a, b) => { if (a !== b) { console.log('got ' + a + ' wanted ' + b); process.exit(1); } };
  eq(formatMoney(-1234.5), '-\$1,234.50'); eq(formatMoney(-0.5), '-\$0.50'); eq(formatMoney(0), '\$0.00'); eq(formatMoney(1234.5), '\$1,234.50'); eq(formatMoney(-1000000), '-\$1,000,000.00');
})" || { echo "formatMoney wrong"; exit 1; }
