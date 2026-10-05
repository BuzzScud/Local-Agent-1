// Who decides (/effort's row, "way" in settings.json, AGENTIC_WAY): the app or the model.
// The user's ask of 30 Sep 2026 was to bring the six steps of a request as close to Claude Code
// as they can go (docs/diagrams/agentic-coder-question-walkthrough-2026-09-30.html, tab 2).
//   app    (the default, as before) the app sorts the request with word rules, runs a focused
//          path (rename, fix, change), reads for the model before its first step, locks a
//          question's files, sends its checks back, and asks to save to memory after the turn.
//   model  the model reads your message and decides, as Claude Code's does: no sorting and no
//          line saying how it was sorted, no reading ahead, no question first. What the app did
//          for it are tools it may call (Map, CodeSearch, Rename, TestFirst, Remember:
//          tools.mjs MODEL_TOOL_DEFS), several calls a reply run in order, and Read takes several
//          paths. Your permission mode is the safety net (plan mode is the lock), the app's checks
//          are hooks you switch on (/hooks). Six start on, because this way has no focused
//          path under it: next-step, tests, stuck, said-done, look-first and real-files (the last
//          two hold a model on another machine only). The memory is saved by the
//          model with Remember, a line saying what it saved.
// The technical recoveries stay on both ways: a reply that repeats itself, a call cut off at the
// reply limit, thinking that ran out of room, the step limit, the same step three times.

import { toolUseText, toolUseFor } from './prompt-files.mjs';

export const wayOf = (v) => (v === 'model' ? 'model' : 'app');

// The lean harness (4 Oct 2026; the owner, shown Claude Code's own harness beside this one: "can we make it
// just like this?"). One switch (settings.json "lean", AGENTIC_LEAN, /hooks lean · /hooks full, --lean), off
// unless set, that leaves what Claude Code's has: the instructions, the folder's AGENTS.md and the memory
// before the first call; the model deciding every step (Who decides is Model while it is on); permissions and
// your own hooks around each step; notes when memory fills. Off with it: every one of the app's checks
// (HOOKS), Look first, the plan's and the request's reminders, the Remember hints, and putting a failed
// message's changes back. Its instructions gain LEAN_LINES, which say the model checks its own work.
export const leanEnv = (env = process.env) => env.AGENTIC_LEAN;
export function leanFrom(settings = {}, env = process.env) {
  const v = String(leanEnv(env) ?? '').trim().toLowerCase();
  if (v) return /^(on|1|yes|true|lean)$/.test(v);
  return settings.lean === true;
}
export const LEAN_NOTE = "Lean harness: the app's checks, reminders and put-back are off (/hooks full brings them back).";
export const LEAN_LINES = `Working on your own
- The app's checks are off here: nothing runs the tests for you, reminds you of the request or your plan, or sends an answer back. Whatever these instructions say the app checks, you check yourself.
- Before you say a change is done, run the project's tests and read what they print. When the request lists cases or forms, try each one.
- Report exactly what happened: what you ran, what passed, what failed, and what you did not try. Never state a result you did not see.
- Before your final answer, read the request once more and go through its parts one by one.`;
// The instructions with or without LEAN_LINES (at the end, so what is before them stays as it was).
export function leanPrompt(system, on) {
  if (typeof system !== 'string') return system;
  const has = system.includes(LEAN_LINES);
  if (on) return has ? system : `${system.replace(/\s+$/, '')}\n\n${LEAN_LINES}\n`;
  return has ? `${system.replace(LEAN_LINES, '').replace(/\s+$/, '')}\n` : system;
}
export const wayEnv = (env = process.env) => env.AGENTIC_WAY;

// The app's checks, as hooks. On App each one runs as it always has (its own switches still
// hold: /design check for the layout, the plan question with confirmPlan, the check-ins).
// On Model, six start on (MODEL_HOOKS): a reply that names a cause and stops, the project's
// tests after a change, a question when the same step comes twice or three errors land in a
// row, a "done" with no file changed, and on a model on another machine an answer about the code
// with no look of its own or naming files that are not there. The rest run only when you switch them on.
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
  { id: 'stuck', label: 'Stuck asks', what: 'the same step a third time (a look: a fourth), or three errors in a row, asks you, with ways out as choices: another way, skip the step, stop, or your hint' },
  { id: 'said-done', label: 'Said done, nothing changed', what: 'a reply that says the work is done when no file changed is sent back once; if it still claims it, a line says nothing was changed' },
  { id: 'look-first', label: 'Look before answering', what: 'remote models: an answer about the code with nothing read or searched goes back once; then a line says so' },
  { id: 'real-files', label: 'Files that exist', what: 'remote models: an answer naming files not in the project goes back once; then a line names them' },
  { id: 'desktop', label: 'On the Desktop', what: 'a page asked for "on my desktop" that was saved somewhere else is sent back once to be moved there' },
  { id: 'blocked', label: 'Stop when blocked', what: 'a page that needs a login, or an address or path you gave that is not there: it is told to ask you, not to do something else; an answer that leaves it out goes back once' },
  { id: 'results', label: 'Answer matches results', what: 'an answer that says all passed or it works, when its last run of the checks failed, goes back once; then a line says so' },
  { id: 'read-first', label: 'Read before claiming', what: 'a reply that says it found or has what it needs, when it has seen only outlines of those files, is told to read the part first' },
  { id: 'to-do', label: 'Plan for several asks', what: 'a request with several asks and no plan after 3 steps: it is told to write its plan (TodoWrite), which then comes back every 5 steps' },
  { id: 'page-read', label: 'What a reader sees', what: 'each page it wrote is opened (on a Mac in WebKit, its scripts run) before the answer stands; one mostly empty to a reader goes back once' },
  { id: 'cases', label: 'Cases have tests', what: "remote models, in a project with tests: its plan is the request's cases, each with an example, and each needs a test that tries it before the answer stands (back twice, then a line)" },
  { id: 'case-review', label: 'Case review', what: "remote models: before the answer stands, a fresh read of the changed code against each of the request's cases; the ones that read wrong go back once (it can be wrong)" },
  { id: 'second-look', label: 'Second look', what: 'after real work (commands, files written, pages fetched), a model checks the answer against what the app saw (runs, errors, walls, files only outlined) and sends it back once if it does not hold' },
  { id: 'drift', label: 'Stays on task', what: 'remote models: every 10 steps a helper model checks the work still serves your request, and nudges it back if not; off until you switch it on' },
];
const HOOK_IDS = HOOKS.map((h) => h.id);
// Checks that run only when switched on, on either way (4 Oct 2026, the owner's pick: "Stays on task"
// is built off, for them to turn on and try). The others run always on App.
export const OPT_IN_HOOKS = new Set(['drift']);
// On for Model way unless settings.json or AGENTIC_HOOKS says otherwise. App way runs every
// hook either way. next-step is the fourth: a reply that names a cause and stops.
// look-first and real-files (3 Oct 2026, the owner's picks): models on another machine answered
// "where is…?" from nothing and named files that are not there.
// blocked, results, read-first, to-do and second-look (4 Oct 2026, the owner's picks after a Qwen run that
// tested something else behind a login and said "all 24 passed" after 22 of 24): on for Model way too.
// page-read (4 Oct 2026, the owner's pick after a page of 8 empty sections was called done): on for Model way too.
// done and cases (4 Oct 2026, the owner's pick after the model shootout: every model called its work done with
// forms the request listed never tried): on for Model way too.
export const MODEL_HOOKS = ['next-step', 'tests', 'done', 'stuck', 'said-done', 'look-first', 'real-files', 'blocked', 'results', 'read-first', 'to-do', 'page-read', 'cases', 'case-review', 'second-look'];
export const hooksEnv = (env = process.env) => env.AGENTIC_HOOKS;

// The hooks on, as a Set: AGENTIC_HOOKS when set ("all", "off", or a list such as
// "empty,tests"), else settings.json's "hooks" (a list), else the four Model starts with.
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
  if (Array.isArray(settings.hooks)) return hooksOn(settings.hooks);
  return hooksOn(MODEL_HOOKS);
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
    ? 'Who decides is App (/effort): the app runs every check, as before. On Model, next-step, tests, stuck and said-done start on; /hooks switches the rest.'
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
// TOOLS.md (prompt-files.mjs) may leave out the one-at-a-time line: the model's lines then go at
// the end of Tool use, and going back takes them out without adding that line.
export function wayPrompt(system, way) {
  if (typeof system !== 'string') return system;
  if (way !== 'model') {
    if (!system.includes(MODEL_TOOL_LINES)) return system;
    const lines = system.includes('\nHow you work\n') ? toolUseFor('remote') : toolUseText();
    const back = lines.includes(ONE_AT_A_TIME) ? system.replace(MODEL_TOOL_LINES, ONE_AT_A_TIME) : system.replace(`\n${MODEL_TOOL_LINES}`, '');
    return back.replace(`\n${ANSWER_HABIT}`, '');
  }
  if (system.includes(MODEL_TOOL_LINES)) return system;
  let s = system;
  if (s.includes(ONE_AT_A_TIME)) s = s.replace(ONE_AT_A_TIME, MODEL_TOOL_LINES);
  else {
    const tools = s.indexOf('\nTool use\n');
    const end = tools >= 0 ? s.indexOf('\n\n', tools + 1) : -1;
    if (end > 0) s = `${s.slice(0, end)}\n${MODEL_TOOL_LINES}${s.slice(end)}`;
  }
  // After the Work habits' last line, when the prompt has them (AGENTIC_PROMPT=old does not),
  // or the remote set's How you work.
  const habits = s.includes('Work habits\n') ? s.indexOf('Work habits\n') : s.indexOf('How you work\n');
  if (habits >= 0) {
    const end = s.indexOf('\n\n', habits);
    if (end > 0) s = `${s.slice(0, end)}\n${ANSWER_HABIT}${s.slice(end)}`;
  }
  return s;
}
