// The Prompt files (30 Sep 2026): TOOLS.md and SKILLS.md in terminal/rules/, and
// the hub's Instructions tabs 06–08 that save them and a folder's AGENTS.md.
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, symlinkSync, lstatSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A throwaway home BEFORE the models part is first imported (it reads AGENTIC_HOME once):
// nothing here may reach the real ~/.agentic-coder.
const FIRST_HOME = mkdtempSync(join(tmpdir(), 'agentic-prompt-files-home-'));
process.env.AGENTIC_HOME = FIRST_HOME;
const { parseSkills, pickSkill, skillProblems, skillsList, skillNote, toolUseText, readSkillPath, readPromptFile, TOOL_USE_OLD, BUILT_IN } = await import('../src/agent/prompt-files.mjs');
const { systemPrompt, SESSION_MARK } = await import('../src/agent/prompt.mjs');
const { wayPrompt, MODEL_TOOL_LINES, ONE_AT_A_TIME } = await import('../src/agent/way.mjs');
const { prepare, execute } = await import('../src/agent/tools.mjs');
const { filesData, saveFile, validateFile, trySkill, AGENTS_STARTER } = await import('../src/app/prompt-files-hub.mjs');
const { instructionsData } = await import('../src/app/instructions-hub.mjs');
const { startWeightsServer } = await import('../src/app/weights.mjs');
const { sortLine } = await import('../src/flows/words.mjs');
const { Agent } = await import('../src/agent/agent.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL, HOME } = await import('../../models/index.mjs');

const SOURCE = new URL('../rules/', import.meta.url).pathname;
const SKILLS = `# Skills

Intro text. A \`## Name\` inside a line is not a skill.

## Write a test
- Words: add a test, write a test, a test for, unit test
- About: add a test for one behaviour and run just that test file

1. Find the tests.
2. Run only that test file.

<!--
## Hidden
- Words: hidden
1. never read
-->

## Explain a file
- Words: explain, walk me through
- About: explain one file

1. Read it whole first.
`;

let rules, state, proj, saved;
beforeEach(() => {
  saved = { rules: process.env.AGENTIC_RULES_DIR, home: process.env.AGENTIC_HOME };
  const root = mkdtempSync(join(tmpdir(), 'agentic-prompt-files-'));
  rules = join(root, 'rules'); state = join(root, 'state'); proj = join(root, 'proj');
  for (const d of [rules, state, proj]) mkdirSync(d);
  copyFileSync(join(SOURCE, 'bug-fixing.md'), join(rules, 'bug-fixing.md'));
  copyFileSync(join(SOURCE, 'TOOLS.md'), join(rules, 'TOOLS.md'));
  writeFileSync(join(rules, 'SKILLS.md'), SKILLS);
  process.env.AGENTIC_RULES_DIR = rules;
  process.env.AGENTIC_HOME = state;
});
afterEach(() => {
  for (const [k, v] of [['AGENTIC_RULES_DIR', saved.rules], ['AGENTIC_HOME', saved.home]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

test('as shipped, TOOLS.md and SKILLS.md change nothing: the Tool use lines as before and no skill on (the example is switched off)', () => {
  expect(parseSkills(BUILT_IN.skills)).toEqual([]);
  expect(BUILT_IN.skills).toContain('<!--\n## Write a test');
  expect(parseSkills(BUILT_IN.skills.replace('<!--\n## Write', '## Write').replace(/\n-->\n$/, '\n')).map((s) => s.name)).toEqual(['Write a test']);
  expect(toolUseText(BUILT_IN.tools)).toBe(TOOL_USE_OLD);
  expect(HOME).toBe(FIRST_HOME); // the models part took the throwaway home, not ~/.agentic-coder
});

test('SKILLS.md: each "## Name" is a skill with its Words, About and steps; a commented one is left out', () => {
  const s = parseSkills(SKILLS);
  expect(s.map((x) => [x.name, x.slug])).toEqual([['Write a test', 'write-a-test'], ['Explain a file', 'explain-a-file']]);
  expect(s[0].words).toEqual(['add a test', 'write a test', 'a test for', 'unit test']);
  expect(s[0].about).toBe('add a test for one behaviour and run just that test file');
  expect(s[0].body).toBe('1. Find the tests.\n2. Run only that test file.');
  expect(skillProblems(s)).toEqual({ errors: [], warnings: [] });
  const bad = skillProblems(parseSkills('## A b\n1. x\n## a-b\n- Words: y\n'));
  expect(bad.errors.join(' ')).toContain('both open as SKILLS/a-b');
  expect(bad.errors.join(' ')).toContain('has no steps');
  expect(bad.warnings.join(' ')).toContain('no Words line');
});

test('a skill is picked by its words, a phrase counting twice; a clarifying question is not the user\'s words; none is null', () => {
  const s = parseSkills(SKILLS);
  const p = pickSkill('add a test for the total in cart.mjs', s);
  expect(p.name).toBe('Write a test');
  expect(p.matched).toEqual(['add a test', 'a test for']);
  expect(p.score).toBe(4);
  expect(pickSkill('walk me through server.mjs', s).name).toBe('Explain a file');
  expect(pickSkill('run the tests', s)).toBeNull(); // "test" alone is no Words line
  expect(pickSkill('yes\n\n(This answers the question "explain what?" about the request: fix it)', s)).toBeNull();
  expect(skillNote(p)).toBe('Skill "Write a test" from SKILLS.md: this request uses its words, so follow its steps:\n1. Find the tests.\n2. Run only that test file.');
});

test('the instructions: TOOLS.md is the Tool use part word for word, the skills list sits before This session; the old prompt keeps both as they were', () => {
  expect(toolUseText()).toBe(TOOL_USE_OLD); // the shipped TOOLS.md changes nothing
  const p = systemPrompt({ cwd: proj, git: 'none', date: new Date(2026, 8, 30) });
  expect(p).toContain(`Tool use\n${TOOL_USE_OLD}\n\nSkills\n`);
  expect(p).toContain('- SKILLS/write-a-test: add a test for one behaviour and run just that test file\n- SKILLS/explain-a-file: explain one file');
  expect(p.indexOf('\nSkills\n')).toBeLessThan(p.indexOf('\nWork habits\n'));
  expect(p.indexOf('\nSkills\n')).toBeLessThan(p.indexOf(SESSION_MARK));
  expect(p).not.toContain('Find the tests.'); // the steps come only with a request
  writeFileSync(join(rules, 'TOOLS.md'), '# Tools\n\n## Tool use\n- Search before you read.\n');
  writeFileSync(join(rules, 'SKILLS.md'), '# Skills\n');
  const q = systemPrompt({ cwd: proj, git: 'none' });
  expect(q).toContain('Tool use\n- Search before you read.\n\nWork habits');
  expect(q).not.toContain('\nSkills\n');
  // a TOOLS.md without the section: the built-in lines
  writeFileSync(join(rules, 'TOOLS.md'), '# Tools\n');
  expect(toolUseText()).toBe(TOOL_USE_OLD);
  const old = process.env.AGENTIC_PROMPT;
  process.env.AGENTIC_PROMPT = 'old';
  try {
    writeFileSync(join(rules, 'TOOLS.md'), '# Tools\n\n## Tool use\n- Changed.\n');
    writeFileSync(join(rules, 'SKILLS.md'), SKILLS);
    const o = systemPrompt({ cwd: proj, git: 'none' });
    expect(o).toContain(`Tool use\n${TOOL_USE_OLD}\n\n`);
    expect(o).not.toContain('SKILLS/');
  } finally { if (old === undefined) delete process.env.AGENTIC_PROMPT; else process.env.AGENTIC_PROMPT = old; }
});

test('the file on disk is read at each use; without one, the copy built into the app', () => {
  expect(readPromptFile('skills')).toMatchObject({ from: 'disk', text: SKILLS });
  process.env.AGENTIC_RULES_DIR = join(rules, 'nowhere');
  expect(readPromptFile('skills')).toMatchObject({ from: 'built-in', text: BUILT_IN.skills });
  expect(BUILT_IN.tools).toContain('## Tool use');
});

test('Read SKILLS/<name> opens one skill and SKILLS the list; they are read-only; a project\'s own SKILLS.md is an ordinary file', async () => {
  expect(readSkillPath(proj, 'SKILLS/write-a-test').text).toBe('SKILLS/write-a-test (Write a test):\n1. Find the tests.\n2. Run only that test file.');
  expect(readSkillPath(proj, './SKILLS/Write a test.md').text).toContain('(Write a test)');
  expect(readSkillPath(proj, 'SKILLS').text).toContain('- SKILLS/explain-a-file');
  expect(readSkillPath(proj, 'SKILLS/nope').error).toContain('The skills: SKILLS/write-a-test, SKILLS/explain-a-file.');
  expect(readSkillPath(proj, 'SKILLS.md')).toBeNull();
  expect(readSkillPath(proj, 'src/SKILLS/x')).toBeNull();
  const r = await execute('Read', { path: 'SKILLS/explain-a-file' }, {}, { cwd: proj });
  expect(r.error).toBeUndefined();
  expect(r.text).toContain('1. Read it whole first.');
  expect(prepare('Write', { path: 'SKILLS/new', content: 'x' }, { cwd: proj }).error).toContain('read-only');
  expect(prepare('Write', { path: 'SKILLS.md', content: '# mine\n' }, { cwd: proj }).error).toBeUndefined();
  // a project with a SKILLS folder of its own keeps it
  mkdirSync(join(proj, 'SKILLS'));
  writeFileSync(join(proj, 'SKILLS', 'a.md'), 'the project\'s own');
  expect(readSkillPath(proj, 'SKILLS/a.md')).toBeNull();
  expect((await execute('Read', { path: 'SKILLS/a.md' }, {}, { cwd: proj })).text).toContain("the project's own");
});

test('Who decides Model: with the one-at-a-time line it is swapped; without it the model\'s lines go at the end of Tool use, and back takes them out', () => {
  const app = systemPrompt({ cwd: proj, git: 'none' });
  const model = wayPrompt(app, 'model');
  expect(model).toContain(MODEL_TOOL_LINES);
  expect(model).not.toContain(ONE_AT_A_TIME);
  expect(wayPrompt(model, 'app')).toBe(app);
  writeFileSync(join(rules, 'TOOLS.md'), '# Tools\n\n## Tool use\n- Search before you read.\n');
  const app2 = systemPrompt({ cwd: proj, git: 'none' });
  const model2 = wayPrompt(app2, 'model');
  expect(model2).toContain(`Tool use\n- Search before you read.\n${MODEL_TOOL_LINES}\n\nSkills\n`);
  expect(wayPrompt(model2, 'app')).toBe(app2);
});

test('the Try line and the sorted line name the skill', () => {
  expect(trySkill('please add a test for totals', SKILLS).skill).toMatchObject({ name: 'Write a test', matched: ['add a test', 'a test for'] });
  expect(trySkill('hello', SKILLS).skill).toBeNull();
  expect(() => trySkill('  ')).toThrow('Type a request first.');
  expect(sortLine('change', { skill: 'Write a test' })).toBe('Sorted as: change · skill "Write a test" · step by step');
});

test('saving: AGENTS.md is made in the folder, a stale revision is refused, Undo puts back the text before, or removes a file the save made', () => {
  let d = filesData(proj);
  expect(d.files.agents).toMatchObject({ exists: false, text: '', starter: AGENTS_STARTER, undoCount: 0 });
  const a = saveFile('agents', proj, '# Rules\r\n\r\n- Use tabs.   \n\n', d.files.agents.revision);
  expect(readFileSync(join(proj, 'AGENTS.md'), 'utf8')).toBe('# Rules\n\n- Use tabs.\n');
  expect(a).toMatchObject({ exists: true, undoCount: 1, gets: { status: 'whole', left: [] } });
  expect(() => saveFile('agents', proj, '# Other\n', d.files.agents.revision)).toThrow('changed on disk since this page read it');
  writeFileSync(join(proj, 'AGENTS.md'), '# Changed in an editor\n');
  expect(() => saveFile('agents', proj, '# Mine\n', a.revision)).toThrow('changed on disk');
  d = filesData(proj);
  const b = saveFile('agents', proj, '# Mine\n', d.files.agents.revision);
  expect(b.undoCount).toBe(2);
  const u1 = saveFile('agents', proj, null, b.revision, { undo: true });
  expect(readFileSync(join(proj, 'AGENTS.md'), 'utf8')).toBe('# Changed in an editor\n');
  const u2 = saveFile('agents', proj, null, u1.revision, { undo: true });
  expect(existsSync(join(proj, 'AGENTS.md'))).toBe(false); // the first save made it
  expect(() => saveFile('agents', proj, null, u2.revision, { undo: true })).toThrow('no earlier AGENTS.md');
});

test('saving TOOLS.md and SKILLS.md: what their readers need, the limits, and a link stays a link', () => {
  expect(() => validateFile('tools', '# Tools\nno section\n')).toThrow('## Tool use');
  expect(() => validateFile('tools', '## Tool use\n- a\nThis session\n')).toThrow('a heading the instructions are cut by');
  expect(() => validateFile('tools', `## Tool use\n${'x'.repeat(4001)}`)).toThrow('the most is 4,000');
  expect(() => validateFile('skills', '## A\n- Words: a\n1. x\n## a\n- Words: b\n1. y\n')).toThrow('both open as SKILLS/a');
  expect(() => validateFile('agents', '   \n')).toThrow('is empty');
  expect(() => validateFile('agents', 'bad\u0001')).toThrow('control characters');
  expect(() => validateFile('nope', 'x')).toThrow('Pick AGENTS.md');
  const d = filesData(proj);
  expect(d.files.tools).toMatchObject({ exists: true, fromDisk: true, toolUse: TOOL_USE_OLD, oneAtATime: true });
  expect(d.files.skills.skills.map((s) => s.slug)).toEqual(['write-a-test', 'explain-a-file']);
  const t = saveFile('tools', proj, '# Tools\n\n## Tool use\n- Search first.\n', d.files.tools.revision);
  expect(t).toMatchObject({ toolUse: '- Search first.', oneAtATime: false });
  expect(toolUseText()).toBe('- Search first.');
  // AGENTS.md that is a link to a shared file: the shared file changes, the link stays
  writeFileSync(join(proj, 'shared.md'), '# Shared\n');
  symlinkSync(join(proj, 'shared.md'), join(proj, 'AGENTS.md'));
  const info = filesData(proj).files.agents;
  saveFile('agents', proj, '# Shared, edited\n', info.revision);
  expect(lstatSync(join(proj, 'AGENTS.md')).isSymbolicLink()).toBe(true);
  expect(readFileSync(join(proj, 'shared.md'), 'utf8')).toBe('# Shared, edited\n');
});

test('AGENTS.md says when this folder\'s CLAUDE.md is what is read today, and when it is the home folder\'s', () => {
  writeFileSync(join(proj, 'CLAUDE.md'), '# Claude rules\n- Be brief.\n');
  expect(filesData(proj).files.agents.claude).toEqual({ chars: 27, pointer: false, read: true });
  writeFileSync(join(proj, 'CLAUDE.md'), '@AGENTS.md\n');
  expect(filesData(proj).files.agents.claude.read).toBe(false);
  expect(filesData(proj).files.agents.home).toBe(false);
});

test('the hub: files.json, save and undo over HTTP; another site is refused; a folder it was never used in is not written', async () => {
  writeFileSync(join(proj, 'AGENTS.md'), '# Before\n');
  const s = startWeightsServer({ path: null, docsDir: null, port: 0, cwd: proj, instructionsHome: state });
  const post = (route, data, extra = {}) => fetch(s.url + route, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(data) });
  try {
    const page = await (await fetch(`${s.url}instructions`)).text();
    for (const id of ['tab-agents', 'tab-tools', 'tab-skills', 'skill-try']) expect(page).toContain(`id="${id}"`);
    const d = await (await fetch(`${s.url}instructions/files.json`)).json();
    expect(d.files.agents.text).toBe('# Before\n');
    const body = { file: 'agents', text: '# After\n', revision: d.files.agents.revision };
    expect((await post('instructions/files/save', body, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await post('instructions/files/save', { ...body, file: '../x' })).status).toBe(400);
    expect((await post('instructions/files/save', { ...body, pad: 'x'.repeat(400_001) })).status).toBe(413);
    // a folder not in the list: the hub's own folder is used, never the one named
    const elsewhere = mkdtempSync(join(tmpdir(), 'agentic-elsewhere-'));
    const r = await post('instructions/files/save', { ...body, folder: elsewhere });
    expect(r.status).toBe(200);
    expect(existsSync(join(elsewhere, 'AGENTS.md'))).toBe(false);
    expect(readFileSync(join(proj, 'AGENTS.md'), 'utf8')).toBe('# After\n');
    const after = await r.json();
    expect(after.saved).toBe('agents');
    expect((await post('instructions/files/save', body)).status).toBe(409); // stale
    // the preview reads the new file
    expect((await (await fetch(`${s.url}instructions.json`)).json()).preview).toContain('# After');
    const u = await post('instructions/files/undo', { file: 'agents', revision: after.files.agents.revision });
    expect(u.status).toBe(200);
    expect(readFileSync(join(proj, 'AGENTS.md'), 'utf8')).toBe('# Before\n');
    const t = await (await post('instructions/files/try', { request: 'walk me through app.mjs', text: SKILLS })).json();
    expect(t.skill.name).toBe('Explain a file');
    // the preview's parts: Tool use and the skills list are yours now
    const parts = instructionsData(proj, state, {}).cost.parts;
    expect(parts.find((p) => p.id === 'tooluse')).toMatchObject({ group: 'yours', edit: 'tools', from: 'terminal/rules/TOOLS.md, tab 07' });
    expect(parts.find((p) => p.id === 'skills')).toMatchObject({ group: 'yours', edit: 'skills', kept: 'disk' });
  } finally { s.stop(); }
});

test('the agent: a skill\'s steps go with the request and the focused paths are skipped; Model gets only the list; a save between messages is read', async () => {
  writeFileSync(join(proj, 'cart.mjs'), 'export const total = (xs) => xs.reduce((a, b) => a + b, 0);\n');
  writeFileSync(join(proj, 'package.json'), '{"type":"module","scripts":{"test":"node --test"}}');
  const model = MODELS[DEFAULT_MODEL];
  const fake = await startFakeServer([], { delayMs: 0, route: (req) => (req.tools?.length ? (req.messages.some((m) => m.role === 'tool') ? { text: 'Done.' } : { tool: { name: 'Read', args: { path: 'SKILLS/write-a-test' } } }) : { text: '{}' }) });
  try {
    const agent = new Agent({ url: fake.url, model, cwd: proj, system: systemPrompt({ cwd: proj, git: 'none' }), memory: false, flows: true, mode: 'edits', verify: false });
    const seen = [];
    agent.on('sorted', (e) => seen.push(e.text));
    agent.on('note', (e) => seen.push(e.text));
    await agent.send('add a test for the total in cart.mjs');
    expect(seen).toContain('Sorted as: change · skill "Write a test" · step by step');
    expect(seen.some((t) => t.startsWith('Skill: Write a test (SKILLS.md; its words here: add a test, a test for;'))).toBe(true);
    const loop = fake.requests.filter((r) => r.tools?.length);
    expect(loop.length).toBeGreaterThan(0);
    const asked = loop[0].messages.findLast((m) => m.role === 'user').content;
    expect(asked).toContain('add a test for the total in cart.mjs\n\n(Skill "Write a test" from SKILLS.md: this request uses its words, so follow its steps:\n1. Find the tests.');
    expect(loop[0].messages[0].content).toContain('- SKILLS/write-a-test:');
    expect(fake.requests.some((r) => r.response_format?.type === 'json_schema' && /test first|failing test/i.test(JSON.stringify(r.messages)))).toBe(false);
    // the model opened the skill with Read: the steps came back as the tool's result
    const result = agent.messages.find((m) => m.role === 'tool');
    expect(result.content).toContain('SKILLS/write-a-test (Write a test):');
    // a save between messages: the next message reads it
    writeFileSync(join(rules, 'SKILLS.md'), `${SKILLS}\n## Tidy imports\n- Words: tidy the imports\n- About: sort and dedupe imports\n\n1. Sort them.\n`);
    await agent.send('thanks');
    expect(seen).toContain('Updated prompt files loaded (AGENTS.md, TOOLS.md, SKILLS.md).');
    expect(agent.messages[0].content).toContain('- SKILLS/tidy-imports: sort and dedupe imports');
    // Model: only the list, no steps with the request
    const m = new Agent({ url: fake.url, model, cwd: proj, system: systemPrompt({ cwd: proj, git: 'none' }), memory: false, flows: true, mode: 'edits', verify: false, way: 'model' });
    const before = fake.requests.length;
    await m.send('add a test for the total in cart.mjs');
    const mine = fake.requests.slice(before).filter((r) => r.tools?.length);
    expect(mine[0].messages[0].content).toContain('- SKILLS/write-a-test:');
    expect(mine[0].messages.findLast((m) => m.role === 'user').content).not.toContain('Skill "Write a test"');
  } finally { await fake.close(); }
});
