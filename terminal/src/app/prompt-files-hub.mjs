// The hub's Prompt files (Instructions → 06 AGENTS.md · 07 TOOLS.md · 08 SKILLS.md,
// 30 Sep 2026): read and save the three files the model is given.
//   AGENTS.md  the chosen folder's own rules file (the page's Folder menu)
//   TOOLS.md   terminal/rules/TOOLS.md: the "Tool use" part of the instructions
//   SKILLS.md  terminal/rules/SKILLS.md: steps a request's words bring
// and the remote set (2 Oct 2026, terminal/rules/remote/, prompt-files.mjs): its TOOLS.md and
// SKILLS.md behind tabs 07–08's Local | Remote switch, and HARNESS.md and the fourteen guides on
// tab 09 ("remote:<name>": remote:tools, remote:skills, remote:harness, remote:PLANNING …).
// A save never overwrites a newer change made elsewhere (another window, an
// editor, another session): the file's revision must match. The text before
// each save is kept (20 a file) in ~/.agentic-coder/prompt-files/, so Undo
// puts it back, or removes a file the save created.
import { readFileSync, writeFileSync, mkdirSync, renameSync, openSync, closeSync, unlinkSync, realpathSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { instructionHome } from '../agent/instructions.mjs';
import { projectNotes, notesRoom } from '../agent/prompt.mjs';
import { BUILT_IN, BUILT_IN_REMOTE, PROMPT_FILES, REMOTE_DIR, GUIDES, rulesDir, readPromptFile, sectionOf, toolUseText, parseSkills, skillProblems, skillsList, pickSkill, skillNote, readGuides } from '../agent/prompt-files.mjs';

const REMOTE_FILES = Object.freeze(['remote:tools', 'remote:skills', 'remote:harness', ...GUIDES.map((g) => `remote:${g}`)]);
export const FILES = Object.freeze(['agents', 'tools', 'skills', ...REMOTE_FILES]);
// A remote file's key without "remote:" (tools, skills, harness, PLANNING …).
const inner = (which) => which.replace(/^remote:/, '');
const isRemote = (which) => which.startsWith('remote:');
const fileName = (which) => (which === 'agents' ? 'AGENTS.md' : PROMPT_FILES[inner(which)] ?? (inner(which) === 'harness' ? 'HARNESS.md' : `${inner(which)}.md`));
const FILE_NAMES = Object.freeze(Object.fromEntries(FILES.map((f) => [f, isRemote(f) ? `remote/${fileName(f)}` : fileName(f)])));
// Hard limits a save checks. TOOLS.md and HARNESS.md are in every conversation, so they stay small.
const FILE_LIMITS = Object.freeze({ agents: 60_000, tools: 4_000, skills: 40_000, 'remote:tools': 4_000, 'remote:skills': 40_000, 'remote:harness': 8_000, ...Object.fromEntries(GUIDES.map((g) => [`remote:${g}`, 6_000])) });
// HARNESS.md's parts the remote instructions are built from (prompt.mjs remotePrompt).
const HARNESS_PARTS = ['Who you are', 'How you work', 'Rules the app enforces'];
const HISTORY_KEEP = 20;
const estimate = (text) => Math.ceil((text?.length ?? 0) / 3.6);

// A new AGENTS.md starts from this: the three parts a small model finds quickly.
export const AGENTS_STARTER = `# Working in this project

## Commands
- Run it:
- Tests:

## Rules
-

## Where things go
-
`;

// Headings the prompt is cut by (instructions-hub.mjs promptParts): a line of TOOLS.md or
// SKILLS.md that is one of them would split the prompt in the wrong place.
const RESERVED = ['This session', 'Project notes', 'Shared working instructions', 'End shared working instructions', 'Rules', 'Work habits', 'Fixing a bug', 'How you work', 'Guides', 'Tool use', 'Skills'];

const digest = (text) => createHash('sha256').update(text === null ? '\u0000missing' : text).digest('hex').slice(0, 24);
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const home = () => homedir();
const tilde = (p) => (p ? p.replace(home(), '~') : p);

// Where a file lives. null: TOOLS.md and SKILLS.md when the repo is not on this Mac.
export function filePath(which, folder) {
  if (which === 'agents') return join(folder, 'AGENTS.md');
  const dir = rulesDir();
  if (!dir) return null;
  return isRemote(which) ? join(dir, REMOTE_DIR, fileName(which)) : join(dir, PROMPT_FILES[which]);
}

function readText(path) {
  if (!path) return null;
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

// Undo: the text before each save, per file, newest last. null = the file was not there.
const historyFile = (state = instructionHome()) => join(state, 'prompt-files', 'history.json');
function readHistory(state) {
  try { const h = JSON.parse(readFileSync(historyFile(state), 'utf8')); return h && typeof h === 'object' ? h : {}; } catch { return {}; }
}
function writeHistory(h, state) {
  mkdirSync(dirname(historyFile(state)), { recursive: true });
  const tmp = `${historyFile(state)}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(h), { mode: 0o600 });
  renameSync(tmp, historyFile(state));
}

// What the page shows for one file.
export function fileInfo(which, folder, { state } = {}) {
  const path = filePath(which, folder);
  const disk = readText(path);
  const base = {
    file: which, name: FILE_NAMES[which], path, shown: tilde(path), exists: disk !== null,
    revision: digest(disk), limit: FILE_LIMITS[which], undoCount: path ? (readHistory(state)[path] ?? []).length : 0,
  };
  if (which === 'agents') {
    const claude = readText(join(folder, 'CLAUDE.md'));
    const pointer = claude !== null && /^@AGENTS\.md\s*$/.test(claude.trim());
    // How the model gets it now: this folder's file among the rules files it reads (prompt.mjs projectNotes).
    const notes = projectNotes(folder, notesRoom(), { memory: false });
    const own = notes.sources.find((s) => s.path === path);
    return { ...base, text: disk ?? '', starter: AGENTS_STARTER, home: folder === home(), folder,
      claude: claude === null ? null : { chars: claude.length, pointer, read: !disk && !pointer },
      room: notesRoom(), gets: own ? { status: own.status, left: own.left } : null,
      others: notes.sources.filter((s) => s.path !== path).map((s) => ({ name: s.name, label: s.label, chars: s.chars, status: s.status })) };
  }
  // TOOLS.md and SKILLS.md: the built-in copy stands in when there is none on disk.
  const builtIn = isRemote(which) ? BUILT_IN_REMOTE[inner(which)] ?? '' : BUILT_IN[which];
  const text = disk ?? builtIn;
  const out = { ...base, text, starter: builtIn, rulesDir: tilde(rulesDir()), fromDisk: disk !== null, set: isRemote(which) ? 'remote' : 'local' };
  if (which === 'remote:harness') return { ...out, tokens: estimate(HARNESS_PARTS.map((h) => sectionOf(text, h) ?? '').join('\n')) };
  if (isRemote(which) && !['remote:tools', 'remote:skills'].includes(which)) {
    const g = readGuides('remote', { agents: true, mcp: true }).find((x) => `remote:${x.name}` === which);
    return { ...out, guide: inner(which), about: g?.about ?? '', tokens: estimate(g?.body ?? '') };
  }
  if (inner(which) === 'tools') {
    const lines = toolUseText(text);
    return { ...out, toolUse: lines, tokens: estimate(lines), oneAtATime: /Call one tool at a time/.test(lines) };
  }
  const skills = parseSkills(text);
  const list = skillsList(skills);
  return { ...out, skills: skills.map((s) => ({ name: s.name, slug: s.slug, words: s.words, about: s.about, chars: s.body.length, tokens: estimate(skillNote(s)) })),
    problems: skillProblems(skills), listTokens: estimate(list) };
}

export function filesData(folder, opts) {
  return { folder, rulesDir: tilde(rulesDir()), files: Object.fromEntries(FILES.map((f) => [f, fileInfo(f, folder, opts)])) };
}

// The text a save may write: plain text in the limit, and for TOOLS.md and
// SKILLS.md what their readers need.
export function validateFile(which, text) {
  if (!FILES.includes(which)) throw failure('Pick AGENTS.md, TOOLS.md, SKILLS.md or one of the remote files.');
  if (typeof text !== 'string') throw failure(`${FILE_NAMES[which]} must be text.`);
  const clean = `${text.replace(/\r\n?/g, '\n').replace(/\s+$/, '')}\n`;
  if (!clean.trim()) throw failure(`${FILE_NAMES[which]} is empty. Write something first, or use Undo.`);
  if (clean.length > FILE_LIMITS[which]) throw failure(`${FILE_NAMES[which]} is ${clean.length.toLocaleString('en-US')} characters; the most is ${FILE_LIMITS[which].toLocaleString('en-US')}.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(clean)) throw failure(`${FILE_NAMES[which]} has control characters in it.`);
  if (which !== 'agents') {
    const bad = clean.split('\n').find((l) => RESERVED.includes(l.trim()));
    if (bad) throw failure(`A line of ${FILE_NAMES[which]} is "${bad.trim()}", a heading the instructions are cut by. Put a word before or after it.`);
  }
  if (inner(which) === 'tools' && !sectionOf(clean, 'Tool use')) throw failure('TOOLS.md needs its "## Tool use" section with at least one line: those lines are what the model gets.');
  if (which === 'remote:harness') {
    const missing = HARNESS_PARTS.filter((h) => !sectionOf(clean, h));
    if (missing.length) throw failure(`HARNESS.md needs its ${missing.map((h) => `"## ${h}"`).join(', ')} part${missing.length > 1 ? 's' : ''}: the remote instructions are built from them.`);
  }
  if (isRemote(which) && GUIDES.includes(inner(which)) && !/^## \S/m.test(clean)) throw failure(`${FILE_NAMES[which]} needs at least one "## " part: that is what the model reads when it opens the guide.`);
  if (inner(which) === 'skills') {
    const { errors } = skillProblems(parseSkills(clean));
    if (errors.length) throw failure(errors.join(' '));
  }
  return clean;
}

// Written beside the file, then moved over it: never half a file. A link is
// followed, so the file it points at changes and the link stays.
function writeAtomic(path, text) {
  let target = path;
  try { target = realpathSync(path); } catch {}
  mkdirSync(dirname(target), { recursive: true });
  const tmp = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  writeFileSync(tmp, text);
  try { renameSync(tmp, target); } catch (e) { try { unlinkSync(tmp); } catch {} throw e; }
}

// One save (or undo) at a time for all three files.
function locked(state, fn) {
  mkdirSync(join(state, 'prompt-files'), { recursive: true });
  const lock = join(state, 'prompt-files', 'save.lock');
  let fd;
  try { fd = openSync(lock, 'wx', 0o600); } catch (e) { if (e.code === 'EEXIST') throw failure('A prompt file is being saved elsewhere. Try again.', 409); throw e; }
  try { return fn(); } finally { closeSync(fd); try { unlinkSync(lock); } catch {} }
}

export function saveFile(which, folder, text, revision, { state = instructionHome(), undo = false } = {}) {
  if (!FILES.includes(which)) throw failure('Pick AGENTS.md, TOOLS.md, SKILLS.md or one of the remote files.');
  const path = filePath(which, folder);
  if (!path) throw failure(`${FILE_NAMES[which]} is built into this copy of Agentic Coder: the repo (terminal/rules/) is not on this Mac, so there is nowhere to save it.`, 409);
  const clean = undo ? null : validateFile(which, text);
  return locked(state, () => {
    const now = readText(path);
    if (digest(now) !== revision) throw failure(`${FILE_NAMES[which]} changed on disk since this page read it (another window, an editor or another session). Reload to see it.`, 409);
    const history = readHistory(state);
    const list = history[path] ?? [];
    if (undo) {
      const last = list.pop();
      if (!last) throw failure(`There is no earlier ${FILE_NAMES[which]} to go back to.`);
      if (last.text === null) unlinkSync(path); // the save being undone made the file
      else writeAtomic(path, last.text);
    } else {
      if (clean === now) return fileInfo(which, folder, { state });
      list.push({ at: new Date().toISOString(), text: now });
      writeAtomic(path, clean);
    }
    history[path] = list.slice(-HISTORY_KEEP);
    writeHistory(history, state);
    return fileInfo(which, folder, { state });
  });
}

// "Try a request" on the Skills tab: the skill this draft would bring, found the way the agent finds it.
export function trySkill(request, text) {
  const words = String(request ?? '').trim().slice(0, 1000);
  if (!words) throw failure('Type a request first.');
  const s = pickSkill(words, parseSkills(typeof text === 'string' ? text : readPromptFile('skills').text));
  return { request: words, skill: s ? { name: s.name, slug: s.slug, matched: s.matched, tokens: estimate(skillNote(s)) } : null };
}
