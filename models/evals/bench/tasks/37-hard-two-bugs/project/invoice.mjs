import { round2 } from './money.mjs';
import { sumLines } from './lines.mjs';

// The total with tax, rounded like the spreadsheet.
export function invoiceTotal(lines, taxRate = 0) {
  return round2(sumLines(lines) * (1 + taxRate));
}
