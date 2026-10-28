// Bonsai helpers check (models/evals/tools/bonsai-helpers.mjs, the Arena → Bonsai helpers check): its place in the
// Arena, and its results page drawn again from a run's folder (--rebuild) with both ways side by side. No model.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { RUN_TESTS } from '../evals/run-tests.mjs';
import { helpersPage } from '../evals/tools/bonsai-helpers-page.mjs';

const HOME = mkdtempSync(join(tmpdir(), 'agentic-bonsai-helpers-'));
const DOCS = join(HOME, 'docs');
const REPO = join(import.meta.dir, '..', '..');
mkdirSync(join(DOCS, 'tests'), { recursive: true });

const side = (o) => ({ calls: 0, readTok: 0, readSecs: 0, wroteTok: 0, writeSecs: 0, loadSecs: 0, peakTok: 0, ...o });
const arm = (o) => ({ secs: 300, reason: 'done', error: null, answer: '', offered: false, agentCalls: 0, helperRuns: [], tools: [], main: side(), helper: side(), mainAlways: true, heldPeakGb: 4.4, bothHeld: false, right: { secs: true, saves: true }, ...o });
const summary = {
  name: 'bonsai-2:9b', model: 'bonsai-2:9b', helper: 'bonsai-2:4b', url: 'http://localhost:11434', code: 'abc1234', ctx: 32768, question: 'Two things <b>here</b>?',
  started: '2026-10-28T16:35:00.000Z', finished: '2026-10-28T16:55:00.000Z', secs: 1200, checks: 8, of: 8, passed: 7, pass: false, stopped: false, sub: 'Oct 28 12:35 · abc1234',
  arms: {
    with: arm({ secs: 420, offered: true, helperRuns: [{ kind: 'Explore', model: 'bonsai-2:4b', steps: 6, secs: 150, reason: 'done' }], main: side({ calls: 4, peakTok: 9800, readSecs: 40, writeSecs: 200 }), helper: side({ calls: 7, readSecs: 30, writeSecs: 90 }), heldPeakGb: 7.1, bothHeld: true, answer: 'helpers-panel.mjs:12 — 6 s <script>' }),
    alone: arm({ secs: 360, main: side({ calls: 9, peakTok: 21400, readSecs: 70, writeSecs: 260 }), answer: 'helpers-panel.mjs:12, 6 seconds' }),
  },
  page: 'tests/agentic-coder-bonsai-helpers-2026-10-28-1235.html',
};
const rows = [
  { id: 'offered', name: 'offered', ok: true, secs: null, detail: '' },
  { id: 'time', name: 'With helpers, the request takes at most 1.5× the time', ok: false, secs: 420, detail: '420 s with helpers, 360 s on its own (1.17×)' },
];

test('it is in the Arena: no model of this Mac, eight checks counted from its PASS and FAIL lines', () => {
  expect(RUN_TESTS.find((t) => t.id === 'bonsai-helpers')).toMatchObject({ name: 'Bonsai helpers check', script: 'models/evals/tools/bonsai-helpers.mjs', total: 8, model: false, record: { kind: 'other', name: '^Bonsai helpers check$' } });
});

test('the page has both ways side by side, the better cell in bold, and the model’s words escaped', () => {
  const html = helpersPage({ summary, rows, prev: null, raw: ['models/evals/results/bonsai-helpers-x'] });
  for (const tab of ['1 · Result', '2 · The checks', '3 · Side by side', '4 · How it was measured']) expect(html).toContain(tab);
  expect(html).toContain('<b>9,800 tokens</b>'); // the smaller conversation wins its row
  expect(html).toContain('on its own: 21,400 tokens');
  expect(html).toContain('1 · 6 steps');
  expect(html).toContain('both models at once');
  expect(html).not.toContain('<script>alert');
  expect(html).toContain('6 s &lt;script&gt;');
  expect(html).toContain('Two things &lt;b&gt;here&lt;/b&gt;?');
});

test('--rebuild draws a run’s page again from its folder, with no model and no line in the record', () => {
  const dir = join(HOME, 'bonsai-helpers-2026-10-28-1235');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary));
  writeFileSync(join(dir, 'rows.json'), JSON.stringify(rows));
  const r = spawnSync('bun', [join(REPO, 'models/evals/tools/bonsai-helpers.mjs'), '--rebuild', dir], { cwd: REPO, encoding: 'utf8', env: { ...process.env, AGENTIC_DOCS: DOCS, AGENTIC_TEST_RECORD: join(HOME, 'record.jsonl'), AGENTIC_HOME: HOME } });
  expect(r.status).toBe(0);
  expect(r.stdout).toContain(`results page drawn again: ${summary.page}`);
  expect(readFileSync(join(DOCS, summary.page), 'utf8')).toContain('3 · Side by side');
  expect(existsSync(join(HOME, 'record.jsonl'))).toBe(false);
});
