// The Vision check's results page (models/evals/tools/vision-page.mjs, drawn by
// check-page.mjs): what it says and shows, from a run's rows. The check itself
// needs the real model (▶ Run a test → Vision check); pictures and PDFs have
// their own tests (terminal/test/vision.test.mjs, app-vision.test.mjs).
import { test, expect } from 'bun:test';
import { visionPage } from '../evals/tools/vision-page.mjs';

const summary = { name: 'Qwen3.5 9B', of: 2, checks: 2, passed: 1, pass: false, stopped: false, firstSecs: 31.4, reloadSecs: 22, addOn: 'mmproj-qwen3.5-9b-F16.gguf, 0.92 GB', load: 2, code: 'abc1234', sub: 'Sep 30 17:02 · abc1234' };
const rows = [{ id: 'look', name: '@hello.png: it reads it', ok: true, detail: 'answered "HELLO 42"', secs: 31.4 }, { id: 'scan', name: 'a scanned PDF', ok: false, detail: 'answered <b>no idea</b>', secs: 9.2 }];

test('the Vision check’s results page: the verdict first, every check with its seconds, the run before beside it; text from a check is escaped', () => {
  const html = visionPage({ summary, rows, prev: { s: { passed: 2, of: 2, firstSecs: 35, reloadSecs: 25 }, rows: [{ id: 'look', ok: true, secs: 35 }] }, raw: ['models/qwen3.5-9b/results/vision-check-x'] });
  expect(html).toContain('<meta charset="utf-8">');
  expect(html).toContain('<title>Vision check · Qwen3.5 9B</title>');
  expect(html).toContain('No: 1 of 2 checks failed (a scanned PDF).');
  expect(html).toContain('before: 2 of 2');
  expect(html).toContain('before: 35 s');
  expect(html).toContain('answered &lt;b&gt;no idea&lt;/b&gt;');
  expect(html).not.toContain('answered <b>no idea</b>');
  expect(html).toMatch(/Seconds<small>lower is faster<\/small>/);
  expect(html).toContain('prefers-color-scheme: dark');
  expect(html).toContain('<code>models/qwen3.5-9b/results/vision-check-x</code>');
});

test('all passed: it says yes and what that covered; no run before: it says so', () => {
  const html = visionPage({ summary: { ...summary, passed: 2, pass: true }, rows: rows.map((r) => ({ ...r, ok: true })) });
  expect(html).toContain('Yes: all 2 checks passed. The model read the text on pictures');
  expect(html).toContain('no run before this one');
  expect(html).not.toContain('Before<small>');
});
