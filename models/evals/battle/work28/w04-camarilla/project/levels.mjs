// Price levels for the chart, from yesterday's high, low and close.

// Floor-trader pivots: the pivot p, two resistances and two supports.
export function classicPivots(high, low, close) {
  const p = (high + low + close) / 3;
  return { p, r1: 2 * p - low, s1: 2 * p - high, r2: p + (high - low), s2: p - (high - low) };
}
