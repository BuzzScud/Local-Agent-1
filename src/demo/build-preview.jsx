// Renders all three designs at every half second of the recorded session with
// the real Ink components (256 colours, 155 columns = your Terminal window) and
// writes one self-contained page to the Desktop. Run: FORCE_COLOR=2 bun src/demo/build-preview.jsx
import React from 'react';
import { renderToString } from 'ink';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateAt, markers } from '../ui/state.mjs';
import { DESIGNS } from '../ui/designs.jsx';

if (process.env.FORCE_COLOR !== '2') throw new Error('run with FORCE_COLOR=2 (Apple Terminal = 256 colours)');
const here = dirname(fileURLToPath(import.meta.url));
const session = JSON.parse(readFileSync(join(here, 'session.json'), 'utf8'));
const COLS = 155;
const ROWS = 43;
const STEP = 0.5;
const end = Math.ceil((session.total + 3) / STEP) * STEP;

const frames = DESIGNS.map(({ View }) => {
  const out = [];
  for (let t = 0; t <= end + 1e-9; t += STEP) {
    out.push(renderToString(<View session={session} s={stateAt(session, t)} width={COLS} />, { columns: COLS }));
  }
  return out;
});

const payload = gzipSync(JSON.stringify(frames), { level: 9 }).toString('base64');
const meta = {
  cols: COLS, rows: ROWS, step: STEP, end, total: session.total, model: session.model, task: session.task,
  decodeTps: session.decodeTps, prefillTps: session.prefillTps, recordedAt: session.recordedAt,
  markers: markers(session), designs: DESIGNS.map(({ id, name, idea }) => ({ id, name, idea })),
  tests: session.steps.find((s) => s.tool === 'Bash')?.result,
};
const html = readFileSync(join(here, 'preview.template.html'), 'utf8')
  .replace('__META__', () => JSON.stringify(meta))
  .replace('__FRAMES__', () => payload);
const target = join(homedir(), 'Desktop', 'bonsai-terminal-3-designs.html');
writeFileSync(target, html);
console.log(`${frames[0].length} frames × ${frames.length} designs → ${target} (${(html.length / 1e6).toFixed(2)} MB)`);
