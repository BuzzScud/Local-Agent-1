// End to end, the real app in a pseudo-terminal: several windows at once.
// 1 · On a paid OpenAI-style service that first answers "too many requests": the window waits and
//     asks again (no summary of the conversation), and the request's cost shows on its end line and
//     in the footer.
// 2 · Two windows in one folder: the second asks "own copy or share?", works in its own copy, and
//     after the request asks before putting the changed file back into the real folder.
import { test, expect } from 'bun:test';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';

const MODEL = 'vendor/coder-1';
// An OpenAI-style service with prices in its model list ($1 and $2 a million): the first chat is a 429.
function paidService() {
  const chats = [];
  let n = 0;
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/v1/models')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, context_length: 131072, pricing: { prompt: '0.000001', completion: '0.000002' } }] })); return; }
    if (req.method === 'GET') { res.writeHead(404); res.end('{}'); return; }
    let body = ''; for await (const c of req) body += c;
    const j = body ? JSON.parse(body) : {};
    if (!j.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'ready' } }] })); return; }
    chats.push(j);
    if (++n === 1) { res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' }); res.end('{"error":{"message":"Rate limit exceeded: too many requests"}}'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'export.mjs writes one line per trade.' }, finish_reason: 'stop' }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12450, completion_tokens: 380 } })}\n\n`);
    res.write('data: [DONE]\n\n'); res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, chats, close: () => new Promise((r) => server.close(r)) })));
}

test('a busy paid service: the window waits and asks again, nothing is summarized, and the cost shows on the end line and in /meters (the footer has the gauges since 2 Oct 2026)', async () => {
  const { base, cwd, env } = setup();
  const svc = await paidService();
  // Look first off: a model on /remote thinks by default (3 Oct 2026), and Look first follows it; this test is the busy retry, one answer.
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ limits: { look: 'off' }, remote: { use: true, source: 'openai', address: '127.0.0.1', port: svc.port, connect: 'http', kind: 'openai', model: MODEL, context: 0, key: false, keyEnd: '' } }));
  const r = await runInPty({ cwd, cols: 140, env: { ...env, AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: '', AGENTIC_MEMORY_SAVE: 'off', AGENTIC_BUSY_WAITS: '0.3,0.3,0.3,0.3' }, args: ['--no-flows'], steps: [
    { wait: '? for shortcuts' }, { sleep: 300 },
    { type: 'what does export.mjs do?' }, { key: 'enter' }, { wait: 'one line per trade' }, { wait: 'for this request' }, { sleep: 400 }, { snapshot: 'done' },
    { type: '/meters on' }, { key: 'enter' }, { wait: 'this window ·' }, { sleep: 300 }, { snapshot: 'meters' },
    ...quit,
  ] });
  await svc.close();
  const scr = r.snapshots.done.replace(/\s+/g, ' ');
  expect(scr).toContain('The service is busy: too many requests right now. Trying again in');
  expect(scr).toContain('(try 2 of 5)');
  expect(scr).not.toContain('outgrew');
  expect(svc.chats.length).toBe(2); // the busy one, then the answer
  expect(svc.chats[1].usage).toEqual({ include: true }); // a service with prices is asked what each answer cost
  // 12,450 in at $1 and 380 out at $2 a million: $0.0132
  expect(scr).toMatch(/done \d+:\d\d [AP]M · \$0\.01 for this request/);
  expect(r.snapshots.meters.replace(/\s+/g, ' ')).toContain('$0.01 this window · $0.01 today');
  const day = readdirSync(join(base, 'home', 'spend'));
  expect(day).toHaveLength(1);
}, T);

test('two windows in one folder: the second asks, works in its own copy, and asks before putting the changed file back', async () => {
  const { base, cwd, env } = setup();
  const e = { ...env, AGENTIC_MEMORY_SAVE: 'off' };
  const idle = await startFakeServer([]);
  const fake = await startFakeServer([{ tool: { name: 'Write', args: { path: 'notes.txt', content: 'from window 2\n' } } }, { text: 'Wrote notes.txt.' }]);
  const one = runInPty({ cwd, env: e, args: ['--url', idle.url, '--no-flows'], timeoutMs: 60_000, steps: [{ wait: '? for shortcuts' }, { sleep: 9000 }, ...quit] });
  await new Promise((r) => setTimeout(r, 2500));
  let copyDir = null, beforeBack = null, inTheCopy = null;
  const two = await runInPty({ cwd, env: e, args: ['--url', fake.url, '--no-flows', '--mode', 'edits'], timeoutMs: 60_000, steps: [
    { wait: 'Another window is already working in this folder' }, { sleep: 200 }, { snapshot: 'asked' },
    { key: 'enter' }, { wait: 'Working in your own copy now' }, { sleep: 300 }, { snapshot: 'moved' },
    { type: 'write notes.txt' }, { key: 'enter' }, { wait: 'Before I change anything' }, { sleep: 200 }, { key: 'enter' }, // the app's own go-ahead
    { wait: 'Do you want to proceed' }, { sleep: 200 }, { key: 'enter' }, // its check of the change (the tests), in the copy
    { wait: 'worked in its own copy and changed 1 file' }, { sleep: 300 }, { snapshot: 'back' },
    { fn: () => { beforeBack = existsSync(join(cwd, 'notes.txt')); const d = join(base, 'home', 'copies'); copyDir = readdirSync(d)[0] && join(d, readdirSync(d)[0], 'work'); inTheCopy = existsSync(join(copyDir, 'notes.txt')); } },
    { key: 'enter' }, { wait: 'back into' }, { sleep: 300 }, { snapshot: 'put' },
    ...quit,
  ] });
  await one;
  await idle.close(); await fake.close();
  expect(two.snapshots.asked).toContain('Work in my own copy');
  expect(two.snapshots.asked).toContain('Share this folder');
  expect(two.snapshots.moved).toContain('own copy');
  expect(two.snapshots.back).toContain('notes.txt +1 −0 new file');
  expect(two.snapshots.back).toContain('Put them back into the real folder');
  expect(beforeBack).toBe(false); // the real folder untouched until you say so
  expect(inTheCopy).toBe(true); // written in the copy
  expect(readFileSync(join(cwd, 'notes.txt'), 'utf8')).toBe('from window 2\n');
  expect(two.snapshots.put.replace(/\s+/g, ' ')).toContain('Put 1 file back into');
  // Nothing left to put back: the copy went when the window closed.
  expect(existsSync(copyDir)).toBe(false);
}, T);

// 3 · /remote in a new window moves that window only (12 Oct 2026, the owner: "ensure that remote still works
//     separately in a new window and doesnt overwrite all of them"). Two windows open at once on the Claude API
//     (Main); the second one's /remote service, "Just this window", sends its message to the service while the first
//     one's next message still goes to the Claude API; both services stay saved and Main stays where it was. A third
//     window opened after them asks where to start, Main first (the second window's pick is the saved set-up).
test('/remote in a second window, "Just this window": that window moves, the first stays on Main, both services stay saved; a new window asks, Main first', async () => {
  const { fakeOllama } = await import('./fake-ollama.mjs');
  const { startFakeAnthropic } = await import('./fake-anthropic.mjs');
  const { ON_REMOTE } = await import('./app-setup.mjs');
  const { cpSync, mkdirSync: mk } = await import('node:fs');
  const KEY = 'test-anthropic-key-0123456789';
  const { base, cwd, env } = setup();
  const two = join(base, 'demo-two');
  cpSync(cwd, two, { recursive: true });
  writeFileSync(join(base, 'home', 'trust.json'), JSON.stringify({ [cwd]: new Date().toISOString(), [two]: new Date().toISOString() }));
  const svc = await fakeOllama();
  const claude = await startFakeAnthropic(Array.from({ length: 12 }, () => ({ text: 'Answered by the Claude API.' })), { key: KEY });
  const s = { source: 'openai', address: svc.url, port: null, connect: 'http', kind: 'openai', model: 'coder:30b', context: 0, key: false, keyEnd: '', keyId: 'openai' };
  const cl = { source: 'claude', address: claude.url, port: null, connect: 'http', kind: 'claude', model: 'claude-opus-5-5', context: 0, key: true, keyEnd: '6789', keyId: 'claude' };
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { ...cl, use: true }, remotes: { openai: s, claude: cl } }));
  const server = (r) => ({ kind: r.kind, source: r.source, address: r.address, port: null, connect: r.connect, keyId: r.keyId });
  writeFileSync(join(base, 'home', 'profiles.json'), JSON.stringify({ profiles: { Main: { server: server(cl), model: 'claude-opus-5-5', backup: null, spillAfter: 30 } }, uses: { 'ai:main': 'Main' } }));
  const e = { ...env, AGENTIC_MEMORY_SAVE: 'off', AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: KEY, ANTHROPIC_API_KEY: '' };
  const footer = (t) => t.trimEnd().split('\n').filter((l) => /⏵⏵/.test(l)).at(-1) ?? '';
  let switched;
  const moved = new Promise((r) => { switched = r; });
  const one = runInPty({ cwd, env: e, args: ['--no-flows', '--mode', 'bypass'], timeoutMs: 120_000, steps: [
    { wait: ON_REMOTE, ms: 25_000 }, { sleep: 500 },
    { fn: () => moved }, { sleep: 2500 }, // past this window's 2 s look at the files, after the second window moved
    { type: 'hello from one' }, { key: 'enter' }, { wait: 'Answered by the Claude API.', ms: 30_000 }, { sleep: 800 }, { snapshot: 'one' },
    ...quit,
  ] });
  await new Promise((r) => setTimeout(r, 2500));
  const second = await runInPty({ cwd: two, env: e, args: ['--no-flows', '--mode', 'bypass'], timeoutMs: 120_000, steps: [
    { wait: ON_REMOTE, ms: 25_000 }, { sleep: 2500 },
    { type: '/remote service' }, { key: 'enter' }, { wait: 'in which windows?', ms: 20_000 }, { sleep: 300 }, { snapshot: 'ask' }, { type: '1' },
    { wait: 'This window → coder:30b', ms: 20_000 }, { sleep: 500 }, { fn: () => switched() },
    { type: 'hello from two' }, { key: 'enter' }, { wait: 'From coder:30b.', ms: 30_000 }, { sleep: 800 }, { snapshot: 'two' },
    { sleep: 6000 }, // the first window's message
    ...quit,
  ] });
  const first = await one;
  const settingsNow = JSON.parse(readFileSync(join(base, 'home', 'settings.json'), 'utf8'));
  const profilesNow = JSON.parse(readFileSync(join(base, 'home', 'profiles.json'), 'utf8'));
  const third = await runInPty({ cwd, env: e, args: ['--no-flows', '--mode', 'bypass'], timeoutMs: 60_000, steps: [
    { wait: /Where should this window start\?|(on the Claude API|on \S+), \d+ ms|answered in \d+ ms/, ms: 25_000 }, { sleep: 600 }, { snapshot: 'three' },
    ...quit,
  ] });
  const toService = svc.chats().filter((b) => JSON.stringify(b.messages ?? '').includes('hello from')).map((b) => JSON.stringify(b.messages).includes('hello from one') ? 'one' : 'two');
  const toClaude = claude.seen.filter((x) => x.body?.stream && JSON.stringify(x.body.messages ?? '').includes('hello from')).map((x) => JSON.stringify(x.body.messages).includes('hello from one') ? 'one' : 'two');
  await svc.close(); await claude.close();
  expect(second.snapshots.ask.replace(/\s+/g, ' ')).toMatch(/1\. Just this window.*2\. Every window/);
  expect(toService).toEqual(['two']);
  expect(toClaude).toEqual(['one']);
  expect(footer(first.snapshots.one)).toContain('● Main · claude-opus-5-5');
  expect(footer(second.snapshots.two)).toMatch(/● this window · coder:30b on /);
  expect(Object.keys(settingsNow.remotes).sort()).toEqual(['claude', 'openai']);
  expect(profilesNow.profiles.Main.model).toBe('claude-opus-5-5');
  // The second window's pick is the saved set-up for the next start, not Main: a new window asks, Main first.
  expect(third.snapshots.three).toContain('Where should this window start?');
  expect(third.snapshots.three).toMatch(/❯ 1\. On Main: claude-opus-5-5 · Claude API\s+\(recommended\)/);
  expect(third.snapshots.three).toContain('2. Just this window on coder:30b');
}, T * 3);
