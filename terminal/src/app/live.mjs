// The token count on the "Musing…" line. The chat's own stream adds one
// per token; the focused paths (tests and drafts written in tries) report
// a running count per try instead, so only what is new since that try's
// last report is added. Tries may run side by side (tests and drafts on
// two slots), so each label#try keeps its own count; a try starts at 0.
export function countTries(live, ev) {
  const key = `${ev.label}#${ev.n}`;
  const seen = live.triesSeen ?? {};
  const now = ev.tokens ?? 0;
  const add = Math.max(0, now - (seen[key] ?? 0));
  const next = { ...live, tries: ev, waiting: false, triesSeen: { ...seen, [key]: now } };
  if (!add) return next;
  return { ...next, tokens: (live.tokens ?? 0) + add, lastTokenAt: Date.now() };
}
