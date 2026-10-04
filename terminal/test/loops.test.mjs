// Loops (/loop, src/app/loops.mjs) and their board (loops-draw.mjs, loops-board.mjs), without a
// model: what /loop reads, when a loop runs, what a question and a note do, when a loop ends, the
// files the board reads and the keys it sends back, and the Tree drawn at the sizes it meets.
// End to end with the app and a stand-in model: app-loops.test.mjs.
import { test, expect } from 'bun:test';
import { mkdtempSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A throwaway home before the models part is imported (it reads AGENTIC_HOME once).
const home = join(mkdtempSync(join(tmpdir(), 'agentic-loops-')), 'home');
process.env.AGENTIC_HOME = home;
process.env.AGENTIC_LOOP_MIN_SECS = '60';
const L = await import('../src/app/loops.mjs');
const D = await import('../src/app/loops-draw.mjs');
const B = await import('../src/app/loops-board.mjs');
const R = await import('../src/app/loop-run.mjs');
const { HOME } = await import('../../models/index.mjs');

const text = (rows) => rows.map((r) => r.map(([t]) => t).join('')).join('\n');
// A window's loops with pretend runs and a clock the test moves. pid: a number that is this
// process (alive, so the board lists it) but a folder of its own per test.
let seq = 0;
function window({ status = {}, spend = 0 } = {}) {
  const clock = { t: 1_800_000_000_000 };
  const runs = [];
  const st = { on: true, name: 'Stand-in', where: 'this Mac', limit: 1, mode: 'ask', ...status };
  const money = { usd: spend };
  const dir = join(home, `w${++seq}`);
  const m = new L.Loops({
    home: dir, pid: process.pid, folder: '/tmp/demo', name: 'demo-1', now: () => clock.t, status: () => st, spend: () => money.usd,
    start: (spec) => { const fns = []; const h = { spec, sent: [], killed: false, on: (f) => fns.push(f), send: (x) => h.sent.push(x), kill: () => { h.killed = true; }, emit: (e) => fns.forEach((f) => f(e)) }; runs.push(h); return h; },
  });
  const pass = (ms) => { clock.t += ms; m.tick(); };
  return { m, runs, st, money, clock, pass, dir };
}

test('the tests run in a throwaway home', () => {
  expect(HOME).toBe(home);
  expect(L.loopsDir().startsWith(home)).toBe(true);
});

test('/loop: a kind, a time and a message, each optional where it can be', () => {
  expect(L.parseLoop('10m check the build and say what fails')).toMatchObject({ kind: 'test', every: 600, until: false, message: 'check the build and say what fails' });
  // A kind alone has a ready-made message and a short name; debug with no time runs until its tests pass.
  expect(L.parseLoop('debug')).toMatchObject({ kind: 'debug', every: null, until: true, name: 'Fix the failing tests', message: L.PRESET.debug });
  expect(L.parseLoop('test 5m')).toMatchObject({ kind: 'test', every: 300, until: false, name: 'Run the tests' });
  expect(L.parseLoop('tests 2h')).toMatchObject({ kind: 'test', every: 7200 });
  expect(L.parseLoop('web 30m read the Bun release page')).toMatchObject({ kind: 'web', every: 1800, message: 'read the Bun release page', name: 'read the Bun release page' });
  // The kind is read off the message when it is not said.
  expect(L.parseLoop('1h fix the broken export').kind).toBe('debug');
  expect(L.parseLoop('1h read https://bun.sh/blog and say what is new').kind).toBe('web');
  expect(L.parseLoop('1h tidy the notes folder').kind).toBe('task');
  // No time and not a debugging loop: it paces itself. A name is the first sentence, a file name's dot is not its end.
  expect(L.parseLoop('tidy the notes folder')).toMatchObject({ kind: 'task', every: null, until: false });
  expect(L.parseLoop('5m make a file called made.txt. Then stop.').name).toBe('make a file called made.txt');
  // The shortest gap is a minute, said in the note; a web loop needs to be told what to read.
  expect(L.parseLoop('5s say hi')).toMatchObject({ every: 60, note: ' (the shortest gap is 1m)' });
  expect(L.parseLoop('').error).toMatch(/needs a message/);
  expect(L.parseLoop('web').error).toMatch(/what to look at/);
  expect(L.parseLoop('web 30m').error).toMatch(/what to look at/);
  expect([60, 300, 3600, 86_400, 90].map(L.everyWord)).toEqual(['1m', '5m', '1h', '1d', '90s']);
});

test('what a run is told, and what its last words say about the loop', () => {
  const loop = { until: false, every: 600, runs: [] };
  expect(L.loopNote(loop, 1)).toMatch(/^\(Run 1 of a loop that runs every 10m; each run is a fresh conversation\. If the whole job is finished.*LOOP DONE\)$/);
  const again = { until: true, every: null, runs: [{ n: 1, startedAt: new Date(2026, 9, 3, 14, 2).getTime(), said: 'Two of three still fail: quoting, extra column.' }] };
  expect(L.loopNote(again, 2)).toMatch(/Run 2 of a loop that runs until its job is done.*What the earlier runs did, oldest first:\n- Run 1 at 14:02: Two of three still fail/s);
  expect(L.loopNote({ until: false, every: null, runs: [] }, 1)).toMatch(/paces itself.*NEXT RUN IN <minutes> MIN/);
  expect(L.readEnding('All five pass.\nLOOP DONE')).toEqual({ done: true, nextSecs: null, said: 'All five pass.' });
  expect(L.readEnding('Nothing new.\n\nNEXT RUN IN 30 MIN')).toEqual({ done: false, nextSecs: 1800, said: 'Nothing new.' });
  expect(L.readEnding('NEXT RUN IN 500 MIN').nextSecs).toBe(3600); // an hour at most
  expect(L.readEnding('The loop is done for today.').done).toBe(false); // only the line of its own
  expect(L.summaryOf('**All 5 tests pass.**\nMore.', 'done')).toBe('All 5 tests pass.');
  expect(L.summaryOf('', 'done')).toBe('done, nothing said');
  expect(L.summaryOf('The model server is not there', 'error')).toBe('it failed: The model server is not there');
});

test('a loop runs when it is due, one at a time on this Mac, and each run is told how the last one ended', () => {
  const { m, runs, pass } = window();
  const a = m.add(L.parseLoop('test 5m'));
  const b = m.add(L.parseLoop('web 30m read the Bun release page'));
  m.tick();
  expect(runs).toHaveLength(0); // a second after it is made, not at once
  pass(1000);
  expect(runs).toHaveLength(1);
  expect(a.state).toBe('running');
  expect(b.queued).toBe(true); // due, and waiting its turn
  expect(runs[0].spec).toMatchObject({ folder: '/tmp/demo', mode: 'ask', allow: [] });
  expect(runs[0].spec.prompt).toMatch(/^Run the tests\..*\n\n\(Run 1 of a loop that runs every 5m/s);
  runs[0].emit({ t: 'tool', label: 'Bash', arg: 'node --test', error: true, test: true });
  runs[0].emit({ t: 'text', text: '2 of 5 pass.', final: true });
  runs[0].emit({ t: 'end', reason: 'done', final: '2 of 5 pass. Failing: quoting.', tests: { ok: false } });
  // The tests it ran last failed: the run is red, and the next one is five minutes after its end.
  expect(a.runs.at(-1)).toMatchObject({ n: 1, ok: false, summary: '2 of 5 pass. Failing: quoting.' });
  expect(a.state).toBe('waiting');
  expect(a.nextAt - m.now()).toBe(300_000);
  pass(500);
  expect(runs).toHaveLength(2); // the one in line goes now
  expect(b.state).toBe('running');
  runs[1].emit({ t: 'end', reason: 'done', final: 'Nothing new: Bun 1.4.2.' });
  pass(300_000);
  expect(runs).toHaveLength(3);
  expect(runs[2].spec.prompt).toMatch(/Run 2 of a loop.*What the earlier runs did, oldest first:\n- Run 1 at \d\d:\d\d: 2 of 5 pass\. Failing: quoting\.\nIf the whole job/s);
  m.close();
});

test('on a service three runs go at once', () => {
  const { m, runs, pass } = window({ status: { where: 'its service', limit: 3 } });
  for (let i = 0; i < 4; i++) m.add(L.parseLoop(`${i + 1}h tidy folder ${i}`));
  pass(1000);
  expect(runs).toHaveLength(3);
  expect(m.loops.filter((l) => l.queued).map((l) => l.id)).toEqual([4]);
  m.close();
});

test('a run that asks is "needs you": the others go on, the answer reaches it, and "always" holds for the loop\'s later runs', () => {
  const { m, runs, pass } = window();
  const a = m.add(L.parseLoop('web 30m read the Bun release page'));
  const b = m.add(L.parseLoop('test 5m'));
  pass(1000);
  runs[0].emit({ t: 'ask', id: 7, kind: 'permission', name: 'WebFetch', text: 'May it read github.com?', always: 'github.com', sig: 'WebFetch(github.com)' });
  expect(a.state).toBe('needs');
  expect(m.asking.id).toBe(a.id);
  expect(m.needsYou).toHaveLength(1);
  pass(500);
  expect(b.state).toBe('running'); // a run waiting for you does not hold the line
  expect(m.answer(b.id, 'yes')).toBe(false); // that one asked nothing
  expect(m.answer(a.id, 'always')).toBe(true);
  expect(runs[0].sent).toEqual([{ t: 'answer', id: 7, choice: 'always' }]);
  expect(a.state).toBe('running');
  expect(a.allowed).toEqual(['WebFetch(github.com)']);
  runs[0].emit({ t: 'end', reason: 'done', final: 'Bun 1.4.2, nothing new.' });
  runs[1].emit({ t: 'end', reason: 'done', final: 'All pass.', tests: { ok: true } });
  pass(1_800_000);
  runs.at(-1).emit({ t: 'end', reason: 'done', final: 'All pass.', tests: { ok: true } }); // the test loop was due first
  pass(500);
  const next = runs.find((r) => r.spec.prompt.includes('Run 2') && r.spec.prompt.includes('Bun'));
  expect(next.spec.allow).toEqual(['WebFetch(github.com)']); // the next run is not asked again
  // A question (not a permission) takes typed words as its answer.
  next.emit({ t: 'ask', id: 1, kind: 'question', name: 'Ask', text: 'Which page: the blog or the releases?', options: [] });
  expect(m.typed('the releases', a.id)).toBe(`Answered ${a.name}`);
  expect(next.sent).toEqual([{ t: 'answer', id: 1, choice: 'yes', text: 'the releases' }]);
  m.close();
});

test('a note reaches the run under way, or the next run when none is; /loop typed on the board makes a loop', () => {
  const { m, runs, pass, st } = window();
  const a = m.add(L.parseLoop('debug'));
  expect(m.steer(a.id, 'start with the quoting test')).toBe('Fix the failing tests starts its next run with your note');
  pass(1000);
  expect(runs[0].spec.prompt).toMatch(/\(A note from the user for this run: start with the quoting test\)/);
  expect(a.note).toBe(null);
  expect(m.steer(a.id, 'and leave the tests as they are')).toBe('Sent to Fix the failing tests: it reads it when its turn ends');
  expect(runs[0].sent).toEqual([{ t: 'note', text: 'and leave the tests as they are' }]);
  st.mode = 'edits';
  const made = m.typed('/loop test 5m', a.id);
  expect(made).toMatchObject({ made: 2, text: 'Loop 2 started: test · every 5m · next run in 1s' });
  expect(m.loop(2)).toMatchObject({ kind: 'test', mode: 'edits', folder: '/tmp/demo' }); // the window's mode now
  expect(m.typed('/loop', a.id)).toMatch(/needs a message/);
  expect(m.typed('/model', a.id)).toMatch(/Only \/loop is a command here/);
  expect(m.typed('   ', a.id)).toBe(null);
  expect(m.log.filter((e) => e.kind === 'you').map((e) => e.text)).toEqual(['start with the quoting test', 'and leave the tests as they are']);
  m.close();
});

test('a loop ends when a run says its job is done, when a debugging loop\'s tests pass, or after 24 hours', () => {
  const { m, runs, pass, clock } = window();
  const a = m.add(L.parseLoop('debug'));
  const b = m.add(L.parseLoop('10m watch the build'));
  pass(1000);
  // A miss: the tests still fail, so a new try 15 seconds later, told how this one ended.
  runs[0].emit({ t: 'end', reason: 'done', final: 'Fixed quoting; extra column still fails.', tests: { ok: false } });
  expect(a.state).toBe('waiting');
  expect(a.nextAt - m.now()).toBe(15_000);
  pass(100);
  runs[1].emit({ t: 'end', reason: 'done', final: 'The build is green and will stay so.\nLOOP DONE' });
  expect(b).toMatchObject({ state: 'done', doneWhy: 'the run said its job is done' });
  expect(b.runs.at(-1).summary).toBe('The build is green and will stay so.');
  pass(15_000);
  // The tests pass at the end of a run: the debugging loop is done, said or not.
  runs[2].emit({ t: 'end', reason: 'done', final: 'All 5 tests pass.', tests: { ok: true } });
  expect(a).toMatchObject({ state: 'done', doneWhy: 'the tests pass after 2 runs' });
  expect(m.open).toHaveLength(0);
  // 24 hours: a loop nobody stopped ends by itself.
  const c = m.add(L.parseLoop('1h tidy the notes folder'));
  clock.t += 24 * 3_600_000;
  m.tick();
  expect(c).toMatchObject({ state: 'done', doneWhy: 'ran for 24 hours' });
  m.close();
});

test('each run is told what the earlier runs did (the last eight), and a fixing loop not to try again what failed', () => {
  const t0 = new Date(2026, 9, 4, 9, 0).getTime();
  const runs = Array.from({ length: 10 }, (_, i) => ({ n: i + 1, startedAt: t0 + i * 60_000, ok: false, reason: 'done', said: `Try ${i + 1}: changed toCsv. ${'More words. '.repeat(30)}`, summary: `Try ${i + 1}`, failing: 2 }));
  Object.assign(runs[9], { reason: 'steps', summary: 'out of steps: was reading export.mjs' });
  const note = L.loopNote({ kind: 'debug', until: true, every: null, runs }, 11);
  expect(note).toContain('What the earlier runs did (the last 8; 2 before them are not listed), oldest first:\n- Run 3 at 09:02, 2 tests still failing: Try 3: changed toCsv.');
  const lines = note.split('\n').filter((l) => l.startsWith('- Run '));
  expect(lines.map((l) => l.split(' at ')[0])).toEqual(['- Run 3', '- Run 4', '- Run 5', '- Run 6', '- Run 7', '- Run 8', '- Run 9', '- Run 10']);
  expect(lines[0].endsWith('…')).toBe(true); // an older run in a line
  // A run that did not finish says why, not its last words.
  expect(lines.at(-1)).toBe('- Run 10 at 09:09, 2 tests still failing: out of steps: was reading export.mjs');
  expect(note).toMatch(/\nDo not try again what an earlier run tried and saw fail\.\nIf the whole job is finished/);
  // A loop that checks or reads the same thing each run is meant to repeat itself.
  expect(L.loopNote({ kind: 'test', until: false, every: 300, runs: runs.slice(0, 1) }, 2)).not.toContain('Do not try again');
  expect(L.loopNote({ kind: 'web', until: false, every: 300, runs: runs.slice(0, 1) }, 2)).not.toContain('Do not try again');
});

test('a fixing loop that is not getting closer waits for you; a note, r or p sends it on', () => {
  const { m, runs, pass } = window();
  const a = m.add(L.parseLoop('debug'));
  pass(1000);
  runs[0].emit({ t: 'end', reason: 'done', final: 'Fixed quoting; 2 still fail.', tests: { ok: false, count: 2 } });
  expect(a.runs.at(-1)).toMatchObject({ failing: 2, reason: 'done' });
  expect(a.state).toBe('waiting'); // one run that misses is no news
  pass(15_000);
  runs[1].emit({ t: 'end', reason: 'done', final: 'Tried the header; 2 still fail.', tests: { ok: false, count: 2 } });
  expect(a).toMatchObject({ state: 'paused', stuck: '2 tests still fail after runs 1 and 2: it is not getting closer' });
  expect(m.stuck).toEqual([a]);
  expect(m.needsYou).toEqual([]); // no run is waiting on an answer
  expect(L.describe(a, m.now())).toBe('debug · until its job is done · needs you: 2 tests still fail after runs 1 and 2: it is not getting closer');
  expect(D.stateOf(a, m.now())).toEqual(['! needs you · stuck', 'warn b']);
  expect(m.log.at(-1)).toMatchObject({ kind: 'stuck', id: a.id });
  // The board says so above the chat box, and counts it as needing you.
  const board = text(D.drawBoard(m.snapshot(), B.newUi(), { cols: 124, rows: 38, now: m.now(), linesOf: () => [] }));
  expect(board).toContain('Fix the failing tests is stuck: 2 tests still fail after runs 1 and 2');
  expect(board).toMatch(/needs you \[1\]/);
  for (const r of D.drawBoard(m.snapshot(), B.newUi(), { cols: 80, rows: 24, now: m.now(), linesOf: () => [] })) expect(D.rowWidth(r)).toBe(80);
  pass(60_000);
  expect(runs).toHaveLength(2); // it waits
  // A hint sends it on at once, with the hint and the runs so far.
  expect(m.steer(a.id, 'the header row is built in csv.mjs')).toBe('Fix the failing tests runs again now, with your note');
  pass(500);
  expect(runs).toHaveLength(3);
  expect(a.stuck).toBe(null);
  expect(runs[2].spec.prompt).toContain('(A note from the user for this run: the header row is built in csv.mjs)');
  expect(runs[2].spec.prompt).toMatch(/- Run 1 at \d\d:\d\d, 2 tests still failing: Fixed quoting; 2 still fail\.\n- Run 2 at \d\d:\d\d, 2 tests still failing: Tried the header; 2 still fail\.\nDo not try again/);
  // Fewer fail: closer, so it goes on by itself.
  runs[2].emit({ t: 'end', reason: 'done', final: '1 still fails.', tests: { ok: false, count: 1 } });
  expect(a).toMatchObject({ state: 'waiting', stuck: null });
  pass(15_000);
  runs[3].emit({ t: 'end', reason: 'done', final: 'Still 1.', tests: { ok: false, count: 1 } });
  expect(a.stuck).toBe('1 test still fails after runs 3 and 4: it is not getting closer');
  expect(m.runNow(a.id)).toBe(true); // r: once more, as it is
  expect(a.stuck).toBe(null);
  expect(runs).toHaveLength(5);
  runs[4].emit({ t: 'end', reason: 'done', final: 'Still 1.', tests: { ok: false, count: 1 } });
  expect(a.state).toBe('paused');
  expect(m.pause(a.id)).toBe(true); // p: going again
  expect(a).toMatchObject({ state: 'waiting', stuck: null });
  m.close();
  // Only a fixing loop, only known counts, and a run you stopped says nothing about it.
  const two = (x, y, more = {}) => ({ kind: 'debug', runs: [{ n: 1, failing: x }, { n: 2, failing: y, ...more }] });
  expect(L.stuckWhy(two(3, 4))).toMatch(/^4 tests still fail after runs 1 and 2/);
  expect(L.stuckWhy(two(3, 2))).toBe(null);
  expect(L.stuckWhy(two(null, 2))).toBe(null);
  expect(L.stuckWhy(two(0, 0))).toBe(null);
  expect(L.stuckWhy(two(2, 2, { reason: 'interrupted' }))).toBe(null);
  expect(L.stuckWhy({ kind: 'debug', runs: [{ n: 1, failing: 2, reason: 'interrupted' }, { n: 2, failing: 2 }] })).toBe(null);
  expect(L.stuckWhy({ ...two(2, 2), kind: 'test' })).toBe(null);
});

test('a loop with no time paces itself: ten minutes, or what the run says', () => {
  const { m, runs, pass } = window();
  const a = m.add(L.parseLoop('tidy the notes folder'));
  pass(1000);
  runs[0].emit({ t: 'end', reason: 'done', final: 'Tidy.' });
  expect(a.nextAt - m.now()).toBe(L.SELF_SECS * 1000);
  pass(L.SELF_SECS * 1000);
  runs[1].emit({ t: 'end', reason: 'done', final: 'Still tidy.\nNEXT RUN IN 30 MIN' });
  expect(a.nextAt - m.now()).toBe(1_800_000);
  expect(a.runs.at(-1).summary).toBe('Still tidy.');
  m.close();
});

test('the model off, the window answering, or $5 spent: loops wait and say why; nothing starts', () => {
  const { m, runs, pass, st, money } = window({ status: { on: false, why: 'the model is off' } });
  const a = m.add(L.parseLoop('test 5m'));
  pass(1000);
  expect(runs).toHaveLength(0);
  expect(a).toMatchObject({ state: 'off', offWhy: 'the model is off' });
  expect(L.describe(a, m.now())).toBe('test · every 5m · waits: the model is off');
  st.on = true; st.why = '';
  pass(500);
  expect(runs).toHaveLength(1); // it was due, so it goes as soon as the model is there
  runs[0].emit({ t: 'end', reason: 'done', final: 'All pass.', tests: { ok: true } });
  money.usd = 5.02;
  pass(300_000);
  expect(runs).toHaveLength(1);
  expect(a.offWhy).toMatch(/^this window has spent \$5\.02/);
  m.close();
});

test('pause, run now, every and stop; a run that is stopped ends there and stays on the board', () => {
  const { m, runs, pass } = window();
  const a = m.add(L.parseLoop('test 5m'));
  expect(m.pause(a.id)).toBe(true);
  pass(5000);
  expect(runs).toHaveLength(0);
  expect(m.runNow(a.id)).toBe(true); // run now also takes it out of its pause
  expect(runs).toHaveLength(1);
  expect(m.runNow(a.id)).toBe(false); // already running
  expect(m.pause(a.id)).toBe(true);
  expect(a.pauseAfter).toBe(true); // a run under way is not cut: it pauses after it
  runs[0].emit({ t: 'end', reason: 'done', final: 'All pass.', tests: { ok: true } });
  expect(a.state).toBe('paused');
  m.pause(a.id);
  expect(a.state).toBe('waiting');
  expect(m.setEvery(a.id, 600)).toBe(true);
  expect(a.every).toBe(600);
  expect(a.nextAt - a.runs.at(-1).endedAt).toBe(600_000);
  expect(m.setEvery(a.id, 5)).toBe(true);
  expect(a.every).toBe(60); // the shortest gap
  m.runNow(a.id);
  expect(runs).toHaveLength(2);
  expect(m.stop(a.id)).toBe(true);
  expect(runs[1].killed).toBe(true);
  expect(a).toMatchObject({ state: 'stopped', current: null, doneWhy: 'stopped by you' });
  expect(a.runs.at(-1)).toMatchObject({ n: 2, ok: false, summary: 'stopped by you' });
  runs[1].emit({ t: 'end', reason: 'done', final: 'late words' }); // the process ending later changes nothing
  expect(a.runs).toHaveLength(2);
  expect(m.stop(a.id)).toBe(false);
  expect(m.setEvery(m.add(L.parseLoop('debug')).id, 600)).toBe(false); // until done has no "every"
  m.close();
});

test('the board reads what the window wrote and its keys come back as files; the folder goes when the window closes', () => {
  const { m, runs, pass, dir } = window();
  const a = m.add(L.parseLoop('test 5m'));
  pass(1000);
  runs[0].emit({ t: 'tool', label: 'Bash', arg: 'node --test', error: true, test: true });
  runs[0].emit({ t: 'ask', id: 3, kind: 'permission', name: 'Bash', text: 'May it run: npm install', always: 'this command', sig: 'Bash:npm install' });
  m.tick();
  const boards = L.listBoards(dir);
  expect(boards).toHaveLength(1);
  const s = boards[0];
  expect(s).toMatchObject({ v: 1, pid: process.pid, name: 'demo-1', folder: '/tmp/demo', model: { name: 'Stand-in', on: true, where: 'this Mac', limit: 1 } });
  expect(s.loops[0]).toMatchObject({ id: 1, kind: 'test', state: 'needs', current: { n: 1, needs: { id: 3, text: 'May it run: npm install', always: 'this command' } } });
  expect(L.readRun(dir, process.pid, 1, 1).map((x) => x.kind)).toEqual(['user', 'loopnote', 'fail', 'ask']);
  // The board's keys: an answer, a note, a new loop (with what the window says back), a stop.
  L.sendCommand(dir, process.pid, { op: 'answer', id: 1, choice: 'yes' });
  L.sendCommand(dir, process.pid, { op: 'typed', id: 1, text: 'only the unit tests', stamp: 's1' });
  m.tick();
  expect(runs[0].sent).toEqual([{ t: 'answer', id: 3, choice: 'yes' }, { t: 'note', text: 'only the unit tests' }]);
  expect(L.readState(dir, process.pid).reply).toMatchObject({ stamp: 's1', text: 'Sent to Run the tests: it reads it when its turn ends' });
  L.sendCommand(dir, process.pid, { op: 'typed', id: 1, text: '/loop debug', stamp: 's2' });
  L.sendCommand(dir, process.pid, { op: 'every', id: 1, secs: 600 });
  L.sendCommand(dir, process.pid, { op: 'stop', id: 1 });
  m.tick();
  const after = L.readState(dir, process.pid);
  expect(after.reply).toMatchObject({ stamp: 's2', made: 2 });
  expect(after.loops.map((l) => [l.id, l.kind, l.state, l.every])).toEqual([[1, 'test', 'stopped', 600], [2, 'debug', 'waiting', null]]);
  expect(readdirSync(join(L.dirOf(dir, process.pid), 'cmd'))).toEqual([]); // each key is read once
  expect(a.runs.at(-1).summary).toBe('stopped by you');
  m.close();
  expect(existsSync(L.dirOf(dir, process.pid))).toBe(false);
  expect(L.listBoards(dir)).toEqual([]);
  m.tick(); // a closed window's loops do nothing more
  expect(runs.every((r) => r.killed || r.spec)).toBe(true);
});

// ---- the screen ----
function board() {
  const w = window();
  const { m, runs, pass } = w;
  m.add(L.parseLoop('debug'));
  m.add(L.parseLoop('test 5m'));
  m.add(L.parseLoop('web 30m read the Bun release page'));
  pass(1000);
  runs[0].emit({ t: 'tool', label: 'Bash', arg: 'node --test', error: true, test: true });
  runs[0].emit({ t: 'tool', label: 'Read', arg: 'export.mjs' });
  runs[0].emit({ t: 'ask', id: 1, kind: 'permission', name: 'Edit', text: 'May it change export.mjs?', always: 'every edit', sig: 'Edit:*' });
  pass(500); // the test loop starts while the first waits for you
  m.tick();
  const state = () => L.readState(w.dir, process.pid);
  const linesOf = (l, n) => L.readRun(w.dir, process.pid, l.id, n);
  return { ...w, state, linesOf };
}

test('the tree at every size: each row exactly the window, the window on top, a box per loop with its four steps, the question above the chat box', () => {
  const b = board();
  const state = b.state();
  for (const [cols, rows] of [[124, 38], [96, 30], [100, 30], [112, 59], [160, 50], [200, 60]]) {
    const frame = D.drawBoard(state, B.newUi(), { cols, rows, now: b.m.now() + 1500, linesOf: b.linesOf });
    expect(frame).toHaveLength(rows);
    for (const r of frame) expect(D.rowWidth(r)).toBe(cols);
    const t = text(frame);
    expect(t).toContain('this window');
    expect(t).toContain('Stand-in loaded · one run at a time');
    for (const part of ['DEBUG', 'TEST', 'WEB', 'Fix the failing tests', '1 TESTS', '2 FIND', '3 FIX', '4 TESTS', '1 RUN', '2 COMPARE', '1 ASK', '2 READ', '4 WAIT', 'again every 5m']) expect(t).toContain(part);
    if (cols >= 124) expect(t).toContain('pass: done · miss: a new try'); // a narrow box cuts its longest line
    expect(t).toMatch(/1 TESTS\s+(▮+ )?● some fail/); // the first test run failed: a red, finished step (a narrow box drops the bars)
    expect(t).toMatch(/2 FIND\s+(▯+ )?! needs you/); // the step the run is on is the one that asks
    expect(t).toMatch(cols >= 110 ? /! {2}DEBUG {2}Fix the failing tests asks: May it change export\.mjs\?\s+y yes, this time · a yes, always · n no/ : /! {2}DEBUG {2}Fix the failing tests asks: May it change export\.mjs\?\s+y yes · a always · n no/);
    expect(t).toMatch(/to Fix the failing tests/); // the chat box names the picked loop
    expect(t).toMatch(/loops \[3\]\s+running \[Run the tests\]\s+needs you \[1\]\s+in line \[1\]/);
    expect(t).toMatch(/←→ pick .* t type .* \+ new loop .* q close/);
    if (rows >= 38) expect(t).toMatch(/loop log[\s\S]*asks: May it change export\.mjs\?/);
  }
  // A window too small says so, and how big it must be.
  const small = D.drawBoard(state, B.newUi(), { cols: 80, rows: 24, now: b.m.now(), linesOf: b.linesOf });
  expect(small).toHaveLength(24);
  expect(text(small)).toMatch(/This window is 80 × 24\. The loop board needs 96 × 30 or more/);
  b.m.close();
});

test('more loops than fit move sideways with the picked one; no loop yet shows how to make one', () => {
  const { m, dir, pass } = window({ status: { limit: 3 } });
  const empty = () => L.readState(dir, process.pid);
  m.save();
  const none = text(D.drawBoard(empty(), B.newUi(), { cols: 124, rows: 38, now: m.now(), linesOf: () => [] }));
  expect(none).toMatch(/No loop yet in this window\./);
  expect(none).toMatch(/\/loop test 5m\s+runs the tests every 5 minutes/);
  expect(none).toMatch(/to type \/loop 10m <message> and make the first loop/);
  for (let i = 1; i <= 6; i++) m.add(L.parseLoop(`${i}h tidy folder number ${i}`));
  pass(1000);
  const s = L.readState(dir, process.pid);
  const first = text(D.drawBoard(s, { ...B.newUi(), sel: 0 }, { cols: 124, rows: 38, now: m.now(), linesOf: () => [] }));
  expect(first).toContain('│ tidy folder number 1');
  expect(first).toContain('2 more ›');
  expect(first.match(/┌─ {2}TASK {2}─/g)).toHaveLength(4); // four boxes across at 124
  expect(first).not.toContain('│ tidy folder number 5');
  const last = D.drawBoard(s, { ...B.newUi(), sel: 5 }, { cols: 124, rows: 38, now: m.now(), linesOf: () => [] });
  for (const r of last) expect(D.rowWidth(r)).toBe(124);
  expect(text(last)).toContain('│ tidy folder number 6');
  expect(text(last)).toContain('‹ 2 more');
  m.close();
});

test('the board\'s keys: letters are commands, except in the chat box where they are text', () => {
  const b = board();
  const sent = [];
  let quits = 0;
  const bd = { state: b.state(), ui: B.newUi(), send: (c) => sent.push(c), quit: () => { quits++; } };
  const press = (...ks) => ks.forEach((k) => B.handleKey(bd, k));
  expect(B.keysOf('a\x1b[C\r\x7f\x1b')).toEqual(['a', 'right', 'enter', 'backspace', 'esc']);
  // y / a / n answer the oldest question, whichever loop is picked.
  press('right');
  expect(bd.ui.sel).toBe(1);
  press('a');
  expect(sent.pop()).toEqual({ op: 'answer', id: 1, choice: 'always' });
  // r p e s act on the picked loop; s asks first.
  press('p'); expect(sent.pop()).toEqual({ op: 'pause', id: 2 });
  press('e'); expect(sent.pop()).toEqual({ op: 'every', id: 2, secs: 600 });
  press('s'); expect(bd.ui.view).toBe('confirm'); expect(sent).toEqual([]);
  press('n'); expect(bd.ui.view).toBe('main');
  press('s', 'y'); expect(sent.pop()).toEqual({ op: 'stop', id: 2 });
  press('left', 'e'); expect(sent).toEqual([]); // a debugging loop has no "every"
  expect(bd.ui.toast.text).toMatch(/has no "every"/);
  // t opens the chat box: now q, r, s and digits are text. enter sends it to the picked loop; esc leaves.
  press('t', ...'quit rs 12');
  expect(bd.ui.chat).toEqual({ on: true, text: 'quit rs 12' });
  expect(quits).toBe(0);
  press('backspace', 'enter');
  expect(sent.pop()).toMatchObject({ op: 'typed', id: 1, text: 'quit rs 1' });
  expect(bd.ui.chat).toEqual({ on: false, text: '' });
  press('+', ...'test 5m');
  expect(bd.ui.chat.text).toBe('/loop test 5m'); // + starts the line for you
  press('esc');
  expect(bd.ui.chat).toEqual({ on: false, text: '/loop test 5m' }); // kept for when you come back
  // enter opens one run with its lines; esc comes back; q closes the board.
  press('enter');
  expect(bd.ui.view).toBe('watch');
  const watch = text(D.drawBoard(bd.state, bd.ui, { cols: 124, rows: 38, now: b.m.now(), linesOf: b.linesOf }));
  expect(watch).toMatch(/Fix the failing tests {2}· {2}run 1 {2}· {2}live/);
  expect(watch).toMatch(/> Some tests in this folder fail\./);
  expect(watch).toMatch(/⏺ Bash\(node --test\)\s+⎿ the tests fail\s+⏺ Read\(export\.mjs\)/);
  expect(watch).toMatch(/esc back to the loops/);
  press('q'); expect(bd.ui.view).toBe('main'); expect(quits).toBe(0); // q in a run only goes back
  press('q'); expect(quits).toBe(1);
  b.m.close();
});

test('what a run asks, as the board shows it, and what "always" covers', () => {
  expect(R.askText({ name: 'Bash', args: { command: 'npm install' } })).toEqual({ kind: 'permission', text: 'May it run: npm install', always: 'this command' });
  expect(R.askText({ name: 'Bash', args: { command: 'git commit -m x' }, once: true }).always).toBe(null); // asked every time
  expect(R.askText({ name: 'WebFetch', rule: 'WebFetch(github.com)', args: { url: 'https://github.com/x' } })).toEqual({ kind: 'permission', text: 'May it read github.com?', always: 'github.com' });
  expect(R.askText({ name: 'Edit', args: { path: 'export.mjs' } }).text).toBe('May it change export.mjs?');
  expect(R.askText({ name: 'Ask', args: { question: 'Which page?', options: ['the blog', 'the releases'] } })).toEqual({ kind: 'question', text: 'Which page?', options: ['the blog', 'the releases'], always: null });
  expect(R.signatureOf({ name: 'Bash', args: { command: ' node --test ' } })).toBe('Bash:node --test');
  expect(R.signatureOf({ name: 'Write', args: { path: 'a.txt' } })).toBe('Edit:*');
  expect(R.signatureOf({ name: 'Edit', args: { path: 'b.txt' } })).toBe('Edit:*');
  expect(R.signatureOf({ name: 'Ask', args: {} })).toBe(null);
  // The agent marks a run of the tests (ev.tests); reading a test file is not one.
  expect(R.isTestRun({ label: 'Bash', arg: 'node --test', tests: { failed: false } })).toBe(true);
  expect(R.isTestRun({ label: 'Bash', arg: 'cat export.test.mjs' })).toBe(false);
  expect(R.isTestRun({ label: 'Read', arg: 'export.test.mjs' })).toBe(false);
});

test('a fixing loop ends only on a passing run of the tests, not on a read of a test file', () => {
  // The run's side: only steps the agent marks as a run of the tests count (ev.tests).
  const out = new PassThrough();
  const said = [];
  out.on('data', (d) => String(d).split('\n').filter(Boolean).forEach((l) => said.push(JSON.parse(l))));
  const io = R.loopIO({ input: new PassThrough(), output: out, mode: 'auto' });
  io.event('tool', { label: 'Bash', arg: 'bun test', error: true, tests: { failed: true } });
  io.event('tool', { label: 'Update', arg: 'src/login.js', error: false });
  io.event('tool', { label: 'Bash', arg: 'bun test 2>&1 | tail -5', error: false, tests: { failed: true } });
  io.event('tool', { label: 'Bash', arg: 'cat test/login.test.js', error: false });
  io.end({ reason: 'done', finalText: 'I changed the login check; one test still fails.' });
  expect(said.map((e) => [e.t, e.test, e.failed])).toEqual([['tool', true, true], ['tool', false, undefined], ['tool', true, true], ['tool', false, undefined], ['end', undefined, undefined]]);
  expect(said.at(-1).tests).toEqual({ ok: false });
  // How many fail goes with it when the runner counted them.
  const counted = [];
  const out2 = new PassThrough();
  out2.on('data', (d) => String(d).split('\n').filter(Boolean).forEach((l) => counted.push(JSON.parse(l))));
  const io2 = R.loopIO({ input: new PassThrough(), output: out2, mode: 'auto' });
  io2.event('tool', { label: 'Bash', arg: 'node --test', error: true, tests: { failed: true, count: 2 } });
  io2.end({ reason: 'done', finalText: 'Two still fail.' });
  expect(counted.at(-1).tests).toEqual({ ok: false, count: 2 });
  // The window's side: the loop goes on, and the board draws the piped run as failing tests.
  const w = window();
  const l = w.m.add(L.parseLoop('debug'));
  w.pass(2000);
  for (const e of said) w.runs[0].emit(e);
  expect(l.state).toBe('waiting');
  expect(l.runs.at(-1).ok).toBe(false);
  const lines = L.readRun(w.dir, process.pid, l.id, 1);
  expect(lines.filter((x) => x.kind === 'fail').map((x) => x.text)).toEqual(['Bash(bun test)', 'Bash(bun test 2>&1 | tail -5)']);
  expect(lines.find((x) => x.text === 'Bash(cat test/login.test.js)')).toMatchObject({ kind: 'tool', test: false });
  w.m.close();
});

test('/loop reads a time in short or long words, first or last', () => {
  const read = (t) => { const p = L.parseLoop(t, { min: 60 }); return [p.every, p.message]; };
  expect(read('10m check the tests')).toEqual([600, 'check the tests']);
  expect(read('10 minutes check the tests')).toEqual([600, 'check the tests']);
  expect(read('10 min check the tests')).toEqual([600, 'check the tests']);
  expect(read('1 hour read the news')).toEqual([3600, 'read the news']);
  expect(read('2 hours check the build')).toEqual([7200, 'check the build']);
  expect(read('every 30 seconds say hi')).toEqual([60, 'say hi']); // the shortest gap is a minute
  expect(read('every hour, check the tests')).toEqual([3600, 'check the tests']);
  expect(read('check the tests every 10 minutes')).toEqual([600, 'check the tests']);
  expect(read('read the Bun release page every day.')).toEqual([86_400, 'read the Bun release page']);
  expect(L.parseLoop('tests every 5 minutes', { min: 60 })).toMatchObject({ kind: 'test', every: 300, name: 'Run the tests' });
  // A time inside the message is the message's own.
  expect(read('fix the bug that happens every 5 minutes on start')).toEqual([null, 'fix the bug that happens every 5 minutes on start']);
  expect(read('3 tests fail, fix them')).toEqual([null, '3 tests fail, fix them']);
});

test('a run\'s last line is read even when it arrives after the run\'s process has gone', async () => {
  // The run exits at once; something it started writes its end line 300 ms later on the same output.
  const dir = mkdtempSync(join(tmpdir(), 'agentic-late-'));
  writeFileSync(join(dir, 'later.mjs'), 'setTimeout(() => console.log(JSON.stringify({ t: "end", reason: "done", final: "all good" })), 300);\n');
  writeFileSync(join(dir, 'run.mjs'), `import { spawn } from 'node:child_process';\nspawn(process.execPath, [${JSON.stringify(join(dir, 'later.mjs'))}], { stdio: ['ignore', 'inherit', 'inherit'] });\nprocess.exit(0);\n`);
  const h = L.startRun({ folder: dir, prompt: 'x' }, { self: [process.execPath, join(dir, 'run.mjs')], env: { ...process.env } });
  const end = await new Promise((done) => h.on((ev) => { if (ev.t === 'end') done(ev); }));
  expect(end).toMatchObject({ reason: 'done', final: 'all good' });
});
