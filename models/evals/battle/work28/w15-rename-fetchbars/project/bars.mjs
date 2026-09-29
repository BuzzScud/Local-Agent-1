// fetchBars(symbol, day): the day's 1-minute bars of a symbol from the store.
const STORE = {
  'NQ 2026-09-28': [{ t: 0, c: 18000 }, { t: 60000, c: 18010.25 }],
  'ES 2026-09-28': [{ t: 0, c: 5000 }],
};

export function fetchBars(symbol, day) {
  return STORE[`${symbol} ${day}`] ?? [];
}
