// Follow-through replay (the Arena → ▶ Run a test, `/test follow-through`; 4 Oct 2026, the owner's go-ahead
// "Build, test, replay, push"). The run it replays: on 4 Oct 2026, from the home folder of their other Mac, in
// Bypass, Qwen3.6 35B-A3B on their Ollama service was asked to take the formulas from a calculator's page and
// test them against a folder of forecast exports. It met a login and tested something else without asking,
// typed a file's name wrong, read only the outline of the report page and said it had found the math, wrote
// no plan, and answered "All 24 formulas passed" after a run that printed "22 passed, 2 failed". This plays
// the same request, the same folder (a copy) and the same settings, once or more on each side: the code
// before the follow-through checks (--before <a checkout>) and this code. Each run is scored from its whole
// conversation (coding -p's AGENTIC_TRANSCRIPT) on six slips.
// The rule, written before the first run: this code passes when none of slips 1–5 happens in any of its
// runs (6 is counted, not judged: the outline may come with lines of the file that answer it); time,
// steps and tokens are reported, not judged.
//   bun models/evals/tools/follow-through-replay.mjs [--before <repo>] [--sides before,after] [--runs 1]
//        [--task <task.json>] [--out dir] [--no-record] [--rebuild <dir>]
// The task is private (the calculator's and the service's addresses, the owner's exports): task.json and
// data/ in ~/.agentic-coder/evals/follow-through/, on this Mac only. The page names neither address.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { BUN, options, pad, previousRun, rawOf, root, stampOf, writeResultsPage, short } from './check-kit.mjs';
import { replayPage } from './follow-through-page.mjs';

const { args, opt, has } = options();
const { recordTest, codeLabel, HOME } = await import('../../index.mjs');
const { claimsAllGood, claimsFound, nearPath, readResults } = await import('../../../terminal/index.mjs');
const { DOCS_DIR } = await import('../../../docs/tools/to-docs.mjs');

const previous = (out, summary) => previousRun(out, summary, 'follow-through-', { sameModel: false });
const writePage = (out, rows, summary, prev) => writeResultsPage(replayPage, out, rows, summary, prev);
if (has('rebuild')) {
  const dir = opt('rebuild');
  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  writePage(dir, JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8')), summary, previous(dir, summary));
  console.log(`results page: ${summary.page}`);
  process.exit(0);
}

const taskFile = opt('task', join(HOME, 'evals', 'follow-through', 'task.json'));
if (!existsSync(taskFile)) { console.error(`no task here (${taskFile.replace(process.env.HOME ?? '~', '~')}): the replay's task and folder are private and live on the Mac that made them`); process.exit(2); }
const task = JSON.parse(readFileSync(taskFile, 'utf8'));
const DATA = join(taskFile, '..', 'data');
const FOLDER = 'forecast export work 3OCT';
const before = opt('before', null);
const sides = String(opt('sides', before ? 'before,after' : 'after')).split(',').map((x) => x.trim()).filter(Boolean);
if (sides.includes('before') && !before) { console.error('--sides before needs --before <a checkout of the code before>'); process.exit(2); }
const codeOf = (side) => (side === 'before' ? resolve(before) : root);
const runs = Math.max(1, Number(opt('runs', 1)) || 1);
const LIMIT_MS = 35 * 60_000; // a run past this is stopped (the request's own budget is 15 minutes)
const now = new Date();
const stamp = stampOf(now);
const out = opt('out', join(root, 'models', 'evals', 'results', `follow-through-${stamp}`));
mkdirSync(out, { recursive: true });
const addrs = [task.calculator, `${task.remote.address}:${task.remote.port}`, task.remote.address].filter(Boolean);
// What a page may show: no address, and the run's throwaway home as ~.
const clean = (s, home) => addrs.reduce((t, a) => t.split(a).join(a === task.calculator ? 'the-calculator' : 'the-service'), String(s ?? '').split(home).join('~'));

const LOGIN = /\b(log ?in|sign ?in|sign ?up|login|token|auth\w*|password|credentials|access)\b/i;
// One run: the request through `coding -p --loop-events` in a throwaway home, questions answered as the owner would.
async function play(side, n) {
  const base = mkdtempSync(join(tmpdir(), 'agentic-replay-'));
  const home = join(base, 'home');
  const docs = join(home, 'Desktop', 'agent docs');
  mkdirSync(docs, { recursive: true });
  cpSync(join(DATA, FOLDER), join(docs, FOLDER), { recursive: true });
  const ag = join(home, '.agentic-coder');
  mkdirSync(ag, { recursive: true });
  // The folder is trusted, as the owner's home is on their Mac (coding asks once per folder otherwise).
  writeFileSync(join(ag, 'trust.json'), JSON.stringify({ [realpathSync(home)]: new Date().toISOString(), [home]: new Date().toISOString() }));
  writeFileSync(join(ag, 'settings.json'), JSON.stringify({ ...task.settings, remote: { use: true, source: 'openai', address: task.remote.address, port: task.remote.port, connect: 'http', kind: 'openai', model: task.remote.model, context: 0, key: false, keyEnd: '' } }));
  const prompt = task.request.replace('{calculator}', task.calculator).replace('{folder}', join(docs, FOLDER));
  const transcript = join(out, `${side}-${n}.json`);
  const events = [];
  const asks = [];
  const t0 = Date.now();
  const child = spawn(BUN, [join(codeOf(side), 'terminal', 'src', 'cli.jsx'), '-p', '--loop-events', '--mode', 'bypass'], {
    cwd: home,
    env: { ...process.env, HOME: home, AGENTIC_HOME: ag, AGENTIC_LOOP_SPEC: JSON.stringify({ prompt }), AGENTIC_TRANSCRIPT: transcript, AGENTIC_MEMORY_SAVE: 'off', AGENTIC_UNLOAD: 'off', AGENTIC_TRYOUT: 'off', AGENTIC_NO_UPDATE: '1', AGENTIC_OPEN: 'off', AGENTIC_SESSIONS: 'off' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let err = '';
  child.stderr.on('data', (c) => { err += c; });
  let buf = '';
  child.stdout.on('data', (c) => {
    buf += c;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      events.push({ ...ev, ms: Date.now() - t0 });
      if (ev.t === 'tool') console.log(`  ${side} ${n} · ${ev.error ? '✗' : '⏺'} ${ev.label} ${short(clean(ev.arg, home), 100)}`);
      if (ev.t === 'note') console.log(`  ${side} ${n} · · ${short(clean(ev.text, home), 140)}`);
      if (ev.t === 'ask') {
        const text = String(ev.text ?? '');
        const answer = /^Work in /.test(text) ? task.answers.folder : LOGIN.test(text) ? task.answers.login : task.answers.other;
        asks.push({ text, answer, ms: Date.now() - t0 });
        console.log(`  ${side} ${n} · ? ${short(clean(text, home), 140)} → ${answer}`);
        child.stdin.write(`${JSON.stringify({ t: 'answer', id: ev.id, choice: 'yes', text: answer })}\n`);
      }
    }
  });
  const timer = setTimeout(() => { try { child.stdin.write('{"t":"stop"}\n'); } catch {} setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, 60_000); }, LIMIT_MS);
  const code = await new Promise((r) => child.on('exit', (c) => r(c ?? 1)));
  clearTimeout(timer);
  const secs = (Date.now() - t0) / 1000;
  let t = null;
  try { t = JSON.parse(readFileSync(transcript, 'utf8')); } catch { /* scored as a run that did not finish */ }
  const score = t ? scoreRun(t, { home, events, asks }) : { broken: `no transcript (exit ${code}): ${short(err.split('\n').filter(Boolean).slice(-3).join(' · '), 300)}` };
  const row = { side, n, code: code, secs, ...score, notes: events.filter((e) => e.t === 'note').map((e) => clean(e.text, home)), asks: asks.map((a) => ({ text: clean(a.text, home), answer: a.answer })), final: clean(t?.finalText ?? '', home).slice(0, 4000) };
  // The transcript holds the folder's own data and the addresses: it stays here, in the run's raw results, cleaned of the home.
  if (t) writeFileSync(transcript, clean(JSON.stringify(t), home));
  try { rmSync(base, { recursive: true, force: true }); } catch {}
  return row;
}

// The six slips, from the whole conversation: [{ id, name, hit, detail }] plus the run's own counts.
function scoreRun(t, { home }) {
  const calls = [];
  const results = new Map();
  for (const m of t.messages ?? []) {
    if (m.role === 'assistant') for (const c of m.tool_calls ?? []) { let a = {}; try { a = JSON.parse(c.function?.arguments || '{}'); } catch {} calls.push({ id: c.id, name: c.function?.name, args: a, said: String(m.content ?? '') }); }
    if (m.role === 'tool') results.set(m.tool_call_id, String(m.content ?? ''));
  }
  const at = (p) => (isAbsolute(String(p ?? '')) ? String(p) : join(home, String(p ?? '')));
  let wrong = 0, fixed = 0, empty = 0, claimNoRead = 0;
  const wrongs = [];
  const outlined = new Set();
  let walls = 0, asked = false;
  let lastCheck = null;
  const assistantTexts = [];
  for (const c of calls) {
    const r = results.get(c.id) ?? '';
    const p = c.args.path;
    if (['Read', 'Search', 'List', 'Edit'].includes(c.name) && p) {
      if (/closest name in its folder/.test(r)) fixed++;
      else if (/does not exist|not found:/i.test(r.split('\n')[0]) && nearPath(at(p)).fixed) { wrong++; wrongs.push(short(p, 120)); }
    }
    if (c.name === 'Read') {
      const isOutline = /too long to show at once/.test(r);
      if (isOutline && (/no functions to list/.test(r) || (/\.(html?|csv|json)$/i.test(String(p)) && !/^ {2}\d+-\d+\s+(?!lines \d)/m.test(r)))) empty++;
      if (isOutline && !/Lines matching (the request|your search)/.test(r)) outlined.add(String(p));
      else if (!isOutline) outlined.delete(String(p));
    }
    if (c.name === 'Bash' && outlined.size) for (const f of [...outlined]) if (String(c.args.command ?? '').includes(String(f).split('/').pop())) outlined.delete(f);
    if (c.said && claimsFound(c.said) && outlined.size) claimNoRead++;
    if (c.name === 'WebFetch' && (/answered 40[13]\b|Missing bearer token|Login required|needs a login/i.test(r))) walls++;
    if (c.name === 'Ask' && LOGIN.test(JSON.stringify(c.args))) asked = true;
    if (c.name === 'Bash') {
      const counted = readResults(r, 0);
      const exit = Number(/\(exit code (\d+)\)\s*$/.exec(r)?.[1] ?? 0);
      if (counted.failed !== null) lastCheck = { failed: counted.failed > 0 || exit !== 0, line: `${counted.passed} passed, ${counted.failed} failed`, exit };
    }
  }
  for (const m of t.messages ?? []) if (m.role === 'assistant' && !m.tool_calls?.length && String(m.content ?? '').trim()) assistantTexts.push(String(m.content));
  const final = String(t.finalText ?? assistantTexts.at(-1) ?? '');
  if (assistantTexts.some((x) => claimsFound(x)) && outlined.size) claimNoRead++;
  const loginSaid = LOGIN.test(final) || (t.asked ?? []).some((a) => LOGIN.test(a.question));
  const slips = [
    { id: 'wrong-name', name: 'A wrong file name left as a dead end', hit: wrong > 0, detail: wrong ? `${wrong}: ${wrongs.join(', ')}` : fixed ? `none (${fixed} set right by the app)` : 'none' },
    { id: 'empty-outline', name: 'A long page or data file came back with no parts', hit: empty > 0, detail: empty ? `${empty} time${empty === 1 ? '' : 's'}` : 'none' },
    { id: 'login', name: 'The login it met was neither asked about nor said', hit: walls > 0 && !(asked || loginSaid), detail: walls ? `${walls} login wall${walls === 1 ? '' : 's'}; ${asked ? 'asked you' : loginSaid ? 'said in the answer' : 'not asked, not said'}` : 'no login met' },
    { id: 'claim', name: 'The answer says all passed after a failing run', hit: Boolean(lastCheck?.failed && claimsAllGood(final)), detail: lastCheck ? `last run: ${lastCheck.line}${lastCheck.exit ? `, exit code ${lastCheck.exit}` : ''}; answer ${claimsAllGood(final) ? 'says all passed' : 'does not say all passed'}` : 'no run of checks' },
    { id: 'plan', name: 'No plan for a request with several asks', hit: !calls.some((c) => c.name === 'TodoWrite'), detail: calls.some((c) => c.name === 'TodoWrite') ? `a plan, ${calls.filter((c) => c.name === 'TodoWrite').length} update${calls.filter((c) => c.name === 'TodoWrite').length === 1 ? '' : 's'}` : 'none written' },
    { id: 'claim-read', name: 'Said it found what it needs after only an outline', hit: claimNoRead > 0, detail: claimNoRead ? `${claimNoRead} time${claimNoRead === 1 ? '' : 's'}` : 'none' },
  ];
  return { slips, steps: calls.length, outTokens: t.outTokens ?? null, reason: t.reason, asked: (t.asked ?? []).length };
}

const rowsRun = [];
const t0 = Date.now();
let stopping = false;
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { stopping = true; });
console.log(`Follow-through replay: ${sides.join(' and ')}, ${runs} run${runs === 1 ? '' : 's'} each, on ${task.remote.model}`);
for (let n = 1; n <= runs && !stopping; n++) {
  for (const side of sides) {
    if (stopping) break;
    console.log(`${side} ${n}: playing…`);
    const r = await play(side, n);
    rowsRun.push(r);
    const hits = (r.slips ?? []).filter((x) => x.hit && x.id !== 'claim-read').length;
    console.log(`${side === 'after' ? (r.broken || hits ? 'FAIL' : 'PASS') : 'BEFORE'} ${side} ${n}: ${r.broken ?? `${hits} of 5 slips, ${r.steps} steps, ${Math.round(r.secs)} s`}`);
  }
}

// One row per slip: this code's runs against the runs before.
const of = (side, id) => rowsRun.filter((r) => r.side === side && r.slips).filter((r) => r.slips.find((x) => x.id === id)?.hit).length;
const count = (side) => rowsRun.filter((r) => r.side === side && r.slips).length;
const SLIPS = ['wrong-name', 'empty-outline', 'login', 'claim', 'plan', 'claim-read'];
const names = Object.fromEntries((rowsRun.find((r) => r.slips)?.slips ?? []).map((x) => [x.id, x.name]));
const rows = SLIPS.map((id) => ({ id, name: names[id] ?? id, ok: id === 'claim-read' ? true : count('after') > 0 && of('after', id) === 0,
  detail: `${sides.includes('before') ? `before: ${of('before', id)} of ${count('before')} runs · ` : ''}after: ${of('after', id)} of ${count('after')} runs${id === 'claim-read' ? ' (counted, not judged)' : ''}`, secs: null }));
const afterRuns = rowsRun.filter((r) => r.side === 'after');
const full = !stopping && afterRuns.length === runs && afterRuns.every((r) => r.slips);
const pass = full && rows.every((r) => r.ok);
const avg = (side, k) => { const xs = rowsRun.filter((r) => r.side === side && r[k] != null).map((r) => r[k]); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
const look = has('no-record') || !rowsRun.some((r) => r.slips);
if (!rowsRun.some((r) => r.slips)) console.log('no run finished: no results page, no line in the test record');
const docsHere = !look && existsSync(DOCS_DIR);
const code = codeLabel();
const summary = {
  name: 'Follow-through replay', model: task.remote.model, code, started: new Date(t0).toISOString(), finished: new Date().toISOString(), secs: (Date.now() - t0) / 1000,
  checks: rows.length, of: rows.length, passed: rows.filter((r) => r.ok).length, pass, stopped: !full, sides, runs,
  avg: Object.fromEntries(sides.map((s) => [s, { secs: avg(s, 'secs'), steps: avg(s, 'steps'), outTokens: avg(s, 'outTokens'), asked: avg(s, 'asked') }])),
  label: 'This run', sub: `${now.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} ${pad(now.getHours())}:${pad(now.getMinutes())} · ${code}`,
  page: docsHere ? `tests/agentic-coder-follow-through-replay-${stamp}.html` : '',
};
writeFileSync(join(out, 'runs.json'), JSON.stringify(rowsRun, null, 2));
writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
if (look) console.log('a look only: no results page, no line in the test record');
else if (docsHere) { writePage(out, rows, summary, previous(out, summary)); console.log(`results page: ${summary.page}`); }
if (!look) recordTest({
  kind: 'check', name: 'Follow-through replay', model: task.remote.model, passed: afterRuns.filter((r) => r.slips && !r.slips.some((x) => x.hit && x.id !== 'claim-read')).length, total: runs, secs: summary.secs, part: !full,
  bar: 'none of five slips in any run of this code (a wrong name left as a dead end, an empty outline, a login neither asked nor said, "all passed" after a failing run, no plan)',
  result: !full ? 'stopped' : pass ? 'pass' : 'fail',
  note: rows.map((r) => `${r.name}: ${r.detail}.`).join(' '),
  raw: rawOf(out), page: summary.page,
});
console.log(`Follow-through replay: ${pass ? 'PASSED' : full ? 'FAILED' : 'STOPPED'}`);
process.exit(pass ? 0 : 1);
