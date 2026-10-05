// What a remote run on 4 Oct 2026 asked for (Qwen3.6 on an Ollama service, from the home folder):
// a command that reaches for a web page outside Bypass is told to use WebFetch, not "stay inside the
// project"; the mode a window is left in is the next window's; a reply cut off at your own Reply
// length goes again once with the room the context has; and a service that takes no thinking cap
// is not stepped down to one ("39 of 64"), its meter measuring the reply's room instead.
import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-run-fixes-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { Agent, STEP_DOWN_CAP } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { execute } = await import('../src/agent/tools.mjs');
const { fenceHint, netHint } = await import('../src/tools/sandbox.mjs');
const { firstMode } = await import('../src/app/store.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL, setEndpoint, dropEndpoint } = await import('../../models/index.mjs');
const { runInPty } = await import('./pty.mjs');
const { T, setup, quit } = await import('./app-setup.mjs');

const model = MODELS[DEFAULT_MODEL];
const URL = 'http://203.0.113.9:60011/api/docs';

test('a command that reaches for a web page outside Bypass is told to call WebFetch with that address', () => {
  const refused = '* Immediate connect fail for 203.0.113.9: Operation not permitted\ncurl: (7) Failed to connect to 203.0.113.9 port 60011';
  expect(fenceHint(refused, { command: `curl -v ${URL} 2>&1` })).toBe(`\n(Commands cannot reach the internet here: only Bypass permissions opens it to them, and the user turns that on. To read the page, call the WebFetch tool: WebFetch {"url": "${URL}"}. Do not try curl, wget or another language again.)`);
  // Python's urllib, and curl -s piped on with nothing printed at all.
  expect(fenceHint('urllib.error.URLError: <urlopen error [Errno 1] Operation not permitted>', { command: `python3 -c "import urllib.request; urllib.request.urlopen('${URL}')"` })).toContain(`WebFetch {"url": "${URL}"}`);
  expect(netHint('', `curl -sL ${URL} | head -100`)).toContain('call the WebFetch tool');
  // In Bypass the internet is open: a failure there is the server's. No address: the files hint as before.
  expect(fenceHint(refused, { command: `curl ${URL}`, open: true })).not.toContain('WebFetch');
  expect(fenceHint('cat: /Users/x/a.txt: Operation not permitted', { command: 'cat /Users/x/a.txt' })).toContain('Files outside the project folder cannot be read or changed');
  expect(netHint('<html>ok</html>', `curl ${URL}`)).toBe('');
});

test.skipIf(globalThis.needs?.('sandbox'))('in Manual, the real sandbox refuses curl and the result names WebFetch', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-net-'));
  const r = await execute('Bash', { command: `curl -sL --connect-timeout 5 ${URL} 2>&1 | head -5` }, {}, { cwd, permissionsNow: () => ({ mode: 'ask' }) });
  expect(r.text).toContain(`call the WebFetch tool: WebFetch {"url": "${URL}"}`);
});

test('the mode a window starts in: --mode, else a saved start-up mode, else the last window\'s, else Manual', () => {
  const was = process.env.AGENTIC_LAST_MODE;
  process.env.AGENTIC_LAST_MODE = 'on';
  try {
    expect(firstMode('auto', { lastMode: 'bypass' })).toEqual({ mode: 'auto', from: 'flag' });
    expect(firstMode(undefined, { mode: 'plan', modeFrom: 'folder', lastMode: 'bypass' })).toEqual({ mode: 'plan', from: 'saved' });
    expect(firstMode(undefined, { mode: 'edits', fromFolder: ['mode'], lastMode: 'bypass' })).toEqual({ mode: 'edits', from: 'saved' });
    expect(firstMode(undefined, { lastMode: 'bypass' })).toEqual({ mode: 'bypass', from: 'last' });
    expect(firstMode(undefined, { lastMode: 'nonsense' })).toEqual({ mode: 'ask', from: 'default' });
    expect(firstMode(undefined, {})).toEqual({ mode: 'ask', from: 'default' });
    process.env.AGENTIC_LAST_MODE = 'off';
    expect(firstMode(undefined, { lastMode: 'bypass' })).toEqual({ mode: 'ask', from: 'default' });
  } finally { process.env.AGENTIC_LAST_MODE = was; }
});

test('the window keeps the mode it is left in, and the next one starts in it with a line saying so', async () => {
  const { cwd, env, base } = setup();
  const on = { ...env, AGENTIC_LAST_MODE: 'on' };
  const fake = await startFakeServer([]);
  await runInPty({ cwd, env: on, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: '/mode bypass' }, { key: 'enter' }, { wait: 'bypass permissions on' }, { sleep: 300 }, ...quit,
  ] });
  expect(JSON.parse(readFileSync(join(base, 'home', 'settings.json'), 'utf8')).lastMode).toBe('bypass');
  const r = await runInPty({ cwd, env: on, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'as the last window left it' }, { wait: 'bypass permissions on' }, { key: 'shiftTab' }, { sleep: 300 }, ...quit,
  ] });
  await fake.close();
  expect(r.text).toContain('Started in bypass permissions, as the last window left it · shift+tab changes it');
  expect(JSON.parse(readFileSync(join(base, 'home', 'settings.json'), 'utf8')).lastMode).not.toBe('bypass'); // shift+tab moved on, and that is kept
}, T);

// A model on a service with its own Reply length.
const service = { ...model, remote: { kind: 'openai', label: 'the service', ollama: '0.12.0' }, replyTokens: 8192 };

test('a reply cut off at your Reply length with nothing arrived goes again once with the room the context has', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-room-'));
  const fake = await startFakeServer([{ finish: 'length', tokens: 8192 }, { text: 'Done.' }]);
  const notes = [];
  const a = new Agent({ url: fake.url, model: service, cwd, system: systemPrompt({ cwd, git: 'none' }), thinking: false, ctx: 131072, mode: 'edits', flows: false, confirmPlan: false, memory: false, way: 'model', hooks: [], ask: async () => ({ choice: 'yes' }) });
  a.on('note', (e) => notes.push(e.text));
  await a.send('make big.html');
  await fake.close();
  expect(fake.requests[0].max_tokens).toBe(8192);
  expect(fake.requests[1].max_tokens).toBe(32768);
  expect(notes).toContain('The reply was cut off at your Reply length (8.2k of 8.2k tokens) before anything arrived; this step goes again with 32.8k of room. Raise Reply length in /effort to keep it.');
  // Not told to build it in parts, and the empty reply is not left in the conversation.
  expect(JSON.stringify(fake.requests[1].messages)).not.toContain('Build the file in parts');
  expect(fake.requests[1].messages.at(-1).role).toBe('user');
});

test('with Look before answering on, a cut reply is still a cut, not an answer without a look', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-room-'));
  const fake = await startFakeServer([{ finish: 'length', tokens: 8192 }, { tool: { name: 'List', args: { path: '.' } } }, { text: 'Done.' }]);
  const notes = [];
  const a = new Agent({ url: fake.url, model: service, cwd, system: systemPrompt({ cwd, git: 'none' }), thinking: false, ctx: 131072, mode: 'edits', flows: false, confirmPlan: false, memory: false, way: 'model', hooks: ['look-first'], ask: async () => ({ choice: 'yes' }) });
  a.on('note', (e) => notes.push(e.text));
  await a.send('make big.html');
  await fake.close();
  expect(notes.some((t) => /answered without looking/.test(t))).toBe(false);
  expect(fake.requests[1].max_tokens).toBe(32768);
});

test('a second cut in the same message, or no room to give, is told to build in parts as before', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-room-'));
  const cut = { finish: 'length', tokens: 8192 };
  const fake = await startFakeServer([cut, cut, { text: 'In parts.' }]);
  const a = new Agent({ url: fake.url, model: service, cwd, system: systemPrompt({ cwd, git: 'none' }), thinking: false, ctx: 131072, mode: 'edits', flows: false, confirmPlan: false, memory: false, way: 'model', hooks: [], ask: async () => ({ choice: 'yes' }) });
  await a.send('make big.html');
  await fake.close();
  expect(fake.requests[2].messages.at(-1).content).toContain('Build the file in parts instead.');
  const small = await startFakeServer([cut, { text: 'In parts.' }]);
  const b = new Agent({ url: small.url, model: service, cwd, system: systemPrompt({ cwd, git: 'none' }), thinking: false, ctx: 16384, mode: 'edits', flows: false, confirmPlan: false, memory: false, way: 'model', hooks: [], ask: async () => ({ choice: 'yes' }) });
  await b.send('make big.html');
  await small.close();
  expect(small.requests[1].messages.at(-1).content).toContain('Build the file in parts instead.');
});

// Since 5 Oct 2026 the app holds a cap of its own there (one reply of Qwen3.6 thought for 14 minutes, to the end of
// its reply room): the model's thinking budget for a reply, which the meter shows, and thinking off past half the time.
test('a service that takes no thinking cap is not stepped down to 64 tokens: the app holds the model\'s budget, and past half the time thinking goes off', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-cap-'));
  const fake = await startFakeServer([{ text: 'ok' }]);
  const make = () => new Agent({ url: fake.url, model: service, cwd, system: 's', thinking: true, ctx: 131072, memory: false, flows: false, thinkBudgetSecs: 10, way: 'model', hooks: [] });
  try {
    const here = make();
    here.requestStarted = Date.now() - 6000;
    here.turn = { errorsInRow: 0 };
    expect(here.capsThinking()).toBe(true); // a llama.cpp server: the step-down holds
    expect(here.steppedDown()).toBe(true);
    setEndpoint(fake.url, { kind: 'openai', ollama: '0.12.0' });
    const there = make();
    there.requestStarted = Date.now() - 6000;
    there.turn = { errorsInRow: 0 };
    expect(there.capsThinking()).toBe(false);
    expect(there.steppedDown()).toBe(false);
    expect(there.serviceSteppedDown()).toBe(true); // past half its time: its replies are asked for with thinking off
    const caps = [];
    there.on('waiting', (w) => caps.push(w.thinkCap));
    await there.send('hi');
    expect(caps[0]).toBe(service.thinkingBudget ?? 4096); // the app's own cap for a reply, not the reply's room (8192) as before
    expect(caps).not.toContain(STEP_DOWN_CAP);
  } finally { dropEndpoint(fake.url); await fake.close(); }
});
