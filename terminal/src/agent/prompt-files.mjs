// The prompt files in terminal/rules/ (30 Sep 2026, the hub's Instructions →
// Prompt files): TOOLS.md is the "Tool use" part of the instructions, and
// SKILLS.md holds steps for kinds of task, each brought by its words.
// Read from disk at each use, so a save in the hub applies on the next
// message; the copy built into the app is used when the repo is not here.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { HOME } from '../../../models/index.mjs';
import { ownWords } from '../flows/words.mjs';
import { libraryDir, savedSkillFiles, skillsDir } from './skill-store.mjs';
import { modeOf } from './permissions.mjs';
import { activePlugins } from './plugins.mjs';

export const PROMPT_FILES = Object.freeze({ tools: 'TOOLS.md', skills: 'SKILLS.md' });

// The Tool use lines before TOOLS.md, word for word: AGENTIC_PROMPT=old keeps
// them, and they stand in when neither the file nor the built-in copy has them.
export const TOOL_USE_OLD = `- Use List, Search and Read to find the code; try a shorter search if needed.
- To change an existing file, use Edit with old_text copied exactly from Read, without line numbers. Include enough context to match once. Use Write for new files.
- Call one tool at a time and wait for its result.`;

async function load(which) {
  try {
    if (typeof Bun !== 'undefined') {
      // Literal paths, so the one-file app carries both files inside it.
      const text = (which === 'tools'
        ? await import('../../rules/TOOLS.md', { with: { type: 'text' } })
        : await import('../../rules/SKILLS.md', { with: { type: 'text' } })).default;
      // Inside the one-file app the import gives the embedded file's path.
      return text.startsWith('/$bunfs/') ? readFileSync(text, 'utf8') : text;
    }
    return readFileSync(new URL(`../../rules/${PROMPT_FILES[which]}`, import.meta.url), 'utf8');
  } catch {
    return '';
  }
}
export const BUILT_IN = Object.freeze({ tools: await load('tools'), skills: await load('skills') });

// The remote set (2 Oct 2026): terminal/rules/remote/ holds the instructions for a model on
// another machine (/remote), which can take more than the 9B on this Mac. HARNESS.md is its
// opening, how it works and the rules (in place of the built-in ones), TOOLS.md its Tool use
// lines, SKILLS.md its skills, and fourteen guides it is shown by name and opens with Read at
// RULES/<NAME>.md when one fits. A file missing from that folder: the local one of the same
// name (TOOLS, SKILLS), the copy built into the app (HARNESS), or left out (a guide).
// Which set: settings.json "instructions" (auto, local or remote; the hub's Instructions → 09 saves
// it; auto, the default, is remote for a /remote model), read before each message;
// AGENTIC_INSTRUCTIONS wins over it (the practice runs' --instructions). Not an /effort row: that
// panel is as tall as an 80×24 window allows.
export const RULE_SETS = ['auto', 'local', 'remote'];
export const REMOTE_DIR = 'remote';
// Listed in this order, roughly as a task goes: plan, look, change, check, recover, report.
export const GUIDES = Object.freeze(['PLANNING', 'CONTEXT', 'PERMISSIONS', 'TESTING', 'REVIEW', 'DEBUGGING', 'BUG-FIXING', 'RECOVERY', 'DESIGN', 'SECURITY', 'SUBAGENTS', 'MCP', 'MEMORY', 'GIT', 'ANSWERS']);
// Listed only when the Agent tool is offered (agent.mjs agentsOn).
const AGENTS_GUIDE = 'SUBAGENTS';
// Listed only while a tool of an MCP server is offered (agent.mjs mcpOn).
export const MCP_GUIDE = 'MCP';
export const instructionsEnv = (env = process.env) => env.AGENTIC_INSTRUCTIONS;
// The saved choice (settings.json "instructions", the file the app's settings live in), 'auto'
// when there is none or it cannot be read.
export function savedInstructions(home = HOME) {
  try { const v = JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')).instructions; return RULE_SETS.includes(v) ? v : 'auto'; } catch { return 'auto'; }
}
// Auto: a model on a service gets the remote set, unless it is one of the small ones that get the local
// set (models/runtime/remote.mjs OWN_REMOTES: Bonsai 2 9B, 27 Oct 2026).
export function rulesSetOf(choice, model, env = process.env) {
  const c = instructionsEnv(env) ?? choice ?? savedInstructions();
  if (c === 'local' || c === 'remote') return c;
  return model?.remote && model.rules !== 'local' ? 'remote' : 'local';
}
const fileOf = (which) => PROMPT_FILES[which] ?? (which === 'harness' ? 'HARNESS.md' : `${which}.md`);
async function loadRemote() {
  const text = async (m) => { const t = (await m).default; return t.startsWith('/$bunfs/') ? readFileSync(t, 'utf8') : t; };
  try {
    if (typeof Bun !== 'undefined') {
      // Literal paths, so the one-file app carries all eighteen inside it (in GUIDES' order after the first three).
      const all = await Promise.all([
        text(import('../../rules/remote/HARNESS.md', { with: { type: 'text' } })),
        text(import('../../rules/remote/TOOLS.md', { with: { type: 'text' } })),
        text(import('../../rules/remote/SKILLS.md', { with: { type: 'text' } })),
        text(import('../../rules/remote/PLANNING.md', { with: { type: 'text' } })),
        text(import('../../rules/remote/CONTEXT.md', { with: { type: 'text' } })),
        text(import('../../rules/remote/PERMISSIONS.md', { with: { type: 'text' } })),
        text(import('../../rules/remote/TESTING.md', { with: { type: 'text' } })),
        text(import('../../rules/remote/REVIEW.md', { with: { type: 'text' } })),
        text(import('../../rules/remote/DEBUGGING.md', { with: { type: 'text' } })),
        text(import('../../rules/remote/BUG-FIXING.md', { with: { type: 'text' } })),
        text(import('../../rules/remote/RECOVERY.md', { with: { type: 'text' } })),
        text(import('../../rules/remote/DESIGN.md', { with: { type: 'text' } })),
        text(import('../../rules/remote/SECURITY.md', { with: { type: 'text' } })),
        text(import('../../rules/remote/SUBAGENTS.md', { with: { type: 'text' } })),
        text(import('../../rules/remote/MCP.md', { with: { type: 'text' } })),
        text(import('../../rules/remote/MEMORY.md', { with: { type: 'text' } })),
        text(import('../../rules/remote/GIT.md', { with: { type: 'text' } })),
        text(import('../../rules/remote/ANSWERS.md', { with: { type: 'text' } })),
      ]);
      return Object.fromEntries(['harness', 'tools', 'skills', ...GUIDES].map((w, i) => [w, all[i]]));
    }
    return Object.fromEntries(['harness', 'tools', 'skills', ...GUIDES].map((w) => {
      try { return [w, readFileSync(new URL(`../../rules/${REMOTE_DIR}/${fileOf(w)}`, import.meta.url), 'utf8')]; } catch { return [w, '']; }
    }));
  } catch {
    return {};
  }
}
export const BUILT_IN_REMOTE = Object.freeze(await loadRemote());

// Where the files are kept on this Mac: the terminal/rules of the copy of GitHub's main the app was
// built from (main, always, 18 Oct 2026: the launcher passes AGENTIC_BUILD), else the repo's (the
// launcher passes AGENTIC_REPO; run from the source, the folder beside this one); AGENTIC_RULES_DIR for
// tests. null: the built-in copies only. edit: where the hub saves them, the folder's own (a change
// reaches the app once it is pushed to main), never that copy, which the next update replaces.
export function rulesDir({ edit = false } = {}) {
  if (process.env.AGENTIC_RULES_DIR) return process.env.AGENTIC_RULES_DIR;
  for (const repo of edit ? [process.env.AGENTIC_REPO] : [process.env.AGENTIC_BUILD, process.env.AGENTIC_REPO]) {
    if (repo && existsSync(join(repo, 'terminal', 'rules', 'bug-fixing.md'))) return join(repo, 'terminal', 'rules');
  }
  try {
    const here = fileURLToPath(new URL('../../rules', import.meta.url));
    if (existsSync(join(here, 'bug-fixing.md'))) return here;
  } catch {}
  return null;
}

// A file as it is now: from the disk when it is there, else the built-in copy.
// set 'remote': terminal/rules/remote/ first. Missing there while the folder is on this Mac:
// TOOLS and SKILLS fall back to the local file, HARNESS to its built-in copy, and a guide is
// left out (from 'none', text ''), so deleting a remote file never breaks a conversation.
// With no folder at all (the app without its repo), the built-in remote copies.
export function readPromptFile(which, dir = rulesDir(), set = 'local') {
  if (set === 'remote') {
    const path = dir ? join(dir, REMOTE_DIR, fileOf(which)) : null;
    if (path) {
      try { return { text: readFileSync(path, 'utf8'), path, from: 'disk', set: 'remote' }; } catch {}
      if (PROMPT_FILES[which]) return { ...readPromptFile(which, dir), set: 'local' };
      if (which !== 'harness') return { text: '', path, from: 'none', set: 'remote' };
    }
    if (BUILT_IN_REMOTE[which]) return { text: BUILT_IN_REMOTE[which], path, from: 'built-in', set: 'remote' };
    return PROMPT_FILES[which] ? { ...readPromptFile(which, null), set: 'local' } : { text: '', path, from: 'none', set: 'remote' };
  }
  const path = dir ? join(dir, PROMPT_FILES[which]) : null;
  if (path) {
    try { return { text: readFileSync(path, 'utf8'), path, from: 'disk' }; } catch {}
  }
  return { text: BUILT_IN[which], path, from: 'built-in' };
}

// The text under a "## Heading" (null when there is none).
export function sectionOf(text, heading) {
  for (const part of String(text ?? '').split(/^## /m).slice(1)) {
    const nl = part.indexOf('\n');
    if ((nl < 0 ? part : part.slice(0, nl)).trim().toLowerCase() === heading.toLowerCase()) return nl < 0 ? '' : part.slice(nl + 1).trim();
  }
  return null;
}

// The Tool use lines: TOOLS.md's "## Tool use" section.
export function toolUseText(text = readPromptFile('tools').text) {
  return sectionOf(text, 'Tool use') || sectionOf(BUILT_IN.tools, 'Tool use') || TOOL_USE_OLD;
}
// The Tool use lines of a set (the remote TOOLS.md, or the local one standing in for it).
// mcp: a tool of an MCP server is offered, so the file's "## MCP tools" lines go with them, and
// when it is the servers' list (agent/mcp.mjs mcpBrief), that list after them.
// web: WebFetch is offered (/web), so the file's "## Web tools" lines go with them (4 Oct 2026: Qwen3.6,
// holding WebFetch, thought "my tools don't include that" and ran curl into the sandbox four times).
export const toolUseFor = (set = 'local', dir = rulesDir(), { mcp = false, web = false } = {}) => {
  const text = readPromptFile('tools', dir, set).text;
  const lines = toolUseText(text);
  const pages = web ? sectionOf(text, 'Web tools') || '' : '';
  const more = mcp ? sectionOf(text, 'MCP tools') || sectionOf(set === 'remote' ? BUILT_IN_REMOTE.tools ?? '' : BUILT_IN.tools, 'MCP tools') || '' : '';
  const brief = typeof mcp === 'string' ? mcp : '';
  return [lines, pages, more, brief].filter(Boolean).join('\n');
};

export const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';

// A skill's fence is what the loop enforces. The steps stay in the prompt; a
// sentence there is all a small model has, and on a 9B model that sentence loses.
//   read     Edit and Write are refused
//   check    one command must run before the turn may end as done
//   scratch  a failed check puts the message's edits back (the free loop does this either way)
const FENCES = ['read', 'check', 'scratch'];

// SKILLS.md: each "## Name" is a skill with its "- Words:" and "- About:"
// lines, an optional "- Fence:" line, and the rest of its section as its steps.
// <!-- … --> is left out. The fence line is not a step.
export function parseSkills(text) {
  const skills = [];
  for (const part of String(text ?? '').replace(/<!--[\s\S]*?-->/g, '').split(/^## /m).slice(1)) {
    const [head, ...lines] = part.split('\n');
    const name = head.trim();
    if (!name) continue;
    const field = (key) => lines.find((l) => l.toLowerCase().startsWith(`- ${key}:`))?.slice(key.length + 3).trim() ?? '';
    const named = field('fence').toLowerCase().split(/[\s,]+/).filter(Boolean);
    skills.push({
      name,
      slug: slugOf(name),
      words: field('words').toLowerCase().split(',').map((w) => w.trim()).filter(Boolean),
      about: field('about'),
      fence: named.filter((w) => FENCES.includes(w)),
      fenceBad: named.filter((w) => !FENCES.includes(w)),
      body: lines.filter((l) => !/^- (words|about|fence):/i.test(l)).join('\n').trim(),
    });
  }
  return skills;
}

// ---- saved skills (skill-store.mjs) ------------------------------------------------------------

// A saved skill's file as SKILLS.md writes a skill, from what a Write to SKILLS/<name> sent: its
// "## Name" (a "# Name" title is one too, and so is a front matter's name, description and words, as
// Claude's and Hermes' SKILL.md files have them); with none, the name is the path's.
const nameOfSlug = (slug) => slug.replace(/-+/g, ' ').replace(/^./, (c) => c.toUpperCase());
export function savedSkillText(slug, content) {
  let t = String(content ?? '').replace(/\r\n/g, '\n').trim();
  let name = '';
  const more = [];
  const front = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(t);
  if (front) {
    const key = (k) => new RegExp(`^${k}:[ \\t]*(.+)$`, 'mi').exec(front[1])?.[1].trim().replace(/^["']|["']$/g, '') ?? '';
    name = key('name');
    const words = key('words') || key('triggers');
    const about = key('description');
    t = t.slice(front[0].length).trim();
    if (words && !/^- words:/im.test(t)) more.push(`- Words: ${words}`);
    if (about && !/^- about:/im.test(t)) more.push(`- About: ${about}`);
  }
  const title = /^#{1,2} +(.+)(?:\n|$)/.exec(t);
  if (title) { name = title[1].trim(); t = t.slice(title[0].length).trim(); }
  if (!name || /^[a-z0-9-]+$/.test(name)) name = nameOfSlug(slugOf(name || slug));
  return `${[`## ${name}`, ...more, t].filter(Boolean).join('\n')}\n`;
}

// Your saved skills, each opened by its file's name (SKILLS/<name>); a file with no steps is left out.
export function savedSkills(dir = skillsDir()) {
  return savedSkillFiles(dir).flatMap(({ slug, file, text }) => {
    const s = parseSkills(/^## /m.test(text) ? text : savedSkillText(slug, text))[0];
    return s?.body ? [{ ...s, slug, from: 'saved', file }] : [];
  });
}

// A library file is one skill whatever its text holds (a SKILL.md brought in whole has "## " headings of its own, and
// parseSkills would end the skill at the first): its first "## Name" line, the "- Words:", "- About:" and "- Fence:"
// lines right under it, and everything after them as its steps, as written.
export function parseWholeSkill(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const at = lines.findIndex((l) => /^## +\S/.test(l));
  if (at < 0) return null;
  let i = at + 1;
  const head = [];
  while (i < lines.length && /^- (words|about|fence):/i.test(lines[i])) head.push(lines[i++]);
  const field = (key) => head.find((l) => l.toLowerCase().startsWith(`- ${key}:`))?.slice(key.length + 3).trim() ?? '';
  const name = lines[at].replace(/^## +/, '').trim();
  const named = field('fence').toLowerCase().split(/[\s,]+/).filter(Boolean);
  return { name, slug: slugOf(name), words: field('words').toLowerCase().split(',').map((w) => w.trim()).filter(Boolean), about: field('about'), fence: named.filter((w) => FENCES.includes(w)), fenceBad: named.filter((w) => !FENCES.includes(w)), body: lines.slice(i).join('\n').trim() };
}
// The library's skills (skill-store.mjs libraryDir): each kept by its file's time and size, since a Read asks for the
// skills at every call and the library is megabytes of text.
const shelfKept = new Map();
export function librarySkills(dir = libraryDir()) {
  let names;
  try { names = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of names) {
    if (!e.isFile() || !/\.md$/i.test(e.name)) continue;
    const slug = e.name.slice(0, -3).toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || out.some((x) => x.slug === slug)) continue;
    const file = join(dir, e.name);
    try {
      const st = statSync(file);
      const key = `${st.mtimeMs}:${st.size}`;
      let kept = shelfKept.get(file);
      if (kept?.key !== key) { const parsed = parseWholeSkill(readFileSync(file, 'utf8')); kept = { key, skill: parsed?.body ? { ...parsed, slug, from: 'library', shelf: true, file } : null }; shelfKept.set(file, kept); }
      if (kept.skill) out.push(kept.skill);
    } catch {}
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

// The app's own skill, for saving one: brought by its words, never listed (so a prompt with no skills
// stays as it was), and never a fence: it writes.
export const SAVE_SKILL = Object.freeze({
  name: 'Save a skill',
  slug: 'save-a-skill',
  words: ['as a skill', 'save a skill', 'save the skill', 'save that skill', 'save this skill', 'make a skill', 'write a skill', 'create a skill', 'update the skill', 'change the skill', 'edit the skill', 'saved skill', 'saved skills', 'a skill for', 'skill for next time', 'remember how to do'],
  about: 'keep steps that worked for a kind of task as a skill, for next time, in every project',
  fence: [],
  fenceBad: [],
  from: 'built-in',
  hidden: true,
  body: `Only when the user asks to keep steps for Agentic Coder as a skill, or to change one they saved. A skill in their project's own code is ordinary work: leave these steps.
1. Pick a short name for the kind of task, and the words or phrases a request for it would use.
2. Write SKILLS/<name> (Rules/SKILLS/<name> when the project has a SKILLS folder of its own). It is kept outside the project, for every project. Its content:
## <Name>
- Words: <phrases a request for it uses, split by commas>
- About: <one line on what it is for>
then the steps, numbered, one line each, as they worked in this conversation (the real commands, files and checks).
3. To change a saved skill, Read SKILLS/<name>, then Edit it. One from SKILLS.md cannot be changed: save yours under another name.
4. Answer with its name, its Words, and that it now comes with any request that uses them.`,
});

// Every skill: SKILLS.md's, then your saved ones (one with a name SKILLS.md has is left out), then the
// app's own. saved: the folder of yours (skill-store.mjs), null for none.
// plugins: the ones switched on (plugins.mjs); each skill/<name>/SKILL.md of theirs comes after yours, read-only.
// library: the folder of skills brought in by the folder (librarySkills), after all of those and only on the remote
// set: its skills are thousands of tokens each, more than a small model on this Mac has room for. null for none.
export function readSkills(dir = rulesDir(), set = 'local', { saved = skillsDir(), plugins = activePlugins(), library = saved && set === 'remote' ? libraryDir(saved) : null } = {}) {
  const shipped = parseSkills(readPromptFile('skills', dir, set).text);
  const taken = new Set(shipped.map((s) => s.slug));
  const mine = saved ? savedSkills(saved).filter((s) => !taken.has(s.slug)) : [];
  for (const s of mine) taken.add(s.slug);
  const theirs = pluginSkills(plugins).filter((s) => !taken.has(s.slug) && taken.add(s.slug));
  const shelf = library ? librarySkills(library).filter((s) => !taken.has(s.slug) && taken.add(s.slug)) : [];
  return [...shipped, ...mine, ...theirs, ...shelf, ...(taken.has(SAVE_SKILL.slug) ? [] : [SAVE_SKILL])];
}
// A plugin's skills, as a saved skill's file is read (a SKILL.md's front matter gives its name and About).
function pluginSkills(plugins = activePlugins()) {
  return (plugins ?? []).flatMap((p) => p.parts.skills.flatMap(({ slug, file, text }) => {
    const s = parseSkills(savedSkillText(slug, text))[0];
    return s?.body ? [{ ...s, slug, from: 'plugin', plugin: p.name, file }] : [];
  }));
}
const listed = (skills) => skills.filter((s) => !s.hidden);
// Where a skill comes from, in the words the screen and the model see.
export const skillWhere = (s) => (s?.from === 'saved' ? 'your saved skills' : s?.from === 'library' ? 'your skill library' : s?.from === 'built-in' ? 'Agentic Coder' : s?.from === 'plugin' ? `the ${s.plugin} plugin` : 'SKILLS.md');

// A long skill comes in parts (25 Nov 2026: a library skill's steps run to 200,000 characters, more than a request or a
// Read may carry): the lines from `offset` (1 is its first) that fit SKILL_PART, and where the next part starts. A
// skill under that size comes whole, as before.
export const SKILL_PART = 12000;
export function skillPart(body, { offset = 1, limit = Infinity, room = SKILL_PART } = {}) {
  const lines = String(body ?? '').split('\n');
  const from = Math.min(Math.max(1, Math.floor(Number(offset)) || 1), Math.max(1, lines.length));
  const most = Number(limit) > 0 ? Math.floor(Number(limit)) : Infinity;
  let n = 0;
  let chars = 0;
  while (from - 1 + n < lines.length && n < most) {
    const len = lines[from - 1 + n].length + 1;
    if (n && chars + len > room) break;
    chars += len;
    n++;
  }
  const text = lines.slice(from - 1, from - 1 + n).join('\n');
  return { text: text.length > room ? `${text.slice(0, room)}…` : text, from, to: from - 1 + n, total: lines.length, next: from + n <= lines.length ? from + n : null, whole: from === 1 && from + n > lines.length && text.length <= room };
}

// What stops a save (errors) and what is only worth saying (warnings).
export function skillProblems(skills) {
  const errors = [];
  const warnings = [];
  const seen = new Map();
  for (const s of skills) {
    if (seen.has(s.slug)) errors.push(`"${s.name}" and "${seen.get(s.slug)}" both open as SKILLS/${s.slug}: give one another name.`);
    seen.set(s.slug, s.name);
    if (!s.body) errors.push(`"${s.name}" has no steps under it.`);
    if (s.fenceBad?.length) errors.push(`"${s.name}" has a Fence it does not know (${s.fenceBad.join(', ')}): use read, check or scratch.`);
    if (!s.words.length) warnings.push(`"${s.name}" has no Words line, so no request brings it: the model can still open it from the list.`);
    if (!s.about) warnings.push(`"${s.name}" has no About line: the list shows only its name.`);
  }
  return { errors, warnings };
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The skill whose Words the request uses most (a phrase counts twice), as the
// bug kinds are sorted (rules.mjs sortBug); null when none. A clarifying
// question joined to the request is not the user's words, so it is left out.
export function pickSkill(text, skills = readSkills()) {
  const t = ownWords(text).replace(/the question "[^"]*"/g, '').toLowerCase().replace(/[‘’]/g, "'");
  let best = null;
  for (const s of skills) {
    const matched = s.words.filter((w) => new RegExp(`(^|[^a-z0-9])${escape(w)}(?=$|[^a-z0-9])`).test(t));
    const score = matched.reduce((n, w) => n + (w.includes(' ') ? 2 : 1), 0);
    if (score > (best?.score ?? 0)) best = { ...s, score, matched };
  }
  return best;
}

// A skill's steps as they go with a request; of a long one its first part, with where the rest is.
export const skillNote = (s, { path = 'SKILLS' } = {}) => {
  const p = skillPart(s.body);
  return `Skill "${s.name}" from ${skillWhere(s)}: this request uses its words, so follow its steps:\n${p.whole ? s.body : `${p.text}\n(That was lines 1 to ${p.to} of ${p.total}. Read ${path}/${s.slug} with offset ${p.next ?? p.to + 1} for the rest, before you reach a step you have not seen.)`}`;
};

// The path that opens a skill. SKILLS/<name> when the project has no folder of
// that name; Rules/SKILLS/<name> when it does, so the read cannot land in the
// project's own folder (readSkillPath used to return null, and Read hit the project).
export function skillPath(cwd) {
  try { if (cwd && existsSync(join(cwd, 'SKILLS'))) return 'Rules/SKILLS'; } catch {}
  return 'SKILLS';
}

// The list in the instructions: every skill by the path that opens it. The library's are counted, not listed (95 of
// them were about 12k tokens at the top of every conversation): full, as Read gives the list, names them all, each
// with a short About, and find keeps the ones that say a word.
const short = (t, n = 110) => { const one = String(t ?? '').replace(/\s+/g, ' ').trim(); return one.length > n ? `${one.slice(0, n - 1)}…` : one; };
export function skillsList(all, { path = 'SKILLS', full = false, find = '' } = {}) {
  const every = listed(all);
  const skills = every.filter((s) => !s.shelf);
  const shelf = every.filter((s) => s.shelf);
  if (!every.length) return '';
  const row = (s, cut) => `- ${path}/${s.slug}${s.about ? `: ${cut ? short(s.about) : s.about}` : s.shelf && s.name ? `: ${short(s.name)}` : ''}`;
  if (full) {
    const want = String(find ?? '').trim().toLowerCase();
    const says = (s) => !want || `${s.slug} ${s.name} ${s.about} ${s.words.join(' ')}`.toLowerCase().includes(want);
    const a = skills.filter(says);
    const b = shelf.filter(says);
    if (want && !a.length && !b.length) return `No skill says "${want}". Read ${path} with no find lists all ${every.length}.`;
    return `Skills${want ? ` that say "${want}"` : ''}
Steps for some kinds of task. Read the one that fits before you start:
${[...a.map((s) => row(s)), ...(b.length ? [`In your library (${b.length}):`, ...b.map((s) => row(s, true))] : [])].join('\n')}`;
  }
  return `Skills
Steps for some kinds of task (SKILLS.md). When one fits and its steps did not come with the request, Read it first:
${[...skills.map((s) => row(s)), ...(shelf.length ? [`- ${path}: ${shelf.length} more in your library, not listed here. Before a kind of task you have no steps for, Read ${path} with find set to a word of the task (a tool's, a system's, a file type's name) and open the one that fits.`] : [])].join('\n')}`;
}

// Read "SKILLS" (the list) or "SKILLS/<name>" (one skill). When the project has
// a SKILLS folder, only "Rules/SKILLS" and "Rules/SKILLS/<name>" open the rules.
// null: not such a path (a project's own SKILLS.md, or its own SKILLS folder).
// more: Read's own find, offset and limit: find narrows the list, offset and limit read a long skill in parts.
export function readSkillPath(cwd, p, skills, more = {}) {
  // Not "SKILLS.md": that is a file a project may have or be asked to make.
  const raw = String(p ?? '').trim();
  const m = /^(?:\.\/)?(?:Rules\/)?SKILLS(?:\/(.+?)(?:\.md)?)?\/?$/.exec(raw);
  if (!m) return null;
  const path = skillPath(cwd);
  const askedRules = /^(?:\.\/)?Rules\/SKILLS(?:\/|$)/.test(raw);
  if (path === 'Rules/SKILLS' && !askedRules) return null;
  const all = skills ?? readSkills();
  if (!listed(all).length && !(m[1] && all.length)) return { error: 'There are no skills (SKILLS.md has none).' };
  const shown = path;
  if (!m[1]) return { text: skillsList(all, { path: shown, full: true, find: more.find }) };
  const want = slugOf(m[1]);
  const s = all.find((x) => x.slug === want);
  // The names in the error: yours and SKILLS.md's; the library is too long to say, so the way to its list instead.
  if (!s) return { error: `No skill ${shown}/${m[1]}. The skills: ${listed(all).filter((x) => !x.shelf).map((x) => `${shown}/${x.slug}`).join(', ') || 'none yet'}${all.some((x) => x.shelf) ? `; Read ${shown} lists the library's too` : ''}.` };
  return { text: skillText(s, shown, more), skill: s };
}

// One skill as Read gives it; a saved one says where it is kept and that Edit changes it.
const tilde = (f) => (process.env.HOME && f?.startsWith(`${process.env.HOME}/`) ? `~${f.slice(process.env.HOME.length)}` : f);
const skillText = (s, shown, { offset, limit } = {}) => {
  const p = skillPart(s.body, { offset, limit });
  const part = p.whole ? s.body : `${p.text}\n(Lines ${p.from} to ${p.to} of ${p.total}${p.next ? `. Read ${shown}/${s.slug} with offset ${p.next} for the next part` : ': the end'}.)`;
  return `${shown}/${s.slug} (${s.name}):\n${part}${s.from === 'saved' ? `\n(One of your saved skills, kept in ${tilde(s.file)} for every project: Edit ${shown}/${s.slug} changes it.)` : s.from === 'library' ? `\n(From your skill library, ${tilde(s.file)}: read-only here. Write ${shown}/${s.slug} to keep a version of your own, which is then used in its place.)` : ''}`;
};

// A Write or Edit of "SKILLS/<name>" (tools.mjs, skill-write.mjs): { slug, name } of the skill it means,
// { list: true } for "SKILLS" itself, null when the path is not a skill's (as readSkillPath reads it).
export function skillTarget(cwd, p) {
  const raw = String(p ?? '').trim();
  const m = /^(?:\.\/)?(?:Rules\/)?SKILLS(?:\/(.+?)(?:\.md)?)?\/?$/.exec(raw);
  if (!m) return null;
  if (skillPath(cwd) === 'Rules/SKILLS' && !/^(?:\.\/)?Rules\/SKILLS(?:\/|$)/.test(raw)) return null;
  if (!m[1] || m[1].includes('/')) return { list: true, path: skillPath(cwd) };
  return { slug: slugOf(m[1]), name: m[1], path: skillPath(cwd) };
}

// A path near the ones the instructions give, which models reach for: "SKILLS.md" or
// "RULES/SKILLS.md" opens the list of skills, ".SKILLS/<name>" or "RULES/SKILLS/<name>" that
// skill, and "RULES.md" the list of guides (2 Oct 2026: qwen3-coder-next tried SKILLS.md,
// .SKILLS/write-a-test, RULES/SKILLS/write-a-test and RULES.md in one task, each "File not
// found"). The caller asks only when the project has no such file. null: not such a path.
export function readNearPath(cwd, p, { skills, guides = [] } = {}) {
  const raw = String(p ?? '').trim().replace(/^\.\//, '');
  const m = /^(RULES\/|Rules\/)?(\.)?SKILLS(\.md)?(?:\/([^/]+?)(?:\.md)?)?\/?$/.exec(raw);
  if (m && (m[1] === 'RULES/' || m[2] || m[3])) {
    const all = skills ?? readSkills();
    if (!listed(all).length) return null;
    const path = skillPath(cwd);
    if (!m[4]) return { text: `${p} is not a file here; the skills open by their own paths.\n${skillsList(all, { path, full: true })}` };
    const s = all.find((x) => x.slug === slugOf(m[4]));
    if (!s) return { error: `No skill ${m[4]}. The skills: ${listed(all).filter((x) => !x.shelf).map((x) => `${path}/${x.slug}`).join(', ')}.` };
    return { text: skillText(s, path), skill: s };
  }
  if (/^(?:RULES|Rules)\.md$/.test(raw) && guides.length) return { text: `${p} is not a file here; the guides open by their own paths.\n${guidesList(guides, { path: guidePath(cwd) })}` };
  // A guide by its name alone ("DESIGN.md" for RULES/DESIGN.md; 27 Oct 2026: Bonsai 2 9B, three times in one run).
  const bare = /^([A-Za-z-]+)\.md$/.exec(raw);
  const g = bare && guides.find((x) => x.name === bare[1].toUpperCase());
  if (g) return { name: g.name, text: `${p} is not a file here; it is the guide ${guidePath(cwd)}/${g.name}.md:\n${g.body}` };
  return null;
}

// ---- the guides (the remote set) ---------------------------------------------------------------

// The path that opens a guide: RULES/<NAME>.md, or Rules/RULES/<NAME>.md when the project has a
// RULES folder of its own (on a Mac also a "rules" one), so the read cannot land in it.
export function guidePath(cwd) {
  try { if (cwd && existsSync(join(cwd, 'RULES'))) return 'Rules/RULES'; } catch {}
  return 'RULES';
}

// A guide's or helper's name: letters, digits and hyphens (it opens at RULES/<NAME>.md).
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

// The .md files of a folder as { file, name }: the name is the file's in capitals, each name
// once, by name. [] when the folder is not there.
function mdFiles(folder) {
  let names;
  try { names = readdirSync(folder, { withFileTypes: true }); } catch { return []; }
  const seen = new Map();
  for (const e of names) {
    if (!e.isFile() || !/\.md$/i.test(e.name)) continue;
    const name = e.name.slice(0, -3).toUpperCase();
    if (FILE_NAME.test(name) && !seen.has(name)) seen.set(name, { file: e.name, name });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Your own guides and helper agents (2 Oct 2026, the .md maker on the Desktop) live in the app's
// home, not in the repo: the repo is public, and its tests must not see them. A guide is NAME.md
// there, listed after the shipped ones (GUIDES) by name; a helper agent is agents/NAME.md.
// AGENTIC_HOME's in a test, so a test never sees yours.
export const ownDir = (home = HOME) => join(home, 'rules', REMOTE_DIR);
// Your guides: any NAME.md in your folder that is not HARNESS, TOOLS, SKILLS or a shipped guide.
export function extraGuides(own = ownDir()) {
  const known = new Set(['HARNESS', ...Object.values(PROMPT_FILES).map((f) => f.replace(/\.md$/, '')), ...GUIDES]);
  return mdFiles(own).filter((g) => !known.has(g.name));
}

// A guide as listed and read: the first sentence of the first paragraph under the title (a
// sentence may wrap), "Read this for …" shortened to "for …", and its ## sections.
function guideOf(name, text) {
  if (!text.trim()) return null;
  const head = text.replace(/^# .*\n/, '').trimStart();
  const para = head.startsWith('## ') ? '' : head.split(/\n\s*\n|\n## /)[0].replace(/\s*\n\s*/g, ' ');
  const about = (/^.*?[.!?](?=\s|$)/.exec(para)?.[0] ?? para).trim().replace(/^Read this\s+/i, '').replace(/\.$/, '');
  const at = text.search(/^## /m);
  return { name, about, body: (at >= 0 ? text.slice(at) : text).trim() };
}

// A set's guides: each one's name, what the list says about it and what a Read gives (its ##
// sections; the lines above them are for the person editing it). None on the local set;
// SUBAGENTS only when the Agent tool is offered. The shipped ones first, then the ones you added.
export function readGuides(set = 'local', { dir = rulesDir(), agents = false, mcp = false, own = ownDir() } = {}) {
  if (set !== 'remote') return [];
  const shipped = GUIDES.filter((g) => (agents || g !== AGENTS_GUIDE) && (mcp || g !== MCP_GUIDE)).map((name) => guideOf(name, readPromptFile(name, dir, 'remote').text));
  const added = extraGuides(own).map((g) => {
    try { return guideOf(g.name, readFileSync(join(own, g.file), 'utf8')); } catch { return null; }
  });
  return [...shipped, ...added].filter(Boolean);
}

// ---- helper agents (the remote set) ------------------------------------------------------------

// Helper agent files (2 Oct 2026, the .md maker): <your folder>/agents/<NAME>.md (ownDir), each a
// helper the main model can hand work to with the Agent tool, as kind <name> in small letters.
//   # Test writer                       the title, for you
//   Use it to add one test for …        what the Agent tool says about it (the first sentence)
//   - Tools: all                        all (the default), look (it only reads), or a list
//   - Model: main                       main (the default), or a model on the same Ollama service
//   ## Instructions …                   what the helper is given, from the first ## on
const AGENTS_FOLDER = 'agents';
// Kinds the Agent tool already has: a file of that name is left out.
const BUILT_IN_KINDS = ['explore', 'general'];

//   - Mode: plan                        (19 Nov 2026) its own permission mode: plan, manual, edits, auto or
//                                       dontask; never more open than the conversation's (helperMode)
//   - Isolation: worktree               (19 Nov 2026) it works in its own copy of the repo (a git worktree);
//                                       its changes stay there, and its report says where (runHelper)
// Claude Code's agent files are read too (19 Nov 2026): front matter between --- lines (name, description,
// tools, model, permissionMode, isolation), then its instructions; its tool names are ours (Grep is Search).
const CLAUDE_TOOLS = { grep: 'Search', glob: 'List', ls: 'List', task: 'Agent', multiedit: 'Edit', notebookedit: 'Edit', bashoutput: 'Jobs', killshell: 'Jobs' };
const helperModeOf = (word) => { const w = String(word ?? '').trim(); if (!w) return null; const m = modeOf(w); return m && m !== 'bypass' ? m : null; };
export function parseHelperAgent(name, text) {
  const clean = String(text ?? '').replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  const front = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(clean.trimStart());
  if (front) {
    const key = (k) => new RegExp(`^${k}:[ \\t]*(.*)$`, 'mi').exec(front[1])?.[1].trim().replace(/^["']|["']$/g, '') ?? '';
    const named = key('name').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    const about = key('description').replace(/\s+/g, ' ').slice(0, 300).replace(/\.$/, '');
    const raw = key('tools');
    const tools = !raw || /^(all|\*)$/i.test(raw) ? 'all' : raw.replace(/^\[|\]$/g, '').split(/[\s,]+/).map((x) => x.replace(/^["']|["']$/g, '')).filter(Boolean).map((x) => CLAUDE_TOOLS[x.toLowerCase()] ?? x);
    const model = key('model');
    const mode = helperModeOf(key('permissionMode') || key('mode'));
    const isolation = /^worktree$/i.test(key('isolation')) ? 'worktree' : null;
    const body = clean.trimStart().slice(front[0].length).replace(/^# .*\n/, '').trim();
    return { name, kind: named || name.toLowerCase(), about, tools, model: !model || /^(inherit|main)$/i.test(model) ? 'main' : model, ...(mode ? { mode } : {}), ...(isolation ? { isolation } : {}), body };
  }
  const t = clean.replace(/^# .*\n/, '').trimStart();
  const at = t.search(/^## /m);
  const top = (at >= 0 ? t.slice(0, at) : t).split('\n');
  const field = (key) => top.find((l) => l.toLowerCase().startsWith(`- ${key}:`))?.slice(key.length + 3).trim() ?? '';
  const para = top.filter((l) => !/^- [a-z]+:/i.test(l)).join('\n').trim().split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, ' ');
  const about = (/^.*?[.!?](?=\s|$)/.exec(para)?.[0] ?? para).trim().replace(/\.$/, '');
  const raw = field('tools').toLowerCase();
  const tools = !raw || raw === 'all' ? 'all' : /^(look|look only|read only)$/.test(raw) ? 'look' : field('tools').split(/[\s,]+/).filter(Boolean).map((x) => CLAUDE_TOOLS[x.toLowerCase()] ?? x);
  const mode = helperModeOf(field('mode'));
  const isolation = /^worktree$/i.test(field('isolation')) ? 'worktree' : null;
  return { name, kind: name.toLowerCase(), about, tools, model: field('model') || 'main', ...(mode ? { mode } : {}), ...(isolation ? { isolation } : {}), body: at >= 0 ? t.slice(at).trim() : '' };
}

// The folders helper agents come from, first one wins a name (19 Nov 2026, as Claude Code: a project's own
// first, then yours): the project's .agentic/agents and .claude/agents, your folder's agents/, Claude Code's
// ~/.claude/agents (AGENTIC_CLAUDE_AGENTS names another; none in a test, where AGENTIC_HOME is set), then the
// plugins you switched on (plugins.mjs). A project's helper is only words: its Mode can make it stricter, never
// more open, and its steps ask as yours do.
const claudeAgentsDir = () => process.env.AGENTIC_CLAUDE_AGENTS ?? (process.env.AGENTIC_HOME ? null : join(homedir(), '.claude', 'agents'));
function agentFiles(folder) {
  let names;
  try { names = readdirSync(folder, { withFileTypes: true }); } catch { return []; }
  return names.filter((e) => e.isFile() && /\.md$/i.test(e.name) && FILE_NAME.test(e.name.slice(0, -3))).map((e) => ({ name: e.name.slice(0, -3), file: join(folder, e.name) })).sort((a, b) => a.name.localeCompare(b.name));
}

// Your helper agents: none on the local set. from: where each came from (project, yours, claude, plugin <name>).
export function readHelperAgents(set = 'local', { own = ownDir(), cwd = null, claude = claudeAgentsDir(), plugins = activePlugins() } = {}) {
  if (set !== 'remote') return [];
  const sources = [
    ...(cwd ? [{ dir: join(cwd, '.agentic', 'agents'), from: 'project' }, { dir: join(cwd, '.claude', 'agents'), from: 'project' }] : []),
    { dir: join(own, AGENTS_FOLDER), from: 'yours', upper: true },
    ...(claude ? [{ dir: claude, from: 'claude' }] : []),
  ];
  const out = [];
  const add = (a) => { if (a && a.body && !BUILT_IN_KINDS.includes(a.kind) && !out.some((x) => x.kind === a.kind)) out.push(a); };
  for (const s of sources) {
    // Your folder's names as they always were (TEST-WRITER.md); the others by Claude Code's (code-reviewer.md).
    const files = s.upper ? mdFiles(s.dir).map((f) => ({ name: f.name, file: join(s.dir, f.file) })) : agentFiles(s.dir);
    for (const f of files) { try { add({ ...parseHelperAgent(f.name, readFileSync(f.file, 'utf8')), ...(s.from === 'yours' ? {} : { from: s.from }) }); } catch {} }
  }
  for (const p of plugins ?? []) for (const f of p.parts.agents) { try { add({ ...parseHelperAgent(f.name, f.text), from: `plugin ${p.name}` }); } catch {} }
  return out;
}

// The mode a helper of yours works in: its own when that is as strict as the conversation's or stricter,
// else the conversation's. Plan is the strictest, then Manual; Accept edits and Don't ask let edits through.
const MODE_RANK = { plan: 0, ask: 1, edits: 2, dontask: 2, auto: 3, bypass: 4 };
export function helperMode(own, mode) {
  const want = own?.mode;
  return want && (MODE_RANK[want] ?? 9) <= (MODE_RANK[mode] ?? 9) ? want : mode;
}

// The list in the instructions: every guide by the path that opens it.
export function guidesList(guides, { path = 'RULES', intro = '' } = {}) {
  if (!guides.length) return '';
  return `Guides
${intro || 'Longer guides for some kinds of work. When one fits the task and you have not read it in this conversation, Read it first:'}
${guides.map((g) => `- ${path}/${g.name}.md${g.about ? `: ${g.about}` : ''}`).join('\n')}`;
}

// Read "RULES" (the list) or "RULES/<NAME>.md" (one guide). null: not such a path, or no
// guides on this set (then the project's own RULES folder is read as any folder).
export function readGuidePath(cwd, p, guides) {
  if (!guides?.length) return null;
  const raw = String(p ?? '').trim();
  const m = /^(?:\.\/)?(?:Rules\/)?RULES(?:\/([A-Za-z0-9-]+?)(?:\.md)?)?\/?$/.exec(raw);
  if (!m) return null;
  const path = guidePath(cwd);
  if (path === 'Rules/RULES' && !/^(?:\.\/)?Rules\/RULES(?:\/|$)/.test(raw)) return null;
  if (!m[1]) return { text: guidesList(guides, { path }) };
  const g = guides.find((x) => x.name === m[1].toUpperCase());
  if (!g) return { error: `No guide ${path}/${m[1]}. The guides: ${guides.map((x) => `${path}/${x.name}.md`).join(', ')}.` };
  return { name: g.name, text: `${path}/${g.name}.md:\n${g.body}` };
}

// HARNESS.md's four parts, each from the built-in copy when the file on disk lacks it.
export function harnessOf(dir = rulesDir()) {
  const text = readPromptFile('harness', dir, 'remote').text;
  const part = (h) => sectionOf(text, h) ?? sectionOf(BUILT_IN_REMOTE.harness ?? '', h) ?? '';
  return { who: part('Who you are'), how: part('How you work'), guides: part('Guides'), rules: part('Rules the app enforces') };
}
