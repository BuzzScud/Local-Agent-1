// Loops (/loop, src/app/loops.mjs) and their board (loops-draw.mjs, loops-board.mjs), without a
// model: what /loop reads, when a loop runs, what a question and a note do, when a loop ends, the
// files the board reads and the keys it sends back, and the Cards drawn at the sizes they meet.
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
  expect(m.steer(a.id, 'and leave the tests as they are')).toBe('Sent to Fix the failing tests: it reads it at its next step');
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
  expect(m.log.at(-1)).toMatchObject({ kind: 'stuck', id: a.id });
  // The board says so above the box and on its card, counts it as needing you, and the box takes a hint.
  const board = text(D.drawBoard(m.snapshot(), B.newUi(), { cols: 124, rows: 38, now: m.now(), linesOf: () => [] }));
  expect(board).toMatch(/FIX {2}Fix the failing tests is stuck: 2 tests still fail after runs 1 and 2\s+type a hint · \^R try again · \^S stop/);
  expect(board).toMatch(/Now {3}! stuck: 2 tests still fail/);
  expect(board).toMatch(/1 needs you/);
  expect(board).toMatch(/a hint for Fix the failing tests · enter sends it on with it/);
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
  expect(L.readState(dir, process.pid).reply).toMatchObject({ stamp: 's1', text: 'Sent to Run the tests: it reads it at its next step' });
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

test('the cards at every size: each row exactly the window, a card per loop in plain words, what waits for you above the box', () => {
  const b = board();
  const state = b.state();
  for (const [cols, rows] of [[124, 38], [96, 30], [100, 30], [112, 59], [160, 50], [200, 60]]) {
    const frame = D.drawBoard(state, B.newUi(), { cols, rows, now: b.m.now() + 1500, linesOf: b.linesOf });
    expect(frame).toHaveLength(rows);
    for (const r of frame) expect(D.rowWidth(r)).toBe(cols);
    const t = text(frame);
    expect(t).toContain('Stand-in loaded');
    expect(t).toMatch(/1 running · 1 needs you/);
    for (const part of ['FIX', 'TEST', 'Fix the failing tests', 'Run the tests', 'until done · run 1 · Manual', 'every 5m · run 1 · Manual']) expect(t).toContain(part);
    // Three cards across where they fit, else two, with the others a key away.
    if (cols >= 118) expect(t).toContain('WEB'); else expect(t).toContain('1 more ›');
    // Each card in words: the run that asks says so; the one under way, how long it has worked; then its last run, its next, your note.
    expect(t).toMatch(/Now {3}! asks you: May it change/);
    expect(t).toMatch(/Now {3}. starting · 2s/);
    expect(t).toMatch(/Last {2}no run yet/);
    expect(t).toMatch(/Next {2}after this run, every 5m/);
    expect(t).toMatch(/You {3}nothing yet: type below/);
    // The picked loop asks: the line above the box says how to answer it, and the box takes the answer.
    expect(t).toMatch(cols >= 110 ? /! {2}FIX {2}Fix the failing tests asks: May it change export\.mjs\?\s+type y yes · a yes, always \(every edit\) · n no/ : /! {2}FIX {2}Fix the failing tests asks: May it change export\.mjs\?\s+type y yes · a always · n no/);
    expect(t).toMatch(/Fix the failing tests asks: y, a, n, or a note/);
    expect(t).toMatch(/type y, a or n and enter \(anything else goes to it as a note\)/);
    // Each card's buttons by what it is doing; the keys say how to press them, in shorter words in a narrow window, so esc is never cut.
    expect(t).toMatch(/Yes {3}Always {3}No {3}Open/);
    expect(t).toMatch(/Pause {3}Stop {3}Start over {3}Open/);
    expect(t).toMatch(/Running 3 {3}Library 10 {4}tab switches/);
    expect(t).toMatch(/←→ a button.* enter press.* ↑↓ (another )?loop.* tab (the )?library.* \^N new.* esc close/);
    if (cols >= 124) expect(t).toMatch(/←→ a button · enter presses it · ↑↓ another loop · tab the library · \^N new loop · type talk to it · esc close/);
    if (rows >= 38) expect(t).toMatch(/What happened {3}newest first\s+\S+ {2}FIX {3}Fix the failing tes… asks: May it change export\.mjs\?/);
  }
  // In the coding window, esc goes back to the chat.
  expect(text(D.drawBoard(state, B.newUi({ inApp: true }), { cols: 124, rows: 38, now: b.m.now(), linesOf: b.linesOf }))).toMatch(/^ esc {2}chat › ↻ Loops[\s\S]*type talk to it · esc chat/);
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
  expect(none).toMatch(/tab opens the Library: a ready-made loop, one you kept, or a new one\./);
  expect(none).toMatch(/\/loop run the tests every 10 min until 6pm/);
  expect(none).toMatch(/type \/loop and what it should do, or tab for the Library/);
  for (let i = 1; i <= 6; i++) m.add(L.parseLoop(`${i}h tidy folder number ${i}`));
  pass(1000);
  const s = L.readState(dir, process.pid);
  const first = text(D.drawBoard(s, { ...B.newUi(), sel: 0 }, { cols: 124, rows: 38, now: m.now(), linesOf: () => [] }));
  expect(first.match(/┌─ TASK {2}tidy folder number \d/g)).toEqual(['┌─ TASK  tidy folder number 1', '┌─ TASK  tidy folder number 2', '┌─ TASK  tidy folder number 3']); // three cards across at 124
  expect(first).toContain('3 more ›');
  expect(first).toContain('every 1h · run 1 · Manual');
  const last = D.drawBoard(s, { ...B.newUi(), sel: 5 }, { cols: 124, rows: 38, now: m.now(), linesOf: () => [] });
  for (const r of last) expect(D.rowWidth(r)).toBe(124);
  expect(text(last)).toContain('┌─ TASK  tidy folder number 6');
  expect(text(last)).toContain('‹ 3 more');
  m.close();
});

test('the board\'s keys: typing always goes in the box, the commands are ctrl keys, and a stop needs y', () => {
  const b = board();
  const sent = [];
  let quits = 0;
  const bd = { state: b.state(), ui: B.newUi(), send: (c) => sent.push(c), quit: () => { quits++; } };
  const press = (...ks) => ks.forEach((k) => B.handleKey(bd, k));
  expect(B.keysOf('a\x1b[C\r\x7f\x1b\x13\x0e\x15')).toEqual(['a', 'right', 'enter', 'backspace', 'esc', '^S', '^N', '^U']);
  // The letters that were commands are text now (4 Oct 2026: an s and an enter once stopped a loop).
  press(...'stop quit rs');
  expect(bd.ui.chat.text).toBe('stop quit rs');
  expect(sent).toEqual([]);
  expect(quits).toBe(0);
  expect(bd.ui.view).toBe('main');
  press('^U');
  expect(bd.ui.chat.text).toBe('');
  // The picked loop asks to change a file: y, a or n, typed and sent, answers it.
  press('a', 'enter');
  expect(sent.pop()).toEqual({ op: 'answer', id: 1, choice: 'always' });
  // Other words go to it as a note, and it still asks.
  press(...'start with the header', 'enter');
  expect(sent.pop()).toMatchObject({ op: 'typed', id: 1, text: 'start with the header' });
  expect(bd.ui.toast.text).toMatch(/Sent as a note: it still asks/);
  // ↑↓ pick a loop; ^P pauses it; ^O opens its rules in the form (esc leaves them unchanged).
  press('down');
  expect(bd.ui.sel).toBe(1);
  press('^P'); expect(sent.pop()).toEqual({ op: 'pause', id: 2 });
  press('^O'); expect(bd.ui.view).toBe('setup'); expect(bd.ui.setup).toMatchObject({ id: 2, text: L.PRESET.test, f: { every: '5m', runs: 'no limit' } }); expect(D.stepOf(bd.ui.setup)).toBe('start');
  press('esc'); expect(bd.ui.view).toBe('main'); expect(sent).toEqual([]);
  // ^S asks first; enter does nothing there; n keeps it, y stops it.
  press('^S'); expect(bd.ui.view).toBe('confirm');
  press('enter'); expect(bd.ui.view).toBe('confirm'); expect(sent).toEqual([]);
  const asked = text(D.drawBoard(bd.state, bd.ui, { cols: 124, rows: 38, now: b.m.now(), linesOf: b.linesOf }));
  expect(asked).toMatch(/Stop "Run the tests"\? Its runs so far stay\.\s+y yes {3}n no {3}\(enter does nothing here\)/);
  press('n'); expect(bd.ui.view).toBe('main');
  press('^S', 'y'); expect(sent.pop()).toEqual({ op: 'stop', id: 2 });
  // enter sends what was typed to the picked loop; esc empties the box first.
  press('down', ...'quit rs 12', 'backspace', 'enter');
  expect(sent.pop()).toMatchObject({ op: 'typed', id: 3, text: 'quit rs 1' });
  expect(bd.ui.chat).toEqual({ text: '', as: 'note' });
  press(...'/loop test 5m');
  expect(bd.ui.chat.text).toBe('/loop test 5m');
  press('esc');
  expect(bd.ui.chat.text).toBe('');
  expect(quits).toBe(0);
  // ^G opens one run with its lines; esc comes back; esc again leaves the board.
  press('up', 'up', '^G');
  expect(bd.ui.view).toBe('watch');
  const watch = text(D.drawBoard(bd.state, bd.ui, { cols: 124, rows: 38, now: b.m.now(), linesOf: b.linesOf }));
  expect(watch).toMatch(/Fix the failing tests {2}· {2}run 1 {2}· {2}live/);
  expect(watch).toMatch(/> Some tests in this folder fail\./);
  expect(watch).toMatch(/⏺ Bash\(node --test\)\s+⎿ the tests fail\s+⏺ Read\(export\.mjs\)/);
  expect(watch).toMatch(/esc back to the cards/);
  press('esc'); expect(bd.ui.view).toBe('main'); expect(quits).toBe(0);
  press('esc'); expect(quits).toBe(1);
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

// ---- a loop's own rules and the controls of 4 Oct 2026 (the owner's ask: "i want to be able to control it more") ----
const at = (s) => Date.parse(`2026-10-04T${s}`);

test('a loop\'s rules as typed in the form or after /loop <n>: how often, runs, a stop time, a cap, steps', () => {
  expect(L.readEvery('7m')).toEqual({ every: 420, until: false, note: '' });
  expect(L.readEvery('every 2 hours')).toMatchObject({ every: 7200 });
  expect(L.readEvery('own pace')).toMatchObject({ every: null, until: false });
  expect(L.readEvery('until done', { kind: 'debug' })).toMatchObject({ every: null, until: true });
  expect(L.readEvery('until done', { kind: 'test' }).error).toMatch(/Only a loop that fixes tests/);
  expect(L.readEvery('10s')).toEqual({ every: 60, until: false, note: ' (the shortest gap is 1m)' });
  expect(L.readEvery('soon').error).toMatch(/How often/);
  // A time of day is the next time it comes round; a while counts from now.
  expect(L.readStopAt('18:30', at('10:00:00'))).toEqual({ stopAt: at('18:30:00') });
  expect(L.readStopAt('6pm', at('10:00:00'))).toEqual({ stopAt: at('18:00:00') });
  expect(L.readStopAt('9:15 am', at('10:00:00'))).toEqual({ stopAt: Date.parse('2026-10-05T09:15:00') }); // passed today: tomorrow
  expect(L.readStopAt('2h', at('10:00:00'))).toEqual({ stopAt: at('12:00:00') });
  expect(L.readStopAt('none')).toEqual({ stopAt: null });
  expect(L.readStopAt('25:00').error).toMatch(/Stop at/);
  expect(L.readStopAt('6').error).toMatch(/Stop at/); // an hour alone could be either
  expect(L.readRuns('5')).toEqual({ maxRuns: 5 });
  expect(L.readRuns('no limit')).toEqual({ maxRuns: null });
  expect(L.readRuns('0').error).toMatch(/Stop after/);
  expect(L.readCap('$1.50')).toEqual({ usdCap: 1.5 });
  expect(L.readCap('none')).toEqual({ usdCap: null });
  expect(L.readCap('$0').error).toMatch(/Spending cap/);
  expect(L.readSteps('20')).toEqual({ steps: 20 });
  expect(L.readSteps('as /effort')).toEqual({ steps: null });
  expect(L.readSteps('3').error).toMatch(/5 to 200/);
  // The whole form: the first wrong row is named, so the form can go to it.
  const ok = L.rulesOf({ message: 'Run the tests and say what fails', every: '5m', runs: '5', stopAt: '18:30', cap: '$1', steps: '20', mode: 'edits', askFirst: true }, { now: at('10:00:00') });
  expect(ok.rules).toEqual({ message: 'Run the tests and say what fails', kind: 'test', name: 'Run the tests and say what …', every: 300, until: false, maxRuns: 5, stopAt: at('18:30:00'), usdCap: 1, steps: 20, mode: 'edits', askFirst: true, picture: null });
  expect(L.rulesOf({ message: L.PRESET.debug, kind: 'debug', every: 'until done' }).rules).toMatchObject({ name: 'Fix the failing tests', until: true });
  // A loop loaded or kept by name keeps it, and its own three steps.
  expect(L.rulesOf({ message: 'Read the log', name: 'Log watcher', picture: [['READ', 'the log'], ['FIND', 'errors'], ['TELL', 'you']] }).rules).toMatchObject({ name: 'Log watcher', picture: [['READ', 'the log'], ['FIND', 'errors'], ['TELL', 'you']] });
  expect(L.rulesOf({ message: '' })).toMatchObject({ field: 'message' });
  expect(L.rulesOf({ message: 'x', every: '5m', runs: 'lots' })).toMatchObject({ field: 'runs', error: expect.stringMatching(/Stop after/) });
  // A loop's rules back into the form's words.
  const { m } = window();
  const l = m.add(ok.rules);
  expect(L.fieldsOf(l)).toEqual({ message: 'Run the tests and say what fails', kind: 'test', every: '5m', runs: '5', stopAt: '18:30', cap: '$1.00', steps: '20', mode: 'edits', askFirst: true });
  expect(L.limitWords(l)).toEqual(['0 of 5 runs', 'ends 18:30', '$0.00 of $1.00']);
  expect(L.limitWords(l, { short: true })).toEqual(['0/5 runs', 'till 18:30', '$0/$1']);
  m.close();
});

test('/loop <n> <rule>: one rule, or one thing done to a loop; a number then a time is a new loop', () => {
  expect(L.loopCommand('2 every 7m')).toEqual({ id: 2, op: 'rule', rules: { every: 420, until: false }, note: '' });
  expect(L.loopCommand('2 runs 5')).toMatchObject({ rules: { maxRuns: 5 } });
  expect(L.loopCommand('2 stop 18:30', { now: at('10:00:00') })).toMatchObject({ rules: { stopAt: at('18:30:00') } });
  expect(L.loopCommand('2 cap $2')).toMatchObject({ rules: { usdCap: 2 } });
  expect(L.loopCommand('2 mode accept edits')).toMatchObject({ rules: { mode: 'edits' } });
  expect(L.loopCommand('2 steps 20')).toMatchObject({ rules: { steps: 20 } });
  expect(L.loopCommand('2 ask on')).toMatchObject({ rules: { askFirst: true } });
  expect(L.loopCommand('2 undo run 3')).toEqual({ id: 2, op: 'undo', n: 3 });
  expect(L.loopCommand('2 redo keep start with the quoting test')).toEqual({ id: 2, op: 'redo', keep: true, text: 'start with the quoting test' });
  expect(L.loopCommand('2 stop')).toEqual({ id: 2, op: 'stop' });
  expect(L.loopCommand('2 fly').error).toBe(L.LOOP_HELP);
  for (const t of ['2 every 7m', '2 go', '2 stop', '2 stop 18:30', '2']) expect(L.isLoopCommand(t)).toBe(true);
  for (const t of ['10 minutes run the tests', '10m check', '2 run the tests every hour']) expect(L.isLoopCommand(t)).toBe(false);
  // The window does it, and says what changed; the board's chat box takes the same words.
  const { m, pass } = window();
  const a = m.add(L.parseLoop('test 5m'));
  expect(m.command('1 runs 3')).toEqual({ text: 'Run the tests: saved · test · every 5m · 0 of 3 runs · next run in 1s' });
  expect(a.maxRuns).toBe(3);
  expect(m.command('1 every until done').error).toMatch(/Only a loop that fixes tests runs until done/);
  expect(m.command('9 runs 3').error).toMatch(/No loop 9 here/);
  expect(m.typed('/loop 1 mode auto', a.id)).toMatch(/Run the tests: saved/);
  expect(a.mode).toBe('auto');
  pass(1000);
  expect(m.command('1 stop')).toEqual({ text: 'Stopped: Run the tests' });
  expect(m.command('1 runs 4').error).toMatch(/has ended: \/loop 1 again starts it again/);
  m.close();
});

test('a loop ends at its own limits: a number of runs, a stop time, its own spending; the window\'s $5 counts its loops\' runs', () => {
  {
    const { m, runs, pass } = window();
    const l = m.add({ ...L.parseLoop('test 1m'), maxRuns: 2 });
    pass(1000);
    runs[0].emit({ t: 'end', reason: 'done', final: 'All pass.' });
    expect(l.state).toBe('waiting');
    pass(60_000);
    runs[1].emit({ t: 'end', reason: 'done', final: 'All pass.' });
    expect(l).toMatchObject({ state: 'done', doneWhy: 'ran its 2 runs', counted: 2 });
    m.close();
  }
  {
    const { m, runs, pass, clock } = window();
    const l = m.add({ ...L.parseLoop('test 1m'), stopAt: clock.t + 90_000 });
    pass(1000);
    runs[0].emit({ t: 'end', reason: 'done', final: 'All pass.' });
    pass(90_000); // past its stop time before the next run is due
    expect(l).toMatchObject({ state: 'done', doneWhy: expect.stringMatching(/^reached its stop time, \d\d:\d\d$/) });
    expect(runs).toHaveLength(1);
    m.close();
  }
  {
    const { m, runs, pass } = window({ status: { where: 'its service', limit: 3 } });
    const l = m.add({ ...L.parseLoop('test 1m'), usdCap: 1 });
    const other = m.add(L.parseLoop('2m read the Bun release page'));
    pass(1000);
    runs[0].emit({ t: 'end', reason: 'done', final: 'All pass.', usd: 0.6 });
    expect(l.state).toBe('waiting');
    pass(60_000);
    runs.find((r) => r.spec.prompt.startsWith('Run the tests') && r !== runs[0]).emit({ t: 'end', reason: 'done', final: 'All pass.', usd: 0.6 });
    expect(l).toMatchObject({ state: 'done', doneWhy: 'spent $1.20 of its $1.00', spent: 1.2 });
    expect(other.state).not.toBe('done'); // another loop goes on
    m.close();
  }
  {
    const { m, runs, pass, money } = window();
    money.usd = 4.5; // the window's own
    const l = m.add(L.parseLoop('test 1m'));
    pass(1000);
    runs[0].emit({ t: 'end', reason: 'done', final: 'All pass.', usd: 0.6 });
    pass(60_000);
    expect(l).toMatchObject({ state: 'off', offWhy: expect.stringMatching(/^this window has spent \$5\.10 on its service/) });
    m.close();
  }
});

test('ask first: a run that is due waits for your go; go starts it, not now leaves it out (or pauses a loop with no time of its own)', () => {
  const { m, runs, pass } = window();
  const t = m.add({ ...L.parseLoop('test 5m'), askFirst: true });
  const d = m.add({ ...L.parseLoop('debug'), askFirst: true });
  pass(1000);
  expect(runs).toHaveLength(0);
  expect(t.ready).toMatchObject({ n: 1 });
  expect(m.ready.map((l) => l.id)).toEqual([1, 2]);
  expect(L.describe(t, m.now())).toMatch(/run 1 waits for your go$/);
  expect(m.go(t.id)).toBe(true);
  expect(runs).toHaveLength(1);
  expect(t.ready).toBe(null);
  runs[0].emit({ t: 'end', reason: 'done', final: 'All pass.' });
  pass(300_000);
  expect(t.ready).toMatchObject({ n: 2 }); // it asks again for its next run
  expect(m.notNow(t.id)).toBe(true);
  expect(t).toMatchObject({ ready: null, state: 'waiting' });
  expect(t.nextAt).toBe(m.now() + 300_000);
  expect(m.notNow(d.id)).toBe(true);
  expect(d.state).toBe('paused'); // runs until done: not now means pause
  // On the board: y typed to the picked loop starts its waiting run, n leaves it out.
  const s = (m.save(), L.readState(m.home, process.pid));
  const sent = [];
  const bd = { state: { ...s, loops: s.loops.map((l) => (l.id === 2 ? { ...l, ready: { n: 1, since: 1 } } : l)) }, ui: { ...B.newUi(), sel: 1 }, send: (c) => sent.push(c), quit: () => {} };
  B.handleKey(bd, 'y');
  B.handleKey(bd, 'enter');
  expect(sent.pop()).toEqual({ op: 'go', id: 2 });
  B.handleKey(bd, 'n');
  B.handleKey(bd, 'enter');
  expect(sent.pop()).toEqual({ op: 'skip', id: 2 });
  const frame = text(D.drawBoard(bd.state, bd.ui, { cols: 124, rows: 38, now: m.now(), linesOf: () => [] }));
  expect(frame).toMatch(/! {2}FIX {2}Fix the failing tests · run 1 is ready and waits for your go\s+type y go · n not now \(pause\) · \^O edit first/);
  expect(frame).toMatch(/Manual · asks first/);
  expect(frame).toMatch(/Next {2}type y to start it, n to leave it/);
  m.close();
});

test('changing a loop: new rules keep its name; one that ended starts again with its run count and spending from nothing', () => {
  const { m, runs, pass } = window();
  const l = m.add({ ...L.parseLoop('test 5m'), maxRuns: 1 });
  pass(1000);
  runs[0].emit({ t: 'end', reason: 'done', final: 'All pass.', usd: 0.2 });
  expect(l).toMatchObject({ state: 'done', doneWhy: 'ran its 1 run' });
  expect(m.edit(l.id, { maxRuns: 3 }).error).toMatch(/has ended/);
  const r = m.edit(l.id, { ...L.rulesOf({ message: L.PRESET.test, kind: 'test', every: '2m', runs: '3' }).rules }, { again: true });
  expect(r.text).toMatch(/^Run the tests: starts again · test · every 2m · 0 of 3 runs/);
  expect(l).toMatchObject({ state: 'waiting', name: 'Run the tests', every: 120, maxRuns: 3, counted: 0, spent: 0, doneWhy: null });
  pass(1000);
  expect(runs).toHaveLength(2);
  runs[1].emit({ t: 'end', reason: 'done', final: 'All pass.' });
  // A new pace counts from the last run's end; a new message brings a new name.
  m.edit(l.id, { every: 600, until: false });
  expect(l.nextAt).toBe(l.runs.at(-1).endedAt + 600_000);
  m.edit(l.id, L.rulesOf({ message: 'Run lint and say what it finds', every: '10m' }).rules);
  expect(l.name).toBe('Run lint and say what it fi…');
  m.close();
});

// A pretend rewind store: what was put back, and when.
function fakeRewind() {
  const calls = [];
  return { calls, make: async (session) => ({ restore: async (n, o) => { calls.push({ session, n, ...o }); return { put: [{ rel: 'export.mjs' }], skip: [{ rel: 'notes.md', why: 'changed since, by you or another session' }], failed: [] }; } }) };
}
test('start over: the run stops, its changes go back once its copy is in, and a run starts with your note; keeping them, nothing goes back', async () => {
  const rw = fakeRewind();
  const clock = { t: 1_800_000_000_000 };
  const runs = [];
  const m = new L.Loops({ home: join(home, 'redo'), pid: process.pid, now: () => clock.t, status: () => ({ on: true, limit: 1 }), rewind: rw.make,
    start: (spec) => { const fns = []; const h = { spec, kills: [], on: (f) => fns.push(f), send: () => {}, kill: (o) => h.kills.push(o ?? {}), emit: (e) => fns.forEach((f) => f(e)) }; runs.push(h); return h; } });
  const l = m.add(L.parseLoop('debug'));
  clock.t += 1000; m.tick();
  expect(m.redo(l.id, 'start with the quoting test').text).toBe('Fix the failing tests: stopping run 1 to start over, its changes put back first');
  expect(runs[0].kills).toEqual([{ wait: true }]); // given time to keep its copy
  expect(l.state).toBe('redoing');
  expect(l.runs[0]).toMatchObject({ n: 1, summary: 'stopped to start over', redo: { note: 'start with the quoting test', putBack: true } });
  expect(l.counted).toBe(0); // a run stopped to start over does not count
  m.tick();
  expect(runs).toHaveLength(1); // nothing starts before its copy is in
  // Its last word, with its copies: they go back, then the new run starts with the note.
  runs[0].emit({ t: 'end', reason: 'interrupted', final: '', point: 7, until: 8, files: [{ path: 'export.mjs', by: 'edit' }] });
  await new Promise((r) => setTimeout(r, 20));
  expect(rw.calls).toEqual([{ session: L.sessionOf(process.pid, l.id), n: 7, until: 8 }]);
  expect(l.runs[0].undone).toMatchObject({ put: ['export.mjs'], skip: [{ rel: 'notes.md' }] });
  expect(runs).toHaveLength(2);
  expect(runs[1].spec.prompt).toMatch(/\(A note from the user for this run: start with the quoting test\)/);
  expect(runs[1].spec.rewind).toBe(L.sessionOf(process.pid, l.id));
  // Keeping its changes: nothing goes back.
  expect(m.redo(l.id, '', { putBack: false }).text).toBe('Fix the failing tests: stopping run 2 to start over');
  runs[1].emit({ t: 'end', reason: 'interrupted', final: '', point: 9 });
  await new Promise((r) => setTimeout(r, 20));
  expect(rw.calls).toHaveLength(1);
  expect(runs).toHaveLength(3);
  m.close();
});

test('undo puts back what one run changed, from the app\'s own rewind store; a file a later run changed is left alone', async () => {
  const { Rewind } = await import('../src/app/rewind.mjs');
  const base = mkdtempSync(join(tmpdir(), 'agentic-loop-undo-'));
  const cwd = join(base, 'project');
  const { mkdirSync, readFileSync } = await import('node:fs');
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, 'a.txt'), 'one\n');
  writeFileSync(join(cwd, 'b.txt'), 'one\n');
  const rhome = join(base, 'home');
  const session = L.sessionOf(process.pid, 1);
  // Two runs, as `coding -p --loop-events` keeps them: run 1 changes a.txt and b.txt, run 2 changes b.txt again.
  const runOne = async (changes) => {
    const rw = new Rewind({ home: rhome, session });
    const p = await rw.begin({ cwd, text: 'a run' });
    for (const [f, t] of changes) { rw.edited(join(cwd, f), readFileSync(join(cwd, f))); writeFileSync(join(cwd, f), t); }
    return rw.finish(p, { files: changes.map(([f]) => f) });
  };
  const p1 = await runOne([['a.txt', 'two\n'], ['b.txt', 'two\n']]);
  const p2 = await runOne([['b.txt', 'three\n']]);
  const clock = { t: 1_800_000_000_000 };
  const runs = [];
  const m = new L.Loops({ home: rhome, pid: process.pid, folder: cwd, now: () => clock.t, status: () => ({ on: true, limit: 1 }),
    start: (spec) => { const fns = []; const h = { spec, on: (f) => fns.push(f), send: () => {}, kill: () => {}, emit: (e) => fns.forEach((f) => f(e)) }; runs.push(h); return h; } });
  const l = m.add(L.parseLoop('2m tidy the notes'));
  clock.t += 1000; m.tick();
  runs[0].emit({ t: 'end', reason: 'done', final: 'Done.', point: p1.n, files: p1.files.map((f) => ({ path: f.path, by: f.by })) });
  clock.t += 120_000; m.tick();
  expect((await m.undo(l.id, 1)).error).toMatch(/is running: wait for run 2 to end/); // not under a run's feet
  runs[1].emit({ t: 'end', reason: 'done', final: 'Done.', point: p2.n });
  expect(l.runs[0].files.map((f) => f.path).sort()).toEqual(['a.txt', 'b.txt']);
  const r = await m.undo(l.id, 1);
  expect(r.text).toBe('Put back run 1: a.txt · left alone: b.txt (changed since)');
  expect(readFileSync(join(cwd, 'a.txt'), 'utf8')).toBe('one\n');
  expect(readFileSync(join(cwd, 'b.txt'), 'utf8')).toBe('three\n');
  expect((await m.undo(l.id, 1)).error).toBe('Run 1 was already put back');
  expect((await m.undo(l.id)).text).toBe('Put back run 2: b.txt'); // no number: the last run not put back
  expect(readFileSync(join(cwd, 'b.txt'), 'utf8')).toBe('two\n');
  m.close();
});

test('the board\'s other keys: ^N and tab open the Library, ^X starts over (again keeps the changes), ^B undoes after a y, a number answers a question', () => {
  const b = board();
  const sent = [];
  const bd = { state: b.state(), ui: B.newUi(), send: (c) => sent.push(c), quit: () => {} };
  const press = (...ks) => ks.forEach((k) => B.handleKey(bd, k));
  let frame;
  // ^N and tab: the Library beside the cards; esc (or tab) is the cards again, since there are loops.
  press('^N'); expect(bd.ui.view).toBe('shelf');
  press('esc'); expect(bd.ui.view).toBe('main');
  press('tab'); expect(bd.ui.view).toBe('shelf');
  press('tab'); expect(bd.ui.view).toBe('main');
  expect(sent).toEqual([]);
  // ^X: the box starts the picked loop over with your words; ^X again keeps its changes.
  press('down', '^X', ...'only the quoting test');
  expect(bd.ui.chat).toMatchObject({ as: 'redo', text: 'only the quoting test' });
  frame = text(D.drawBoard(bd.state, bd.ui, { cols: 124, rows: 38, now: b.m.now(), linesOf: () => [] }));
  expect(frame).toMatch(/start Run the tests over with this · its changes go back first/);
  press('^X');
  expect(bd.ui.chat.as).toBe('redoKeep');
  press('enter');
  expect(sent.pop()).toMatchObject({ op: 'redo', id: 2, text: 'only the quoting test', putBack: false });
  // ^B: the last run with a copy, after a y.
  bd.state = { ...bd.state, loops: bd.state.loops.map((l) => (l.id === 2 ? { ...l, current: null, runs: [{ n: 1, ok: true, point: 4, files: [{ path: 'export.mjs', by: 'edit' }], summary: 'All pass' }] } : l)) };
  press('^B');
  expect(bd.ui.view).toBe('confirm');
  expect(bd.ui.confirm.text).toBe('Put back what run 1 changed? export.mjs. A file changed since stays as it is.');
  press('enter');
  expect(bd.ui.view).toBe('confirm'); // enter does nothing here
  press('y');
  expect(sent.pop()).toMatchObject({ op: 'undo', id: 2, n: 1 });
  // A question's choices: a number typed and sent picks one.
  bd.state = { ...bd.state, loops: bd.state.loops.map((l) => (l.id === 1 ? { ...l, current: { ...l.current, needs: { id: 5, kind: 'question', text: 'Which header style?', options: ['snake_case', 'Title Case', 'Keep them'], since: 1 } } } : l)) };
  press('up');
  frame = text(D.drawBoard(bd.state, bd.ui, { cols: 124, rows: 38, now: b.m.now(), linesOf: () => [] }));
  expect(frame).toMatch(/Fix the failing tests asks: Which header style\?/);
  expect(frame).toMatch(/1 snake_case {3}2 Title Case {3}3 Keep them {3}or type your own answer/);
  expect(frame).toMatch(/your answer to Fix the failing tests/);
  press('4', 'enter');
  expect(sent).toEqual([]); // it gave three
  expect(bd.ui.chat.text).toBe('4');
  press('backspace', '2', 'enter');
  expect(sent.pop()).toEqual({ op: 'answer', id: 1, choice: 'yes', text: 'Title Case' });
  press(...'keep the order they came in', 'enter');
  expect(sent.pop()).toEqual({ op: 'answer', id: 1, choice: 'yes', text: 'keep the order they came in' });
  b.m.close();
});

test('an unclear task is asked about before the loop starts: a kind and a time typed together, or a single word', () => {
  const u = L.unclearOf('test5m');
  expect(u.why).toBe('"test5m" looks like two things typed together: "test" and "5m".');
  expect(u.options.map((o) => o.label)).toEqual(['Run the tests, every 5m', 'Keep "test5m" as what each run does', 'Type it again']);
  expect(u.options[0]).toMatchObject({ act: 'use', kind: 'test', every: '5m' });
  expect(L.unclearOf('debug10m').options[0]).toMatchObject({ kind: 'debug', every: '10m', label: 'Fix the failing tests, every 10m' });
  expect(L.unclearOf('fix2h').options[0]).toMatchObject({ kind: 'debug', every: '2h' });
  expect(L.unclearOf('5m check').why).toBe('"check" is one word. Each run gets only these words, so say what it should do.');
  expect(L.unclearOf('check').options.map((o) => o.act)).toEqual(['again', 'keep']);
  // A kind alone, a whole sentence, a page's address, and a change to a loop that is there are clear.
  for (const ok of ['test 5m', 'test', 'debug', '10m run the tests and say what fails', 'web 30m https://bun.sh/blog', 'web 30m read the Bun releases page', '1 every 7m', '2 stop']) expect(L.unclearOf(ok)).toBe(null);
});

test('the wizard: a step at a time with the picture beside it, test5m caught, a sentence filled in at the last step, the window makes it', () => {
  const b = board();
  const sent = [];
  const bd = { state: b.state(), ui: B.newUi(), send: (c) => sent.push(c), quit: () => {} };
  const press = (...ks) => ks.forEach((k) => B.handleKey(bd, k));
  const frame = (cols = 124, rows = 38) => { const f = D.drawBoard(bd.state, bd.ui, { cols, rows, now: b.m.now(), linesOf: () => [] }); for (const r of f) expect(D.rowWidth(r)).toBe(cols); return text(f); };
  // An unclear /loop line typed in the box: the wizard's first step asks about it; nothing is sent.
  press(...'/loop test5m', 'enter');
  expect(sent).toEqual([]);
  expect(bd.ui.view).toBe('setup');
  expect(bd.ui.setup).toMatchObject({ step: 0, text: 'test5m' });
  expect(frame()).toMatch(/! "test5m" looks like two things typed together:[\s\S]{0,140}"test" and "5m"\./); // wrapped in its box
  expect(frame(96, 30)).toMatch(/▸ 1 {2}Run the tests, every 5m/);
  press('1');
  expect(D.stepOf(bd.ui.setup)).toBe('where');
  expect(bd.ui.setup).toMatchObject({ text: L.PRESET.test, f: { kind: 'test', every: '5m' } });
  let f = frame();
  expect(f).toMatch(/✓ 1 What {2}── {2}◉ 2 Where {2}── {2}○ 3 How often/);
  expect(f).toMatch(/Where should it work\?/);
  expect(f).toMatch(/Your loop[\s\S]*“Run the tests\. Say which fail and why/);
  expect(f).toMatch(/1 RUN[\s\S]*2 READ[\s\S]*3 TELL/);
  press('enter');
  expect(frame()).toMatch(/How often should it run\?/);
  expect(frame()).toMatch(/▸ every 5 minutes/);
  press('enter');
  expect(frame()).toMatch(/When should it stop\?/);
  press('down', 'down', 'enter'); // after 5 runs
  f = frame();
  expect(f).toMatch(/Ready to start/);
  expect(f).toMatch(/ends after run 5/);
  expect(f).toMatch(/Save as {6}optional: keep it to load again/);
  expect(f).toMatch(/Start the loop/);
  press('enter');
  const add = sent.pop();
  expect(add).toMatchObject({ op: 'add', save: null, fields: { message: L.PRESET.test, kind: 'test', every: '5m', runs: '5', stopAt: 'none', mode: 'ask', folder: '/tmp/demo' } });
  expect(bd.ui.view).toBe('main');
  // The window makes it: a test loop every 5 minutes that stops after 5 runs.
  const r = b.m.apply(add);
  expect(r).toMatchObject({ made: 4, text: expect.stringMatching(/^Loop 4 started: test · every 5m · 0 of 5 runs/) });
  expect(b.m.loop(4)).toMatchObject({ kind: 'test', every: 300, maxRuns: 5, name: 'Run the tests' });
  // A sentence: the last step, filled in from what was read; ← goes back a step, where a wrong answer stays.
  press(...'/loop tidy the notes folder every 7m until 18:30', 'enter');
  expect(D.stepOf(bd.ui.setup)).toBe('start');
  expect(bd.ui.setup).toMatchObject({ text: 'tidy the notes folder', f: { every: '7m', stopAt: '18:30' } });
  f = frame();
  expect(f).toMatch(/You typed {2}\/loop tidy the notes folder every 7m…/); // cut to its box
  expect(f).toMatch(/Read {6}every 7m {2}· {2}until 18:30/);
  press('left');
  expect(D.stepOf(bd.ui.setup)).toBe('stop');
  press(...'soon', 'enter');
  expect(frame()).toMatch(/! Stop at: a time like 18:30 or 6pm, or a while[\s\S]{0,140}like 2h/); // wrapped in its box
  expect(D.stepOf(bd.ui.setup)).toBe('stop');
  press('^U', ...'2h', 'enter');
  expect(D.stepOf(bd.ui.setup)).toBe('start');
  press('enter');
  expect(sent.pop()).toMatchObject({ op: 'add', fields: { message: 'tidy the notes folder', kind: 'task', every: '7m', runs: 'no limit', stopAt: '2h' } });
  // Typing over an example starts your own words (it had been added to the example's).
  B.openSetup(bd.ui, { mode: 'ask' });
  expect(bd.ui.setup.text).toBe(D.TEMPLATES[0].text);
  press(...'check the logs');
  expect(bd.ui.setup.text).toBe('check the logs');
  // One word is asked about; keeping it goes on; esc leaves the wizard and sends nothing.
  press('esc');
  press(...'/loop check', 'enter');
  expect(bd.ui.setup.unclear.why).toMatch(/"check" is one word/);
  press('2');
  expect(D.stepOf(bd.ui.setup)).toBe('where');
  expect(bd.ui.setup.text).toBe('check');
  press('esc');
  expect(bd.ui.view).toBe('main');
  expect(sent).toEqual([]);
  b.m.close();
});

test('a note to a loop that ended starts it again with the note; its card says what became of your last note', () => {
  const { m, runs, pass } = window();
  const l = m.add({ ...L.parseLoop('test 5m'), maxRuns: 1 });
  pass(1000);
  // A note while a run works: sent, then read after the step it went with.
  m.steer(l.id, 'only the unit tests');
  expect(D.youWords(l)).toEqual(['“only the unit tests”', 'sent: it reads it at its next step', 'dim']);
  runs[0].emit({ t: 'heard', text: 'only the unit tests', after: 'Bash(node --test)' });
  expect(D.youWords(l)).toEqual(['“only the unit tests”', '✓ read after Bash(node --test)', 'accentDim']);
  runs[0].emit({ t: 'end', reason: 'done', final: 'All pass.' });
  expect(l).toMatchObject({ state: 'done', doneWhy: 'ran its 1 run' });
  expect(D.nextWords(l, m.now())).toEqual(['type a note: enter starts it again', 'faint']);
  // Ended: a note starts it again (its counts from nothing), and its next run starts with the note.
  expect(m.steer(l.id, 'now the slow ones too')).toBe('Run the tests starts again, with your note');
  expect(l).toMatchObject({ state: 'waiting', counted: 0, note: 'now the slow ones too' });
  expect(D.youWords(l)[1]).toBe('its next run starts with it');
  pass(1000);
  expect(runs).toHaveLength(2);
  expect(runs[1].spec.prompt).toContain('(A note from the user for this run: now the slow ones too)');
  expect(D.youWords(l)[1]).toBe('✓ read at the start of run 2');
  // A note that came as the answer was given was its next message: read, with no step after it.
  m.steer(l.id, 'and say how long they took');
  runs[1].emit({ t: 'end', reason: 'done', final: 'All pass; it took 3 s.' });
  expect(D.youWords(l)[1]).toBe('✓ read as it gave its answer');
  expect(m.log.filter((e) => e.kind === 'state').map((e) => e.text)).toContain('started again');
  m.close();
});

test('a note typed to a run is read with its next step\'s result, and the board is told after which step', () => {
  const out = new PassThrough();
  const said = [];
  out.on('data', (d) => said.push(...String(d).trim().split('\n').map((x) => JSON.parse(x))));
  const input = new PassThrough();
  const io = R.loopIO({ input, output: out });
  io.event('tool', { label: 'Read', arg: 'export.mjs' });
  input.write('{"t":"note","text":"keep the header order"}\n');
  return new Promise((resolve) => setTimeout(() => {
    expect(io.steering()).toEqual(['keep the header order']);
    expect(io.more()).toBe(null); // taken once
    io.event('steered', { notes: ['keep the header order'] });
    io.end({ reason: 'done', finalText: 'Fixed.' }, { usd: 0.02, point: 3, until: 4, files: [{ path: 'export.mjs', by: 'edit' }] });
    setTimeout(() => {
      expect(said.find((x) => x.t === 'heard')).toEqual({ t: 'heard', text: 'keep the header order', after: 'Read(export.mjs)' });
      expect(said.at(-1)).toMatchObject({ t: 'end', reason: 'done', final: 'Fixed.', usd: 0.02, point: 3, until: 4, files: [{ path: 'export.mjs', by: 'edit' }] });
      resolve();
    }, 10);
  }, 20));
});
