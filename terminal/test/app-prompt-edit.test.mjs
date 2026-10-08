// End-to-end, the real app in a pseudo-terminal (see app.test.mjs).
// Here: moving around the prompt box. ⌥-click in Terminal sends arrow keys
// counted from the terminal's own cursor, so that cursor must sit on the
// cell you type at; the arrows come all at once.
import { test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quitTyped } from './app-setup.mjs';

// The screen's lines and the terminal cursor's line and cell.
const where = (term) => {
  const b = term.buffer.active;
  const lines = [];
  for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? '');
  return { lines, y: b.baseY + b.cursorY, x: b.cursorX };
};
const UP = '\x1b[A', DOWN = '\x1b[B', LEFT = '\x1b[D';

test('the terminal cursor sits where you type, ⌥-click arrows land on the letter, ↓ moves a row, ctrl+z undoes, ctrl+a twice and ⌥A select all (not copied) and delete clears it', async () => {
  const { cwd, env, base } = setup();
  const clip = join(base, 'clipboard.txt');
  const fake = await startFakeServer([]);
  // 80 columns: 74 for the text, so this wraps after "lima " (73 cells), the rest on a second row
  const P = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa';
  const r = await runInPty({ cwd, cols: 80, rows: 24, env: { ...env, AGENTIC_CLIPBOARD: clip }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { sleep: 300 },
    { type: P }, { sleep: 400 }, { snapshot: 'typed' },
    // ⌥-click on the c of "charlie" (row 1, cell 12) from the end (row 2, cell 24): up once, left 12, sent at once
    { key: UP + LEFT.repeat(12) }, { sleep: 300 }, { snapshot: 'clicked' },
    { type: 'Z' }, { sleep: 300 }, { snapshot: 'z' },
    { key: '\x1a' }, { sleep: 300 }, { snapshot: 'undone' }, // ctrl+z
    { key: DOWN }, { sleep: 200 }, { type: 'Q' }, { sleep: 300 }, { snapshot: 'down' }, // one ↓: a row down, not history
    { key: '\x01' }, { sleep: 100 }, { key: '\x01' }, { sleep: 600 }, { snapshot: 'all' }, // ctrl+a twice (sent together, the two would come in as one piece of text)
    { type: 'new words' }, { sleep: 300 }, { snapshot: 'replaced' }, // typing replaces it
    { key: '\x1ba' }, { sleep: 600 }, { snapshot: 'optA' }, // ⌥A (Terminal's option as meta: esc, then the letter)
    { key: 'backspace' }, { sleep: 300 }, { snapshot: 'cleared' },
    { type: '!ls -la' }, { sleep: 300 }, { key: '\x1ba' }, { sleep: 200 }, { key: 'backspace' }, { sleep: 300 }, { snapshot: 'shell' },
    ...quitTyped,
  ] });
  await fake.close();

  const typed = where(r.terms.typed);
  expect(typed.lines[typed.y - 1]).toContain('> alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima');
  expect(typed.lines[typed.y]).toMatch(/^│ {3}mike november oscar papa/); // the second row lines up under the text
  expect(typed.x).toBe(typed.lines[typed.y].indexOf('mike') + 'mike november oscar papa'.length); // right after "papa"

  const clicked = where(r.terms.clicked);
  expect(clicked.y).toBe(typed.y - 1);
  expect(clicked.x).toBe(clicked.lines[clicked.y].indexOf('charlie'));

  expect(r.snapshots.z).toContain('bravo Zcharlie');
  expect(r.snapshots.undone).not.toContain('Zcharlie');
  expect(r.snapshots.undone).toContain('bravo charlie');
  // from cell 12 of the first row to cell 12 of the second: the r of "november"
  expect(r.snapshots.down).toContain('novembeQr');
  expect(r.snapshots.down).toContain('bravo charlie'); // history did not replace the prompt
  // ctrl+a twice selected all of it (every letter on the selection's colour), and it was not copied: ⌘V would paste over it
  const lit = (term) => { const b = term.buffer.active; let t = ''; for (let y = 0; y < b.length; y++) { const line = b.getLine(y); for (let x = 0; line && x < 80; x++) { const c = line.getCell(x); if (c?.isBgPalette() && c.getBgColor() === 24) t += c.getChars() || ' '; } } return t; };
  expect(lit(r.terms.all)).toBe(P.replace('november', 'novembeQr'));
  expect(r.snapshots.replaced).toContain('> new words');
  expect(r.snapshots.replaced).not.toContain('alpha');
  expect(lit(r.terms.optA)).toBe('new words'); // ⌥A
  expect(r.snapshots.cleared).not.toContain('new words');
  expect(r.snapshots.cleared).toContain('? for shortcuts'); // the prompt is empty again
  expect(r.snapshots.shell).toContain('! shell mode'); // the command went, the ! stayed
  expect(r.snapshots.shell).not.toContain('ls -la');
  expect(existsSync(clip)).toBe(false);
  expect(r.text).not.toContain('copied');
  // on the way out the cursor leaves the box: the goodbye line goes under it, not into it
  expect(r.text).toMatch(/^  Saved\. Continue this conversation/m);
}, T);
