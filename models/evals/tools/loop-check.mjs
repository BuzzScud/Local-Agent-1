// The loop controls check (▶ Run a test → Loop controls check, `/test loops`): the controls a loop
// got on 4 Oct 2026 (the owner's ask: "i want to be able to control it more"), with the real model,
// through the window's own Loops and `coding -p --loop-events` runs, on a small project with three
// bugs (a CSV export). Five checks:
//   1 a note typed while a run works reaches the model with its next step's result (heard)
//   2 the run ends with its copy for undo, naming the file it changed
//   3 undo puts that file back as it was, and the tests fail again
//   4 start over: the run under way stops, its changes go back, and a new run starts with your note
//   5 its own steps: a run allowed 3 steps stops after the third
// Whether the model fixed the bugs is shown, not judged: the check is about the controls.
// Each run writes its results page into the DOCS folder (tests/) and its line in the test record.
//   node models/evals/tools/loop-check.mjs --model qwen [--url http://127.0.0.1:PORT] [--out dir]
//   --url: on a server that is already up (no model is loaded or stopped)
//   --no-record: a look only; no line in the test record and no results page
//   node models/evals/tools/loop-check.mjs --rebuild <a run's folder>: draws its page again
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir, loadavg } from 'node:os';
import { spawnSync } from 'node:child_process';
import { MODELS, DEFAULT_MODEL, ModelServer, modelFolder, contextCheck, hasDraft, recordTest, codeLabel } from '../../index.mjs';
import { Loops, startRun, parseLoop, LOOP_PRESET } from '../../../terminal/index.mjs';
import { DOCS_DIR, docsPath } from '../../../docs/tools/to-docs.mjs';
import { throwawayHome, trust } from './ab-kit.mjs';
import { loopPage } from './loop-page.mjs';
import { options, pad, previousRun, rebuildIfAsked, root, stampOf, BUN, CLI, short } from './check-kit.mjs';

const args = process.argv.slice(2);
const { opt } = options(args);
const CTX = 32768;
const NOTE = 'Keep the columns in the order the rows give them.';
const REDO_NOTE = 'Start with the test about quoting.';
// The project: three bugs in toCsv (no rows crashes, a comma or a quote is not quoted, a column only
// some rows have gets no header); five tests, three of them failing.
const EXPORT = "#!/usr/bin/env node\n// Prints a trades file as CSV: node export.mjs [trades.json]\nimport { readFileSync } from 'node:fs';\n\nexport function toCsv(rows) {\n  const header = Object.keys(rows[0]);\n  const lines = rows.map((row) => header.map((key) => row[key]).join(','));\n  return [header.join(','), ...lines].join('\\n');\n}\n\nexport function main(argv = process.argv.slice(2)) {\n  const file = argv.find((arg) => !arg.startsWith('--')) ?? 'trades.json';\n  const rows = JSON.parse(readFileSync(file, 'utf8'));\n  return toCsv(rows);\n}\n\nif (import.meta.url === `file://${process.argv[1]}`) {\n  console.log(main());\n}\n";
const TESTS = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { toCsv, main } from './export.mjs';\n\nconst rows = [\n  { symbol: 'NQ', side: 'buy', qty: 1, price: 24812.5 },\n  { symbol: 'ES', side: 'sell', qty: 2, price: 6690.25 },\n];\n\ntest('toCsv writes a header row and one line per trade', () => {\n  assert.equal(toCsv(rows), 'symbol,side,qty,price\\nNQ,buy,1,24812.5\\nES,sell,2,6690.25');\n});\n\ntest('main reads the trades file', () => {\n  assert.match(main(['trades.json']), /^symbol,side,qty,price\\n/);\n});\n\ntest('no trades gives an empty file, not a crash', () => {\n  assert.equal(toCsv([]), '');\n});\n\ntest('a value with a comma or a quote is quoted', () => {\n  assert.equal(toCsv([{ symbol: 'NQ', note: 'stop, then \"flip\"' }]), 'symbol,note\\nNQ,\"stop, then \"\"flip\"\"\"');\n});\n\ntest('a column only some trades have still gets a header', () => {\n  assert.equal(toCsv([{ symbol: 'NQ' }, { symbol: 'ES', note: 'late' }]), 'symbol,note\\nNQ,\\nES,late');\n});\n";
const TRADES = '[\n  { "symbol": "NQ", "side": "buy", "qty": 1, "price": 24812.5 },\n  { "symbol": "ES", "side": "sell", "qty": 2, "price": 6690.25 },\n  { "symbol": "GC", "side": "buy", "qty": 1, "price": 3771.4 }\n]\n';
function project(base) {
  const cwd = join(base, 'trades-export');
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, 'export.mjs'), EXPORT);
  writeFileSync(join(cwd, 'export.test.mjs'), TESTS);
  writeFileSync(join(cwd, 'trades.json'), TRADES);
  spawnSync('git', ['init', '-q'], { cwd });
  return cwd;
}
const failing = (cwd) => { const r = spawnSync('node', ['--test'], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } }); return Number(/ℹ fail (\d+)/.exec(`${r.stdout}${r.stderr}`)?.[1] ?? (r.status ? 1 : 0)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, every = 200) { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await wait(every); } return null; }

const previous = (out, summary) => previousRun(out, summary, 'loop-check-');
const writePage = (out, rows, summary, prev) => writeFileSync(docsPath(summary.page), loopPage({ summary, rows, prev, raw: [relative(root, out)] }));

rebuildIfAsked(options(args), (dir, rows, summary) => writePage(dir, rows, summary, previous(dir, summary)));
const model = MODELS[opt('model', DEFAULT_MODEL)];
if (!model) { console.error(`no model "${opt('model')}"; one of: ${Object.keys(MODELS).join(', ')}`); process.exit(2); }
const now = new Date();
const stamp = stampOf(now);
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (stopping) process.exit(130); stopping = true; console.log('stopping: keeping the checks done so far…'); });

let url = opt('url'), srv = null;
const t0 = Date.now();
if (!url) {
  const running = spawnSync('ps', ['-axwwo', 'command'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /^\/\S*llama-server\s/.test(l));
  const big = Object.values(MODELS).filter((m) => running.some((l) => l.includes(`/${m.file} `)));
  if (big.length) { console.error(`refused: ${big.map((m) => m.name).join(', ')} is loaded (one big model at a time). Quit Agentic Coder, run coding stop, then try again.`); process.exit(3); }
  for (let i = 0; i < 24 && !contextCheck(model, CTX, { draft: hasDraft(model) }).fits; i++) await wait(5000);
  const fit = contextCheck(model, CTX, { draft: hasDraft(model) });
  if (!fit.fits) { console.error(`refused: ${fit.note}`); process.exit(4); }
  console.log(`${model.name} · 5 checks · loading the model…`);
  srv = new ModelServer(model);
  process.on('uncaughtException', async (e) => { console.error(e); try { await srv.stop(); } catch {} process.exit(1); });
  await srv.start({ ctx: CTX, share: false, lingerSecs: 0 });
  url = srv.url;
  console.log(`loaded in ${Math.round((Date.now() - t0) / 1000)} s`);
} else console.log(`${model.name} · 5 checks · on ${url}`);

const out = opt('out') ?? join(modelFolder(model), 'results', `loop-check-${stamp}`);
mkdirSync(out, { recursive: true });
const base = realpathSync(mkdtempSync(join(tmpdir(), 'loop-check-')));
const home = throwawayHome(join(base, 'home'), { memory: false });
const cwd = project(base);
trust(home, cwd);
const env = { ...process.env, AGENTIC_HOME: home, AGENTIC_MEMORY_SAVE: 'off', AGENTIC_NO_UPDATE: '1', AGENTIC_SESSIONS: 'off', AGENTIC_OPEN: 'off' };
// The window: the app's own Loops, its runs `coding -p --loop-events` on this server, in Accept edits.
const m = new Loops({ home, folder: cwd, name: 'trades-export', status: () => ({ on: true, name: model.name, where: 'this Mac', limit: 1, mode: 'edits', url }), start: (spec) => startRun(spec, { self: [BUN, CLI], env }) });
const linesOf = (l, n) => { try { return readFileSync(join(home, 'loops', String(process.pid), `run-${l.id}-${n}.jsonl`), 'utf8').trim().split('\n').map((x) => JSON.parse(x)); } catch { return []; } };
const rows = [];
const row = (id, name, ok, secs, detail, more = {}) => { rows.push({ id, name, ok: Boolean(ok), secs, detail, ...more }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} · ${secs.toFixed(1)} s · ${detail}`); };
const tick = setInterval(() => m.tick(), 250);
const failsAtStart = failing(cwd);

// 1–2: a fixing run, a note sent after its first step.
const fix = m.add({ ...parseLoop('debug'), message: LOOP_PRESET.debug, mode: 'edits' });
await until(() => fix.current && linesOf(fix, 1).some((x) => x.kind === 'tool' || x.kind === 'fail'), 180_000);
const sentAt = Date.now();
m.steer(fix.id, NOTE);
const ended = await until(() => fix.runs[0], 600_000, 500);
const lines = linesOf(fix, 1);
const heard = lines.find((x) => x.kind === 'heard');
const run1 = fix.runs[0];
// The line's time is from the run's start (loops.mjs line): when it was read, after the note was sent.
const heardSecs = heard && run1 ? Math.max(0, (run1.startedAt + heard.at - sentAt) / 1000) : 0;
row('note', 'A note reaches it at its next step', heard && heard.text === NOTE && ended, heardSecs,
  heard ? `read with the result of ${heard.after ?? 'a step'}, ${heardSecs.toFixed(1)} s after it was sent` : `not read before the run ended (${run1 ? short(run1.summary, 80) : 'no end'})`, { heardAfter: heard?.after ?? null });
const fixedTests = failing(cwd);
const changed = (run1?.files ?? []).map((f) => f.path);
row('copy', 'The run ends with its copy for undo', run1 && run1.point != null && changed.includes('export.mjs'), run1 ? (run1.endedAt - run1.startedAt) / 1000 : 0,
  run1 ? `copy ${run1.point ?? 'none'}, changed: ${changed.join(', ') || 'nothing'} · ${failsAtStart} tests failed before, ${fixedTests} after · it said: ${short(run1.said || run1.summary, 120)}` : 'the run never ended', { failsBefore: failsAtStart, failsAfter: fixedTests, said: run1?.said ?? '', runSecs: run1 ? (run1.endedAt - run1.startedAt) / 1000 : null });

// The servers a run started from the throwaway home (an embedder stays loaded after a run, as in the app): stopped at the end.
const leftovers = () => spawnSync('ps', ['-axwwo', 'pid=,command='], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l.includes(`${home}/`) && /llama-server/.test(l)).map((l) => Number(l.trim().split(/\s+/)[0])).filter(Boolean);
const finish = async () => { clearInterval(tick); m.close(); for (const pid of leftovers()) { try { process.kill(pid, 'SIGTERM'); } catch {} } if (srv) { try { await srv.stop(); } catch {} } };
if (stopping) { await finish(); console.log('stopped before the other checks'); process.exit(130); }

// 3: undo puts export.mjs back as it was; the tests fail again.
let a = Date.now();
const u = run1?.point != null ? await m.undo(fix.id, 1) : { error: 'no copy' };
const back = readFileSync(join(cwd, 'export.mjs'), 'utf8') === EXPORT;
const failsBack = failing(cwd);
row('undo', 'Undo puts the file back', !u.error && back && failsBack === failsAtStart, (Date.now() - a) / 1000, `${u.error ?? u.text} · export.mjs ${back ? 'as it was' : 'not as it was'} · ${failsBack} tests fail`);

if (stopping) { await finish(); process.exit(130); }
// 4: start over. A second fixing loop; once its run has taken a step, x with a note: it stops, its
// changes go back, and a new run starts with the note.
const again = m.add({ ...parseLoop('debug'), message: LOOP_PRESET.debug, mode: 'edits' });
await until(() => again.current && linesOf(again, 1).filter((x) => x.kind === 'tool' || x.kind === 'fail').length >= 2, 180_000);
a = Date.now();
const r = m.redo(again.id, REDO_NOTE);
const second = await until(() => again.current?.n === 2 && again.current, 60_000);
const secs4 = (Date.now() - a) / 1000;
const prompt2 = linesOf(again, 2).find((x) => x.kind === 'you')?.text ?? '';
const r1 = again.runs[0];
const putBack = readFileSync(join(cwd, 'export.mjs'), 'utf8') === EXPORT;
row('redo', 'Start over: stops, puts back, runs again with the note', Boolean(second) && prompt2 === REDO_NOTE && r1?.redo && putBack, secs4,
  `${r.error ?? r.text} · run 1: ${r1 ? short(r1.summary, 40) : '—'}${r1?.undone ? `, put back ${r1.undone.put?.join(', ') || 'nothing'}` : ''} · run 2 ${second ? `started ${secs4.toFixed(1)} s after, with “${short(prompt2, 50)}”` : 'did not start'} · export.mjs ${putBack ? 'as it was before run 1' : 'changed'}`);
m.stop(again.id);
await until(() => !again.current, 15_000);

if (stopping) { await finish(); process.exit(130); }
// 5: its own steps: a run allowed 3 steps stops after the third.
const steps = m.add({ ...parseLoop('debug'), message: LOOP_PRESET.debug, mode: 'edits', steps: 3 });
a = Date.now();
const run5 = (await until(() => steps.runs[0], 300_000, 500)) ?? null;
const l5 = linesOf(steps, 1);
const took = l5.filter((x) => (x.kind === 'tool' || x.kind === 'fail') && !/^(Plan|Ask)\(/.test(x.text)).length;
const capped = l5.some((x) => x.kind === 'note' && /Stopped after 3 steps/.test(x.text));
row('steps', 'Its own steps: 3, then it stops', run5 && capped, (Date.now() - a) / 1000, run5 ? `${took} steps of its own, then “${capped ? 'Stopped after 3 steps' : short(run5.summary, 60)}”` : 'the run never ended');
m.stop(steps.id);
await until(() => !steps.current, 15_000);
await finish();

const passed = rows.filter((x) => x.ok).length;
const full = rows.length === 5;
const pass = full && passed === 5;
const code = codeLabel();
const look = args.includes('--no-record');
const docs = !look && existsSync(DOCS_DIR);
const summary = {
  model: model.id, name: model.name, code, started: new Date(t0).toISOString(), finished: new Date().toISOString(), secs: (Date.now() - t0) / 1000,
  of: 5, checks: rows.length, passed, pass, stopped: !full, failsBefore: failsAtStart, failsAfter: fixedTests, runSecs: rows.find((x) => x.id === 'copy')?.runSecs ?? null,
  heardAfter: rows.find((x) => x.id === 'note')?.heardAfter ?? null, load: Math.round(loadavg()[0] * 10) / 10,
  sub: `${now.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} ${pad(now.getHours())}:${pad(now.getMinutes())} · ${code} · ${model.name}`,
  page: docs ? `tests/agentic-coder-loop-check-${model.id}-${stamp}.html` : '',
};
writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
const prev = previous(out, summary);
if (look) console.log('a look only: no results page, no line in the test record');
else if (docs) { writePage(out, rows, summary, prev); console.log(`results page: ${summary.page}`); }
if (!look) recordTest({
  kind: 'other', name: 'Loop controls check', model: model.id, ctx: CTX, passed, total: 5, secs: summary.secs, part: !full, bar: 'all 5 checks',
  result: !full ? 'stopped' : pass ? 'pass' : 'fail',
  note: `${passed} of 5 controls worked with the real model; the fixing run took ${summary.runSecs?.toFixed(0) ?? '?'} s and left ${fixedTests} of ${failsAtStart} tests failing.${prev ? ` Before: ${prev.s.passed} of 5.` : ''}`,
  raw: relative(root, out), page: summary.page,
});
console.log(`Loop controls check on ${model.name}: ${passed} of 5 · ${pass ? 'PASSED' : full ? 'FAILED' : 'STOPPED'}`);
process.exit(0);
