// The mouse in the prompt box (/mouse on). Terminal keeps the mouse for itself
// until an app asks for it; asked, it sends every press, drag and release as
// text on the keyboard's line, with the cell the pointer is on. Plain data and
// pure functions here; App.jsx turns them into a cursor and a selection.
export const MOUSE_ON = '\x1b[?1000h\x1b[?1002h\x1b[?1006h'; // presses and releases, drags, cells as numbers
export const MOUSE_OFF = '\x1b[?1006l\x1b[?1002l\x1b[?1000l';
// Every move of the pointer, with no button held too (9 Oct 2026, the bot's eyes follow it: bot-layer.jsx):
// asked for only while the bot is shown and the mouse is the app's, given back with the mouse.
export const MOTION_ON = '\x1b[?1003h';
export const MOTION_OFF = '\x1b[?1003l';
// "Where is the cursor?": the terminal answers with its row and cell. The
// cursor sits where you type, so the answer says where the box is on screen.
export const ASK_CURSOR = '\x1b[6n';

export const DOUBLE_CLICK_MS = 400;
// The conversation's text is Terminal's to highlight, as in Claude Code (9 Oct 2026): the pointer resting
// this long on it hands the mouse back to Terminal, so a drag there is Terminal's own highlight (⌘C
// copies). A scroll hands it back at once, so the scroll moves the conversation as it always did. Any
// key or paste takes it again, for the prompt box, the boxes of steps and the bot (app-keys.mjs).
export const REST_MS = 250;

// One mouse report: { kind, col, row, shift }, cells counted from 1.
// kind: press · drag · release (the left button), wheel, move (no button: MOTION_ON), or other.
export function parseMouse(seq) {
  const m = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(seq);
  if (!m) return null;
  const b = Number(m[1]);
  const left = (b & 3) === 0;
  const kind = b & 64 ? 'wheel' : b & 32 && (b & 3) === 3 ? 'move' : !left ? 'other' : m[4] === 'm' ? 'release' : b & 32 ? 'drag' : 'press';
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
