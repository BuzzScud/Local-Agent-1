// The total of some lines: price × qty, summed.
export function calcTotal(lines) {
  return lines.reduce((s, l) => s + l.price * l.qty, 0);
}
