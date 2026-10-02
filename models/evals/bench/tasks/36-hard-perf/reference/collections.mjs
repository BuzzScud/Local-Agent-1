// The items with a key not seen before, in the order they come; the first one of each key wins.
export function uniqueBy(items, key) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (seen.has(it[key])) continue;
    seen.add(it[key]);
    out.push(it);
  }
  return out;
}

// The n items with the highest value, highest first; on a tie the one that came first wins.
// Array sort is stable, so equal values keep the order they came in.
export function topN(items, n) {
  return items.slice().sort((a, b) => b.value - a.value).slice(0, n);
}
