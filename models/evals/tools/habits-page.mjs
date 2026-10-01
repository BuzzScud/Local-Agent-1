// The results page of the Tool habits check (habits-check.mjs), drawn by check-page.mjs
// (Result · The checks · How it was measured).
//   habitsPage({ summary, rows, prev, raw }) → html
import { buildCheckPage, sec } from './check-page.mjs';
import { TASKS } from './habits-check.mjs';

export function habitsPage({ summary: s, rows, prev = null, raw = [] }) {
  const v = s.verdict;
  const was = prev?.s?.verdict;
  const shown = (arm) => TASKS.filter((t) => rows.some((r) => r.task === t.id && r.arm === arm && r.habit)).map((t) => t.habit);
  const now = shown('new');
  const missing = TASKS.filter((t) => !now.includes(t.habit)).map((t) => t.habit);
  const said = `${v.holds ? 'Yes' : 'No'}: with TOOLS.md now ${s.name} showed ${v.new.habits} of the ${v.new.n} habits (with the lines from before: ${v.old.habits}), and got ${v.new.passed} of ${v.new.n} tasks right (before: ${v.old.passed})${v.holds ? ', inside the rule.' : '; the rule asks for more habits and at least as many right.'}`;
  return buildCheckPage({
    title: `Tool habits check · ${s.name}`, summary: s, rows, prev, raw, first: false,
    passRule: 'the new lines show more of the four habits, and at least as many tasks pass',
    verdict: `${said}${missing.length ? ` Not shown with the new lines: ${missing.join('; ')}.` : ' Every habit showed with the new lines.'}`,
    cards: [
      { k: 'Habits shown, before → now', v: `${v.old.habits} → ${v.new.habits} of ${v.new.n}`, sub: was ? `before: ${was.old.habits} → ${was.new.habits}` : 'one task for each new line', dir: 'higher is better' },
      { k: 'Tasks right, before → now', v: `${v.old.passed} → ${v.new.passed} of ${v.new.n}`, sub: 'the work itself, checked by the check', dir: 'higher is better' },
      { k: 'Time, all four tasks', v: `${sec(v.old.secs)} → ${sec(v.new.secs)}`, sub: 'shown, not judged: proving and searching take steps', dir: 'lower is faster' },
    ],
    how: [
      `The model: ${s.name} at Effort Low, through <b>coding -p --yes --no-flows</b> (no memory, Look first off), in a throwaway home whose engine and model files are links to the ones in ~/.agentic-coder. The fix and change shortcuts are off, so every task goes step by step and the Tool use lines are what guide it. The search task runs with Who decides: Model, so the app reads nothing for it first and its first look is its own. What the app reads for a task before the first step is not counted as the model’s. A first request loads the model and is not counted.`,
      'Before: TOOLS.md with the three Tool use lines from before 30 Sep evening. Now: TOOLS.md as shipped, with four more (search before reading, only the test file that covers a change, done only once a tool shows it, a fitting skill opened from the list). The example skill “Write a test” is on in both.',
      'The habits, from the lines coding -p prints: ran just the test file (a test command ran and the suite’s second file left no mark); searched before reading (its first Search or Read was a Search); proved it before saying done (after its last change it ran a command or read the file back itself, not the app’s own check); opened the fitting skill (Read SKILLS/write-a-test).',
      'The work: a new test that uses withTax and a suite that passes, with cart.mjs unchanged; the answer names 50 and config.mjs; applyDiscount never negative (10 at 150% is at least 0, 100 at 10% is 90) and the suite passes; test/tax.test.mjs made, using withTax, and the suite passes.',
      'The rule, written before the first run: the new lines show more of the four habits than the old ones, and at least as many tasks are right. One run of each task: a first look, not a proof.',
      `Nothing in ~/.agentic-coder was written but this run’s line in the test record. The Mac’s load at the end: ${s.load}. Code: ${s.code}.`,
    ],
  });
}
