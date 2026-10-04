// The opening read (src/agent/opening.mjs, 3 Oct 2026): on the remote set, before the first step of a
// conversation, the memory whole and where the project stands, as one step the model did not take.
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-opening-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { openingRead, OPENING_COMMITS } = await import('../src/agent/opening.mjs');
const { openMemory, applyChanges, memoryDirs, factsInFull } = await import('../src/agent/facts.mjs');
const { Agent } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL, HOME, remoteModel } = await import('../../models/index.mjs');

const local = MODELS[DEFAULT_MODEL];
// A model on your own other computer: the memory goes whole (3 Oct 2026: only there, by default).
const remote = { ...local, remote: { model: 'big-coder', mine: true } };
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

test('/compact on a short remote chat makes no call to the service; a longer one is summarized with the memory in it once, and the opening read comes back once after', async () => {
  const fake = await startFakeServer([], { delayMs: 0 });
  const summaries = () => fake.requests.filter((r) => /summarize a coding session/i.test(String(r.messages?.[0]?.content ?? '')));
  try {
    const a = new Agent({ url: fake.url, model: remote, cwd: repo, system: systemPrompt({ cwd: repo, git: 'g' }), memory: { home, recall: false }, home, flows: false, verify: false });
    await a.send('say hello');
    expect(a.said()).toBeLessThanOrEqual(3);
    await a.compact();
    expect(summaries()).toHaveLength(0);
    await a.send('say hello again');
    await a.compact();
    expect(summaries()).toHaveLength(1);
    expect(summaries()[0].messages[1].content.split('Agentic Coder read these for you').length - 1).toBe(1);
    expect(a.messages.some((m) => m.opening)).toBe(false); // the summary took it away…
    await a.send('and now?');
    expect(a.messages.filter((m) => m.opening)).toHaveLength(1); // …and it came back once
  } finally { fake.close(); }
});

// What the opening read sends of the memory (3 Oct 2026, the fix plan's Part 4): facts about you go in
// full only to your own other computer (coding serve at a private address or over SSH); any other
// service gets the project's facts in full and none about you. settings.json "memoryToRemote":
// mine (the default) · all · none. Each is checked on a pretend service that keeps what it was sent.
const service = (r) => ({ ...local, remote: remoteModel({ use: true, port: null, connect: 'http', model: 'big-coder', context: 0, key: false, keyEnd: '', ...r }).remote });
const sentTo = async (model) => {
  const fake = await startFakeServer([], { delayMs: 0 });
  const events = [];
  try {
    const a = new Agent({ url: fake.url, model, cwd: repo, system: systemPrompt({ cwd: repo, git: 'g' }), memory: { home, recall: false }, home, flows: false, verify: false });
    a.on('tool', (e) => events.push(e));
    await a.send('what does total do?');
    const asked = fake.requests.find((r) => r.tools?.length).messages;
    return { opening: String(asked.find((m) => m.role === 'tool')?.content ?? ''), label: events.find((e) => e.given)?.label };
  } finally { fake.close(); }
};
const YOU = 'a long sentence that would be cut in the short lines of the prompt is here whole.';
const PROJECT = 'The tests run with node --test from the repo top.';
const settingsFile = () => {
  if (HOME === join(homedir(), '.agentic-coder')) throw new Error('not in a throwaway home: settings.json would be the real one');
  return join(HOME, 'settings.json');
};
const withSetting = async (v, fn) => { writeFileSync(settingsFile(), JSON.stringify({ memoryToRemote: v })); try { return await fn(); } finally { rmSync(settingsFile(), { force: true }); } };

test('an Ollama service, even on the home network, gets the project\'s facts in full and none about you; the screen says how many stay on this Mac', async () => {
  const ollama = service({ source: 'openai', kind: 'openai', address: '192.168.1.20:11434' });
  expect(ollama.remote.mine).toBe(false);
  const r = await sentTo(ollama);
  expect(r.opening).toContain(PROJECT);
  expect(r.opening).not.toContain(YOU);
  expect(r.opening).not.toContain('About the user');
  // Of its 3 facts about you, the 2 rules a new memory starts with are in the instructions' Memory lines
  // (4 Oct 2026: the label said all of them stayed); the one other stays on this Mac.
  expect(r.label).toBe("Reading the project's memory");
  // A public address is not yours either, even running coding serve; nor is the Claude API.
  expect(service({ source: 'machine', kind: 'llama', address: 'gpu.example.com' }).remote.mine).toBe(false);
  expect(service({ source: 'claude', kind: 'claude', connect: 'https', address: '' }).remote.mine).toBe(false);
});

test('your own other computer (coding serve at a private address, Tailscale or over SSH) gets the memory whole', async () => {
  const mine = service({ source: 'machine', kind: 'llama', address: '127.0.0.1:8080' });
  expect(mine.remote.mine).toBe(true);
  expect(service({ source: 'machine', kind: 'llama', address: '100.101.102.103' }).remote.mine).toBe(true);
  expect(service({ source: 'machine', kind: 'llama', connect: 'ssh', address: 'me@studio' }).remote.mine).toBe(true);
  const r = await sentTo(mine);
  expect(r.opening).toContain(YOU);
  expect(r.opening).toContain(PROJECT);
  expect(r.label).toBe('Reading all memory files');
});

test('memoryToRemote "all" sends everything everywhere (as before); "none" sends no memory block at all', async () => {
  const ollama = service({ source: 'openai', kind: 'openai', address: '192.168.1.20:11434' });
  const all = await withSetting('all', () => sentTo(ollama));
  expect(all.opening).toContain(YOU);
  expect(all.opening).toContain(PROJECT);
  const none = await withSetting('none', () => sentTo(service({ source: 'machine', kind: 'llama', address: '127.0.0.1:8080' })));
  expect(none.opening).not.toContain(YOU);
  expect(none.opening).not.toContain(PROJECT);
  expect(none.opening).not.toContain('Memory');
  expect(none.opening).toContain('Git: branch main'); // where the project stands still comes
});
