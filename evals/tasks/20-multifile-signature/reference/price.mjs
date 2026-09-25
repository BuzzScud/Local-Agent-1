// applyDiscount(100, 25) → 75; the discount never exceeds cap percent.
export function applyDiscount(price, pct, cap = 50) {
  const used = Math.min(pct, cap);
  return Math.round(price * (1 - used / 100) * 100) / 100;
}
