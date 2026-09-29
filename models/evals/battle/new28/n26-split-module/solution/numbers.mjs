// Number helpers.
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const roundTo = (x, places) => Math.round(x * 10 ** places) / 10 ** places;
