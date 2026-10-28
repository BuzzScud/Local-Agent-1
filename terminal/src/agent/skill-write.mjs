// A Write or Edit of SKILLS/<name> (tools.mjs prepare): a skill saved in the app's home (skill-store.mjs),
// not a file of the project. SKILLS.md's skills stay read-only; yours can be written whole again or edited.
// What comes back is prepare's shape, with `skill` set, so the step asks, shows the diff and writes it as any
// change (agent-step.mjs leaves it out of the project's checks: it is not a change to the project).
import { existsSync, readFileSync } from 'node:fs';
import { diffLines } from '../tools/edit.mjs';
import { findEdit } from './tools-edit.mjs';
import { parseSkills, readSkills, savedSkillText, skillProblems, skillTarget } from './prompt-files.mjs';
import { skillFile, skillsDir } from './skill-store.mjs';

const SHAPE = '## <Name>, then "- Words: <phrases a request for it uses>", "- About: <one line>", then its steps';

export function prepareSkill(name, args, env, { dir = skillsDir() } = {}) {
  const t = skillTarget(env.cwd, args.path);
  if (!t) return null;
  if (t.list) return { error: `${args.path} is the list of skills. Write one skill to ${t.path}/<name>: ${SHAPE}.` };
  const shipped = readSkills(undefined, env.rulesSet, { saved: null }).find((s) => s.slug === t.slug);
  if (shipped) return { error: `${t.path}/${t.slug} is one of the user's skills (${shipped.from === 'built-in' ? 'Agentic Coder' : 'SKILLS.md'}), which are read-only here. Read them; never change them. To keep your own version, Write it under another name.` };
  const abs = skillFile(t.slug, dir);
  const rel = `${t.path}/${t.slug}`;
  const exists = existsSync(abs);
  const before = exists ? readFileSync(abs, 'utf8') : '';
  let after;
  let how;
  if (name === 'Edit') {
    if (!exists) return { error: `There is no saved skill ${rel}. Write it to save a new one: ${SHAPE}.` };
    const m = findEdit(before, args.old_text, args.new_text, { replaceAll: args.replace_all === true, line: Number(args.line) || null });
    if (!m.ok) return { error: m.error, ...(m.done ? { done: true } : {}) };
    if (m.after === before) return { error: 'old_text and new_text are the same, so nothing would change. If that is what you wanted, the skill is already right.' };
    after = m.after;
    how = m.how;
  } else after = savedSkillText(t.slug, args.content);
  const skills = parseSkills(after);
  if (skills.length !== 1) return { error: `A saved skill is one "## Name" section${skills.length ? `, and this has ${skills.length}: save each under its own name` : ''}: ${SHAPE}. Use ### for headings inside its steps.` };
  const { errors } = skillProblems(skills);
  if (errors.length) return { error: `${errors.join(' ')} A skill is ${SHAPE}.` };
  return { abs, rel, before, after, how, ...diffLines(before, after), created: !exists, skill: { slug: t.slug, name: skills[0].name, words: skills[0].words } };
}

// The line the model is told once it is saved.
export function savedSkillLine(prepared, home = process.env.HOME) {
  const s = prepared.skill;
  const where = home && prepared.abs.startsWith(`${home}/`) ? `~${prepared.abs.slice(home.length)}` : prepared.abs;
  const brings = s.words.length ? `any request that uses its words (${s.words.join(', ')}) brings its steps` : 'it has no Words line, so it comes only when opened from the list: add "- Words: …" with Edit';
  return `${prepared.created ? 'Saved' : 'Updated'} the skill ${prepared.rel} ("${s.name}", +${prepared.additions} −${prepared.removals} lines), kept in ${where} for every project: ${brings}.`;
}
