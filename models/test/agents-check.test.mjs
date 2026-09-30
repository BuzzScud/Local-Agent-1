// The Subagent check's results page (models/evals/tools/agents-page.mjs, drawn by check-page.mjs).
// The check itself needs the real model (▶ Run a test → Subagent check); helpers have their own
// tests (terminal/test/agents.test.mjs, app-agents.test.mjs).
import { test, expect } from 'bun:test';
import { agentsPage } from '../evals/tools/agents-page.mjs';

test('the Subagent check’s results page: the verdict, what each check showed (escaped), the tokens read again with its direction', () => {
  const summary = { name: 'Qwen3.5 9B', of: 2, checks: 2, passed: 2, pass: true, stopped: false, exploreSecs: 40.2, keptTokens: 212, load: 2, code: 'abc1234', sub: 'Sep 30 18:30 · abc1234' };
  const rows = [{ id: 'explore', name: 'an explore helper finds a function for it', ok: true, detail: 'answered "src/billing/tax.mjs <line 4>"', secs: 40.2 }, { id: 'side', name: 'its requests ran on the side slot', ok: true, detail: '3 requests on slot 1', secs: 0 }];
  const html = agentsPage({ summary, rows });
  expect(html).toContain('<title>Subagent check · Qwen3.5 9B</title>');
  expect(html).toContain('Yes: all 2 checks passed. The model handed work to a helper');
  expect(html).toContain('&lt;line 4&gt;');
  expect(html).toContain('Read again after the helper · lower is faster');
  expect(html).toContain('212 tokens');
});
