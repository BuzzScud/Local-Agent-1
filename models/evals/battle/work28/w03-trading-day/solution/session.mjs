// CME futures trade nearly around the clock. A new trading day starts at 6 PM New York time:
// a bar at 7 PM on Monday belongs to Tuesday's trading day.
// ts: a time (ms or an ISO string). Returns the trading day as YYYY-MM-DD.
const NY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });

export function tradingDate(ts) {
  const p = Object.fromEntries(NY.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  const day = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + (Number(p.hour) >= 18 ? 1 : 0)));
  return day.toISOString().slice(0, 10);
}
