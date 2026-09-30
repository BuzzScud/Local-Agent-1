// The vision check (▶ Run a test → Vision check, `/test vision`): pictures and
// PDFs with the real model and its vision add-on, on this Mac. It runs in a
// throwaway home whose engine and model files are links to the ones in
// ~/.agentic-coder (the add-on too), in a small project with pictures of text
// the model cannot guess, a PDF with its text, and a scanned page (a PDF that is
// only a picture). It asks through `coding -p` the way you would: @hello.png, a
// picture dragged in from another folder (its path, spaces escaped), @invoice.pdf,
// a picture the model has to Read by itself, and the scan it has to look at page
// by page. Then without the add-on (a second home without that file): it must
// say so and send the words alone. Last, the real window in a pseudo-terminal:
// the first picture turns the model's vision on (a reload), and it answers.
// Nothing in ~/.agentic-coder is written but this run's line in the test record.
// Pass: all 8 checks.
//   node models/evals/tools/vision-check.mjs --model qwen [--out dir] [--no-record]
//   node models/evals/tools/vision-check.mjs --rebuild <a run's folder>: draws that run's page again
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir, loadavg, homedir } from 'node:os';
import { MODELS, DEFAULT_MODEL, HOME, modelFolder, contextCheck, hasDraft, recordTest, codeLabel, withVision, visionPath } from '../../index.mjs';
import { runInPty } from '../../../terminal/index.mjs';
import { DOCS_DIR, docsPath } from '../../../docs/tools/to-docs.mjs';
import { visionPage } from './vision-page.mjs';
import { sec } from './check-page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // the repo
const CLI = join(root, 'terminal', 'src', 'cli.jsx');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const model = MODELS[opt('model', DEFAULT_MODEL)];
if (!model) { console.error(`no model "${opt('model')}"; one of: ${Object.keys(MODELS).join(', ')}`); process.exit(2); }
const CTX = 16_384;
const pad = (n) => String(n).padStart(2, '0');
export const CHECKS = 8;

// The run before this one on the same model, for the page's Before column.
function previous(out, summary) {
  let best = null;
  const beside = dirname(out);
  for (const d of readdirSync(beside)) {
    const dir = join(beside, d);
    if (!d.startsWith('vision-check-') || dir === out || !existsSync(join(dir, 'summary.json'))) continue;
    try {
      const s = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
      if (s.stopped || s.model !== summary.model || !(s.finished < summary.finished)) continue;
      if (!best || s.finished > best.s.finished) best = { s, rows: JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8')) };
    } catch { /* a folder being written: skipped */ }
  }
  return best;
}
// Where a run's raw results are, for the page and the record, from the top of the repo (also for
// an --out into another working copy's models/<model>/results, as from a worktree).
const rawOf = (dir) => (dir.startsWith(`${root}/`) ? relative(root, dir) : /\/(models\/[^/]+\/results\/.+)$/.exec(dir)?.[1] ?? dir.replace(homedir(), '~'));
function writePage(out, rows, summary, prev) {
  mkdirSync(dirname(docsPath(summary.page)), { recursive: true });
  writeFileSync(docsPath(summary.page), visionPage({ summary, rows, prev, raw: [rawOf(out)] }));
}

if (args.includes('--rebuild')) {
  const dir = opt('rebuild');
  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  if (!summary.page) { console.error(`${dir} has no results page to draw again`); process.exit(2); }
  writePage(dir, JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8')), summary, previous(dir, summary));
  console.log(`results page drawn again: ${summary.page}`);
  process.exit(0);
}

// The add-on must be here (the app downloads it at the first picture; coding setup does too).
if (!model.vision) { console.error(`${model.name} has no vision add-on`); process.exit(2); }
if (!existsSync(visionPath(model))) { console.error(`refused: ${model.name}'s vision add-on is not downloaded yet (${visionPath(model)}). Attach a picture in Agentic Coder once, or run coding setup, then try again.`); process.exit(4); }
// Refused while a big model is loaded: each question loads one more copy (one fits at a time).
const running = spawnSync('ps', ['-axwwo', 'command'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /^\/\S*llama-server\s/.test(l));
const big = Object.values(MODELS).filter((m) => running.some((l) => l.includes(`/${m.file} `)));
if (big.length) { console.error(`refused: ${big.map((m) => m.name).join(', ')} is loaded (one big model at a time). Quit Agentic Coder, run coding stop, then try again.`); process.exit(3); }
for (let i = 0; i < 24 && !contextCheck(withVision(model), CTX, { draft: hasDraft(model) }).fits; i++) { if (!i) console.log('waiting for memory to free up (up to 2 minutes)…'); await new Promise((r) => setTimeout(r, 5000)); }
const fit = contextCheck(withVision(model), CTX, { draft: hasDraft(model) });
if (!fit.fits) { console.error(`refused: ${fit.note}`); process.exit(4); }
const BUN = process.versions.bun ? process.execPath : [join(process.env.HOME ?? '', '.bun', 'bin', 'bun'), '/opt/homebrew/bin/bun', '/usr/local/bin/bun'].find((p) => existsSync(p)) ?? 'bun';

const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const out = opt('out') ?? join(modelFolder(model), 'results', `vision-check-${stamp}`);
mkdirSync(out, { recursive: true });

// Home A has every model file (the add-on too), home B all but the add-on; each builds its own helper.
const base = mkdtempSync(join(tmpdir(), 'agentic-vision-check-'));
const homeA = join(base, 'home-a'), homeB = join(base, 'home-b'), proj = join(base, 'project'), other = join(base, 'Desktop copy');
for (const d of [homeA, homeB, join(homeB, 'models'), proj, other]) mkdirSync(d, { recursive: true });
symlinkSync(join(HOME, 'engine'), join(homeA, 'engine'));
symlinkSync(join(HOME, 'models'), join(homeA, 'models'));
symlinkSync(join(HOME, 'engine'), join(homeB, 'engine'));
const addOns = new Set(Object.values(MODELS).map((m) => m.vision?.file).filter(Boolean));
for (const f of readdirSync(join(HOME, 'models'))) if (!addOns.has(f)) symlinkSync(join(HOME, 'models', f), join(homeB, 'models', f));
for (const h of [homeA, homeB]) {
  writeFileSync(join(h, 'trust.json'), JSON.stringify({ [proj]: new Date().toISOString() }));
  // model: the one this run is for (coding -p and the window use the saved model).
  writeFileSync(join(h, 'settings.json'), JSON.stringify({ model: model.id, thinking: false, memory: false }));
}
const dragged = join(other, 'my shot 1.png');
const quiet = { AGENTIC_NO_UPDATE: '1', AGENTIC_MEMORY_SAVE: 'off', AGENTIC_NO_MEMORY: '1', AGENTIC_HELPERS: 'off', AGENTIC_NO_OPEN: '1' };

// The model servers running in a home of this run: { pid, cmd }.
const servers = (home = base) => spawnSync('ps', ['-axwwo', 'pid=,command='], { encoding: 'utf8' }).stdout.split('\n').map((l) => /^\s*(\d+)\s+(.*)$/.exec(l)).filter((m) => m && /llama-server\s/.test(m[2]) && m[2].includes(home)).map((m) => ({ pid: Number(m[1]), cmd: m[2] }));
// `coding -p` as you would run it, in a home; answers { code, out, err, secs, mmproj }
// (mmproj: whether the model server it started had the vision add-on).
function codingP(home, prompt, ms = 300_000) {
  return new Promise((ok) => {
    const t = Date.now();
    const p = spawn(BUN, [CLI, '-p', prompt, '--no-flows'], { cwd: proj, env: { ...process.env, ...quiet, AGENTIC_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '', e = '', mmproj = null, file = null;
    p.stdout.on('data', (d) => { o += d; });
    p.stderr.on('data', (d) => { e += d; });
    const look = setInterval(() => { const s = servers(home); if (s.length) { mmproj = mmproj || s.some((x) => x.cmd.includes('--mmproj')); file ??= Object.values(MODELS).find((m) => s[0].cmd.includes(`/${m.file} `))?.id ?? null; } }, 500);
    const timer = setTimeout(() => p.kill('SIGTERM'), ms);
    p.on('exit', (code) => { clearTimeout(timer); clearInterval(look); ok({ code, out: o.trim(), err: e.trim(), secs: (Date.now() - t) / 1000, mmproj, ran: file }); });
  });
}
const short = (s, n = 90) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const tools = (err) => err.split('\n').filter((l) => /^[⏺✗] /.test(l)).map((l) => l.slice(2));
const said = (r) => `answered ${JSON.stringify(short(r.out, 70))} in ${r.secs.toFixed(1)} s${r.code ? ` · exit ${r.code}: ${short(r.err.split('\n').at(-1))}` : ''}`;

let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (stopping) process.exit(130); stopping = true; console.log('stopping: finishing the check under way…'); });

const rows = [];
async function check(id, name, fn) {
  if (stopping) return false;
  const a = Date.now();
  let ok = false, detail = '';
  try { ({ ok, detail } = await fn()); } catch (e) { ok = false; detail = e.message; }
  const secs = (Date.now() - a) / 1000;
  rows.push({ id, name, ok: Boolean(ok), detail: short(detail, 260), secs: Math.round(secs * 10) / 10 });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} · ${short(detail, 130)} · ${secs.toFixed(1)} s`);
  return ok;
}

const t0 = Date.now();
console.log(`${model.name} · ${CHECKS} checks of pictures and PDFs on this Mac, with its vision add-on…`);
try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}
let firstSecs = null, reloadSecs = null;

// 1. The helper, built in a fresh home the way the app builds it on first use, draws this run's files.
const drawn = await check('helper', 'the picture and PDF helper builds and draws the files', async () => {
  const script = `
    const m = await import(${JSON.stringify(join(root, 'terminal', 'index.mjs'))});
    const t = Date.now(); m.mediaTool(); const buildSecs = (Date.now() - t) / 1000;
    const p = ${JSON.stringify(proj)};
    m.textImage(p + '/hello.png', 'HELLO 42');
    m.textImage(${JSON.stringify(dragged)}, 'ORBIT 815');
    m.textImage(p + '/note.png', 'WIDTH 64');
    m.textPdf(p + '/invoice.pdf', ['Invoice 7731\\nTotal due: 1,240 dollars', 'Terms: pay within 30 days.']);
    m.textImage(${JSON.stringify(join(base, 'scan.png'))}, 'CODE 5519', { w: 1200, h: 500 });
    const s = Bun.spawnSync(['/usr/bin/sips', '-s', 'format', 'pdf', ${JSON.stringify(join(base, 'scan.png'))}, '--out', p + '/scan.pdf']);
    console.log(JSON.stringify({ buildSecs, sips: s.exitCode, scan: s.exitCode === 0 ? m.pdfText(p + '/scan.pdf') : null, invoice: m.pdfText(p + '/invoice.pdf').length }));`;
  const r = spawnSync(BUN, ['-e', script], { cwd: root, env: { ...process.env, AGENTIC_HOME: homeA }, encoding: 'utf8', timeout: 300_000 });
  const j = JSON.parse(r.stdout.trim().split('\n').at(-1) || '{}');
  const built = readdirSync(join(homeA, 'tools')).filter((f) => f.startsWith('media-'));
  const files = ['hello.png', 'note.png', 'invoice.pdf', 'scan.pdf'].every((f) => existsSync(join(proj, f))) && existsSync(dragged);
  return { ok: r.status === 0 && built.length === 1 && files && j.invoice === 2 && j.scan?.length === 1 && !j.scan[0].trim(), detail: `built with the Mac’s Swift in ${j.buildSecs?.toFixed(1)} s · 3 pictures, invoice.pdf (${j.invoice} pages of text), scan.pdf (${j.scan?.length} page, ${j.scan?.[0]?.trim() ? 'with text!' : 'no text: a picture only'})${r.status ? ` · ${short(r.stderr, 120)}` : ''}` };
});

if (drawn) {
  await check('look', '@hello.png: the model loads with its add-on and reads it', async () => {
    const r = await codingP(homeA, 'What does the picture @hello.png say? Reply with just the text on it.');
    firstSecs = r.secs;
    return { ok: r.code === 0 && r.ran === model.id && r.mmproj === true && /HELLO\s*42/i.test(r.out), detail: `${r.ran === model.id ? model.name : `NOT ${model.name} (${r.ran ?? 'no model seen'})`} loaded ${r.mmproj ? 'with the vision add-on' : 'WITHOUT the add-on'} · ${said(r)}` };
  });
  await check('dragged', 'a picture dragged in from another folder (its full path, spaces escaped)', async () => {
    const r = await codingP(homeA, `What word and number are in this picture? ${dragged.replace(/([ ()])/g, '\\$1')} Reply with just them.`);
    return { ok: r.code === 0 && /ORBIT/i.test(r.out) && /815/.test(r.out), detail: said(r) };
  });
  await check('pdf', '@invoice.pdf: the total due, from its text', async () => {
    const r = await codingP(homeA, 'What is the total due in @invoice.pdf? Reply with just the amount.');
    return { ok: r.code === 0 && /1,?240/.test(r.out), detail: said(r) };
  });
  await check('read', 'a picture the model looks at by itself (Read)', async () => {
    const r = await codingP(homeA, 'There is a picture called note.png in this folder. Look at it and tell me the number written on it. Reply with just the number.');
    const used = tools(r.err);
    const read = used.some((u) => /^Read\(.*note\.png/.test(u));
    return { ok: r.code === 0 && read && /\b64\b/.test(r.out), detail: `tools: ${used.join(', ') || 'none'} · ${said(r)}` };
  });
  await check('scan', 'a scanned PDF: no text, so it looks at the page', async () => {
    const r = await codingP(homeA, 'What code is written in scan.pdf? Reply with just the code.');
    const used = tools(r.err);
    return { ok: r.code === 0 && used.some((u) => /^Read\(.*scan\.pdf/.test(u)) && /5519/.test(r.out), detail: `tools: ${used.join(', ') || 'none'} · ${said(r)}` };
  });
  await check('blind', 'without the add-on: it says so, and the words go alone', async () => {
    const r = await codingP(homeB, 'What does the picture @hello.png say? Reply with just the text on it.');
    const note = /vision add-on is not here/.test(r.err);
    return { ok: r.code === 0 && note && r.mmproj === false && !/HELLO\s*42/i.test(r.out), detail: `${note ? 'it said the add-on is not here' : 'NO note'} · ${said(r)}` };
  });
  await check('window', 'the window: the first picture turns vision on, then it answers', async () => {
    let a = 0, b = 0;
    const logFile = join(homeA, 'logs', 'server.log');
    const logAt = existsSync(logFile) ? readFileSync(logFile, 'utf8').length : 0;
    const r = await runInPty({ cwd: proj, env: { ...quiet, AGENTIC_HOME: homeA }, args: ['--no-flows'], timeoutMs: 600_000, steps: [
      { wait: '? for shortcuts', ms: 60_000 }, { waitGone: `Starting ${model.name}`, ms: 240_000 }, { sleep: 500 },
      { type: 'What does the picture @hello.png say? Reply with just the text on it.' }, { sleep: 300 }, { fn: () => { a = Date.now(); } }, { key: 'enter' },
      { wait: `Turning on ${model.name}'s vision`, ms: 30_000 }, { wait: `${model.name} can look at pictures now`, ms: 240_000 }, { fn: () => { b = Date.now(); } },
      { wait: 'HELLO 42', ms: 240_000 }, { sleep: 500 }, { snapshot: 'answer' },
      { sleep: 300 }, { key: 'ctrlC' }, { sleep: 200 }, { key: 'ctrlC' },
    ] });
    reloadSecs = b && a ? (b - a) / 1000 : null;
    // Its model server's log: started without the add-on, then again with it (the server may be gone by now).
    const starts = (existsSync(logFile) ? readFileSync(logFile, 'utf8').slice(logAt) : '').split(/^=== /m).filter((x) => / start /.test(x.split('\n')[0]));
    const reloaded = starts.length >= 2 && !/loaded multimodal model/.test(starts[0]) && /loaded multimodal model/.test(starts.at(-1));
    const answered = /HELLO 42/.test(r.snapshots.answer ?? '');
    return { ok: reloaded && answered, detail: `vision on in ${sec(reloadSecs)} · the model started ${starts.length} time${starts.length === 1 ? '' : 's'}: ${reloaded ? 'without the add-on, then with it' : 'NOT reloaded with the add-on'} · ${answered ? 'it answered HELLO 42' : 'no HELLO 42 on screen'}` };
  });
}
// Whatever happened, nothing of this run keeps running (the window keeps its model loaded after it quits).
for (const { pid } of servers()) { try { process.kill(pid, 'SIGTERM'); } catch {} }

const passed = rows.filter((r) => r.ok).length;
const full = rows.length === CHECKS;
const pass = full && passed === CHECKS;
const code = codeLabel();
const secs = (Date.now() - t0) / 1000;
const look = args.includes('--no-record');
const docs = !look && existsSync(DOCS_DIR);
const summary = {
  model: model.id, name: model.name, code, started: new Date(t0).toISOString(), finished: new Date().toISOString(), secs,
  checks: rows.length, of: CHECKS, passed, pass, stopped: stopping || !full, firstSecs, reloadSecs,
  addOn: `${model.vision.file}, ${(model.vision.bytes / 1e9).toFixed(2)} GB`, minTokens: model.vision.minTokens ?? null, load: Math.round(loadavg()[0] * 10) / 10,
  label: 'This run', sub: `${now.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} ${pad(now.getHours())}:${pad(now.getMinutes())} · ${code}`,
  page: docs ? `tests/agentic-coder-vision-check-${model.id}-${stamp}.html` : '',
};
writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
const prev = previous(out, summary);
if (look) console.log('a look only: no results page, no line in the test record');
else if (docs) { writePage(out, rows, summary, prev); console.log(`results page: ${summary.page}`); }
else console.log(`no results page: the DOCS folder is not here (${DOCS_DIR})`);
if (!look) recordTest({
  kind: 'other', name: 'Vision check', model: model.id, ctx: CTX, passed, total: CHECKS, secs, part: !full, bar: `all ${CHECKS} checks`,
  result: !full ? 'stopped' : pass ? 'pass' : 'fail',
  note: `${passed} of ${CHECKS} checks of pictures and PDFs with the vision add-on; the first picture in ${firstSecs ? firstSecs.toFixed(1) : '?'} s (loading included); vision on in the window in ${reloadSecs ? reloadSecs.toFixed(1) : '?'} s.${rows.filter((r) => !r.ok).map((r) => ` Failed: ${r.name} (${r.detail}).`).join('')}`,
  raw: rawOf(out), page: summary.page,
});
console.log(`Vision check on ${model.name}: ${passed} of ${CHECKS} · ${pass ? 'PASSED' : full ? 'FAILED' : 'STOPPED'}`);
process.exit(pass ? 0 : 1);
