// Order pricing.

export function totalPrice(items, taxRate = 0) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  return Math.round(subtotal * (1 + taxRate) * 100) / 100;
}
