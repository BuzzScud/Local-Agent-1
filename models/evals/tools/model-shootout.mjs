// One hard task, the same for every model on a service, one run each (4 Oct 2026, the owner's ask: "1
// hard test. the same test for all models and measure it from there … a coding task … related to what
// we do"). Their picks: task 40-hard-harness-reads (an Agentic Coder change), the six big models, one
// run each, the full picture: each check's part, time, steps, tokens, and whether the final answer told
// the truth about what passed.
//   bun run eval:shootout --remote <address> --models a,b,c [--task 40] [--timeout 1500] [--reps 3] [--ctx 65536] [--page file.html]
// The service is shared: each model is borrowed (borrowOllama) and let go when its run ends, unless it
// was loaded before (someone's, or yours); one that cannot load or answer is a row that says so.
// The app's put-back of a failed message is off (AGENTIC_PUT_BACK=off), so part of the work is scored;
// the page says where the app would have put it back. Runs one model at a time through models/evals/bench/run.mjs, as the app runs a big model (big-model
// mode, thinking on where the model has it), with the bench's own test-record line for each.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { borrowOllama } from '../../index.mjs';
import { shootoutPage } from './model-shootout-page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const remote = opt('remote', null);
const models = String(opt('models', '')).split(',').map((m) => m.trim()).filter(Boolean);
const task = opt('task', '40');
const timeoutSecs = Number(opt('timeout', 1500));
// --reps 3: each model runs the task that many times while it is loaded (one run says little: Qwen3.6 scored
// 2, 4, 3 and 1 of 6 in four runs on nearly the same harness, 4 Oct 2026); the page shows the mean and range.
const reps = Math.max(1, Number(opt('reps', 1)) || 1);
// --ctx 65536: every model at that context (the owner's ask, 4 Oct 2026: 64k for all); "llama4:latest=16384,…"
// after it: a model the service has no room for at that size runs at the size given for it.
const ctxArgs = String(opt('ctx', '')).split(',').map((x) => x.trim()).filter(Boolean);
const ctxAll = Number(ctxArgs.find((x) => /^\d+$/.test(x))) || null;
const ctxOf = Object.fromEntries(ctxArgs.filter((x) => x.includes('=')).map((x) => [x.slice(0, x.lastIndexOf('=')).trim(), Number(x.slice(x.lastIndexOf('=') + 1))]));
const ctxFor = (m) => ctxOf[m] ?? ctxAll;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = opt('out', join(homedir(), '.agentic-coder', 'tests', 'shootouts', stamp));
const page = opt('page', join(homedir(), 'Desktop', 'harness reviews', `model-shootout-${stamp.slice(0, 10)}.html`));
if (!remote || !models.length) { console.error('usage: model-shootout.mjs --remote <address> --models a,b,c [--task 40] [--timeout 1500] [--page file.html]'); process.exit(2); }
mkdirSync(out, { recursive: true });
// The models' sizes, for the page's legend.
let sizes = {};
try { const j = await (await fetch(`${remote.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(10_000) })).json(); sizes = Object.fromEntries((j.models ?? []).map((m) => [m.name, m.size])); } catch { /* no sizes */ }

// What a row says from the bench's summary: the parts (PARTS n/m and the ✓/✗ lines of the check).
export function partsOf(checkOut) {
  const text = String(checkOut ?? '');
  const m = /PARTS (\d+)\/(\d+)/.exec(text);
  const lines = text.split('\n').filter((l) => /^[✓✗] /.test(l));
  return { got: m ? Number(m[1]) : 0, of: m ? Number(m[2]) : 6, lines };
}
// Its final answer said it all works (tests pass, done) while the check found parts missing.
const CLAIMS = /\b(all (\d+ )?tests? (now )?pass|tests? (all )?pass(ed|ing)?|all (green|passing)|everything (works|passes)|implemented (all|every)|(is|are|all) (now )?(done|complete))\b/i;
export const overclaims = (answer, parts) => parts.got < parts.of && CLAIMS.test(String(answer ?? ''));

const rows = [];
const log = (s) => process.stdout.write(`${s}\n`);
for (const model of models) {
  const safe = model.replace(/[^a-zA-Z0-9.-]+/g, '_');
  const dir = join(out, safe);
  mkdirSync(dir, { recursive: true });
  log(`\n── ${model}`);
  // The model before it gone from the service first (a minute at most): laguna-s found no room while
  // gpt-oss was still being let go.
  if (rows.length) for (let i = 0; i < 30; i++) {
    const ps = await fetch(`${remote.replace(/\/+$/, '')}/api/ps`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null);
    if (!ps?.models?.some((m) => m.name === rows.at(-1).model)) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  let borrowed = null;
  try { borrowed = await borrowOllama({ url: remote, model }); } catch (e) { log(`  the service did not answer: ${e.message}`); }
  const t0 = Date.now();
  const logFile = createWriteStream(join(dir, 'run.log'));
  const code = await new Promise((done) => {
    const child = spawn(process.execPath, [join(here, '..', 'bench', 'run.mjs'), '--only', task, '--remote', remote, '--remote-model', model, '--big', 'on', '--think', opt('think', 'on'), '--timeout', String(timeoutSecs), '--out', dir, ...(reps > 1 ? ['--reps', String(reps)] : []), ...(ctxFor(model) ? ['--remote-ctx', String(ctxFor(model))] : [])], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AGENTIC_PUT_BACK: 'off' } });
    child.stdout.on('data', (d) => logFile.write(d));
    child.stderr.on('data', (d) => logFile.write(d));
    // A run that outlasts its time and a minute or two more is stopped (the bench saves what ran).
    const kill = setTimeout(() => { log('  over time: stopping it'); child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 20_000).unref(); }, (timeoutSecs + 120) * reps * 1000);
    child.on('close', (c) => { clearTimeout(kill); done(c); });
  });
  logFile.end();
  let let_go = null;
  try { let_go = await borrowed?.release(); } catch { /* the service will drop it in its own time */ }
  const file = join(dir, 'summary.json');
  let results = [];
  try { results = JSON.parse(readFileSync(file, 'utf8')).results ?? []; } catch { /* no summary: it did not run */ }
  const row = results[0] ?? null;
  // Each run's whole last answer (the row keeps 300 characters) and whether the app would have put its work
  // back, from the run's saved conversation (<task>-think-on.json, -rep<n> with --reps).
  const savedOf = (n) => { try { const f = readdirSync(dir).find((x) => x.endsWith(reps > 1 ? `-think-on-rep${n}.json` : '-think-on.json')); return f ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : null; } catch { return null; } };
  const runs = results.map((res, i) => {
    const saved = savedOf(res.rep ?? i + 1);
    const answer = saved?.messages?.filter((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()).pop()?.content ?? res.answer ?? '';
    const parts = partsOf(res.checkOut);
    const putBack = (saved?.log ?? []).some((e) => /the app would put this message's changes back/.test(e.text ?? ''));
    return { rep: res.rep ?? i + 1, parts, secs: res.secs, steps: res.steps, toolErrors: res.toolErrors, outTokens: res.outTokens, thinkTokens: res.thinkTokens, tps: res.tps, reason: res.reason, answer, overclaims: overclaims(answer, parts), putBack };
  });
  const said = runs[0]?.answer ?? row?.answer ?? '';
  // A model the service had no room for never ran: a row that says so, not a score of 0.
  const ranLog = existsSync(join(dir, 'run.log')) ? readFileSync(join(dir, 'run.log'), 'utf8') : '';
  if (row && /has no room to load/.test(ranLog) && !row.outTokens) {
    rows.push({ model, ran: false, short: 'did not fit', why: `the service had no room to load it (out of GPU memory) at a ${Math.round((ctxFor(model) ?? 32768) / 1024)}k context`, wall: Math.round((Date.now() - t0) / 1000), unloaded: let_go });
    log('  did not fit on the service');
    writeFileSync(join(out, 'shootout.json'), JSON.stringify({ task, models, sizes, timeoutSecs, ctxAll: ctxAll ?? 32768, rows }, null, 1));
    continue;
  }
  if (!row) {
    const tail = existsSync(join(dir, 'run.log')) ? readFileSync(join(dir, 'run.log'), 'utf8').trim().split('\n').slice(-3).join(' / ') : '';
    rows.push({ model, ran: false, why: tail || `exit code ${code}`, wall: Math.round((Date.now() - t0) / 1000), unloaded: let_go });
    log(`  did not run: ${tail}`);
    continue;
  }
  // The app puts a message's changes back when its own check fails; here they stay to be scored
  // (AGENTIC_PUT_BACK=off, a first run scored the put-back copy as 0 of 6), and the log says so.
  // With several runs the row's numbers are their means, parts with its lowest and highest, and runs keeps each.
  const mean = (k) => { const v = runs.map((x) => x[k]).filter((x) => typeof x === 'number'); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };
  const got = runs.map((x) => x.parts.got);
  const parts = { ...runs[0].parts, got: Math.round((got.reduce((a, b) => a + b, 0) / got.length) * 10) / 10, min: Math.min(...got), max: Math.max(...got) };
  const r = { model, ran: true, ctx: ctxFor(model) ?? 32768, pass: runs.every((x) => x.parts.got === x.parts.of), parts, secs: mean('secs'), wall: Math.round((Date.now() - t0) / 1000), steps: mean('steps'), toolErrors: mean('toolErrors'), outTokens: mean('outTokens'), thinkTokens: mean('thinkTokens'), tps: mean('tps'), reason: runs[0].reason, answer: said, overclaims: runs.some((x) => x.overclaims), putBack: runs.some((x) => x.putBack), runs, unloaded: let_go };
  rows.push(r);
  log(`  ${runs.map((x) => `${x.parts.got}/${x.parts.of}`).join(', ')} parts${runs.length > 1 ? ` (mean ${parts.got})` : ''} · ${r.secs} s · ${r.steps} steps · ${r.outTokens} tokens out${r.overclaims ? ' · an answer claims more than passed' : ''}`);
  writeFileSync(join(out, 'shootout.json'), JSON.stringify({ task, models, sizes, timeoutSecs, ctxAll: ctxAll ?? 32768, reps, rows }, null, 1));
}

// The page (model-shootout-page.mjs): it can be made again from shootout.json at any time.
const page_ = shootoutPage({ task, rows, sizes, timeoutSecs, ctxAll: ctxAll ?? 32768, reps });
mkdirSync(dirname(page), { recursive: true });
writeFileSync(page, page_);
log(`\nPage: ${page}\nRaw: ${out}`);
