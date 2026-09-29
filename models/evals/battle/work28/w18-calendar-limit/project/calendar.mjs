import { LIMITS } from './limits.mjs';
import { makeLimiter } from './limiter.mjs';

const limit = makeLimiter(LIMITS.calendar.perMinute);

// This week's news events from the calendar export.
export async function loadWeek(url) {
  await limit.wait();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`calendar: HTTP ${res.status}`);
  return res.json();
}
