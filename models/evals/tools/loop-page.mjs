// The results page of the Loop controls check (loop-check.mjs): one self-contained HTML file for the
// DOCS folder, opened from the run's line in the hub's Tests tab, drawn by check-page.mjs
// (Result · The checks · How it was measured).
//   loopPage({ summary, rows, prev, raw }) → html
import { buildCheckPage, sec } from './check-page.mjs';

export function loopPage({ summary: s, rows, prev = null, raw = [] }) {
  return buildCheckPage({
    title: 'Loop controls check · a note mid-run, undo, start over, steps', summary: s, rows, prev, raw,
    yes: 'A note reached the model at its next step, the run kept a copy that undo put back, start over stopped the run and began again with the note, and a run allowed 3 steps stopped there.',
    passRule: 'all 5 checks',
    cards: [
      { k: 'The note was read with', v: s.heardAfter ?? 'no step', sub: prev ? `before: ${prev.s.heardAfter ?? 'no step'}` : 'before 4 Oct 2026: only when the run had finished its answer', dir: 'a step is better' },
      { k: 'The fixing run took', v: sec(s.runSecs), sub: prev ? `before: ${sec(prev.s.runSecs)}` : 'no run before this one', dir: 'lower is faster' },
      { k: 'Tests failing, before → after the run', v: `${s.failsBefore ?? '—'} → ${s.failsAfter ?? '—'}`, sub: 'the model’s own work: shown, not judged', dir: 'lower after is better' },
    ],
    how: [
      'The real model on this Mac (or the server given with <code>--url</code>), the app’s own window logic (<code>Loops</code> in terminal/src/app/loops.mjs) and its runs as a window starts them: <code>coding -p --loop-events</code> in Accept edits, in a throwaway home (no memory, nothing of yours read or written).',
      'The project: a CSV export with three bugs (no rows crashes, a comma or a quote is not quoted, a column only some rows have gets no header) and five tests, three of them failing.',
      '1 · A fixing loop (<code>/loop debug</code>). After the run’s first step, a note is typed to it, as on the board. It passes when the run’s own lines say the note was read with a step’s result (the “heard” line) before the run ended.',
      '2 · It passes when the run’s last word carries its copy for undo (a rewind point) and names export.mjs among the files it changed. Whether the tests pass after it is the model’s work: shown on the Result tab, not judged.',
      '3 · Undo (u on the board, <code>/loop 1 undo</code>): it passes when export.mjs is again exactly as it was before the run and as many tests fail as before.',
      '4 · Start over (x on the board): a second fixing loop; once its run has taken two steps, start over with a note. It passes when that run stops, its changes are put back (export.mjs as before it), and a new run starts whose message carries the note.',
      '5 · Its own steps: a fixing loop allowed 3 steps a run. It passes when the run stops with “Stopped after 3 steps”. The plan question Accept edits answers by itself is the app’s, not a step of the model’s.',
      `The Mac’s load at the end: ${s.load}. Code: ${s.code}.`,
    ],
  });
}
