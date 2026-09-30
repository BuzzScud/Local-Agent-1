// A small menu for the plain terminal, before the Ink screen is up (the
// safety check at start, questions under coding -p). It looks like the
// dialogs inside the app: ❯ marks the row, up/down move it, enter picks
// it. Typing a number picks that row at once, as in the app. Esc or
// ctrl+c gives null. Answers the index of the row picked.
import { emitKeypressEvents } from 'node:readline';

const MARK = '\x1b[38;5;147m'; // the app's C.ask (#afafff)
const OFF = '\x1b[0m';

// page(i), when given, draws the whole block with row i marked (the safety check's two columns,
// start.jsx) in place of the plain list; it is redrawn whole when the mark moves.
export function pickOnTerminal(options, { input = process.stdin, output = process.stderr, index = 0, hint = 'Enter to confirm · Esc to exit', page = null } = {}) {
  const n = options.length;
  const text = (i) => (page ? page(i) : options.map((o, k) => `${k === i ? `${MARK}❯` : ' '} ${k + 1}. ${o}${k === i ? OFF : ''}\n`).join('') + (hint ? `\n\x1b[2m${hint}\x1b[0m\n` : ''));
  let rows = 0;
  const draw = (i) => { const t = text(i); rows = (t.match(/\n/g) ?? []).length; output.write(t); };
  // Rows are redrawn in place: move up, clear below, and print them again.
  const redraw = (i) => { output.write(`\x1b[${rows}A\x1b[J`); draw(i); };
  draw(index);
  return new Promise((resolve) => {
    let i = index;
    emitKeypressEvents(input);
    const raw = input.isTTY;
    if (raw) input.setRawMode(true);
    input.resume();
    const done = (v) => {
      input.off('keypress', onKey);
      if (raw) input.setRawMode(false);
      input.pause();
      resolve(v);
    };
    const onKey = (ch, key = {}) => {
      if (key.name === 'up' || key.name === 'k') redraw(i = (i + n - 1) % n);
      else if (key.name === 'down' || key.name === 'j' || key.name === 'tab') redraw(i = (i + 1) % n);
      else if (key.name === 'return' || key.name === 'enter') done(i);
      else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) done(null);
      else if (/^[1-9]$/.test(ch ?? '') && Number(ch) <= n) { redraw(i = Number(ch) - 1); done(i); }
    };
    input.on('keypress', onKey);
  });
}
