// Captures the new screens with the real app and the real model (155×43, or
// COLS/ROWS from the environment):
// the start-up (restoring the saved warm-up), the "/" menu, the /model picker
// and a first reply. Saves scripts/capture-ui.json for the report.
//   BONSAI_BIN=~/.local/bin/bonsai [COLS=80 ROWS=24] node scripts/capture-ui.mjs [--out file.json]
// Each screen is also checked: the box at the bottom, the picker and the menu
// fully visible.
import { cpSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInPty } from '../test/pty.mjs';
import { termToHtml, visibleRange } from '../test/term-html.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = mkdtempSync(join(tmpdir(), 'bonsai-capture-ui-'));
const cwd = join(base, 'demo-project');
cpSync(join(root, 'demo-project'), cwd, { recursive: true });
// A private home that borrows the real runtime, model and saved warm-ups.
const home = join(base, 'home');
mkdirSync(home);
for (const d of ['bin', 'models', 'slots']) { mkdirSync(join(homedir(), '.bonsai-code', d), { recursive: true }); symlinkSync(join(homedir(), '.bonsai-code', d), join(home, d)); }
const cols = Number(process.env.COLS ?? 155);
const rows = Number(process.env.ROWS ?? 43);
const t0 = Date.now();
const r = await runInPty({
  cwd, cols, rows, env: { BONSAI_HOME: home }, timeoutMs: 300_000, bin: process.env.BONSAI_BIN,
  steps: [
    { wait: 'Starting', ms: 60_000 }, { sleep: 1200 }, { snapshot: 'starting' },
    { waitGone: 'Starting Bonsai', ms: 180_000 }, { sleep: 800 },
    { type: '/' }, { wait: 'Pick the model and how much it thinks' }, { sleep: 400 }, { snapshot: 'slash' },
    { type: 'model' }, { key: 'enter' }, { wait: 'Pick the model and how much it thinks first' }, { key: 'right' }, { sleep: 500 }, { snapshot: 'model' },
    { key: 'esc' }, { sleep: 400 },
    { type: 'hello' }, { key: 'enter' }, { wait: 'esc to stop', ms: 30_000 }, { waitGone: 'esc to stop', ms: 180_000 }, { sleep: 1500 }, { snapshot: 'hello' },
    { key: 'ctrlC' }, { sleep: 300 }, { key: 'ctrlC' },
  ],
});
const secs = Math.round((Date.now() - t0) / 1000);
const screens = {};
for (const [name, term] of Object.entries(r.terms)) screens[name] = termToHtml(term, visibleRange(term, rows));
// Checks on what is on screen at each moment.
const lines = (name) => { const l = (r.snapshots[name] ?? '').split('\n'); while (l.length < rows) l.push(''); return l; };
const lastIdx = (l, re) => { for (let i = l.length - 1; i >= 0; i--) if (re.test(l[i])) return i; return -1; };
const checks = [];
const check = (name, what, ok) => checks.push({ moment: name, what, ok: !!ok });
for (const name of ['starting', 'hello']) { const l = lines(name); check(name, 'the prompt box is on the last lines', lastIdx(l, /╰─/) >= rows - 4); }
{ const l = lines('slash'); const menuRows = l.filter((x) => /^\s{2}\/[a-z]+\s{2,}\S/.test(x)).length; check('slash', `the menu shows ${Math.min(10, rows - 8)}+ commands (${menuRows})`, menuRows >= Math.min(10, rows - 8)); check('slash', 'the box stays in view with the menu open', l.some((x) => x.includes('> /'))); }
{ const l = lines('model'); check('model', 'the picker is complete (title to keys)', l.some((x) => x.includes('Pick the model and how much it thinks first')) && l.some((x) => x.includes('enter to save'))); check('model', 'the picker\'s bottom edge is on screen', lastIdx(l, /╰─/) > lastIdx(l, /enter to save/)); }
// "hello" must get a written reply and nothing else: a tool line (⏺ Read(…))
// or a permission box is not a reply (a "hello" once read the project and
// asked to run the tests, and still got a ✓ here).
{
  const l = lines('hello');
  const toolLine = /^\s*[●⏺]\s+(?:Read|List|Search|Update|Write|Bash|Update Todos|Rename|Plan|Outline)(?:\(|\s*$)/;
  check('hello', 'a written reply arrived', l.some((x) => /^\s*[●⏺]\s+\S/.test(x) && !toolLine.test(x)));
  check('hello', 'no tools were used for a greeting', !l.some((x) => toolLine.test(x)));
  check('hello', 'no permission question', !l.some((x) => x.includes('Do you want to proceed?')));
}
const out = { capturedAt: new Date().toISOString(), cols, rows, secs, screens, checks };
const file = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : join(root, 'scripts', 'capture-ui.json');
writeFileSync(file, JSON.stringify(out));
console.log(`${cols}×${rows}: captured ${Object.keys(screens).join(', ')} in ${secs}s; checks ${checks.filter((c) => c.ok).length}/${checks.length}${checks.some((c) => !c.ok) ? ` — failed: ${checks.filter((c) => !c.ok).map((c) => `${c.moment}: ${c.what}`).join('; ')}` : ''}`);
