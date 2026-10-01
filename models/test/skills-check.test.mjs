// The Skills check's verdict and results page (models/evals/tools/skills-check.mjs, skills-page.mjs).
// The check itself needs the real model (▶ Run a test → Skills check); the skills have their
// own tests (terminal/test/prompt-files.test.mjs).
import { test, expect } from 'bun:test';
import { verdictOf, oneFileOf, TASKS, CHECKS } from '../evals/tools/skills-check.mjs';
import { skillsPage } from '../evals/tools/skills-page.mjs';

const row = (task, arm, ok, secs, extra = {}) => ({ id: `${task}-${arm}`, task, arm, name: `${task} · ${arm}`, ok, detail: 'd', secs, oneFile: false, ...extra });

test('the rule: with the skill at least as many pass and at most 25% more time; the seventh run says whether the list led to it', () => {
  expect(CHECKS).toBe(TASKS.length * 2 + 1);
  const rows = [row('a', 'none', true, 40), row('a', 'skill', true, 45, { oneFile: true }), row('b', 'none', false, 60), row('b', 'skill', true, 50), row('c', 'none', true, 30), row('c', 'skill', true, 40), row('list', 'list', true, 30, { opened: true })];
  const v = verdictOf(rows);
  expect(v.off).toMatchObject({ passed: 2, secs: 130, n: 3 });
  expect(v.on).toMatchObject({ passed: 3, secs: 135, one: 1, n: 3 });
  expect(v.holds).toBe(true);
  expect(v.opened).toBe(true);
  expect(verdictOf(rows.map((r) => (r.arm === 'skill' ? { ...r, secs: r.secs * 1.3 } : r))).holds).toBe(false); // +35%: too slow
  expect(verdictOf(rows.map((r) => (r.id === 'a-skill' ? { ...r, ok: false } : r))).holds).toBe(true); // 2 and 2: as many
  expect(verdictOf(rows.map((r) => (r.id === 'c-skill' || r.id === 'a-skill' ? { ...r, ok: false } : r))).holds).toBe(false); // fewer
  expect(verdictOf(rows.slice(0, 3)).holds).toBe(false); // stopped part way
});

test('the Skills check’s results page: the verdict with both sides, each card with its direction, a model’s words escaped', () => {
  const rows = [row('a', 'none', true, 40), row('a', 'skill', true, 30, { detail: 'ran <node --test test/x.test.mjs>' })];
  const summary = { name: 'Qwen3.5 9B', of: 7, checks: 7, passed: 6, pass: true, stopped: false, load: 2, code: 'abc1234', sub: 'Sep 30 19:00 · abc1234',
    verdict: { off: { passed: 2, secs: 130, one: 0, n: 3 }, on: { passed: 3, secs: 120, one: 2, n: 3 }, slower: -0.077, holds: true, opened: false } };
  const html = skillsPage({ summary, rows });
  expect(html).toContain('<title>Skills check · Qwen3.5 9B</title>');
  expect(html).toContain('Yes: with the skill Qwen3.5 9B passed 3 of 3 tasks (without it: 2) and took 8% less time in all, inside the rule.');
  expect(html).toContain('did not open it from the skills list');
  expect(html).toContain('Time, all three tasks · lower is faster');
  expect(html).toContain('Ran just the new test file · higher is better');
  expect(html).toContain('&lt;node --test test/x.test.mjs&gt;');
});

test('ran just the new test file: a test command and no mark from the whole suite', () => {
  expect(oneFileOf(['Bash(npm test -- test/cart.test.mjs)'], false)).toBe(true);
  expect(oneFileOf(['Bash(node --test test/cart.test.mjs)'], false)).toBe(true);
  expect(oneFileOf(['Bash(npm test)'], true)).toBe(false);
  expect(oneFileOf(['Bash(ls)'], false)).toBe(false); // no test ran at all
});
