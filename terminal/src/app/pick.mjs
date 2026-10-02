// A small menu for the plain terminal, before the Ink screen is up (the
// safety check at start, questions under coding -p). It looks like the
// dialogs inside the app: ❯ marks the row, up/down move it, enter picks
// it. Typing a number picks that row at once, as in the app. Esc or
// ctrl+c gives null. Answers the index of the row picked.
//
// Keys are read here, not with readline's emitKeypressEvents: that one leaves its own listener on
// stdin after the menu closes, and the app's prompt box reads the same stdin right after (2 Oct
// 2026, "it won't let me type" after the Where to start menu). The menu takes off all it put on.

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
    let over = false;
    const raw = input.isTTY;
    if (raw) input.setRawMode(true);
    input.resume();
    const done = (v) => {
      over = true;
      input.off('data', onData);
      if (raw) input.setRawMode(false);
      input.pause();
      resolve(v);
    };
    const onKey = (k) => {
      if (k === 'up' || k === 'k') redraw(i = (i + n - 1) % n);
      else if (k === 'down' || k === 'j' || k === '\t') redraw(i = (i + 1) % n);
      else if (k === '\r' || k === '\n') done(i);
      else if (k === 'esc' || k === '\x03') done(null);
      else if (/^[1-9]$/.test(k) && Number(k) <= n) { redraw(i = Number(k) - 1); done(i); }
    };
    // One chunk can hold several keys (typed fast, or pasted): taken one at a time, and
    // nothing after the key that closes the menu.
    const onData = (chunk) => {
      for (const k of keysOf(String(chunk))) { if (over) break; onKey(k); }
    };
    input.on('data', onData);
  });
}

// The keys in a chunk of terminal input: arrows (ESC [ A or ESC O A) as 'up' / 'down', a lone
// ESC as 'esc', any other escape sequence skipped, and every other character as itself.
export function keysOf(s) {
  const keys = [];
  for (let j = 0; j < s.length; j++) {
    if (s[j] !== '\x1b') { keys.push(s[j]); continue; }
    const m = /^\x1b(?:\[[0-9;?]*[ -\/]*[@-~]|O[A-Z])/.exec(s.slice(j));
    if (!m) { keys.push('esc'); continue; }
    const last = m[0].at(-1);
    if (last === 'A') keys.push('up');
    else if (last === 'B') keys.push('down');
    j += m[0].length - 1;
  }
  return keys;
}
