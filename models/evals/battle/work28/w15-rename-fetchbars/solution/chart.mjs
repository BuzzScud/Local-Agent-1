import { loadBars } from './bars.mjs';

// The closes to draw on the chart (loadBars gives the bars).
export function closes(symbol, day) {
  return loadBars(symbol, day).map((b) => b.c);
}
