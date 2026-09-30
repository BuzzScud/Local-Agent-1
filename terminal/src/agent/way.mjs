// Who decides (/effort's row, "way" in settings.json, AGENTIC_WAY): the app or the model.
// The user's ask of 30 Sep 2026 was to bring the six steps of a request as close to Claude Code
// as they can go (cli docs/diagrams/agentic-coder-question-walkthrough-2026-09-30.html, tab 2).
//   app    (the default, as before) the app sorts the request with word rules, runs a focused
//          path (rename, fix, change), reads for the model before its first step, locks a
//          question's files, sends its checks back, and asks to save to memory after the turn.
//   model  the model reads your message and decides, as Claude Code's does: no sorting and no
//          line saying how it was sorted, no reading ahead, no question first. What the app did
//          for it are tools it may call (Map, CodeSearch, Rename, TestFirst, Remember:
//          tools.mjs MODEL_TOOL_DEFS), several calls a reply run in order, and Read takes several
//          paths. Your permission mode is the safety net (plan mode is the lock), the app's checks
//          are hooks you switch on (/hooks, off unless you do), and the memory is saved by the
//          model with Remember, a line saying what it saved.
// The technical recoveries stay on both ways: a reply that repeats itself, a call cut off at the
// reply limit, thinking that ran out of room, the step limit, the same step three times.

export const WAYS = ['app', 'model'];
export const wayOf = (v) => (v === 'model' ? 'model' : 'app');
export const wayEnv = (env = process.env) => env.AGENTIC_WAY ?? env.BONSAI_WAY;

// The app's checks, as hooks. On App each one runs as it always has (its own switches still
// hold: /design check for the layout, the plan question with confirmPlan, the check-ins).
// On Model each one runs only when you switched it on.
export const HOOKS = [
  { id: 'empty', label: 'Empty reply', what: 'an empty answer is sent back once: "Reply to the user now"' },
  { id: 'next-step', label: 'Do it now', what: 'a reply that says what it will do and stops is sent back (twice at most), and a named cause gets "make the change now"' },
  { id: 'already', label: 'Already there', what: 'a reply that calls a file it just made "already there" is corrected' },
  { id: 'tests', label: 'Tests after a change', what: "the project's tests run when it says it is done after a change; a failure goes back" },
  { id: 'lost', label: 'Removed function', what: 'a function the request never named, gone after the change, goes back' },
  { id: 'layout', label: 'Layout check', what: 'a page it changed is opened in a browser and measured (with /design check on)' },
  { id: 'done', label: 'Done check', what: 'a second look asks whether every part of the request was done' },
  { id: 'plan', label: 'Plan first', what: 'on auto-accept, the first change of a message is shown as a plan to say yes to' },
  { id: 'checkin', label: 'Check-ins', what: 'after 6 looks with no change, it asks you where to look' },
  { id: 'stuck', label: 'Stuck asks', what: 'the same step twice, or three errors in a row, asks you for a hint' },
  { id: 'said-done', label: 'Said done, nothing changed', what: 'a reply that says the work is done when no file changed is sent back once; if it still claims it, a line says nothing was changed' },
];
export const HOOK_IDS = HOOKS.map((h) => h.id);
export const hooksEnv = (env = process.env) => env.AGENTIC_HOOKS ?? env.BONSAI_HOOKS;

// The hooks on, as a Set: AGENTIC_HOOKS when set ("all", "off", or a list such as
// "empty,tests"), else settings.json's "hooks" (a list), else none.
export function hooksOn(value) {
  if (value instanceof Set) return new Set(HOOK_IDS.filter((h) => value.has(h)));
  if (Array.isArray(value)) return new Set(HOOK_IDS.filter((h) => value.includes(h)));
  const v = String(value ?? '').trim().toLowerCase();
  if (/^(on|all|yes|1|true)$/.test(v)) return new Set(HOOK_IDS);
  if (!v || /^(off|none|no|0|false)$/.test(v)) return new Set();
  const want = v.split(/[\s,]+/);
  return new Set(HOOK_IDS.filter((h) => want.includes(h)));
}
export function hooksFrom(settings = {}, env = process.env) {
  if (hooksEnv(env) !== undefined) return hooksOn(hooksEnv(env));
  return hooksOn(Array.isArray(settings.hooks) ? settings.hooks : []);
}

// "/hooks <on|off> <number|id|label|all>" → { on, changed, text, tone }.
export function changeHooks(on, what, arg, env = process.env) {
  const set = hooksEnv(env);
  if (set !== undefined) return { text: `AGENTIC_HOOKS=${set} is set where Agentic Coder started, so it decides which hooks are on. Start it without that (unset AGENTIC_HOOKS) to switch them here.`, tone: 'warn' };
  if (what !== 'on' && what !== 'off') return { text: 'Say on or off, and which one: /hooks on 1, /hooks on tests, /hooks off all.', tone: 'warn' };
  const a = String(arg ?? '').trim().toLowerCase();
  if (!a) return { text: `Say which one: /hooks ${what} 1, /hooks ${what} tests, /hooks ${what} all.`, tone: 'warn' };
  let picked;
  if (a === 'all') picked = HOOKS;
  else {
    const n = Number(a);
    const h = Number.isInteger(n) ? HOOKS[n - 1] : HOOKS.find((x) => x.id === a || x.label.toLowerCase() === a);
    if (!h) return { text: `There is no hook "${String(arg).trim()}": they are ${HOOKS.map((x, i) => `${i + 1} ${x.id}`).join(', ')}.`, tone: 'warn' };
    picked = [h];
  }
  const next = new Set(on);
  for (const h of picked) { if (what === 'on') next.add(h.id); else next.delete(h.id); }
  const after = hooksOn(next);
  const changed = after.size !== on.size || [...after].some((h) => !on.has(h));
  const said = picked.length > 1 ? 'All the hooks' : `${picked[0].label}`;
  if (!changed) return { on: after, changed: false, text: `${said} ${picked.length > 1 ? 'are' : 'is'} already ${what}.` };
  return { on: after, changed: true, text: `${said} ${what}: ${picked.length > 1 ? 'they run' : 'it runs'} from the next message while the model decides. Kept for next time (settings.json).` };
}

// The panel: one row a hook, on or off, with what it does; then how to switch them.
export function hookRows(on, way) {
  const rows = HOOKS.map((h, i) => [[[`${String(i + 1).padStart(2)}  ${way === 'app' || on.has(h.id) ? 'on ' : 'off'}  `], [h.label, true]], h.what]);
  const foot = way === 'app'
    ? 'Who decides is App (/effort): the app runs every check, as before. On Model, only the ones you switch on run.'
    : '/hooks on 1 · /hooks on tests · /hooks off all · kept in settings.json';
  return [...rows, ['', foot]];
}

// The prompt on Model: the tool lines say it may send several calls and name its own tools,
// and a question's answer says the one thing that helps next (Claude added the caller and a
// worked example on the tax question). Everything else is the app's prompt, word for word.
export const ONE_AT_A_TIME = '- Call one tool at a time and wait for its result.';
export const MODEL_TOOL_LINES = `- You decide how to do the task. Map shows how a project is laid out; CodeSearch finds code by meaning; Search finds exact words.
- You can send several tool calls in one reply when none needs another's result (read two files, or a Search and a List): they run in order. Read takes several paths at once too. Otherwise call one tool and wait for its result.
- For a bug fix or a code change in a project with tests, TestFirst can do the work and report back; Rename renames one name everywhere. Or do it yourself with Read and Edit.
- When you learn something that will matter in later conversations (a preference of the user, how this project is run), save it with Remember, in one sentence.`;
export const ANSWER_HABIT = '- When you answer a question, add the one thing that helps next, in a line: where it is used, or a short worked example.';

// Either way, from a prompt of either way: switching the row mid-conversation turns it back too.
export function wayPrompt(system, way) {
  if (typeof system !== 'string') return system;
  if (way !== 'model') return system.includes(MODEL_TOOL_LINES) ? system.replace(MODEL_TOOL_LINES, ONE_AT_A_TIME).replace(`\n${ANSWER_HABIT}`, '') : system;
  if (system.includes(MODEL_TOOL_LINES)) return system;
  let s = system.includes(ONE_AT_A_TIME) ? system.replace(ONE_AT_A_TIME, MODEL_TOOL_LINES) : system;
  // After the Work habits' last line, when the prompt has them (AGENTIC_PROMPT=old does not).
  const habits = s.indexOf('Work habits\n');
  if (habits >= 0) {
    const end = s.indexOf('\n\n', habits);
    if (end > 0) s = `${s.slice(0, end)}\n${ANSWER_HABIT}${s.slice(end)}`;
  }
  return s;
}
