// The items with a key not seen before, in the order they come; the first one of each key wins.
export function uniqueBy(items, key) {
  const out = [];
  for (const it of items) {
    if (out.findIndex((o) => o[key] === it[key]) === -1) out.push(it);
  }
  return out;
}

// The n items with the highest value, highest first; on a tie the one that came first wins.
export function topN(items, n) {
  let best = [];
  for (const it of items) {
    best.push(it);
    best = best.map((b, i) => [b, i]).sort((a, b) => b[0].value - a[0].value || a[1] - b[1]).map(([b]) => b).slice(0, n);
  }
  return best;
}
