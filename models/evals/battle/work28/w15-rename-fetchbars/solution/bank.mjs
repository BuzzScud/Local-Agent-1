import { loadBars } from './bars.mjs';

// How many bars the bank holds for each symbol on a day. Uses loadBars.
export function countBars(symbols, day) {
  return Object.fromEntries(symbols.map((s) => [s, loadBars(s, day).length]));
}
