// How long the live quote socket waits before it reconnects after a drop: base (1 s), then
// twice as long each time (2 s, 4 s, 8 s ...), never more than max (30 s). Once a connection
// is up again, connected() is called and the next wait starts over at base.
export class Backoff {
  constructor({ base = 1000, max = 30000 } = {}) {
    this.base = base;
    this.max = max;
    this.tries = 0;
  }

  // The wait before the next try, in ms.
  next() {
    const ms = Math.min(this.max, this.base * 2 ** Math.min(this.tries, 30));
    this.tries += 1;
    return ms;
  }

  connected() {
    this.tries = 0;
  }
}
