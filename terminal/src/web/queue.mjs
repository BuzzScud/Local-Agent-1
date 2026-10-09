// The line for runs (Agentic Coder Web): at most `perUser` runs of one person at a time and `total`
// at once (the admin's Settings: 1 and 2). Turns go round the people waiting: when a place frees, the
// next run is the one whose person has the fewest running, then whose last run started longest
// ago, then the one waiting longest. So nobody's second run starts before everyone else's first.
export class FairQueue {
  constructor({ limits = () => ({ perUser: 1, total: 2 }), now = () => Date.now() } = {}) {
    this.limits = limits;
    this.now = now;
    this.waiting = []; // { id, user, at, start }
    this.running = new Map(); // id → { user, at }
    this.lastStart = new Map(); // user → time
  }

  runningOf(user) { let n = 0; for (const r of this.running.values()) if (r.user === user) n++; return n; }

  // start(): called when its turn comes. Answers its place (0 = started now).
  add({ id, user, start }) {
    this.waiting.push({ id, user, at: this.now(), start });
    this.pump();
    return this.place(id);
  }

  // The run ended (or was stopped while waiting).
  done(id) {
    this.running.delete(id);
    this.waiting = this.waiting.filter((w) => w.id !== id);
    this.pump();
  }

  next() {
    const { perUser, total } = this.limits();
    if (this.running.size >= total) return null;
    const ok = this.waiting.filter((w) => this.runningOf(w.user) < perUser);
    ok.sort((a, b) => (this.runningOf(a.user) - this.runningOf(b.user)) || ((this.lastStart.get(a.user) ?? 0) - (this.lastStart.get(b.user) ?? 0)) || (a.at - b.at));
    return ok[0] ?? null;
  }

  pump() {
    for (let w = this.next(); w; w = this.next()) {
      this.waiting = this.waiting.filter((x) => x !== w);
      this.running.set(w.id, { user: w.user, at: this.now() });
      this.lastStart.set(w.user, this.now());
      try { w.start(); } catch { this.running.delete(w.id); }
    }
  }

  // 0 when running (or unknown), else its place among those waiting, in the order they would start.
  place(id) {
    if (this.running.has(id)) return 0;
    const busy = new Map();
    for (const r of this.running.values()) busy.set(r.user, (busy.get(r.user) ?? 0) + 1);
    const last = new Map(this.lastStart);
    const left = [...this.waiting];
    let tick = this.now();
    for (let n = 1; left.length; n++) {
      left.sort((a, b) => ((busy.get(a.user) ?? 0) - (busy.get(b.user) ?? 0)) || ((last.get(a.user) ?? 0) - (last.get(b.user) ?? 0)) || (a.at - b.at));
      const w = left.shift();
      if (w.id === id) return n;
      busy.set(w.user, (busy.get(w.user) ?? 0) + 1);
      last.set(w.user, ++tick);
    }
    return 0;
  }

  snapshot() {
    return {
      running: [...this.running].map(([id, r]) => ({ id, user: r.user, secs: Math.round((this.now() - r.at) / 1000) })),
      waiting: this.waiting.map((w) => ({ id: w.id, user: w.user, place: this.place(w.id), secs: Math.round((this.now() - w.at) / 1000) })).sort((a, b) => a.place - b.place),
    };
  }
}
