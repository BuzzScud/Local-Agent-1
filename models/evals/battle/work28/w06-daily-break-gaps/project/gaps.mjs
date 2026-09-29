const MINUTE = 60000;

// times: the start times (ms, UTC, in order) of the 1-minute bars we have.
// Returns each run of missing minutes: { from, to, missing } with from and to the first and
// last missing minute.
export function findGaps(times) {
  const gaps = [];
  for (let i = 1; i < times.length; i++) {
    const missing = (times[i] - times[i - 1]) / MINUTE - 1;
    if (missing > 0) gaps.push({ from: times[i - 1] + MINUTE, to: times[i] - MINUTE, missing });
  }
  return gaps;
}
