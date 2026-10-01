// Text copied off the app's own screen and pasted back comes back as it was
// written (screen-copy.mjs); every other paste stays exactly as it came.
import { test, expect } from 'bun:test';
import { fromScreen } from '../src/app/screen-copy.mjs';
import { promptRows, rowText, promptTextWidth } from '../src/app/edit-input.mjs';
import { wrap } from '../src/ui/parts.jsx';

// Your message as the conversation draws it (rail.jsx UserStrip), and as
// Terminal copies it: from the first word to the end of the last row.
function stripCopy(text, width) {
  const inner = width - 4;
  const lines = text.split('\n').flatMap((l) => (l.trim() ? wrap(l, inner) : ['']));
  const rows = lines.map((l, i) => ` ${i === 0 ? '›' : ' '} ${l.padEnd(inner)} `);
  return [rows[0].slice(3), ...rows.slice(1)].join('\n');
}
// The prompt box (screen.jsx PromptBox), copied from the first word to its right edge.
function boxCopy(value, width) {
  const w = promptTextWidth(width);
  const rows = promptRows(value, { width: w }).map((r, i) => `│ ${i === 0 ? '>' : ' '} ${rowText(value, r, { width: w }).padEnd(w)} │`);
  return [rows[0].slice(4), ...rows.slice(1)].join('\n');
}

const MESSAGE = 'Make one HTML file that displays a social feed post. Include an author avatar and name, a timestamp, two or three lines of post text, a media placeholder block, and a row of like, comment, and share counts with tappable icons. Style it with CSS in the same file and use light JavaScript so Like can toggle on and update the count. No frameworks, no extra assets.';

test('your message copied off the conversation comes back as one line, at any width', () => {
  for (const width of [80, 100, 127, 160]) expect(fromScreen(stripCopy(MESSAGE, width), { cols: width })).toBe(MESSAGE);
});

test('the real copy of 1 Oct (a 127-column window): padding, indents and the screen line breaks go', () => {
  const copied = 'Make one HTML file that displays a social feed post. Include an author avatar and name, a timestamp, two or three lines of  \n   post text, a media placeholder block, and a row of like, comment, and share counts with tappable icons. Style it with CSS   \n   in the same file and use light JavaScript so Like can toggle on and update the count. No frameworks, no extra assets.       \n   Design it like a modern app feed item that stays readable on desktop and phone. download it to my desktop when you are      \n   done. make it work and 100';
  expect(fromScreen(copied, { cols: 90 })).toBe('Make one HTML file that displays a social feed post. Include an author avatar and name, a timestamp, two or three lines of post text, a media placeholder block, and a row of like, comment, and share counts with tappable icons. Style it with CSS in the same file and use light JavaScript so Like can toggle on and update the count. No frameworks, no extra assets. Design it like a modern app feed item that stays readable on desktop and phone. download it to my desktop when you are done. make it work and 100');
});

test('line breaks you typed stay, and the strip\'s blank rows and › go', () => {
  const text = `Fix the header.\nshort line\n\n${MESSAGE}\n\nlast part of it, after a blank line`;
  for (const width of [80, 120]) {
    const whole = [' '.repeat(width), ...stripCopy(text, width).split('\n').map((l, i) => (i === 0 ? ` › ${l}` : l)), ' '.repeat(width)].join('\n');
    expect(fromScreen(whole, { cols: width })).toBe(text);
  }
  // A break typed after a row the next word would not have fit on looks just like the
  // screen's own break: it comes back as a space.
  const full = 'word '.repeat(15).trim(); // 74 letters: "next" would not fit on a row of 76 (80 columns)
  expect(fromScreen(stripCopy(`${full}\nnext`, 80), { cols: 80 })).toBe(`${full} next`);
});

test('the prompt box copied with its edges comes back as typed, a long word cut across rows too', () => {
  const long = `${MESSAGE}\n  an indented line\nsee ${'x'.repeat(130)} there`;
  for (const width of [80, 100, 140]) expect(fromScreen(boxCopy(long, width), { cols: width })).toBe(long);
  // the whole box, its top and bottom edges taken too
  const w = 100;
  const whole = `╭${'─'.repeat(w - 2)}╮\n│ > ${boxCopy(MESSAGE, w)}\n╰${'─'.repeat(w - 2)}╯`;
  expect(fromScreen(whole, { cols: w })).toBe(MESSAGE);
});

test('one row: the padding goes, and the box edges when the copy took them', () => {
  expect(fromScreen('fix the failing tests' + ' '.repeat(40), { cols: 80 })).toBe('fix the failing tests');
  expect(fromScreen(`│ > fix the failing tests${' '.repeat(40)} │`, { cols: 80 })).toBe('fix the failing tests');
  expect(fromScreen('a b  ', { cols: 80 })).toBe('a b  '); // two spaces: not padding
});

test('any other paste stays exactly as it came', () => {
  const keep = [
    'function f() {\n   return 1;\n}',
    'if (x)\n   y();\n   z();',
    'Line one with a markdown break  \nline two',
    '│ name │ value │\n│ a    │ 1     │\n│ b    │ 2     │',
    'a\nb\nc',
    'plain text',
    '   leading spaces\n   kept',
  ];
  for (const t of keep) expect(fromScreen(t, { cols: 80 })).toBe(t);
});
