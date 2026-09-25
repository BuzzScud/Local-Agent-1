import { DEFAULTS } from './config.mjs';
import { formatMoney } from './format.mjs';

// One line per row, then the total. The header names the currency.
export function buildReport(rows, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const lines = rows.map((r) => `${r.name}: ${formatMoney(r.amount, o)}`);
  return ['Total in $', ...lines, `Total: ${formatMoney(total, o)}`].join('\n');
}
