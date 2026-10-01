// Text copied off this app's own screen and pasted back, put together as it
// was written (1 Oct 2026). Terminal copies what is drawn: the screen's own
// line breaks, the indent under a message's first line, the grey strip's
// padding spaces, the prompt box's │ edges. A paste that carries those marks
// loses them; any other paste stays exactly as it came.
//   The two places it comes from:
//   - your message in the conversation (rail.jsx UserStrip): " › " then the
//     words wrapped at width - 4, "   " under it, every row padded with spaces;
//   - the prompt box (screen.jsx PromptBox): "│ > " or "│   ", the words
//     wrapped at width - 6 (edit-input.mjs promptRows), padding, " │".
import stringWidth from 'string-width';

const EDGE = /^\s*[╭╰][─]*[╮╯]?\s*$/; // the box's top or bottom edge
const ROW_LEAD = /^│ (?:[>!] | {2})/; // the box's left edge and the "> " (or "! ", or two spaces under it)
const ROW_END = / +│ *$/; // padding and the right edge
const firstWord = (t) => /^\S*/.exec(t)[0];

// Lines that were one line on the screen's left and right: a row ends where
// the next word would not have fit (`fits(row, word)`); otherwise the break was
// typed. A row never starts with a space when it was wrapped.
function join(rows, fits, midWord = () => false) {
  let out = rows[0];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], cur = rows[i];
    const wrapped = prev !== '' && cur !== '' && !/^\s/.test(cur) && !fits(prev, firstWord(cur));
    out += wrapped ? (midWord(prev) ? '' : ' ') + cur : `\n${cur}`;
  }
  return out;
}

// The prompt box's rows: every row after the first starts at the box's left
// edge, every row before the last ends at its right edge, and there is no │
// inside the text (a table's rows have them).
function fromBox(lines, cols) {
  const rows = lines.filter((l, i) => !(EDGE.test(l) && (i === 0 || i === lines.length - 1)));
  if (rows.length < 2) return null;
  const isRow = rows.every((l, i) => (i === 0 || ROW_LEAD.test(l)) && (i === rows.length - 1 || ROW_END.test(l)));
  if (!isRow) return null;
  const inner = rows.map((l) => l.replace(ROW_LEAD, '').replace(ROW_END, '').replace(/\s+$/, ''));
  if (inner.some((t) => t.includes('│'))) return null;
  // The text width: a whole row is the box's width (six cells are edges and marks).
  const whole = rows.find((l) => ROW_LEAD.test(l) && ROW_END.test(l));
  const width = whole ? stringWidth(whole.replace(/\s+$/, '')) - 6 : Math.max(1, cols - 6);
  // A row cut inside one long word fills the row and has no space in it.
  return join(inner, (prev, word) => stringWidth(prev) + 1 + stringWidth(word) <= width, (prev) => stringWidth(prev) >= width && !prev.includes(' '));
}

// Your message as the conversation draws it: rows after the first start with
// three spaces, and the rows are padded out to the strip's width (every row
// before the last ends in a space, one shows padding; middle rows are one length).
function fromStrip(lines, cols) {
  let rows = [...lines];
  while (rows.length && !rows[0].trim()) rows.shift(); // the strip's blank top row
  while (rows.length && !rows.at(-1).trim()) rows.pop(); // and its blank bottom row
  if (rows.length < 2) return null;
  const rest = rows.slice(1);
  if (!rest.every((l) => /^ {3}\S/.test(l) || !l.trim())) return null;
  // every row before the last ends at the strip's right margin (a space), and some row shows padding
  if (!rows.slice(0, -1).every((l) => / $/.test(l)) || !rows.some((l) => / {2}$/.test(l))) return null;
  const middle = rows.slice(1, -1).filter((l) => l.trim()).map((l) => stringWidth(l));
  if (middle.length && middle.some((n) => n !== middle[0])) return null;
  // " › " + the words (padded to the strip's text width) + " ": the text width is four less.
  const width = middle.length ? middle[0] - 4 : Math.max(10, cols - 4);
  const text = [rows[0].replace(/^ ?› /, ''), ...rest.map((l) => l.slice(3))].map((t) => t.replace(/\s+$/, ''));
  return join(text, (prev, word) => prev.length + 1 + word.length <= width);
}

export function fromScreen(text, { cols = 80 } = {}) {
  const lines = String(text).split('\n');
  if (lines.length === 1) {
    // One row: its padding (and the box's edges, when the copy took them) go.
    const one = lines[0];
    if ((ROW_LEAD.test(one) || / {2,}│ *$/.test(one)) && ROW_END.test(one)) return one.replace(ROW_LEAD, '').replace(ROW_END, '').replace(/\s+$/, '');
    return / {3,}$/.test(one) && one.trim() ? one.replace(/\s+$/, '') : one;
  }
  return fromBox(lines, cols) ?? fromStrip(lines, cols) ?? text;
}
