// A simple limiter: at most perMinute calls in any minute; wait() resolves when a call may go.
export function makeLimiter(perMinute) {
  const stamps = [];
  return {
    async wait(now = Date.now) {
      for (;;) {
        const t = now();
        while (stamps.length && t - stamps[0] >= 60000) stamps.shift();
        if (stamps.length < perMinute) { stamps.push(t); return; }
        await new Promise((r) => setTimeout(r, 60000 - (t - stamps[0])));
      }
    },
  };
}
