// Loops end to end (src/app/loops.mjs, loop-run.mjs, loops-board.mjs), with a stand-in model:
// one run as its window starts it (it asks, takes a note, ends the loop), the half-fix a run may
// keep, and the app itself in a pseudo-terminal with its board in a second one.
// What a loop is and when it runs, without the app: loops.test.mjs.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { runInPty } from './pty.mjs';
import { T, setup, seedTrust, quit } from './app-setup.mjs';
import { startFakeServer } from './fake-server.mjs';

// A throwaway home before the models part is imported (it reads AGENTIC_HOME once).
process.env.AGENTIC_HOME = join(mkdtempSync(join(tmpdir(), 'agentic-app-loops-')), 'home');
const L = await import('../src/app/loops.mjs');
const cli = join(import.meta.dir, '..', 'src', 'cli.jsx');
const self = [process.execPath, cli];

// One run started the way a window starts it; answers every question with `answer` (or what
// onAsk returns), and gives back everything the run said.
function runOnce(spec, { env, answer = 'yes', onAsk = null, ms = 40_000 } = {}) {
  return new Promise((resolve) => {
    const h = L.startRun({ mode: 'ask', flows: false, allow: [], owner: process.pid, ...spec }, { self, env: { ...process.env, ...env } });
    const seen = [];
    const timer = setTimeout(() => { h.kill(); resolve({ seen, timedOut: true }); }, ms);
    h.on((ev) => {
      seen.push(ev);
      if (ev.t === 'ask') { const a = onAsk?.(ev, h) ?? answer; h.send({ t: 'answer', id: ev.id, choice: a }); }
      if (ev.t === 'end') { clearTimeout(timer); resolve({ seen, end: ev }); }
    });
  });
}

test('one run: it asks before a command, a yes lets it go on, a note typed meanwhile is its next message, and "always" covers that command in the loop\'s later runs', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([
    { tool: { name: 'Bash', args: { command: 'touch made.txt', description: 'make a file' } } },
    { text: 'Made the file.' },
    { text: 'Noted: nothing more to do.\nLOOP DONE' },
    { tool: { name: 'Bash', args: { command: 'touch made.txt', description: 'make a file' } } },
    { text: 'Made it again.' },
  ]);
  try {
    const r = await runOnce({ folder: cwd, prompt: 'Make a file called made.txt.\n\n(Run 1 of a loop.)', url: fake.url }, { env, onAsk: (ev, h) => { h.send({ t: 'note', text: 'also say nothing more' }); return 'always'; } });
    expect(r.timedOut).toBeFalsy();
    const ask = r.seen.find((e) => e.t === 'ask');
    expect(ask).toMatchObject({ kind: 'permission', name: 'Bash', text: 'May it run: touch made.txt', always: 'this command', sig: 'Bash:touch made.txt' });
    expect(r.seen.map((e) => e.t)).toEqual(['ask', 'tool', 'text', 'text', 'end']); // nothing ran before the yes
    expect(r.seen.find((e) => e.t === 'tool')).toMatchObject({ label: 'Bash', arg: 'touch made.txt', error: false, test: false });
    expect(existsSync(join(cwd, 'made.txt'))).toBe(true);
    // The note was the next message of the same conversation, sent when the first turn ended.
    expect(fake.requests.at(-1).messages.filter((m) => m.role === 'user').map((m) => m.content).at(-1)).toBe('also say nothing more');
    expect(r.end).toMatchObject({ reason: 'done', final: 'Noted: nothing more to do.\nLOOP DONE' });
    expect(L.readEnding(r.end.final)).toMatchObject({ done: true, said: 'Noted: nothing more to do.' });
    // A later run of the loop is told what "always" covers, and is not asked.
    const again = await runOnce({ folder: cwd, prompt: 'Make a file called made.txt.\n\n(Run 2 of a loop.)', url: fake.url, allow: ['Bash:touch made.txt'] }, { env });
    expect(again.seen.map((e) => e.t)).toEqual(['tool', 'text', 'end']);
    expect(again.end.reason).toBe('done');
  } finally { await fake.close(); }
}, T);

test('a no stops that step and the run says so; a run whose window is gone ends', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ tool: { name: 'Bash', args: { command: 'touch nope.txt', description: 'make a file' } } }, { text: 'I did not make the file.' }]);
  try {
    const r = await runOnce({ folder: cwd, prompt: 'Make a file called nope.txt.', url: fake.url }, { env, answer: 'no' });
    expect(existsSync(join(cwd, 'nope.txt'))).toBe(false);
    expect(r.end.t).toBe('end');
    expect(r.seen.some((e) => e.t === 'tool' && !e.error && e.label === 'Bash')).toBe(false);
  } finally { await fake.close(); }
  // No model there at all: the run ends with why, and the board has a line to show.
  const dead = await runOnce({ folder: cwd, prompt: 'Say hi.', url: 'http://127.0.0.1:9' }, { env, ms: 60_000 });
  expect(dead.end).toMatchObject({ t: 'end', reason: 'error' });
  expect(String(dead.end.final).length).toBeGreaterThan(3);
}, T * 2);

// ---- the half-fix a loop's run keeps (agent.mjs madeProgress) ----
const SUM = "export const add = (a, b) => a - b;\nexport const mul = (a, b) => a + b;\nexport const div = (a, b) => a * b;\nexport const sub = (a, b) => a - b;\n";
const SUM_TEST = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add, mul, div, sub } from './sum.mjs';\ntest('add adds', () => assert.equal(add(2, 3), 5));\ntest('mul multiplies', () => assert.equal(mul(2, 3), 6));\ntest('div divides', () => assert.equal(div(6, 3), 2));\ntest('sub subtracts', () => assert.equal(sub(5, 3), 2));\n";
function sumProject() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-loop-fix-')));
  const cwd = join(base, 'sum');
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, 'sum.mjs'), SUM);
  writeFileSync(join(cwd, 'sum.test.mjs'), SUM_TEST);
  seedTrust(base, cwd);
  return { cwd, env: { AGENTIC_HOME: join(base, 'home') } };
}
// The model runs the tests, reads the file, makes one change, runs the tests again, and says what is left.
const script = (edit) => [
  { tool: { name: 'Bash', args: { command: 'node --test', description: 'run the tests' } } },
  { tool: { name: 'Read', args: { path: 'sum.mjs' } } },
  { tool: { name: 'Edit', args: { path: 'sum.mjs', ...edit } } },
  { tool: { name: 'Bash', args: { command: 'node --test', description: 'run the tests again' } } },
  { text: 'Some tests still fail.' },
];

test('a loop\'s run keeps a half-fix when fewer tests fail and none fails newly; a change that breaks a passing test goes back; outside a loop every half-fix goes back', async () => {
  // Three of four fail. The run fixes add only: two still fail, both failed before. It stays.
  const fixAdd = { old_text: 'add = (a, b) => a - b', new_text: 'add = (a, b) => a + b' };
  {
    const { cwd, env } = sumProject();
    const fake = await startFakeServer(script(fixAdd));
    try {
      const r = await runOnce({ folder: cwd, prompt: 'Some tests fail. Fix sum.mjs.', url: fake.url, mode: 'edits' }, { env });
      expect(r.end).toMatchObject({ reason: 'done', tests: { ok: false } });
      expect(r.seen.filter((e) => e.t === 'tool').map((e) => [e.label, e.error, e.test])).toEqual([['Bash', true, true], ['Read', false, false], ['Ask', false, false], ['Update', false, false], ['Bash', true, true]]); // Ask: its plan, said yes to by itself in Accept edits
      expect(readFileSync(join(cwd, 'sum.mjs'), 'utf8')).toContain('add = (a, b) => a + b');
      expect(r.seen.some((e) => e.t === 'note' && /^Kept: 2 of the 3 failing tests still fail and none fails newly/.test(e.text))).toBe(true);
    } finally { await fake.close(); }
  }
  // The run fixes all three but breaks sub, which passed: one test fails, a new one. It goes back.
  {
    const { cwd, env } = sumProject();
    const fake = await startFakeServer(script({ old_text: SUM.trimEnd(), new_text: 'export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\nexport const div = (a, b) => a / b;\nexport const sub = (a, b) => a + b;' }));
    try {
      const r = await runOnce({ folder: cwd, prompt: 'Some tests fail. Fix sum.mjs.', url: fake.url, mode: 'edits' }, { env });
      expect(r.end.reason).toBe('done');
      expect(readFileSync(join(cwd, 'sum.mjs'), 'utf8')).toBe(SUM);
      expect(r.seen.some((e) => e.t === 'note' && /The check failed, so this message's changes were put back: sum\.mjs/.test(e.text))).toBe(true);
      expect(r.seen.some((e) => e.t === 'note' && /^Kept:/.test(e.text))).toBe(false);
    } finally { await fake.close(); }
  }
  // The same half-fix in a plain coding -p (no loop): put back, as before.
  {
    const { cwd, env } = sumProject();
    const fake = await startFakeServer(script(fixAdd));
    try {
      const child = spawn(process.execPath, [cli, '-p', '--yes', '--no-flows', '--url', fake.url, 'Some tests fail. Fix sum.mjs.'], { cwd, env: { ...process.env, ...env, AGENTIC_NO_UPDATE: '1', AGENTIC_MEMORY_SAVE: 'off' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      child.stderr.on('data', (d) => { err += d; });
      await new Promise((r) => child.on('exit', r));
      expect(err).toMatch(/The check failed, so this message's changes were put back: sum\.mjs/);
      expect(readFileSync(join(cwd, 'sum.mjs'), 'utf8')).toBe(SUM);
    } finally { await fake.close(); }
  }
}, T * 2);

// ---- the app, and its board in a second terminal ----
test('/loop in the app: the loop starts and the footer counts it; its run asks on the board, a note and "always" reach it, the next run is not asked; /loop lists and stops; quitting ends the loops and removes their folder', async () => {
  const { cwd, env } = setup();
  const E = { ...env, AGENTIC_LOOP_MIN_SECS: '1' };
  // Every run wants to make a file (which asks in Manual mode), then says so; a note gets "Noted."
  let runs = 0;
  const fake = await startFakeServer([], { route: (json) => {
    const last = json.messages.at(-1);
    if (last.role === 'tool') return { text: 'Made the file.' };
    if (/also/.test(String(last.content))) return { text: 'Noted.' };
    runs++;
    return { tool: { name: 'Bash', args: { command: 'touch made.txt', description: 'make a file' } } };
  } });
  const dir = join(env.AGENTIC_HOME, 'loops');
  let whileOpen = [];
  try {
    const app = runInPty({ cwd, env: E, args: ['--url', fake.url, '--no-flows'], cols: 120, rows: 40, timeoutMs: 110_000, steps: [
      { wait: '? for shortcuts' },
      { type: '/loop' }, { key: 'enter' }, { wait: '/loop 10m <message> sends a message again' },
      { type: '/loop 3s make a file called made.txt' }, { key: 'enter' }, { wait: 'Loop 1 started' }, { sleep: 300 }, { snapshot: 'started' },
      { wait: 'needs you: May it run: touch made.txt', ms: 25_000 }, { sleep: 300 }, { snapshot: 'needs' },
      // The board, in its own terminal, answers; the second run is then not asked and ends by itself.
      { waitGone: '1 needs you', ms: 30_000 },
      { sleep: 9000 },
      { type: '/loop' }, { key: 'enter' }, { wait: 'Loops of this window' }, { sleep: 300 }, { snapshot: 'list' },
      { fn: () => { whileOpen = readdirSync(dir); } },
      { type: '/loop stop' }, { key: 'enter' }, { wait: 'Stopped: make a file called made.txt' }, { sleep: 400 }, { snapshot: 'stopped' },
      ...quit,
    ] });
    // Wait until the window's loop has asked, then open its board.
    for (let i = 0; i < 300 && !(L.listBoards(dir)[0]?.loops ?? []).some((l) => l.current?.needs); i++) await new Promise((r) => setTimeout(r, 100));
    const board = await runInPty({ cwd, env: E, args: ['loops'], cols: 124, rows: 38, timeoutMs: 40_000, steps: [
      { wait: 'asks: May it run: touch made.txt', ms: 10_000 }, { sleep: 300 }, { snapshot: 'asks' },
      { key: 't' }, { type: 'also say nothing more' }, { sleep: 200 }, { snapshot: 'typing' }, { key: 'enter' }, { wait: 'it reads it when its turn ends', ms: 5000 },
      { key: 'a' }, { wait: 'will not ask this again', ms: 5000 },
      { wait: '✓ Noted.', ms: 15_000 }, { sleep: 300 }, { snapshot: 'answered' },
      { key: 'enter' }, { wait: 'back to the loops' }, { sleep: 300 }, { snapshot: 'watch' }, { key: 'esc' }, { sleep: 300 },
      { key: 'q' },
    ] });
    const r = await app;
    // The board: the question above the chat box, the note typed as text, the run's steps after the yes.
    expect(board.snapshots.asks).toMatch(/this window[\s\S]*TASK[\s\S]*make a file called made\.txt/);
    expect(board.snapshots.asks).toMatch(/1 LOOK\s+▯+ ! needs you/);
    expect(board.snapshots.asks).toMatch(/! {2}TASK {2}make a file called ma… asks: May it run: touch made\.txt\s+y yes, this time · a yes, always · n no/);
    expect(board.snapshots.typing).toMatch(/› also say nothing more/);
    expect(board.snapshots.answered).toMatch(/YOU {2}to make a file called …: “also say nothing more”/);
    expect(board.snapshots.answered).toMatch(/you answered “Yes, always \(this command\)”/);
    expect(board.snapshots.answered).toMatch(/3 REPORT\s+▮+ ● Noted\./);
    expect(board.snapshots.watch).toMatch(/> make a file called made\.txt[\s\S]*\? May it run: touch made\.txt[\s\S]*> also say nothing more[\s\S]*⏺ Bash\(touch made\.txt\)[\s\S]*● Made the file\.[\s\S]*● Noted\./);
    expect(board.code).toBe(0);
    expect(board.text).toMatch(/The loop board is closed\. The loops go on in their window/);
    // The app: what /loop said, the footer's count, the list, the stop.
    expect(r.snapshots.started).toMatch(/↻ Loop 1 started: make a file called made\.txt · task · every 3s/);
    expect(r.snapshots.started).toMatch(/it ends when this window closes/);
    expect(r.snapshots.started).toMatch(/↻ 1 loop/);
    expect(r.snapshots.needs).toMatch(/↻ 1 loop · 1 needs you/);
    expect(r.snapshots.list).toMatch(/1\. make a file called made\.txt · task · every 3s · /);
    expect(r.snapshots.stopped).not.toMatch(/↻ 1 loop/); // a stopped loop is not counted
    expect(existsSync(join(cwd, 'made.txt'))).toBe(true);
    expect(runs).toBeGreaterThanOrEqual(2); // it ran again by itself, and "always" meant no second question
    expect((r.text.match(/needs you: May it run/g) ?? []).length).toBe(1);
    expect(whileOpen).toHaveLength(1); // one folder, named by the window's pid, while it was open
    expect(r.code).toBe(0);
    expect(readdirSync(dir)).toEqual([]); // gone with the window
  } finally { await fake.close(); }
}, 150_000);

test('coding loops with no loop anywhere says how to make one', async () => {
  const { cwd, env } = setup();
  const r = await runInPty({ cwd, env, args: ['loops'], cols: 100, rows: 30, timeoutMs: 20_000, steps: [{ sleep: 1500 }] });
  expect(r.text).toMatch(/No coding window has a loop now\. In a coding window, type: \/loop 10m <message>/);
  expect(r.code).toBe(0);
}, T);
