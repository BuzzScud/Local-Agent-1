// Plays the practice tasks against the real model and checks each result.
//   node evals/run.mjs [--think on|off|both] [--only 1,3] [--ctx 32768]
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MODELS, DEFAULT_MODEL } from '../src/server/models.mjs';
import { ModelServer } from '../src/server/server.mjs';
import { runHeadless } from '../src/headless.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const thinkModes = { on: [true], off: [false], both: [false, true] }[opt('think', 'both')];
const only = opt('only', null)?.split(',');
const ctx = Number(opt('ctx', 32768));
const perTaskMs = Number(opt('timeout', 900)) * 1000; // the 27B writes ~10 tokens/s
const reps = Number(opt('reps', 1));
const base = MODELS[DEFAULT_MODEL];
// --temp / --budget try other settings without touching the app's defaults.
const temp = opt('temp', null);
const budget = opt('budget', null);
const model = { ...base,
  sampling: temp ? { ...base.sampling, temperature: Number(temp) } : base.sampling,
  thinkingSampling: temp ? { ...base.thinkingSampling, temperature: Number(temp) } : base.thinkingSampling,
  thinkingBudget: budget ? Number(budget) : base.thinkingBudget };

const tasks = readdirSync(join(here, 'tasks')).filter((t) => !only || only.some((o) => t.startsWith(`${o}-`))).sort();
const server = new ModelServer(model);
const started = await server.start({ ctx });
const slots = started.slots > 1 ? { main: 0, side: 1 } : undefined;
console.log(`server up on ${server.url}, ctx ${ctx}, thinking budget ${model.thinkingBudget}${temp ? `, temperature ${temp}` : ''}`);
const results = [];
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const tdir = join(here, 'results', stamp);
mkdirSync(tdir, { recursive: true });
try {
  for (const thinking of thinkModes) for (let rep = 1; rep <= reps; rep++) {
    for (const task of tasks) {
      const dir = mkdtempSync(join(tmpdir(), `bonsai-eval-${task}-`));
      const work = join(dir, 'project');
      cpSync(join(here, 'tasks', task, 'project'), work, { recursive: true });
      writeFileSync(join(dir, 'started'), '');
      spawnSync('sleep', ['1']);
      const prompt = readFileSync(join(here, 'tasks', task, 'task.txt'), 'utf8').trim();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), perTaskMs);
      let run;
      try {
        run = await runHeadless({ prompt, cwd: work, url: server.url, model, thinking, ctx, autoApprove: true, signal: ac.signal, slots, warm: !!slots,
          onEvent: (type, ev) => { if (type === 'tool') process.stdout.write(`    ${ev.error ? '✗' : '·'} ${ev.label}(${String(ev.arg).slice(0, 50)})\n`); if (type === 'note') process.stdout.write(`    ! ${ev.text}\n`); } });
      } catch (e) { run = { reason: `crash: ${e.message}`, finalText: '', secs: perTaskMs / 1000, steps: 0, toolErrors: 0, outTokens: 0 }; }
      clearTimeout(timer);
      writeFileSync(join(dir, 'answer.txt'), run.finalText ?? '');
      writeFileSync(join(tdir, `${task}-think-${thinking ? 'on' : 'off'}${reps > 1 ? `-rep${rep}` : ''}.json`), JSON.stringify({ task, thinking, reason: run.reason, messages: run.messages ?? [], log: run.log ?? [] }, null, 1));
      const check = spawnSync('/bin/zsh', [join(here, 'tasks', task, 'check.sh')], { cwd: work, encoding: 'utf8', timeout: 60_000 });
      const pass = check.status === 0;
      const row = { task, thinking, rep, pass, why: pass ? '' : (check.stdout + check.stderr).trim().split('\n').pop(), reason: run.reason, secs: Math.round(run.secs), steps: run.steps, toolErrors: run.toolErrors, outTokens: run.outTokens, tps: run.tps ? Math.round(run.tps * 10) / 10 : null, answer: (run.finalText ?? '').slice(0, 300) };
      results.push(row);
      console.log(`${pass ? 'PASS' : 'FAIL'}  think=${thinking ? 'on ' : 'off'}${reps > 1 ? ` rep${rep}` : ''}  ${task.padEnd(16)} ${String(row.secs).padStart(4)}s  ${row.steps} steps  ${row.toolErrors} errors  ${row.why}`);
      rmSync(dir, { recursive: true, force: true });
    }
  }
} finally {
  await server.stop();
}
mkdirSync(join(here, 'results'), { recursive: true });
const file = join(tdir, 'summary.json');
writeFileSync(file, JSON.stringify({ ctx, reps, temp: temp ? Number(temp) : null, budget: model.thinkingBudget, results }, null, 2));
for (const thinking of thinkModes) {
  const rs = results.filter((r) => r.thinking === thinking);
  console.log(`thinking ${thinking ? 'on ' : 'off'}: ${rs.filter((r) => r.pass).length}/${rs.length} passed, ${Math.round(rs.reduce((s, r) => s + r.secs, 0))}s total`);
}
console.log(`saved ${file}`);
