// The overnight check, report only: runs each check in turn (never two models
// at once), writes results to models/bonsai-2-27b/results/night/<date>/, then builds the morning
// report in models/bonsai-2-27b/reports/ and opens it. Start it with models/evals/night/start.sh (keeps
// the Mac awake).
//   node models/evals/night/run-night.mjs [--dir models/bonsai-2-27b/results/night/<date>] [--stop-at 06:30] [--only step,step]
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); // the repo
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const day = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10); // the morning's date
const dir = opt('dir', join(root, 'models', 'bonsai-2-27b', 'results', 'night', day));
const stopAt = opt('stop-at', '06:40');
const only = opt('only', null)?.split(',');
mkdirSync(dir, { recursive: true });
const BIN = join(homedir(), '.local', 'bin', 'bonsai');
const logFile = join(dir, 'night.log');
const log = (s) => { const line = `[${new Date().toTimeString().slice(0, 8)}] ${s}`; console.log(line); appendFileSync(logFile, `${line}\n`); };
const statusFile = join(dir, 'status.json');
const status = existsSync(statusFile) ? JSON.parse(readFileSync(statusFile, 'utf8')) : { started: new Date().toISOString(), steps: {} };
const save = () => writeFileSync(statusFile, JSON.stringify(status, null, 1));

// Another model server (your own bonsai window) → wait, then skip.
// By process name only: a shell or editor whose text mentions the name must not count.
const otherModel = () => { try { return execFileSync('pgrep', ['-x', 'llama-server'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length > 0; } catch { return false; } };
async function modelFree(name) {
  const t0 = Date.now();
  while (otherModel()) {
    if (Date.now() - t0 > 30 * 60_000) { log(`${name}: another model has been running for 30 min (your bonsai?) — skipping`); return false; }
    await new Promise((r) => setTimeout(r, 60_000));
  }
  return true;
}
const pastStop = () => { const [h, m] = stopAt.split(':').map(Number); const t = new Date(); t.setHours(h, m, 0, 0); const now = new Date(); return now.getHours() < 12 && now >= t; };

function run(name, cmd, cmdArgs, { env = {}, minutes }) {
  return new Promise((resolve) => {
    log(`${name}: start (${cmd} ${cmdArgs.join(' ')})`);
    const t0 = Date.now();
    const child = spawn(cmd, cmdArgs, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = join(dir, `${name}.log`);
    child.stdout.on('data', (d) => appendFileSync(out, d));
    child.stderr.on('data', (d) => appendFileSync(out, d));
    const timer = setTimeout(() => { log(`${name}: over ${minutes} min, stopping it`); child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 20_000); }, minutes * 60_000);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const secs = Math.round((Date.now() - t0) / 1000);
      status.steps[name] = { code, signal, secs, finished: new Date().toISOString() };
      save();
      log(`${name}: done (code ${code ?? signal}, ${Math.round(secs / 60)} min)`);
      resolve(code);
    });
  });
}

const STEPS = [
  ['words-quick', false, () => run('words-quick', 'node', ['terminal/test/sweep.mjs', '--json', join(dir, 'words-quick.json')], { minutes: 5 })],
  ['screens', true, async () => { for (const [c, r] of [[80, 24], [109, 55], [155, 43], [200, 60]]) await run(`screens-${c}x${r}`, 'node', ['terminal/scripts/capture-ui.mjs', '--out', join(dir, `screens-${c}x${r}.json`)], { env: { BONSAI_BIN: BIN, COLS: String(c), ROWS: String(r) }, minutes: 8 }); }],
  ['soak', true, () => run('soak', 'node', ['models/evals/soak.mjs', '--starts', '10', '--minutes', '35', '--out', join(dir, 'soak.json')], { minutes: 50 })],
  ['reread', true, () => run('reread', 'node', ['models/evals/reread.mjs', '--minutes', '15', '--out', join(dir, 'reread.json')], { minutes: 25 })],
  ['speed', true, () => run('speed', 'node', ['models/evals/speed.mjs', '--out', join(dir, 'speed.json')], { minutes: 80 })],
  ['words-real', true, () => run('words-real', 'node', ['models/evals/words/real.mjs', '--out', join(dir, 'words-real.json')], { minutes: 100 })],
  ['practice-off', true, () => run('practice-off', 'node', ['models/evals/run.mjs', '--think', 'off', '--reps', '2', '--out', join(dir, 'practice-off'), '--stop-at', stopAt], { minutes: 150 })],
  ['practice-medium', true, () => run('practice-medium', 'node', ['models/evals/run.mjs', '--think', 'on', '--effort', 'medium', '--reps', '2', '--out', join(dir, 'practice-medium'), '--stop-at', stopAt], { minutes: 180 })],
  ['practice-high', true, () => run('practice-high', 'node', ['models/evals/run.mjs', '--think', 'on', '--effort', 'high', '--reps', '1', '--out', join(dir, 'practice-high'), '--stop-at', stopAt], { minutes: 240 })],
];

log(`night check started; results in ${dir}; no new work after ${stopAt}`);
for (const [name, needsModel, go] of STEPS) {
  if (only && !only.includes(name)) continue;
  if (status.steps[name]?.code === 0) { log(`${name}: already done`); continue; }
  if (pastStop()) { log(`${name}: past ${stopAt}, not started`); status.steps[name] = { skipped: `past ${stopAt}` }; save(); continue; }
  if (needsModel && !(await modelFree(name))) { status.steps[name] = { skipped: 'another model was running' }; save(); continue; }
  try { await go(); } catch (e) { log(`${name}: ERROR ${e.message}`); status.steps[name] = { error: e.message }; save(); }
}
status.finished = new Date().toISOString();
save();
log('building the morning report');
await run('report', 'node', ['models/evals/night/report-night.mjs', dir], { minutes: 5 });
const report = join(root, 'models', 'bonsai-2-27b', 'reports', `bonsai-night-${day}.html`);
if (existsSync(report) && !args.includes('--no-open')) execFileSync('open', [report]);
log(`all done: ${report}`);
