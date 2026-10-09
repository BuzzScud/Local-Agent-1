// The mouse in the prompt box (/mouse on): what Terminal sends for a press,
// a drag and a release, and what the box does with them. The last test is the
// real app in a pseudo-terminal (see app.test.mjs); it plays Terminal's part
// by hand: the mouse reports, and the answer to "where is the cursor?".
import { test, expect } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty, emulate } from './pty.mjs';
import { T, setup, quit, quitTyped } from './app-setup.mjs';
import { MOUSE_ON, MOUSE_OFF, ASK_CURSOR, WHEEL_PAUSE_MS, parseMouse, parseCursorReply, isMouseText } from '../src/app/mouse.mjs';
import { posAt, wordAt, promptRows } from '../src/app/edit-input.mjs';
import { needs } from './needs.mjs';

const { textImage, mediaTool } = await import('../src/tools/media.mjs');

test('a mouse report is read as a press, a drag, a release or a scroll, with its cell; the cursor answer as a row and a cell', () => {
  expect(parseMouse('\x1b[<0;34;12M')).toEqual({ kind: 'press', col: 34, row: 12, shift: false });
  expect(parseMouse('\x1b[<32;35;13M')).toEqual({ kind: 'drag', col: 35, row: 13, shift: false });
  expect(parseMouse('\x1b[<0;35;13m')).toEqual({ kind: 'release', col: 35, row: 13, shift: false });
  expect(parseMouse('\x1b[<4;7;2M')).toEqual({ kind: 'press', col: 7, row: 2, shift: true }); // shift + click
  expect(parseMouse('\x1b[<64;5;5M').kind).toBe('wheel');
  expect(parseMouse('\x1b[<65;5;5M').kind).toBe('wheel');
  expect(parseMouse('\x1b[<2;5;5M').kind).toBe('other'); // the right button
  expect(parseMouse('\x1b[<35;5;5M').kind).toBe('move'); // moving with no button down: the bot's eyes follow it (9 Oct 2026)
  expect(parseMouse('\x1b[A')).toBeNull();
  expect(parseMouse('[<0;1;1M')).toBeNull(); // typed text that only looks like one
  expect(parseCursorReply('\x1b[24;5R')).toEqual({ row: 24, col: 5 });
  expect(parseCursorReply('\x1b[1;1R')).toEqual({ row: 1, col: 1 });
  expect(parseCursorReply('\x1b[24;5H')).toBeNull();
  // what the key handler gets for them (the escape cut off) is dropped, not typed
  for (const ch of ['[<0;34;12M', '[<0;34;12m', '[<64;1;1M', '[24;5R']) expect(isMouseText(ch)).toBe(true);
  for (const ch of ['', 'a', '[', '[A', '[1;2D', '<0;1;1M', 'see [<0;1;1M']) expect(isMouseText(ch)).toBe(false);
});

test('the position under the mouse: a cell of a drawn row, the row’s end past it, the start above the box, the end below; a double click’s word', () => {
  const s = { value: 'the quick brown fox jumps over\nline two', cursor: 0 };
  const o = { width: 12, skip: 0 };
  // rows: "the quick " · "brown fox " · "jumps over" · "line two"
  expect(promptRows(s.value, o).map((r) => s.value.slice(r.start, r.end))).toEqual(['the quick ', 'brown fox ', 'jumps over', 'line two']);
  expect(posAt(s, 0, 4, o)).toBe(4); // the q of "quick"
  expect(posAt(s, 1, 6, o)).toBe(16); // the f of "fox"
  expect(posAt(s, 1, 40, o)).toBe(19); // past the row's end: its last place, not the next row
  expect(posAt(s, 2, -3, o)).toBe(20); // left of the text (the border, the "> "): the row's start
  expect(posAt(s, -1, 5, o)).toBe(0); // above the box
  expect(posAt(s, 9, 0, o)).toBe(s.value.length); // below it
  expect(posAt({ value: '!ls -la', cursor: 0 }, -1, 0, { width: 12, skip: 1 })).toBe(1); // shell mode: the ! is not drawn
  const w = (i) => s.value.slice(...wordAt(s.value, i));
  expect(w(5)).toBe('quick');
  expect(w(4)).toBe('quick'); // its first letter
  expect(w(3)).toBe(' '); // on a space: the space
  expect(w(s.value.length)).toBe('two'); // past the end: the last word
  expect(wordAt(s.value, 30)).toEqual([30, 30]); // on the line break: nothing
  expect(wordAt('', 0)).toEqual([0, 0]);
});

// The cell of a word on the screen, as the mouse would report it (from 1).
const cellOf = (term, word) => {
  const b = term.buffer.active;
  for (let r = 0; r < term.rows; r++) {
    const x = (b.getLine(b.baseY + r)?.translateToString(true) ?? '').indexOf(word);
    if (x >= 0) return { col: x + 1, row: r + 1 };
  }
  throw new Error(`"${word}" is not on the screen`);
};
const cursorOf = (term) => ({ col: term.buffer.active.cursorX + 1, row: term.buffer.active.cursorY + 1 });
const last = (raw, a, b) => (raw.lastIndexOf(a) > raw.lastIndexOf(b) ? a : b);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// A press, then Terminal's part: the app asks "where is the cursor?" and is
// told where it was on the screen at that very moment (or `cursor`, when the
// test knows it without looking).
const press = async ({ write, raw }, at, cursor) => {
  const asked = raw().split(ASK_CURSOR).length;
  write(`\x1b[<0;${at.col};${at.row}M`);
  for (let i = 0; i < 100 && raw().split(ASK_CURSOR).length === asked; i++) await pause(10);
  const now = raw();
  const c = cursor ?? cursorOf(await emulate(now.slice(0, now.lastIndexOf(ASK_CURSOR)), 80, 24));
  write(`\x1b[${c.row};${c.col}R`);
};

test('the mouse is on from the start (/mouse off gives it back); /mouse on: a drag in the prompt box highlights across rows and copies, delete removes it, a double click takes a word, a scroll hands the mouse back, an empty box keeps it (for the footer\'s model label)', async () => {
  const { cwd, env, base } = setup();
  const clip = join(base, 'clipboard.txt');
  const fake = await startFakeServer([]);
  // 80 columns: the first row ends after "lima ", the rest is on a second row
  const P = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa';
  const picked = P.slice(P.indexOf('charlie'), P.indexOf('november'));
  const seen = {};
  const r = await runInPty({ cwd, cols: 80, rows: 24, env: { ...env, AGENTIC_CLIPBOARD: clip }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { sleep: 300 },
    { fn: ({ raw }) => { seen.start = last(raw(), MOUSE_ON, MOUSE_OFF); } }, // on from the start (7 Oct 2026)
    { type: '/mouse off' }, { key: 'enter' }, { wait: 'Mouse off' }, { sleep: 200 },
    { fn: ({ raw }) => { seen.offAt = raw().length; seen.turnedOff = last(raw(), MOUSE_ON, MOUSE_OFF); } },
    // off: a mouse report that arrives anyway is not typed
    { type: 'x' }, { key: '\x1b[<0;9;9M' }, { sleep: 200 }, { snapshot: 'off' }, { fn: ({ raw }) => { seen.offAsked = raw().slice(seen.offAt).includes(MOUSE_ON); } },
    { key: 'backspace' }, { sleep: 100 },
    { type: '/mouse on' }, { key: 'enter' }, { wait: 'Mouse on' },
    { fn: ({ raw }) => { seen.empty = last(raw(), MOUSE_ON, MOUSE_OFF); } }, // nothing in the box: still the app's (since 30 Sep), for a click on the footer's label
    { type: P }, { sleep: 400 },
    { fn: async (t) => {
      seen.typed = last(t.raw(), MOUSE_ON, MOUSE_OFF);
      const term = await t.screen();
      const from = cellOf(term, 'charlie'), to = cellOf(term, 'november');
      seen.rows = [from.row, to.row];
      await press(t, from);
      await pause(60);
      t.write(`\x1b[<32;${from.col + 9};${from.row}M`); await pause(30); // along the first row…
      t.write(`\x1b[<32;${to.col};${to.row}M`); await pause(30); // …and down to the second
      t.write(`\x1b[<0;${to.col};${to.row}m`);
    } },
    { wait: `copied ${picked.length} chars to clipboard` }, { snapshot: 'dragged' },
    { fn: () => { seen.dragClip = readFileSync(clip, 'utf8'); } },
    { key: 'backspace' }, { sleep: 300 }, { snapshot: 'deleted' },
    // a double click on "oscar": the cursor is on the cell of the first click by the second
    { fn: async (t) => {
      const term = await t.screen();
      const at = cellOf(term, 'oscar');
      const on = { col: at.col + 2, row: at.row };
      await press(t, on); t.write(`\x1b[<0;${on.col};${on.row}m`);
      await press(t, on, on); t.write(`\x1b[<0;${on.col};${on.row}m`);
    } },
    { wait: 'copied 5 chars to clipboard' },
    { fn: () => { seen.wordClip = readFileSync(clip, 'utf8'); } },
    // a scroll: the mouse goes back to Terminal, and comes back a moment later
    { key: '\x1b[<64;10;10M' }, { sleep: 300 }, { fn: ({ raw }) => { seen.scrolled = last(raw(), MOUSE_ON, MOUSE_OFF); } },
    { sleep: WHEEL_PAUSE_MS }, { fn: ({ raw }) => { seen.after = last(raw(), MOUSE_ON, MOUSE_OFF); } },
    { type: 'X' }, { sleep: 300 }, { snapshot: 'replaced' }, // typing replaces the word
    { key: 'ctrlC' }, { sleep: 300 }, { fn: ({ raw }) => { seen.cleared = last(raw(), MOUSE_ON, MOUSE_OFF); } },
    { key: '\x1b[<0;9;9M' }, { sleep: 200 }, { snapshot: 'stray' }, // one that was still on its way
    ...quit,
  ] });
  await fake.close();
  const prompt = (snap) => snap.split('\n').filter((l) => /^│ [> ] /.test(l)).map((l) => l.replace(/^│ [> ] /, '').replace(/\s*│\s*$/, '')).join('|');
  expect(seen.start).toBe(MOUSE_ON); // a fresh home: the mouse is the app's
  expect(seen.turnedOff).toBe(MOUSE_OFF);
  expect(seen.offAsked).toBe(false); // off: Terminal is never asked for the mouse
  expect(prompt(r.snapshots.off)).toBe('x');
  expect(seen.empty).toBe(MOUSE_ON);
  expect(seen.typed).toBe(MOUSE_ON);
  expect(seen.rows[1]).toBe(seen.rows[0] + 1); // the drag crossed two rows
  expect(seen.dragClip).toBe(picked);
  // the highlight: every selected letter on the selection's colour, nothing else
  const b = r.terms.dragged.buffer.active;
  let lit = '';
  for (let y = 0; y < b.length; y++) { const line = b.getLine(y); for (let x = 0; line && x < 80; x++) { const c = line.getCell(x); if (c?.isBgPalette() && c.getBgColor() === 24) lit += c.getChars() || ' '; } }
  expect(lit).toBe(picked);
  expect(prompt(r.snapshots.deleted)).toBe('alpha bravo november oscar papa');
  expect(seen.wordClip).toBe('oscar');
  expect(seen.scrolled).toBe(MOUSE_OFF);
  expect(seen.after).toBe(MOUSE_ON);
  expect(prompt(r.snapshots.replaced)).toBe('alpha bravo november X papa');
  expect(seen.cleared).toBe(MOUSE_ON); // an empty box keeps it
  expect(r.snapshots.stray).not.toContain('[<0;9;9M');
  expect(r.raw.split(MOUSE_ON).length).toBe(r.raw.split(MOUSE_OFF).length); // handed back every time it was taken
  expect(JSON.parse(readFileSync(join(base, 'home', 'settings.json'), 'utf8')).mouse).toBe(true); // kept for next time
  expect(r.code).toBe(0);
}, T);

test('the mouse while Agentic Coder answers: a drag still lands on its letters with the answer streaming in above the box; quitting with text in the box hands the mouse back', async () => {
  const { cwd, env, base } = setup();
  const clip = join(base, 'clipboard.txt');
  const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} of a long answer that keeps coming.`).join(' ');
  const fake = await startFakeServer([{ text: long }], { delayMs: 60, chunk: 6 }); // about half a minute of answer
  const P = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa';
  const picked = P.slice(P.indexOf('charlie'), P.indexOf('november'));
  const seen = {};
  const r = await runInPty({ cwd, cols: 80, rows: 24, env: { ...env, AGENTIC_CLIPBOARD: clip }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { sleep: 300 },
    { type: '/mouse on' }, { key: 'enter' }, { wait: 'Mouse on' },
    { type: 'tell me a long story' }, { key: 'enter' }, { wait: 'Sentence number 3' },
    { type: P }, { sleep: 300 },
    { fn: async (t) => {
      const term = await t.screen();
      const from = cellOf(term, 'charlie'), to = cellOf(term, 'november');
      await press(t, from);
      await pause(40);
      t.write(`\x1b[<32;${to.col};${to.row}M`); await pause(30);
      t.write(`\x1b[<0;${to.col};${to.row}m`);
    } },
    { wait: `copied ${picked.length} chars to clipboard` },
    { fn: ({ text }) => { seen.clip = readFileSync(clip, 'utf8'); seen.working = text.split('\n').slice(-9).join('\n').includes('esc to interrupt'); } },
    // esc drops the highlight, ctrl+c stops the answer; then "exit" typed over the text and sent, the mouse still taken
    { key: 'esc' }, { sleep: 300 }, { key: 'ctrlC' }, { sleep: 600 },
    { key: '\x01' }, { sleep: 120 }, { key: '\x01' }, { sleep: 300 }, { type: 'exit' }, { sleep: 300 },
    { fn: ({ raw }) => { seen.leaving = last(raw(), MOUSE_ON, MOUSE_OFF); } },
    { key: 'enter' }, { sleep: 300 },
  ] });
  await fake.close();
  expect(seen.clip).toBe(picked);
  expect(seen.working).toBe(true); // the answer was still coming
  expect(seen.leaving).toBe(MOUSE_ON); // text in the box as it quits…
  expect(last(r.raw, MOUSE_ON, MOUSE_OFF)).toBe(MOUSE_OFF); // …and Terminal has its mouse back
  expect(r.raw.split(MOUSE_ON).length).toBe(r.raw.split(MOUSE_OFF).length);
  expect(r.code).toBe(0);
}, T);

test.skipIf(needs('pictures', mediaTool))('a click on a card in the tray over the box opens that picture in Quick Look; a click beside the cards opens nothing', async () => {
  const { cwd, env, base } = setup();
  const shot = join(base, 'Screenshot 2026-10-07 at 10.12.33 AM.png');
  textImage(shot, 'HELLO 42', { w: 1440, h: 900 });
  const ql = join(base, 'quicklook.txt');
  const fake = await startFakeServer([]);
  const seen = {};
  const r = await runInPty({ cwd, cols: 80, rows: 24, env: { ...env, AGENTIC_TEST_QUICKLOOK: ql }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { sleep: 300 }, { type: 'look ' },
    { key: `\x1b[200~${shot.replace(/ /g, '\\ ')}\x1b[201~` }, { wait: 'Screenshot 10.12 AM' }, { sleep: 300 }, { snapshot: 'tray' },
    { fn: async (t) => {
      const term = await t.screen();
      const beside = cellOf(term, '[Image #1]');
      await press(t, { col: beside.col + 40, row: beside.row }); t.write(`\x1b[<0;${beside.col + 40};${beside.row}m`);
      await pause(300);
      seen.beside = existsSync(ql);
      const at = cellOf(term, 'Screenshot 10.12 AM');
      await press(t, { col: at.col + 3, row: at.row }); t.write(`\x1b[<0;${at.col + 3};${at.row}m`);
    } },
    { sleep: 400 }, { snapshot: 'clicked' }, ...quitTyped,
  ] });
  await fake.close();
  expect(r.snapshots.tray).toContain('click · ctrl+f: open');
  expect(seen.beside).toBe(false);
  const opened = readFileSync(ql, 'utf8').trim().split('\n');
  expect(opened).toEqual([join(base, 'home', 'attachments', opened[0].split('/').pop())]);
  expect(opened[0]).toEndWith('-1.png');
  expect(r.snapshots.clicked).toContain('> look [Image #1]'); // the box is as it was
}, T);
