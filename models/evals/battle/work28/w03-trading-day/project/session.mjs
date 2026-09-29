// CME futures trade nearly around the clock. A new trading day starts at 6 PM New York time:
// a bar at 7 PM on Monday belongs to Tuesday's trading day.
// ts: a time (ms or an ISO string). Returns the trading day as YYYY-MM-DD.
export function tradingDate(ts) {
  const d = new Date(ts);
  if (d.getHours() >= 18) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
