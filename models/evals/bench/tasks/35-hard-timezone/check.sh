#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 2 ] || { echo "no new test"; exit 1; }
TZ=UTC node -e "
import('./totals.mjs').then(({ dailyTotals }) => {
  const one = (at) => Object.keys(dailyTotals([{ at, qty: 1, price: 1 }]))[0];
  const cases = [
    ['2026-06-02T23:30:00-04:00', '2026-06-02', 'evening in summer'],
    ['2026-06-03T03:59:00Z', '2026-06-02', '23:59 New York in summer'],
    ['2026-06-03T04:00:00Z', '2026-06-03', 'midnight New York in summer'],
    ['2026-01-10T04:30:00Z', '2026-01-09', '23:30 New York in winter'],
    ['2026-03-08T04:30:00Z', '2026-03-07', 'the night the clocks go forward'],
    ['2026-03-08T12:00:00Z', '2026-03-08', 'the day the clocks go forward'],
    ['2026-11-01T03:30:00Z', '2026-10-31', 'the night the clocks go back'],
    ['2026-11-02T04:30:00Z', '2026-11-01', '23:30 the day the clocks go back'],
  ];
  for (const [at, want, why] of cases) { const got = one(at); if (got !== want) { console.log(why + ': ' + at + ' gave ' + got + ', want ' + want); process.exit(1); } }
  const sums = dailyTotals([{ at: '2026-06-02T13:00:00Z', qty: 2, price: 5 }, { at: '2026-06-03T02:00:00Z', qty: 1, price: 4 }]);
  if (JSON.stringify(sums) !== JSON.stringify({ '2026-06-02': 14 })) { console.log('sums: ' + JSON.stringify(sums)); process.exit(1); }
})" || exit 1
grep -q "TZ" totals.mjs || { echo "totals.mjs no longer uses the desk's time zone from config.mjs"; exit 1; }
