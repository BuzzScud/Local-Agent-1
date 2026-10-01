// The prompt files in terminal/rules/ (30 Sep 2026, the hub's Instructions →
// Prompt files): TOOLS.md is the "Tool use" part of the instructions, and
// SKILLS.md holds steps for kinds of task, each brought by its words.
// Read from disk at each use, so a save in the hub applies on the next
// message; the copy built into the app is used when the repo is not here.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
export function readPromptFile(which, dir = rulesDir()) {
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

const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';

// SKILLS.md: each "## Name" is a skill with its "- Words:" and "- About:"
// lines, and the rest of its section as its steps. <!-- … --> is left out.
export function parseSkills(text) {
  const skills = [];
  for (const part of String(text ?? '').replace(/<!--[\s\S]*?-->/g, '').split(/^## /m).slice(1)) {
    const [head, ...lines] = part.split('\n');
    const name = head.trim();
    if (!name) continue;
    const field = (key) => lines.find((l) => l.toLowerCase().startsWith(`- ${key}:`))?.slice(key.length + 3).trim() ?? '';
    skills.push({
      name,
      slug: slugOf(name),
      words: field('words').toLowerCase().split(',').map((w) => w.trim()).filter(Boolean),
      about: field('about'),
      body: lines.filter((l) => !/^- (words|about):/i.test(l)).join('\n').trim(),
    });
  }
  return skills;
}
export const readSkills = (dir = rulesDir()) => parseSkills(readPromptFile('skills', dir).text);

// What stops a save (errors) and what is only worth saying (warnings).
export function skillProblems(skills) {
  const errors = [];
  const warnings = [];
  const seen = new Map();
  for (const s of skills) {
    if (seen.has(s.slug)) errors.push(`"${s.name}" and "${seen.get(s.slug)}" both open as SKILLS/${s.slug}: give one another name.`);
    seen.set(s.slug, s.name);
    if (!s.body) errors.push(`"${s.name}" has no steps under it.`);
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

// The list in the instructions: every skill by the path that opens it.
export function skillsList(skills) {
  if (!skills.length) return '';
  return `Skills
Steps for some kinds of task (SKILLS.md). When one fits and its steps did not come with the request, Read it first:
${skills.map((s) => `- SKILLS/${s.slug}${s.about ? `: ${s.about}` : ''}`).join('\n')}`;
}

// Read "SKILLS" (the list) or "SKILLS/<name>" (one skill), when the project
// has no SKILLS folder of its own. null: not such a path.
export function readSkillPath(cwd, p, skills) {
  // Not "SKILLS.md": that is a file a project may have or be asked to make.
  const m = /^(?:\.\/)?SKILLS(?:\/(.+?)(?:\.md)?)?\/?$/.exec(String(p ?? '').trim());
  if (!m || existsSync(join(cwd, 'SKILLS'))) return null;
  const all = skills ?? readSkills();
  if (!all.length) return { error: 'There are no skills (SKILLS.md has none).' };
  if (!m[1]) return { text: skillsList(all) };
  const want = slugOf(m[1]);
  const s = all.find((x) => x.slug === want);
  if (!s) return { error: `No skill SKILLS/${m[1]}. The skills: ${all.map((x) => `SKILLS/${x.slug}`).join(', ')}.` };
  return { text: `SKILLS/${s.slug} (${s.name}):\n${s.body}` };
}
