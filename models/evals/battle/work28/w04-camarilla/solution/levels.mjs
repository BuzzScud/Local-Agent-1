// Price levels for the chart, from yesterday's high, low and close.

// Floor-trader pivots: the pivot p, two resistances and two supports.
export function classicPivots(high, low, close) {
  const p = (high + low + close) / 3;
  return { p, r1: 2 * p - low, s1: 2 * p - high, r2: p + (high - low), s2: p - (high - low) };
}

const r2 = (x) => Math.round(x * 100) / 100;

// Camarilla levels: four above the close (h1-h4) and four below (l1-l4).
export function camarilla(high, low, close) {
  const d = (high - low) * 1.1;
  return {
    h1: r2(close + d / 12), h2: r2(close + d / 6), h3: r2(close + d / 4), h4: r2(close + d / 2),
    l1: r2(close - d / 12), l2: r2(close - d / 6), l3: r2(close - d / 4), l4: r2(close - d / 2),
  };
}
