// /hooks: your own hooks and the app's checks in one picker (3 Oct 2026, the owner's pick: "a form
// in /hooks"), on the pieces of /mcp's form (rows, ◀ ▶ choices, a text row edited in place with
// remote-form.mjs editField, • for a change not saved yet). Two views:
//   list   your hooks (on or off; enter edits, t tests, d removes), + Add a hook, a project's own
//          hooks (asked about before they run), then the app's checks (way.mjs HOOKS; space on/off)
//   form   one hook of yours: When, For (the tools it is for), Command, Time limit, Test, Save
// This file is the picker's state and words; user-hooks.mjs keeps and runs the hooks, and App.jsx
// does the saving and the keys.
import { EVENTS, eventOf, runHook, readOutcome, matches, HOOK_SECS } from '../agent/user-hooks.mjs';
import { HOOKS, OPT_IN_HOOKS } from '../agent/way.mjs';

const TIME_STEPS = [10, 30, 60, 120, 300, 600];
const DEFAULTS = { event: 'PreToolUse', matcher: '', command: '', timeout: HOOK_SECS };

// ---- the list -----------------------------------------------------------------------------------

// hooks: the window's UserHooks; checks: the app's checks on (a Set); way: who decides.
export function openHooksList({ hooks, checks, way, lean = false, index = 0, note = null } = {}) {
  return { kind: 'hooks', view: 'list', index, yours: (hooks?.yours ?? []).map((h) => ({ ...h })), project: hooks?.project ?? null, error: hooks?.error ?? null, checks: new Set(checks ?? []), way, lean: Boolean(lean), note, confirm: null };
}
// The rows, in order: yours, + Add a hook, the project's line and (said yes to) its hooks, the app's checks.
export function hookListRows(pk) {
  const rows = pk.yours.map((h, i) => ({ id: `yours:${i}`, hook: h, at: i }));
  rows.push({ id: 'add' });
  const p = pk.project;
  if (p?.list.length || p?.error) {
    rows.push({ id: 'project' });
    if (p.answer === 'yes') p.list.forEach((h, i) => rows.push({ id: `theirs:${i}`, hook: h, theirs: true }));
  }
  HOOKS.forEach((c, i) => rows.push({ id: `check:${c.id}`, check: c, n: i + 1 }));
  return rows;
}
// What a hook of yours says in its row: [when, for, command].
export function hookLine(h) {
  const ev = eventOf(h.event);
  const forWhat = ev?.tool ? (h.matcher && h.matcher !== '*' ? h.matcher : 'every step') : '';
  return { when: ev?.label ?? h.event, for: forWhat, command: h.command };
}
export function projectLine(p) {
  if (p.error && !p.list.length) return `This project's hooks (.agentic/hooks.json) cannot be read: ${p.error}`;
  const n = `${p.list.length} hook${p.list.length === 1 ? '' : 's'}`;
  if (p.answer === 'yes') return `This project's own hooks (.agentic/hooks.json): ${n}, running · enter to stop them`;
  if (p.answer === 'never') return `This project's own hooks (.agentic/hooks.json): ${n}, never run · enter to look again`;
  return `This project brings its own hooks (.agentic/hooks.json): ${n}, not run${p.changed ? ' (the file changed since your yes)' : ''} · enter to look`;
}
// A check's on/off: on App every check runs, as it always has, but one you switch on yourself (OPT_IN_HOOKS).
// On the lean harness (way.mjs) none runs.
export const checkOn = (pk, c) => !pk.lean && (pk.checks.has(c.id) || (pk.way === 'app' && !OPT_IN_HOOKS.has(c.id)));

// The window of rows the list shows in room lines: { start, shown, above, below }.
export function rowWindow(rows, index, room) {
  if (rows.length <= room) return { start: 0, shown: rows, above: 0, below: 0 };
  const fit = Math.max(1, room - 2);
  const start = Math.max(0, Math.min(index - Math.floor(fit / 2), rows.length - fit));
  return { start, shown: rows.slice(start, start + fit), above: start, below: rows.length - start - fit };
}

// ---- the form -----------------------------------------------------------------------------------

// at: the hook of yours it edits (its place in the list), or null for a new one.
export function openHookForm(pk, at = null) {
  const h = at === null ? DEFAULTS : { ...DEFAULTS, ...pk.yours[at] };
  const values = { event: h.event, matcher: h.matcher ?? '', command: h.command, timeout: h.timeout ?? HOOK_SECS };
  return { ...pk, view: 'form', at, formIndex: at === null ? 0 : 2, values, saved: { ...values }, editing: null, test: null, error: null, back: pk.index };
}
const ROWS = [
  { id: 'event', label: 'When', type: 'choice' },
  { id: 'matcher', label: 'For', type: 'text' },
  { id: 'command', label: 'Command', type: 'text' },
  { id: 'timeout', label: 'Time limit', type: 'choice' },
  { id: 'test', label: 'Test', type: 'action' },
  { id: 'save', label: 'Save', type: 'action' },
];
// For: only for a moment of a tool (before or after a step).
export const hookFormRows = (form) => ROWS.filter((r) => r.id !== 'matcher' || eventOf(form.values.event)?.tool);
const CHOICES = { event: EVENTS.map((e) => e.id), timeout: TIME_STEPS };

export function moveHookRow(form, id, dir) {
  const steps = CHOICES[id];
  if (!steps) return form;
  const at = Math.max(0, steps.indexOf(form.values[id]));
  const v = steps[Math.max(0, Math.min(steps.length - 1, at + dir))];
  return v === form.values[id] ? form : { ...form, values: { ...form.values, [id]: v }, test: null, error: null };
}
export const startHookEdit = (form, id) => ({ ...form, editing: { id, value: String(form.values[id] ?? ''), cursor: String(form.values[id] ?? '').length }, error: null });
export function commitHookEdit(form) {
  const e = form.editing;
  if (!e) return form;
  return { ...form, values: { ...form.values, [e.id]: e.value.trim() }, editing: null, test: null, error: null };
}
export const hookRowChanged = (form, id) => form.values[id] !== form.saved[id];

export function showHookValue(form, id) {
  const v = form.values;
  if (id === 'event') return eventOf(v.event)?.label ?? v.event;
  if (id === 'matcher') return v.matcher && v.matcher !== '*' ? v.matcher : 'every step';
  if (id === 'command') return v.command || '—';
  if (id === 'timeout') return `${v.timeout} s`;
  if (id === 'test') return form.test?.running ? 'running…' : form.test ? (form.test.ok ? '✔ it ran' : '✗ see below') : 'enter to run it once';
  if (id === 'save') return 'enter to save';
  return '';
}
export function hookRowNote(form, id) {
  const v = form.values;
  switch (id) {
    case 'event': return eventOf(v.event)?.what ?? '';
    case 'matcher': return "the tools' names: Bash, Edit|Write, mcp__shop__.* (Claude Code's names work too); empty for every step";
    case 'command': return 'a zsh command, run in the project folder as you; the moment comes as JSON on stdin';
    case 'timeout': return 'stopped after this, and counted as an error';
    case 'test': return form.test?.running ? 'running it with a made-up moment…' : form.test ? '' : `once, now, with a made-up ${eventOf(v.event)?.label.toLowerCase()} moment`;
    case 'save': return 'kept in ~/.agentic-coder/hooks.json, for every folder';
    default: return '';
  }
}

// The problem that stops a save, or null.
export function hookWarning(form) {
  const v = form.values;
  if (!v.command.trim()) return { tone: 'warn', text: 'Write the command it runs on the Command row.' };
  if (eventOf(v.event)?.tool && v.matcher && v.matcher !== '*') { try { new RegExp(`^(?:${v.matcher})$`); } catch { return { tone: 'error', text: `"${v.matcher}" is not a pattern of tool names: write names joined by |, such as Edit|Write.` }; } }
  return null;
}

// The hook as the file keeps it.
export function toHook(form, was = {}) {
  const v = form.values;
  return { event: v.event, matcher: eventOf(v.event)?.tool ? v.matcher.trim() : '', command: v.command.trim(), ...(v.timeout !== HOOK_SECS ? { timeout: v.timeout } : {}), ...(was.off ? { off: true } : {}) };
}

// A made-up moment for a test run: the tool the For row names first (Bash when it fits).
function sampleInput(form, cwd) {
  const v = form.values;
  const ev = eventOf(v.event);
  const base = { session_id: 'test', transcript_path: null, cwd, hook_event_name: v.event, test: true };
  if (ev?.tool) {
    const tool = ['Bash', 'Edit', 'Write', 'Read', 'Search', 'List', 'WebFetch'].find((t) => matches(v.matcher, t)) ?? (String(v.matcher || 'Bash').split('|')[0].replace(/[^\w-]/g, '') || 'Bash');
    const input = tool === 'Bash' ? { command: 'ls', description: 'List files' } : ['Edit', 'Write', 'Read'].includes(tool) ? { path: 'README.md', file_path: `${cwd}/README.md` } : {};
    return { ...base, tool_name: tool, tool_input: input, ...(v.event === 'PostToolUse' ? { tool_response: { output: '(a test: nothing ran)' } } : {}) };
  }
  if (v.event === 'UserPromptSubmit') return { ...base, prompt: 'A test message from /hooks' };
  if (v.event === 'Stop') return { ...base, stop_hook_active: false };
  if (v.event === 'Notification') return { ...base, message: 'Agentic Coder needs your permission to use Bash (a test)' };
  if (v.event === 'SessionStart') return { ...base, source: 'startup' };
  return { ...base, reason: 'quit' };
}

// Test: the hook once with a made-up moment, before anything is kept: { ok, lines }.
export async function testHookForm(form, { cwd, signal } = {}) {
  const hook = toHook(form);
  if (!hook.command) return { ok: false, lines: ['no command yet'] };
  const r = await runHook(hook, sampleInput(form, cwd), { cwd, signal });
  const o = readOutcome(hook.event, r);
  const first = (s) => String(s ?? '').trim().split('\n')[0].slice(0, 160);
  const lines = [];
  const ev = eventOf(hook.event);
  if (o.error) lines.push(`✗ ${o.error}`);
  else if (o.block) lines.push(`✔ exit ${r.code ?? '?'} in ${r.ms} ms: it would stop ${ev.tool ? 'the step' : hook.event === 'Stop' ? 'the end and send the model back' : 'the message'}${o.reason ? `, saying: ${first(o.reason)}` : ''}`);
  else lines.push(`✔ exit 0 in ${r.ms} ms: it would let ${ev.tool ? 'the step' : 'it'} go on${o.allow ? ', with no question' : o.ask ? ', asking you first' : ''}`);
  if (!o.block && o.context && ['UserPromptSubmit', 'SessionStart'].includes(hook.event)) lines.push(`goes with the message: ${first(o.context)}`);
  else if (r.stdout.trim() && !o.block) lines.push(`printed: ${first(r.stdout)}`);
  if (r.stderr.trim() && !o.error && !o.block) lines.push(`stderr: ${first(r.stderr)}`);
  return { ok: !o.error, lines };
}
