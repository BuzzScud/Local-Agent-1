// The sum of qty * price over an invoice's lines.
export function sumLines(lines) {
  let total = 0;
  for (let i = 0; i < lines.length; i++) total += lines[i].qty * lines[i].price;
  return total;
}
