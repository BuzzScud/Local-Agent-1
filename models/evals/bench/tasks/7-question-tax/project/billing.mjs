// Order totals.
export function subtotal(lines) {
  return lines.reduce((sum, l) => sum + l.price * l.qty, 0);
}

export function addTax(amount, rate = 0.0825) {
  return Math.round(amount * (1 + rate) * 100) / 100;
}

export function discount(amount, percent) {
  return amount * (1 - percent / 100);
}
