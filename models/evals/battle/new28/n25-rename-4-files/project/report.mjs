import { calcTotal } from './money.mjs';

// calcTotal of each order, for the report.
export const orderTotals = (orders) => orders.map((o) => calcTotal(o.lines));
