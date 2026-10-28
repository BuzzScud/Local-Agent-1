// Saved skills (28 Oct 2026, agent/skill-store.mjs, skill-write.mjs, app/skills-cmd.mjs): kept in the app's home
// for every project, brought by their words as SKILLS.md's are, written by the model with Write SKILLS/<name>
// (asking first), and listed, shown and removed with /skills.
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A throwaway home BEFORE the models part is first imported (it reads AGENTIC_HOME once).
const FIRST_HOME = mkdtempSync(join(tmpdir(), 'agentic-skills-home-'));
process.env.AGENTIC_HOME = FIRST_HOME;
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { readSkills, pickSkill, skillNote, skillsList, readSkillPath, savedSkillText, savedSkills, SAVE_SKILL } = await import('../src/agent/prompt-files.mjs');
const { skillsDir, savedSkillFiles, writeSkillFile, removeSkillFile, skillUses, noteSkillUse } = await import('../src/agent/skill-store.mjs');
const { prepare, execute } = await import('../src/agent/tools.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { skillsPanel, skillsCommand, saveSkillPrompt } = await import('../src/app/skills-cmd.mjs');
const { Agent } = await import('../src/agent/agent.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL, HOME } = await import('../../models/index.mjs');

const SOURCE = new URL('../rules/', import.meta.url).pathname;
const SKILLS = '# Skills\n\n## Write a test\n- Words: add a test, write a test\n- About: add one test\n\n1. Find the tests.\n';
const DEPLOY = '## Deploy the site\n- Words: deploy the site, ship it\n- About: build, upload and check the site\n\n1. Run bun run build.\n2. Run ./upload.sh.\n3. Open the address and check it loads.\n';

let rules, proj, saved;
const dir = () => skillsDir();
beforeEach(() => {
  expect(HOME).toBe(FIRST_HOME); // the throwaway, never ~/.agentic-coder
  rmSync(dir(), { recursive: true, force: true });
  saved = process.env.AGENTIC_RULES_DIR;
  const root = mkdtempSync(join(tmpdir(), 'agentic-skills-'));
  rules = join(root, 'rules'); proj = join(root, 'proj');
  for (const d of [rules, proj]) mkdirSync(d);
  copyFileSync(join(SOURCE, 'bug-fixing.md'), join(rules, 'bug-fixing.md'));
  copyFileSync(join(SOURCE, 'TOOLS.md'), join(rules, 'TOOLS.md'));
  writeFileSync(join(rules, 'SKILLS.md'), SKILLS);
  process.env.AGENTIC_RULES_DIR = rules;
});
afterEach(() => { if (saved === undefined) delete process.env.AGENTIC_RULES_DIR; else process.env.AGENTIC_RULES_DIR = saved; });

test('the store: one file a skill in the home, written whole, removed into .removed (nothing deleted), uses counted', () => {
  expect(dir()).toBe(join(FIRST_HOME, 'skills'));
  expect(savedSkillFiles()).toEqual([]);
  writeSkillFile('deploy-the-site', DEPLOY);
  writeFileSync(join(dir(), 'Not A Slug.md'), 'x'); // not a name SKILLS/<name> opens: left out
  writeFileSync(join(dir(), 'notes.txt'), 'x');
  expect(savedSkillFiles().map((f) => f.slug)).toEqual(['deploy-the-site']);
  expect(readdirSync(dir()).some((f) => f.endsWith('.tmp'))).toBe(false);
  expect(() => writeSkillFile('../out', 'x')).toThrow();
  noteSkillUse('deploy-the-site', dir(), Date.UTC(2026, 9, 28));
  noteSkillUse('deploy-the-site');
  expect(skillUses()['deploy-the-site'].n).toBe(2);
  const to = removeSkillFile('deploy-the-site', dir(), new Date(Date.UTC(2026, 9, 28, 12)));
  expect(to).toBe(join(dir(), '.removed', 'deploy-the-site-2026-10-28T12-00-00-000Z.md'));
  expect(readFileSync(to, 'utf8')).toBe(DEPLOY);
  expect(savedSkillFiles()).toEqual([]);
  expect(removeSkillFile('deploy-the-site')).toBeNull();
});

test('what a Write sends becomes a SKILLS.md section: plain steps, a # title, a front matter (Claude\'s and Hermes\' SKILL.md)', () => {
  expect(savedSkillText('run-the-checks', '1. Run bun run check.')).toBe('## Run the checks\n1. Run bun run check.\n');
  expect(savedSkillText('x', '# Tidy imports\n- Words: tidy the imports\n\n1. Sort them.')).toBe('## Tidy imports\n- Words: tidy the imports\n\n1. Sort them.\n');
  expect(savedSkillText('x', DEPLOY)).toBe(DEPLOY);
  const fm = savedSkillText('pdf', '---\nname: fill-pdf-forms\ndescription: "Fill a PDF form from a JSON file"\ntriggers: fill the pdf, pdf form\n---\n\n1. Read the fields.\n');
  expect(fm).toBe('## Fill pdf forms\n- Words: fill the pdf, pdf form\n- About: Fill a PDF form from a JSON file\n1. Read the fields.\n');
  // read back by the file's name, whatever its heading says
  writeSkillFile('ship', savedSkillText('ship', DEPLOY));
  writeSkillFile('empty', '## Empty\n- Words: nothing here\n');
  expect(savedSkills().map((s) => [s.slug, s.name, s.from])).toEqual([['ship', 'Deploy the site', 'saved']]);
});

test('every skill: SKILLS.md\'s, yours, then the app\'s own Save a skill, which is never listed; SKILLS.md keeps a name it has', () => {
  writeSkillFile('deploy-the-site', DEPLOY);
  writeSkillFile('write-a-test', '## Write a test\n- Words: mine\n\n1. Mine.\n'); // SKILLS.md has this name
  const all = readSkills();
  expect(all.map((s) => [s.slug, s.from ?? 'SKILLS.md'])).toEqual([['write-a-test', 'SKILLS.md'], ['deploy-the-site', 'saved'], ['save-a-skill', 'built-in']]);
  expect(readSkills(undefined, 'local', { saved: null }).map((s) => s.slug)).toEqual(['write-a-test', 'save-a-skill']);
  const list = skillsList(all);
  expect(list).toContain('- SKILLS/deploy-the-site: build, upload and check the site');
  expect(list).not.toContain('save-a-skill');
  // the prompt with no skills at all is as it was: no Skills part
  writeFileSync(join(rules, 'SKILLS.md'), '# Skills\n');
  rmSync(dir(), { recursive: true, force: true });
  expect(systemPrompt({ cwd: proj, git: 'none' })).not.toContain('\nSkills\n');
  expect(readSkillPath(proj, 'SKILLS').error).toContain('There are no skills');
});

test('a request\'s words bring a saved skill, or Save a skill; the note and Read say where it is kept', async () => {
  writeSkillFile('deploy-the-site', DEPLOY);
  const s = pickSkill('please deploy the site to the server');
  expect(s.slug).toBe('deploy-the-site');
  expect(skillNote(s)).toStartWith('Skill "Deploy the site" from your saved skills: this request uses its words');
  expect(pickSkill('great, save that as a skill').slug).toBe('save-a-skill');
  expect(pickSkill(saveSkillPrompt('deploy')).slug).toBe('save-a-skill');
  expect(pickSkill('fix the skill tree cooldown')).toBeNull(); // "skill" alone brings nothing
  expect(skillNote(SAVE_SKILL)).toContain('Write SKILLS/<name>');
  const r = await execute('Read', { path: 'SKILLS/deploy-the-site' }, {}, { cwd: proj });
  expect(r.text).toStartWith('SKILLS/deploy-the-site (Deploy the site):\n1. Run bun run build.');
  expect(r.text).toContain(`kept in ${join(dir(), 'deploy-the-site.md')} for every project: Edit SKILLS/deploy-the-site changes it.`);
  expect(r.readAbs).toBe(join(dir(), 'deploy-the-site.md'));
  expect(skillUses()['deploy-the-site'].n).toBe(1);
});

test('Write SKILLS/<name> saves a skill in the home, not the project; Edit changes it; SKILLS.md\'s and bad shapes are refused', async () => {
  const env = { cwd: proj };
  const w = prepare('Write', { path: 'SKILLS/Deploy the site', content: DEPLOY }, env);
  expect(w.error).toBeUndefined();
  expect([w.abs, w.rel, w.created, w.skill.slug]).toEqual([join(dir(), 'deploy-the-site.md'), 'SKILLS/deploy-the-site', true, 'deploy-the-site']);
  const out = await execute('Write', {}, w, { ...env, home: '/nowhere' });
  expect(out.text).toBe(`Saved the skill SKILLS/deploy-the-site ("Deploy the site", +${w.additions} −0 lines), kept in ${w.abs} for every project: any request that uses its words (deploy the site, ship it) brings its steps.`);
  expect(out.view.kind).toBe('diff');
  expect(readFileSync(w.abs, 'utf8')).toBe(DEPLOY);
  expect(existsSync(join(proj, 'SKILLS'))).toBe(false);
  // Edit of a saved one
  const e = prepare('Edit', { path: 'SKILLS/deploy-the-site', old_text: '2. Run ./upload.sh.', new_text: '2. Run ./upload.sh --prod.' }, env);
  expect(e.error).toBeUndefined();
  await execute('Edit', {}, e, env);
  expect(readFileSync(w.abs, 'utf8')).toContain('2. Run ./upload.sh --prod.');
  expect((await execute('Write', {}, prepare('Write', { path: 'SKILLS/deploy-the-site', content: '1. Just build.' }, env), env)).text).toStartWith('Updated the skill SKILLS/deploy-the-site ("Deploy the site"');
  // refused
  expect(prepare('Write', { path: 'SKILLS/write-a-test', content: '1. x' }, env).error).toContain('read-only');
  expect(prepare('Write', { path: 'SKILLS/save-a-skill', content: '1. x' }, env).error).toContain('read-only');
  expect(prepare('Edit', { path: 'SKILLS/nope', old_text: 'a', new_text: 'b' }, env).error).toContain('There is no saved skill SKILLS/nope');
  expect(prepare('Write', { path: 'SKILLS/two', content: '## One\n1. a\n## Two\n1. b\n' }, env).error).toContain('this has 2');
  expect(prepare('Write', { path: 'SKILLS/bare', content: '- Words: x\n' }, env).error).toContain('has no steps');
  expect(prepare('Write', { path: 'SKILLS/f', content: '- Fence: nope\n1. x' }, env).error).toContain('does not know (nope)');
  // a project with a SKILLS folder of its own keeps it: only Rules/SKILLS/<name> is a skill there
  mkdirSync(join(proj, 'SKILLS'));
  expect(prepare('Write', { path: 'SKILLS/a.md', content: 'mine' }, env).skill).toBeUndefined();
  expect(prepare('Write', { path: 'Rules/SKILLS/kept', content: '1. x' }, env).rel).toBe('Rules/SKILLS/kept');
});

test('the agent: a saved skill asks first even on Accept edits, lands in the home, and is not a change to the project (no test run after it)', async () => {
  writeFileSync(join(proj, 'package.json'), '{"type":"module","scripts":{"test":"node --test"}}');
  writeFileSync(join(proj, 'a.mjs'), 'export const a = 1;\n');
  const model = MODELS[DEFAULT_MODEL];
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'SKILLS/deploy-the-site', content: DEPLOY } } },
    { text: 'Saved the skill Deploy the site.' },
  ]);
  try {
    const asked = [];
    const agent = new Agent({ url: fake.url, model, cwd: proj, system: systemPrompt({ cwd: proj, git: 'none' }), memory: false, flows: false, mode: 'edits', verify: false, confirmPlan: false, ask: async (req) => { asked.push(req); return { choice: 'yes' }; } });
    const notes = [];
    agent.on('note', (e) => notes.push(e.text));
    await agent.send('save the deploy steps as a skill');
    expect(notes.some((t) => t.startsWith('Skill: Save a skill (Agentic Coder; its words here: as a skill'))).toBe(true);
    expect(asked.map((a) => [a.name, a.prepared.rel, a.once])).toEqual([['Write', 'SKILLS/deploy-the-site', true]]);
    expect(readFileSync(join(dir(), 'deploy-the-site.md'), 'utf8')).toBe(DEPLOY);
    expect(fake.requests.filter((r) => r.tools?.length).length).toBe(2); // no test run, no "nothing changed" sent it back
    expect(notes.some((t) => /no file changed|Running the tests/i.test(t))).toBe(false);
    expect(agent.messages.find((m) => m.role === 'tool').content).toStartWith('Saved the skill SKILLS/deploy-the-site');
    // the next message in any project brings it by its words
    const other = mkdtempSync(join(tmpdir(), 'agentic-skills-other-'));
    expect(pickSkill('ship it now', readSkills()).slug).toBe('deploy-the-site');
    expect(systemPrompt({ cwd: other, git: 'none' })).toContain('- SKILLS/deploy-the-site: build, upload and check the site');
  } finally { await fake.close(); }
});

test('/skills: the panel (yours, then SKILLS.md\'s, with uses), show, save sends the prompt, remove keeps the file, open', () => {
  writeSkillFile('deploy-the-site', DEPLOY);
  noteSkillUse('deploy-the-site', dir(), Date.UTC(2026, 9, 28, 12));
  const p = skillsPanel();
  expect(p.title).toBe('Skills · 1 saved · 1 in SKILLS.md · each comes with a request that uses its words');
  const lines = p.rows.map((r) => r.join(' | '));
  expect(lines[0]).toStartWith('Saved · ');
  expect(lines[1]).toBe('  deploy-the-site | build, upload and check the site · words: deploy the site, ship it · used 1 time, last 28 Oct');
  expect(lines[2]).toStartWith('SKILLS.md · read-only');
  expect(lines[3]).toBe('  write-a-test | add one test · words: add a test, write a test · not used yet');
  expect(lines.at(-1)).toBe(' | /skills save [name] · /skills show <name> · /skills remove <name> · /skills open');
  expect(lines.join('\n')).not.toContain('save-a-skill');
  const pushed = [];
  const sent = [];
  const self = { push: (m) => pushed.push(m), flash: (t) => pushed.push({ flash: t }), sendPrompt: (v, shown) => sent.push([v, shown]), agent: { messages: [{ role: 'system' }] } };
  skillsCommand(self, '', false);
  expect(pushed.at(-1).type).toBe('panel');
  skillsCommand(self, 'show Deploy the site', false);
  expect(pushed.at(-1).type).toBe('expand');
  expect(pushed.at(-1).text).toBe('Words: deploy the site, ship it\nAbout: build, upload and check the site\n\n1. Run bun run build.\n2. Run ./upload.sh.\n3. Open the address and check it loads.');
  skillsCommand(self, 'save', false);
  expect(pushed.at(-1).text).toStartWith('Nothing to save yet');
  self.agent.messages.push({ role: 'user', content: 'deploy' }, { role: 'assistant', content: 'done' });
  skillsCommand(self, 'save deploy', true);
  expect(pushed.at(-1).flash).toContain('Wait');
  skillsCommand(self, 'save deploy', false);
  expect(sent).toEqual([[saveSkillPrompt('deploy'), '/skills save deploy']]);
  skillsCommand(self, 'remove write-a-test', false);
  expect(pushed.at(-1).text).toContain('not one of your saved skills');
  skillsCommand(self, 'remove deploy-the-site', false);
  expect(pushed.at(-1).text).toStartWith('Removed deploy-the-site from your skills; the file is kept at ');
  expect(savedSkillFiles()).toEqual([]);
  expect(readdirSync(join(dir(), '.removed')).length).toBe(1);
  process.env.AGENTIC_NO_OPEN = '1';
  skillsCommand(self, 'open', false);
  expect(pushed.at(-1).text).toContain('one .md file each');
});
