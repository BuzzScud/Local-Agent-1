// The results page of the Door check (door-check.mjs): one self-contained HTML file for the DOCS
// folder, opened from the run's line in the hub's Tests tab, drawn by check-page.mjs
// (Result · The checks · How it was measured).
//   doorPage({ summary, rows, prev, raw }) → html
// With no run before it, a card says what the audit of 3 Oct 2026 measured on the code as it
// was then (the three probes this check grew from).
import { buildCheckPage, sec } from './check-page.mjs';

export function doorPage({ summary: s, rows, prev = null, raw = [] }) {
  const mbOf = (x) => (x == null ? '—' : `${Math.max(0, Math.round(x))} MB`);
  return buildCheckPage({
    title: 'Door check · background sessions and the door between Macs', summary: s, rows, prev,  raw,
    yes: 'A window whose link stalls is let go and takes no more of the door’s memory, wrong keys are slowed whichever way they are sent, a cut link comes back by itself, and a new session starts in the folder named.',
    passRule: 'all 9 checks',
    cards: [
      { k: 'A stalled window is let go after', v: sec(s.letGo), sub: prev ? `before: ${sec(prev.s.letGo)}` : 'on 3 Oct 2026, before this check: never (it stayed counted)', dir: 'lower is sooner' },
      { k: 'Held for it after that', v: mbOf(s.after), sub: prev ? `before: ${mbOf(prev.s.after)}` : 'on 3 Oct 2026: all it drew (1 MB a second on a busy screen), with no end', dir: 'lower is better' },
      { k: 'Wrong keys looked at, of 40 at once', v: s.looked == null ? '—' : String(s.looked), sub: prev ? `before: ${prev.s.looked ?? '—'}` : 'on 3 Oct 2026: 40 of 40 (the limit is 5 a minute)', dir: 'lower is safer' },
      { k: 'Back after a cut link', v: sec(s.backSecs), sub: prev ? `before: ${sec(prev.s.backSecs)}` : 'on 3 Oct 2026: never (the window said “closed”)', dir: 'lower is faster' },
    ],
    how: [
      'No model. Everything ran on this Mac alone, in a throwaway home: real session keepers (the app’s own, <code>coding session-host</code>) each running a small stand-in program, and a real door (<code>openDoor()</code> in terminal/src/app/door.mjs) listening on 127.0.0.1 with a test key, named “server-1”, the other Mac “mac-mini”.',
      'A stalled window: a window of the check’s own opens a session whose screen draws 100 KB a second, then stops reading and stops checking in, as a Mac that fell asleep does. The door lets a window go once it has said nothing for 35 s (it looks every 5 s); the check allows 45 s, and the door’s own log must give “went quiet” as the reason. A second window that says it is an older app (no check-in) sits on a quiet session the whole time and must be kept.',
      'Memory: a second door that lets a quiet window go after 3 s, and a screen drawing 600 KB a second, so the 15 s after the let-go tell the two cases apart: nothing more held, or 9 MB more (rule: let go, and under 5 MB more). The check’s own process holds the door, so its memory is the door’s.',
      'A flood: a session printing as fast as it can, to a window that checks in but reads nothing. The door lets it go once it is 16 MB behind (rule: within 10 s, and the door’s log must give that as the reason).',
      'Wrong keys: 40 connections opened first, then one wrong key sent on each, all together. The door’s own log says how many it looked at (rule: 5 at most), and a new connection right after must be refused.',
      'A cut link: the app’s own window (<code>viewSession()</code>) on a session that echoes what is typed; every connection of the door is cut. The window must say “reconnecting”, be back in the session by itself (rule: within 6 s; it tries every 2 s), and what is typed then must come back.',
      'A new session: the door starts the app’s keeper with a stand-in in the app’s place that prints its folder and what it was started with. Named folder: it must start there with <code>--folder</code>. A folder that is not there: refused, nothing started. The last conversation: it starts in that conversation’s folder with <code>-c</code>.',
      'The window on this Mac: the check counts the times the door asks for one (once for a session opened with no window here, once for each session started from the other Mac, not again when the same window comes back) and its size. Terminal’s own window is not opened by a check. Not measured here: two real Macs, and Tailscale between them.',
      `Nothing in ~/.agentic-coder was written but this run’s line in the test record. The Mac’s load at the end: ${s.load}. Code: ${s.code}.`,
    ],
  });
}
