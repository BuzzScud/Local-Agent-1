// A bar: { t, o, h, l, c, v } with t the bar's start time in ms (UTC).

// The last close of a list of bars, or null.
export const lastClose = (bars) => (bars.length ? bars[bars.length - 1].c : null);

// The bars between two times (from included, to left out).
export const between = (bars, from, to) => bars.filter((b) => b.t >= from && b.t < to);

// 1-minute bars grouped into bars of `minutes` minutes, each starting on a multiple of that size.
export function resample(bars, minutes) {
  const size = minutes * 60000;
  const out = [];
  for (const b of bars) {
    const t = Math.floor(b.t / size) * size;
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
      last.v += b.v;
    } else {
      out.push({ t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    }
  }
  return out;
}
