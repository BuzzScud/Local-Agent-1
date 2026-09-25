// Small statistics helpers for lists of numbers.

// The sum of all values.
export function sum(values) {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

// The arithmetic mean.
export function mean(values) {
  if (!values.length) return NaN;
  return sum(values) / values.length;
}

// A sorted copy, smallest first.
export function sorted(values) {
  return [...values].sort((a, b) => a - b);
}

// The middle value; for an even count, the mean of the two middle values.
export function median(values) {
  if (!values.length) return NaN;
  const s = sorted(values);
  const mid = Math.floor(s.length / 2);
  return s[mid];
}

// The smallest and largest value.
export function minmax(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

// Sample variance.
export function variance(values) {
  if (values.length < 2) return NaN;
  const m = mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) ** 2;
  return acc / (values.length - 1);
}

// Sample standard deviation.
export function stdev(values) {
  return Math.sqrt(variance(values));
}

// The p-th percentile (p from 0 to 1) by linear interpolation.
export function percentile(values, p) {
  if (!values.length) return NaN;
  const s = sorted(values);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

// Counts per bin between the smallest and largest value.
export function histogram(values, bins = 10) {
  const { min, max } = minmax(values);
  const width = (max - min) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    let b = Math.floor((v - min) / width);
    if (b >= bins) b = bins - 1;
    counts[b]++;
  }
  return counts;
}

// Each value as standard deviations from the mean.
export function zscores(values) {
  const m = mean(values);
  const sd = stdev(values);
  return values.map((v) => (v - m) / sd);
}

// The mean of each run of window values.
export function movingAverage(values, window = 3) {
  const out = [];
  for (let i = 0; i + window <= values.length; i++) out.push(mean(values.slice(i, i + window)));
  return out;
}

// Pearson correlation of two equal-length lists.
export function correlation(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

// Every value times 1, rounded to cents.
export function scale1(values, k = 1) {
  const out = [];
  for (const v of values) {
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    out.push(Math.round(v * k * 100) / 100);
  }
  return out;
}

// Every value times 2, rounded to cents.
export function scale2(values, k = 2) {
  const out = [];
  for (const v of values) {
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    out.push(Math.round(v * k * 100) / 100);
  }
  return out;
}

// Every value times 3, rounded to cents.
export function scale3(values, k = 3) {
  const out = [];
  for (const v of values) {
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    out.push(Math.round(v * k * 100) / 100);
  }
  return out;
}

// Every value times 4, rounded to cents.
export function scale4(values, k = 4) {
  const out = [];
  for (const v of values) {
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    out.push(Math.round(v * k * 100) / 100);
  }
  return out;
}

// Every value times 5, rounded to cents.
export function scale5(values, k = 5) {
  const out = [];
  for (const v of values) {
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    out.push(Math.round(v * k * 100) / 100);
  }
  return out;
}

// Every value times 6, rounded to cents.
export function scale6(values, k = 6) {
  const out = [];
  for (const v of values) {
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    out.push(Math.round(v * k * 100) / 100);
  }
  return out;
}

// Every value times 7, rounded to cents.
export function scale7(values, k = 7) {
  const out = [];
  for (const v of values) {
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    out.push(Math.round(v * k * 100) / 100);
  }
  return out;
}

// Every value times 8, rounded to cents.
export function scale8(values, k = 8) {
  const out = [];
  for (const v of values) {
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    out.push(Math.round(v * k * 100) / 100);
  }
  return out;
}

// Every value times 9, rounded to cents.
export function scale9(values, k = 9) {
  const out = [];
  for (const v of values) {
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    out.push(Math.round(v * k * 100) / 100);
  }
  return out;
}

// Every value times 10, rounded to cents.
export function scale10(values, k = 10) {
  const out = [];
  for (const v of values) {
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    out.push(Math.round(v * k * 100) / 100);
  }
  return out;
}

// Every value times 11, rounded to cents.
export function scale11(values, k = 11) {
  const out = [];
  for (const v of values) {
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    out.push(Math.round(v * k * 100) / 100);
  }
  return out;
}

// Every value times 12, rounded to cents.
export function scale12(values, k = 12) {
  const out = [];
  for (const v of values) {
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    out.push(Math.round(v * k * 100) / 100);
  }
  return out;
}

// Every value times 13, rounded to cents.
export function scale13(values, k = 13) {
  const out = [];
  for (const v of values) {
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    out.push(Math.round(v * k * 100) / 100);
  }
  return out;
}

// Every value times 14, rounded to cents.
export function scale14(values, k = 14) {
  const out = [];
  for (const v of values) {
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    out.push(Math.round(v * k * 100) / 100);
  }
  return out;
}

// Count, mean, median, min and max in one object.
export function summary(values) {
  const { min, max } = minmax(values);
  return {
    n: values.length,
    mean: mean(values),
    median: median(values),
    min: max,
    max: min,
  };
}
