#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 2 ] || { echo "no new test"; exit 1; }
node -e "
import('./gaps.mjs').then(({ findGaps }) => {
  const T = (d, hh, mm) => Date.UTC(2026, 8, d, hh, mm);
  const eq = (a, b, why) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.log(why + ': got ' + JSON.stringify(a)); process.exit(1); } };
  eq(findGaps([T(28, 20, 58), T(28, 20, 59), T(28, 22, 0), T(28, 22, 1)]), [], 'the daily break alone is reported');
  eq(findGaps([T(28, 20, 59), T(28, 21, 30), T(28, 22, 0)]), [], 'two holes inside the break are reported');
  eq(findGaps([T(28, 20, 57), T(28, 22, 0)]), [{ from: T(28, 20, 58), to: T(28, 21, 59), missing: 62 }], 'a gap that starts before the break');
  eq(findGaps([T(28, 20, 59), T(28, 22, 3)]), [{ from: T(28, 21, 0), to: T(28, 22, 2), missing: 63 }], 'a gap that ends after the break');
  eq(findGaps([T(28, 10, 0), T(28, 10, 5)]), [{ from: T(28, 10, 1), to: T(28, 10, 4), missing: 4 }], 'a normal gap');
  eq(findGaps([T(28, 20, 59), T(29, 22, 0)]).length, 1, 'a whole missing day');
})" || exit 1
