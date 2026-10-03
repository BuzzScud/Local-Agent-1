// The Picture tokens test (▶ Run a test → Picture tokens, `/test picture tokens`):
// whether the model reads the text on a picture at the size the app gives its
// pictures (the add-on's minTokens: --image-min-tokens), and at the engine's own
// size for comparison. It starts the engine itself for each setting, with the
// app's own arguments, and asks through `coding -p --url` about four pictures of
// text drawn for the run. Pass: all four read right at the app's setting.
// Nothing in ~/.agentic-coder is written but this run's line in the test record.
//   node models/evals/tools/picture-tokens.mjs --model qwen [--out dir] [--no-record]
//   node models/evals/tools/picture-tokens.mjs --rebuild <a run's folder>: draws that run's page again
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { tmpdir, loadavg } from 'node:os';
import { MODELS, DEFAULT_MODEL, modelFolder, contextCheck, hasDraft, recordTest, codeLabel, withVision, visionPath, serverArgs, serverBinOf } from '../../index.mjs';
import { DOCS_DIR } from '../../../docs/tools/to-docs.mjs';
import { picturePage } from './picture-tokens-page.mjs';
import { BUN, CLI, options, pad, previousRun, rawOf, rebuildIfAsked, short, stampOf, writeResultsPage } from './check-kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // the repo
const args = process.argv.slice(2);
const { opt } = options(args);
const model = MODELS[opt('model', DEFAULT_MODEL)];
if (!model) { console.error(`no model "${opt('model')}"; one of: ${Object.keys(MODELS).join(', ')}`); process.exit(2); }
const CTX = 16_384;
// The pictures: black text on white, and what a right answer holds.
const PICTURES = [
  { file: 'hello.png', text: 'HELLO 42', want: [/HELLO/i, /\b42\b/] },
  { file: 'orbit.png', text: 'ORBIT 815', want: [/ORBIT/i, /\b815\b/] },
  { file: 'code.png', text: 'CODE 5519', size: { w: 1200, h: 500 }, want: [/CODE/i, /\b5519\b/] },
  { file: 'total.png', text: 'Total due: 1,240', size: { w: 900, h: 240 }, want: [/total/i, /1,?240/] },
];

const previous = (out, summary) => previousRun(out, summary, 'picture-tokens-');
const writePage = (out, rows, summary, prev) => writeResultsPage(picturePage, out, rows, summary, prev);

rebuildIfAsked(options(args), (dir, rows, summary) => writePage(dir, rows, summary, previous(dir, summary)));

if (!model.vision) { console.error(`${model.name} has no vision add-on`); process.exit(2); }
if (!existsSync(visionPath(model))) { console.error(`refused: ${model.name}'s vision add-on is not downloaded yet (${visionPath(model)}). Attach a picture in Agentic Coder once, or run coding setup, then try again.`); process.exit(4); }
const running = spawnSync('ps', ['-axwwo', 'command'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /^\/\S*llama-server\s/.test(l));
const big = Object.values(MODELS).filter((m) => running.some((l) => l.includes(`/${m.file} `)));
if (big.length) { console.error(`refused: ${big.map((m) => m.name).join(', ')} is loaded (one big model at a time). Quit Agentic Coder, run coding stop, then try again.`); process.exit(3); }
const vm = withVision(model);
for (let i = 0; i < 24 && !contextCheck(vm, CTX, { draft: hasDraft(model) }).fits; i++) { if (!i) console.log('waiting for memory to free up (up to 2 minutes)…'); await new Promise((r) => setTimeout(r, 5000)); }
const fit = contextCheck(vm, CTX, { draft: hasDraft(model) });
if (!fit.fits) { console.error(`refused: ${fit.note}`); process.exit(4); }
const portOpen = (port) => new Promise((ok) => { const s = createConnection({ port, host: '127.0.0.1' }); s.once('connect', () => { s.destroy(); ok(true); }); s.once('error', () => ok(false)); });
let PORT = Number(opt('port', 18240));
while (await portOpen(PORT)) PORT++;

const now = new Date();
const stamp = stampOf(now);
const out = opt('out') ?? join(modelFolder(model), 'results', `picture-tokens-${stamp}`);
mkdirSync(out, { recursive: true });

// A throwaway home (it builds its own helper) and project with the pictures.
const base = mkdtempSync(join(tmpdir(), 'agentic-picture-tokens-'));
const home = join(base, 'home'), proj = join(base, 'project');
for (const d of [home, proj]) mkdirSync(d, { recursive: true });
writeFileSync(join(home, 'trust.json'), JSON.stringify({ [proj]: new Date().toISOString() }));
// model: the one this run is for (coding -p asks as it would ask this model).
writeFileSync(join(home, 'settings.json'), JSON.stringify({ model: model.id, thinking: false, memory: false }));
const draw = spawnSync(BUN, ['-e', `const m = await import(${JSON.stringify(join(root, 'terminal', 'index.mjs'))}); for (const p of ${JSON.stringify(PICTURES)}) m.textImage(${JSON.stringify(proj)} + '/' + p.file, p.text, p.size);`], { cwd: root, env: { ...process.env, AGENTIC_HOME: home }, encoding: 'utf8', timeout: 300_000 });
if (draw.status !== 0) { console.error(`the pictures could not be drawn: ${draw.stderr.trim().split('\n').at(-1)}`); process.exit(1); }
const quiet = { AGENTIC_NO_UPDATE: '1', AGENTIC_MEMORY_SAVE: 'off', AGENTIC_NO_MEMORY: '1', AGENTIC_HELPERS: 'off', AGENTIC_NO_OPEN: '1', AGENTIC_HOME: home };

// The settings: the engine's own size (when the app sets another), then the app's.
const appArgs = serverArgs(vm, { ctx: CTX, port: PORT, draft: hasDraft(model) });
const minAt = appArgs.indexOf('--image-min-tokens');
const SETTINGS = [
  ...(minAt >= 0 ? [{ id: 'engine', label: 'the engine’s own size', args: appArgs.filter((_, i) => i !== minAt && i !== minAt + 1) }] : []),
  { id: 'app', label: minAt >= 0 ? `at least ${appArgs[minAt + 1]} tokens a picture` : 'the engine’s own size (the app sets none)', args: appArgs },
];

let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (stopping) process.exit(130); stopping = true; console.log('stopping: finishing the question under way…'); });
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const t0 = Date.now();
console.log(`${model.name} · ${PICTURES.length} pictures at ${SETTINGS.length} setting${SETTINGS.length === 1 ? '' : 's'} · port ${PORT}`);
try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}

const rows = [];
const per = {};
for (const st of SETTINGS) {
  if (stopping) break;
  const srv = spawn(serverBinOf(vm), st.args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  srv.stderr.on('data', (d) => { log += d; });
  const a = Date.now();
  let up = false;
  while (!up && Date.now() - a < 300_000 && srv.exitCode === null && !stopping) { try { up = (await fetch(`http://127.0.0.1:${PORT}/health`)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
  per[st.id] = { right: 0, tokens: [], secs: [], label: st.label };
  for (const p of PICTURES) {
    if (stopping) break;
    const before = log.length;
    const b = Date.now();
    const r = up ? spawnSync(BUN, [CLI, '-p', `What does the picture @${p.file} say? Reply with just the text on it.`, '--url', `http://127.0.0.1:${PORT}`, '--no-flows'], { cwd: proj, env: { ...process.env, ...quiet }, encoding: 'utf8', timeout: 180_000 }) : { status: null, stdout: '', stderr: 'the engine did not start' };
    const secs = (Date.now() - b) / 1000;
    const answer = r.stdout.trim();
    const ok = r.status === 0 && p.want.every((w) => w.test(answer));
    const evals = [...log.slice(before).matchAll(/prompt eval time =\s+[\d.]+ ms \/\s+(\d+) tokens/g)].map((x) => Number(x[1]));
    const tokens = evals.length ? evals.at(-1) : null;
    if (ok) per[st.id].right++;
    // The first question also carries the instructions (the server has not seen them yet): not a picture's count.
    if (tokens != null && evals.length === 1 && p !== PICTURES[0]) per[st.id].tokens.push(tokens);
    if (r.status === 0) per[st.id].secs.push(secs);
    rows.push({ id: `${st.id}-${p.file}`, name: `${p.text} · ${st.label}`, ok, detail: `answered ${JSON.stringify(short(answer, 60))}${tokens != null ? ` · ${tokens} tokens processed` : ''}${r.status ? ` · exit ${r.status}: ${short(r.stderr.trim().split('\n').at(-1))}` : ''}`, secs: Math.round(secs * 10) / 10 });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${p.text} · ${st.label} · ${short(answer, 60)} · ${tokens ?? '?'} tokens · ${secs.toFixed(1)} s`);
  }
  srv.kill('SIGTERM');
  await new Promise((r) => { if (srv.exitCode !== null) r(); else srv.once('exit', r); setTimeout(r, 10_000); });
}

const full = rows.length === PICTURES.length * SETTINGS.length;
const app = per.app ?? { right: 0, tokens: [], secs: [] };
const eng = per.engine ?? null;
const pass = full && app.right === PICTURES.length;
const code = codeLabel();
const secs = (Date.now() - t0) / 1000;
const look = args.includes('--no-record');
const docs = !look && existsSync(DOCS_DIR);
const summary = {
  model: model.id, name: model.name, code, started: new Date(t0).toISOString(), finished: new Date().toISOString(), secs,
  pictures: PICTURES.length, list: PICTURES.map((p) => p.text), passed: rows.filter((r) => r.ok).length, pass, stopped: stopping || !full,
  appLabel: SETTINGS.at(-1).label, appRight: app.right, appTokens: median(app.tokens), appSecs: median(app.secs),
  engineRight: eng ? eng.right : null, engineTokens: eng ? median(eng.tokens) : null, engineSecs: eng ? median(eng.secs) : null,
  load: Math.round(loadavg()[0] * 10) / 10,
  label: 'This run', sub: `${now.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} ${pad(now.getHours())}:${pad(now.getMinutes())} · ${code}`,
  page: docs ? `tests/agentic-coder-picture-tokens-${model.id}-${stamp}.html` : '',
};
writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
const prev = previous(out, summary);
if (look) console.log('a look only: no results page, no line in the test record');
else if (docs) { writePage(out, rows, summary, prev); console.log(`results page: ${summary.page}`); }
else console.log(`no results page: the DOCS folder is not here (${DOCS_DIR})`);
if (!look) recordTest({
  kind: 'other', name: 'Picture tokens', model: model.id, ctx: CTX, passed: app.right, total: PICTURES.length, secs, part: !full, bar: `all ${PICTURES.length} read right at the app's setting`,
  result: !full ? 'stopped' : pass ? 'pass' : 'fail',
  note: `At the app's setting (${summary.appLabel}): ${app.right} of ${PICTURES.length} read right, ≈${summary.appTokens ?? '?'} tokens a picture.${eng ? ` At the engine's own size: ${eng.right} of ${PICTURES.length}, ≈${summary.engineTokens ?? '?'} tokens.` : ''}`,
  raw: rawOf(out), page: summary.page,
});
console.log(`Picture tokens on ${model.name}: ${app.right} of ${PICTURES.length} at the app's setting${eng ? `, ${eng.right} of ${PICTURES.length} at the engine's own size` : ''} · ${pass ? 'PASSED' : full ? 'FAILED' : 'STOPPED'}`);
process.exit(pass ? 0 : 1);
