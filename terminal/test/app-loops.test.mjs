// Loops end to end (src/app/loops.mjs, loop-run.mjs, loops-board.mjs), with a stand-in model:
// one run as its window starts it (it asks, takes a note, ends the loop), the half-fix a run may
// keep, and the app itself in a pseudo-terminal with its board in its own window (and in a second one).
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
function runOnce(spec, { env, answer = 'yes', onAsk = null, onStart = null, ms = 40_000 } = {}) {
  return new Promise((resolve) => {
    const h = L.startRun({ mode: 'ask', flows: false, allow: [], owner: process.pid, ...spec }, { self, env: { ...process.env, ...env } });
    onStart?.(h);
    const seen = [];
    const timer = setTimeout(() => { h.kill(); resolve({ seen, timedOut: true }); }, ms);
    h.on((ev) => {
      seen.push(ev);
      if (ev.t === 'ask') { const a = onAsk?.(ev, h) ?? answer; h.send({ t: 'answer', id: ev.id, choice: a }); }
      if (ev.t === 'end') { clearTimeout(timer); resolve({ seen, end: ev }); }
    });
  });
}

test('one run: it asks before a command, a yes lets it go on, a note typed meanwhile is read with its next step, and "always" covers that command in the loop\'s later runs', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([
    { tool: { name: 'Bash', args: { command: 'touch made.txt', description: 'make a file' } } },
    { text: 'Noted: nothing more to do.\nLOOP DONE' },
    { tool: { name: 'Bash', args: { command: 'touch made.txt', description: 'make a file' } } },
    { text: 'Made it again.' },
  ]);
  try {
    const r = await runOnce({ folder: cwd, prompt: 'Make a file called made.txt.\n\n(Run 1 of a loop.)', url: fake.url }, { env, onAsk: (ev, h) => { h.send({ t: 'note', text: 'also say nothing more' }); return 'always'; } });
    expect(r.timedOut).toBeFalsy();
    const ask = r.seen.find((e) => e.t === 'ask');
    expect(ask).toMatchObject({ kind: 'permission', name: 'Bash', text: 'May it run: touch made.txt', always: 'this command', sig: 'Bash:touch made.txt' });
    expect(r.seen.map((e) => e.t)).toEqual(['ask', 'tool', 'heard', 'text', 'end']); // nothing ran before the yes
    expect(r.seen.find((e) => e.t === 'tool')).toMatchObject({ label: 'Bash', arg: 'touch made.txt', error: false, test: false });
    expect(existsSync(join(cwd, 'made.txt'))).toBe(true);
    // The note went on the end of that step's result, in the same turn, and the board was told after which step.
    expect(r.seen.find((e) => e.t === 'heard')).toEqual({ t: 'heard', text: 'also say nothing more', after: 'Bash(touch made.txt)' });
    const step = fake.requests.at(-1).messages.at(-1);
    expect(step.role).toBe('tool');
    expect(step.content).toMatch(/\(A note from the user, sent while you worked: also say nothing more\)$/);
    expect(r.end).toMatchObject({ reason: 'done', final: 'Noted: nothing more to do.\nLOOP DONE' });
    expect(L.readEnding(r.end.final)).toMatchObject({ done: true, said: 'Noted: nothing more to do.' });
    // A later run of the loop is told what "always" covers, and is not asked.
    const again = await runOnce({ folder: cwd, prompt: 'Make a file called made.txt.\n\n(Run 2 of a loop.)', url: fake.url, allow: ['Bash:touch made.txt'] }, { env });
    expect(again.seen.map((e) => e.t)).toEqual(['tool', 'text', 'end']);
    expect(again.end.reason).toBe('done');
  } finally { await fake.close(); }
}, T);

test('a note that comes as the run gives its answer is its next message; a run keeps its copy for undo, and its own steps', async () => {
  const { cwd, env } = setup();
  // The answer comes slowly, so the note arrives while it is said: no step is left, so it is the next message.
  let h = null;
  const fake = await startFakeServer([{ text: 'All of it is done, every single part of what was asked for here.' }, { text: 'Noted.' }], { delayMs: 40, route: (json) => { if (json.messages.at(-1).role === 'user' && !/also/.test(String(json.messages.at(-1).content))) h?.send({ t: 'note', text: 'also say nothing more' }); return null; } });
  try {
    const r = await runOnce({ folder: cwd, prompt: 'Say what is done.', url: fake.url }, { env, onStart: (x) => { h = x; } });
    expect(r.seen.some((e) => e.t === 'heard')).toBe(false);
    expect(fake.requests.at(-1).messages.at(-1)).toMatchObject({ role: 'user', content: 'also say nothing more' });
    expect(r.end).toMatchObject({ reason: 'done', final: 'Noted.' });
  } finally { await fake.close(); }
  // Its copy for undo: the end says where it is and what it changed; the window's undo puts it back.
  const { cwd: dir, env: env2 } = sumProject();
  const fake2 = await startFakeServer(script({ old_text: 'add = (a, b) => a - b', new_text: 'add = (a, b) => a + b' }));
  try {
    const session = L.sessionOf(process.pid, 1);
    const r = await runOnce({ folder: dir, prompt: 'Some tests fail. Fix sum.mjs.', url: fake2.url, mode: 'edits', rewind: session }, { env: env2 });
    expect(r.end).toMatchObject({ reason: 'done', usd: 0, point: 1, until: 1, files: [{ path: 'sum.mjs', by: 'edit' }] });
    expect(readFileSync(join(dir, 'sum.mjs'), 'utf8')).toContain('add = (a, b) => a + b'); // the half-fix stayed
    const m = new L.Loops({ home: env2.AGENTIC_HOME, pid: process.pid, folder: dir, start: () => ({ on() {}, send() {}, kill() {} }) });
    const l = m.add(L.parseLoop('debug'));
    l.runs.push({ n: 1, point: r.end.point, until: r.end.until, files: r.end.files });
    expect(await m.undo(l.id, 1)).toEqual({ text: 'Put back run 1: sum.mjs' });
    expect(readFileSync(join(dir, 'sum.mjs'), 'utf8')).toBe(SUM);
    m.close();
  } finally { await fake2.close(); }
  // Its own steps: a run of 2 steps stops after the second.
  const fake3 = await startFakeServer([1, 2, 3, 4].map((i) => ({ tool: { name: 'Bash', args: { command: `echo ${i}`, description: 'say a number' } } })));
  try {
    const r = await runOnce({ folder: cwd, prompt: 'Say four numbers, one command each.', url: fake3.url, mode: 'auto', steps: 2, allow: ['Bash:echo 1', 'Bash:echo 2', 'Bash:echo 3', 'Bash:echo 4'] }, { env });
    expect(r.seen.filter((e) => e.t === 'tool' && e.label === 'Bash')).toHaveLength(2);
    expect(r.seen.some((e) => e.t === 'note' && /Stopped after 2 steps/.test(e.text))).toBe(true);
  } finally { await fake3.close(); }
}, T * 3);

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

// ---- the app, and its board in its own window (/loops) ----
test('/loop in the app: the setup with no loop yet, test5m asked about, a loop and its line above the prompt; /loops in this window answers it, a note and "always" reach it, ^G shows its run; /loop lists and stops; quitting ends the loops and removes their folder', async () => {
  const { cwd, env } = setup();
  const E = { ...env, AGENTIC_LOOP_MIN_SECS: '1' };
  // Every run wants to make a file (which asks in Manual mode), then says so; a note gets "Noted."
  let runs = 0;
  const fake = await startFakeServer([], { route: (json) => {
    const last = json.messages.at(-1);
    if (last.role === 'tool') return { text: /also say nothing more/.test(String(last.content)) ? 'Noted.' : 'Made the file.' };
    if (/also/.test(String(last.content))) return { text: 'Noted.' };
    runs++;
    return { tool: { name: 'Bash', args: { command: 'touch made.txt', description: 'make a file' } } };
  } });
  const dir = join(env.AGENTIC_HOME, 'loops');
  let whileOpen = [];
  try {
    const app = runInPty({ cwd, env: E, args: ['--url', fake.url, '--no-flows'], cols: 124, rows: 40, timeoutMs: 120_000, steps: [
      { wait: '? for shortcuts' },
      // /loop with no loop yet: the setup, in this window; an unclear task is asked about; esc twice is the chat again.
      { type: '/loop' }, { key: 'enter' }, { wait: 'What should each run do?' }, { sleep: 300 }, { snapshot: 'setup' },
      { type: 'test5m' }, { key: 'enter' }, { wait: 'looks like two things typed together' }, { sleep: 300 }, { snapshot: 'unclear' },
      { key: 'esc' }, { wait: 'No loop yet in this window' }, { key: 'esc' }, { sleep: 600 },
      // A loop from the chat: it starts, the footer counts it, and its line sits above the prompt.
      { type: '/loop 3s make a file called made.txt' }, { key: 'enter' }, { wait: 'Loop 1 started' }, { sleep: 300 }, { snapshot: 'started', has: ['/loops opens them'] },
      { wait: 'needs you: May it run: touch made.txt', ms: 25_000 }, { sleep: 300 }, { snapshot: 'needs', has: ['asks you'] },
      // /loops: the board takes this window. Words typed go to it as a note, and it still asks; a and enter answer.
      { sleep: 2500 }, // the board in another terminal (below) looks first
      { type: '/loops' }, { key: 'enter' }, { wait: 'asks: May it run: touch made.txt', ms: 10_000 }, { sleep: 300 }, { snapshot: 'asks' },
      { type: 'also say nothing more' }, { sleep: 200 }, { snapshot: 'typing' }, { key: 'enter' }, { wait: 'Sent as a note: it still asks', ms: 5000 },
      { type: 'a' }, { key: 'enter' }, { wait: 'will not ask this again', ms: 5000 },
      { wait: '✓ run 1: Noted.', ms: 20_000 }, { sleep: 300 }, { snapshot: 'answered' },
      // ^G: the run in full, before the next one starts; esc back to the cards, esc back to the chat.
      { key: '\x07' }, { wait: 'back to the cards' }, { sleep: 300 }, { snapshot: 'watch' }, { key: 'esc' }, { sleep: 300 }, { key: 'esc' }, { sleep: 600 },
      { sleep: 8000 },
      { type: '/loop' }, { key: 'enter' }, { wait: 'Loops of this window' }, { sleep: 300 }, { snapshot: 'list' },
      { type: '/loop 1 runs 50' }, { key: 'enter' }, { wait: 'make a file called made.txt: saved' }, { sleep: 300 }, { snapshot: 'rule' },
      { fn: () => { whileOpen = readdirSync(dir); } },
      { type: '/loop stop' }, { key: 'enter' }, { wait: 'Stopped: make a file called made.txt' }, { sleep: 400 }, { snapshot: 'stopped' },
      ...quit,
    ] });
    // `coding loops` in another terminal still shows the same board, and esc closes it.
    for (let i = 0; i < 300 && !(L.listBoards(env.AGENTIC_HOME)[0]?.loops ?? []).some((l) => l.current?.needs); i++) await new Promise((r) => setTimeout(r, 100));
    const board = await runInPty({ cwd, env: E, args: ['loops'], cols: 124, rows: 38, timeoutMs: 30_000, steps: [
      { wait: 'TASK  make a file called made.txt', ms: 10_000 }, { sleep: 300 }, { snapshot: 'cards' }, { key: 'esc' },
    ] });
    const r = await app;
    expect(board.snapshots.cards).toMatch(/↻ Loops {2}· {2}\S+[\s\S]*TASK {2}make a file called made\.txt/);
    expect(board.snapshots.cards).toMatch(/esc close/);
    expect(board.code).toBe(0);
    expect(board.text).toMatch(/The loop board is closed\. The loops go on in their window/);
    // The setup, here in this window, and test5m asked about.
    expect(r.snapshots.setup).toMatch(/esc {2}chat › ↻ New loop/);
    expect(r.snapshots.setup).toMatch(/◉ What it does {2}── {2}○ How often {2}── {2}○ When it stops {2}── {2}○ Start/);
    expect(r.snapshots.unclear).toMatch(/"test5m" looks like two things typed together: "test" and "5m"\./);
    expect(r.snapshots.unclear).toMatch(/▸ 1 {2}Run the tests, every 5m/);
    // The app: what /loop said, the footer's count, the line above the prompt.
    expect(r.snapshots.started).toMatch(/↻ Loop 1 started: make a file called made\.txt · task · every 3s/);
    expect(r.snapshots.started).toMatch(/it ends when this window closes\. \/loops shows it\./);
    expect(r.snapshots.started).toMatch(/↻ 1 loop/);
    expect(r.snapshots.started).toMatch(/↻ \S make a file called made\.txt .*\/loops opens them/);
    expect(r.snapshots.needs).toMatch(/↻ 1 loop · 1 needs you/);
    expect(r.snapshots.needs).toMatch(/↻ ! make a file called made\.txt asks you/);
    expect(r.snapshots.needs).toMatch(/needs you: May it run: touch made\.txt \/loops to answer it\./);
    // The board in this window: the card says it asks, and the line above the box how to answer.
    expect(r.snapshots.asks).toMatch(/esc {2}chat › ↻ Loops/);
    expect(r.snapshots.asks).toMatch(/TASK {2}make a file called made\.txt/);
    expect(r.snapshots.asks).toMatch(/Now {3}! asks you: May it run: touch/);
    expect(r.snapshots.asks).toMatch(/asks: May it run: touch made\.txt\s+type y yes · a yes, always \(this command\) · n no/);
    expect(r.snapshots.typing).toMatch(/› also say nothing more/);
    expect(r.snapshots.answered).toMatch(/You {3}“also say nothing more”\s+│[\s\S]*✓ read after Bash\(touch made\.txt\)/);
    expect(r.snapshots.answered).toMatch(/you answered “Yes, always \(this command\)”/);
    expect(r.snapshots.answered).toMatch(/Last {2}✓ run 1: Noted\./);
    expect(r.snapshots.watch).toMatch(/> make a file called made\.txt[\s\S]*\? May it run: touch made\.txt[\s\S]*> also say nothing more[\s\S]*⏺ Bash\(touch made\.txt\)\s+⎿ it read your note with the result of Bash\(touch made\.txt\)[\s\S]*● Noted\./);
    expect(r.snapshots.watch).toMatch(/esc back to the cards/);
    // The list, a rule, the stop.
    expect(r.snapshots.list).toMatch(/1\. make a file called made\.txt · task · every 3s · /);
    expect(r.snapshots.list).toMatch(/Change one: \/loop <n> every 7m · runs 5/);
    expect(r.snapshots.rule).toMatch(/make a file called made\.txt: saved · task · every 3s · \d+ of 50 runs/);
    expect(r.snapshots.stopped).not.toMatch(/↻ 1 loop/); // a stopped loop is not counted
    expect(existsSync(join(cwd, 'made.txt'))).toBe(true);
    expect(runs).toBeGreaterThanOrEqual(2); // it ran again by itself, and "always" meant no second question
    expect((r.text.match(/needs you: May it run/g) ?? []).length).toBe(1);
    expect(whileOpen).toHaveLength(1); // one folder, named by the window's pid, while it was open
    expect(r.code).toBe(0);
    expect(readdirSync(dir)).toEqual([]); // gone with the window
  } finally { await fake.close(); }
}, 160_000);

test('coding loops with no loop anywhere says how to make one', async () => {
  const { cwd, env } = setup();
  const r = await runInPty({ cwd, env, args: ['loops'], cols: 100, rows: 30, timeoutMs: 20_000, steps: [{ sleep: 1500 }] });
  expect(r.text).toMatch(/No coding window has a loop now\. In a coding window, type: \/loop 10m <message>/);
  expect(r.code).toBe(0);
}, T);
