// Your own hooks (3 Oct 2026, the owner's pick): commands of yours the app runs at seven moments,
// in Claude Code's own layout, so a hook can be copied over from there and back. They sit beside
// the app's own checks (way.mjs HOOKS), which /hooks lists with them.
//   ~/.agentic-coder/hooks.json      yours, for every folder (the /hooks form writes it)
//   <project>/.agentic/hooks.json    a project's own: never run before a yes to that very file
//                                    (its fingerprint, kept in hooks-state.json), as with .agentic/mcp.json
// The file is Claude Code's "hooks" block, alone or inside { "hooks": … }:
//   { "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "…", "timeout": 60 } ] } ] } }
// with one key of ours, "off": true on a hook that is switched off. A hook gets the moment as JSON
// on stdin (Claude Code's fields: hook_event_name, tool_name, tool_input with file_path, …) and
// answers as Claude Code's do: exit 0 goes on, exit 2 stops (stderr says why), any other exit is
// an error that is only shown; or JSON on stdout ({"decision": "block", "reason": …}, or
// hookSpecificOutput's permissionDecision / additionalContext).
// It runs as you, in the project folder, with no sandbox: it is your command, like one typed after !.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { HOME } from '../../../models/index.mjs';

export const EVENTS = [
  { id: 'PreToolUse', label: 'Before a step', tool: true, what: 'before a tool runs: exit 2 stops it, and the model is told why (what it prints to stderr)' },
  { id: 'PostToolUse', label: 'After a step', tool: true, what: 'after a tool ran: exit 2 tells the model what it prints to stderr' },
  { id: 'UserPromptSubmit', label: 'You send a message', what: 'before your message goes: exit 2 stops it; what it prints goes with the message' },
  { id: 'Stop', label: 'A reply ends', what: 'when the model says it is done: exit 2 sends it back to work, with what it prints to stderr' },
  { id: 'Notification', label: 'It asks you', what: 'when it waits for your answer (a permission, a question): to ping you' },
  { id: 'SessionStart', label: 'Window opens', what: 'at the start, after /clear and /resume: what it prints goes with your first message' },
  { id: 'SessionEnd', label: 'Window closes', what: 'when you quit, and at /clear' },
];
const EVENT_IDS = EVENTS.map((e) => e.id);
export const eventOf = (id) => EVENTS.find((e) => e.id === id) ?? null;
// A hook's time limit when it gives none, in seconds (Claude Code's too), and the most one may ask.
export const HOOK_SECS = 60;
const HOOK_MAX_SECS = 600;
// A Stop hook may send the model back this many times in one message, then the reply ends anyway.
export const STOP_BACKS = 3;
// Output kept from a hook, in characters.
const OUT_MAX = 8000;

// The tool names here and Claude Code's for the same tool, so a matcher written for either fits.
const OTHER_NAMES = { Search: ['Grep'], List: ['Glob', 'LS'], Agent: ['Task'], Edit: ['MultiEdit'], Jobs: ['BashOutput', 'KillShell'] };

const userHooksFile = (home = HOME) => join(home, 'hooks.json');
const projectHooksFile = (cwd) => join(cwd, '.agentic', 'hooks.json');
const stateFile = (home = HOME) => join(home, 'hooks-state.json');
const printOf = (text) => createHash('sha1').update(text).digest('hex').slice(0, 16);

// A file's hooks, flat: [{ event, matcher, command, timeout, off }], or { error } when it cannot be read.
export function parseHooks(text) {
  let json;
  try { json = JSON.parse(text); } catch (e) { return { error: `it is not JSON (${e.message})` }; }
  const block = json && typeof json === 'object' && json.hooks && typeof json.hooks === 'object' && !Array.isArray(json.hooks) ? json.hooks : json;
  if (!block || typeof block !== 'object' || Array.isArray(block)) return { error: 'it holds no hooks block' };
  const list = [];
  for (const [event, groups] of Object.entries(block)) {
    if (!EVENT_IDS.includes(event) || !Array.isArray(groups)) continue;
    for (const g of groups) {
      for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
        if (h?.type !== undefined && h.type !== 'command') continue;
        const command = String(h?.command ?? '').trim();
        if (!command) continue;
        const timeout = Number(h.timeout);
        list.push({ event, matcher: eventOf(event).tool ? String(g.matcher ?? '').trim() : '', command, ...(Number.isFinite(timeout) && timeout > 0 ? { timeout: Math.min(HOOK_MAX_SECS, timeout) } : {}), ...(h.off === true ? { off: true } : {}) });
      }
    }
  }
  return { list };
}

// The flat list back as the file's layout: a group per event and matcher, in the list's order.
export function hooksBlock(list) {
  const block = {};
  for (const h of list) {
    const groups = (block[h.event] ??= []);
    const tool = eventOf(h.event)?.tool;
    let g = groups.find((x) => (x.matcher ?? '') === (tool ? h.matcher ?? '' : ''));
    if (!g) { g = tool ? { matcher: h.matcher ?? '', hooks: [] } : { hooks: [] }; groups.push(g); }
    g.hooks.push({ type: 'command', command: h.command, ...(h.timeout ? { timeout: h.timeout } : {}), ...(h.off ? { off: true } : {}) });
  }
  return block;
}

// Yours: { list, error }. A missing file is none.
export function readUserHooks(home = HOME) {
  const f = userHooksFile(home);
  if (!existsSync(f)) return { list: [] };
  try { const r = parseHooks(readFileSync(f, 'utf8')); return r.error ? { list: [], error: `~/.agentic-coder/hooks.json cannot be used: ${r.error}` } : r; } catch (e) { return { list: [], error: e.message }; }
}
// Yours, written back (the /hooks form). Anything else the file held beside "hooks" is kept.
export function writeUserHooks(list, home = HOME) {
  const f = userHooksFile(home);
  let rest = {};
  try { const j = JSON.parse(readFileSync(f, 'utf8')); if (j && typeof j === 'object' && j.hooks && !Array.isArray(j.hooks)) { rest = { ...j }; delete rest.hooks; } } catch { /* a new file */ }
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, `${JSON.stringify({ ...rest, hooks: hooksBlock(list) }, null, 2)}\n`);
}

// A project's own: { file, print, list, answer: 'yes' | 'never' | null, changed, error } or null.
export function readProjectHooks(cwd, home = HOME) {
  const file = projectHooksFile(cwd);
  if (!cwd || !existsSync(file)) return null;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { return { file, print: null, list: [], answer: null, error: e.message }; }
  const r = parseHooks(text);
  const print = printOf(text);
  const was = readState(home).projects?.[cwd];
  const answer = was?.print === print ? was.answer : was?.answer === 'never' ? 'never' : null;
  return { file, print, list: r.list ?? [], answer, changed: Boolean(was && was.print !== print && was.answer === 'yes'), ...(r.error ? { error: r.error } : {}) };
}
function readState(home) { try { return JSON.parse(readFileSync(stateFile(home), 'utf8')); } catch { return {}; } }
// Your answer to a project's file: yes (for that very file), never, or forget.
export function answerProjectHooks(cwd, print, answer, home = HOME) {
  const s = readState(home);
  s.projects ??= {};
  if (answer === null) delete s.projects[cwd];
  else s.projects[cwd] = { print, answer, at: new Date().toISOString() };
  mkdirSync(home, { recursive: true });
  writeFileSync(stateFile(home), `${JSON.stringify(s, null, 2)}\n`);
}

// Whether a hook's matcher fits a tool: empty or * fits all; else a regular expression over the
// whole name (Claude Code's "Edit|Write"), tried on the name here and Claude Code's names for it.
export function matches(matcher, tool) {
  const m = String(matcher ?? '').trim();
  if (!m || m === '*') return true;
  const names = [tool, ...(OTHER_NAMES[tool] ?? [])];
  let re = null;
  try { re = new RegExp(`^(?:${m})$`); } catch { /* not a pattern: the name itself */ }
  return names.some((n) => (re ? re.test(n) : n === m));
}

// What a hook is told about a tool's call: its arguments as sent, and Claude Code's names for
// them too (file_path as a whole path, old_string, new_string), so a hook written for it works.
export function toolInput(name, args = {}, cwd = '') {
  const out = { ...args };
  const path = args.path ?? args.file_path;
  if (typeof path === 'string' && ['Read', 'Edit', 'Write'].includes(name)) out.file_path = path.startsWith('/') ? path : join(cwd, path);
  if (args.old_text !== undefined) out.old_string = args.old_text;
  if (args.new_text !== undefined) out.new_string = args.new_text;
  if (name === 'Bash' && args.background !== undefined) out.run_in_background = args.background;
  return out;
}

// One hook run: { code, stdout, stderr, timedOut, ms }. stdin gets the moment as JSON.
export function runHook(hook, input, { cwd, signal } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const env = { ...process.env, AGENTIC_PROJECT_DIR: cwd ?? '', CLAUDE_PROJECT_DIR: cwd ?? '', AGENTIC_HOOK_EVENT: hook.event };
    delete env.AGENTIC_RESTART_FILE;
    let child;
    try { child = spawn('/bin/zsh', ['-c', hook.command], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true }); } catch (e) { resolve({ code: 1, stdout: '', stderr: e.message, timedOut: false, ms: 0 }); return; }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let done = false;
    const kill = (sig) => { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch {} } };
    const secs = Math.min(HOOK_MAX_SECS, hook.timeout ?? HOOK_SECS);
    const timer = setTimeout(() => { timedOut = true; kill('SIGKILL'); }, secs * 1000);
    const onAbort = () => kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (d) => { if (stdout.length < OUT_MAX) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < OUT_MAX) stderr += d; });
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ code: timedOut ? null : code, stdout: stdout.slice(0, OUT_MAX), stderr: stderr.slice(0, OUT_MAX), timedOut, ms: Date.now() - t0 });
    };
    child.on('close', (code) => finish(code));
    child.on('error', (e) => { stderr += e.message; finish(1); });
    child.stdin.on('error', () => { /* a hook that does not read its input */ });
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
}

// What one run means, as Claude Code reads it: { block, reason, allow, ask, context, error }.
export function readOutcome(event, r) {
  let json = null;
  const out = r.stdout.trim();
  if (out.startsWith('{')) { try { json = JSON.parse(out); } catch { /* plain text */ } }
  const spec = json?.hookSpecificOutput ?? {};
  const said = (s) => String(s ?? '').trim();
  if (r.timedOut) return { error: 'it ran out of time' };
  const block = r.code === 2 || json?.decision === 'block' || json?.continue === false || spec.permissionDecision === 'deny';
  const reason = said(json?.reason ?? spec.permissionDecisionReason ?? json?.stopReason) || said(r.stderr) || (r.code === 2 ? '' : said(json ? '' : out));
  if (block) return { block: true, reason };
  if (r.code !== 0) return { error: `it exited with code ${r.code}${said(r.stderr) ? `: ${said(r.stderr).split('\n')[0].slice(0, 200)}` : ''}` };
  return {
    allow: json?.decision === 'approve' || spec.permissionDecision === 'allow',
    ask: spec.permissionDecision === 'ask',
    reason: said(spec.permissionDecisionReason ?? json?.reason),
    context: said(spec.additionalContext) || (json ? '' : out),
  };
}

// The hooks of a window: yours and (once you said yes) the project's, run at each moment.
// onNote(text, tone): a hook that failed, or that stopped something, is said on the screen.
export class UserHooks {
  constructor({ cwd, home = HOME, onNote = () => {} } = {}) {
    Object.assign(this, { cwd, home, onNote, sessionId: `${Date.now()}` });
    this.reload();
  }
  reload() {
    const yours = readUserHooks(this.home);
    this.yours = yours.list;
    this.error = yours.error ?? null;
    this.project = readProjectHooks(this.cwd, this.home);
    const theirs = this.project?.answer === 'yes' ? this.project.list.map((h) => ({ ...h, project: true })) : [];
    this.list = [...this.yours.map((h) => ({ ...h })), ...theirs];
    return this;
  }
  moveTo(cwd) { if (cwd !== this.cwd) { this.cwd = cwd; this.reload(); } }
  // The hooks on for a moment (and a tool).
  of(event, tool = null) { return this.list.filter((h) => !h.off && h.event === event && (!eventOf(event).tool || matches(h.matcher, tool))); }
  has(event, tool = null) { return this.of(event, tool).length > 0; }

  // Runs the moment's hooks side by side and puts their answers together:
  // { ran, block, reason, allow, ask, context }. fields: the moment's own (tool_name, prompt…).
  async run(event, fields = {}, { tool = null, signal, permissionMode } = {}) {
    const hooks = this.of(event, tool);
    if (!hooks.length) return { ran: 0 };
    const input = { session_id: this.sessionId, transcript_path: null, cwd: this.cwd, hook_event_name: event, ...(permissionMode ? { permission_mode: permissionMode } : {}), ...fields };
    const runs = await Promise.all(hooks.map((h) => runHook(h, input, { cwd: this.cwd, signal }).then((r) => ({ h, r, o: readOutcome(event, r) }))));
    const all = { ran: runs.length, block: false, reasons: [], allow: false, ask: false, context: [] };
    for (const { h, o } of runs) {
      const name = h.command.length > 60 ? `${h.command.slice(0, 59)}…` : h.command;
      if (o.error) { this.onNote(`Your ${eventOf(event).label.toLowerCase()} hook "${name}" did not work: ${o.error}.`, 'warn'); continue; }
      if (o.block) { all.block = true; all.reasons.push(o.reason || `your hook "${name}" said no`); continue; }
      if (o.allow) all.allow = true;
      if (o.ask) all.ask = true;
      if (o.reason) all.reasons.push(o.reason);
      if (o.context) all.context.push(o.context);
    }
    return { ran: all.ran, block: all.block, reason: all.reasons.join('\n'), allow: all.allow && !all.ask, ask: all.ask, context: all.context.join('\n\n') };
  }
  // A moment nobody waits for (Notification): run, never awaited by the caller.
  fire(event, fields = {}) { if (this.has(event)) this.run(event, fields).catch(() => {}); }
}
