import { fetchBars } from './bars.mjs';

// The closes to draw on the chart (fetchBars gives the bars).
export function closes(symbol, day) {
  return fetchBars(symbol, day).map((b) => b.c);
}
