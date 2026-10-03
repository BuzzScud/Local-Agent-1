// The opening read (src/agent/opening.mjs, 3 Oct 2026): on the remote set, before the first step of a
// conversation, the memory whole and where the project stands, as one step the model did not take.
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-opening-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { openingRead, OPENING_COMMITS } = await import('../src/agent/opening.mjs');
const { openMemory, applyChanges, memoryDirs, factsInFull } = await import('../src/agent/facts.mjs');
const { Agent } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');

const local = MODELS[DEFAULT_MODEL];
const remote = { ...local, remote: { model: 'big-coder' } };
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });

let home, repo, saved;
beforeEach(() => {
  saved = process.env.AGENTIC_OPENING;
  delete process.env.AGENTIC_OPENING;
  home = mkdtempSync(join(tmpdir(), 'agentic-opening-'));
  repo = join(home, 'work', 'shop');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'cart.mjs'), 'export const total = (xs) => xs.reduce((a, b) => a + b, 0);\n');
  writeFileSync(join(repo, 'README.md'), '# shop\n');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'first: the cart');
  for (let i = 2; i <= OPENING_COMMITS + 3; i++) git(repo, 'commit', '-q', '--allow-empty', '-m', `commit ${i}`);
  writeFileSync(join(repo, 'src', 'cart.mjs'), 'export const total = (xs) => xs.reduce((a, b) => a + b, 0); // changed\n');
  openMemory(repo, { home });
  const { you, project } = memoryDirs(repo, home);
  applyChanges(you, { add: [{ kind: 'you', text: 'The user wants the answer first, then the details, in plain words, and a long sentence that would be cut in the short lines of the prompt is here whole.' }] });
  applyChanges(project, { add: [{ text: 'The tests run with node --test from the repo top.' }, { text: 'Created cart.html on the Desktop.' }] });
});
afterEach(() => { if (saved === undefined) delete process.env.AGENTIC_OPENING; else process.env.AGENTIC_OPENING = saved; });

test('the memory in full, each fact with its kind and day; an event left out', () => {
  const m = factsInFull(repo, { home });
  expect(m.text).toContain('About the user (~/.agentic/memory)');
  expect(m.text).toContain('a long sentence that would be cut in the short lines of the prompt is here whole. (you, saved ');
  expect(m.text).toContain('About this project (~/work/shop/.agentic/memory)');
  expect(m.text).toContain('- The tests run with node --test from the repo top. (project, saved ');
  expect(m.text).toContain('[always] When you are stuck, ask the user'); // the first rules, marked as always read
  expect(m.text).not.toContain('cart.html');
  expect(factsInFull(repo, { home, maxChars: 400 }).left).toBeGreaterThan(0);
});

test('the step: the memory, git (branch, changed files, the last commits) and the top of the folder', () => {
  const r = openingRead(repo, { memory: { home }, home });
  expect(r.args.description).toBe('Reading all memory files');
  expect(r.args.command).toContain('git log --oneline');
  expect(r.body).toStartWith('Agentic Coder read these for you before your first step');
  expect(r.body).toContain('a long sentence that would be cut in the short lines of the prompt is here whole.');
  expect(r.body).toContain('Git: branch main, 1 changed file (not committed)\n M src/cart.mjs');
  expect(r.body).toContain(`The last ${OPENING_COMMITS} commits:`);
  expect(r.body).toContain(`commit ${OPENING_COMMITS + 3}`);
  expect(r.body).not.toContain('first: the cart'); // older than the last 15
  expect(r.body).toContain('At the top of the folder:\nsrc/  README.md');
  expect(r.view).toMatchObject({ kind: 'opening', title: 'Reading all memory files' });
  expect(r.view.lines[0]).toMatch(/^3 facts about you · 1 about this project/);
  expect(r.view.lines[1]).toBe(`git: main, 1 changed · last ${OPENING_COMMITS} commits`);
  // No memory (a practice run): where the project stands, under its own title.
  const bare = openingRead(repo, { memory: null, home });
  expect(bare.args.description).toBe('Reading where the project stands');
  expect(bare.body).not.toContain('Memory');
  // Not a git repository: nothing said about git (a line saying so sent the model to try git); the home folder: the memory only.
  const plain = join(home, 'loose');
  mkdirSync(plain);
  writeFileSync(join(plain, 'a.txt'), 'a');
  const loose = openingRead(plain, { memory: null, home: join(home, 'elsewhere') });
  expect(loose.body).not.toContain('Git');
  expect(loose.args.command).toBe('ls');
  expect(loose.body).toContain('At the top of the folder:\na.txt');
  const atHome = openingRead(home, { memory: { home }, home });
  expect(atHome.body).not.toContain('Git');
  expect(atHome.body).not.toContain('At the top');
  expect(openingRead(home, { memory: null, home })).toBe(null);
});

test('the agent: once a conversation on the remote set, as a List step it did not take (not a Bash: it was copied); never on the local set', async () => {
  const fake = await startFakeServer([], { delayMs: 0 });
  try {
    const events = [];
    const a = new Agent({ url: fake.url, model: remote, cwd: repo, system: systemPrompt({ cwd: repo, git: 'g' }), memory: { home, recall: false }, home, flows: false, verify: false });
    a.on('tool', (e) => events.push(e));
    await a.send('what does total do?');
    const asked = fake.requests.find((r) => r.tools?.length).messages;
    const call = asked.find((m) => m.tool_calls?.some((c) => c.function.name === 'List' && JSON.parse(c.function.arguments).path === '.'));
    expect(call).toBeTruthy();
    expect(asked.some((m) => m.tool_calls?.some((c) => c.function.name === 'Bash'))).toBe(false);
    const result = asked[asked.indexOf(call) + 1];
    expect(result.role).toBe('tool');
    expect(result.content).toStartWith('Agentic Coder read these for you before your first step');
    expect(result.content).toContain('The tests run with node --test from the repo top.');
    expect(asked.indexOf(call)).toBeGreaterThan(asked.findIndex((m) => m.role === 'user')); // after the request, before any step of its own
    expect(events[0]).toMatchObject({ name: 'List', label: 'Reading all memory files', given: true, view: { kind: 'opening' } });
    // The opening read is not conversation: what was said is counted without its two messages,
    // so one short exchange is still "nothing to summarize yet" (/compact, ctrl+p).
    expect(a.messages.length - a.said()).toBe(2);
    await a.send('and where is it used?');
    expect(a.messages.filter((m) => m.opening)).toHaveLength(1); // not again while it is still in the conversation
    // Trimmed away (memory filled): it comes again with the next message.
    a.messages.find((m) => m.opening).content = '[older output removed to save space: …]';
    await a.send('one more thing');
    expect(a.messages.filter((m) => m.opening)).toHaveLength(2);
    // The local set, and AGENTIC_OPENING=off: none.
    const l = new Agent({ url: fake.url, model: local, cwd: repo, system: systemPrompt({ cwd: repo, git: 'g' }), memory: { home, recall: false }, home, flows: false, verify: false });
    await l.send('what does total do?');
    expect(l.messages.some((m) => m.opening)).toBe(false);
    expect(l.said()).toBe(l.messages.length); // on this Mac the count is what it always was
    process.env.AGENTIC_OPENING = 'off';
    const off = new Agent({ url: fake.url, model: remote, cwd: repo, system: systemPrompt({ cwd: repo, git: 'g' }), memory: { home, recall: false }, home, flows: false, verify: false });
    await off.send('what does total do?');
    expect(off.messages.some((m) => m.opening)).toBe(false);
  } finally { fake.close(); }
});
