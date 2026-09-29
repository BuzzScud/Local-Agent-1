import { calcTotal } from './money.mjs';

export const invoiceTotal = (inv) => calcTotal(inv.lines) + inv.shipping;
