// End-to-end, the real app in a pseudo-terminal (see app.test.mjs). Here:
// text copied off the app's own screen, the way Terminal copies it (the rows
// as drawn, padding and all), and pasted back with cmd+v (a bracketed paste)
// reaches the model as it was written. ctrl+z gives the paste as copied.
import { test, expect } from 'bun:test';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quitTyped } from './app-setup.mjs';

const PASTE = (t) => `\x1b[200~${t}\x1b[201~`;
const MESSAGE = 'Make one HTML file that displays a social feed post. Include an author avatar and name, a timestamp, two or three lines of post text, a media placeholder block, and a row of like, comment, and share counts with tappable icons. Style it with CSS in the same file.\nNo frameworks.';
const rowsOf = (term) => { const b = term.buffer.active; const out = []; for (let i = 0; i < b.length; i++) out.push(b.getLine(i)?.translateToString(false) ?? ''); return out; };
// Your messages in the last request, which carries the whole conversation (the app adds notes after each).
const sentTexts = (fake) => (fake.requests.at(-1)?.messages ?? []).filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : (m.content ?? []).map((c) => c.text ?? '').join(''))).filter((t) => t.startsWith('Make one'));

test('your message and the prompt box, copied off the screen and pasted back, reach the model as written; the screen stays still while nothing moves', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ text: 'First answer.' }, { text: 'Second answer.' }, { text: 'Third answer.' }]);
  const copies = {};
  const marks = {};
  // the Mac's memory read every 200 ms: its figure moves within a few readings
  const r = await runInPty({ cwd, cols: 100, rows: 40, env: { ...env, AGENTIC_MAC_EVERY: '200' }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { sleep: 400 },
    { key: PASTE(MESSAGE) }, { sleep: 300 }, { key: '\r' }, { wait: 'First answer.' }, { sleep: 800 },
    // Copy your message off the conversation: from its first word to the end of its last row.
    { fn: async (t) => {
      const rows = rowsOf(await t.screen());
      const at = rows.findIndex((l) => l.startsWith(' › Make one'));
      let end = at; while (rows[end + 1]?.trim()) end++;
      copies.strip = [rows[at].slice(3), ...rows.slice(at + 1, end + 1)].join('\n');
      t.write(PASTE(copies.strip));
    } },
    { sleep: 400 }, { snapshot: 'clean' },
    { key: '\x1a' }, { sleep: 300 }, { snapshot: 'asCopied' }, // ctrl+z: the paste as copied
    { key: '\x19' }, { sleep: 300 }, // ctrl+y: tidy again
    { key: '\r' }, { wait: 'Second answer.' }, { sleep: 800 },
    // Copy the prompt box: type the message again, copy its rows from the first word to the right edge.
    { key: PASTE(MESSAGE) }, { sleep: 400 },
    { fn: async (t) => {
      const rows = rowsOf(await t.screen());
      const at = rows.findIndex((l) => l.startsWith('│ > Make one'));
      let end = at; while (rows[end + 1]?.startsWith('│ ')) end++;
      copies.box = [rows[at].slice(4), ...rows.slice(at + 1, end + 1)].join('\n');
    } },
    { key: '\x03' }, { sleep: 300 }, // ctrl+c clears the prompt
    { fn: (t) => t.write(PASTE(copies.box)) }, { sleep: 400 },
    { key: '\r' }, { wait: 'Third answer.' }, { sleep: 1000 },
    // Nothing moves now: the window is not drawn again, though the Mac's memory is read 15 times.
    { fn: ({ raw }) => { marks.idle = raw().length; } }, { sleep: 3000 }, { fn: ({ raw }) => { marks.after = raw().length; } },
    ...quitTyped,
  ] });
  await fake.close();

  // What was copied looked like the screen: rows broken at the edge, the indent, the padding, the box's edges.
  expect(copies.strip.split('\n').length).toBeGreaterThan(2);
  expect(copies.strip).toMatch(/ {2}\n {3}\S/);
  expect(copies.box).toContain('│\n│   ');
  // The model got the message as written all three times: typed, and pasted back from each copy.
  const sent = sentTexts(fake).map((s) => s.slice(0, MESSAGE.length));
  expect(sent).toEqual([MESSAGE, MESSAGE, MESSAGE]);
  // In the box: the tidy paste is two rows at 100 columns, the paste as copied (ctrl+z) more, with the strip's indent.
  expect(r.snapshots.clean).toContain('> Make one HTML file');
  expect(r.snapshots.asCopied.split('\n').filter((l) => l.startsWith('│ ')).length).toBeGreaterThan(r.snapshots.clean.split('\n').filter((l) => l.startsWith('│ ')).length);
  // and the screen was not drawn again while idle
  expect(marks.after - marks.idle).toBe(0);
}, T);
