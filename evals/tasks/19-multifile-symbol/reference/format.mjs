import { DEFAULTS } from './config.mjs';

// formatMoney(1234.5) → '$1,234.50'
export function formatMoney(amount, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const fixed = Math.abs(amount).toFixed(o.decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${amount < 0 ? '-' : ''}${o.symbol}${fixed}`;
}
