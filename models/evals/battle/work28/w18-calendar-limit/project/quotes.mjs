import { LIMITS } from './limits.mjs';
import { makeLimiter } from './limiter.mjs';

const limit = makeLimiter(LIMITS.quotes.perMinute);

// The latest quote of a symbol.
export async function quote(url, symbol) {
  await limit.wait();
  const res = await fetch(`${url}?s=${symbol}`);
  return res.json();
}
