import { subtotal, addTax } from './billing.mjs';

export function total(lines) {
  return addTax(subtotal(lines));
}
