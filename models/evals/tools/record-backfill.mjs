// Puts the test runs that are on this Mac into the test record: the saved
// 28-task and real-request runs, and every real-bug try (chart-bug-*/result-*.json).
// Safe to run again: each run has a fixed id, so a second pass changes nothing.
//   node models/evals/tools/record-backfill.mjs        (also: bun run test:record)
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, DEFAULT_MODEL, modelFolder } from '../../index.mjs';
import { recordTest, readRecord, writeSnapshot } from '../record.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RES = join(modelFolder(MODELS[DEFAULT_MODEL]), 'results');
const rel = (p) => p.replace(`${root}/`, '');
const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const when = (p) => statSync(p).mtime.toISOString();
const have = new Map(readRecord().map((r) => [r.id, r]));
let added = 0, updated = 0;
// A run already in the record is left alone, unless its results page has been made since.
const pageOf = (p) => (p && existsSync(join(root, 'bonsai-code DOCS', p)) ? p : '');
const add = (row) => {
  row.page = pageOf(row.page);
  const old = have.get(row.id);
  if (old && (old.page ?? '') === row.page) return;
  if (recordTest(row, { snapshot: false, quiet: true })) { if (old) updated++; else added++; have.set(row.id, row); }
};
const sum = (rows, k = 'secs') => Math.round(rows.reduce((s, r) => s + (r[k] ?? 0), 0));

// The 28-task check (18 tasks before 25 Sep noon). [folder, name, code, results page, note]
const TASKS = [
  ['night/2026-09-25/practice-off', 'The 18 practice tasks, 2 runs each', '', 'tests/bonsai-night-2026-09-25.html', 'the night run'],
  ['night/2026-09-25/practice-medium', 'The 18 practice tasks, 2 runs each', '', 'tests/bonsai-night-2026-09-25.html', 'the night run'],
  ['night/2026-09-25/practice-high', 'The 18 practice tasks', '', 'tests/bonsai-night-2026-09-25.html', 'the night run'],
  ['night/2026-09-25-rerun/practice-off', 'The 18 practice tasks, 2 runs each', '', 'tests/bonsai-night-double-check-2026-09-25.html', 'the morning double-check'],
  ['night/2026-09-25-smart/practice-off', 'The 28 practice tasks', '', 'tests/bonsai-smart-2026-09-25.html', 'the smarter-and-faster round, first run with the ten harder tasks'],
  ['night/2026-09-25-smart/practice-rerun', 'Two practice tasks, run again on the fixed code', '', 'tests/bonsai-smart-2026-09-25.html', 'the smarter-and-faster round'],
  ['runs/2026-09-25-fast/before', 'The 28 practice tasks', '', 'tests/bonsai-faster-2026-09-25.html', 'the faster round, before'],
  ['runs/2026-09-25-fast/after', 'The 28 practice tasks', '', 'tests/bonsai-faster-2026-09-25.html', 'the faster round, after: the bar for later runs'],
  ['chart-bug-round3-2026-09-26/bench-off-main-7595055', 'The 28 practice tasks', '7595055', 'tests/bonsai-round-3-results-2026-09-26.html', 'the 28-task check of round 3'],
];
for (const [dir, name, code, page, note] of TASKS) {
  const f = join(RES, dir, 'summary.json'); if (!existsSync(f)) continue;
  const s = load(f);
  for (const thinking of [false, true]) {
    const rs = (s.results ?? []).filter((r) => Boolean(r.thinking) === thinking); if (!rs.length) continue;
    const failed = [...new Set(rs.filter((r) => !r.pass).map((r) => r.task))];
    add({ id: `tasks:${dir}:${thinking ? 'on' : 'off'}`, at: when(f), kind: 'tasks', name, code, effort: thinking ? (s.effort ?? 'medium') : 'low', ctx: s.ctx, passed: rs.filter((r) => r.pass).length, total: rs.length, secs: sum(rs),
      result: s.stoppedAt ? 'stopped' : undefined, part: /rerun$/.test(dir) && rs.length < 18, note: [note, failed.length ? `failed: ${failed.join(', ')}` : ''].filter(Boolean).join(' · '), raw: rel(join(RES, dir)), page });
  }
}
// This afternoon's partial run: its raw files went with the session that made them.
add({ id: 'tasks:accuracy-round-baseline-2026-09-26', at: '2026-09-26T19:05:00.000Z', kind: 'tasks', name: 'The 28 practice tasks', code: 'f310a1f', effort: 'low', ctx: 32768, passed: 17, total: 18, secs: 1250, result: 'stopped',
  note: 'the accuracy round\'s first run, stopped after 18 tasks · failed: 25-bigproject-question (wrote a scratch file inside the project) · numbers from its report, the raw files were not kept', raw: '', page: 'bonsai-accuracy-round-2026-09-26.html' });

// The real requests.
const WORDS = [
  ['night/2026-09-25/words-real.json', 'tests/bonsai-night-2026-09-25.html', 'the night run'],
  ['night/2026-09-25-rerun/words-real.json', 'tests/bonsai-night-double-check-2026-09-25.html', 'the morning double-check'],
  ['night/2026-09-25-open9/words-real.json', 'tests/bonsai-night-double-check-2026-09-25.html', 'after the nine open items'],
  ['night/2026-09-25-smart/words-real.json', 'tests/bonsai-smart-2026-09-25.html', 'the smarter-and-faster round'],
  ['night/2026-09-25-smart/words-real-rerun.json', 'tests/bonsai-smart-2026-09-25.html', 'the smarter-and-faster round, three requests run again on the fixed code'],
];
for (const [file, page, note] of WORDS) {
  const f = join(RES, file); if (!existsSync(f)) continue;
  const s = load(f); const rows = s.rows ?? [];
  add({ id: `requests:${file}`, at: s.at ?? when(f), kind: 'requests', name: `The ${s.total} real requests`, code: '', effort: 'low', passed: s.ok, total: s.total, part: s.total < 28, secs: sum(rows),
    note: [note, s.ok < s.total ? `failed: ${rows.filter((r) => !r.ok).map((r) => `#${r.n}`).join(', ')}` : ''].filter(Boolean).join(' · '), raw: rel(f), page });
}

// The real-bug tries. Rounds 1 and 2 of the chart bug, from their logs and pages.
const BUG = 'The chart bug: the symbol list hidden behind the EMA legend';
const OLD = [
  ['bug:chart-r1-A', 'chart-bug-2026-09-25/result-A.json', 'low', 32768, 707, 'fail', 'round 1 · words only · chased the project\'s test suite, which cannot see a layout bug; no change', 'tests/bonsai-chart-bug-test-2026-09-25.html'],
  ['bug:chart-r1-B', 'chart-bug-2026-09-25/result-B.json', 'low', 32768, 1500, 'fail', 'round 1 · words + the failing check · ran into the 25 min limit; no change', 'tests/bonsai-chart-bug-test-2026-09-25.html'],
  ['bug:chart-r2-off', 'chart-bug-round2-2026-09-25/run-off.log', 'low', 32768, 1350, 'stopped', 'round 2 · words only · reached the legend\'s code, no change; stopped at about 22 min', 'tests/bonsai-chart-bug-round-2-2026-09-25.html'],
  ['bug:chart-r2-medium', 'chart-bug-round2-2026-09-25/run-medium.log', 'medium', 32768, 1355, 'stopped', 'round 2 · words only · reached the symbol list in index.html, no change; stopped at about 22 min', 'tests/bonsai-chart-bug-round-2-2026-09-25.html'],
  ['bug:chart-r2-high', 'chart-bug-round2-2026-09-25/run-high.log', 'high', 16384, 1500, 'fail', 'round 2 · words only · named the cause at 8:10, memory filled at 8:40 and the summary lost it; no change', 'tests/bonsai-chart-bug-round-2-2026-09-25.html'],
];
for (const [id, file, effort, ctx, secs, result, note, page] of OLD) {
  const f = join(RES, file); if (!existsSync(f)) continue;
  add({ id, at: when(f), kind: 'bug', name: BUG, code: /r1/.test(id) ? '' : 'round-2 build', effort, ctx, passed: result === 'pass' ? 1 : 0, total: 1, secs, result, note, raw: rel(dirname(f)), page });
}
// Round 3 on: every result-*.json a runner wrote, read as it is.
for (const d of existsSync(RES) ? readdirSync(RES).filter((n) => /^chart-bug-round[3-9]/.test(n)) : []) {
  for (const n of readdirSync(join(RES, d)).filter((x) => /^result-.*\.json$/.test(x)).sort()) {
    const f = join(RES, d, n); const r = load(f);
    const pass = r.judge?.code === 0, stopped = !pass && !r.timedOut && r.reason === 'error';
    const code = /code .*\/([^/\s]+)$/m.exec(existsSync(f.replace('result-', 'run-').replace('.json', '.log')) ? readFileSync(f.replace('result-', 'run-').replace('.json', '.log'), 'utf8').split('\n')[0] : '')?.[1] ?? '';
    const changed = (r.status ?? '').split('\n').filter((l) => /^ ?M /.test(l)).map((l) => l.trim().slice(2).trim());
    add({ id: `bug:${d}:${n}`, at: when(f), kind: 'bug', name: BUG, code: code.replace(/^(main|new)-/, ''), effort: r.effort === 'off' ? 'low' : r.effort, ctx: r.ctx, passed: pass ? 1 : 0, total: 1, secs: r.secs, result: pass ? 'pass' : stopped ? 'stopped' : 'fail',
      note: [`round ${/round(\d+)/.exec(d)[1]}`, r.try === 'B' ? 'words + the failing check' : 'words only', pass ? `fixed: changed ${changed.join(', ')}` : stopped ? 'stopped by hand, no change' : r.timedOut ? `ran into the ${Math.round(r.secs / 60)} min limit${changed.length ? `, changed ${changed.join(', ')}` : ', no change'}` : `not fixed${changed.length ? `, changed ${changed.join(', ')}` : ', no change'}`].join(' · '),
      raw: rel(join(RES, d)), page: `tests/bonsai-round-${/round(\d+)/.exec(d)[1]}-results-${d.slice(-10)}.html` });
  }
}
const page = writeSnapshot();
console.log(`${added} run${added === 1 ? '' : 's'} added${updated ? `, ${updated} given their results page` : ''}; the record holds ${readRecord().length}${page ? ` · saved copy: ${rel(page)}` : ''}`);
