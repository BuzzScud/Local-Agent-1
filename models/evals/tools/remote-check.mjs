// The remote check (▶ Run a test → Remote check, `/test remote`): /remote and
// `coding serve` end to end with the real model, both on this Mac. `coding serve
// --local` starts the model behind a new key in a throwaway home (its engine and
// model files are the ones in ~/.agentic-coder, linked); Agentic Coder, from a
// second throwaway home, uses it as a remote the way /remote does: through the
// key, as llama.cpp and as an OpenAI-compatible server, for a plain answer and
// for a task that reads a file. A wrong key must be refused; a window on the
// serving machine must share the served model (no second copy); serve must stop
// cleanly. Nothing in ~/.agentic-coder is written but this run's line in the
// test record. Pass: all 11 checks.
// The SSH tunnel is not in it: it needs ssh into this Mac (Remote Login), which
// is usually off; its unit test uses a stand-in ssh (models/test/remote.test.mjs).
//   node models/evals/tools/remote-check.mjs --model gemma [--port 18080] [--out dir] [--no-record]
//   node models/evals/tools/remote-check.mjs --rebuild <a run's folder>: draws that run's page again
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { tmpdir, loadavg } from 'node:os';
import { MODELS, DEFAULT_MODEL, HOME, modelFolder, contextCheck, hasDraft, recordTest, codeLabel, connectRemote, probe } from '../../index.mjs';
import { DOCS_DIR, docsPath } from '../../../docs/tools/to-docs.mjs';
import { buildRemotePage } from './remote-page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // the repo
const CLI = join(root, 'terminal', 'src', 'cli.jsx');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const model = MODELS[opt('model', DEFAULT_MODEL)];
if (!model) { console.error(`no model "${opt('model')}"; one of: ${Object.keys(MODELS).join(', ')}`); process.exit(2); }
const CTX = 16_384;
const pad = (n) => String(n).padStart(2, '0');
export const CHECKS = 11;

// The run before this one on the same model, for the page's Before column.
function previous(out, summary) {
  let best = null;
  const beside = dirname(out);
  for (const d of readdirSync(beside)) {
    const dir = join(beside, d);
    if (!d.startsWith('remote-check-') || dir === out || !existsSync(join(dir, 'summary.json'))) continue;
    try {
      const s = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
      if (s.stopped || s.model !== summary.model || !(s.finished < summary.finished)) continue;
      if (!best || s.finished > best.s.finished) best = { s, rows: JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8')) };
    } catch { /* a folder being written: skipped */ }
  }
  return best;
}
function writePage(out, rows, summary, prev) {
  mkdirSync(dirname(docsPath(summary.page)), { recursive: true });
  writeFileSync(docsPath(summary.page), buildRemotePage({ summary, rows, prev, raw: [relative(root, out)] }));
}

if (args.includes('--rebuild')) {
  const dir = opt('rebuild');
  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  if (!summary.page) { console.error(`${dir} has no results page to draw again`); process.exit(2); }
  writePage(dir, JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8')), summary, previous(dir, summary));
  console.log(`results page drawn again: ${summary.page}`);
  process.exit(0);
}

// Refused while a big model is loaded: serve loads one more copy (one fits at a time).
const running = spawnSync('ps', ['-axwwo', 'command'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /^\/\S*llama-server\s/.test(l));
const big = Object.values(MODELS).filter((m) => running.some((l) => l.includes(`/${m.file} `)));
if (big.length) { console.error(`refused: ${big.map((m) => m.name).join(', ')} is loaded (one big model at a time). Quit Agentic Coder, run coding stop, then try again.`); process.exit(3); }
for (let i = 0; i < 24 && !contextCheck(model, CTX, { draft: hasDraft(model) }).fits; i++) { if (!i) console.log('waiting for memory to free up (up to 2 minutes)…'); await new Promise((r) => setTimeout(r, 5000)); }
const fit = contextCheck(model, CTX, { draft: hasDraft(model) });
if (!fit.fits) { console.error(`refused: ${fit.note}`); process.exit(4); }
const BUN = process.versions.bun ? process.execPath : [join(process.env.HOME ?? '', '.bun', 'bin', 'bun'), '/opt/homebrew/bin/bun', '/usr/local/bin/bun'].find((p) => existsSync(p)) ?? 'bun';

const portOpen = (port) => new Promise((ok) => { const s = createConnection({ port, host: '127.0.0.1' }); s.once('connect', () => { s.destroy(); ok(true); }); s.once('error', () => ok(false)); });
let PORT = Number(opt('port', 18080));
while (await portOpen(PORT)) PORT++;

const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const out = opt('out') ?? join(modelFolder(model), 'results', `remote-check-${stamp}`);
mkdirSync(out, { recursive: true });

// The two homes and a small project with a file to read.
const base = mkdtempSync(join(tmpdir(), 'agentic-remote-check-'));
const serveHome = join(base, 'serve-home'), clientHome = join(base, 'client-home'), proj = join(base, 'project');
for (const d of [serveHome, clientHome, proj]) mkdirSync(d, { recursive: true });
symlinkSync(join(HOME, 'engine'), join(serveHome, 'engine'));
symlinkSync(join(HOME, 'models'), join(serveHome, 'models'));
writeFileSync(join(proj, 'README.md'), '# Notes\n\nThe secret word is pineapple.\n');
for (const h of [serveHome, clientHome]) writeFileSync(join(h, 'trust.json'), JSON.stringify({ [proj]: new Date().toISOString() }));
const remoteSettings = (kind) => writeFileSync(join(clientHome, 'settings.json'), JSON.stringify({ thinking: false, memory: false, remote: { use: true, address: '127.0.0.1', port: PORT, connect: 'http', kind, model: '', context: 0, key: true, keyEnd: '' } }));
const quiet = { AGENTIC_NO_UPDATE: '1', AGENTIC_MEMORY_SAVE: 'off', AGENTIC_NO_MEMORY: '1', AGENTIC_HELPERS: 'off', AGENTIC_NO_OPEN: '1' };

// `coding -p` as you would run it, in a home; answers { code, out, err, secs }.
function codingP(home, prompt, env = {}, ms = 240_000) {
  return new Promise((ok) => {
    const t = Date.now();
    const p = spawn(BUN, [CLI, '-p', prompt, '--no-flows', '--effort', 'low'], { cwd: proj, env: { ...process.env, ...quiet, AGENTIC_HOME: home, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '', e = '';
    p.stdout.on('data', (d) => { o += d; });
    p.stderr.on('data', (d) => { e += d; });
    const timer = setTimeout(() => p.kill('SIGTERM'), ms);
    p.on('exit', (code) => { clearTimeout(timer); ok({ code, out: o.trim(), err: e.trim(), secs: (Date.now() - t) / 1000 }); });
  });
}
// The model servers running on this run's model files: { pid, cmd }.
const servers = () => spawnSync('ps', ['-axwwo', 'pid=,command='], { encoding: 'utf8' }).stdout.split('\n').map((l) => /^\s*(\d+)\s+(.*)$/.exec(l)).filter((m) => m && /llama-server\s/.test(m[2]) && m[2].includes(join(serveHome, 'models'))).map((m) => ({ pid: Number(m[1]), cmd: m[2] }));
const short = (s, n = 90) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (stopping) process.exit(130); stopping = true; console.log('stopping: finishing the check under way, then serve stops…'); });

const rows = [];
async function check(id, name, fn, { always = false } = {}) {
  if (stopping && !always) return false;
  const a = Date.now();
  let ok = false, detail = '';
  try { ({ ok, detail } = await fn()); } catch (e) { ok = false; detail = e.message; }
  const secs = (Date.now() - a) / 1000;
  rows.push({ id, name, ok: Boolean(ok), detail: short(detail, 240), secs: Math.round(secs * 10) / 10 });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} · ${short(detail, 120)} · ${secs.toFixed(1)} s`);
  return ok;
}

const t0 = Date.now();
console.log(`${model.name} · ${CHECKS} checks of /remote and coding serve on this Mac (port ${PORT}) · loading the model…`);
try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}
let serve = null, serveOut = '', key = null, loadSecs = null;
const up = await check('serve', 'coding serve starts behind a new key', async () => {
  serve = spawn(BUN, [CLI, 'serve', '--local', '--port', String(PORT), '--ctx', '16k', '--model', model.id], { cwd: proj, env: { ...process.env, ...quiet, AGENTIC_HOME: serveHome }, stdio: ['ignore', 'pipe', 'pipe'] });
  serve.stdout.on('data', (d) => { serveOut += d; });
  serve.stderr.on('data', (d) => { serveOut += d; });
  let exited = null;
  serve.on('exit', (c) => { exited = c; });
  const a = Date.now();
  while (!serveOut.includes('ctrl+c stops it') && exited === null && Date.now() - a < 300_000 && !stopping) await new Promise((r) => setTimeout(r, 500));
  if (!serveOut.includes('ctrl+c stops it')) return { ok: false, detail: exited !== null ? `it stopped: ${short(serveOut.split('\n').filter(Boolean).at(-1))}` : 'not loaded in 5 minutes' };
  loadSecs = (Date.now() - a) / 1000;
  key = readFileSync(join(serveHome, 'serve.key'), 'utf8').split('\n')[0].trim();
  const mode = statSync(join(serveHome, 'serve.key')).mode & 0o777;
  const printed = serveOut.includes(key) && serveOut.includes('SSH tunnel');
  return { ok: mode === 0o600 && printed && /^ac-/.test(key), detail: `loaded in ${Math.round(loadSecs)} s · key file ${mode.toString(8)} · it printed the form’s values` };
});
const url = `http://127.0.0.1:${PORT}`;
const profile = (kind) => ({ use: true, address: '127.0.0.1', port: PORT, connect: 'http', kind, model: '', context: 0, key: true, keyEnd: '' });
let answerSecs = [];
if (up) {
  await check('key', 'only /health answers without the key', async () => {
    const code = async (path, k) => (await fetch(`${url}${path}`, { headers: k ? { authorization: `Bearer ${k}` } : {} })).status;
    const [h, p0, p1, bad] = [await code('/health'), await code('/props'), await code('/props', key), await code('/props', 'ac-wrong')];
    return { ok: h === 200 && p0 === 401 && p1 === 200 && bad === 401, detail: `/health ${h} · /props ${p0} without the key, ${bad} with a wrong one, ${p1} with it` };
  });
  await check('connect', 'it connects as a remote, as /remote does', async () => {
    const c = await connectRemote(profile('llama'), { key });
    c.stop();
    return { ok: c.model.base === model.id && c.ctx >= CTX && c.slots >= 1, detail: `${c.model.name} · ${Math.round(c.ctx / 1024)}k · ${c.slots} slot${c.slots === 1 ? '' : 's'} · ${c.info.ms} ms` };
  });
  await check('test', '/remote’s Test: reached, key taken, one word back', async () => {
    const r = await probe({ url, kind: 'llama', key, reply: true, timeoutMs: 20_000 });
    return { ok: r.ok, detail: r.steps.map((s) => s.text).join(' · ') };
  });
  const ask = async (kind, prompt, want) => {
    remoteSettings(kind);
    const r = await codingP(clientHome, prompt, { AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: key });
    const via = /On the remote model: /.test(r.err);
    if (r.code === 0 && via) answerSecs.push(r.secs);
    return { ok: r.code === 0 && via && want.test(r.out), detail: `${via ? 'on the remote' : 'NOT on the remote'} · answered ${JSON.stringify(short(r.out, 60))} in ${r.secs.toFixed(1)} s${r.code ? ` · exit ${r.code}: ${short(r.err.split('\n').at(-1))}` : ''}` };
  };
  await check('answer-llama', 'a real answer through the key (llama.cpp)', () => ask('llama', 'What is 6 times 7? Reply with just the number.', /\b42\b/));
  await check('answer-openai', 'a real answer as an OpenAI-compatible server', () => ask('openai', 'What is 6 times 7? Reply with just the number.', /\b42\b/));
  await check('read-llama', 'a task that reads a file (llama.cpp)', () => ask('llama', 'What is the secret word in README.md? Reply with just the word.', /pineapple/i));
  await check('read-openai', 'a task that reads a file (OpenAI-compatible)', () => ask('openai', 'What is the secret word in README.md? Reply with just the word.', /pineapple/i));
  await check('wrong-key', 'a wrong key is refused, and it says so', async () => {
    remoteSettings('llama');
    const r = await codingP(clientHome, 'hi', { AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: 'ac-not-the-key-0000000000' }, 60_000);
    return { ok: r.code !== 0 && /API key was not accepted/.test(r.err) && !r.out, detail: `exit ${r.code} · ${short(r.err.split('\n').at(-1), 110)}` };
  });
  await check('share', 'a window on the serving Mac shares it (no second copy)', async () => {
    const r = await codingP(serveHome, 'What is 5 plus 4? Reply with just the number.');
    const copies = servers().length;
    return { ok: r.code === 0 && /\b9\b/.test(r.out) && copies === 1, detail: `answered ${JSON.stringify(short(r.out, 40))} in ${r.secs.toFixed(1)} s · ${copies} copy of the model running` };
  });
}
await check('stop', 'coding serve stops cleanly', async () => {
  if (!serve || serve.exitCode !== null) return { ok: false, detail: 'it was not running' };
  const gone = new Promise((r) => serve.once('exit', r));
  serve.kill('SIGINT');
  await Promise.race([gone, new Promise((r) => setTimeout(r, 20_000))]);
  await new Promise((r) => setTimeout(r, 1000));
  const left = servers().length;
  const reg = existsSync(join(serveHome, 'servers')) ? readdirSync(join(serveHome, 'servers')).filter((f) => f.endsWith('.json')).length : 0;
  return { ok: serve.exitCode !== null && left === 0 && reg === 0, detail: `serve ${serve.exitCode !== null ? 'ended' : 'still running'} · ${left} model server${left === 1 ? '' : 's'} left · ${reg} registry file${reg === 1 ? '' : 's'} left` };
}, { always: true });
// Whatever happened, nothing of this run keeps running.
if (serve && serve.exitCode === null) serve.kill('SIGKILL');
for (const { pid } of servers()) { try { process.kill(pid, 'SIGTERM'); } catch {} }
// The key never goes into the results.
writeFileSync(join(out, 'serve.out'), key ? serveOut.split(key).join('ac-<the key>') : serveOut);

const passed = rows.filter((r) => r.ok).length;
const full = rows.length === CHECKS;
const pass = full && passed === CHECKS;
const code = codeLabel();
const secs = (Date.now() - t0) / 1000;
const look = args.includes('--no-record');
const docs = !look && existsSync(DOCS_DIR);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const summary = {
  model: model.id, name: model.name, code, started: new Date(t0).toISOString(), finished: new Date().toISOString(), secs,
  checks: rows.length, of: CHECKS, passed, pass, stopped: stopping || !full, loadSecs, answerSecs: median(answerSecs), port: PORT,
  load: Math.round(loadavg()[0] * 10) / 10,
  label: 'This run', sub: `${now.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} ${pad(now.getHours())}:${pad(now.getMinutes())} · ${code}`,
  page: docs ? `tests/agentic-coder-remote-check-${model.id}-${stamp}.html` : '',
};
writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
const prev = previous(out, summary);
if (look) console.log('a look only: no results page, no line in the test record');
else if (docs) { writePage(out, rows, summary, prev); console.log(`results page: ${summary.page}`); }
else console.log(`no results page: the DOCS folder is not here (${DOCS_DIR})`);
if (!look) recordTest({
  kind: 'other', name: 'Remote check', model: model.id, ctx: CTX, passed, total: CHECKS, secs, part: !full, bar: `all ${CHECKS} checks`,
  result: !full ? 'stopped' : pass ? 'pass' : 'fail',
  note: `${passed} of ${CHECKS} checks of /remote and coding serve; loaded in ${loadSecs ? Math.round(loadSecs) : '?'} s; a coding -p answer through the remote in ${summary.answerSecs ? summary.answerSecs.toFixed(1) : '?'} s (median).${rows.filter((r) => !r.ok).map((r) => ` Failed: ${r.name} (${r.detail}).`).join('')}`,
  raw: relative(root, out), page: summary.page,
});
console.log(`Remote check on ${model.name}: ${passed} of ${CHECKS} · ${pass ? 'PASSED' : full ? 'FAILED' : 'STOPPED'}`);
process.exit(pass ? 0 : 1);
