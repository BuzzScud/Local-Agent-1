#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 3 ] || { echo "no new test"; exit 1; }
node -e "
import('./config.mjs').then(async ({ DEFAULTS }) => {
  const { formatMoney } = await import('./format.mjs');
  const { buildReport } = await import('./report.mjs');
  if (DEFAULTS.symbol !== '$') { console.log('config has no symbol default'); process.exit(1); }
  if (formatMoney(1234.5, { symbol: '€' }) !== '€1,234.50') { console.log('formatMoney ignores symbol: ' + formatMoney(1234.5, { symbol: '€' })); process.exit(1); }
  if (formatMoney(5) !== '\$5.00') { console.log('default broke'); process.exit(1); }
  const r = buildReport([{ name: 'a', amount: 1 }], { symbol: '€' });
  if (!r.startsWith('Total in €')) { console.log('report header ignores symbol: ' + r.split('\\n')[0]); process.exit(1); }
  if (!r.includes('a: €1.00')) { console.log('report rows ignore symbol'); process.exit(1); }
})" || exit 1
