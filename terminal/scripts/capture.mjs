// Runs the real app with the real model in a real terminal (155×43, your
// Terminal's size), answers its questions, and saves the screen at key
// moments as HTML with the exact colours. Used for the report page.
//   node terminal/scripts/capture.mjs classic|live
import { cpSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInPty } from '../test/pty.mjs';
import { termToHtml, visibleRange } from '../test/term-html.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const layout = process.argv[2] === 'live' ? 'live' : 'classic';
const base = mkdtempSync(join(tmpdir(), 'bonsai-capture-'));
const cwd = join(base, 'demo-project');
cpSync(join(root, 'demo-project'), cwd, { recursive: true });
// A private home that borrows the real runtime and model (no settings or history touched).
const home = join(base, 'home');
mkdirSync(home);
for (const d of ['bin', 'models']) symlinkSync(join(homedir(), '.bonsai-code', d), join(home, d));

const task = 'add a --json flag to export.mjs that prints the rows as JSON, and add a test for it';
const long = 400_000;
const t0 = Date.now();
const r = await runInPty({
  cwd, cols: 155, rows: 43, env: { BONSAI_HOME: home }, timeoutMs: 900_000,
  bin: process.env.BONSAI_BIN, args: ['--layout', layout, ...(process.env.CAPTURE_URL ? ['--url', process.env.CAPTURE_URL] : [])],
  steps: [
    { wait: '? for shortcuts', ms: 120_000 }, { sleep: 1500 },
    { type: task }, { key: 'enter' },
    { wait: 'esc to stop', ms: long }, { sleep: 3500 }, { snapshot: 'working' },
    { autoYes: true, snapshotFirstAsk: true, ms: 800_000 }, { sleep: 1000 }, { snapshot: 'done' },
    { key: 'ctrlC' }, { sleep: 300 }, { key: 'ctrlC' },
  ],
});
console.log(`captured in ${Math.round((Date.now() - t0) / 1000)}s`);
const out = {};
for (const [name, term] of Object.entries(r.terms)) {
  const range = visibleRange(term, 43);
  out[name] = termToHtml(term, range);
}
const file = join(root, 'scripts', `capture-${layout}${process.env.CAPTURE_URL ? '-fake' : ''}.json`);
writeFileSync(file, JSON.stringify({ layout, task, capturedAt: new Date().toISOString(), secs: Math.round((Date.now() - t0) / 1000), screens: out, changed: readFileSync(join(cwd, 'export.mjs'), 'utf8').includes('--json') }, null, 1));
console.log(`saved ${file}`);
