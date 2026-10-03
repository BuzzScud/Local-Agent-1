// The prompt files in terminal/rules/ (30 Sep 2026, the hub's Instructions →
// Prompt files): TOOLS.md is the "Tool use" part of the instructions, and
// SKILLS.md holds steps for kinds of task, each brought by its words.
// Read from disk at each use, so a save in the hub applies on the next
// message; the copy built into the app is used when the repo is not here.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME } from '../../../models/index.mjs';

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
export const AGENTS_GUIDE = 'SUBAGENTS';
// Listed only while a tool of an MCP server is offered (agent.mjs mcpOn).
export const MCP_GUIDE = 'MCP';
export const instructionsEnv = (env = process.env) => env.AGENTIC_INSTRUCTIONS;
// The saved choice (settings.json "instructions", the file the app's settings live in), 'auto'
// when there is none or it cannot be read.
export function savedInstructions(home = HOME) {
  try { const v = JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')).instructions; return RULE_SETS.includes(v) ? v : 'auto'; } catch { return 'auto'; }
}
export function rulesSetOf(choice, model, env = process.env) {
  const c = instructionsEnv(env) ?? choice ?? savedInstructions();
  if (c === 'local' || c === 'remote') return c;
  return model?.remote ? 'remote' : 'local';
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

// Where the files are kept on this Mac: the repo's terminal/rules (the
// launcher passes AGENTIC_REPO; run from the source, the folder beside this
// one); AGENTIC_RULES_DIR for tests. null: the built-in copies only.
export function rulesDir() {
  if (process.env.AGENTIC_RULES_DIR) return process.env.AGENTIC_RULES_DIR;
  for (const repo of [process.env.AGENTIC_REPO, process.env.BONSAI_REPO]) {
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
export const toolUseFor = (set = 'local', dir = rulesDir(), { mcp = false } = {}) => {
  const text = readPromptFile('tools', dir, set).text;
  const lines = toolUseText(text);
  const more = mcp ? sectionOf(text, 'MCP tools') || sectionOf(set === 'remote' ? BUILT_IN_REMOTE.tools ?? '' : BUILT_IN.tools, 'MCP tools') || '' : '';
  const brief = typeof mcp === 'string' ? mcp : '';
  return [lines, more, brief].filter(Boolean).join('\n');
};

const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';

// A skill's fence is what the loop enforces. The steps stay in the prompt; a
// sentence there is all a small model has, and on a 9B model that sentence loses.
//   read     Edit and Write are refused
//   check    one command must run before the turn may end as done
//   scratch  a failed check puts the message's edits back (the free loop does this either way)
export const FENCES = ['read', 'check', 'scratch'];

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
export const readSkills = (dir = rulesDir(), set = 'local') => parseSkills(readPromptFile('skills', dir, set).text);

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
  const t = String(text ?? '').replace(/the question "[^"]*"/g, '').toLowerCase().replace(/[‘’]/g, "'");
  let best = null;
  for (const s of skills) {
    const matched = s.words.filter((w) => new RegExp(`(^|[^a-z0-9])${escape(w)}(?=$|[^a-z0-9])`).test(t));
    const score = matched.reduce((n, w) => n + (w.includes(' ') ? 2 : 1), 0);
    if (score > (best?.score ?? 0)) best = { ...s, score, matched };
  }
  return best;
}

// A skill's steps as they go with a request.
export const skillNote = (s) => `Skill "${s.name}" from SKILLS.md: this request uses its words, so follow its steps:\n${s.body}`;

// The path that opens a skill. SKILLS/<name> when the project has no folder of
// that name; Rules/SKILLS/<name> when it does, so the read cannot land in the
// project's own folder (readSkillPath used to return null, and Read hit the project).
export function skillPath(cwd) {
  try { if (cwd && existsSync(join(cwd, 'SKILLS'))) return 'Rules/SKILLS'; } catch {}
  return 'SKILLS';
}

// The list in the instructions: every skill by the path that opens it.
export function skillsList(skills, { path = 'SKILLS' } = {}) {
  if (!skills.length) return '';
  return `Skills
Steps for some kinds of task (SKILLS.md). When one fits and its steps did not come with the request, Read it first:
${skills.map((s) => `- ${path}/${s.slug}${s.about ? `: ${s.about}` : ''}`).join('\n')}`;
}

// Read "SKILLS" (the list) or "SKILLS/<name>" (one skill). When the project has
// a SKILLS folder, only "Rules/SKILLS" and "Rules/SKILLS/<name>" open the rules.
// null: not such a path (a project's own SKILLS.md, or its own SKILLS folder).
export function readSkillPath(cwd, p, skills) {
  // Not "SKILLS.md": that is a file a project may have or be asked to make.
  const raw = String(p ?? '').trim();
  const m = /^(?:\.\/)?(?:Rules\/)?SKILLS(?:\/(.+?)(?:\.md)?)?\/?$/.exec(raw);
  if (!m) return null;
  const path = skillPath(cwd);
  const askedRules = /^(?:\.\/)?Rules\/SKILLS(?:\/|$)/.test(raw);
  if (path === 'Rules/SKILLS' && !askedRules) return null;
  const all = skills ?? readSkills();
  if (!all.length) return { error: 'There are no skills (SKILLS.md has none).' };
  const shown = path;
  if (!m[1]) return { text: skillsList(all, { path: shown }) };
  const want = slugOf(m[1]);
  const s = all.find((x) => x.slug === want);
  if (!s) return { error: `No skill ${shown}/${m[1]}. The skills: ${all.map((x) => `${shown}/${x.slug}`).join(', ')}.` };
  return { text: `${shown}/${s.slug} (${s.name}):\n${s.body}` };
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
    if (!all.length) return null;
    const path = skillPath(cwd);
    if (!m[4]) return { text: `${p} is not a file here; the skills open by their own paths.\n${skillsList(all, { path })}` };
    const s = all.find((x) => x.slug === slugOf(m[4]));
    if (!s) return { error: `No skill ${m[4]}. The skills: ${all.map((x) => `${path}/${x.slug}`).join(', ')}.` };
    return { text: `${path}/${s.slug} (${s.name}):\n${s.body}` };
  }
  if (/^(?:RULES|Rules)\.md$/.test(raw) && guides.length) return { text: `${p} is not a file here; the guides open by their own paths.\n${guidesList(guides, { path: guidePath(cwd) })}` };
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
export const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

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
export const AGENTS_FOLDER = 'agents';
// Kinds the Agent tool already has: a file of that name is left out.
export const BUILT_IN_KINDS = ['explore', 'general'];

export function parseHelperAgent(name, text) {
  const t = String(text ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/^# .*\n/, '').trimStart();
  const at = t.search(/^## /m);
  const top = (at >= 0 ? t.slice(0, at) : t).split('\n');
  const field = (key) => top.find((l) => l.toLowerCase().startsWith(`- ${key}:`))?.slice(key.length + 3).trim() ?? '';
  const para = top.filter((l) => !/^- [a-z]+:/i.test(l)).join('\n').trim().split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, ' ');
  const about = (/^.*?[.!?](?=\s|$)/.exec(para)?.[0] ?? para).trim().replace(/\.$/, '');
  const raw = field('tools').toLowerCase();
  const tools = !raw || raw === 'all' ? 'all' : /^(look|look only|read only)$/.test(raw) ? 'look' : field('tools').split(/[\s,]+/).filter(Boolean);
  return { name, kind: name.toLowerCase(), about, tools, model: field('model') || 'main', body: at >= 0 ? t.slice(at).trim() : '' };
}

// Your helper agents: none on the local set, none without a folder of them.
export function readHelperAgents(set = 'local', { own = ownDir() } = {}) {
  if (set !== 'remote') return [];
  const folder = join(own, AGENTS_FOLDER);
  return mdFiles(folder).map((f) => {
    try { return parseHelperAgent(f.name, readFileSync(join(folder, f.file), 'utf8')); } catch { return null; }
  }).filter((a) => a && a.body && !BUILT_IN_KINDS.includes(a.kind));
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
