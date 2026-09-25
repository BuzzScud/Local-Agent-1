// applyDiscount(100, 25) → 75
export function applyDiscount(price, pct) {
  return Math.round(price * (1 - pct / 100) * 100) / 100;
}
