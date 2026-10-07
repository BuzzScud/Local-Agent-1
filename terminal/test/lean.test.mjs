// The lean harness (way.mjs; 4 Oct 2026, the owner, shown Claude Code's own harness beside this one: "can we
// make it just like this?"): one switch that leaves the instructions, the model deciding every step, the
// permissions, your own hooks and the notes when memory fills, and takes away every one of the app's checks,
// Look first, the reminders and the put-back. Off unless set, and then nothing is different.
import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-lean-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { Agent } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { leanFrom, LEAN_LINES, LEAN_NOTE, LEAN_AUTO, LEAN_AUTO_NOTE, HOOKS, MODEL_HOOKS } = await import('../src/agent/way.mjs');
const { checkOn, openHooksList } = await import('../src/app/hooks-form.mjs');
const { runHeadless } = await import('../src/headless.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');

const remote = { ...MODELS[DEFAULT_MODEL], remote: { kind: 'openai', label: 'the service', ollama: '0.12.0' } };
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentic-lean-'));
  // A project whose tests always fail: on the full harness a change here is sent back and put back.
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'mini', type: 'module', scripts: { test: 'exit 1' } }));
  writeFileSync(join(dir, 'lib.mjs'), 'export const f = (x) => x;\n');
});
const sys = () => systemPrompt({ cwd: dir, git: 'none' });
const agentOn = (url, extra = {}) => new Agent({ url, model: remote, cwd: dir, system: sys(), memory: false, flows: false, mode: 'bypass', confirmPlan: false, way: 'model', hooks: MODEL_HOOKS, thinking: false, ctx: 131072, ask: async () => ({ choice: 'yes' }), ...extra });

test('the switch: settings.json "lean", and AGENTIC_LEAN over it; with neither, the model decides (auto)', () => {
  expect(leanFrom({}, {})).toBe(LEAN_AUTO);
  expect(leanFrom({ lean: true }, {})).toBe(true);
  expect(leanFrom({ lean: false }, {})).toBe(false);
  expect(leanFrom({ lean: true }, { AGENTIC_LEAN: 'off' })).toBe(false);
  expect(leanFrom({}, { AGENTIC_LEAN: 'on' })).toBe(true);
});

// 7 Oct 2026, the owner's pick: lean on Claude unless they chose. The app's checks stepped in 11 times in
// one 43-reply run on Claude Opus 5.5.
const claude = { ...MODELS[DEFAULT_MODEL], id: 'remote', remote: { kind: 'claude', label: 'Claude API', model: 'claude-opus-5-5' } };
test('auto: lean on a Claude model, the full harness on any other, and it follows the model from the next message', () => {
  const onClaude = agentOn('http://127.0.0.1:1', { model: claude, lean: LEAN_AUTO, way: 'app' });
  expect([onClaude.lean, onClaude.way]).toEqual([true, 'model']);
  expect(onClaude.messages[0].content).toContain(LEAN_LINES);
  const onService = agentOn('http://127.0.0.1:1', { lean: LEAN_AUTO, way: 'app' });
  expect([onService.lean, onService.way]).toEqual([false, 'app']);
  // /remote switches it to Claude: lean from the next message, with a line that says so…
  const notes = [];
  onService.on('note', (n) => notes.push(n.text));
  onService.model = claude;
  onService.leanNow();
  expect([onService.lean, onService.way]).toEqual([true, 'model']);
  expect(notes).toEqual([LEAN_AUTO_NOTE]);
  onService.leanNow();
  expect(notes).toHaveLength(1); // once, not at every message
  // …and back to the service: the checks again, and Who decides as /effort had it.
  onService.model = remote;
  onService.leanNow();
  expect([onService.lean, onService.way]).toEqual([false, 'app']);
  expect(onService.messages[0].content).not.toContain(LEAN_LINES);
  // A choice holds for every model: /hooks full on Claude (as the app does it) stays full.
  onClaude.leanAuto = false;
  onClaude.setLean(false);
  onClaude.setWay('app');
  onClaude.leanNow();
  expect([onClaude.lean, onClaude.way]).toEqual([false, 'app']);
  // A plain Agent (a test, a practice run) is as before: no lean unless asked.
  expect(agentOn('http://127.0.0.1:1', { model: claude }).lean).toBe(false);
});

test('lean: none of the app\'s checks, no look first, no reminders, nothing put back; full: as before', () => {
  const full = agentOn('http://127.0.0.1:1');
  const lean = agentOn('http://127.0.0.1:1', { lean: true, hooks: HOOKS.map((h) => h.id), way: 'app' });
  expect(lean.way).toBe('model');
  for (const h of HOOKS) expect(lean.hook(h.id)).toBe(false);
  expect(MODEL_HOOKS.every((id) => full.hook(id))).toBe(true);
  for (const a of [full, lean]) {
    a.look = 30;
    a.todos = [{ text: 'one', status: 'in_progress' }, { text: 'two', status: 'pending' }];
    a.turn = { planAt: 0, steps: 20, requestAt: 0, request: 'add g to lib.mjs', originals: new Map([['lib.mjs', 'x']]), checkFailed: true };
  }
  expect(full.lookSecsNow).toBe(30);
  expect(lean.lookSecsNow).toBe(0);
  expect(full.planDue([])).toContain('one');
  expect(lean.planDue([])).toBe('');
  expect(full.requestDue()).toContain('add g to lib.mjs');
  expect(lean.requestDue()).toBe('');
  expect(full.putBackWhy('done')).toBe('The check failed');
  expect(lean.putBackWhy('done')).toBeNull();
  // The panel's rows say off, each one.
  expect(checkOn(openHooksList({ checks: MODEL_HOOKS, way: 'model', lean: true }), HOOKS.find((h) => h.id === 'tests'))).toBe(false);
  expect(checkOn(openHooksList({ checks: MODEL_HOOKS, way: 'model' }), HOOKS.find((h) => h.id === 'tests'))).toBe(true);
});

test('its instructions gain the lines on checking its own work, and lose them again; off, they are the same letter for letter', () => {
  // (An agent on a model on another machine builds its instructions from the remote set as it starts.)
  const full = agentOn('http://127.0.0.1:1');
  const base = full.messages[0].content;
  expect(base).not.toContain(LEAN_LINES);
  const lean = agentOn('http://127.0.0.1:1', { lean: true });
  expect(lean.messages[0].content).toBe(`${base.replace(/\s+$/, '')}\n\n${LEAN_LINES}\n`);
  // Who decides stays Model while it is on.
  expect(lean.setWay('app')).toBe(false);
  expect(lean.way).toBe('model');
  expect(lean.setLean(false)).toBe(true);
  expect(lean.messages[0].content).not.toContain(LEAN_LINES);
  expect(lean.messages[0].content.trimEnd()).toBe(base.trimEnd());
  expect(full.setLean(true)).toBe(true);
  expect(full.setLean(true)).toBe(false);
  expect(full.messages[0].content).toContain(LEAN_LINES);
  full.setSystem(sys()); // a rebuild of the instructions keeps them
  expect(full.messages[0].content).toContain(LEAN_LINES);
});

test('a change in a project whose tests fail: on lean the answer stands and the file stays; nothing is run or sent back', async () => {
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'more.mjs', content: 'export const g = (x) => x;\n' } } },
    { text: 'Added g in more.mjs. I did not run the tests.' }, { text: 'again' }, { text: 'again' },
  ]);
  try {
    const a = agentOn(fake.url, { lean: true });
    const notes = [];
    a.on('note', (e) => notes.push(e.text));
    expect(await a.send('add g')).toBe('done');
    expect(fake.requests.filter((r) => r.stream && r.messages)).toHaveLength(2);
    expect(a.messages.at(-1).content).toBe('Added g in more.mjs. I did not run the tests.');
    expect(existsSync(join(dir, 'more.mjs'))).toBe(true);
    expect(notes).toContain(LEAN_NOTE);
    expect(notes.some((t) => /put back|Checking the change|Looking first|cases/i.test(t))).toBe(false);
    expect(a.messages.filter((m) => m.role === 'user')).toHaveLength(1); // only your request
  } finally { await fake.close(); }
});

test('coding -p and the benches: lean runs say so', async () => {
  const fake = await startFakeServer([{ text: 'Hello.' }, { text: 'Hello.' }]);
  try {
    const r = await runHeadless({ prompt: 'say hello', cwd: dir, url: fake.url, model: remote, thinking: false, flows: false, autoApprove: true, way: 'app', hooks: MODEL_HOOKS, lean: true });
    expect(r.lean).toBe(true);
    expect(r.way).toBe('model');
    expect(r.hooks).toEqual([]);
  } finally { await fake.close(); }
});

test('/hooks lean and /hooks full in the window', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ text: 'ok' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--way', 'model'], steps: [
    { wait: '? for shortcuts' },
    { type: '/hooks lean' }, { key: 'enter' }, { wait: 'Lean harness on' }, { sleep: 200 },
    { type: '/hooks' }, { key: 'enter' }, { wait: 'Hooks ·' }, { sleep: 200 }, { snapshot: 'lean' }, { key: 'esc' }, { sleep: 300 },
    { type: '/hooks full' }, { key: 'enter' }, { wait: 'Full harness on' }, { sleep: 200 },
    { type: '/hooks' }, { key: 'enter' }, { wait: 'on while the model decides' }, { sleep: 200 }, { snapshot: 'full' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.lean).toMatch(/Hooks · all off: the lean harness/);
  expect(r.snapshots.lean).toMatch(/off\s+Tests after a change/);
  expect(r.snapshots.lean).not.toMatch(/\d\s+on\s+/);
  expect(r.snapshots.full).toMatch(/Hooks · 15 of 23 on while the model decides/);
  expect(r.snapshots.full).toMatch(/on\s+Tests after a change/);
}, T);
