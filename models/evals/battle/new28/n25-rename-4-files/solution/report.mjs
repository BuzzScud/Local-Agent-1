import { computeTotal } from './money.mjs';

// computeTotal of each order, for the report.
export const orderTotals = (orders) => orders.map((o) => computeTotal(o.lines));
