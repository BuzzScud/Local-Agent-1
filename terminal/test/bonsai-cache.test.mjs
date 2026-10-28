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
const { MODELS, DEFAULT_MODEL, setEndpoint, dropEndpoint } = await import('../../models/index.mjs');
const { LATE_AT, TIDY_EARLY, TRIM_AT, tokensOf } = await import('../src/agent/agent-said.mjs');

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
    res.end(`${JSON.stringify({ model: body.model, message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: Math.round(JSON.stringify(body.messages).length / 3.6), prompt_eval_duration: 1e9, eval_count: 40, eval_duration: 1e9 })}\n`);
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
  return { ...MODELS[DEFAULT_MODEL], remote: { model: 'bonsai-2:9b', here: true }, rules: 'local' };
};
const agentOn = (url, model, o = {}) => new Agent({ url, model, cwd: proj, system: systemPrompt({ cwd: proj, git: 'none' }), ctx: 65536, memory: false, flows: true, verify: false, way: 'app', hooks: [], mode: 'edits', instructions: 'local', checkIns: false, confirmPlan: false, ...o });
// Each request: a Read of notes.md first, then the answer, both after some thinking. The warm-up (one token) gets a word.
const reads = (body) => {
  if (body.options?.num_predict === 1) return { content: 'ok' };
  const last = body.messages.at(-1);
  return last.role === 'tool' ? { thinking: 'It has two lines; both fine.', content: 'Nothing to tidy.' } : { thinking: 'I should read notes.md first.', call: { name: 'Read', args: { path: 'notes.md' } } };
};

test('a model on a service (Bonsai here) takes a fix request straight to step by step: no tests, drafts or tries, on the conversation\'s own prompt', async () => {
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
    // the same request on this Mac's own model (not on a service) still goes down the fix path first
    const b = agentOn(svc.url, MODELS[DEFAULT_MODEL]);
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

// A conversation of tool outputs about `share` of ctx (tokensOf: 3.6 characters a token), the request first.
const filled = (a, share, { outputs = 6 } = {}) => {
  a.messages.push({ role: 'user', content: 'read the notes' }, { role: 'assistant', content: 'Reading.' });
  const each = Math.floor((a.ctx * share * 3.6) / outputs);
  for (let i = 0; i < outputs; i++) a.messages.push({ role: 'tool', content: `${i}`.padEnd(each, 'x'), tool_call_id: `c${i}` });
  // estNow counts the two newest messages on top of ctxUsed (they may not be in it yet)
  a.ctxUsed = Math.round(a.ctx * share) - a.messages.slice(-2).reduce((n, m) => n + tokensOf(m.content), 0);
  a.turn = { requestMsg: a.messages[1] };
};

test('during a request it tidies only when the next reply would not fit; between messages from 60%, without notes', async () => {
  expect([TRIM_AT, LATE_AT, TIDY_EARLY]).toEqual([0.78, 0.95, 0.18]);
  // 100k, so that a reply's room (2,048 tokens) is 2% of it
  const make = () => new Agent({ url: 'http://127.0.0.1:9', model: MODELS[DEFAULT_MODEL], cwd: proj, system: 'x', ctx: 100000, thinking: false, memory: false });
  const trimmed = (a) => a.messages.filter((m) => String(m.content).startsWith('[older output removed')).length;
  // 85% (with a reply's room, under 95%): left alone in the step loop; Trim at alone (a direct call) would tidy
  const a = make();
  expect(a.roomAt).toBe(0.95);
  filled(a, 0.85);
  await a.fitContext(null, { at: a.roomAt });
  expect(trimmed(a)).toBe(0);
  await a.fitContext();
  expect(trimmed(a)).toBeGreaterThan(0);
  // 96%: the next reply would not fit, so it tidies mid-request too
  const b = make();
  filled(b, 0.96);
  await b.fitContext(null, { at: b.roomAt });
  expect(trimmed(b)).toBeGreaterThan(0);
  // between messages: from 60% it empties the oldest outputs down to 45%, with no notes or summary
  const c = make();
  const notes = [];
  c.on('note', (e) => notes.push(e.text));
  filled(c, 0.66);
  let asked = 0;
  c.notesInPlace = async () => { asked++; return true; };
  c.compact = async () => { asked++; };
  await c.tidyBetween();
  expect(trimmed(c)).toBeGreaterThan(0);
  expect(asked).toBe(0);
  expect(c.ctxUsed).toBeLessThan(c.ctx * 0.5);
  expect(notes.some((t) => /^Trimmed old tool output to save memory \(about [\d,]+ tokens, between messages\)\.$/.test(t))).toBe(true);
  const d = make();
  filled(d, 0.5);
  await d.tidyBetween();
  expect(trimmed(d)).toBe(0); // under 60%: nothing
  // a Trim at of your own moves the between line with it (and the request's line never comes before it)
  const e = new Agent({ url: 'http://127.0.0.1:9', model: MODELS[DEFAULT_MODEL], cwd: proj, system: 'x', ctx: 100000, thinking: false, memory: false, trimAt: 0.97 });
  expect(e.roomAt).toBe(0.97);
});

test('late in a request a reply keeps its room (not 2,048 tokens), and the read-ahead reads the tidied conversation', async () => {
  const svc = await ollama(reads);
  try {
    const a = agentOn(svc.url, { ...bonsai(svc.url), replyTokens: 16384 }, { ctx: 100000 });
    filled(a, 0.84);
    await a.send('tidy the notes please');
    await a.warming;
    const turn = svc.chats().filter((b) => b.options?.num_predict !== 1);
    expect(turn[0].options.num_predict).toBeGreaterThan(8000); // 95% of 100k less the conversation; was 2,048 past 78%
    // the answer ended past 60%: the oldest outputs were emptied before the read-ahead, which reads them so
    const warm = svc.chats().find((b) => b.options?.num_predict === 1);
    expect(warm.messages.some((m) => String(m.content).startsWith('[older output removed'))).toBe(true);
    expect(turn.at(-1).messages.some((m) => String(m.content).startsWith('[older output removed'))).toBe(false); // not mid-request
  } finally { dropEndpoint(svc.url); await svc.close(); }
}, 60_000);
