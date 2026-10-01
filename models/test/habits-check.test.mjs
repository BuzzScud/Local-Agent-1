// The Tool habits check's habits, verdict and results page (models/evals/tools/habits-check.mjs,
// habits-page.mjs). The check itself needs the real model (▶ Run a test → Tool habits check); it
// runs end to end on a stand-in in terminal/test/arena-checks.test.mjs.
import { test, expect } from 'bun:test';
import { habitOf, linesOf, verdictOf, TASKS, CHECKS, OLD_TOOL_USE } from '../evals/tools/habits-check.mjs';
import { habitsPage } from '../evals/tools/habits-page.mjs';

const err = (...lines) => lines.join('\n');

test('the habits come from the model’s own lines: not what the app read first, not the app’s own check', () => {
  expect(CHECKS).toBe(TASKS.length * 2);
  expect(OLD_TOOL_USE.split('\n')).toHaveLength(3);
  expect(linesOf(err('⏺ List(the project map) [app]', '⏺ Read(src/a.mjs)')).map((l) => l.own)).toEqual([false, true]);
  // just the test file: a test command ran, and the whole suite did not
  expect(habitOf('testfile', err('⏺ Write(test/x.test.mjs)', '⏺ Bash(node --test test/x.test.mjs)'))).toBe(true);
  expect(habitOf('testfile', err('⏺ Write(test/x.test.mjs)', '⏺ Bash(npm test)'), { suiteRan: true })).toBe(false);
  expect(habitOf('testfile', err('⏺ Write(test/x.test.mjs)', '· Checking the change: npm test', '⏺ Bash(npm test)'))).toBe(false); // the app ran it, not the model
  // search first: its first Search or Read
  expect(habitOf('search', err('⏺ Read(src/config.mjs) [app]', '⏺ Search(FREE_SHIPPING)', '⏺ Read(src/config.mjs)'))).toBe(true);
  expect(habitOf('search', err('⏺ Read(src/shipping.mjs)', '⏺ Search(FREE)'))).toBe(false);
  expect(habitOf('search', err('· some note'))).toBe(false); // no look of its own
  // proved before done: after its last change, a command or a read of its own
  expect(habitOf('done', err('⏺ Update(src/price.mjs)', '⏺ Bash(node -e "…")'))).toBe(true);
  expect(habitOf('done', err('⏺ Update(src/price.mjs)', '⏺ Read(src/price.mjs)'))).toBe(true);
  expect(habitOf('done', err('⏺ Update(src/price.mjs)', '· Checking the change: npm test', '⏺ Bash(npm test)'))).toBe(false);
  expect(habitOf('done', err('⏺ Read(src/price.mjs)'))).toBe(false); // no change at all
  // the fitting skill
  expect(habitOf('skill', err('⏺ Read(SKILLS/write-a-test)', '⏺ Write(test/tax.test.mjs)'))).toBe(true);
  expect(habitOf('skill', err('⏺ Write(test/tax.test.mjs)'))).toBe(false);
});

test('the rule: the new lines show more of the habits, and at least as many tasks are right', () => {
  const row = (task, arm, ok, habit, secs = 30) => ({ id: `${task}-${arm}`, task, arm, name: `${task} · ${arm}`, ok, habit, detail: 'd', secs });
  const rows = [row('testfile', 'old', true, false), row('testfile', 'new', true, true), row('search', 'old', true, true), row('search', 'new', true, true),
    row('done', 'old', true, false), row('done', 'new', true, true), row('skill', 'old', false, false), row('skill', 'new', true, false)];
  const v = verdictOf(rows);
  expect(v.old).toMatchObject({ passed: 3, habits: 1, n: 4 });
  expect(v.new).toMatchObject({ passed: 4, habits: 3, n: 4 });
  expect(v.holds).toBe(true);
  expect(verdictOf(rows.map((r) => (r.arm === 'new' ? { ...r, habit: r.task === 'search' } : r))).holds).toBe(false); // as many habits, not more
  expect(verdictOf(rows.map((r) => (r.arm === 'new' && r.task !== 'skill' ? { ...r, ok: false } : r))).holds).toBe(false); // fewer right
  // the page
  const summary = { name: 'Qwen3.5 9B', of: 8, checks: 8, passed: 7, pass: true, stopped: false, load: 2, code: 'abc1234', sub: 'Sep 30 21:40 · abc1234', verdict: v };
  const html = habitsPage({ summary, rows: rows.map((r) => (r.id === 'skill-new' ? { ...r, detail: 'wrote <tax.test.mjs>' } : r)) });
  expect(html).toContain('<title>Tool habits check · Qwen3.5 9B</title>');
  expect(html).toContain('Yes: with TOOLS.md now Qwen3.5 9B showed 3 of the 4 habits (with the lines from before: 1), and got 4 of 4 tasks right (before: 3), inside the rule. Not shown with the new lines: opened the fitting skill.');
  expect(html).toContain('Habits shown, before → now · higher is better');
  expect(html).toContain('&lt;tax.test.mjs&gt;');
});
