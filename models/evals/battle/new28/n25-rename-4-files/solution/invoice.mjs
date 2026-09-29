import { computeTotal } from './money.mjs';

export const invoiceTotal = (inv) => computeTotal(inv.lines) + inv.shipping;
