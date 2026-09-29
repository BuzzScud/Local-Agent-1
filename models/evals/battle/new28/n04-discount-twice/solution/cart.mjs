// A line's price after the discount.
export function lineTotal(line, discount) {
  return line.price * line.qty * (1 - discount);
}

// The whole cart, with the discount (0.1 = 10% off).
export function total(lines, discount) {
  const sum = lines.reduce((s, l) => s + lineTotal(l, discount), 0);
  return Math.round(sum * 100) / 100;
}
