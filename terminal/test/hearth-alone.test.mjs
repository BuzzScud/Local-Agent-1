// Working alone on hearth (25 Nov 2026, the owner: "can we give it more tools? more permissions? more skills? … i need
// it to be able to do everything alone"). Their picks: its own settings and the App tool open in Bypass there, its own
// questions answered by itself, 300 steps, thinking held by the clock (hearth-see.test.mjs), Claude's notes readable
// (the facts about them still stay on this Mac). The push and stopping processes stay as they were.
import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-hearth-alone-home-'));

const { Agent } = await import('../src/agent/agent.mjs');
const { ALONE_NOTE, OWN_OPEN, BYPASS_OPEN } = await import('../src/agent/agent-said.mjs');
const { MODELS, DEFAULT_MODEL, setEndpoint, dropEndpoint } = await import('../../models/index.mjs');
const { fakeOllama } = await import('./fake-ollama.mjs');

const local = MODELS[DEFAULT_MODEL];
const model = { ...local, remote: { model: 'coder:30b' } };
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agentic-hearth-alone-')); });

// An agent on a pretend service; ask: what answers a question put to the user (counted).
const on = (url, { hearth = true, mode = 'bypass', ask } = {}) => {
  setEndpoint(url, { remote: true, kind: 'openai', ollama: true, hearth, thinks: true, model: 'coder:30b', numCtx: 65536, keepAlive: -1, free: true });
  return new Agent({ url, model, cwd: dir, system: 'x', memory: false, flows: false, mode, way: 'model', hooks: [], thinking: false, ctx: 65536, ask });
};

test('alone is Bypass on hearth: another mode, another service, "alone": false or AGENTIC_ALONE=off ask you as before', () => {
  const url = 'http://127.0.0.1:9/alone-a';
  const other = 'http://127.0.0.1:9/alone-b';
  try {
    const a = on(url);
    expect(a.aloneOn()).toBe(true);
    expect(a.ownOn()).toBe(true);
    expect(a.selfOn()).toBe(false);
    a.mode = 'auto';
    expect([a.aloneOn(), a.ownOn()]).toEqual([false, false]);
    a.mode = 'bypass';
    a.alone = false;
    expect([a.aloneOn(), a.ownOn()]).toEqual([false, true]); // the setting turns only the questions back on
    a.alone = true;
    process.env.AGENTIC_ALONE = 'off';
    expect(a.aloneOn()).toBe(false);
    delete process.env.AGENTIC_ALONE;
    const b = on(other, { hearth: false });
    expect([b.aloneOn(), b.ownOn()]).toEqual([false, false]);
  } finally { delete process.env.AGENTIC_ALONE; dropEndpoint?.(url); dropEndpoint?.(other); }
});

test('its own question is answered by the app: nobody is asked, the recommended choice is named, and the work goes on', async () => {
  const url = 'http://127.0.0.1:9/alone-c';
  let asked = 0;
  try {
    const a = on(url, { ask: async () => { asked++; return { choice: 'yes', text: 'Red' }; } });
    a.turn = { asked: [] };
    const seen = [];
    a.on('tool', (e) => seen.push(e));
    a.on('note', (e) => seen.push({ note: e.text }));
    const r = await a.runStep({ id: 'q1', name: 'Ask', args: JSON.stringify({ question: 'Which colour for the header?', options: ['Blue (Recommended)', 'Red'] }) });
    expect(asked).toBe(0);
    expect(r.error).toBeFalsy();
    expect(r.stop).toBeUndefined();
    expect(r.text).toContain('Nobody is here to answer: you are working alone');
    expect(r.text).toContain('Which colour for the header? → take the choice you marked as recommended: Blue');
    expect(r.text).toContain('do not ask again');
    expect(r.text).toContain('do not do a different task instead');
    expect(a.turn.askedUser).toBe(true);
    expect(a.turn.alone).toEqual(['Which colour for the header?']);
    expect(seen.find((e) => e.view?.kind === 'answer').view.text).toBe('left to it (working alone): Blue');
    expect(seen.some((e) => /Working alone: it answers its own question and goes on \(shift\+tab to another mode and it asks you again\)/.test(e.note ?? ''))).toBe(true);
    // Several at once, none marked: each is named, the safest is asked for.
    const two = await a.runStep({ id: 'q2', name: 'Ask', args: JSON.stringify({ question: 'Delete the old folder?', options: ['Yes', 'No'], more: [{ question: 'What should the file be called?' }] }) });
    expect(two.text).toContain('1. Delete the old folder? → take the safest of your choices');
    expect(two.text).toContain('2. What should the file be called? → decide it yourself, the safest way');
    expect(asked).toBe(0);
    // Another mode: the question comes to you.
    a.mode = 'auto';
    const put = await a.runStep({ id: 'q3', name: 'Ask', args: JSON.stringify({ question: 'Which colour?', options: ['Blue', 'Red'] }) });
    expect(asked).toBe(1);
    expect(put.text).toContain('The user answered: Red');
  } finally { dropEndpoint?.(url); }
});

test('the note with a request says what is open on hearth, and that it works alone only while it does; the App tool is offered there', async () => {
  expect(OWN_OPEN).toContain("Agentic Coder's own settings, rules, skills, hooks and memory may change too");
  expect(OWN_OPEN).toContain('the App tool runs its slash commands');
  expect(OWN_OPEN).toContain('A git push and removing a model from Ollama ask the user first');
  expect(OWN_OPEN).toContain('stopping processes');
  expect(BYPASS_OPEN).toContain("Still refused: opening key files outside the project yourself (ssh's keys, .env), Agentic Coder's own settings");
  for (const t of [OWN_OPEN, BYPASS_OPEN]) expect(t).toContain('and so may a certificate (a .pem or .crt with no key in it)');
  // What one request carries, on a stand-in service.
  const sent = async ({ hearth = true, alone } = {}) => {
    const svc = await fakeOllama({});
    try {
      const a = on(svc.url, { hearth });
      if (alone !== undefined) a.alone = alone;
      expect(await a.send('hello')).toBe('done');
      const body = svc.seen.filter((x) => x.path === '/api/chat').map((x) => x.body)[0];
      return { said: body.messages.map((m) => String(m.content)).join('\n'), tools: (body.tools ?? []).map((t) => t.function.name) };
    } finally { dropEndpoint?.(svc.url); await svc.close?.(); }
  };
  const here = await sent();
  expect(here.said).toContain(OWN_OPEN);
  expect(here.said).toContain(ALONE_NOTE);
  expect(here.tools).toContain('App');
  const asking = await sent({ alone: false });
  expect(asking.said).toContain(OWN_OPEN);
  expect(asking.said).not.toContain(ALONE_NOTE);
  const elsewhere = await sent({ hearth: false });
  expect(elsewhere.said).toContain(BYPASS_OPEN);
  expect(elsewhere.said).not.toContain(OWN_OPEN);
  expect(elsewhere.said).not.toContain(ALONE_NOTE);
  expect(elsewhere.tools).not.toContain('App');
});

test("Claude's notes: all of them may be seen on hearth, the project's own on another service, none when Memory sent is none", async () => {
  const { memorySent } = await import('../src/agent/opening.mjs');
  const url = 'http://127.0.0.1:9/alone-notes-a';
  const other = 'http://127.0.0.1:9/alone-notes-b';
  try {
    const a = on(url);
    const b = on(other, { hearth: false });
    // What Memory sent says for a service that is not the owner's own machine: the project's own.
    expect(memorySent(a.model, 'mine')).toBe('project');
    expect(a.notesSent()).toBe('all');
    expect(b.notesSent()).toBe('project');
    // On this Mac nothing is held back, as before.
    const here = new Agent({ url: 'http://127.0.0.1:9', model: local, cwd: dir, system: 'x', memory: false, flows: false, hooks: [] });
    expect(here.notesSent()).toBe('all');
  } finally { dropEndpoint?.(url); dropEndpoint?.(other); }
});
