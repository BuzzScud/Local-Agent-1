// /skills (28 Oct 2026): every skill the model can be given, yours first (saved in the app's home,
// agent/skill-store.mjs), then SKILLS.md's; how often each came along and when last. With a word:
//   /skills save [name]     the model turns what worked in this conversation into a saved skill
//   /skills show <name>     its Words, About and steps
//   /skills remove <name>   a saved one out of the list (kept dated in .removed/, nothing deleted)
//   /skills open            the folder in Finder
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { readSkills, slugOf, skillWhere } from '../agent/prompt-files.mjs';
import { removeSkillFile, skillsDir, skillUses } from '../agent/skill-store.mjs';

const tilde = (p) => (p?.startsWith(`${homedir()}/`) ? `~${p.slice(homedir().length)}` : p);
const day = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const usedWords = (u) => (u?.n ? `used ${u.n} time${u.n === 1 ? '' : 's'}, last ${day(u.last)}` : 'not used yet');

// What /skills save sends as your message: it brings the Save a skill steps by their words ("as a skill").
export const saveSkillPrompt = (name) => `Save what worked in this conversation as a skill${name ? ` named "${name}"` : ''}, so it comes with the next request of that kind in any project. Keep only the steps that worked, with the real commands and files.`;

// The panel: yours, then SKILLS.md's, then the keys. skills and uses for the tests.
export function skillsPanel({ skills = readSkills(), uses = skillUses(), dir = skillsDir() } = {}) {
  const mine = skills.filter((s) => s.from === 'saved');
  const shipped = skills.filter((s) => !s.from);
  const pad = Math.min(30, Math.max(14, ...[...mine, ...shipped].map((s) => s.slug.length + 4)));
  const row = (s) => [`  ${s.slug}`, `${s.about || s.name}${s.words.length ? ` · words: ${s.words.slice(0, 4).join(', ')}${s.words.length > 4 ? ` +${s.words.length - 4}` : ''}` : ' · no Words: only opened from the list'} · ${usedWords(uses[s.slug])}`];
  const rows = [[`Saved · ${tilde(dir)} · every project`]];
  if (mine.length) rows.push(...mine.map(row));
  else rows.push(['  None yet. After a task, /skills save, or ask "save that as a skill".']);
  rows.push([`SKILLS.md · read-only · the hub's Instructions → 08`]);
  if (shipped.length) rows.push(...shipped.map(row));
  else rows.push(['  None switched on.']);
  rows.push(['', '/skills save [name] · /skills show <name> · /skills remove <name> · /skills open']);
  return { type: 'panel', title: `Skills · ${mine.length} saved · ${shipped.length} in SKILLS.md · each comes with a request that uses its words`, pad, rows };
}

export function skillsCommand(self, arg, busy) {
  const [what = '', ...rest] = arg.trim().split(/\s+/);
  const name = rest.join(' ').trim();
  const say = (text, tone = 'dim') => self.push({ type: 'note', text, tone });
  const find = (n) => readSkills().find((s) => s.slug === slugOf(n));
  switch (what.toLowerCase()) {
    case '': self.push(skillsPanel()); return;
    case 'save': {
      if (busy) { self.flash('Wait for Agentic Coder to finish first'); return; }
      if (!self.agent.messages?.some((m) => m.role === 'assistant')) { say('Nothing to save yet: do the task first, then /skills save. Or describe one: "save a skill for deploying the site: …".', 'warn'); return; }
      self.sendPrompt(saveSkillPrompt(name), `/skills save${name ? ` ${name}` : ''}`);
      return;
    }
    case 'show': {
      const s = name && find(name);
      if (!s) { say(name ? `No skill called ${name}. /skills lists them.` : 'Which one? /skills show <name>; /skills lists them.', 'warn'); return; }
      self.push({ type: 'expand', title: `${s.name} · ${skillWhere(s)}${s.file ? ` · ${tilde(s.file)}` : ''}`, text: [s.words.length ? `Words: ${s.words.join(', ')}` : 'Words: none (only opened from the list)', s.about ? `About: ${s.about}` : '', s.fence?.length ? `Fence: ${s.fence.join(', ')}` : '', '', s.body].filter((l, i) => l || i === 3).join('\n') });
      return;
    }
    case 'remove':
    case 'delete': {
      if (busy) { self.flash('Wait for Agentic Coder to finish first'); return; }
      const s = name && find(name);
      if (!s) { say(name ? `No skill called ${name}. /skills lists them.` : 'Which one? /skills remove <name>.', 'warn'); return; }
      if (s.from !== 'saved') { say(`${s.name} is in ${skillWhere(s)}, not one of your saved skills: change it in the hub's Instructions → 08 SKILLS.md.`, 'warn'); return; }
      const to = removeSkillFile(s.slug);
      say(to ? `Removed ${s.slug} from your skills; the file is kept at ${tilde(to)}.` : `${s.slug} could not be removed.`, to ? 'dim' : 'warn');
      return;
    }
    case 'open': {
      const dir = skillsDir();
      try { mkdirSync(dir, { recursive: true }); } catch {}
      if (!process.env.AGENTIC_NO_OPEN) { try { Bun.spawn(['open', dir], { stdout: 'ignore', stderr: 'ignore' }); } catch {} }
      say(`Your saved skills: ${tilde(dir)} · one .md file each (## Name, - Words:, - About:, then the steps); a file changed there is read at the next message.`);
      return;
    }
    default: say(`/skills ${what}? /skills alone lists them; save [name], show <name>, remove <name> or open.`, 'warn');
  }
}
