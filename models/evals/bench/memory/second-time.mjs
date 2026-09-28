// Is the second time better? Each task is run twice in the same project:
// first with an empty memory, then, on a fresh copy of the files, with what
// the first run taught. The files are checked before the memory saves and
// with the memory's folder set aside, so the memory's own files are never
// taken for the task's (a question's check fails when any file changed).
//   node models/evals/bench/memory/second-time.mjs [--only 1,2,12] [--ctx 32768] [--no-record]
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MODELS, DEFAULT_MODEL, ModelServer, Embedder, embedderReady, recordTest, codeLabel } from '../../../index.mjs';
import { runHeadless, readFacts, memoryDirs } from '../../../../terminal/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const only = (opt('only', '1,2,3,10,12,20')).split(',');
const ctx = Number(opt('ctx', 32768));
const model = MODELS[DEFAULT_MODEL];
const tasksDir = join(here, '..', 'tasks');
const tasks = readdirSync(tasksDir).filter((t) => only.some((o) => t.startsWith(`${o}-`))).sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

const server = new ModelServer(model);
const st = await server.start({ ctx });
const slots = st.slots > 1 ? { main: 0, side: 1 } : undefined;
const embedder = embedderReady() ? new Embedder() : null;
console.log(`model up on ${server.url}, ctx ${ctx}; facts are found ${embedder ? 'by meaning (BGE-M3)' : 'by their words'}`);
const rows = [];
const t0 = Date.now();
try {
  for (const task of tasks) {
    const base = mkdtempSync(join(tmpdir(), `agentic-second-${task}-`));
    const home = join(base, 'home');
    const work = join(base, 'project');
    const kept = join(base, 'memory-kept');
    const prompt = readFileSync(join(tasksDir, task, 'task.txt'), 'utf8').trim();
    const answerRows = existsSync(join(tasksDir, task, 'answers.json')) ? JSON.parse(readFileSync(join(tasksDir, task, 'answers.json'), 'utf8')) : [];
    const answers = (q) => answerRows.find((r) => new RegExp(r.match, 'i').test(q))?.reply ?? 'I do not know. If the files do not tell you, stop and tell me what you found; do not invent anything.';
    const row = { task, runs: [] };
    for (const time of [1, 2]) {
      rmSync(work, { recursive: true, force: true });
      cpSync(join(tasksDir, task, 'project'), work, { recursive: true });
      // The second time: the same files as the first, and what the first run saved.
      if (time === 2 && existsSync(kept)) cpSync(kept, join(work, '.agentic', 'memory'), { recursive: true });
      // What the checks read beside the project, as the practice runner leaves it:
      // when the run started (a file changed after it is the run's doing).
      writeFileSync(join(base, 'started'), '');
      spawnSync('sleep', ['1']);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 900_000);
      const used = [];
      let run;
      try {
        run = await runHeadless({ prompt, cwd: work, url: server.url, model, thinking: false, ctx, autoApprove: true, answers, signal: ac.signal, slots, warm: !!slots, memory: { home, embedder, save: 'after' },
          onEvent: (type, ev) => { if (type === 'memory') used.push(...ev.facts.map((f) => f.text)); if (type === 'tool') process.stdout.write(`    ${ev.error ? '✗' : '·'} ${ev.label}(${String(ev.arg).slice(0, 50)})\n`); if (type === 'note') process.stdout.write(`    ! ${ev.text}\n`); } });
      } catch (e) { run = { reason: `crash: ${e.message}`, secs: 900, steps: 0, asked: [] }; }
      clearTimeout(timer);
      writeFileSync(join(base, 'answer.txt'), run.finalText ?? '');
      writeFileSync(join(base, 'asked.txt'), (run.asked ?? []).map((a) => a.question).join('\n'));
      const aside = join(base, 'agentic-aside');
      const own = join(work, '.agentic');
      if (existsSync(own)) renameSync(own, aside);
      const check = spawnSync('/bin/zsh', [join(tasksDir, task, 'check.sh')], { cwd: work, encoding: 'utf8', timeout: 60_000 });
      if (existsSync(aside)) renameSync(aside, own);
      const pass = check.status === 0;
      const s = run.save ? await run.save() : null;
      const dirs = memoryDirs(work, home);
      if (time === 1) { rmSync(kept, { recursive: true, force: true }); if (existsSync(dirs.project)) cpSync(dirs.project, kept, { recursive: true }); }
      const r = { time, pass, why: pass ? '' : (check.stdout + check.stderr).trim().split('\n').pop(), reason: run.reason, secs: Math.round(run.secs), steps: run.steps, asked: (run.asked ?? []).length, errors: run.toolErrors ?? 0, used,
        saved: (s?.added ?? []).map((f) => `${f.kind}: ${f.text}`), refused: (s?.refused ?? []).map((x) => `${x.why}: ${x.text}`), saveSecs: s ? Math.round(s.secs) : null, saveTokens: s?.tokens ?? null,
        memory: [...readFacts(dirs.you), ...readFacts(dirs.project)].filter((f) => !f.always).map((f) => ({ kind: f.kind, text: f.text, trust: f.trust, used: f.used })) };
      row.runs.push(r);
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${task.padEnd(24)} time ${time}  ${String(r.secs).padStart(4)} s  ${r.steps} steps  ${r.asked} asked  used ${used.length} fact${used.length === 1 ? '' : 's'}  saved ${r.saved.length}${s ? ` in ${r.saveSecs} s` : ''}  ${r.why}`);
      for (const f of r.saved) console.log(`      + ${f}`);
    }
    rows.push(row);
    rmSync(base, { recursive: true, force: true });
  }
} finally {
  await embedder?.stop({ keep: false }).catch(() => {});
  await server.stop();
}
const both = rows.filter((r) => r.runs.length === 2);
const sum = (time, k) => both.reduce((n, r) => n + r.runs[time - 1][k], 0);
const better = both.filter((r) => r.runs[1].pass && (r.runs[1].secs < r.runs[0].secs || r.runs[1].steps < r.runs[0].steps)).length;
const broke = both.filter((r) => r.runs[0].pass && !r.runs[1].pass).length;
const savesAll = both.flatMap((r) => r.runs).filter((x) => x.saveSecs != null);
const result = { at: new Date().toISOString(), ctx, matcher: embedder ? 'BGE-M3' : 'words', tasks: both.length,
  first: { passed: both.filter((r) => r.runs[0].pass).length, secs: sum(1, 'secs'), steps: sum(1, 'steps'), asked: sum(1, 'asked') },
  second: { passed: both.filter((r) => r.runs[1].pass).length, secs: sum(2, 'secs'), steps: sum(2, 'steps'), asked: sum(2, 'asked') },
  better, broke, saves: savesAll.length, saveSecs: savesAll.length ? Math.round(savesAll.reduce((n, x) => n + x.saveSecs, 0) / savesAll.length) : null, rows };
console.log(`\nfirst time:  ${result.first.passed}/${both.length} passed, ${result.first.secs} s, ${result.first.steps} steps, ${result.first.asked} questions`);
console.log(`second time: ${result.second.passed}/${both.length} passed, ${result.second.secs} s, ${result.second.steps} steps, ${result.second.asked} questions`);
console.log(`faster or fewer steps the second time: ${better} of ${both.length}; passed first and failed second: ${broke}; a save took ${result.saveSecs} s on average`);
const out = join(root, 'models', model.folder, 'results', 'memory', `second-time-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(`saved ${out}`);
if (!args.includes('--no-record')) recordTest({ kind: 'other', name: `Memory: is the second time better? (${both.length} tasks, each run twice)`, code: codeLabel(root), effort: 'low', ctx, passed: result.second.passed, total: both.length, secs: (Date.now() - t0) / 1000,
  result: broke === 0 && result.second.passed >= result.first.passed && (result.second.secs < result.first.secs || result.second.steps < result.first.steps) ? 'pass' : 'fail',
  note: `first ${result.first.passed}/${both.length} in ${result.first.secs} s and ${result.first.steps} steps; second ${result.second.passed}/${both.length} in ${result.second.secs} s and ${result.second.steps} steps; a save ${result.saveSecs} s`, raw: out.slice(root.length + 1) });
process.exit(0);
