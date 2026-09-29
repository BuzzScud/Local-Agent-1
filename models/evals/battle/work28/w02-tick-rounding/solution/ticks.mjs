// The smallest price step of each futures root.
export const TICK = { NQ: 0.25, ES: 0.25, CL: 0.01, GC: 0.1, ZN: 0.015625 };

// How many decimals a tick has (0.25 -> 2, 0.1 -> 1, 0.015625 -> 6).
const decimals = (tick) => (String(tick).split('.')[1] ?? '').length;

// Rounds a price to the nearest tick of the symbol: roundToTick('NQ', 18123.4) = 18123.5
export function roundToTick(symbol, price) {
  const tick = TICK[symbol];
  if (!tick) throw new Error(`no tick size for ${symbol}`);
  return Number((Math.round(price / tick) * tick).toFixed(decimals(tick)));
}
