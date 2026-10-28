// The Bonsai helpers check (the Arena → ▶ Run a test, `/test bonsai-helpers`; 28 Oct 2026, the owner: "run 1 test to
// measure it"): Bonsai 2 9B on the Ollama service on this Mac answers one question about a copy of the app's own window
// code twice, first with its helpers on Bonsai 2 4B (profiles.json's Helpers it starts, as /subagents bonsai-2:4b
// writes it), then on its own (no profiles: the Agent tool is not offered). Thinking as the model has it, the window's
// profile router, a throwaway home.
// The rules, written before the first run: with helpers, 9B is offered the Agent tool, hands the searching to a helper,
// the helper runs on 4B while 9B stays loaded, and both answers are right; on its own 9B gets them right too (the
// baseline); with helpers 9B's own conversation peaks smaller, and the whole request takes at most 1.5× the time.
// Each way stops at 15 minutes. What each model read and wrote is Ollama's own count, taken from every reply.
// It writes its results page into the DOCS folder (tests/) and its line in the test record.
// --ask: the question with helpers ends with one more sentence, asking for a helper (left to itself on 28 Oct, 9B
// searched by itself, so the helper was never measured).
//   node models/evals/tools/bonsai-helpers.mjs [--remote <address>] [--main bonsai-2:9b] [--helper bonsai-2:4b] [--ask] [--out <dir>] [--no-record]
//   node models/evals/tools/bonsai-helpers.mjs --rebuild <a run's folder>
// The Arena starts it with node; the agent is the app's own code, which needs Bun, so it runs itself again under Bun.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUN, root, options, pad, stampOf, previousRun, writeResultsPage, rebuildIfAsked, rawOf } from './check-kit.mjs';

const o = options();
if (!globalThis.Bun) {
  const child = spawn(BUN, [fileURLToPath(import.meta.url), ...o.args], { stdio: 'inherit' });
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { try { child.kill(s); } catch {} });
  process.exit(await new Promise((r) => { child.on('exit', (c) => r(c ?? 1)); child.on('error', () => { console.error('the Bonsai helpers check needs Bun (bun.sh) on this Mac'); r(2); }); }));
}

const url = o.opt('remote', 'http://localhost:11434').replace(/\/+$/, '');
const MAIN = o.opt('main', 'bonsai-2:9b');
const HELPER = o.opt('helper', 'bonsai-2:4b');
const look = o.has('no-record');
const ASK = o.has('ask');
const ASKED = ' Hand the searching to a helper with the Agent tool.';
const ARM_MS = 15 * 60_000;
const QUESTION = 'Look through this folder and answer two things, each with file:line: (1) how many seconds a finished helper\'s row stays on screen in the helpers panel, and (2) which function saves the helper model that /subagents picks into the profiles. Two short lines.';
// The answers, from the code the copy is made of (helpers-panel.mjs KEEP_DONE_MS, subagents-cmd.mjs useHelperModel).
const right = {
  secs: (t) => /helpers-panel/i.test(t) && /\b6\s*(s\b|sec|second)|\b6,?000\b/i.test(t),
  saves: (t) => /useHelperModel|helpersTo|subagents-cmd/i.test(t),
};

// The real test record and settings, before the home moves to a throwaway one (the agent's memory, profiles and
// sessions go there; the record line goes to yours).
const realHome = process.env.AGENTIC_HOME ?? join(homedir(), '.agentic-coder');
const recordAt = process.env.AGENTIC_TEST_RECORD ?? join(realHome, 'tests', 'record.jsonl');
let real = {};
try { real = JSON.parse(readFileSync(join(realHome, 'settings.json'), 'utf8')); } catch {}

const now = new Date();
const stamp = stampOf(now);
const out = o.opt('out', join(root, 'models', 'evals', 'results', `bonsai-helpers-${stamp}`));
const { DOCS_DIR } = await import('../../../docs/tools/to-docs.mjs');
const { helpersPage } = await import('./bonsai-helpers-page.mjs');
// The run before on the same two models: another helper is another test.
const previous = (dir, summary) => { const p = previousRun(dir, summary, 'bonsai-helpers-'); return p?.s.helper === summary.helper && Boolean(p.s.asked) === Boolean(summary.asked) ? p : null; };
const writePage = (dir, rows, summary, prev) => writeResultsPage(helpersPage, dir, rows, summary, prev);
rebuildIfAsked(o, (dir, rows, summary) => writePage(dir, rows, summary, previous(dir, summary)));

const scratch = mkdtempSync(join(tmpdir(), 'bonsai-helpers-'));
const home = join(scratch, 'home');
mkdirSync(home, { recursive: true });
const remote0 = { ...(real.remote ?? {}), use: true, kind: real.remote?.kind ?? 'openai', address: url, model: MAIN, connect: 'http' };
writeFileSync(join(home, 'settings.json'), JSON.stringify({ remote: remote0, remotes: real.remotes ?? {} }, null, 2));
Object.assign(process.env, { AGENTIC_HOME: home, AGENTIC_MEMORY_SAVE: 'off', AGENTIC_WARM_NEXT: 'off' });

// The project: the app's window code as this commit has it, outside any repo (no rules file, no git above it).
const project = join(scratch, 'project');
mkdirSync(project, { recursive: true });
spawnSync('sh', ['-c', `git -C '${root}' archive HEAD terminal/src/app | tar -x -C '${project}'`]);
const cwd = join(project, 'terminal', 'src', 'app');

// Every reply Ollama sends: which model, when, and its own counts (read, written, loading).
const calls = [];
let armNow = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = String(input?.url ?? input);
  if (!/\/api\/chat\b|\/v1\/chat\/completions\b/.test(u)) return realFetch(input, init);
  let body = {};
  try { body = JSON.parse(init.body); } catch {}
  const c = { arm: armNow, model: body.model ?? null, tools: (body.tools ?? []).map((t) => t.function?.name).filter(Boolean), at: Date.now() };
  const res = await realFetch(input, init);
  res.clone().text().then((t) => {
    const last = (k) => { const m = [...t.matchAll(new RegExp(`"${k}":\\s*(\\d+)`, 'g'))].at(-1); return m ? Number(m[1]) : null; };
    Object.assign(c, { end: Date.now(), promptTok: last('prompt_eval_count') ?? last('prompt_tokens'), outTok: last('eval_count') ?? last('completion_tokens'), readMs: (last('prompt_eval_duration') ?? 0) / 1e6, writeMs: (last('eval_duration') ?? 0) / 1e6, loadMs: (last('load_duration') ?? 0) / 1e6 });
    calls.push(c);
  }).catch(() => { c.end = Date.now(); c.failed = true; calls.push(c); });
  return res;
};

const { recordTest, codeLabel, connectRemote, thinkingLevel, HOME } = await import('../../index.mjs');
if (realpathSync(HOME) !== realpathSync(home)) { console.error(`the app's home is ${HOME}, not the throwaway one: stopped before anything was written`); process.exit(2); }
const { readLimits, modelWithLimits, Agent, systemPrompt, ProfileRouter, readProfiles, writeProfiles, helpersTo, serverOf } = await import('../../../terminal/index.mjs');

const stop = new AbortController();
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => stop.abort());
mkdirSync(out, { recursive: true });
const t0 = Date.now();
console.log(`Bonsai helpers check: ${MAIN} with helpers on ${HELPER}${ASK ? ' (asked to use one)' : ''}, then on its own, at ${url}`);

// What Ollama holds, every 2 s: the models loaded and their size in memory.
const ps = [];
const psTimer = setInterval(() => {
  realFetch(`${url}/api/ps`).then((r) => r.json()).then((j) => ps.push({ arm: armNow, at: Date.now(), models: (j.models ?? []).map((m) => ({ name: m.name, gb: Math.round((m.size ?? 0) / 1e8) / 10 })) })).catch(() => {});
}, 2000);

const settings = JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8'));
let conn = null;
async function arm(id, helpers) {
  armNow = id;
  const t = Date.now();
  const events = { helpers: new Map(), tools: [], notes: [] };
  let agent = null, reason = null, error = null;
  try {
    conn ??= await connectRemote(settings.remote);
    const model = modelWithLimits(conn.model, readLimits(settings, conn.model));
    const lv = thinkingLevel(conn.model, conn.model.thinkingDefault ?? true, conn.model.thinkingEffort);
    agent = new Agent({ url: conn.url, model, cwd, system: systemPrompt({ cwd, git: 'none' }), ctx: conn.ctx, thinking: Boolean(lv.effort), effort: lv.id, memory: false, flows: true, mode: 'edits', checkIns: false, confirmPlan: false,
      ask: async (req) => (req.name === 'Ask' ? { choice: 'answer', text: String(req.args?.options?.[0]?.label ?? req.args?.options?.[0] ?? 'Your call') } : { choice: 'yes' }) });
    if (helpers) {
      // As /subagents <helper> does it in the window (subagents-cmd.mjs), and the window's router, lent its connection.
      writeProfiles(helpersTo(readProfiles(settings), HELPER, serverOf(settings.remote)).data);
      agent.router = new ProfileRouter({ settings: () => settings });
      agent.router.lend(serverOf(settings.remote), conn);
    }
    agent.on('helper', (e) => { events.helpers.set(e.id, { ...events.helpers.get(e.id), ...e }); if (e.done) console.log(`  helper ${e.kind} on ${e.model}: ${e.steps} steps, ${Math.round(e.secs)} s, ${e.reason}`); });
    agent.on('tool', (e) => { if (e.name || e.label) { events.tools.push(e.label ?? e.name); console.log(`  ${e.error ? '✗' : '⏺'} ${e.label ?? e.name}(${String(e.arg ?? '').slice(0, 60)})`); } });
    agent.on('note', (e) => events.notes.push(String(e.text ?? '')));
    const cap = new AbortController();
    const timer = setTimeout(() => cap.abort(), ARM_MS);
    stop.signal.addEventListener('abort', () => cap.abort(), { once: true });
    reason = await agent.send(helpers && ASK ? QUESTION + ASKED : QUESTION, { signal: cap.signal });
    clearTimeout(timer);
    if (cap.signal.aborted && !stop.signal.aborted) reason = 'cut at 15 min';
  } catch (e) { error = e.message; }
  await new Promise((r) => setTimeout(r, 1500)); // the last reply's counts
  const answer = String(agent?.messages?.filter((m) => m.role === 'assistant' && m.content).at(-1)?.content ?? '');
  const mine = calls.filter((c) => c.arm === id);
  const of = (m) => mine.filter((c) => c.model === m);
  const sum = (xs, k) => xs.reduce((n, c) => n + (c[k] ?? 0), 0);
  const side = (m) => ({ calls: of(m).length, readTok: sum(of(m), 'promptTok'), readSecs: Math.round(sum(of(m), 'readMs') / 100) / 10, wroteTok: sum(of(m), 'outTok'), writeSecs: Math.round(sum(of(m), 'writeMs') / 100) / 10, loadSecs: Math.round(sum(of(m), 'loadMs') / 100) / 10, peakTok: Math.max(0, ...of(m).map((c) => c.promptTok ?? 0)) });
  const held = ps.filter((p) => p.arm === id);
  const r = {
    id, helpers, secs: (Date.now() - t) / 1000, reason, error, answer,
    offered: (of(MAIN)[0]?.tools ?? []).includes('Agent'),
    agentCalls: events.tools.filter((x) => x === 'Agent' || x === 'Explore').length,
    helperRuns: [...events.helpers.values()].map((h) => ({ kind: h.kind, model: h.model, steps: h.steps, secs: Math.round(h.secs ?? 0), reason: h.reason ?? null })),
    tools: events.tools,
    main: side(MAIN), helper: side(HELPER),
    mainAlways: held.length > 0 && held.slice(held.findIndex((p) => p.models.some((m) => m.name === MAIN))).every((p) => p.models.some((m) => m.name === MAIN)),
    heldPeakGb: Math.max(0, ...held.map((p) => Math.round(p.models.reduce((n, m) => n + m.gb, 0) * 10) / 10)),
    bothHeld: held.some((p) => p.models.some((m) => m.name === MAIN) && p.models.some((m) => m.name === HELPER)),
    right: { secs: right.secs(answer), saves: right.saves(answer) },
    lastModel: mine.at(-1)?.model ?? null, // the reply that gave the answer
  };
  console.log(`  ${id}: ${Math.round(r.secs)} s, ${reason ?? error}; ${MAIN} read ${r.main.readTok.toLocaleString('en-US')} tokens over ${r.main.calls} replies (peak ${r.main.peakTok.toLocaleString('en-US')}), ${HELPER} ${r.helper.calls} replies`);
  return r;
}

const withH = stop.signal.aborted ? null : await arm('with', true);
const alone = stop.signal.aborted ? null : await arm('alone', false);
clearInterval(psTimer);
conn?.stop?.();
const secs = (Date.now() - t0) / 1000;
const ok = (x) => Boolean(x && !x.error && x.reason !== 'cut at 15 min');
const rows = withH && alone ? [
  { id: 'offered', name: `With helpers on ${HELPER}, ${MAIN} is offered the Agent tool`, ok: withH.offered, secs: null, detail: withH.offered ? `its first request listed Agent among ${(calls.find((c) => c.arm === 'with' && c.model === MAIN)?.tools ?? []).length} tools` : 'its first request had no Agent tool' },
  { id: 'handed', name: `${MAIN} hands the searching to a helper`, ok: withH.helperRuns.length > 0, secs: withH.helperRuns.reduce((n, h) => n + h.secs, 0) || null, detail: withH.helperRuns.length ? withH.helperRuns.map((h) => `${h.kind}: ${h.steps} steps, ${h.secs} s, ${h.reason}`).join('; ') : `no helper started (its tools: ${withH.tools.join(', ') || 'none'})` },
  { id: 'on4b', name: `The helper runs on ${HELPER}`, ok: withH.helperRuns.length > 0 && withH.helperRuns.every((h) => h.model === HELPER) && withH.helper.calls > 0, secs: withH.helper.readSecs + withH.helper.writeSecs || null, detail: `${withH.helper.calls} replies from ${HELPER}: read ${withH.helper.readTok.toLocaleString('en-US')} tokens in ${withH.helper.readSecs} s, wrote ${withH.helper.wroteTok.toLocaleString('en-US')} in ${withH.helper.writeSecs} s, loading ${withH.helper.loadSecs} s` },
  { id: 'kept', name: `${MAIN} stays loaded while the helper works, and gives the answer`, ok: withH.mainAlways && withH.bothHeld && withH.lastModel === MAIN, secs: null, detail: `${withH.bothHeld ? 'both models held at once' : `never both at once`}; ${withH.mainAlways ? `${MAIN} in every look at Ollama after it loaded` : `${MAIN} was let go at some point`}; at most ${withH.heldPeakGb} GB held; the answer from ${withH.lastModel ?? 'no model'}` },
  { id: 'rightWith', name: 'With helpers, both answers are right', ok: ok(withH) && withH.right.secs && withH.right.saves, secs: withH.secs, detail: `${withH.right.secs ? '✓' : '✗'} the 6 seconds in helpers-panel; ${withH.right.saves ? '✓' : '✗'} the function /subagents saves with${ok(withH) ? '' : ` (it ended: ${withH.reason ?? withH.error})`}` },
  { id: 'rightAlone', name: `On its own, ${MAIN} gets both right (the baseline)`, ok: ok(alone) && alone.right.secs && alone.right.saves && alone.helper.calls === 0, secs: alone.secs, detail: `${alone.right.secs ? '✓' : '✗'} the 6 seconds; ${alone.right.saves ? '✓' : '✗'} the function${ok(alone) ? '' : ` (it ended: ${alone.reason ?? alone.error})`}${alone.helper.calls ? `; ${alone.helper.calls} of its replies came from ${HELPER}, not ${MAIN}` : ''}` },
  { id: 'smaller', name: `With helpers, ${MAIN}'s own conversation peaks smaller`, ok: withH.main.peakTok > 0 && withH.main.peakTok < alone.main.peakTok, secs: null, detail: `${withH.main.peakTok.toLocaleString('en-US')} tokens with helpers, ${alone.main.peakTok.toLocaleString('en-US')} on its own (the largest prompt ${MAIN} was sent)` },
  { id: 'time', name: 'With helpers, the request takes at most 1.5× the time', ok: withH.secs <= alone.secs * 1.5, secs: withH.secs, detail: `${Math.round(withH.secs)} s with helpers, ${Math.round(alone.secs)} s on its own (${(withH.secs / Math.max(1, alone.secs)).toFixed(2)}×)` },
] : [];
for (const x of rows) console.log(`${x.ok ? 'PASS' : 'FAIL'} ${x.name} · ${x.detail}`);
const OF = 8;
const full = rows.length === OF;
const pass = full && rows.every((x) => x.ok);
const code = codeLabel(root);
const docs = !look && full && existsSync(DOCS_DIR);
const summary = {
  name: MAIN, model: MAIN, helper: HELPER, asked: ASK, asks: ASK ? ASKED.trim() : null, url, code, ctx: conn?.ctx ?? null, question: QUESTION, started: new Date(t0).toISOString(), finished: new Date().toISOString(), secs,
  checks: rows.length, of: OF, passed: rows.filter((x) => x.ok).length, pass, stopped: !full, arms: { with: withH, alone },
  label: 'This run', sub: `${now.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} ${pad(now.getHours())}:${pad(now.getMinutes())} · ${code}`,
  page: docs ? `tests/agentic-coder-bonsai-helpers-${stamp}.html` : '',
};
writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(out, 'calls.json'), JSON.stringify({ calls, ps }, null, 2));
if (look) console.log('a look only: no results page, no line in the test record');
else if (docs) { writePage(out, rows, summary, previous(out, summary)); console.log(`results page: ${summary.page}`); }
const words = withH && alone ? `with helpers on ${HELPER} ${Math.round(withH.secs)} s (${withH.helperRuns.length} helper${withH.helperRuns.length === 1 ? '' : 's'}), on its own ${Math.round(alone.secs)} s; ${MAIN}'s conversation peaked at ${withH.main.peakTok.toLocaleString('en-US')} vs ${alone.main.peakTok.toLocaleString('en-US')} tokens` : 'stopped';
if (!look) recordTest({
  kind: 'other', model: `remote:${MAIN}`, name: 'Bonsai helpers check', code, ctx: summary.ctx, passed: summary.passed, total: OF, secs, part: !full,
  result: stop.signal.aborted ? 'stopped' : pass ? 'pass' : 'fail', bar: `with helpers on ${HELPER}: the Agent tool offered and used, the helper on ${HELPER} with ${MAIN} kept, both answers right (and on its own), a smaller conversation, at most 1.5× the time`,
  note: words, raw: rawOf(out), page: summary.page,
}, { file: recordAt });
console.log(`Bonsai helpers check: ${words} · ${pass ? 'PASSED' : stop.signal.aborted ? 'STOPPED' : 'FAILED'}`);
process.exit(pass ? 0 : 1);
