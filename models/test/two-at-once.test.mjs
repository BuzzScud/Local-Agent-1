// The two-at-once speed check (models/evals/tools/two-at-once.mjs, the Arena → Two at once): its
// results page from a run's saved rows (--rebuild draws it again, no model), the verdict against the
// rule written before the first run (at least ×1.25 the tokens a second), and the Rounds tab.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildTwoPage } from '../evals/tools/two-at-once-page.mjs';

const HOME = mkdtempSync(join(tmpdir(), 'agentic-two-at-once-'));
const DOCS = join(HOME, 'docs');
mkdirSync(join(DOCS, 'tests'), { recursive: true });
const REPO = join(import.meta.dir, '..', '..');
const NODE = process.execPath.endsWith('bun') ? 'node' : process.execPath;

const way = (ms, tokens) => ({ ms, tokens, tps: tokens / (ms / 1000), reqs: [] });
const ROWS = [
  { round: 1, first: 'apart', apart: way(50_000, 800), together: way(52_000, 820), ratio: (820 / 52) / (800 / 50) },
  { round: 2, first: 'together', apart: way(55_000, 900), together: way(40_000, 900), ratio: 55 / 40 },
];
const summary = (more) => ({ model: 'qwen', name: 'Qwen3.5 9B', code: 'abc1234', started: '2026-09-30T17:49:00.000Z', secs: 333, rounds: 2, of: 2, apartTps: 16.2, togetherTps: 17.9, ratio: 1.1, pass: false, stopped: false, draft: true, ctx: 32768, maxTokens: 450, load: 3.1, page: 'tests/agentic-coder-two-at-once-qwen-2026-09-30-1349.html', ...more });

test('the page says whether two at once is worth it against ×1.25, and lists each round with its direction', () => {
  const no = buildTwoPage({ title: 'Two at once · Qwen3.5 9B', s: summary(), rows: ROWS, raw: ['models/qwen3.5-9b/results/two-at-once-x'] });
  expect(no).toContain('Not worth it: two tries at once wrote 17.9 tokens a second, one after the other 16.2, so ×1.10.');
  expect(no).toContain('✗ At least ×1.25 the tokens a second: ×1.10');
  expect(no).toContain('<td class="num ok">×1.38</td>'); // round 2 alone would pass
  expect(no).toContain('<td class="num no">×0.99</td>');
  expect(no.match(/higher is better|lower is better/g).length).toBeGreaterThanOrEqual(8);
  const yes = buildTwoPage({ title: 't', s: summary({ ratio: 1.4, togetherTps: 22.7, pass: true }), rows: ROWS });
  expect(yes).toContain('Worth it: two tries at once wrote 22.7 tokens a second');
  const part = buildTwoPage({ title: 't', s: summary({ stopped: true, rounds: 1, of: 3 }), rows: ROWS.slice(0, 1) });
  expect(part).toContain('Stopped after 1 of 3 rounds:');
});

test('--rebuild draws a run\'s page again from its folder, with no model', () => {
  const dir = join(HOME, 'run');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'rows.json'), JSON.stringify(ROWS));
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary()));
  const r = spawnSync(NODE, [join(REPO, 'models/evals/tools/two-at-once.mjs'), '--model', 'qwen', '--rebuild', dir], { cwd: REPO, encoding: 'utf8', env: { ...process.env, AGENTIC_DOCS: DOCS, AGENTIC_HOME: HOME } });
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('results page drawn again: tests/agentic-coder-two-at-once-qwen-2026-09-30-1349.html');
  expect(readFileSync(join(DOCS, 'tests/agentic-coder-two-at-once-qwen-2026-09-30-1349.html'), 'utf8')).toContain('<title>Two at once · Qwen3.5 9B</title>');
});
