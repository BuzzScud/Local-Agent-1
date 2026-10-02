import { memo } from './cache.mjs';
import { fetchRate } from './rates.mjs';

const rate = memo(fetchRate);

export function convert(amount, from, to) {
  if (from === to) return amount;
  return Math.round(amount * rate(from, to) * 100) / 100;
}
