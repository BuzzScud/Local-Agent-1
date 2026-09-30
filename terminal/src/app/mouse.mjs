// The mouse in the prompt box (/mouse on). Terminal keeps the mouse for itself
// until an app asks for it; asked, it sends every press, drag and release as
// text on the keyboard's line, with the cell the pointer is on. Plain data and
// pure functions here; App.jsx turns them into a cursor and a selection.
export const MOUSE_ON = '\x1b[?1000h\x1b[?1002h\x1b[?1006h'; // presses and releases, drags, cells as numbers
export const MOUSE_OFF = '\x1b[?1006l\x1b[?1002l\x1b[?1000l';
// "Where is the cursor?": the terminal answers with its row and cell. The
// cursor sits where you type, so the answer says where the box is on screen.
export const ASK_CURSOR = '\x1b[6n';

export const DOUBLE_CLICK_MS = 400;
// A scroll hands the mouse back to Terminal for this long, so the rest of the
// scroll moves the conversation as it always did.
export const WHEEL_PAUSE_MS = 1500;

// One mouse report: { kind, col, row, shift }, cells counted from 1.
// kind: press · drag · release (the left button), wheel, or other.
export function parseMouse(seq) {
  const m = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(seq);
  if (!m) return null;
  const b = Number(m[1]);
  const left = (b & 3) === 0;
  const kind = b & 64 ? 'wheel' : !left ? 'other' : m[4] === 'm' ? 'release' : b & 32 ? 'drag' : 'press';
  return { kind, col: Number(m[2]), row: Number(m[3]), shift: Boolean(b & 4) };
}

// The terminal's answer to ASK_CURSOR: { row, col }, counted from 1.
export function parseCursorReply(seq) {
  const m = /^\x1b\[(\d+);(\d+)R$/.exec(seq);
  return m ? { row: Number(m[1]), col: Number(m[2]) } : null;
}

// A mouse report or a cursor answer as the key handler gets it (its escape
// cut off): never typed text, so it is dropped there.
export const isMouseText = (ch) => /^\[(<\d+;\d+;\d+[Mm]|\d+;\d+R)$/.test(ch ?? '');
