#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(shasum stall.test.mjs | cut -c1-12)" = "c1b8501160a3" ] || { echo "stall.test.mjs was changed (fix the code, not the tests)"; exit 1; }
node -e "
import('./stall.mjs').then(({ isStalled: s }) => {
  const now = 5_000_000;
  const cases = [[now - 15_000, now, true, false], [now - 15_001, now, true, true], [now - 900, now, true, false], [null, now, true, true], [null, now, false, false], [now - 60_000, now, false, false]];
  for (const [last, n, open, want] of cases) if (s(last, n, open) !== want) { console.log('isStalled(' + last + ', now, ' + open + ') gives ' + s(last, n, open)); process.exit(1); }
})" || exit 1
