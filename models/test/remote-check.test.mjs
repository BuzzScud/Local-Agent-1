// The Remote check's results page (models/evals/tools/remote-page.mjs): what
// it says and shows, from a run's rows. The check itself needs the real model
// (▶ Run a test → Remote check); /remote and coding serve have their own tests.
import { test, expect } from 'bun:test';
import { buildRemotePage } from '../evals/tools/remote-page.mjs';

test('the Remote check’s results page: the verdict first, every check with its seconds, the run before beside it; text from a check is escaped', () => {
  const rows = [{ id: 'serve', name: 'coding serve starts', ok: true, detail: 'loaded in 24 s', secs: 24 }, { id: 'wrong-key', name: 'a wrong key is refused', ok: false, detail: 'answered <b>hi</b>', secs: 0.1 }];
  const summary = { name: 'Gemma 4 12B QAT', of: 2, checks: 2, passed: 1, pass: false, stopped: false, loadSecs: 24, answerSecs: 12, port: 18080, load: 2, code: 'abc1234', sub: 'Sep 30 15:02 · abc1234' };
  const html = buildRemotePage({ summary, rows, prev: { s: { passed: 2, of: 2, loadSecs: 30, answerSecs: 14 }, rows: [{ id: 'serve', ok: true, secs: 30 }] }, raw: ['models/gemma-4-12b/results/remote-check-x'] });
  expect(html).toContain('<meta charset="utf-8">');
  expect(html).toContain('No: 1 of 2 checks failed (a wrong key is refused).');
  expect(html).toContain('before: 2 of 2');
  expect(html).toContain('answered &lt;b&gt;hi&lt;/b&gt;');
  expect(html).not.toContain('answered <b>hi</b>');
  expect(html).toMatch(/Seconds<small>lower is faster<\/small>/);
  expect(html).toContain('prefers-color-scheme: dark');
});
