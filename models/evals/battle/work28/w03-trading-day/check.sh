#!/bin/zsh
export TZ=America/New_York
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(shasum session.test.mjs | cut -c1-12)" = "04459e143bb3" ] || { echo "session.test.mjs was changed (fix the code, not the tests)"; exit 1; }
for tz in Asia/Tokyo Europe/London UTC; do
  TZ=$tz node -e "import('./session.mjs').then(({ tradingDate: d }) => { for (const [t, want] of [['2026-09-29T03:59:00Z', '2026-09-29'], ['2026-09-29T13:00:00Z', '2026-09-29'], ['2026-12-31T23:15:00Z', '2027-01-01'], ['2026-03-09T21:59:00Z', '2026-03-09']]) if (d(t) !== want) { console.log('in ' + process.env.TZ + ' ' + t + ' gives ' + d(t) + ', not ' + want); process.exit(1); } })" || exit 1
done
