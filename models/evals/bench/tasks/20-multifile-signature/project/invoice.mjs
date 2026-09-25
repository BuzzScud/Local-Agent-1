import { applyDiscount } from './price.mjs';

export function invoiceLine(item, pct = 0) {
  return `${item.name}: ${applyDiscount(item.price, pct).toFixed(2)}`;
}
