// /permissions inside the agent: saved rules decide, "always allow" remembers
// only the uncovered part, a protected file asks even on auto-accept (a link to
// it too), and your never-list holds. The fake server stands in for the model.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, existsSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';

const model = MODELS[DEFAULT_MODEL];
const project = () => { const d = mkdtempSync(join(tmpdir(), 'agentic-perms-')); cpSync(join(import.meta.dir, '..', 'demo-project'), d, { recursive: true }); return d; };
const bash = (command) => ({ tool: { name: 'Bash', args: { command, description: 'x' } } });
const write = (path, content = 'x\n') => ({ tool: { name: 'Write', args: { path, content } } });

async function run(replies, { mode = 'ask', rules = null, answers = [], setup } = {}) {
  const cwd = project();
  setup?.(cwd);
  const fake = await startFakeServer(replies);
  const asked = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode, flows: false, verify: false, confirmPlan: false,
    permissions: rules ? () => rules : null,
    ask: async (req) => { asked.push({ name: req.name, command: req.args?.command, path: req.args?.path, once: !!req.once, protectedBy: req.protectedBy ?? null }); return { choice: answers.shift() ?? 'no' }; } });
  const tools = [];
  agent.on('tool', (e) => tools.push(e));
  await agent.send('do the thing');
  await fake.close();
  return { agent, asked, tools, cwd };
}

test('a saved rule runs its command without asking; a chain with an uncovered part asks, and "don\'t ask again" remembers that part only', async () => {
  const { asked, tools, agent } = await run([bash('node --test'), bash('node --test && echo deployed > DEPLOYED.txt'), { text: 'Done.' }], { rules: { allow: ['node --test'] }, answers: ['always'] });
  expect(asked).toEqual([{ name: 'Bash', command: 'node --test && echo deployed > DEPLOYED.txt', path: undefined, once: false, protectedBy: null }]);
  expect(tools.filter((t) => t.label === 'Bash' && !t.error).length).toBe(2);
  // the command wrote a file with >, so its words cannot make a rule: nothing was remembered
  expect([...agent.allowedPrefixes]).toEqual([]);
});

test('"don\'t ask again" on a chain remembers the part nothing covered, and only that', async () => {
  const { asked, agent } = await run([bash('node --test && ./scripts/deploy.sh'), { text: 'Done.' }], { rules: { allow: ['node --test'] }, answers: ['always'] });
  expect(asked.map((a) => a.command)).toEqual(['node --test && ./scripts/deploy.sh']);
  expect([...agent.allowedPrefixes]).toEqual(['./scripts/deploy.sh']);
});

test('a protected file asks even on auto-accept, with no "allow all edits"; saying no leaves it unwritten and the mode unchanged', async () => {
  const { asked, cwd, agent } = await run([write('notes.md'), write('.env', 'API_URL=http://localhost:3000\n'), write('.ENV.local'), { text: 'Done.' }], { mode: 'edits', answers: ['no'] });
  expect(asked).toEqual([{ name: 'Write', command: undefined, path: '.env', once: true, protectedBy: '.env' }]);
  expect(existsSync(join(cwd, 'notes.md'))).toBe(true);
  expect(existsSync(join(cwd, '.env'))).toBe(false);
  expect(agent.mode).toBe('edits');
});

test('a link to a protected file is protected too, and so is .agentic-coder/ when the project is the home folder', async () => {
  // An existing file changes through Edit, after a Read (Write only creates files).
  const edit = { tool: { name: 'Edit', args: { path: 'notes.md', old_text: 'API_URL=http://localhost:3000', new_text: 'API_URL=http://example.com' } } };
  const { asked, cwd } = await run([{ tool: { name: 'Read', args: { path: 'notes.md' } } }, edit, { text: 'Done.' }], { mode: 'edits', answers: ['no'], setup: (d) => { writeFileSync(join(d, '.env'), 'API_URL=http://localhost:3000\n'); symlinkSync(join(d, '.env'), join(d, 'notes.md')); } });
  expect(asked).toEqual([{ name: 'Edit', command: undefined, path: 'notes.md', once: true, protectedBy: '.env' }]);
  expect(readFileSync(join(cwd, '.env'), 'utf8')).toBe('API_URL=http://localhost:3000\n');
  const home = await run([write('.agentic-coder/permissions.json', '{"everywhere":{"allow":["curl *"]}}'), { text: 'Done.' }], { mode: 'edits', answers: ['no'] });
  expect(home.asked.map((a) => a.protectedBy)).toEqual(['.agentic-coder/**']);
  expect(existsSync(join(home.cwd, '.agentic-coder', 'permissions.json'))).toBe(false);
});

test('your never-list refuses a command in Auto-edit, before any question', async () => {
  const { asked, tools } = await run([bash('npm publish --access public'), { text: 'Stopped.' }], { mode: 'edits', rules: { never: ['npm publish'] } });
  expect(asked).toEqual([]);
  expect(tools.find((t) => t.label === 'Bash').view).toEqual({ kind: 'denied', message: 'blocked by your rule "npm publish" (/permissions)' });
});

test('a new line starts another command: "ls⏎rm notes.txt" asks, where it used to run as reading', async () => {
  const { asked, cwd } = await run([bash('ls\nrm export.test.mjs'), { text: 'Done.' }]);
  expect(asked.map((a) => a.command)).toEqual(['ls\nrm export.test.mjs']);
  expect(existsSync(join(cwd, 'export.test.mjs'))).toBe(true);
});

test('an "always" answer on a protected file never turns Auto-edit on', async () => {
  const { agent, cwd } = await run([write('.env', 'A=1\n'), { text: 'Done.' }], { mode: 'ask', answers: ['always'] });
  expect(agent.mode).toBe('ask');
  expect(existsSync(join(cwd, '.env'))).toBe(true); // the answer was a yes
});

test('rules are read at every command: one saved in another window counts at once, and a move to another project switches the lists', async () => {
  const cwd = project();
  const other = project();
  const allow = [];
  const fake = await startFakeServer([bash('node --test'), { text: 'One.' }, bash('node --test'), { text: 'Two.' }, bash('node --test'), { text: 'Three.' }]);
  const asked = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'ask', flows: false, verify: false, confirmPlan: false,
    permissions: (dir) => (dir === cwd ? { allow } : { allow: [] }),
    ask: async (req) => { asked.push(req.args.command); return { choice: 'yes' }; } });
  await agent.send('run the tests');
  expect(asked).toEqual(['node --test']);
  allow.push('node --test'); // saved by another window
  await agent.send('again');
  expect(asked).toEqual(['node --test']);
  agent.moveTo(other); // "Work in <project>?": its own rules, none saved there
  await agent.send('and there');
  expect(asked).toEqual(['node --test', 'node --test']);
  await fake.close();
});

test('the fix and change paths on auto-accept: a protected file is asked about before anything is written, and a no leaves every file as it was', async () => {
  const { applyChange } = await import('../src/flows/apply.mjs');
  const cwd = project();
  const asked = [];
  const ctx = { cwd, mode: () => 'edits', confirm: async () => ({ ok: true }), protectedBy: (rel) => (rel === '.env' ? '.env' : null), tool: () => {}, setMode: () => { throw new Error('mode changed'); },
    ask: async (req) => { asked.push({ path: req.args.path, once: !!req.once, protectedBy: req.protectedBy ?? null }); return { choice: 'no' }; } };
  const r = await applyChange(ctx, [{ rel: 'notes.md', before: null, after: '# Notes\n' }, { rel: '.env', before: null, after: 'A=1\n' }]);
  expect(r.ok).toBe(false);
  expect(asked).toEqual([{ path: '.env', once: true, protectedBy: '.env' }]);
  expect(existsSync(join(cwd, 'notes.md'))).toBe(false);
  expect(existsSync(join(cwd, '.env'))).toBe(false);
  // a yes writes both, and the ordinary file is not asked about
  asked.length = 0;
  ctx.ask = async (req) => { asked.push(req.args.path); return { choice: 'yes' }; };
  expect((await applyChange(ctx, [{ rel: 'notes.md', before: null, after: '# Notes\n' }, { rel: '.env', before: null, after: 'A=1\n' }])).ok).toBe(true);
  expect(asked).toEqual(['.env']);
  expect(readFileSync(join(cwd, '.env'), 'utf8')).toBe('A=1\n');
});

test('a rename on auto-accept that reaches a protected file asks, with no "allow all edits", and a no changes nothing', async () => {
  const { renameFlow } = await import('../src/flows/index.mjs');
  const cwd = project();
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(cwd, 'config'), { recursive: true });
  writeFileSync(join(cwd, 'config', 'prod.js'), 'export const oldName = 1;\n');
  writeFileSync(join(cwd, 'use.js'), "import { oldName } from './config/prod.js';\nconsole.log(oldName);\n");
  const asked = [];
  const ctx = { cwd, testCmd: null, mode: () => 'edits', plan: () => ({ step() {}, done() {} }), tool: () => {}, setMode: () => { throw new Error('mode changed'); },
    protectedBy: (rel) => (rel.startsWith('config/prod.') ? 'config/prod.*' : null),
    ask: async (req) => { asked.push({ name: req.name, once: !!req.once, protectedBy: req.protectedBy ?? null }); return { choice: 'no' }; } };
  const r = await renameFlow(ctx, 'oldName', 'newName');
  expect(asked).toEqual([{ name: 'Rename', once: true, protectedBy: 'config/prod.*' }]);
  expect(r.declined).toBe(true);
  expect(readFileSync(join(cwd, 'config', 'prod.js'), 'utf8')).toContain('oldName');
  expect(readFileSync(join(cwd, 'use.js'), 'utf8')).toContain('oldName');
});
