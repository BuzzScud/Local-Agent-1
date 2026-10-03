// The results page of the Plain questions check (questions-check.mjs): one self-contained HTML
// file for the DOCS folder, opened from the run's line in the hub's Tests tab, drawn by
// check-page.mjs (Result · The checks · How it was measured).
//   questionsPage({ summary, rows, prev, raw }) → html
import { buildCheckPage, sec } from './check-page.mjs';

export function questionsPage({ summary: s, rows, prev = null, raw = [] }) {
  const of = (a, b) => `${a} of ${b}`;
  return buildCheckPage({
    title: 'Plain questions check · the question it asks first', summary: s, rows, prev, raw,
    passRule: `at least ${s.minPass} of ${s.of}`,
    verdict: s.pass ? `Yes: ${of(s.passed, s.of)} questions came in plain words, each choice with a line saying what it means for you.` : `No: ${of(s.passed, s.of)} questions came in plain words (the bar is ${s.minPass}).`,
    cards: [
      { k: 'Choices with a line saying what they mean', v: of(s.withAbout, s.choices), sub: prev ? `before: ${of(prev.s.withAbout, prev.s.choices)}` : 'on 3 Oct 2026, before the change: 0 of 15', dir: 'higher is better' },
      { k: 'Choices free of file or code names', v: of(s.plain, s.choices), sub: prev ? `before: ${of(prev.s.plain, prev.s.choices)}` : 'on 3 Oct 2026, before the change: 0 of 15', dir: 'higher is better' },
      { k: 'Time to write the question', v: sec(s.medianSecs), sub: prev ? `before: ${sec(prev.s.medianSecs)}` : 'on 3 Oct 2026 on the service’s Qwen3.6: 1.9 s before the change, 5.2 s after', dir: 'lower is faster' },
    ],
    how: [
      `Eight short, vague requests (“shipping”, “make checkout better”, “add a discount”…) in a small shop project made for the check (a cart, shipping, tax and money files, and tests). Each goes to the app’s own first question, <code>questionFor()</code> in terminal/src/flows/clarify.mjs, the one a short request gets before any work, on ${s.name}.`,
      'A request passes when its question comes with 2 or 3 choices, every choice has its line (what it means for you, with an example), and no choice or line names a file (export.mjs, config.json…), a path or a name written as code.',
      `Pass: at least ${s.minPass} of ${s.of}. Before is the finished run before this one on the same model. Seconds are the whole call, as the app waits for it; they grow when the Mac is busy (its load at the end: ${s.load}).`,
      `Code: ${s.code}. Nothing in your memory or settings is read or written but this run’s line in the test record.`,
    ],
  });
}
