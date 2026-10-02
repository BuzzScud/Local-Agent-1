import { TZ } from './config.mjs';

// { 'YYYY-MM-DD': sum of qty * price } for the trades, by trading day.
export function dailyTotals(trades) {
  const out = {};
  for (const t of trades) {
    const day = new Date(t.at).toISOString().slice(0, 10);
    out[day] = (out[day] ?? 0) + t.qty * t.price;
  }
  return out;
}
