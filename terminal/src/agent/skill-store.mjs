// Saved skills (28 Oct 2026, "a persistent skills storage system"): skills kept in the app's home,
// one file each, beside the ones SKILLS.md ships with. They outlast an update (the build copy and the
// repo are replaced; the home is not) and come with every project. The model saves one with Write to
// SKILLS/<name> (tools.mjs, after the user asks), and /skills lists, shows and removes them.
//   ~/.agentic-coder/skills/<name>.md   a skill as SKILLS.md writes one: "## Name", "- Words:", "- About:",
//                                       an optional "- Fence:", then its steps; <name> is what opens it
//   ~/.agentic-coder/skills/.uses.json  how often each skill came with a request or was read, and when last
//   ~/.agentic-coder/skills/.removed/   what /skills remove took out, dated, so nothing is lost
// AGENTIC_HOME's in a test, so a test never sees yours. Nothing here imports prompt-files.mjs, which
// reads this folder (it has the parser).
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOME } from '../../../models/index.mjs';

export const skillsDir = (home = HOME) => join(home, 'skills');
const USES = '.uses.json';
const REMOVED = '.removed';
// A saved skill's name on disk: what SKILLS/<name> opens.
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

// Every saved skill's file as { slug, file, text }, by name. [] when there is no folder.
export function savedSkillFiles(dir = skillsDir()) {
  let names;
  try { names = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of names) {
    if (!e.isFile() || !/\.md$/i.test(e.name)) continue;
    const slug = e.name.slice(0, -3).toLowerCase();
    if (!SLUG.test(slug) || out.some((x) => x.slug === slug)) continue;
    try { out.push({ slug, file: join(dir, e.name), text: readFileSync(join(dir, e.name), 'utf8') }); } catch {}
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

export const skillFile = (slug, dir = skillsDir()) => join(dir, `${slug}.md`);

// Written whole through a file beside it, so a skill is never half there.
export function writeSkillFile(slug, text, dir = skillsDir()) {
  if (!SLUG.test(slug)) throw new Error(`"${slug}" is not a skill's name (small letters, digits and hyphens)`);
  mkdirSync(dir, { recursive: true });
  const to = skillFile(slug, dir);
  const tmp = `${to}.${process.pid}.tmp`;
  writeFileSync(tmp, text.endsWith('\n') ? text : `${text}\n`);
  renameSync(tmp, to);
  return to;
}

// Out of the list into .removed/<name>-<when>.md. null: there is no such saved skill.
export function removeSkillFile(slug, dir = skillsDir(), now = new Date()) {
  const from = skillFile(slug, dir);
  if (!SLUG.test(slug) || !existsSync(from)) return null;
  const bin = join(dir, REMOVED);
  mkdirSync(bin, { recursive: true });
  const to = join(bin, `${slug}-${now.toISOString().replace(/[:.]/g, '-')}.md`);
  renameSync(from, to);
  return to;
}

// { <name>: { n, last } }: {} when nothing was kept yet or the file cannot be read.
export function skillUses(dir = skillsDir()) {
  try { const v = JSON.parse(readFileSync(join(dir, USES), 'utf8')); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

// One more use of a skill (it came with a request, or the model read it). Never throws: a use that
// cannot be kept is only a count.
export function noteSkillUse(slug, dir = skillsDir(), now = Date.now()) {
  try {
    if (!SLUG.test(slug)) return;
    const all = skillUses(dir);
    all[slug] = { n: (all[slug]?.n ?? 0) + 1, last: now };
    mkdirSync(dir, { recursive: true });
    const to = join(dir, USES);
    writeFileSync(`${to}.${process.pid}.tmp`, `${JSON.stringify(all, null, 2)}\n`);
    renameSync(`${to}.${process.pid}.tmp`, to);
  } catch {}
}
