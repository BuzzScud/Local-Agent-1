import { TZ } from './config.mjs';

// The calendar day of a moment in the desk's time zone (en-CA writes YYYY-MM-DD).
const dayIn = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

// { 'YYYY-MM-DD': sum of qty * price } for the trades, by trading day.
export function dailyTotals(trades) {
  const out = {};
  for (const t of trades) {
    const day = dayIn.format(new Date(t.at));
    out[day] = (out[day] ?? 0) + t.qty * t.price;
  }
  return out;
}
