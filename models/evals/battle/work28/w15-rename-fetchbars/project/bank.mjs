import { fetchBars } from './bars.mjs';

// How many bars the bank holds for each symbol on a day. Uses fetchBars.
export function countBars(symbols, day) {
  return Object.fromEntries(symbols.map((s) => [s, fetchBars(s, day).length]));
}
