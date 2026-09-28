// The seven tools the model can call: definitions it sees, argument checks,
// what the terminal shows for each, and the code that runs them.
import { resolve, relative, isAbsolute, dirname, sep, extname, join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, realpathSync } from 'node:fs';
import { readFile } from '../tools/read.mjs';
import { outlineText } from '../tools/outline.mjs';
import { diffLines } from '../tools/edit.mjs';
import { runCommand } from '../tools/run.mjs';
import { listFiles, searchFiles, walk } from '../tools/fs.mjs';
import { mathPathFor, mathDir } from './expertise.mjs';

const str = (description) => ({ type: 'string', description });
// Read: files up to WHOLE_MAX lines come back whole; longer ones as an outline,
// then PART_DEFAULT lines (at most PART_MAX) from the offset asked for.
export const WHOLE_MAX = 150;
const PART_DEFAULT = 150;
const PART_MAX = 400;

export const TOOL_DEFS = [
  {
    name: 'Read',
    description: 'Read a text file. Returns its exact text, ready to copy into Edit. A long file first comes back as a list of its parts with line numbers; then pass find (a word or name) to see the lines around it, or offset (first line, from 1) and limit (number of lines) to read the part you need.',
    parameters: { type: 'object', properties: { path: str('File path, relative to the project folder'), find: str('A word or name: shows the lines of the file around each place it appears'), offset: { type: 'integer' }, limit: { type: 'integer' } }, required: ['path'] },
  },
  {
    name: 'List',
    description: 'List files. Without pattern: the entries of one folder. With pattern: every file matching a glob such as "**/*.json" (** means any folder). Skips node_modules and .git.',
    parameters: { type: 'object', properties: { path: str('Folder, default "."'), pattern: str('Optional glob') } },
  },
  {
    name: 'Search',
    description: 'Search file contents with a regular expression. Returns "file:line:text" for up to 50 matches.',
    parameters: { type: 'object', properties: { pattern: str('Regular expression'), path: str('Folder to search, default "."'), glob: str('Optional file filter such as "*.py"') }, required: ['pattern'] },
  },
  {
    name: 'Edit',
    description: 'Change part of an existing file: replaces old_text with new_text. Copy old_text exactly from Read output (without the line numbers). It must appear exactly once, so include a line or two around the change; or set replace_all to true to change every occurrence (for renaming).',
    parameters: { type: 'object', properties: { path: str('File path'), old_text: str('Exact text to replace'), new_text: str('Replacement text'), replace_all: { type: 'boolean', description: 'Change every occurrence instead of exactly one' } }, required: ['path', 'old_text', 'new_text'] },
  },
  {
    name: 'Write',
    description: 'Create a new file. To change an existing file use Edit instead; Write replaces the whole file. A big file (hundreds of lines) does not fit in one reply: Write a short skeleton first, then add one section at a time with Edit.',
    parameters: { type: 'object', properties: { path: str('File path'), content: str('The full file content') }, required: ['path', 'content'] },
  },
  {
    name: 'Bash',
    description: 'Run a shell command (zsh) in the project folder, for example tests, a build, or git status. Stops after 2 minutes. Long output is cut.',
    parameters: { type: 'object', properties: { command: str('The command'), description: str('A few words on what it does') }, required: ['command'] },
  },
  {
    name: 'TodoWrite',
    description: 'Write your plan for a task with 3 or more steps. Send the whole list every time; mark each step pending, in_progress or done.',
    parameters: {
      type: 'object',
      properties: { todos: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'done'] } }, required: ['text', 'status'] } } },
      required: ['todos'],
    },
  },
  {
    name: 'Ask',
    description: 'Ask the user one question when the request is unclear and your tools cannot settle it: what a vague request wants, which behaviour they mean, what to do when there is nothing to fix. Not for what List, Search or Read can find. Returns their answer. Ask as often as needed, one question at a time.',
    parameters: { type: 'object', properties: { question: str('One short, specific question'), options: { type: 'array', items: { type: 'string' }, description: 'Optional: 2 to 4 short choices' } }, required: ['question'] },
  },
];

export const toolSchemas = () => TOOL_DEFS.map((d) => ({ type: 'function', function: d }));

// Small models reach for other common argument names; accept them.
const ALIASES = {
  path: ['path', 'file_path', 'filePath', 'filename', 'file', 'dir', 'directory'],
  old_text: ['old_text', 'old_string', 'oldText', 'old', 'search', 'find'],
  new_text: ['new_text', 'new_string', 'newText', 'new', 'replace', 'replacement'],
  content: ['content', 'contents', 'text', 'code'],
  command: ['command', 'cmd', 'script'],
  pattern: ['pattern', 'query', 'regex', 'glob_pattern'],
  todos: ['todos', 'items', 'plan', 'steps'],
  question: ['question', 'prompt', 'text', 'message', 'query'],
  options: ['options', 'choices', 'answers'],
};

export function normalizeArgs(name, raw) {
  const def = TOOL_DEFS.find((d) => d.name === name);
  if (!def) return raw;
  const out = {};
  for (const key of Object.keys(def.parameters.properties)) {
    for (const alias of ALIASES[key] ?? [key]) {
      if (raw[alias] !== undefined) { out[key] = raw[alias]; break; }
    }
  }
  if (name === 'TodoWrite' && Array.isArray(out.todos)) {
    out.todos = out.todos.map((t) => (typeof t === 'string' ? { text: t, status: 'pending' } : {
      text: String(t.text ?? t.content ?? t.title ?? t.task ?? ''),
      status: ['pending', 'in_progress', 'done'].includes(t.status) ? t.status : t.status === 'completed' ? 'done' : 'pending',
    }));
  }
  return out;
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

export function parseArgs(name, json) {
  let raw;
  try { raw = json && json.trim() ? JSON.parse(json) : {}; } catch (e) { return { error: `The arguments were not valid JSON (${e.message}). Write the call again with a valid JSON object. If the content is long, do not resend it whole: Write a short skeleton of the file first, then add one section at a time with Edit.` }; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: 'The arguments must be a JSON object.' };
  const args = normalizeArgs(name, raw);
  const def = TOOL_DEFS.find((d) => d.name === name);
  if (!def) return { error: `There is no tool called "${name}". The tools are: ${TOOL_DEFS.map((d) => d.name).join(', ')}.` };
  for (const req of def.parameters.required ?? []) {
    if (args[req] === undefined || args[req] === null || (typeof args[req] === 'string' && req !== 'new_text' && !args[req].length)) return { error: needsText(name, req) };
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

// What the terminal shows for a call: Read(export.mjs), Update(x), Bash(npm test)…
export function display(name, args = {}) {
  switch (name) {
    case 'Read': return { label: 'Read', arg: args.path ?? '' };
    case 'List': return { label: 'List', arg: args.pattern ? `${args.pattern}` : args.path ?? '.' };
    case 'Search': return { label: 'Search', arg: `${args.pattern ?? ''}${args.glob ? `, ${args.glob}` : ''}` };
    case 'Edit': return { label: 'Update', arg: args.path ?? '' };
    case 'Write': return { label: 'Write', arg: args.path ?? '' };
    case 'Bash': return { label: 'Bash', arg: args.command ?? '' };
    case 'TodoWrite': return { label: 'Update Todos', arg: '' };
    case 'Ask': return { label: 'Ask', arg: args.question ?? '' };
    default: return { label: name, arg: '' };
  }
}

// A path that does not exist, but whose file name appears exactly once in the
// project, most likely means that file ("src/stats.mjs" for "stats.mjs").
export function didYouMean(cwd, p) {
  const name = p.split('/').pop();
  if (!name) return [];
  const hits = [];
  let n = 0;
  for (const f of walk(cwd)) {
    if (!f.dir && f.path.split('/').pop() === name) hits.push(f.path);
    if (++n > 20000 || hits.length > 5) break;
  }
  return hits;
}

export function resolvePath(cwd, p) {
  // "~" and "~/…" mean the home folder, as in the shell: a Write to
  // "~/Desktop/notes.html" once made a folder named "~" in the home folder,
  // and Bash's "ls ~/Desktop/notes.html" then could not find the page.
  // Such a path is exact, so the retyped-path guesses below leave it alone
  // (from home, a new ~/Desktop/notes.html was once taken for ~/notes.html).
  const fromHome = p === '~' || p?.startsWith('~/');
  if (fromHome) p = homedir() + p.slice(1);
  // "MATH/…" is the user's math notes folder (src/agent/expertise.mjs),
  // read-only, unless the project really has a MATH folder of its own.
  if ((p === 'MATH' || p.startsWith('MATH/')) && !existsSync(resolve(cwd, p))) {
    const m = mathPathFor(p);
    if (m) return { abs: m.abs, rel: p, inside: true, math: true };
  }
  // The folder's own name used as a path ("project", "project/a.js") means the folder.
  const own = cwd.split(sep).pop();
  if (!isAbsolute(p) && own && (p === own || p.startsWith(`${own}/`)) && !existsSync(resolve(cwd, p))) p = p === own ? '.' : p.slice(own.length + 1);
  let abs = isAbsolute(p) ? resolve(p) : resolve(cwd, p);
  // Small models retype the project's full path and get it slightly wrong.
  // A parent of the project folder means the project folder; otherwise try
  // the end of the path inside the project.
  if (fromHome) { /* exact: no guessing */ }
  else if (isAbsolute(p) && abs !== cwd && `${cwd}${sep}`.startsWith(`${abs}${sep}`)) abs = cwd;
  else if (isAbsolute(p) && !existsSync(abs)) {
    {
      const parts = abs.split(sep).filter(Boolean);
      for (let i = 1; i < parts.length; i++) {
        const candidate = resolve(cwd, parts.slice(i).join(sep));
        if (existsSync(candidate)) { abs = candidate; break; }
      }
    }
  }
  const rel = relative(cwd, abs);
  const within = (base, p) => { const r = relative(base, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
  // A link inside the project that points outside it is outside too.
  let inside = within(cwd, abs);
  if (inside && existsSync(abs)) { try { inside = within(realpathSync(cwd), realpathSync(abs)); } catch {} }
  // A full path into the math notes folder still means the notes, read-only.
  if (!inside && existsSync(abs) && within(mathDir(), abs)) {
    const r = relative(mathDir(), abs);
    return { abs, rel: `MATH${r ? `/${r}` : ''}`, inside: true, math: true };
  }
  return { abs, rel: rel || '.', inside };
}

// Edit matching: exact first; then line by line ignoring trailing spaces;
// then ignoring indentation (re-indenting the new text to match). Each
// fallback must still find exactly one place.
// How alike two lines are, 0..1 (edit distance on the trimmed text).
export function similarity(a, b) {
  a = a.trim(); b = b.trim();
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  if (Math.abs(a.length - b.length) > Math.max(a.length, b.length) * 0.3) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

// One line must be long (20+ characters) and 93% the same; several lines each
// 85% and 93% on average. "a + c" for "a + b" is a different line, not a typo.
export function fuzzyFind(fileLines, want) {
  const single = want.length === 1;
  if (single ? want[0].trim().length < 20 : !want.some((l) => l.trim().length >= 8)) return null;
  const min = single ? 0.93 : 0.85;
  const hits = [];
  for (let i = 0; i + want.length <= fileLines.length; i++) {
    let worst = 1;
    let sum = 0;
    for (let j = 0; j < want.length && worst >= min; j++) {
      const sim = !want[j].trim() && !fileLines[i + j].trim() ? 1 : similarity(fileLines[i + j], want[j]);
      worst = Math.min(worst, sim);
      sum += sim;
    }
    if (worst >= min && sum / want.length >= 0.93) hits.push({ at: i, worst });
  }
  return hits.length === 1 ? hits[0] : null;
}

const linesWith = (text, needle) => text.split('\n').map((l, i) => (l.includes(needle.split('\n')[0]) ? i + 1 : 0)).filter(Boolean);

export function findEdit(text, oldText, newText, { replaceAll = false } = {}) {
  const count = text.split(oldText).length - 1;
  if (count >= 1 && replaceAll) return { ok: true, after: text.split(oldText).join(newText), how: 'all', count };
  if (count === 1) return { ok: true, after: text.replace(oldText, () => newText), how: 'exact' };
  if (count > 1) return { ok: false, error: `old_text appears ${count} times (lines ${linesWith(text, oldText).slice(0, 8).join(', ')}). Either include more surrounding lines so it matches once, or set replace_all to true to change all of them.` };
  // The change is already there (the model is repeating an edit it made).
  if (newText.trim() && text.includes(newText.trim())) return { ok: false, error: 'This change is already in the file: new_text is there and old_text is gone. Do not repeat it; go on with the next step.' };
  const fileLines = text.split('\n');
  const want = oldText.replace(/\n$/, '').split('\n');
  for (const mode of ['trailing', 'indent']) {
    const norm = mode === 'trailing' ? (s) => s.trimEnd() : (s) => s.trim();
    const hits = [];
    for (let i = 0; i + want.length <= fileLines.length; i++) {
      let ok = true;
      for (let j = 0; j < want.length; j++) if (norm(fileLines[i + j]) !== norm(want[j])) { ok = false; break; }
      if (ok) hits.push(i);
    }
    if (hits.length === 1) {
      const i = hits[0];
      let repl = newText.replace(/\n$/, '').split('\n');
      if (mode === 'indent') {
        const have = /^\s*/.exec(fileLines[i])[0];
        const gave = /^\s*/.exec(want[0])[0];
        repl = repl.map((l) => (l.startsWith(gave) ? have + l.slice(gave.length) : l));
      }
      const after = [...fileLines.slice(0, i), ...repl, ...fileLines.slice(i + want.length)].join('\n');
      return { ok: true, after, how: mode };
    }
    if (hits.length > 1) return { ok: false, error: `old_text matches ${hits.length} places; include more surrounding lines so it matches once.` };
  }
  // Point at the closest line to help the model try again.
  // Near-copies: the model mistyped a character or two. Accept only one
  // clear place where every line is at least 85% the same, and put back the
  // real text of the lines it meant to keep (they carry the same typo).
  const fuzzy = fuzzyFind(fileLines, want);
  if (fuzzy) {
    const i = fuzzy.at;
    const real = fileLines.slice(i, i + want.length);
    const map = new Map(want.map((w, j) => [w, real[j]]));
    const repl = newText.replace(/\n$/, '').split('\n').map((l) => map.get(l) ?? l);
    const after = [...fileLines.slice(0, i), ...repl, ...fileLines.slice(i + want.length)].join('\n');
    return { ok: true, after, how: 'fuzzy' };
  }
  // The line sharing the longest start with old_text's first line.
  const first = (want.find((l) => l.trim()) ?? '').trim();
  let near = -1;
  let best = 0;
  fileLines.forEach((l, i) => {
    const t = l.trim();
    let n = 0;
    while (n < t.length && n < first.length && t[n] === first[n]) n++;
    if (n > best) { best = n; near = i; }
  });
  if (best < Math.min(8, Math.ceil(first.length * 0.5))) near = -1;
  const hint = near >= 0 ? ` The closest match is line ${near + 1}: "${fileLines[near].trim().slice(0, 120)}". Read the file again and copy old_text exactly.` : ' Read the file again and copy old_text exactly.';
  return { ok: false, error: `old_text was not found in the file.${hint}` };
}

// Small models copy Read's line numbers ("    12\t…") into what they write.
// When most lines carry one, take them off.
export function stripLineNumbers(text) {
  if (typeof text !== 'string' || !text) return { text, stripped: false };
  // Read's header line ("strings.mjs (9 lines):") copied along with the text.
  const header = /^[^\n]*\((?:\d+ lines?|lines \d+-\d+ of \d+[^)]*)\):[ \t]*\n/;
  if (header.test(text)) return { text: stripLineNumbers(text.replace(header, '')).text, stripped: true };
  // Numbers on lines of their own ("    1\ncode\n    2\n…"), rising: drop those lines.
  {
    const ls = text.split('\n');
    const bare = ls.map((l, i) => (/^\s*\d+\s*$/.test(l) ? i : -1)).filter((i) => i >= 0);
    const vals = bare.map((i) => Number(ls[i]));
    const rising = vals.every((v, k) => k === 0 || v === vals[k - 1] + 1);
    if (bare.length >= 3 && rising && vals[0] <= 1 + (vals.length > 50 ? 1000 : 50) && bare.length >= ls.filter((l) => l.trim()).length * 0.35) {
      const drop = new Set(bare);
      return { text: ls.filter((_, i) => !drop.has(i)).join('\n').replace(/^ {4}/gm, (m) => m), stripped: true };
    }
  }
  const lines = text.split('\n');
  const full = lines.filter((l) => l.trim());
  // "   12\tcode", "   12    code", or a numbered empty line "   12"
  const re = /^\s*(\d+)(?:\t| {2,}|$)/;
  const nums = full.map((l) => re.exec(l)).filter(Boolean).map((m) => Number(m[1]));
  // At least two numbered lines, one of them with content after the number
  // (a lone "8790" is a number, not a line from Read).
  const withContent = full.filter((l) => /^\s*\d+(?:\t| {2,})\S/.test(l)).length;
  if (nums.length < 2 || !withContent || nums.length < full.length * 0.6) return { text, stripped: false };
  // The numbers must run upward, as Read prints them; otherwise it is real content.
  let rising = 0;
  for (let i = 1; i < nums.length; i++) if (nums[i] > nums[i - 1]) rising++;
  if (nums.length > 2 && rising < (nums.length - 1) * 0.8) return { text, stripped: false };
  const strip = (l) => (re.test(l) ? l.replace(/^\s*\d+(?:\t| {4}| {2,3}|$)/, '') : l);
  return { text: lines.map(strip).join('\n'), stripped: true };
}

// Does this text still parse? JavaScript via `node --check`, JSON, Python.
// Returns the error, or null (also when the language or checker is unknown).
export function syntaxError(path, text) {
  const ext = extname(path).toLowerCase();
  if (ext === '.json') { try { JSON.parse(text); return null; } catch (e) { return e.message; } }
  const cmd = ['.js', '.mjs', '.cjs'].includes(ext) ? ['node', ['--check']] : ext === '.py' ? ['python3', ['-m', 'py_compile']] : null;
  if (!cmd) return null;
  const tmp = join(tmpdir(), `bonsai-check-${process.pid}-${Date.now()}${ext}`);
  writeFileSync(tmp, text);
  const r = spawnSync(cmd[0], [...cmd[1], tmp], { encoding: 'utf8', timeout: 10_000 });
  rmSync(tmp, { force: true });
  if (r.error || r.status === 0) return null;
  const out = `${r.stderr}${r.stdout}`;
  const line = new RegExp(`${tmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+)`).exec(out)?.[1];
  const msg = out.split('\n').find((l) => /Error/.test(l))?.trim() ?? 'syntax error';
  return line ? `${msg} (line ${line})` : msg;
}

// Work out a change before asking permission, so the prompt can show the diff.
export function prepare(name, args, env) {
  if (name === 'Edit' || name === 'Write') {
    for (const k of ['old_text', 'new_text', 'content']) if (args[k] !== undefined) args[k] = stripLineNumbers(args[k]).text;
    const p = resolvePath(env.cwd, args.path);
    if (!p.inside) return { error: `${args.path} is outside the project folder, which is not allowed.` };
    if (p.math) return { error: `${p.rel} is in the user's math notes, which are read-only here. Read them; never change them.` };
    let exists = existsSync(p.abs);
    if (!exists && name === 'Edit') {
      const alt = didYouMean(env.cwd, args.path);
      if (alt.length === 1) { Object.assign(p, resolvePath(env.cwd, alt[0])); args.path = alt[0]; exists = true; }
    }
    // Rewriting a whole existing file is how a small model breaks it, so only Edit may change one.
    if (name === 'Write' && exists) {
      const lines = readFileSync(p.abs, 'utf8').split('\n').filter((l) => l.trim()).length;
      if (lines > 0) return { error: `${p.rel} already exists (${lines} lines). Use Edit to change the part that needs changing; Write is only for new files.` };
    }
    if (exists && statSync(p.abs).isDirectory()) {
      return { error: `${p.rel === '.' ? 'The project folder' : p.rel} is a folder. ${name} changes one file at a time: use Search to find the files, then ${name === 'Edit' ? 'Edit each one (replace_all changes every match inside one file)' : 'Write a file path'}.` };
    }
    if (name === 'Edit') {
      if (!exists) return { error: `${p.rel} does not exist. Use List or Search to find the file you mean.` };
      const before = readFileSync(p.abs, 'utf8');
      const m = findEdit(before, args.old_text, args.new_text, { replaceAll: args.replace_all === true });
      if (!m.ok) return { error: m.error };
      if (m.after === before) return { error: 'old_text and new_text are the same, so nothing would change. new_text must be the corrected version: write the changed lines out in full.' };
      // Refuse an edit that breaks a file which parsed before.
      const broken = syntaxError(p.abs, m.after);
      if (broken && !syntaxError(p.abs, before)) return { error: `That edit would break ${p.rel}: ${broken}. Nothing was changed. Remember: new_text REPLACES old_text (it is not added after it), so new_text must contain the whole new version of those lines and nothing twice.` };
      return { abs: p.abs, rel: p.rel, before, after: m.after, ...diffLines(before, m.after), created: false };
    }
    const before = exists ? readFileSync(p.abs, 'utf8') : '';
    const after = args.content;
    return { abs: p.abs, rel: p.rel, before, after, ...diffLines(before, after), created: !exists };
  }
  return {};
}

const cut = (s, max) => (s.length > max ? `${s.slice(0, max)}\n… (cut: ${s.length - max} more characters)` : s);

// When a search or listing comes back empty, show what the project holds so
// the model has something real to go on.
function projectFiles(cwd, max = 40) {
  const r = listFiles(cwd, { pattern: '**/*', max });
  if (!r.lines?.length) return '';
  return `\nFiles in the project${r.total > max ? ` (first ${max} of ${r.total})` : ''}:\n${r.lines.join('\n')}`;
}

// The lines (from 0) of a file that hold a word or name: as plain text
// first, whatever its case; then as a pattern. regex: a Search pattern, so
// the pattern comes first.
export function matchLines(lines, want, { regex = false } = {}) {
  const asText = () => { const low = want.toLowerCase(); return lines.flatMap((l, i) => (l.length <= 1500 && l.toLowerCase().includes(low) ? [i] : [])); };
  const asPattern = () => { try { const re = new RegExp(want, regex ? '' : 'i'); return lines.flatMap((l, i) => (l.length <= 1500 && re.test(l) ? [i] : [])); } catch { return []; } };
  const first = regex ? asPattern() : asText();
  return first.length ? first : regex ? asText() : asPattern();
}

export async function execute(name, args, prepared, env) {
  const max = env.maxResultChars ?? 12000;
  switch (name) {
    case 'Read': {
      let p = resolvePath(env.cwd, args.path);
      let note = '';
      if (!existsSync(p.abs)) {
        const alt = didYouMean(env.cwd, args.path);
        if (alt.length !== 1) return { text: `File not found: ${args.path}.${alt.length ? ` Did you mean one of: ${alt.join(', ')}?` : ' Use List or Search to find the right path.'}`, error: true, view: { kind: 'error', message: 'File not found' } };
        note = `(${args.path} does not exist; this is ${alt[0]})\n`;
        p = resolvePath(env.cwd, alt[0]);
        args.path = alt[0];
      }
      if (statSync(p.abs).isDirectory()) return { text: `${args.path} is a folder. Use List to see what is in it.`, error: true, view: { kind: 'error', message: 'That is a folder' } };
      // A small file comes back whole: small models otherwise read it 5 lines
      // at a time. A long one first comes back as an outline (its parts with
      // line ranges), then the model reads only the part it needs: reading is
      // the slow part (~60 tokens a second).
      const full = readFileSync(p.abs, 'utf8');
      const total = full.split('\n').length;
      const whole = total <= WHOLE_MAX;
      // find: the lines around a word or name, so a long file is never walked
      // part by part. (On a 27,000-line page the model never once passed an
      // offset; it read outlines again and again.)
      const want = typeof args.find === 'string' ? args.find.trim() : '';
      if (!whole && want && args.offset === undefined && !full.includes('\u0000')) {
        const { linesAround } = await import('../flows/excerpts.mjs');
        const lines = full.replace(/\n$/, '').split('\n');
        const hits = matchLines(lines, want);
        if (hits.length) {
          const shown = linesAround(args.path, lines, hits, { around: 6, maxLines: 120 });
          const count = shown.split('\n').filter((l) => !l.startsWith('```') && !/ \(lines \d+-\d+\):$/.test(l) && l !== '').length;
          const where = hits.slice(0, 12).map((h) => h + 1).join(', ');
          const head = `"${want}" is on ${hits.length} line${hits.length === 1 ? '' : 's'} of ${args.path} (${total} lines): ${where}${hits.length > 12 ? ', …' : ''}. The lines around ${hits.length > 12 ? 'the first of them' : 'them'}:`;
          return { text: `${note}${head}\n\n${cut(shown, max)}`, view: { kind: 'read', lines: count, total, content: `${head}\n\n${shown}` } };
        }
        note += `"${want}" does not appear in ${args.path}. `;
      }
      if (!whole && args.offset === undefined && args.limit === undefined && !full.includes('\u0000')) {
        const o = outlineText(full, args.path);
        // Lines matching the request's words go with the outline, so the model
        // reads the right part first instead of walking the file. (On a real
        // repo it once re-read one stylesheet four times hunting for a rule.)
        let hits = '';
        if (env.request) {
          // Imported at call time: localize/excerpts import from this file.
          const [{ taskWords }, { excerpts }] = await Promise.all([import('../flows/localize.mjs'), import('../flows/excerpts.mjs')]);
          // File-extension words from paths in the request ("server.mjs")
          // would match every import line.
          const terms = taskWords(env.request, 12).filter((t) => !/^(m?[jt]sx?|cjs|py|css|s?html?|file|line|lines)$/.test(t)).slice(0, 10);
          const ex = terms.length ? excerpts(env.cwd, [p.rel], terms, { around: 2, maxLines: 24 }) : { hits: 0 };
          if (ex.hits) hits = `\n\nLines matching the request (pass offset and limit to read around them):\n${ex.text}`;
        }
        // What this message's searches found in this file: the search gave one
        // line each, here they are with the lines around them.
        for (const pattern of (env.searches ?? []).slice(0, 3)) {
          const { linesAround } = await import('../flows/excerpts.mjs');
          const lines = full.replace(/\n$/, '').split('\n');
          const found = matchLines(lines, pattern, { regex: true });
          if (found.length) hits += `\n\nLines matching your search "${pattern}" (${found.length} in this file):\n${linesAround(args.path, lines, found, { around: 3, maxLines: 40 })}`;
        }
        return { text: `${note}${o}${hits}`, view: { kind: 'read', outline: true, parts: o.split('\n').length - 2, lines: 0, total, content: `${o}${hits}` } };
      }
      const limit = whole ? WHOLE_MAX : Math.min(Math.max(args.limit ?? PART_DEFAULT, 20), PART_MAX);
      const r = readFile(p.abs, { offset: whole ? 1 : args.offset ?? 1, limit });
      if (r.text.includes('\u0000')) return { text: `${args.path} is a binary file.`, error: true, view: { kind: 'error', message: 'Binary file' } };
      // The model gets the plain text (small models copy line numbers into
      // their edits); the screen keeps the numbered view for ctrl+o.
      const from = whole ? 1 : args.offset ?? 1;
      const plain = r.text.split('\n').slice(from - 1, from - 1 + r.shown).join('\n');
      const head = whole || r.shown >= r.lineCount ? `${args.path} (${r.lineCount} lines):` : `${args.path} (lines ${from}-${from + r.shown - 1} of ${r.lineCount}; pass offset to read more):`;
      return { text: `${note}${head}\n${cut(plain, max)}`, view: { kind: 'read', lines: r.shown, total: r.lineCount, content: r.numbered } };
    }
    case 'List': {
      const lp = resolvePath(env.cwd, args.path ?? '.');
      if (existsSync(lp.abs) && statSync(lp.abs).isFile()) {
        const lines = readFileSync(lp.abs, 'utf8').split('\n').length;
        return { text: `${lp.rel} is a file (${lines} lines, ${(statSync(lp.abs).size / 1024).toFixed(1)} KB). Use Read to see it.`, view: { kind: 'list', count: 1, content: lp.rel } };
      }
      const r = listFiles(lp.math ? mathDir() : env.cwd, { path: lp.abs, pattern: args.pattern });
      if (r.error) return { text: r.error, error: true, view: { kind: 'error', message: r.error } };
      // Entries in the math notes keep their MATH/ prefix so Read can use them as they are.
      const lines = lp.math ? r.lines.map((l) => `${lp.rel}/${l}`) : r.lines;
      const more = r.total > lines.length ? `\n… and ${r.total - lines.length} more` : '';
      return { text: (lines.join('\n') || `(nothing found)${lp.math ? '' : projectFiles(env.cwd)}`) + more, view: { kind: 'list', count: r.total, content: lines.join('\n') } };
    }
    case 'Search': {
      const sp = resolvePath(env.cwd, args.path ?? '.');
      const r = searchFiles(sp.math ? mathDir() : env.cwd, { pattern: args.pattern, path: sp.abs, glob: args.glob });
      if (r.error) return { text: r.error, error: true, view: { kind: 'error', message: r.error } };
      // Matches in the math notes keep their MATH/ prefix so Read can use them as they are.
      const lines = sp.math ? r.lines.map((l) => `MATH/${l}`) : r.lines;
      const more = r.total > lines.length ? `\n… and ${r.total - lines.length} more matches` : '';
      return { text: cut((lines.join('\n') || `No matches. Try one plain word, or Read a likely file.${sp.math ? '' : projectFiles(env.cwd)}`) + more, max), view: { kind: 'search', count: r.total, content: lines.join('\n') } };
    }
    case 'Edit':
    case 'Write': {
      mkdirSync(dirname(prepared.abs), { recursive: true });
      writeFileSync(prepared.abs, prepared.after);
      const verb = prepared.created ? 'Created' : 'Updated';
      return {
        text: `${verb} ${prepared.rel} (+${prepared.additions} −${prepared.removals} lines).`,
        view: { kind: 'diff', path: prepared.rel, created: prepared.created, hunk: prepared.hunk, additions: prepared.additions, removals: prepared.removals, lines: prepared.after.split('\n').length },
      };
    }
    case 'Bash': {
      // Output lines and the timeout move with /increase (env.bash).
      const timeoutMs = env.bash?.timeoutMs ?? 120_000;
      const r = await runCommand(args.command, { cwd: env.cwd, timeoutMs, maxLines: env.bash?.maxLines ?? 80, signal: env.signal });
      const body = r.lines.join('\n');
      const took = timeoutMs >= 90_000 ? `${Math.round(timeoutMs / 60_000)} minutes` : `${Math.round(timeoutMs / 1000)} s`;
      const status = r.timedOut ? `\n(stopped after ${took})` : r.code === 0 ? '' : `\n(exit code ${r.code})`;
      return { text: cut(body || '(no output)', max) + status, error: r.code !== 0, view: { kind: 'bash', code: r.code, lines: r.lines, ms: r.ms, timedOut: r.timedOut } };
    }
    case 'TodoWrite': {
      env.setTodos?.(args.todos);
      return { text: 'Plan saved. Carry on with the first step that is not done.', view: { kind: 'todos', items: args.todos } };
    }
    default:
      return { text: `Unknown tool ${name}.`, error: true, view: { kind: 'error', message: 'Unknown tool' } };
  }
}
