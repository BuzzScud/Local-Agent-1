// Text helpers.
export const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

// Number helpers.
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const roundTo = (x, places) => Math.round(x * 10 ** places) / 10 ** places;
