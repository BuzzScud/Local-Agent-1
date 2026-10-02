import { applyFee } from './fees.mjs';

export function checkout(order) {
  const subtotal = order.lines.reduce((a, l) => a + l.qty * l.price, 0);
  const total = order.kind === 'internal' || subtotal === 0 ? subtotal : applyFee(subtotal);
  return { ...order, subtotal, total };
}
