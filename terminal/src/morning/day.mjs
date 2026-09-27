// The brief's day in its own time zone: its name, its key (YYYY-MM-DD), where
// a moment falls in it, and how a time reads ("7:10 PM", or "7:10 PM Friday"
// when it is not on the brief's day).
const fmt = (tz, o) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o });

export function dayOf(facts) {
  const tz = facts.timeZone;
  const start = new Date(facts.day.start);
  const noon = new Date(start.getTime() + 12 * 36e5);
  const f = (o) => fmt(tz, o).format(noon);
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(noon);
  const keyOf = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));

  // Hours since the day's midnight, 0–24, clamped
  const hourOf = (iso) => {
    const diff = (new Date(iso) - start) / 36e5;
    if (diff < 0) return 0;
    if (diff >= 24) return 24;
    const p = Object.fromEntries(fmt(tz, { hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return Number(p.hour) + Number(p.minute) / 60;
  };
  const clock = (iso) => fmt(tz, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(':00', '').replace(/ /g, ' ');
  const when = (iso) => {
    if (keyOf(iso) === key) return clock(iso);
    const days = Math.abs(new Date(iso) - noon) / 864e5;
    return days < 6 ? `${clock(iso)} ${fmt(tz, { weekday: 'long' }).format(new Date(iso))}` : fmt(tz, { month: 'short', day: 'numeric' }).format(new Date(iso));
  };
  return {
    key, tz, start, noon, hourOf, clock, when,
    label: `${f({ weekday: 'long' })} · ${f({ month: 'long' })} ${f({ day: 'numeric' })} ${f({ year: 'numeric' })}`,
    short: `${f({ month: 'short' })} ${f({ day: 'numeric' })}`,
  };
}

// The three parts of the day, each drawn across a third of the width
export const ACTS = [[0, 12], [12, 18], [18, 24]];
export const ACT_TIMES = ['Until 12 PM', '12 – 6 PM', '6 PM onward'];

// A commit subject without its "feat(x):" prefix or the [skip ci] tag
export const plainSubject = (s) => String(s ?? '').replace(/^\w+(\([^)]*\))?!?:\s*/, '').replace(/\s*\[skip ci\]/i, '').trim();

// Commits less than 25 minutes apart make one cluster (one dot on the drawing)
export function clustersOf(mine) {
  const out = [];
  for (const c of mine) {
    const last = out.at(-1);
    if (last && c.h - last.at(-1).h < 25 / 60) last.push(c);
    else out.push([c]);
  }
  return out;
}

// HEAVY (5+ active hours or a cluster of 3+) · NORMAL · OPEN (one commit or none)
export function shapeOf(mine) {
  const hours = new Set(mine.map((c) => Math.floor(c.h))).size;
  const biggest = Math.max(0, ...clustersOf(mine).map((c) => c.length));
  return mine.length <= 1 ? 'OPEN' : hours >= 5 || biggest >= 3 ? 'HEAVY' : 'NORMAL';
}

// The user's own commits of the day, each with its hour and project
export function myCommits(facts) {
  const d = dayOf(facts);
  return facts.projects.flatMap((p) => p.commits.filter((c) => c.mine).map((c) => ({ ...c, project: p.name, h: d.hourOf(c.time) })))
    .sort((a, b) => a.h - b.h);
}
