// The results page of the rules file check (rules-file-check.mjs): one self-contained HTML file
// for the pages folder, opened from the run's line in the hub's Tests tab, drawn by check-page.mjs
// (Result · The checks · How it was measured).
//   rulesFilePage({ summary, rows, prev, raw }) → html
import { buildCheckPage, sec } from './check-page.mjs';

const n = (x) => Number(x ?? 0).toLocaleString('en-US');

export function rulesFilePage({ summary: s, rows, prev = null, raw = [] }) {
  const q = rows.filter((r) => r.kind === 'question').length / 2;
  const t = s.task ?? {};
  const st = s.start ?? {};
  const why = [];
  if (s.right.new < s.right.old) why.push(`fewer right answers with the new file (${s.right.new} against ${s.right.old})`);
  if (st.new && st.old && !(st.new.secs < st.old.secs)) why.push('its start was not faster');
  if (t.new && !t.new.ok) why.push('the task failed with the new file');
  else if (t.new && t.old?.ok && t.new.secs > t.old.secs) why.push(`the task took longer with the new file (${sec(t.new.secs)} against ${sec(t.old.secs)})`);
  const verdict = s.pass
    ? `Yes: the short AGENTS.md did at least as well. ${s.right.new} of ${q} right answers (the old file: ${s.right.old}), a start ${sec(st.old.secs - st.new.secs)} faster, and the task passed in ${sec(t.new.secs)} (the old file: ${sec(t.old.secs)}).`
    : `No: ${why.join('; ') || 'the run did not finish'}.`;
  const tests = (k) => (t[k]?.tests?.length ? t[k].tests.join('; ') : 'none');
  return buildCheckPage({
    title: `Rules file old vs new · ${s.name}`, summary: { ...s, of: rows.length, checks: rows.length, passed: rows.filter((r) => r.ok).length, sub: s.sub ?? `${s.code} · ${s.ctx / 1024}k · thinking off` },
    rows, prev, raw, first: false, verdict,
    passRule: 'as many right answers, a faster start, the task passing in no more time',
    cards: [
      { k: 'Right answers, new file', v: `${s.right.new} of ${q}`, sub: `old file: ${s.right.old} of ${q}${prev ? ` · run before: ${prev.s.right?.new ?? '—'}` : ''}`, dir: 'higher is better' },
      { k: 'Reading the instructions at start, new file', v: sec(st.new?.secs), sub: `old file: ${sec(st.old?.secs)} · ${n(st.new?.tokens)} against ${n(st.old?.tokens)} tokens`, dir: 'lower is faster' },
      { k: 'The task, new file', v: `${t.new?.ok ? '✓' : '✗'} ${sec(t.new?.secs)}`, sub: `old file: ${t.old?.ok ? '✓' : '✗'} ${sec(t.old?.secs)}`, dir: 'lower is faster' },
    ],
    how: [
      `The two files: the old AGENTS.md (${n(s.chars?.old)} characters, from git at ${s.oldFrom}, before AGENTS-DETAILS.md came in) and this code's (${n(s.chars?.new)} characters, beside its AGENTS-DETAILS.md and CLAUDE.md). The model: ${s.name}, ${s.ctx / 1024}k, thinking off, no memory, no code search.`,
      `The questions: ${q} about working in this repo, each asked in a fresh conversation in a folder holding only that file (and, for the new one, its details file), so the answer comes from the rules and nothing else. Every answer is in both files. A right answer holds the words the check names (for example <code>bun run docs</code>, <code>AGENTIC_HOME</code>, <code>older versions</code>), never a model's judgement.`,
      `The start: the instructions the app builds for that folder (without the tool list), read by the engine with nothing saved, the best of two tries. In the app the part before the rules is restored from a saved reading, so the difference between the two files is what a session start gains.`,
      `The task: “add a test that a 128k window gets 36,000 characters of rules room”, on a copy of the repo at this code with that file, up to 10 minutes. It passes when the test is there and <code>bun test terminal/test/room.test.mjs</code> passes with one test more (run by the check after the clock stops). Tests it ran with the new file: ${tests('new')}. With the old: ${tests('old')}.`,
      'The rule, written before the first run: the new file gets at least as many right answers as the old, its start is faster, and the task passes with it in no more time than with the old. Nothing in ~/.agentic-coder was written but this run’s line in the test record.',
    ],
  });
}
