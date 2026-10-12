// A tool call's arguments (tools.mjs): patches, the other names a model gives a field, what a
// call needs, and how a call is shown. Moved from tools.mjs word for word.
import { defOf, oldSteps, toolDefs } from './tools-defs.mjs';

// apply_patch's text as the app's changes, in order: each hunk of an "*** Update File:" an Edit (its " "
// and "-" lines the old text, its " " and "+" lines the new), an "*** Add File:" a Write of its "+" lines.
// A file to delete is not done here: { error } says so, unless the patch adds it again (then it is one Write).
export function patchOps(text) {
  const ops = [];
  let file = null, mode = null, hunk = null, added = null;
  const flush = () => {
    if (mode === 'update' && hunk) {
      while (hunk.old.length && hunk.new.length && hunk.old.at(-1) === '' && hunk.new.at(-1) === '') { hunk.old.pop(); hunk.new.pop(); }
      while (hunk.old.length && hunk.new.length && hunk.old[0] === '' && hunk.new[0] === '') { hunk.old.shift(); hunk.new.shift(); }
      const old_text = hunk.old.join('\n'), new_text = hunk.new.join('\n');
      if (old_text !== new_text) ops.push({ name: 'Edit', args: { path: file, old_text, new_text } });
    }
    if (mode === 'add' && added) ops.push({ name: 'Write', args: { path: file, content: `${added.join('\n')}\n` } });
    hunk = null; added = null;
  };
  for (const l of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const m = /^\*\*\* (Update|Add|Delete) File: (.+)$/.exec(l);
    if (m) {
      flush();
      file = m[2].trim(); mode = m[1].toLowerCase();
      if (mode === 'add') added = [];
      if (mode === 'delete') ops.push({ error: `Deleting ${file} is not done by a patch here; say why it should go, or use Bash rm.`, deletes: file });
      continue;
    }
    if (/^\*\*\* (Begin Patch|End Patch|End of File|Move to:)/.test(l)) continue;
    if (mode === 'add') { if (l.startsWith('+')) added.push(l.slice(1)); continue; }
    if (mode !== 'update') continue;
    if (l.startsWith('@@')) { flush(); hunk = { old: [], new: [] }; continue; }
    hunk ??= { old: [], new: [] };
    if (l.startsWith('-')) hunk.old.push(l.slice(1));
    else if (l.startsWith('+')) hunk.new.push(l.slice(1));
    else { const t = l.startsWith(' ') ? l.slice(1) : l; hunk.old.push(t); hunk.new.push(t); }
  }
  flush();
  // A file deleted and added again in one patch is that file written whole (gpt-oss's way to replace a
  // file, 4 Oct 2026: ten of its patches were refused as deletes).
  return ops.filter((op) => !(op.deletes && ops.some((w) => w.name === 'Write' && w.args.path === op.deletes)));
}

// Small models reach for other common argument names; accept them.
const ALIASES = {
  path: ['path', 'file_path', 'filePath', 'filename', 'file', 'dir', 'directory'],
  old_text: ['old_text', 'old_string', 'oldText', 'old', 'search', 'find'],
  new_text: ['new_text', 'new_string', 'newText', 'new', 'replace', 'replacement'],
  content: ['content', 'contents', 'text', 'code', 'file_text', 'body', 'data', 'prompt'],
  command: ['command', 'cmd', 'script', 'commands', 'code', 'bash', 'shell', 'input'],
  pattern: ['pattern', 'query', 'regex', 'glob_pattern', 'find', 'search', 'term', 'keyword'],
  todos: ['todos', 'items', 'plan', 'steps', 'tasks', 'todo_list', 'todoList', 'todo'],
  offset: ['offset', 'line_start', 'start_line'],
  line: ['line', 'line_number', 'lineNumber', 'start_line', 'at_line'],
  question: ['question', 'prompt', 'text', 'message', 'query'],
  options: ['options', 'choices', 'answers'],
  paths: ['paths', 'files', 'file_paths', 'filePaths'],
  query: ['query', 'description', 'text', 'what', 'search'],
  from: ['from', 'old_name', 'oldName', 'old', 'name'],
  to: ['to', 'new_name', 'newName', 'new'],
  task: ['task', 'request', 'description', 'prompt', 'what'],
  kind: ['kind', 'type'],
  fact: ['fact', 'text', 'memory', 'note', 'content'],
  about: ['about', 'scope', 'kind', 'type'],
  url: ['url', 'address', 'link', 'uri', 'href', 'page'],
  prompt: ['prompt', 'task', 'instructions', 'request', 'message'],
  description: ['description', 'title', 'summary', 'name'],
  find: ['find', 'search', 'look_for'],
  app: ['app', 'application', 'app_name', 'window', 'program'],
  // Claude Code's names too: timeout (milliseconds there; see secsOf), run_in_background, shell_id.
  timeout: ['timeout', 'timeout_secs', 'timeout_seconds', 'seconds', 'timeout_ms'],
  background: ['background', 'run_in_background', 'in_background', 'detach', 'detached'],
  id: ['id', 'job', 'job_id', 'shell_id', 'bash_id', 'task_id'],
  stop: ['stop', 'kill', 'cancel'],
};
// Fewer steps lost (6 Oct 2026, off with AGENTIC_STEPS=old): Qwen3.6 on the service sent Edit
// {"pattern", "replacement"} twice and {"original", "replacement"} once, each turned back. And the names of
// the str_replace editor many coding models learn on, old_str and new_str (8 Oct 2026: Qwen3.6's Edits
// came back three times as 'Edit needs "old_text"'; which names it sent is not known yet).
const MORE_ALIASES = { old_text: ['original', 'pattern', 'old_content', 'old_str'], new_text: ['new_content', 'updated', 'new_str'] };
const aliasesOf = (key) => [...(ALIASES[key] ?? [key]), ...(oldSteps() ? [] : MORE_ALIASES[key] ?? [])];

// Where a plan's step keeps its words, in the order looked at, and what is never its words.
const TODO_TEXT = ['text', 'content', 'title', 'task', 'value', 'description', 'step', 'name', 'item', 'activeForm'];
const TODO_NOT_TEXT = ['status', 'id', 'priority'];

export function normalizeArgs(name, raw, way = 'model') {
  const def = defOf(name, way);
  if (!def) return raw;
  const out = {};
  // A name that differs only in case or _ and - ({"Command": "npm test"}, Qwen3.6 on the service, 6 Oct 2026) counts too.
  const flat = (k) => String(k).toLowerCase().replace(/[_-]/g, '');
  const loose = oldSteps() ? new Map() : new Map(Object.keys(raw ?? {}).map((k) => [flat(k), raw[k]]));
  for (const key of Object.keys(def.parameters.properties)) {
    for (const alias of aliasesOf(key)) {
      if (raw[alias] !== undefined) { out[key] = raw[alias]; break; }
    }
    if (out[key] === undefined) for (const alias of aliasesOf(key)) if (loose.get(flat(alias)) !== undefined) { out[key] = loose.get(flat(alias)); break; }
  }
  // A plan sent as text (4 Oct 2026: qwen3-coder-next sent its list as a string of JSON three times,
  // Qwen3.6 a numbered plan, each told "must be a list"): JSON read as the list it is, else a step a line.
  if (name === 'TodoWrite' && typeof out.todos === 'string') out.todos = planOf(out.todos);
  // One step a call (Qwen3.6 at 64k, 4 Oct 2026: {"task": "Add plainRead …", "active": "1"}, four calls, then the
  // plan as lines under "task"): lines are the whole plan; one line is a step added to the plan there is.
  if (name === 'TodoWrite' && out.todos === undefined) {
    const one = ['task', 'content', 'text', 'item', 'step', 'title', 'description'].map((k) => raw[k]).find((v) => typeof v === 'string' && v.trim());
    if (one?.includes('\n')) out.todos = planOf(one);
    else if (one) { out.todos = [{ text: one.trim(), status: ['pending', 'in_progress', 'done', 'completed'].includes(raw.status) ? raw.status : 'pending' }]; out.one = true; }
  }
  // repo_browser.open_file's last line, and container.exec's command as a list (["bash", "-lc", "…"]).
  if (name === 'Read' && out.offset !== undefined && out.limit === undefined && Number(raw.line_end) >= Number(out.offset)) out.limit = Number(raw.line_end) - Number(out.offset) + 1;
  // A list sent as a string of JSON is read as the list it is, and a step of it may be an object with
  // its own command (Qwen3.6 on the service, 8 Oct 2026: "commands": '[{"command": "python3 --version",
  // "name": "check-python"}]' four times; zsh ran the text and said "bad pattern: [{command:").
  if (name === 'Bash' && typeof out.command === 'string' && /^\s*\[[\s\S]*\]\s*$/.test(out.command)) {
    try { const v = JSON.parse(out.command); if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string' || typeof (x?.command ?? x?.cmd) === 'string')) out.command = v; } catch {}
  }
  // Several commands as a list ("commands": ["cd src", "ls"], or steps each with its own "command") run one
  // after the other; one command in pieces is joined.
  if (name === 'Bash' && Array.isArray(out.command)) {
    const list = out.command;
    const steps = list.some((x) => x && typeof x === 'object');
    const several = steps || (raw.commands !== undefined && raw.command === undefined && raw.cmd === undefined);
    out.command = !steps && /^(ba|z)?sh$/.test(list[0]) && /^-l?c$/.test(list[1] ?? '') ? String(list.slice(2).join(' '))
      : list.map((x) => (x && typeof x === 'object' ? x.command ?? x.cmd ?? '' : x)).filter((x) => String(x).trim()).join(several ? ' && ' : ' ');
  }
  // A step's words under another name ({"value": "…", "complete": false}, Qwen3.6 on the service, 8 Oct 2026:
  // six steps shown as empty boxes), else its first other words; done as a flag counts too.
  if (name === 'TodoWrite' && Array.isArray(out.todos)) {
    out.todos = out.todos.map((t) => (typeof t === 'string' ? { text: t, status: 'pending' } : {
      text: String(TODO_TEXT.map((k) => t?.[k]).find((v) => typeof v === 'string' && v.trim()) ?? Object.entries(t ?? {}).find(([k, v]) => typeof v === 'string' && v.trim() && !TODO_NOT_TEXT.includes(k))?.[1] ?? ''),
      status: ['pending', 'in_progress', 'done'].includes(t?.status) ? t.status : t?.status === 'completed' || t?.complete === true || t?.done === true || t?.completed === true ? 'done' : 'pending',
    }));
  }
  return out;
}

// A plan sent as one string: a JSON list (or { todos: [...] }), else one step a line, its "1." or "-"
// and a checkbox taken off ("[x]" is done).
function planOf(s) {
  const t = s.trim();
  if (/^[[{]/.test(t)) { try { const v = JSON.parse(t); const list = Array.isArray(v) ? v : v?.todos ?? v?.items ?? v?.tasks; if (Array.isArray(list)) return list; } catch {} }
  return t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const done = /^(?:[-*]|\d+[.)])?\s*\[[xX]\]/.test(l);
    const text = l.replace(/^(?:[-*•]|\d+[.)])\s*/, '').replace(/^\[[ xX]\]\s*/, '').trim();
    return { text, status: done ? 'done' : 'pending' };
  }).filter((x) => x.text);
}

// What a missing argument holds. The error says how to send the call again,
// not only what was wrong: on 28 Sep Gemma sent Write without "path" twice,
// was told only 'Write needs "path".', and wrote the whole page again each time.
const NEEDS = {
  path: 'the file path, relative to the project folder',
  content: 'the full file content',
  old_text: 'the exact text to replace, copied from Read',
  new_text: 'the text that replaces it',
  command: 'the shell command to run',
  pattern: 'the regular expression to look for',
  todos: 'the whole plan, as a list of steps',
  question: 'one short question',
};
export const needsText = (name, req) => `${name} needs "${req}"${NEEDS[req] ? `: ${NEEDS[req]}` : ''}. Send the ${name} call again with "${req}" set.`;

// The arguments as sent, under their usual names; null when they are not a JSON object.
export function sentArgs(name, json) {
  try {
    const raw = JSON.parse(json);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? normalizeArgs(name, raw) : null;
  } catch { return null; }
}

// way: which tools there are ('app' as before; 'model' adds MODEL_TOOL_DEFS and Read's paths).
export function parseArgs(name, json, way = 'app') {
  let raw;
  try { raw = json && json.trim() ? JSON.parse(json) : {}; } catch (e) { return { error: `The arguments were not valid JSON (${e.message}). Write the call again with a valid JSON object. If the content is long, do not resend it whole: Write a short skeleton of the file first, then add one section at a time with Edit.` }; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: 'The arguments must be a JSON object.' };
  const def = defOf(name, way);
  if (!def) return { error: `There is no tool called "${name}". The tools are: ${toolDefs(way).map((d) => d.name).join(', ')}.` };
  // Read takes a list of paths on both ways: only Model's list of tools says so, but a big model sends
  // one on App too (3 Oct 2026, Qwen3.6 on a service: "Read needs path", a step lost). A list sent as
  // a string of JSON ('["a.mjs", "b.mjs"]') is read as the list it is.
  const args = normalizeArgs(name, raw, name === 'Read' ? 'model' : way);
  if (name === 'Read') {
    if (typeof args.paths === 'string') args.paths = listOfPaths(args.paths);
    if (Array.isArray(args.paths)) args.paths = args.paths.map((x) => String(x).trim()).filter(Boolean).slice(0, 8);
    if (!args.path && args.paths?.length === 1) { args.path = args.paths[0]; delete args.paths; }
    if (args.path && args.paths) delete args.paths;
    if (!args.path && !args.paths?.length) return { error: way === 'model' ? 'Read needs "path" (one file) or "paths" (a list of files). Send the Read call again with one of them set.' : needsText(name, 'path') };
  }
  // Ask's choices sent as a string of JSON are read as the list they are.
  if (name === 'Ask') for (const k of ['options', 'more']) if (typeof args[k] === 'string') { try { const v = JSON.parse(args[k]); if (Array.isArray(v)) args[k] = v; } catch {} }
  for (const req of name === 'Read' && args.paths ? [] : def.parameters.required ?? []) {
    if (args[req] === undefined || args[req] === null || (typeof args[req] === 'string' && req !== 'new_text' && !args[req].length)) return { error: needsText(name, req), missing: req };
  }
  for (const [k, v] of Object.entries(args)) {
    const want = def.parameters.properties[k]?.type;
    if (want === 'string' && typeof v !== 'string') args[k] = String(v);
    if (want === 'integer' && typeof v !== 'number') { const n = Number(v); if (Number.isFinite(n)) args[k] = Math.round(n); else delete args[k]; }
    if (want === 'array' && !Array.isArray(v)) return { error: `${name}: "${k}" must be a list.` };
    if (want === 'boolean' && typeof v !== 'boolean') args[k] = v === 'true' || v === 1 || v === '1';
  }
  return { args };
}

// What a call missing something brought with it, for the model and the screen (8 Oct 2026, the owner: "how do
// we make it more like you in this step?": Claude Code's own errors say what was wrong with the call as sent).
// Each name it sent and its size, the ones this tool does not take (a name of its own, to send again under the
// tool's names), else that nothing more came (text lost on the way). { text, shown }; null for no JSON object.
export function arrivedNote(name, json, way = 'app') {
  let raw;
  try { raw = JSON.parse(json || '{}'); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const def = defOf(name, way);
  if (!def) return null;
  const flat = (k) => String(k).toLowerCase().replace(/[_-]/g, '');
  const keys = Object.keys(raw);
  const taken = new Set();
  for (const key of Object.keys(def.parameters.properties)) {
    const hit = aliasesOf(key).find((a) => raw[a] !== undefined) ?? keys.find((k) => aliasesOf(key).some((a) => flat(a) === flat(k)));
    if (hit !== undefined) taken.add(hit);
  }
  const size = (v) => (typeof v === 'string' ? (v.includes('\n') ? `${v.split('\n').length} lines` : v.length > 60 ? `${v.length} characters` : JSON.stringify(v)) : Array.isArray(v) ? `a list of ${v.length}` : v && typeof v === 'object' ? 'an object' : JSON.stringify(v));
  const other = keys.filter((k) => !taken.has(k));
  const names = Object.keys(def.parameters.properties);
  if (!keys.length) return { text: `Your ${name} call arrived with no arguments at all: if you wrote them, they were lost on the way. Its arguments are ${names.join(', ')}.`, shown: 'came with no arguments' };
  const came = `Your ${name} call arrived with: ${keys.map((k) => `${k} (${size(raw[k])})`).join(', ')}.`;
  if (other.length) return { text: `${came} ${name} does not take ${other.map((k) => `"${k}"`).join(' or ')}: its arguments are ${names.join(', ')}.`, shown: `came with ${keys.join(', ')}; ${other.join(', ')} not one of its names` };
  return { text: `${came} Nothing else came: if you wrote more, it was lost on the way. Send it again; a long text in a shorter first part.`, shown: `came with only ${keys.join(', ')}` };
}

// A list of paths sent as one string: JSON ('["a.mjs", "b.mjs"]'), else split at commas and spaces.
function listOfPaths(s) {
  if (/^\s*\[/.test(s)) { try { const v = JSON.parse(s); if (Array.isArray(v)) return v; } catch {} }
  return s.replace(/^\s*\[|\]\s*$/g, '').split(/[\s,]+/).map((x) => x.replace(/^["']|["']$/g, '')).filter(Boolean);
}

// What the terminal shows for a call: Read(export.mjs), Update(x), Bash(npm test)…
export function display(name, args = {}) {
  switch (name) {
    case 'Read': return { label: 'Read', arg: args.path ?? (Array.isArray(args.paths) ? args.paths.join(', ') : '') };
    case 'List': return { label: 'List', arg: args.pattern ? `${args.pattern}` : args.path ?? '.' };
    case 'Search': return { label: 'Search', arg: `${args.pattern ?? ''}${args.glob ? `, ${args.glob}` : ''}` };
    case 'Edit': return { label: 'Update', arg: args.path ?? '' };
    case 'Write': return { label: 'Write', arg: args.path ?? '' };
    case 'Bash': return { label: 'Bash', arg: args.command ?? '' };
    case 'TodoWrite': return { label: 'Update Todos', arg: '' };
    case 'Jobs': return { label: 'Jobs', arg: args.id ? `${String(args.id).trim()}${args.stop === true || args.stop === 'true' ? ' (stop)' : ''}` : 'list' };
    case 'Ask': return { label: 'Ask', arg: args.question ?? '' };
    case 'Map': return { label: 'Map', arg: args?.part ? `docs/map/${String(args.part).replace(/\.md$/, '')}.md` : 'the project' };
    case 'CodeSearch': return { label: 'CodeSearch', arg: args.query ?? '' };
    case 'Rename': return { label: 'Rename', arg: args.from || args.to ? `${args.from ?? '?'} → ${args.to ?? '?'}` : '' };
    case 'TestFirst': { const t = String(args.task ?? '').replace(/\s+/g, ' ').trim(); return { label: 'TestFirst', arg: t.length > 70 ? `${t.slice(0, 69)}…` : t }; }
    case 'Remember': return { label: 'Remember', arg: String(args.fact ?? '').replace(/\s+/g, ' ').trim() };
    case 'WebSearch': return { label: 'Web Search', arg: `"${String(args.query ?? '').replace(/\s+/g, ' ').trim()}"` };
    case 'WebFetch': return { label: 'Fetch', arg: String(args.url ?? '') };
    case 'Screen': return { label: 'Screen', arg: String(args.app ?? '').trim() || 'whole screen' };
    case 'App': return { label: 'App', arg: args.action === 'command' ? String(args.command ?? '').trim() : args.action === 'setting' ? `setting ${args.key ?? '(all)'}${args.value !== undefined ? ' = ' + JSON.stringify(args.value) : ''}` : 'restart on the new code' };
    case 'Agent': { const d = String(args.description || args.prompt || '').replace(/\s+/g, ' ').trim(); const k = String(args.kind ?? '').toLowerCase(); return { label: k === 'general' ? 'Agent' : !k || k === 'explore' ? 'Explore' : k, arg: d.length > 70 ? `${d.slice(0, 69)}…` : d }; }
    default: return { label: name, arg: '' };
  }
}
