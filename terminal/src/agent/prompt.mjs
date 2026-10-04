// The system prompt: short and concrete, written for a small model.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { instructionBlock } from './instructions.mjs';
import { RULES } from './rules.mjs';
import { memoryNotes } from './facts.mjs';
import { rulesRoomFor } from './room.mjs';
import { toolUseText, toolUseFor, TOOL_USE_OLD, readSkills, skillsList, skillPath, readGuides, guidesList, guidePath, harnessOf } from './prompt-files.mjs';

// The home folder and its Desktop, Documents and Downloads: places to start
// from, not projects. Agentic Coder answers from what it knows there, and goes into a
// project when one is named (src/agent/projects.mjs).
export function isHomeFolder(cwd, home = homedir()) {
  return [home, join(home, 'Desktop'), join(home, 'Documents'), join(home, 'Downloads')].includes(cwd);
}

const HOME_NOTE = `Here: the user's home folder, not a project. Answer a general question (math, how something works) from what you know, without tools. Search, Read or List files only when the user asks about their own files, code or notes, or names a file. When the user asks you to make, change or look at a file or folder ("make a file on my Desktop"), do it straight away with the tools; Desktop, Documents and Downloads are folders here.`;

// AGENTIC_PROMPT=old: the prompt as it was before 30 Sep 2026, for the
// old/new comparison (models/evals): no Work habits, the notes files neither
// labelled nor ranked, and 6,000 characters of room for them. The local date
// is in both: the old UTC one was a bug.
export const promptVersion = () => (process.env.AGENTIC_PROMPT === 'old' ? 'old' : 'new');
// Room for the notes files: a share of the Context, never under 12,000 (room.mjs;
// /effort's Rules room moves it). The old 9,000 cut the home rules when this repo's
// AGENTS.md grew (7,892 + 1,438 characters on 30 Sep 2026); 6,000 left the home
// one out and cut the repo's mid-section. ctx: the model's context, 32k when unknown.
export const notesRoom = (ctx) => (promptVersion() === 'old' ? 6000 : rulesRoomFor(ctx ?? 32768));

// What a notes file is, as the model is told (Claude Code names each file's
// kind the same way): the folder's own rules, a folder above it, or the
// user's own rules in the home folder.
function kindOf(path, cwd, home) {
  const dir = dirname(path);
  if (dir === home) return { kind: 'home', label: "the user's own rules, for every folder under the home folder" };
  if (dir === cwd) return { kind: 'project', label: "this project's rules" };
  return { kind: 'parent', label: `rules for every folder under ${dir.replace(home, '~')}` };
}

// AGENTS.md (or CLAUDE.md) and nothing else, from the working folder up to
// the home folder, the way Claude Code reads CLAUDE.md (30 Sep 2026: the
// private .agentic/notes.md is no longer read; its lines are carried over
// into the memory the first time, facts.mjs openMemory); then what the
// memory holds (facts.mjs): the rules that always apply and one line per
// fact. memory: false leaves the memory out (practice runs, tests).
// sources: each file as the model gets it (whole, part or left out, and its
// kind), then the memory; the hub's Project context tab shows them.
export function projectNotes(cwd, maxChars = notesRoom(), { memory = true, home: homeDir } = {}) {
  const found = [];
  let dir = cwd;
  const home = homeDir ?? homedir();
  const labelled = promptVersion() !== 'old';
  for (let i = 0; i < 8; i++) {
    for (const name of ['AGENTS.md', 'CLAUDE.md']) {
      const p = join(dir, name);
      if (existsSync(p)) {
        const text = readFileSync(p, 'utf8').trim();
        // A CLAUDE.md that only points at AGENTS.md adds nothing.
        if (text && !/^@AGENTS\.md\s*$/.test(text) && !found.some((f) => f.text === text)) found.push({ path: p, text });
        break;
      }
    }
    if (dir === home || dir === dirname(dir)) break;
    dir = dirname(dir);
  }
  const sources = found.map((f) => ({ path: f.path, name: f.path.replace(home, '~'), ...kindOf(f.path, cwd, home), chars: f.text.length, status: 'left', left: [], text: '' }));
  let out = '';
  for (let i = 0; i < found.length; i++) {
    const f = found[i];
    const s = sources[i];
    const name = s.name;
    const block = `From ${name}${labelled ? ` (${s.label})` : ''}:\n${f.text}\n\n`;
    if (out.length + block.length <= maxChars) { out += block; Object.assign(s, { status: 'whole', text: f.text }); continue; }
    // Too long for what is left: whole sections, never half a sentence, and
    // the model is told which headings (and which files) it does not have.
    const rest = sources.slice(i + 1).map((g) => g.name);
    const restNote = (names) => (names.length ? `(Left out to fit: ${names.join(', ')}.)\n` : '');
    // Room for the heading line below (the file's name, its kind and up to three left-out headings) and the note.
    const part = fitSections(f.text, maxChars - out.length - name.length - (labelled ? s.label.length + 3 : 0) - 250 - restNote(rest).length);
    if (part.text) {
      out += `From ${name} (${labelled ? `${s.label}; ` : ''}part of it, to fit${part.left.length ? `; left out: ${namesOf(part.left)}` : ''}):\n${part.text}\n\n`;
      Object.assign(s, { status: 'part', left: part.left, text: part.text });
    } else rest.unshift(name);
    out += restNote(rest);
    break;
  }
  const files = found.map((f) => f.path);
  if (memory) {
    let m = null;
    try { m = memoryNotes(cwd, { home }); } catch { /* a memory that cannot be read is left out, the start goes on */ }
    if (m?.text) {
      out = `${out.trim()}${out.trim() ? '\n\n' : ''}Memory\n${m.text}`;
      files.push(...m.files);
      sources.push({ path: m.files.join(' · '), name: 'Memory', kind: 'memory', label: 'what Agentic Coder saved about the user and this project', chars: m.text.length, status: 'whole', left: [], text: m.text, facts: m.facts });
    }
  }
  return { text: out.trim(), files, sources };
}

// The sections of a notes file (a heading and what follows it, up to the
// next heading; a "#" line inside a ``` block is code, not a heading) that
// fit in room, in order. When even the first does not fit, its paragraphs,
// then its lines. left: the headings that did not fit.
export function fitSections(text, room) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let fence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const starts = !fence && /^#{1,6}\s/.test(line);
    if (!sections.length || (starts && sections.at(-1).length)) sections.push([]);
    sections.at(-1).push(line);
  }
  const heading = (s) => (/^#{1,6}\s/.test(s[0] ?? '') ? s[0].replace(/^#+\s*/, '').trim() : null);
  const kept = [];
  let used = 0;
  let i = 0;
  for (; i < sections.length; i++) {
    const t = sections[i].join('\n').trim();
    if (used + t.length + 2 > room) break;
    kept.push(t);
    used += t.length + 2;
  }
  if (!kept.length && sections.length && room > 0) {
    // The first section alone is too long: its whole paragraphs, else its whole lines.
    const first = sections[0].join('\n').trim();
    for (const [units, sep] of [[first.split(/\n\s*\n/), '\n\n'], [first.split('\n'), '\n']]) {
      let t = '';
      for (const u of units) { const next = t ? `${t}${sep}${u}` : u; if (next.length > room) break; t = next; }
      // A heading with nothing under it tells the model nothing: then the file is named as left out instead.
      if (t.split('\n').some((l) => l.trim() && !/^#{1,6}\s/.test(l))) { kept.push(t.trim()); break; }
    }
    if (kept.length) i = 1;
  }
  return { text: kept.join('\n\n'), left: sections.slice(i).map(heading).filter(Boolean) };
}
const namesOf = (left) => `${left.slice(0, 3).map((h) => `"${h.slice(0, 60)}"`).join(', ')}${left.length > 3 ? ` and ${left.length - 3} more` : ''}`;

export function gitSummary(cwd) {
  const r = spawnSync('git', ['status', '--porcelain', '-b'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) return 'not a git repository';
  const lines = r.stdout.split('\n').filter(Boolean);
  const branch = (lines[0] ?? '').replace(/^## /, '').split('...')[0];
  const changed = lines.length - 1;
  return `branch ${branch}, ${changed ? `${changed} changed file${changed === 1 ? '' : 's'}` : 'no uncommitted changes'}`;
}

// How this project runs its tests, so the model does not invent a check.
export function testCommand(cwd) {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    const t = pkg.scripts?.test;
    if (t && !/no test specified/.test(t)) return existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock')) ? 'bun run test' : 'npm test';
  } catch {}
  const r = spawnSync('/bin/sh', ['-c', 'ls *.test.* *_test.* test_*.py tests test 2>/dev/null | head -20'], { cwd, encoding: 'utf8' });
  const out = r.stdout ?? '';
  if (/\.test\.(m?js|cjs)\b/.test(out)) return 'node --test';
  if (/\.test\.tsx?\b/.test(out)) return 'bun test';
  if (/test_\w+\.py|_test\.py/.test(out) || existsSync(join(cwd, 'pytest.ini')) || existsSync(join(cwd, 'pyproject.toml'))) return 'pytest';
  if (existsSync(join(cwd, 'Cargo.toml'))) return 'cargo test';
  if (existsSync(join(cwd, 'go.mod'))) return 'go test ./...';
  return null;
}

// A worked example of the loop, for small models (on when measured to help).
const EXAMPLE = `Example of good work (the names here are made up)
User: rename getUser to fetchUser
You: Search {"pattern": "getUser"}  → 2 files use it
You: Read {"path": "<first file>"}
You: Edit {"path": "<first file>", "old_text": "getUser", "new_text": "fetchUser", "replace_all": true}
You: Edit {"path": "<second file>", "old_text": "getUser", "new_text": "fetchUser", "replace_all": true}
You: Bash {"command": "<the test command>"}  → all pass
You: Renamed getUser to fetchUser in both files; the tests pass.
`;

// Where this session's details start. Everything before it is the same in
// every project and on every day, so the server can save the model's reading
// of it to disk and restore it in a fraction of a second (models/runtime/warmup.mjs).
export const SESSION_MARK = 'This session\n';

// How Claude Code has Opus and Fable work, where the General list does not
// already say it, in words a 9–12B model follows. Built in and before
// SESSION_MARK, so it is saved with the warm-up; the focused calls do not get it.
export const WORK_HABITS = `Work habits
- Once you know enough to act, act. Do not read a file again or ask again about what is already settled.
- When there are several ways, pick the best one and say why in one line; do not list them all.
- Read a file before you overwrite it. Before anything hard to undo, use Ask first.
- Report what really happened: a failed check is "failed", with the line that failed; name any step you skipped. When it is done and checked, say so plainly.
- Say you found, read, checked or worked out something only when a tool's result showed it to you: an outline shows a file's parts, not what is in them, and an expected value is worked out with a command, never in your head.
- If what was asked is blocked (a page needs a login, a file or address you were given is not there), stop and Ask the user how to go on. Never do a different task in its place.
- Talk to the user in everyday words: what you did or found and what it means for them, first. Name a file at the end, when they will want to open it ("It is on your Desktop: invoice.html"). No commands, code names or error codes unless they ask for the details.
- Questions for the user go through the Ask tool, never as a list in your reply: one Ask, with the other questions in more. Give each choice an about line with one example, and put the one you recommend first.
- Look at files with Read, Search and List, not cat, grep or ls in Bash.
- If the user says no to a tool call, do not send it again: ask, or try another way.
- When memory fills, the app keeps notes and you keep going. Do not rush to finish.
- A remembered fact can be out of date: check that a file or name still exists before you rely on it.`;

// Which notes win, said once above them (Claude Code says its CLAUDE.md files
// override its defaults). The app's blocks hold whatever the notes say.
export const NOTES_RANK = "These are the user's and this project's own rules. When they disagree with the working instructions above, they win, except the Rules the app enforces (blocked folders and commands). The user's words in this conversation win over both.";

// The user's calendar day, not UTC's: after 8 pm in New York the UTC date is already tomorrow.
export const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const STAY_OLD = '- Stay inside the project folder. Files and commands outside it (the home folder, the Desktop, other projects) are blocked; a vague request such as "fix the bug" means this folder only.';
// The first rule, with where the Desktop is from here. From the home folder
// it used to say the Desktop was blocked while the note at the end said it
// was a folder here, and Qwen saved "download it to my desktop" as
// ~/media-player-card.html, then said it was on the Desktop (30 Sep 2026).
export function stayRule(cwd, home = homedir()) {
  const vague = 'a vague request such as "fix the bug" means this folder only.';
  if (cwd === join(home, 'Desktop')) return `- Stay inside this folder. It is the Desktop, so a file the user wants "on my desktop" goes right here. Other folders are blocked; ${vague}`;
  if (cwd === home) return `- Stay inside this folder. It is the home folder, so the Desktop is the folder Desktop here: a file the user wants "on my desktop" goes in it (Write Desktop/<name>), not here. Other places are blocked; ${vague}`;
  // A file for the Desktop goes there (desktopOpen in agent.mjs): written as ~/Desktop/<name>, so no
  // home folder's name is guessed (3 Oct 2026: Qwen wrote to another Mac's /Users/<name>/Desktop).
  return `- Stay inside the project folder. Files and commands outside it (the home folder, the Desktop, other projects) are blocked; ${vague} One exception: a new file the user wants "on my desktop" is written straight there with Write ~/Desktop/<name> (commands cannot reach it), and you say where it is.`;
}

// This session's part: the same on both sets.
function sessionPart({ cwd, notes, git, today, tests, now }) {
  return `${SESSION_MARK}Today: ${today}. macOS, zsh. Git: ${git}.${tests ? `\nRun the tests with: ${tests}` : ''}${isHomeFolder(cwd) ? `\n${HOME_NOTE}` : ''}
${notes ? `\nProject notes\n${now ? `${NOTES_RANK}\n\n` : ''}${notes}\n` : ''}`;
}

// The instructions for a model on another machine (prompt-files.mjs, the remote set):
// HARNESS.md's opening, how it works and its rules in place of the built-in ones, the remote
// TOOLS.md, then the guides and skills it opens by name. The hub's shared working instructions,
// the stay rule and this session's part are the same as on this Mac. agents: the Agent tool is
// offered, so the helpers guide is listed. mcp: a tool of an MCP server is offered (true, or the
// servers' list: agent/mcp.mjs mcpBrief), so the MCP guide is listed and TOOLS.md's MCP lines, with
// the list, join the Tool use ones.
function remotePrompt({ cwd, notes, git, today, tests, example, math, instructions, toolUse, skills, agents, mcp, web = false }) {
  const h = harnessOf();
  const guides = guidesList(readGuides('remote', { agents, mcp: Boolean(mcp) }), { path: guidePath(cwd), intro: h.guides });
  const list = skillsList(skills ?? readSkills(undefined, 'remote'), { path: skillPath(cwd) });
  return `${h.who}

${instructionBlock(instructions)}

Tool use
${toolUse ?? toolUseFor('remote', undefined, { mcp, web })}

How you work
${h.how}

${guides ? `${guides}\n\n` : ''}${list ? `${list}\n\n` : ''}${example ? `${EXAMPLE}\n` : ''}Rules
${stayRule(cwd)}
${h.rules}

${math ? `${math}\n\n` : ''}${sessionPart({ cwd, notes, git, today, tests, now: true })}`;
}

// Which set a prompt was built with: the remote one has its own "How you work" part.
const REMOTE_PART = '\nHow you work\n';
export const promptSetOf = (system) => (typeof system === 'string' && system.includes(REMOTE_PART) ? 'remote' : 'local');

// toolUse and skills: terminal/rules/TOOLS.md and SKILLS.md as they are now
// (prompt-files.mjs); the old prompt keeps the Tool use lines it had and no skills.
// set 'remote': the remote set's instructions (remotePrompt); AGENTIC_PROMPT=old keeps the old local one.
export function systemPrompt({ cwd, notes = '', git = 'unknown', date = new Date(), tests = testCommand(cwd), example = process.env.AGENTIC_EXAMPLE === '1', math = '', instructions, toolUse, skills, set = 'local', agents = false, mcp = false, web = false }) {
  const today = localDay(date);
  const now = promptVersion() !== 'old';
  if (set === 'remote' && now) return remotePrompt({ cwd, notes, git, today, tests, example, math, instructions, toolUse, skills, agents, mcp, web });
  const tooling = toolUse ?? (now ? toolUseFor('local', undefined, { mcp }) : TOOL_USE_OLD);
  const list = now ? skillsList(skills ?? readSkills(), { path: skillPath(cwd) }) : '';
  return `You are Agentic Coder, a coding assistant in the user's terminal on their Mac. You work inside one project folder and use tools to read, search, change and test code. You can see the files only through your tools.

You are inside the project's folder. Use paths relative to it, and "." for the folder itself. Never type a full path.

${instructionBlock(instructions)}

Tool use
${tooling}

${list ? `${list}\n\n` : ''}${now ? `${WORK_HABITS}\n\n` : ''}${example ? `${EXAMPLE}\n` : ''}${RULES.always ? `Fixing a bug\n${RULES.always}\n\n` : ''}Rules
${now ? stayRule(cwd) : STAY_OLD}
- These commands are blocked: rm -rf, sudo, git push, git reset --hard, kill, pkill, killall.
- If the user only asks a question, answer it from the code you read; do not change files or build scratch experiments to find out.

${math ? `${math}\n\n` : ''}${sessionPart({ cwd, notes, git, today, tests, now })}`;
}
