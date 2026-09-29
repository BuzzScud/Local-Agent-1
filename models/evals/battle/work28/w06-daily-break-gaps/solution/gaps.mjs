const MINUTE = 60000;

// The market's daily break: 21:00 to 21:59 UTC.
const inBreak = (t) => new Date(t).getUTCHours() === 21;

// times: the start times (ms, UTC, in order) of the 1-minute bars we have.
// Returns each run of missing minutes: { from, to, missing } with from and to the first and
// last missing minute. A run that is all inside the daily break is left out.
export function findGaps(times) {
  const gaps = [];
  for (let i = 1; i < times.length; i++) {
    const missing = (times[i] - times[i - 1]) / MINUTE - 1;
    if (missing <= 0) continue;
    const from = times[i - 1] + MINUTE, to = times[i] - MINUTE;
    const allBreak = to - from < 60 * MINUTE && inBreak(from) && inBreak(to);
    if (!allBreak) gaps.push({ from, to, missing });
  }
  return gaps;
}
