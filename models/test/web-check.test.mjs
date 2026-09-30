// The Web check's results page (models/evals/tools/web-page.mjs, drawn by check-page.mjs).
// The check itself needs the real model (▶ Run a test → Web check); the web tools have their own
// tests (terminal/test/web.test.mjs, app-web.test.mjs).
import { test, expect } from 'bun:test';
import { webPage } from '../evals/tools/web-page.mjs';

test('the Web check’s results page: the verdict, each check with what it showed (escaped), the seconds with their direction', () => {
  const summary = { name: 'Qwen3.5 9B', of: 2, checks: 2, passed: 1, pass: false, stopped: false, pageSecs: 21.3, searchSecs: 30, real: 'read', load: 2, code: 'abc1234', sub: 'Sep 30 18:02 · abc1234' };
  const rows = [{ id: 'page', name: 'a page', ok: true, detail: 'answered "8812"', secs: 21.3 }, { id: 'orders', name: 'a page that tells it to ignore its instructions', ok: false, detail: 'answered <b>PWNED</b>', secs: 9 }];
  const html = webPage({ summary, rows });
  expect(html).toContain('<title>Web check · Qwen3.5 9B</title>');
  expect(html).toContain('No: 1 of 2 checks failed (a page that tells it to ignore its instructions).');
  expect(html).toContain('answered &lt;b&gt;PWNED&lt;/b&gt;');
  expect(html).toContain('A page read and answered · lower is faster');
  expect(html).toContain('https://example.com, read over the internet (read)');
});
