// The Bonsai speed test (the Arena → ▶ Run a test, `/test bonsai-speed`; 27 Oct 2026): how fast Bonsai 2 9B on the
// Ollama service on this Mac reads a prompt and writes, and whether a later step reuses what it read. The same two
// requests as the hub's Bonsai tab (`speedTest`, terminal/src/app/bonsai-speed.mjs).
// The rules, written before the first run: both answered; the app's instructions and tools read from the start in
// under 30 s (20–24 s measured through a logging relay on 27 Oct); the later step read in under 3 s.
// It writes its results page into the DOCS folder (tests/) and its line in the test record.
//   node models/evals/tools/bonsai-speed.mjs [--remote <address>] [--remote-model bonsai-2:9b] [--out <dir>] [--no-record]
//   node models/evals/tools/bonsai-speed.mjs --rebuild <a run's folder>
// The Arena starts it with node; the app's instructions are read by its own code, which needs Bun, so it runs itself
// again under Bun.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUN, root, options, pad, stampOf, previousRun, writeResultsPage, rebuildIfAsked, rawOf } from './check-kit.mjs';

const o = options();
if (!globalThis.Bun) {
  const child = spawn(BUN, [fileURLToPath(import.meta.url), ...o.args], { stdio: 'inherit' });
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { try { child.kill(s); } catch {} });
  process.exit(await new Promise((r) => { child.on('exit', (c) => r(c ?? 1)); child.on('error', () => { console.error('the Bonsai speed test needs Bun (bun.sh) on this Mac'); r(2); }); }));
}

const { recordTest, codeLabel } = await import('../../index.mjs');
const { speedTest } = await import('../../../terminal/index.mjs');
const { DOCS_DIR } = await import('../../../docs/tools/to-docs.mjs');
const { speedPage } = await import('./bonsai-speed-page.mjs');

const previous = (out, summary) => previousRun(out, summary, 'bonsai-speed-');
const writePage = (out, rows, summary, prev) => writeResultsPage(speedPage, out, rows, summary, prev);
rebuildIfAsked(o, (dir, rows, summary) => writePage(dir, rows, summary, previous(dir, summary)));

const url = o.opt('remote', 'http://localhost:11434').replace(/\/+$/, '');
const model = o.opt('remote-model', 'bonsai-2:9b');
const look = o.has('no-record');
const stop = new AbortController();
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => stop.abort());

const t0 = Date.now();
const now = new Date();
const stamp = stampOf(now);
const out = o.opt('out', join(root, 'models', 'evals', 'results', `bonsai-speed-${stamp}`));
mkdirSync(out, { recursive: true });
console.log(`Bonsai speed test: ${model} at ${url}`);
let r = null, why = null;
try { r = await speedTest({ url, model, signal: stop.signal, record: false }); } catch (e) { why = stop.signal.aborted ? 'stopped' : e.message; }
const secs = (Date.now() - t0) / 1000;
const rows = r ? [
  { id: 'answered', name: 'Both requests answered with words', ok: r.answered, secs: r.wallSecs, detail: r.answered ? `${r.writeTok} tokens written first` : 'an answer came back empty' },
  { id: 'fresh', name: 'The app’s instructions and tools read from the start in under 30 s', ok: r.freshSecs < 30, secs: r.freshSecs, detail: `${r.freshTok.toLocaleString('en-US')} tokens at ${r.readTokS} a second` },
  { id: 'kept', name: 'A later step reads what is new in under 3 s', ok: r.laterReadSecs < 3, secs: r.laterReadSecs, detail: `a prompt of ${r.laterTok.toLocaleString('en-US')} tokens in ${r.laterReadSecs} s: only what is new read (Ollama counts the kept part too)` },
] : [];
for (const x of rows) console.log(`${x.ok ? 'PASS' : 'FAIL'} ${x.name} · ${x.detail}`);
if (why) console.log(`FAIL ${why}`);
const OF = 3;
const full = rows.length === OF;
const pass = full && rows.every((x) => x.ok);
const code = codeLabel(root);
const docs = !look && full && existsSync(DOCS_DIR);
const summary = {
  name: model, model, url, code, started: new Date(t0).toISOString(), finished: new Date().toISOString(), secs,
  checks: rows.length, of: OF, passed: rows.filter((x) => x.ok).length, pass, stopped: !full,
  ...(r ?? {}), why,
  label: 'This run', sub: `${now.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} ${pad(now.getHours())}:${pad(now.getMinutes())} · ${code}`,
  page: docs ? `tests/agentic-coder-bonsai-speed-${stamp}.html` : '',
};
writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
if (look) console.log('a look only: no results page, no line in the test record');
else if (docs) { writePage(out, rows, summary, previous(out, summary)); console.log(`results page: ${summary.page}`); }
const words = r ? `reads ${r.readTokS} tokens/s, writes ${r.writeTokS}/s; a fresh prompt of ${r.freshTok.toLocaleString('en-US')} tokens ${r.freshSecs} s; a later step ${r.laterSecs} s (reading ${r.laterReadSecs} s); loading ${r.loadSecs} s` : why;
if (!look) recordTest({
  kind: 'other', model: `remote:${model}`, name: 'Bonsai speed test', code, ctx: r?.ctx, passed: summary.passed, total: OF, secs, part: !full,
  result: stop.signal.aborted ? 'stopped' : pass ? 'pass' : 'fail', bar: 'answered; a fresh prompt read in under 30 s; a later step read in under 3 s',
  note: words, raw: rawOf(out), page: summary.page,
});
console.log(`Bonsai speed test: ${words} · ${pass ? 'PASSED' : stop.signal.aborted ? 'STOPPED' : 'FAILED'}`);
process.exit(pass ? 0 : 1);
