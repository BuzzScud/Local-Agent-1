// Fewer steps lost (6 Oct 2026, the owner: "can we make the agentic coder faster?", then "Fewer steps"):
// four timed runs of Qwen3.6 35B on the service lost 12 of 46 steps to calls the app turned back, half of
// them a name the app did not know (Edit's "pattern" or "original", Bash's "Command", RunCommand, a Read
// of a folder), and read seven files in seven replies though Read takes several.
import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-fewer-steps-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { Agent, READ_TIP } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { parseArgs, toolNameOf } = await import('../src/agent/tools.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');

const local = MODELS[DEFAULT_MODEL];
const remote = { ...local, remote: { kind: 'openai', label: 'the service', ollama: '0.12.0' }, harness: { read: { whole: 400 } } };
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentic-fewer-steps-'));
  mkdirSync(join(dir, 'handlers'));
  for (const n of ['user', 'order', 'invoice']) writeFileSync(join(dir, 'handlers', `${n}.mjs`), `export function ${n}(email) {\n  return email.includes('@');\n}\n`);
});
const agentOn = (url, model, extra = {}) => new Agent({ url, model, cwd: dir, system: systemPrompt({ cwd: dir, git: 'none' }), memory: false, flows: false, verify: false, mode: 'bypass', confirmPlan: false, way: 'model', hooks: [], ask: async () => ({ choice: 'yes' }), ...extra });
const results = (a) => a.messages.filter((m) => m.role === 'tool' && !m.opening).map((m) => String(m.content));

test("Edit's other names for the old text, and a name in another case, are the ones meant", () => {
  for (const [old, neu] of [['pattern', 'replacement'], ['original', 'replacement'], ['old_content', 'new_content']]) {
    const r = parseArgs('Edit', JSON.stringify({ path: 'a.mjs', [old]: 'x', [neu]: 'y' }), 'model');
    expect(r.error).toBeUndefined();
    expect(r.args).toMatchObject({ path: 'a.mjs', old_text: 'x', new_text: 'y' });
  }
  expect(parseArgs('Bash', '{"Command":"npm test"}', 'model').args.command).toBe('npm test');
  expect(parseArgs('Read', '{"File_Path":"a.mjs"}', 'model').args.path).toBe('a.mjs');
  // An exact name still wins over a loose one.
  expect(parseArgs('Bash', '{"command":"ls","Command":"rm x"}', 'model').args.command).toBe('ls');
});

test('RunCommand and the other common names run as the tool they mean; a name in another case too', () => {
  for (const n of ['RunCommand', 'run_command', 'execute_command', 'shell']) expect(toolNameOf(n, 'model')).toBe('Bash');
  expect(toolNameOf('read_file', 'model')).toBe('Read');
  expect(toolNameOf('edit_file', 'model')).toBe('Edit');
  expect(toolNameOf('list_directory', 'model')).toBe('List');
  expect(toolNameOf('bash', 'model')).toBe('Bash');
  expect(toolNameOf('READ', 'app')).toBe('Read');
  expect(toolNameOf('Task', 'model')).toBe('Task');
});

test('a Read of a folder says what is in it, as a result, not an error', async () => {
  const fake = await startFakeServer([{ tool: { name: 'Read', args: { path: 'handlers/' } } }, { text: 'Three handlers.' }]);
  try {
    const a = agentOn(fake.url, remote);
    const errors = [];
    a.on('tool', (e) => { if (e.error) errors.push(e.name); });
    await a.send('what is in handlers?');
    const out = results(a).find((t) => t.includes('is a folder'));
    expect(out).toContain('user.mjs');
    expect(out).toContain('invoice.mjs');
    expect(out).not.toContain('Use List');
    expect(errors).toEqual([]);
  } finally { await fake.close(); }
});

test('the calls of the timed run land the first time: RunCommand, Edit with pattern, Bash with Command', async () => {
  const fake = await startFakeServer([
    { tool: { name: 'Read', args: { path: 'handlers/user.mjs' } } },
    { tool: { name: 'Edit', args: { path: 'handlers/user.mjs', pattern: "return email.includes('@');", replacement: "return email.indexOf('@') > 0;" } } },
    { tool: { name: 'RunCommand', args: { command: 'echo ran' } } },
    { tool: { name: 'Bash', args: { Command: 'echo again' } } },
    { text: 'Done.' },
  ]);
  try {
    const a = agentOn(fake.url, remote);
    const errors = [];
    a.on('tool', (e) => { if (e.error) errors.push(`${e.name}`); });
    await a.send('make the email check in handlers/user.mjs stricter');
    expect(errors).toEqual([]);
    expect(readFileSync(join(dir, 'handlers', 'user.mjs'), 'utf8')).toContain("indexOf('@') > 0");
    const out = results(a);
    expect(out.some((t) => /There is no tool called/.test(t))).toBe(false);
    expect(out.some((t) => /needs "/.test(t))).toBe(false);
    expect(out.some((t) => t.includes('ran'))).toBe(true);
    expect(out.some((t) => t.includes('again'))).toBe(true);
  } finally { await fake.close(); }
});

test('two one-file Reads in a row bring the tip once a message, when the model decides', async () => {
  const reads = ['user', 'order', 'invoice'].map((n) => ({ tool: { name: 'Read', args: { path: `handlers/${n}.mjs` } } }));
  const fake = await startFakeServer([...reads, { text: 'Read them.' }]);
  try {
    const a = agentOn(fake.url, remote);
    await a.send('read the three handlers');
    const tips = results(a).filter((t) => t.endsWith(READ_TIP));
    expect(tips.length).toBe(1);
    expect(results(a).findIndex((t) => t.endsWith(READ_TIP))).toBe(results(a).findIndex((t) => t.includes('order(')));
  } finally { await fake.close(); }
  // Several files in one Read: no tip.
  const many = await startFakeServer([{ tool: { name: 'Read', args: { paths: ['handlers/user.mjs', 'handlers/order.mjs'] } } }, { tool: { name: 'Read', args: { path: 'handlers/invoice.mjs' } } }, { text: 'Read them.' }]);
  try {
    const a = agentOn(many.url, remote);
    await a.send('read the three handlers');
    expect(results(a).some((t) => t.endsWith(READ_TIP))).toBe(false);
  } finally { await many.close(); }
  // When the app decides: no tip (one call a reply is its way).
  const app = await startFakeServer([...reads, { text: 'Read them.' }]);
  try {
    const a = agentOn(app.url, remote, { way: 'app' });
    await a.send('read the three handlers');
    expect(results(a).some((t) => t.endsWith(READ_TIP))).toBe(false);
  } finally { await app.close(); }
});

test('AGENTIC_STEPS=old turns all of it off, as before 6 Oct 2026 (the Fewer steps check runs both)', async () => {
  process.env.AGENTIC_STEPS = 'old';
  try {
    expect(toolNameOf('RunCommand', 'model')).toBe('RunCommand');
    expect(toolNameOf('bash', 'model')).toBe('bash');
    expect(toolNameOf('Grep', 'model')).toBe('Search');
    expect(parseArgs('Edit', JSON.stringify({ path: 'a.mjs', pattern: 'x', replacement: 'y' }), 'model').error).toContain('needs "old_text"');
    expect(parseArgs('Bash', '{"Command":"npm test"}', 'model').error).toContain('needs "command"');
    const fake = await startFakeServer([{ tool: { name: 'Read', args: { path: 'handlers/' } } }, { tool: { name: 'Read', args: { path: 'handlers/user.mjs' } } }, { tool: { name: 'Read', args: { path: 'handlers/order.mjs' } } }, { text: 'Done.' }]);
    try {
      const a = agentOn(fake.url, remote);
      await a.send('read the handlers');
      expect(results(a).some((t) => t.includes('Use List to see what is in it'))).toBe(true);
      expect(results(a).some((t) => t.endsWith(READ_TIP))).toBe(false);
    } finally { await fake.close(); }
  } finally { delete process.env.AGENTIC_STEPS; }
});

// Round two (6 Oct 2026, the first check's runs): the steps the after side still lost.
const { resolvePath } = await import('../src/agent/tools.mjs');
const { realpathSync } = await import('node:fs');

test('any name for running a command runs as Bash, and a name spelled its own way is the tool it names', () => {
  for (const n of ['run_commands', 'Run_commands', 'run_bash', 'runShellCommand', 'execute-command', 'bash_command']) expect(toolNameOf(n, 'model')).toBe('Bash');
  expect(toolNameOf('ReadFile', 'model')).toBe('Read');
  expect(toolNameOf('write-file', 'model')).toBe('Write');
  expect(toolNameOf('create_file', 'model')).toBe('Write');
  for (const n of ['Task', 'Run(Commands): npm test\n</parameter', 'runner']) expect(toolNameOf(n, 'model')).toBe(n);
});

test('a new file at a made-up place lands in the project folder its path ends in; a real place is left alone', () => {
  const made = resolvePath(dir, '/home/logan/AI_Projects/calculator/handlers/validate.mjs');
  expect(made).toMatchObject({ inside: true, rel: join('handlers', 'validate.mjs') });
  expect(resolvePath(dir, '/project/handlers/new.test.mjs')).toMatchObject({ inside: true, rel: join('handlers', 'new.test.mjs') });
  // No folder of the project in it: still outside.
  expect(resolvePath(dir, '/home/logan/notes/new.mjs').inside).toBe(false);
  // A real folder outside the project: left as named.
  const elsewhere = mkdtempSync(join(tmpdir(), 'agentic-fewer-steps-elsewhere-'));
  mkdirSync(join(elsewhere, 'sub'));
  expect(resolvePath(dir, join(elsewhere, 'sub', 'handlers', 'x.mjs')).inside).toBe(false);
  process.env.AGENTIC_STEPS = 'old';
  try { expect(resolvePath(dir, '/home/logan/AI_Projects/calculator/handlers/validate.mjs').inside).toBe(false); } finally { delete process.env.AGENTIC_STEPS; }
});

test('a new file by the project folder’s real name (/private/var on a Mac) is inside it', () => {
  const real = realpathSync(dir);
  if (real === dir) return; // a temp folder with no link in its path: nothing to tell apart
  const r = resolvePath(dir, join(real, 'handlers', 'brand-new.mjs'));
  expect(r).toMatchObject({ inside: true, rel: join('handlers', 'brand-new.mjs') });
  expect(resolvePath(dir, join(real, 'top-new.mjs'))).toMatchObject({ inside: true, rel: 'top-new.mjs' });
  process.env.AGENTIC_STEPS = 'old';
  try { expect(resolvePath(dir, join(real, 'handlers', 'brand-new.mjs')).inside).toBe(false); } finally { delete process.env.AGENTIC_STEPS; }
});
