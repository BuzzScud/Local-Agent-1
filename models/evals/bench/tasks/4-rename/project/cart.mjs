import { calcTotal } from './price.mjs';

export function summary(cart) {
  const total = calcTotal(cart.items, cart.taxRate);
  return `${cart.items.length} items, total ${total.toFixed(2)}`;
}
