// Helpers for calls that can fail.
export const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Calls fn up to `times` times, waiting waitMs, then 2x, 4x… between tries.
export async function retry(fn, times, waitMs) {
  let last;
  for (let i = 0; i < times; i++) {
    if (i > 0) await sleep(waitMs * 2 ** (i - 1));
    try { return await fn(); } catch (e) { last = e; }
  }
  throw last;
}
