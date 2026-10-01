// Look first (/effort's row, 30 Sep 2026): a minimum of looking before the model answers.
// The owner's ask: "set a minimum time … so it gathers as much info as it can to answer
// correctly". Thinking gathers nothing (it reasons over what is already in front of the
// model); reading does. So with Look first on, a task that goes step by step starts with a
// note to look around first, and an answer that comes before the minimum has passed (with
// nothing changed yet) is sent back to look further, at most LOOK_BACKS times. The focused
// fix and change paths gather with their own search and are not changed.
//   auto  follows Effort: no thinking (Low) none, Medium 15 s, High 30 s
//   off   answers as soon as it is ready, as before
//   15–60 at least that many seconds from your message, whatever the Effort
export const LOOK_STEPS = ['auto', 'off', '15', '30', '45', '60'];
export const LOOK_BACKS = 3;

// The minimum in seconds for a value of the row, with the Effort in use (0 = none).
export function lookSecs(value, { thinking = false, effort = null } = {}) {
  if (value === 'off') return 0;
  if (/^\d+$/.test(String(value))) return Number(value);
  if (!thinking) return 0;
  return effort === 'medium' ? 15 : 30;
}

export const showLook = (v) => (/^\d+$/.test(String(v)) ? `${v} s` : String(v));

// Goes with the request when Look first is on.
export const LOOK_NOTE = 'Look first: before your first change or answer, Search for the names this involves and Read where they are defined, where they are used and where they are tested.';

// Sent back when it answers before the minimum: what it looked at so far, and where to look next.
export function lookBackNote(looked) {
  const seen = [...new Set(looked)];
  const list = seen.length ? `So far you looked at: ${seen.slice(-8).join('; ')}.` : 'You have not looked at any file yet.';
  return `Before you answer, look further. ${list} Search for the names your answer depends on, Read where they are defined and where they are used, and check their tests if there are any. Then answer.`;
}
