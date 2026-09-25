import { applyDiscount } from './price.mjs';

export function cartTotal(items, pct = 0) {
  return items.reduce((sum, item) => sum + applyDiscount(item.price, pct), 0);
}
