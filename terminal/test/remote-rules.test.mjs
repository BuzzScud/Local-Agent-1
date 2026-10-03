// The remote set of prompt files (2 Oct 2026): terminal/rules/remote/ for a model on another
// machine: HARNESS.md, its TOOLS.md and SKILLS.md, and nine guides it opens by name.
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, cpSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A throwaway home BEFORE the models part is first imported (it reads AGENTIC_HOME once).
const FIRST_HOME = mkdtempSync(join(tmpdir(), 'agentic-remote-rules-home-'));
process.env.AGENTIC_HOME = FIRST_HOME;
const PF = await import('../src/agent/prompt-files.mjs');
const { rulesSetOf, savedInstructions, readPromptFile, readGuides, guidesList, readGuidePath, harnessOf, toolUseFor, toolUseText, readSkills, GUIDES, BUILT_IN_REMOTE } = PF;
const { systemPrompt, promptSetOf, SESSION_MARK } = await import('../src/agent/prompt.mjs');
const { wayPrompt, MODEL_TOOL_LINES, ANSWER_HABIT } = await import('../src/agent/way.mjs');
const { prepare, execute } = await import('../src/agent/tools.mjs');
const { permissionsTable, decide, MODES } = await import('../src/agent/permissions.mjs');
const { fileInfo, validateFile, saveFile, FILES } = await import('../src/app/prompt-files-hub.mjs');
const { LIMITS } = await import('../src/app/limits.mjs');
const { instructionsRoute } = await import('../src/app/instructions-hub.mjs');
const { Agent } = await import('../src/agent/agent.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL, HOME } = await import('../../models/index.mjs');

// The settings.json these tests write and delete is only ever in this file's own throwaway home, or the
// one the preload made for this process (3 Oct 2026: in one process after a file that had loaded the
// models part first, HOME was the real ~/.agentic-coder, and the delete after each test took the real
// settings.json while every test here passed).
const own = HOME === FIRST_HOME || (Boolean(process.env.AGENTIC_TEST_HOME) && HOME === process.env.AGENTIC_TEST_HOME);
const SETTINGS = () => { if (!own) throw new Error(`not this test's own throwaway home: ${HOME}`); return join(HOME, 'settings.json'); };
test('the settings file these tests change is in their own throwaway home', () => { expect(own).toBe(true); });

const SOURCE = new URL('../rules/', import.meta.url).pathname;
const local = MODELS[DEFAULT_MODEL];
const remote = { ...local, remote: { model: 'big-coder' } };

let rules, state, proj, saved;
beforeEach(() => {
  saved = { rules: process.env.AGENTIC_RULES_DIR, home: process.env.AGENTIC_HOME, set: process.env.AGENTIC_INSTRUCTIONS };
  const root = mkdtempSync(join(tmpdir(), 'agentic-remote-rules-'));
  rules = join(root, 'rules'); state = join(root, 'state'); proj = join(root, 'proj');
  cpSync(SOURCE, rules, { recursive: true });
  for (const d of [state, proj]) mkdirSync(d);
  process.env.AGENTIC_RULES_DIR = rules;
  process.env.AGENTIC_HOME = state;
  delete process.env.AGENTIC_INSTRUCTIONS;
});
afterEach(() => {
  if (own) try { unlinkSync(join(HOME, 'settings.json')); } catch {}
  for (const [k, v] of [['AGENTIC_RULES_DIR', saved.rules], ['AGENTIC_HOME', saved.home], ['AGENTIC_INSTRUCTIONS', saved.set]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

test('which set: auto takes the remote one for a model on another machine; settings.json or AGENTIC_INSTRUCTIONS can force either', () => {
  expect(savedInstructions()).toBe('auto');
  writeFileSync(SETTINGS(), JSON.stringify({ instructions: 'local' }));
  expect(savedInstructions()).toBe('local');
  expect(rulesSetOf(null, remote, {})).toBe('local'); // the saved choice
  expect(rulesSetOf(null, remote, { AGENTIC_INSTRUCTIONS: 'auto' })).toBe('remote'); // the env wins over it
  writeFileSync(SETTINGS(), JSON.stringify({ instructions: 'nonsense' }));
  expect(savedInstructions()).toBe('auto');
  writeFileSync(SETTINGS(), '{');
  expect(savedInstructions()).toBe('auto');
  expect(rulesSetOf('auto', local, {})).toBe('local');
  expect(rulesSetOf('auto', remote, {})).toBe('remote');
  expect(rulesSetOf(undefined, remote, {})).toBe('remote'); // no saved choice: auto
  expect(rulesSetOf('local', remote, {})).toBe('local');
  expect(rulesSetOf('remote', local, {})).toBe('remote');
  expect(rulesSetOf('auto', remote, { AGENTIC_INSTRUCTIONS: 'local' })).toBe('local');
  expect(rulesSetOf('local', local, { AGENTIC_INSTRUCTIONS: 'remote' })).toBe('remote');
});

test('the local instructions are the same with the remote set beside them, letter for letter', () => {
  const d = new Date('2026-10-02T12:00:00');
  const plain = systemPrompt({ cwd: proj, notes: 'N', git: 'g', date: d });
  expect(systemPrompt({ cwd: proj, notes: 'N', git: 'g', date: d, set: 'local' })).toBe(plain);
  expect(plain).toContain('\nWork habits\n');
  expect(plain).not.toContain('\nHow you work\n');
  expect(plain).not.toContain('\nGuides\n');
  expect(promptSetOf(plain)).toBe('local');
  // the old prompt (AGENTIC_PROMPT=old) is the local one whatever the set says
  process.env.AGENTIC_PROMPT = 'old';
  try { expect(systemPrompt({ cwd: proj, notes: 'N', git: 'g', date: d, set: 'remote' })).toBe(systemPrompt({ cwd: proj, notes: 'N', git: 'g', date: d })); } finally { delete process.env.AGENTIC_PROMPT; }
});

test('the remote instructions: HARNESS.md\'s parts, the remote Tool use, the guides and skills listed, the stay rule and this session as on this Mac', () => {
  const d = new Date('2026-10-02T12:00:00');
  const p = systemPrompt({ cwd: proj, notes: 'N', git: 'g', date: d, set: 'remote' });
  const h = harnessOf();
  expect(p.startsWith(h.who)).toBe(true);
  expect(p).toContain(`\nHow you work\n${h.how}\n`);
  expect(p).toContain(`\nTool use\n${toolUseFor('remote')}\n`);
  expect(toolUseFor('remote')).not.toBe(toolUseText());
  expect(p).toContain(`Guides\n${h.guides}\n- RULES/PLANNING.md: for a task with three or more steps`);
  for (const g of GUIDES.filter((x) => x !== 'SUBAGENTS')) expect(p).toContain(`- RULES/${g}.md: `);
  expect(p).not.toContain('RULES/SUBAGENTS.md'); // no Agent tool offered
  expect(p).toContain('- SKILLS/review-code: read a change or a file and report real problems, most serious first');
  expect(p).toContain(h.rules);
  expect(p).toContain('- Stay inside the project folder.');
  expect(p).not.toContain('\nWork habits\n');
  expect(p).not.toContain('\nFixing a bug\n');
  const session = (x) => x.slice(x.indexOf(SESSION_MARK));
  expect(session(p)).toBe(session(systemPrompt({ cwd: proj, notes: 'N', git: 'g', date: d })));
  expect(promptSetOf(p)).toBe('remote');
  // with the Agent tool, the helpers guide is listed
  expect(systemPrompt({ cwd: proj, git: 'g', set: 'remote', agents: true })).toContain('- RULES/SUBAGENTS.md: before you hand work to a helper with the Agent tool');
});

test('a file missing from the remote folder: TOOLS and SKILLS fall back to the local file, HARNESS to its built-in copy, a guide is left out', () => {
  writeFileSync(join(rules, 'TOOLS.md'), '# Tools\n\n## Tool use\n\n- LOCAL LINE\n- Call one tool at a time and wait for its result.\n');
  unlinkSync(join(rules, 'remote', 'TOOLS.md'));
  expect(toolUseFor('remote')).toBe('- LOCAL LINE\n- Call one tool at a time and wait for its result.');
  unlinkSync(join(rules, 'remote', 'SKILLS.md'));
  expect(readSkills(undefined, 'remote')).toEqual(readSkills());
  unlinkSync(join(rules, 'remote', 'HARNESS.md'));
  expect(readPromptFile('harness', rules, 'remote')).toMatchObject({ from: 'built-in', set: 'remote' });
  expect(harnessOf().who).toContain('You are Agentic Coder');
  unlinkSync(join(rules, 'remote', 'GIT.md'));
  expect(readGuides('remote').map((g) => g.name)).not.toContain('GIT');
  expect(systemPrompt({ cwd: proj, git: 'g', set: 'remote' })).not.toContain('RULES/GIT.md');
  // a HARNESS.md on disk without one of its parts: that part from the built-in copy
  writeFileSync(join(rules, 'remote', 'HARNESS.md'), '# H\n\n## Who you are\n\nYou are a test harness.\n');
  expect(harnessOf()).toMatchObject({ who: 'You are a test harness.' });
  expect(harnessOf().how).toBe(PF.sectionOf(BUILT_IN_REMOTE.harness, 'How you work'));
  // an edit shows on the next read
  writeFileSync(join(rules, 'remote', 'PLANNING.md'), '# P\n\nRead this when it is a big job.\n\n## Plan\n\n1. Plan it.\n');
  expect(readGuides('remote').find((g) => g.name === 'PLANNING')).toEqual({ name: 'PLANNING', about: 'when it is a big job', body: '## Plan\n\n1. Plan it.' });
});

test('the local set has no guides, so RULES/ is the project\'s own folder there', () => {
  expect(readGuides('local')).toEqual([]);
  expect(guidesList([])).toBe('');
  expect(readGuidePath(proj, 'RULES/GIT.md', [])).toBeNull();
});

test('Read RULES/<NAME>.md opens a guide (any case, with or without .md), RULES the list; they are read-only; a project RULES folder moves them to Rules/RULES', async () => {
  const env = { cwd: proj, rulesSet: 'remote', agents: false };
  const one = await execute('Read', { path: 'RULES/GIT.md' }, null, env);
  expect(one.text.startsWith('RULES/GIT.md:\n## Shared folders')).toBe(true);
  expect((await execute('Read', { path: 'RULES/testing' }, null, env)).text.startsWith('RULES/TESTING.md:\n## Check a change')).toBe(true);
  expect((await execute('Read', { path: 'RULES' }, null, env)).text).toContain('- RULES/REVIEW.md:');
  const none = await execute('Read', { path: 'RULES/SUBAGENTS.md' }, null, env);
  expect(none.error).toBe(true);
  expect(none.text).toContain('No guide RULES/SUBAGENTS');
  expect((await execute('Read', { path: 'RULES/SUBAGENTS.md' }, null, { ...env, agents: true })).text).toContain('## Hand work to a helper');
  expect(prepare('Edit', { path: 'RULES/GIT.md', old_text: 'a', new_text: 'b' }, env).error).toContain("one of the user's guides");
  expect(prepare('Write', { path: 'RULES/NEW.md', content: 'x' }, env).error).toContain("one of the user's guides");
  // on the local set it is just a path in the project
  expect((await execute('Read', { path: 'RULES/GIT.md' }, null, { cwd: proj, rulesSet: 'local' })).text).toContain('File not found');
  // a project with a RULES folder of its own keeps it: the guides open at Rules/RULES
  mkdirSync(join(proj, 'RULES'));
  writeFileSync(join(proj, 'RULES', 'GIT.md'), 'the project\'s own\n');
  expect(systemPrompt({ cwd: proj, git: 'g', set: 'remote' })).toContain('- Rules/RULES/GIT.md:');
  expect((await execute('Read', { path: 'RULES/GIT.md' }, null, env)).text).toContain("the project's own");
  expect((await execute('Read', { path: 'Rules/RULES/GIT.md' }, null, env)).text.startsWith('Rules/RULES/GIT.md:\n## Shared folders')).toBe(true);
  // remote skills open on the remote set, and not on the local one
  expect((await execute('Read', { path: 'SKILLS/review-code' }, null, env)).text.startsWith('SKILLS/review-code (Review code):')).toBe(true);
  expect((await execute('Read', { path: 'SKILLS/review-code' }, null, { cwd: proj, rulesSet: 'local' })).error).toBe(true);
});

test('Who decides Model on the remote set: the model\'s tool lines replace the last line, its answer habit goes after How you work, and back again', () => {
  const p = systemPrompt({ cwd: proj, git: 'g', set: 'remote' });
  const m = wayPrompt(p, 'model');
  expect(m).toContain(MODEL_TOOL_LINES);
  expect(m).not.toContain('- Call one tool at a time and wait for its result.');
  expect(m).toContain(`${harnessOf().how}\n${ANSWER_HABIT}\n`);
  expect(wayPrompt(m, 'app')).toBe(p);
});

test('the agent: a remote model gets the remote set from its first message; a switch to this Mac goes back, with a note; a helper keeps the prompt it was given', async () => {
  writeFileSync(join(proj, 'package.json'), '{"type":"module","scripts":{"test":"node --test"}}');
  const fake = await startFakeServer([], { delayMs: 0, route: (req) => (req.tools?.length ? { text: 'Done.' } : { text: '{}' }) });
  try {
    const sys = systemPrompt({ cwd: proj, git: 'none' });
    const a = new Agent({ url: fake.url, model: remote, cwd: proj, system: sys, memory: false, flows: false, verify: false });
    expect(a.rulesSetUsed).toBe('remote');
    expect(a.messages[0].content).toContain('\nHow you work\n');
    const notes = [];
    a.on('note', (e) => notes.push(e.text));
    await a.send('hello there, what is in this folder?');
    const asked = fake.requests.filter((r) => r.tools?.length);
    expect(asked[0].messages[0].content).toContain('- RULES/TESTING.md:');
    expect(notes.some((t) => /instructions/i.test(t))).toBe(false); // nothing changed, so nothing said
    // the model is now one on this Mac: the next message reads the local set, and says so
    a.model = local;
    await a.send('and now?');
    expect(notes).toContain('Local instructions (terminal/rules), as on this Mac.');
    expect(fake.requests.filter((r) => r.tools?.length).at(-1).messages[0].content).toContain('\nWork habits\n');
    // "remote" saved in settings.json (the hub's tab 09): the next message reads the remote set, and says so
    writeFileSync(SETTINGS(), JSON.stringify({ instructions: 'remote' }));
    await a.send('and once more?');
    expect(a.rulesSetUsed).toBe('remote');
    expect(notes).toContain('Remote instructions (terminal/rules/remote): HARNESS.md, TOOLS.md, the guides and the skills, for a model on another machine.');
    // a switch of model is said at once when the app moves its limits (syncRules)
    unlinkSync(SETTINGS()); a.syncRules();
    expect(a.rulesSetUsed).toBe('local');
    expect(notes.at(-1)).toBe('Local instructions (terminal/rules), as on this Mac.');
    a.instructionsSet = 'remote'; a.syncRules();
    // a helper is handed its parent's set (runHelper), so the remote prompt it was given is kept on a model of this Mac
    const helperPrompt = `${a.messages[0].content}\nYou are a helper.`;
    const h = new Agent({ url: fake.url, model: local, cwd: proj, system: helperPrompt, memory: false, flows: false, verify: false, instructions: a.rulesSet() });
    expect(h.rulesSetUsed).toBe('remote');
    expect(h.messages[0].content).toBe(helperPrompt);
    // (without it, auto would take the local set for that model and build the prompt again)
    expect(new Agent({ url: fake.url, model: local, cwd: proj, system: helperPrompt, memory: false, flows: false, verify: false }).messages[0].content).not.toContain('You are a helper.');
    // a practice run without the memory never reads it in a rebuild
    expect(a.notesFrom()).toEqual({ memory: false, home: undefined });
  } finally { await fake.close(); }
});

test('the remote skills come with a request whose words they use, from the remote SKILLS.md', async () => {
  writeFileSync(join(proj, 'a.mjs'), 'export const a = 1;\n');
  const fake = await startFakeServer([], { delayMs: 0, route: (req) => (req.tools?.length ? { text: 'Looked: nothing is wrong.' } : { text: '{}' }) });
  try {
    const a = new Agent({ url: fake.url, model: remote, cwd: proj, system: systemPrompt({ cwd: proj, git: 'none' }), memory: false, flows: true, mode: 'edits', verify: false });
    await a.send('review my changes in a.mjs');
    const asked = fake.requests.filter((r) => r.tools?.length)[0].messages.findLast((m) => m.role === 'user').content;
    expect(asked).toContain('Skill "Review code" from SKILLS.md');
    const l = new Agent({ url: fake.url, model: local, cwd: proj, system: systemPrompt({ cwd: proj, git: 'none' }), memory: false, flows: true, mode: 'edits', verify: false });
    const before = fake.requests.length;
    await l.send('review my changes in a.mjs');
    expect(JSON.stringify(fake.requests.slice(before))).not.toContain('Skill \\"Review code\\"');
  } finally { await fake.close(); }
});

test('the hub saves which set the model gets in settings.json; files.json says it, and when AGENTIC_INSTRUCTIONS decides', async () => {
  expect(LIMITS.some((l) => l.id === 'instructions')).toBe(false); // not an /effort row: that panel fits 80×24 as it is
  const call = (path, data) => instructionsRoute(new Request(`http://127.0.0.1:1${path}`, data ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) } : {}), new URL(`http://127.0.0.1:1${path}`), proj, state);
  const read = async (r) => (await r).json();
  expect((await read(call('/instructions/files.json'))).instructions).toEqual({ saved: 'auto', env: null });
  expect((await call('/instructions/set', { set: 'sideways' })).status).toBe(400);
  expect((await read(call('/instructions/set', { set: 'remote' }))).instructions).toEqual({ saved: 'remote', env: null });
  expect(JSON.parse(readFileSync(SETTINGS(), 'utf8')).instructions).toBe('remote');
  expect(savedInstructions()).toBe('remote');
  process.env.AGENTIC_INSTRUCTIONS = 'local';
  expect((await read(call('/instructions/files.json'))).instructions).toEqual({ saved: 'remote', env: 'local' });
});

test('the hub: the remote files read, saved and checked like the others, each in terminal/rules/remote', () => {
  expect(FILES).toEqual(expect.arrayContaining(['remote:tools', 'remote:skills', 'remote:harness', ...GUIDES.map((g) => `remote:${g}`)]));
  const h = fileInfo('remote:harness', proj, { state });
  expect(h).toMatchObject({ name: 'remote/HARNESS.md', set: 'remote', exists: true, limit: 8000 });
  expect(h.path).toBe(join(rules, 'remote', 'HARNESS.md'));
  const g = fileInfo('remote:GIT', proj, { state });
  expect(g).toMatchObject({ name: 'remote/GIT.md', guide: 'GIT', about: 'before any git command that changes something (commit, branch, merge, checkout)' });
  expect(fileInfo('remote:tools', proj, { state }).toolUse).toBe(toolUseFor('remote'));
  expect(fileInfo('remote:skills', proj, { state }).skills.map((s) => s.slug)).toEqual(['write-a-test', 'review-code', 'refactor', 'flaky-test']);
  expect(() => validateFile('remote:harness', '# H\n\n## Who you are\n\nx\n')).toThrow('"## How you work", "## Rules the app enforces" parts');
  expect(() => validateFile('remote:GIT', '# Git\n\nno parts here\n')).toThrow('needs at least one "## " part');
  expect(() => validateFile('remote:tools', '# T\n\n- no section\n')).toThrow('needs its "## Tool use" section');
  expect(() => validateFile('remote:GIT', '# Git\n\n## Commit\n\nHow you work\n')).toThrow('a heading the instructions are cut by');
  // a save writes the remote file, and Undo puts it back
  const before = readFileSync(join(rules, 'remote', 'GIT.md'), 'utf8');
  const next = saveFile('remote:GIT', proj, '# Git\n\nRead this before a commit.\n\n## Commit\n\n1. By path.\n', g.revision, { state });
  expect(readFileSync(join(rules, 'remote', 'GIT.md'), 'utf8')).toBe('# Git\n\nRead this before a commit.\n\n## Commit\n\n1. By path.\n');
  expect(next.about).toBe('before a commit');
  saveFile('remote:GIT', proj, null, next.revision, { state, undo: true });
  expect(readFileSync(join(rules, 'remote', 'GIT.md'), 'utf8')).toBe(before);
  // the local files are untouched by any of it
  expect(existsSync(join(rules, 'GIT.md'))).toBe(false);
});

test('as shipped: twelve files in terminal/rules/remote, each guide with a "Read this" line and a ## part, HARNESS with its four parts', () => {
  const dir = join(SOURCE, 'remote');
  for (const f of ['HARNESS', 'TOOLS', 'SKILLS', ...GUIDES]) expect(existsSync(join(dir, `${f}.md`))).toBe(true);
  for (const g of GUIDES) {
    const t = readFileSync(join(dir, `${g}.md`), 'utf8');
    expect(t.split('\n').slice(1).find((l) => l.trim())).toMatch(/^Read this /);
    expect(t).toMatch(/^## \S/m);
    expect(BUILT_IN_REMOTE[g]).toBe(t); // the copy built into the app is the file
  }
  const h = readFileSync(join(dir, 'HARNESS.md'), 'utf8');
  for (const part of ['Who you are', 'How you work', 'Guides', 'Rules the app enforces']) expect(PF.sectionOf(h, part)).toBeTruthy();
  // The last line asks for a step's reads together (3 Oct 2026): a model on another machine runs every call of a reply.
  expect(PF.sectionOf(readFileSync(join(dir, 'TOOLS.md'), 'utf8'), 'Tool use').split('\n').at(-1)).toStartWith("- Send the reads and searches a step needs together, in one reply");
  expect(PF.parseSkills(readFileSync(join(dir, 'SKILLS.md'), 'utf8')).map((s) => s.name)).toEqual(['Write a test', 'Review code', 'Refactor', 'Flaky test']);
});

test('a helper (the Agent tool) under a forced row keeps its parent\'s set: remote guides and the helper part, on a model of this Mac', async () => {
  writeFileSync(join(proj, 'a.mjs'), 'export const parse = (t) => JSON.parse(t);\n');
  const fake = await startFakeServer([
    { tool: { name: 'Agent', args: { description: 'find parse', prompt: 'Find where parse is defined.', kind: 'explore' } } },
    { text: 'parse is in a.mjs:1.' },
    { text: 'It is in a.mjs.' },
  ]);
  try {
    const a = new Agent({ url: fake.url, model: local, cwd: proj, system: systemPrompt({ cwd: proj, git: 'none' }), memory: false, flows: false, verify: false, way: 'model', hooks: [], mode: 'edits', instructions: 'remote' });
    expect(a.rulesSetUsed).toBe('remote');
    await a.send('where is parse? use a helper');
    const [first, helper] = fake.requests.filter((q) => q.stream);
    expect(first.messages[0].content).toContain('- RULES/SUBAGENTS.md:'); // the Agent tool is offered, so its guide is listed
    expect(helper.messages[0].content).toContain('# You are a helper');
    expect(helper.messages[0].content).toContain('\nHow you work\n');
  } finally { await fake.close(); }
});


test('the second round (2 Oct): CONTEXT, PERMISSIONS, DEBUGGING, RECOVERY and SECURITY listed; verification, handoff, style and packages merged in', () => {
  expect(GUIDES).toEqual(['PLANNING', 'CONTEXT', 'PERMISSIONS', 'TESTING', 'REVIEW', 'DEBUGGING', 'BUG-FIXING', 'RECOVERY', 'DESIGN', 'SECURITY', 'SUBAGENTS', 'MEMORY', 'GIT', 'ANSWERS']);
  const p = systemPrompt({ cwd: proj, git: 'g', set: 'remote' });
  for (const g of ['CONTEXT', 'PERMISSIONS', 'DEBUGGING', 'RECOVERY', 'SECURITY']) expect(p).toContain(`- RULES/${g}.md: `);
  expect(p).toContain('- RULES/DEBUGGING.md: when the cause of a problem is not known yet');
  expect(harnessOf().how).toContain('Commands here have no internet: use the packages already installed.');
  expect(harnessOf().how).toContain("read a neighbouring file for its naming, formatting, comment density and how it handles errors");
  const read = (g) => readFileSync(join(SOURCE, 'remote', `${g}.md`), 'utf8');
  expect(PF.sectionOf(read('TESTING'), 'Prove the claim')).toContain('not "should work"');
  expect(PF.sectionOf(read('ANSWERS'), 'Hand off')).toContain('The exact next command');
  for (const g of ['VERIFICATION', 'HANDOFF', 'STYLE', 'DEPS']) expect(existsSync(join(SOURCE, 'remote', `${g}.md`))).toBe(false);
  // no guide tells the model to undo with commands that wipe others' work
  for (const g of GUIDES) for (const line of read(g).split('\n').filter((l) => /git (stash|bisect|checkout|reset|clean)/.test(l))) expect([g, line]).toEqual([g, expect.stringMatching(/never/i)]);
});

test('PERMISSIONS comes with the table of right now, and the table says what the app really decides, in every mode', async () => {
  const row = { edit: 'Edit or Write a file', protect: 'A protected file', readCmd: 'A command that only reads', cmd: 'Any other command', commit: 'git commit', web: 'WebSearch and WebFetch' };
  const steps = { edit: ['Edit', { path: 'a.js', old_text: 'a', new_text: 'b' }, 'a.js'], protect: ['Edit', { path: '.env', old_text: 'a', new_text: 'b' }, '.env'], readCmd: ['Bash', { command: 'git status' }], cmd: ['Bash', { command: 'npm run build' }], commit: ['Bash', { command: 'git commit -m x' }], web: ['WebFetch', { url: 'https://example.com' }] };
  const kind = (d) => ({ allow: 'runs', deny: 'refused', check: 'check' }[d.decision] ?? 'ask');
  const said = (cell) => (/^refused/.test(cell) ? 'refused' : /^runs/.test(cell) ? 'runs' : /checks/.test(cell) ? 'check' : 'ask');
  for (const mode of MODES) {
    const t = permissionsTable({ mode });
    for (const [k, [name, args, rel]] of Object.entries(steps)) {
      const cell = t.split('\n').find((l) => l.startsWith(`| ${row[k]}`)).split('|')[2].trim();
      expect([mode, k, said(cell)]).toEqual([mode, k, kind(decide(name, args, { mode, cwd: proj, rel, rules: {}, allowedPrefixes: new Set() }))]);
    }
  }
  const t = permissionsTable({ mode: 'plan', rules: { allow: ['npm test'], never: ['npm publish'], protect: ['secrets/**'] }, session: new Set(['git add']) });
  expect(t).toContain('Mode: Plan.');
  expect(t).toContain('allowed without asking: "npm test"; never: "npm publish"; protected: "secrets/**"');
  expect(t).toContain('Allowed for this session: "git add".');
  expect(t).toContain('git push sends your code off this Mac');
  // read through the tool: the guide, then the table; without the app's side, the guide alone
  const env = { cwd: proj, rulesSet: 'remote', agents: false, permissionsNow: () => ({ mode: 'edits', rules: { never: ['npm publish'] }, session: [] }) };
  const r = (await execute('Read', { path: 'RULES/PERMISSIONS.md' }, null, env)).text;
  expect(r.startsWith('RULES/PERMISSIONS.md:\n## How permission works here')).toBe(true);
  expect(r).toContain('## Right now (from the app, as you read this)\n\nMode: Accept edits.');
  expect(r).toContain('never: "npm publish"');
  expect((await execute('Read', { path: 'RULES/PERMISSIONS.md' }, null, { ...env, permissionsNow: undefined })).text).not.toContain('Right now');
});

test('the agent hands Read its mode and rules: a remote model opening PERMISSIONS sees the mode it is in', async () => {
  const fake = await startFakeServer([{ tool: { name: 'Read', args: { path: 'RULES/PERMISSIONS.md' } } }, { text: 'Read it.' }]);
  try {
    const a = new Agent({ url: fake.url, model: remote, cwd: proj, system: systemPrompt({ cwd: proj, git: 'none' }), memory: false, flows: false, verify: false, mode: 'plan', permissions: { allow: [], never: ['npm publish'], protect: [] } });
    await a.send('what am I allowed to do here?');
    const result = a.messages.find((m) => m.role === 'tool').content;
    expect(result).toContain('Mode: Plan.');
    expect(result).toContain('never: "npm publish"');
  } finally { await fake.close(); }
});
