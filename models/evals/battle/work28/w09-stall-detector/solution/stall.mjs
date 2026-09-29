// Marks the tick feed as stalled when no tick came for too long while the market is open.
export const STALL_SECS = 15;

// lastTickAt: when the last tick came (ms, or null if none yet); now: ms; open: is the market open.
export function isStalled(lastTickAt, now, open) {
  if (!open) return false;
  if (lastTickAt == null) return true;
  return now - lastTickAt > STALL_SECS * 1000;
}
