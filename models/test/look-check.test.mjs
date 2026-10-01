// The Look first check's verdict and results page (models/evals/tools/look-check.mjs, look-page.mjs).
// The check itself needs the real model (▶ Run a test → Look first check); it runs end to end on a
// stand-in in terminal/test/arena-checks.test.mjs.
import { test, expect } from 'bun:test';
import { verdictOf, rightAnswer, QUESTIONS, CHECKS, MAX_MORE_SECS } from '../evals/tools/look-check.mjs';
import { lookPage } from '../evals/tools/look-page.mjs';

const row = (q, arm, ok, secs, extra = {}) => ({ id: `${q}-${arm}`, question: q, arm, name: `${q} · ${arm}`, ok, detail: 'd', secs, looks: 1, backs: 0, ...extra });
const both = (q, offOk, onOk, offSecs, onSecs) => [row(q, 'off', offOk, offSecs), row(q, 'on', onOk, onSecs, { looks: 3, backs: 1 })];

test('a right answer has every fact asked for', () => {
  expect(CHECKS).toBe(QUESTIONS.length * 2);
  const q = (id) => QUESTIONS.find((x) => x.id === id);
  expect(rightAnswer(q('rate'), 'RATE is 0.0825, in src/config.mjs.')).toBe(true);
  expect(rightAnswer(q('rate'), 'It uses RATE (8.25%).')).toBe(false); // no file
  expect(rightAnswer(q('shipping'), 'Free from 50; otherwise 5.99.')).toBe(true);
  expect(rightAnswer(q('checkout'), 'total and shippingFor')).toBe(false); // withTax missing
  expect(rightAnswer(q('round'), 'roundCents rounds it to two decimal places')).toBe(true);
});

test('the rule: with Look first at least as many right, at most 60 s more a question on average', () => {
  const rows = [...both('rate', false, true, 20, 50), ...both('shipping', true, true, 20, 40), ...both('checkout', true, true, 20, 30), ...both('round', true, true, 20, 50)];
  const v = verdictOf(rows);
  expect(v.off).toMatchObject({ right: 3, secs: 80, n: 4 });
  expect(v.on).toMatchObject({ right: 4, secs: 170, looks: 12, backs: 4, n: 4 });
  expect(v.morePerQuestion).toBe(22.5);
  expect(v.holds).toBe(true);
  expect(verdictOf(rows.map((r) => (r.arm === 'on' ? { ...r, secs: r.secs + MAX_MORE_SECS + 1 } : r))).holds).toBe(false); // too slow
  expect(verdictOf(rows.map((r) => (r.arm === 'on' && r.question !== 'rate' ? { ...r, ok: false } : r))).holds).toBe(false); // fewer right
  expect(verdictOf(rows.slice(0, 5)).holds).toBe(false); // stopped part way
});

test('the Look first check’s results page: the verdict with both sides, each card with its direction, a model’s words escaped', () => {
  const summary = { name: 'Qwen3.5 9B', of: 8, checks: 8, passed: 7, pass: true, stopped: false, load: 2, code: 'abc1234', sub: 'Sep 30 21:30 · abc1234',
    verdict: { off: { right: 3, secs: 80, looks: 4, backs: 0, n: 4 }, on: { right: 4, secs: 170, looks: 12, backs: 4, n: 4 }, morePerQuestion: 22.5, holds: true } };
  const html = lookPage({ summary, rows: [row('rate', 'on', true, 50, { detail: 'read <src/config.mjs>' })] });
  expect(html).toContain('<title>Look first check · Qwen3.5 9B</title>');
  expect(html).toContain('Yes: with Look first Qwen3.5 9B got 4 of 4 answers right (without it: 3), +23 s a question, inside the rule.');
  expect(html).toContain('Right answers, off → on · higher is better');
  expect(html).toContain('Time, all four questions · lower is faster');
  expect(html).toContain('&lt;src/config.mjs&gt;');
});
