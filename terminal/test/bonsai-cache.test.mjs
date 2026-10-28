// Bonsai 2 9B on this Mac's Ollama (28 Oct 2026, from the owner's session of that morning in Ollama's own log):
// a request is sorted on the user's own words, not on what a dropped folder brought in; Bonsai goes straight to
// step by step, never the focused paths' tries; a finished request keeps its notes, and right after an answer
// that thought, the next message's start is read ahead (Ollama drops an answer's thinking once a message comes
// after it), and the next message stops that read if it is still going.
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.AGENTIC_MEMORY_SAVE = 'off';
const { Agent } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { routeByRules } = await import('../src/flows/index.mjs');
const { ownWords } = await import('../src/flows/words.mjs');
const { sortBug } = await import('../src/agent/rules.mjs');
const { pickSkill, parseSkills } = await import('../src/agent/prompt-files.mjs');
const { MODELS, DEFAULT_MODEL, setEndpoint, dropEndpoint, remoteModel, OWN_REMOTES } = await import('../../models/index.mjs');

const SOURCE = new URL('../rules/', import.meta.url).pathname;
// What the owner dropped in, as the window writes it (app/attach-read.mjs): a folder whose file names say exploit,
// xss and secrets, under the words they typed.
const FOLDER = `[Folder #1] analyze he folder deeply

<folder path="~/Desktop/Claude-Red-main">
README.md (4 KB)
skills/
  exploit-chains.md (6 KB)
  xss-payloads.md (3 KB)
  secrets-in-git.md (2 KB)
  broken-access-control.md (5 KB)
  fix-the-bug-bounty-report.md (2 KB)
</folder>
([Folder #1] is the folder ~/Desktop/Claude-Red-main. Read, List and Search may open what is in it.)`;

test('a request is sorted on the words typed: a dropped folder\'s file list neither makes it a fix nor picks a bug kind or a skill', () => {
  expect(ownWords(FOLDER)).toBe('[Folder #1] analyze he folder deeply');
  expect(ownWords('look at @a.mjs\n\n<file path="a.mjs">\n1  // fix the bug\n</file>')).toBe('look at @a.mjs');
  expect(ownWords('add a test')).toBe('add a test');
  expect(routeByRules(FOLDER)).toBeNull(); // the model sorts "analyze he folder deeply"; it was "fix" on the list
  expect(routeByRules(`fix the crash in cart.mjs\n\n<folder path="x">\nnotes.md (1 KB)\n</folder>`)).toEqual({ kind: 'fix' });
  expect(sortBug(FOLDER)?.name).not.toBe('Security');
  const skills = parseSkills('## Write a test\n- Words: add a test, unit test\n- About: one test\n\n1. Find the tests.\n');
  expect(pickSkill('summarize this\n\n<file path="t.md">\nhow to add a test and a unit test\n</file>', skills)).toBeNull();
  expect(pickSkill('add a test for it', skills).name).toBe('Write a test');
});

test('Bonsai 2 9B takes no focused paths: its own entry says so, and remoteModel carries it', () => {
  expect(OWN_REMOTES.find((x) => x.match.test('bonsai-2:9b')).focused).toBe(false);
  expect(remoteModel({ kind: 'openai', model: 'bonsai-2:9b', address: 'http://localhost:11434' }, { model: 'bonsai-2:9b', ollama: { ctx: 65536, tools: true, thinking: true } }).focused).toBe(false);
  expect(remoteModel({ kind: 'openai', model: 'qwen3.6:35b', address: 'http://localhost:11434' }, { model: 'qwen3.6:35b', ollama: { ctx: 65536, tools: true, thinking: true } }).focused).toBeUndefined();
});

// A stand-in Ollama that thinks: each chat is answered by script(body, n) with { thinking, content, call };
// hold(body) returns a promise that keeps the request open (it ends when the client goes). Every request is kept.
function ollama(script, { hold = () => null } = {}) {
  const seen = [];
  const srv = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    if (req.url !== '/api/chat') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}'); }
    const rec = { body, closed: false };
    seen.push(rec);
    res.on('close', () => { rec.closed = true; });
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    const wait = hold(body);
    if (wait) { res.write(''); await wait; return res.end(); }
    const a = script(body, seen.length);
    if (a.thinking) res.write(`${JSON.stringify({ model: body.model, message: { role: 'assistant', content: '', thinking: a.thinking }, done: false })}\n`);
    res.write(`${JSON.stringify({ model: body.model, message: { role: 'assistant', content: a.content ?? '', ...(a.call ? { tool_calls: [{ function: { name: a.call.name, arguments: a.call.args } }] } : {}) }, done: false })}\n`);
    res.end(`${JSON.stringify({ model: body.model, message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 900, prompt_eval_duration: 1e9, eval_count: 40, eval_duration: 1e9 })}\n`);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${srv.address().port}`, seen, chats: () => seen.map((s) => s.body), close: () => new Promise((d) => { srv.closeAllConnections?.(); srv.close(d); }) })));
}

let proj, rules, saved;
beforeEach(() => {
  saved = { rules: process.env.AGENTIC_RULES_DIR, warm: process.env.AGENTIC_WARM_NEXT };
  const root = mkdtempSync(join(tmpdir(), 'agentic-bonsai-cache-'));
  proj = join(root, 'proj'); rules = join(root, 'rules');
  for (const d of [proj, rules]) mkdirSync(d);
  copyFileSync(join(SOURCE, 'bug-fixing.md'), join(rules, 'bug-fixing.md'));
  copyFileSync(join(SOURCE, 'TOOLS.md'), join(rules, 'TOOLS.md'));
  writeFileSync(join(rules, 'SKILLS.md'), '## Tidy notes\n- Words: tidy the notes\n- About: tidy a notes file\n\n1. Read notes.md.\n2. Answer with what you would tidy.\n');
  writeFileSync(join(proj, 'notes.md'), '# Notes\n- one\n- two\n');
  writeFileSync(join(proj, 'cart.mjs'), 'export const total = (xs) => xs.reduce((a, b) => a - b, 0);\n');
  writeFileSync(join(proj, 'cart.test.mjs'), "import { total } from './cart.mjs';\nimport { test } from 'node:test';\ntest('t', () => { if (total([1, 2]) !== 3) throw new Error('no'); });\n");
  writeFileSync(join(proj, 'package.json'), '{"type":"module","scripts":{"test":"node --test"}}');
  process.env.AGENTIC_RULES_DIR = rules;
  process.env.AGENTIC_WARM_NEXT = 'on';
});
afterEach(() => {
  for (const [k, v] of [['AGENTIC_RULES_DIR', saved.rules], ['AGENTIC_WARM_NEXT', saved.warm]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const until = async (f, ms = 5000) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 20))) { const v = f(); if (v) return v; } return f(); };
const bonsai = (url) => {
  setEndpoint(url, { remote: true, kind: 'openai', ollama: true, model: 'bonsai-2:9b', numCtx: 65536, thinks: true, tools: true, family: 'qwen35', free: true });
  return { ...MODELS[DEFAULT_MODEL], remote: { model: 'bonsai-2:9b', here: true }, rules: 'local', focused: false };
};
const agentOn = (url, model, o = {}) => new Agent({ url, model, cwd: proj, system: systemPrompt({ cwd: proj, git: 'none' }), ctx: 65536, memory: false, flows: true, verify: false, way: 'app', hooks: [], mode: 'edits', instructions: 'local', checkIns: false, confirmPlan: false, ...o });
// Each request: a Read of notes.md first, then the answer, both after some thinking. The warm-up (one token) gets a word.
const reads = (body) => {
  if (body.options?.num_predict === 1) return { content: 'ok' };
  const last = body.messages.at(-1);
  return last.role === 'tool' ? { thinking: 'It has two lines; both fine.', content: 'Nothing to tidy.' } : { thinking: 'I should read notes.md first.', call: { name: 'Read', args: { path: 'notes.md' } } };
};

test('Bonsai: a fix request goes straight to step by step (no tests, drafts or tries), on the conversation\'s own prompt', async () => {
  const svc = await ollama((body) => (body.messages.at(-1).role === 'tool' ? { content: 'The sign in total is wrong.' } : { call: { name: 'Read', args: { path: 'cart.mjs' } } }));
  try {
    const a = agentOn(svc.url, bonsai(svc.url));
    const tries = [];
    const sorted = [];
    a.on('tries', (e) => tries.push(e.label));
    a.on('sorted', (e) => sorted.push(e.text));
    await a.send('fix the bug in cart.mjs, total is broken');
    expect(tries).toEqual([]);
    expect(sorted.some((t) => /step by step/.test(t))).toBe(true);
    const sys = a.messages[0].content;
    // (an Ollama request opens with the conversation's own line, client.mjs ownStart)
    expect(svc.chats().filter((b) => b.tools?.length).every((b) => b.messages[0].content.endsWith(sys))).toBe(true);
    // the same request on a model with focused paths does go down the fix path first
    const b = agentOn(svc.url, { ...bonsai(svc.url), focused: undefined });
    const tried = [];
    b.on('tries', (e) => tried.push(e.label));
    await b.send('fix the bug in cart.mjs, total is broken');
    expect(tried.length).toBeGreaterThan(0);
  } finally { dropEndpoint(svc.url); await svc.close(); }
}, 60_000);

test('Bonsai: the request keeps its notes, and after an answer that thought the next message is read ahead with the same start', async () => {
  const svc = await ollama(reads);
  try {
    const a = agentOn(svc.url, bonsai(svc.url));
    await a.send('tidy the notes please');
    await a.warming;
    const chats = svc.chats();
    const turn = chats.filter((b) => b.options?.num_predict !== 1);
    const warm = chats.filter((b) => b.options?.num_predict === 1);
    expect(warm).toHaveLength(1);
    const last = turn.at(-1);
    // the read-ahead is the last request's conversation, the answer after it and a stand-in message
    expect(warm[0].messages.slice(0, last.messages.length).map((m) => [m.role, m.content])).toEqual(last.messages.map((m) => [m.role, m.content]));
    expect(warm[0].messages.at(-2)).toMatchObject({ role: 'assistant', content: 'Nothing to tidy.' });
    expect(warm[0].messages.at(-1)).toEqual({ role: 'user', content: '…' });
    expect(warm[0].tools.map((t) => t.function.name)).toEqual(last.tools.map((t) => t.function.name));
    expect([warm[0].think, warm[0].options.num_ctx]).toEqual([last.think, 65536]);
    // the skill's steps went with the request and stay in it (baked), so the next message starts the same
    const req = a.messages.find((m) => m.role === 'user');
    expect(req.content).toContain('Skill "Tidy notes" from SKILLS.md');
    await a.send('thanks');
    const next = svc.chats().filter((b) => b.options?.num_predict !== 1).at(-1);
    expect(next.messages.slice(0, warm[0].messages.length - 1)).toEqual(warm[0].messages.slice(0, -1));
  } finally { dropEndpoint(svc.url); await svc.close(); }
}, 60_000);

test('the next message stops a read-ahead still going; none after an answer with no thinking, with AGENTIC_WARM_NEXT=off, or off Ollama', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const svc = await ollama(reads, { hold: (body) => (body.options?.num_predict === 1 && !body.messages.some((m) => m.content === 'thanks') ? held : null) });
  try {
    const a = agentOn(svc.url, bonsai(svc.url));
    await a.send('tidy the notes please');
    const warm = await until(() => svc.seen.find((s) => s.body.options?.num_predict === 1));
    expect(warm.closed).toBe(false); // still reading
    await a.send('thanks');
    await a.warming;
    expect(warm.closed).toBe(true);
    release();
    // no thinking: nothing to read again, so nothing read ahead
    const plain = await ollama((body) => ({ content: 'Hi.' }));
    try {
      const b = agentOn(plain.url, bonsai(plain.url));
      await b.send('hello');
      expect(b.warmNext()).toBe(false);
      expect(plain.chats().some((x) => x.options?.num_predict === 1)).toBe(false);
    } finally { dropEndpoint(plain.url); await plain.close(); }
    process.env.AGENTIC_WARM_NEXT = 'off';
    expect(a.warmNext()).toBe(false);
    process.env.AGENTIC_WARM_NEXT = 'on';
    expect(agentOn('http://127.0.0.1:9', MODELS[DEFAULT_MODEL]).warmNext()).toBe(false); // not an Ollama service
  } finally { release(); dropEndpoint(svc.url); await svc.close(); }
}, 60_000);
