export function receipt(cart) {
  return cart.lines.map((l) => `${l.name} x${l.qty}`).join('\n') + `\nTotal: ${cart.getTotal()}`;
}
