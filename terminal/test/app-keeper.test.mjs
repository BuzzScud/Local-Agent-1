// The app the way a window really runs it since 3 Oct 2026: inside a keeper (sessions.mjs), the window
// only showing it and sending the keys. The other app tests switch that off (test-env.mjs:
// AGENTIC_SESSIONS=off), so they drive the app in its own window. These drive the everyday things
// through the keeper: a message and its reply, a paste, a picture dragged in, /clear, the menus before
// the app and typing after them, a mouse drag. Each ends with the app quitting and no keeper left behind.
// Elsewhere, also through the keeper: ctrl+b and coding attach (sessions.test.mjs), a resize
// (resize.test.mjs, on its own resizable terminal) and /update's restart (update.test.mjs, with the launcher).
import { test, expect, afterEach } from 'bun:test';
import { cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInPty, emulate } from './pty.mjs';
import { T, setup, quit, quitTyped } from './app-setup.mjs';
import { startFakeServer } from './fake-server.mjs';
import { MOUSE_ON, ASK_CURSOR } from '../src/app/mouse.mjs';

import { needs } from './needs.mjs';

const S = await import('../src/app/sessions.mjs');
const { textImage, mediaTool } = await import('../src/tools/media.mjs');

const homes = [];
// Every keeper a test left running is stopped (a test that passes leaves none).
afterEach(() => {
  for (const h of homes.splice(0)) for (const f of records(h)) { try { process.kill(JSON.parse(readFileSync(join(h, 'background', f), 'utf8')).pid, 'SIGKILL'); } catch {} }
});
const records = (home) => { try { return readdirSync(join(home, 'background')).filter((f) => f.endsWith('.json')); } catch { return []; } };
async function until(fn, ms = 15_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  return false;
}
const QUIET = { AGENTIC_NO_OPEN: '1', AGENTIC_FETCH_EVERY: '0', AGENTIC_CLAUDE_NOTES: 'off', AGENTIC_TIPS: 'off', TERM: 'xterm-256color', AGENTIC_SESSIONS: 'on', AGENTIC_MEMORY_SAVE: 'off' };
function keeperEnv() {
  const { cwd, env, base } = setup();
  homes.push(env.AGENTIC_HOME);
  return { cwd, base, home: env.AGENTIC_HOME, env: { ...env, ...QUIET } };
}
// The app ran in a keeper (its record was there while it ran), and none is left once it has quit.
const ranInKeeper = async (home, seen) => { expect(seen.record).toEqual(['demo-project-1.json']); expect(await until(() => records(home).length === 0)).toBe(true); };
const noteRecord = (home, seen) => ({ fn: () => { seen.record = records(home); } });
const PASTE = (t) => `\x1b[200~${t}\x1b[201~`;
const userTexts = (fake) => (fake.requests.at(-1)?.messages ?? []).filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : (m.content ?? []).map((c) => c.text ?? '').join('')));

test.skipIf(!S.canHost())('through the keeper: a message gets its reply, ctrl+c twice quits, and no keeper is left', async () => {
  const { cwd, env, home } = keeperEnv();
  const fake = await startFakeServer([{ text: 'Hello from KEEPER-REPLY.' }]);
  const seen = {};
  try {
    const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
      { wait: '? for shortcuts', ms: 30_000 }, noteRecord(home, seen), { type: 'say hello' }, { key: 'enter' },
      { wait: 'KEEPER-REPLY', ms: 20_000 }, { sleep: 400 }, { snapshot: 'replied' }, ...quit,
    ] });
    expect(r.snapshots.replied).toContain('say hello');
    expect(r.code).toBe(0);
    expect(r.text).toContain('Continue this conversation with');
    await ranInKeeper(home, seen);
  } finally { await fake.close(); }
}, T);

test.skipIf(!S.canHost() || needs('pictures', mediaTool))('through the keeper: a picture dragged in (its path, as a paste) is [Image #1] with its card over the box, and goes to the model as a picture', async () => {
  const { cwd, env, home, base } = keeperEnv();
  const shot = join(base, 'drop shot.png');
  textImage(shot, 'DROP 7', { w: 800, h: 400 });
  const fake = await startFakeServer([{ text: 'DROP-REPLY.' }], { vision: true });
  const seen = {};
  try {
    const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
      { wait: '? for shortcuts', ms: 30_000 }, noteRecord(home, seen), { sleep: 300 }, { type: 'what does it say ' },
      { key: PASTE(shot.replace(/ /g, '\\ ')) }, { wait: 'drop shot.png' }, { sleep: 400 }, { snapshot: 'box' },
      { key: '\r' }, { wait: 'DROP-REPLY', ms: 20_000 }, { sleep: 300 }, ...quit,
    ] });
    expect(r.snapshots.box).toContain('> what does it say [Image #1]');
    expect(r.snapshots.box).toContain('800×400');
    const req = fake.requests.find((q) => q.stream && JSON.stringify(q.messages).includes('what does it say [Image #1]'));
    expect((req?.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content.filter((c) => c.type === 'image_url') : []))).toHaveLength(1);
    expect(r.code).toBe(0);
    await ranInKeeper(home, seen);
  } finally { await fake.close(); }
}, T);

test.skipIf(!S.canHost())('through the keeper: a paste of two lines lands whole in the prompt box and reaches the model as written', async () => {
  const { cwd, env, home } = keeperEnv();
  const fake = await startFakeServer([{ text: 'PASTE-REPLY.' }]);
  const seen = {};
  const pasted = 'first line of the paste, with a comma\nsecond line: the end';
  try {
    const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
      { wait: '? for shortcuts', ms: 30_000 }, noteRecord(home, seen), { sleep: 300 },
      { key: PASTE(pasted) }, { sleep: 400 }, { snapshot: 'box' }, { key: '\r' }, { wait: 'PASTE-REPLY', ms: 20_000 }, { sleep: 300 }, ...quit,
    ] });
    expect(r.snapshots.box).toContain('first line of the paste, with a comma');
    expect(r.snapshots.box).toContain('second line: the end');
    expect(userTexts(fake).some((t) => t.includes(pasted))).toBe(true);
    expect(r.code).toBe(0);
    await ranInKeeper(home, seen);
  } finally { await fake.close(); }
}, T);

test.skipIf(!S.canHost())('through the keeper: /clear wipes the screen and shows the start page again', async () => {
  const { cwd, env, home } = keeperEnv();
  const fake = await startFakeServer([{ text: 'The answer is PINEAPPLE-42.' }]);
  const seen = {};
  try {
    const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
      { wait: '? for shortcuts', ms: 30_000 }, noteRecord(home, seen), { type: 'what is two plus two' }, { key: 'enter' },
      { wait: 'PINEAPPLE-42', ms: 20_000 }, { sleep: 800 }, { snapshot: 'before' },
      { type: '/clear' }, { key: 'enter' }, { sleep: 1500 }, { snapshot: 'cleared' }, ...quit,
    ] });
    expect(r.snapshots.before).toContain('PINEAPPLE-42');
    expect(r.snapshots.cleared).not.toContain('PINEAPPLE-42');
    expect(r.snapshots.cleared).toContain('Recent activity');
    expect(r.snapshots.cleared).toContain('? for shortcuts');
    expect(r.code).toBe(0);
    await ranInKeeper(home, seen);
  } finally { await fake.close(); }
}, T);

// The way a new Terminal window starts: coding typed in the home folder, enter on Where to start, enter
// on the safety check, then typing (2 Oct 2026, "it won't let me type": the menus and the prompt box
// read the same keys, here with the keeper between them and the window).
test.skipIf(!S.canHost())('through the keeper: enter through where to start and the safety check, then typing reaches the prompt box', async () => {
  const base = mkdtempSync(join(tmpdir(), 'agentic-e2e-'));
  const home = join(base, 'home-folder');
  const repo = join(home, 'agentic-coder');
  cpSync(join(import.meta.dir, '..', 'demo-project'), repo, { recursive: true });
  mkdirSync(join(repo, 'terminal', 'src'), { recursive: true });
  writeFileSync(join(repo, 'terminal', 'src', 'cli.jsx'), '');
  const appHome = join(base, 'home');
  homes.push(appHome);
  const env = { ...QUIET, HOME: home, AGENTIC_HOME: appHome, AGENTIC_REPO: repo }; // no trust seeded, no model
  const seen = {};
  const r = await runInPty({ cwd: home, env, args: ['--no-flows'], steps: [
    { wait: 'Where should it work?', ms: 30_000 }, { sleep: 200 }, { key: 'enter' },
    { wait: 'Quick safety check' }, { sleep: 200 }, { key: 'enter' },
    { wait: '? for shortcuts', ms: 30_000 }, { fn: () => { seen.record = records(appHome); } }, { sleep: 1000 },
    { type: 'hello there' }, { wait: '> hello there' }, { snapshot: 'typed' }, ...quitTyped,
  ] });
  expect(r.snapshots.typed).toMatch(/where\s+~ · your home folder/);
  expect(seen.record).toHaveLength(1); // the app, its menus too, ran in a keeper (named after the folder)
  expect(r.code).toBe(0);
  expect(await until(() => records(appHome).length === 0)).toBe(true);
}, T);

const cellOf = (term, word) => {
  const b = term.buffer.active;
  for (let r = 0; r < term.rows; r++) {
    const x = (b.getLine(b.baseY + r)?.translateToString(true) ?? '').indexOf(word);
    if (x >= 0) return { col: x + 1, row: r + 1 };
  }
  throw new Error(`"${word}" is not on the screen`);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// A press, then the terminal's part: the app asks where the cursor is and is told (through the keeper
// both ways: the question comes out to the window, the answer goes back in).
const press = async ({ write, raw }, at) => {
  const asked = raw().split(ASK_CURSOR).length;
  write(`\x1b[<0;${at.col};${at.row}M`);
  for (let i = 0; i < 100 && raw().split(ASK_CURSOR).length === asked; i++) await pause(10);
  const now = raw();
  const b = (await emulate(now.slice(0, now.lastIndexOf(ASK_CURSOR)), 80, 24)).buffer.active;
  write(`\x1b[${b.cursorY + 1};${b.cursorX + 1}R`);
};

test.skipIf(!S.canHost())('through the keeper: /mouse on, and a drag in the prompt box highlights and copies what it covered', async () => {
  const { cwd, env, home, base } = keeperEnv();
  const clip = join(base, 'clipboard.txt');
  const fake = await startFakeServer([]);
  const P = 'alpha bravo charlie delta echo foxtrot golf hotel';
  const picked = P.slice(P.indexOf('charlie'), P.indexOf('golf'));
  const seen = {};
  try {
    const r = await runInPty({ cwd, cols: 80, rows: 24, env: { ...env, AGENTIC_CLIPBOARD: clip }, args: ['--url', fake.url, '--no-flows'], steps: [
      { wait: '? for shortcuts', ms: 30_000 }, noteRecord(home, seen), { sleep: 300 },
      { type: '/mouse on' }, { key: 'enter' }, { wait: 'Mouse on' },
      { type: P }, { sleep: 400 },
      { fn: async (t) => {
        seen.mouseAsked = t.raw().includes(MOUSE_ON); // the app's request for the mouse reached the window
        const term = await t.screen();
        const from = cellOf(term, 'charlie'), to = cellOf(term, 'golf');
        await press(t, from);
        await pause(60);
        t.write(`\x1b[<32;${to.col};${to.row}M`); await pause(30);
        t.write(`\x1b[<0;${to.col};${to.row}m`);
      } },
      { wait: `copied ${picked.length} chars to clipboard` }, { fn: () => { seen.clip = readFileSync(clip, 'utf8'); } },
      ...quitTyped,
    ] });
    expect(seen.mouseAsked).toBe(true);
    expect(seen.clip).toBe(picked);
    expect(r.code).toBe(0);
    await ranInKeeper(home, seen);
  } finally { await fake.close(); }
}, T);

test.skipIf(!S.canHost())('through the keeper: /remote, → to a saved service, ↑ lands on Connect and enter connects (the owner’s keys of 3 Oct)', async () => {
  const { cwd, env, home } = keeperEnv();
  const { fakeOllama } = await import('./fake-ollama.mjs');
  const svc = await fakeOllama();
  const saved = { source: 'openai', address: svc.url, port: null, connect: 'http', kind: 'openai', model: 'coder:30b', context: 0, key: false, keyEnd: '', keyId: 'openai' };
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ remote: { ...saved, use: false }, remotes: { openai: saved } }));
  const seen = {};
  try {
    const r = await runInPty({ cwd, env: { ...env, AGENTIC_MODEL_AT_START: 'off', AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: '', ANTHROPIC_API_KEY: '' }, args: ['--no-flows'], timeoutMs: 60_000, steps: [
      { wait: '? for shortcuts', ms: 30_000 }, noteRecord(home, seen), { sleep: 300 },
      { type: '/remote' }, { key: '\r' }, { wait: 'Remote model' }, { sleep: 200 },
      { key: '\x1b[C' }, { sleep: 100 }, { key: '\x1b[C' }, { sleep: 100 }, { key: '\x1b[C' }, { sleep: 200 },
      { key: '\x1b[A' }, { sleep: 250 }, { snapshot: 'up' },
      { key: '\r' }, { wait: 'On the remote:', ms: 20_000 }, { sleep: 300 }, { snapshot: 'on' }, ...quit,
    ] });
    expect(r.snapshots.up).toMatch(/❯\s+Connect\s+Save only/);
    expect(r.snapshots.on.replace(/\s+/g, ' ')).toContain('On the remote: coder:30b');
    await ranInKeeper(home, seen);
  } finally { await svc.close(); }
}, T);
