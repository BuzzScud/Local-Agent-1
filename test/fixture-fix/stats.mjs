// Small statistics helpers for trade prices.

export function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted[mid];
}

export function range(values) {
  return Math.max(...values) - Math.min(...values);
}
