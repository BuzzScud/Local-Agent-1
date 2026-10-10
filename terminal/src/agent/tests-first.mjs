// The tests before the first step (agent-read.mjs runTestsFirst) stop after a minute. A folder whose run
// was cut off is remembered, and its next messages skip that run for a week (9 Oct 2026: in Agentic
// Coder's own repo, whose tests take about 4 minutes, every fix-type message and every loop run spent
// its first minute, and up to 340 MB, on a run that always ended "stopped after 60 s"; the model then
// ran the tests itself). A different test command, or a week gone by, tries the run again.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { HOME } from '../../../models/index.mjs';

export const SLOW_DAYS = 7;
const DAY = 86_400_000;
export const slowFile = () => join(HOME, 'tests-first.json');
const readAll = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')) ?? {}; } catch { return {}; } };
const fresh = (e, now) => now - Date.parse(e?.at ?? '') < SLOW_DAYS * DAY;

// The note for this folder and command when its run was cut off within the week, else null.
export function slowRun(cwd, cmd, { file = slowFile(), now = Date.now() } = {}) {
  const e = readAll(file)[cwd];
  return e && e.cmd === cmd && fresh(e, now) ? e : null;
}

// A run that was cut off: noted for this folder (notes older than a week go).
export function noteSlow(cwd, cmd, secs, { file = slowFile(), now = Date.now() } = {}) {
  const all = Object.fromEntries(Object.entries(readAll(file)).filter(([, e]) => fresh(e, now)));
  all[cwd] = { cmd, at: new Date(now).toISOString(), secs: Math.round(Number(secs) || 0) };
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(all, null, 1)}\n`);
    renameSync(tmp, file);
  } catch { /* not noted: the next message runs them again */ }
}
