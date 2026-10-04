// Look before answering (3 Oct 2026, the owner's picks): a model on another machine that answers a
// question about the project, or a request for work, without a look of its own is sent back once to
// search first, and the second time let through with a line under it; an answer that names files
// that are not in the project is sent back once, then named in a line. Models on this Mac, small
// talk and general questions are not held to it; a new file made needs no look.
import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-look-first-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { Agent, aboutTheCode, filesInAnswer } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { MODEL_HOOKS, HOOKS } = await import('../src/agent/way.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');

const local = MODELS[DEFAULT_MODEL];
const remote = { ...local, remote: { model: 'big-coder' } };
let proj;
beforeEach(() => {
  proj = mkdtempSync(join(tmpdir(), 'agentic-look-first-'));
  mkdirSync(join(proj, 'src'));
  writeFileSync(join(proj, 'src', 'cart.mjs'), 'export const total = (xs) => xs.reduce((a, b) => a + b, 0);\n');
  writeFileSync(join(proj, 'README.md'), '# shop\n');
});
const HOLD = ['look-first', 'real-files'];
const agentOn = (url, model, extra = {}) => new Agent({ url, model, cwd: proj, system: systemPrompt({ cwd: proj, git: 'none' }), memory: false, flows: false, verify: false, mode: 'bypass', confirmPlan: false, way: 'model', hooks: HOLD, ...extra });
// What the app said to the model on its own (a send-back) and the lines under the answer.
async function run(model, request, replies, extra) {
  const fake = await startFakeServer(replies, { delayMs: 0 });
  try {
    const a = agentOn(fake.url, model, extra);
    const notes = [];
    a.on('note', (n) => notes.push(n.text));
    await a.send(request);
    const backs = a.messages.filter((m) => m.role === 'user' && /answered without looking|are not in this project/.test(String(m.content))).map((m) => String(m.content));
    return { a, notes, backs, answer: a.messages.at(-1).content };
  } finally { fake.close(); }
}

test('both checks start on when the model decides, and /hooks lists them', () => {
  expect(MODEL_HOOKS).toContain('look-first');
  expect(MODEL_HOOKS).toContain('real-files');
  expect(HOOKS.map((h) => h.id)).toEqual(expect.arrayContaining(['look-first', 'real-files']));
});

test('what counts as about the code: a question naming something of it, or work; not small talk or a general question', () => {
  for (const t of ['where is the login page handled?', 'what does total() do?', 'why does cart.mjs round down?', 'fix the bug in the cart', 'which file sets the port?', 'how is `shipFee` worked out?']) expect(aboutTheCode(t)).toBe(true);
  for (const t of ['hello', 'thanks!', 'what is 2 + 2?', 'how are you today?']) expect(aboutTheCode(t)).toBe(false);
  expect(filesInAnswer('It is in src/cart.mjs, called from app.jsx; see NOTES/notes/x.md and https://x.io/a.js.')).toEqual(['src/cart.mjs', 'app.jsx']);
});

test('a model on another machine that answers without looking is sent back once with words to search for; after a search its answer stands', async () => {
  const r = await run(remote, 'where is the cart total worked out?', [
    { text: 'The total is worked out in the checkout code.' },
    { tool: { name: 'Search', args: { pattern: 'total' } } },
    { text: 'In src/cart.mjs: total() adds the items up.' },
  ]);
  expect(r.notes).toContain('It answered without looking at the project; asked it to search first.');
  expect(r.backs).toHaveLength(1);
  expect(r.backs[0]).toContain('Search for the names in the request (for example');
  expect(r.answer).toBe('In src/cart.mjs: total() adds the items up.');
  expect(r.notes.some((n) => /check it before you rely on it/.test(n))).toBe(false);
});

test('the second time it still has not looked, the answer is let through with a line under it', async () => {
  const r = await run(remote, 'where is the cart total worked out?', [
    { text: 'In the checkout code.' },
    { text: 'In the checkout code, I am sure.' },
  ]);
  expect(r.backs).toHaveLength(1);
  expect(r.answer).toBe('In the checkout code, I am sure.');
  expect(r.notes).toContain("Answered without looking at the project's files: check it before you rely on it.");
});

test('an answer naming a file that is not in the project goes back once; one it made, or one the request names, does not count', async () => {
  const r = await run(remote, 'where is the cart total worked out?', [
    { tool: { name: 'Read', args: { path: 'src/cart.mjs' } } },
    { text: 'In lib/money/total.mjs and src/cart.mjs.' },
    { text: 'In src/cart.mjs.' },
  ]);
  expect(r.notes).toContain('It named files that are not in the project (lib/money/total.mjs); asked it to check.');
  expect(r.backs).toHaveLength(1);
  expect(r.backs[0]).toEndWith("These files are not in this project: lib/money/total.mjs. Search for what you meant (Search or List), and answer only with files you have seen in a tool's result.");
  expect(r.answer).toBe('In src/cart.mjs.');
  // Named in the request ("is old.mjs still used?"): it may say it is gone.
  const asked = await run(remote, 'is old.mjs still used anywhere?', [
    { tool: { name: 'Search', args: { pattern: 'old' } } },
    { text: 'No: old.mjs is not in the project any more.' },
  ]);
  expect(asked.backs).toEqual([]);
});

test('a new file made for a request needs no look, and is not a made-up file', async () => {
  const r = await run(remote, 'create a file hello.txt that says hi', [
    { tool: { name: 'Write', args: { path: 'hello.txt', content: 'hi\n' } } },
    { text: 'Created hello.txt.' },
  ]);
  expect(existsSync(join(proj, 'hello.txt'))).toBe(true);
  expect(r.backs).toEqual([]);
});

test('a model on this Mac, small talk, a general question and the checks switched off are not held to it', async () => {
  expect((await run(local, 'where is the cart total worked out?', [{ text: 'In the checkout code.' }])).backs).toEqual([]);
  expect((await run(remote, 'hello', [{ text: 'Hi! What can I do?' }])).backs).toEqual([]);
  expect((await run(remote, 'what is 2 + 2?', [{ text: '4.' }])).backs).toEqual([]);
  expect((await run(remote, 'where is the cart total worked out?', [{ text: 'In lib/x.mjs.' }], { hooks: [] })).backs).toEqual([]);
});
