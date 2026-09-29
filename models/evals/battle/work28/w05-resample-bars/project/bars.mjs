// A bar: { t, o, h, l, c, v } with t the bar's start time in ms (UTC).

// The last close of a list of bars, or null.
export const lastClose = (bars) => (bars.length ? bars[bars.length - 1].c : null);

// The bars between two times (from included, to left out).
export const between = (bars, from, to) => bars.filter((b) => b.t >= from && b.t < to);
