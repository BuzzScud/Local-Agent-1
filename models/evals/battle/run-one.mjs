// One model, one Battle test: the arena's runner starts this once per model per battle.
//   node models/evals/battle/run-one.mjs --model gemma --test <tests/id> --out <battles/id/A> [--timeout 600] [--ctx 32768] [--think on]
// --think on (a one-model run from the Tests tab): thinking on, at High; a battle never passes it.
// It runs the way a practice task runs (models/evals/bench/run.mjs): the same settings, Low
// (thinking off), the context helpers as the app has them, on a throwaway copy of the
// test's files; a test that is about the home folder (a page saved "to my Desktop") runs
// with its copy as the home folder, so your real Desktop is never touched.
// A test of your own with the design folder switched on (the Test builder's switch) runs with the
// design cards and the layout fix, as the app does; every other test runs with both off, as before.
// Its time limit is its own (its level's), unless --timeout says otherwise.
// While it works it writes each step to <out>/events.jsonl (the page shows them live); at
// the end <out>/result.json, and the pages it made under <out>/files/. Stopped (SIGTERM),
// it still writes what it has, as stopped.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { MODELS, ModelServer, Embedder, embedderReady } from '../../index.mjs';
import { runHeadless, helpersOn, testSettings, modelWithLimits, layoutCheck } from '../../../terminal/index.mjs';
// A run from the Tests page's control panel: its Context and Thinking cap (the rest reaches runHeadless).
const panel = testSettings();
import { runChecksWith, snapshot } from './checks.mjs';
import { readJson, limitSecsOf, pointsOf } from './store.mjs';
import { keepPage } from './builder.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const model = MODELS[opt('model')] && modelWithLimits(MODELS[opt('model')], panel ?? {});
const test = opt('test');
const out = opt('out');
const ctx = Number(opt('ctx', panel?.context ?? 32768));
const thinking = opt('think', 'off') === 'on';
if (!model || !test || !out) { console.error('usage: run-one.mjs --model <id> --test <dir> --out <dir>'); process.exit(2); }
mkdirSync(join(out, 'files'), { recursive: true });

const meta = readJson(join(test, 'meta.json'), {});
const limitMs = Number(opt('timeout', limitSecsOf(meta))) * 1000;
// The design folder: the test's own switch decides, not what the shell happens to have set.
const design = meta.design === true ? { auto: true, check: true, sets: 'all' } : undefined;
if (design) for (const k of ['AGENTIC_DESIGN', 'AGENTIC_LAYOUT', 'AGENTIC_DESIGN_SETS']) delete process.env[k];
const prompt = readFileSync(join(test, 'task.txt'), 'utf8').trim();
const KIND = { Read: 'read', Search: 'read', Plan: 'plan', Update: 'edit', Write: 'edit', Test: 'edit', Bash: 'bash', Ask: 'ask' };
const events = join(out, 'events.jsonl');
writeFileSync(events, '');
const t0 = Date.now();
const emit = (e) => appendFileSync(events, `${JSON.stringify({ t: (Date.now() - t0) / 1000, ...e })}\n`);
// Under a step, the Arena's run screen shows what it gave: a command's last lines, a change's first ones.
const outOf = (ev) => (ev.view?.kind === 'diff' ? (ev.view.hunk ?? []).filter((h) => h.type !== ' ').slice(0, 3).map((h) => `${h.type} ${String(h.text).slice(0, 150)}`)
  : Array.isArray(ev.view?.lines) ? ev.view.lines.filter((l) => String(l).trim()).slice(-3).map((l) => String(l).slice(0, 160)) : []);

const dir = mkdtempSync(join(tmpdir(), 'agentic-battle-'));
const work = join(dir, 'project');
cpSync(join(test, 'project'), work, { recursive: true });
writeFileSync(join(dir, 'started'), '');
const before = snapshot(work);
const realHome = process.env.HOME;

const ac = new AbortController();
let why = null; // 'time' | 'stopped'
let timer = null;
process.on('SIGTERM', () => { why ??= 'stopped'; ac.abort(); });
process.on('SIGINT', () => { why ??= 'stopped'; ac.abort(); });

const helpers = helpersOn(undefined);
const embedder = helpers.has('rag') && embedderReady() ? new Embedder() : null;
const server = new ModelServer(model);
let run = null;
try {
  emit({ type: 'note', text: `loading ${model.id}` });
  const st = await server.start({ ctx });
  const slots = st.slots > 1 ? { main: 0, side: 1 } : undefined;
  emit({ type: 'note', text: 'loaded' });
  if (why) throw new Error('stopped before it began');
  // The 10 minutes start once the model is loaded: loading is not the model's work.
  timer = setTimeout(() => { why = 'time'; ac.abort(); }, limitMs);
  if (meta.home) process.env.HOME = work;
  const answers = (q) => { const hit = (meta.answers ?? []).find((r) => new RegExp(r.match, 'i').test(q)); emit({ type: 'asked', text: q, reply: hit?.reply ?? null }); return hit ? hit.reply : 'I do not know. If the files do not tell you, decide for yourself and say what you chose.'; };
  run = await runHeadless({ prompt, cwd: work, url: server.url, model, thinking, effort: thinking ? 'high' : undefined, ctx, autoApprove: true, answers, signal: ac.signal, slots, warm: !!slots, rank: true, flows: true, helpers, embedder, prewarm: true, design,
    onEvent: (type, ev) => {
      if (type === 'tool') { const o = outOf(ev); emit({ type: 'step', label: ev.label, arg: String(ev.arg ?? '').replace(/\s+/g, ' ').slice(0, 120), kind: ev.error ? 'error' : (KIND[ev.label] ?? 'read'), err: ev.error ? String(ev.error).slice(0, 160) : '', ...(o.length ? { out: o } : {}) }); }
      if (type === 'note') emit({ type: 'note', text: ev.text });
    } });
} catch (e) { run = { reason: why === 'stopped' ? 'stopped' : `crash: ${e.message}`, finalText: '', log: [], secs: 0 }; emit({ type: 'note', text: why === 'stopped' ? 'stopped' : `crashed: ${e.message}` }); }
clearTimeout(timer);

// Its steps on its own clock, from the run's log (each has the time it happened).
const log = run.log ?? [];
const start = log.find((e) => e.type === 'route' || e.type === 'sorted')?.at ?? log[0]?.at ?? t0;
const steps = []; const diffs = [];
for (const e of log) {
  if (e.type === 'tool') {
    const err = e.view?.kind === 'error';
    steps.push({ t: Math.max(0, ((e.at ?? start) - start) / 1000), label: e.label, arg: String(e.arg ?? '').replace(/\s+/g, ' ').slice(0, 120), kind: err ? 'error' : (KIND[e.label] ?? 'read'), err: err ? String(e.view.message ?? '').slice(0, 160) : '' });
    if (e.view?.kind === 'diff') diffs.push({ path: e.view.path, created: Boolean(e.view.created), hunk: (e.view.hunk ?? []).map((h) => [h.type, h.text]) });
  }
  if (e.type === 'tries-done') steps.push({ t: Math.max(0, ((e.at ?? start) - start) / 1000), label: e.label, arg: (e.marks ?? []).join(''), kind: 'tries', err: '' });
}
const answer = run.finalText ?? '';
writeFileSync(join(dir, 'answer.txt'), answer);
// The questions it asked you, where the Practice 28 checks look for them ("fix the bug" must ask first).
writeFileSync(join(dir, 'asked.txt'), (run.asked ?? []).map((a) => a.question).join('\n'));
const checked = await runChecksWith({ checks: meta.checks ?? [], script: !meta.noScript && existsSync(join(test, 'check.sh')) ? join(test, 'check.sh') : null, work, before, answer, prompt }, { layoutCheck });
// The pages it made or changed, kept for the page (its own copy, so it opens offline).
const pages = [...checked.files.added, ...checked.files.changed].filter((f) => /\.html?$/i.test(f)).slice(0, 6);
for (const f of pages) { const to = join(out, 'files', f); mkdirSync(dirname(to), { recursive: true }); cpSync(join(work, f), to); }
// A test of your own keeps the last page each model made for it: the Test builder tries its checks on it.
if (meta.suite === 'mine' && meta.id && pages.length) keepPage(meta.id, model.id, join(work, pages[0]));
const result = {
  model: model.id, thinking, design: Boolean(design), level: meta.level ?? null, points: pointsOf(meta), limitSecs: Math.round(limitMs / 1000), pass: checked.pass, checks: checked.checks, reason: run.reason, stopped: why === 'stopped', overLimit: why === 'time',
  secs: Math.round((run.secs ?? 0) * 10) / 10, steps, stepCount: run.steps ?? steps.length, errors: run.toolErrors ?? steps.filter((s) => s.kind === 'error').length,
  tps: run.tps ? Math.round(run.tps * 10) / 10 : null, outTokens: run.outTokens ?? null, answer, diffs, pages, asked: (run.asked ?? []).map((a) => a.question),
  changed: checked.files,
};
writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 1));
emit({ type: 'done' });
process.env.HOME = realHome;
await embedder?.stop({ keep: false }).catch(() => {});
await server.stop().catch(() => {});
rmSync(dir, { recursive: true, force: true });
process.exit(0);
