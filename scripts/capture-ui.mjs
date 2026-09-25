// Captures the new screens with the real app and the real model, at 155×43:
// the start-up (restoring the saved warm-up), the "/" menu, the /model picker
// and a first reply. Saves scripts/capture-ui.json for the report.
//   BONSAI_BIN=~/.local/bin/bonsai node scripts/capture-ui.mjs
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
const t0 = Date.now();
const r = await runInPty({
  cwd, cols: 155, rows: 43, env: { BONSAI_HOME: home }, timeoutMs: 300_000, bin: process.env.BONSAI_BIN,
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
for (const [name, term] of Object.entries(r.terms)) screens[name] = termToHtml(term, visibleRange(term, 43));
writeFileSync(join(root, 'scripts', 'capture-ui.json'), JSON.stringify({ capturedAt: new Date().toISOString(), secs, screens }));
console.log(`captured ${Object.keys(screens).join(', ')} in ${secs}s`);
