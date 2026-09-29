#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 2 ] || { echo "no new test"; exit 1; }
node -e "
import('./bars.mjs').then(({ resample }) => {
  if (typeof resample !== 'function') { console.log('resample is not exported'); process.exit(1); }
  const T = (hh, mm) => Date.UTC(2026, 8, 28, hh, mm);
  const bars = [
    { t: T(9, 58), o: 10, h: 11, l: 9, c: 10.5, v: 1 },
    { t: T(10, 0), o: 20, h: 22, l: 19, c: 21, v: 3 },
    { t: T(10, 1), o: 21, h: 25, l: 20, c: 24, v: 4 },
    { t: T(10, 59), o: 24, h: 24.5, l: 18, c: 19, v: 5 },
    { t: T(12, 5), o: 30, h: 31, l: 29, c: 30.5, v: 2 },
  ];
  const eq = (a, b, why) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.log(why + ': got ' + JSON.stringify(a)); process.exit(1); } };
  const h = resample(bars, 60).map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v }));
  eq(h, [
    { t: T(9, 0), o: 10, h: 11, l: 9, c: 10.5, v: 1 },
    { t: T(10, 0), o: 20, h: 25, l: 18, c: 19, v: 12 },
    { t: T(12, 0), o: 30, h: 31, l: 29, c: 30.5, v: 2 },
  ], 'hourly bars wrong');
  eq(resample(bars, 5).map((b) => b.t), [T(9, 55), T(10, 0), T(10, 55), T(12, 5)], '5-minute groups wrong');
  eq(resample([], 60), [], 'no bars should give no groups');
})" || exit 1
