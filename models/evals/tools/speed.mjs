// Speed-up candidates, measured against today's settings (report only;
// nothing is changed). Real model, one thing at a time:
//  1. llama-bench: reading (pp512, pp2048) and writing (tg128) for batch
//     sizes, flash attention on/off, an 8-bit vs a full-size (f16) cache.
//  2. Re-reading per conversation turn: the server keeps checkpoints every
//     batch (512 tokens), so each turn re-reads up to ~500 tokens (~9 s).
//     Smaller batches: less re-reading, maybe slower reading.
//  3. The smaller model file (PTQ1_0, 5.95 GB): only when there is disk room;
//     downloaded, checked, measured, deleted.
//   node models/evals/tools/speed.mjs [--skip-ptq1] [--quick] [--out file.json]   (--quick: one setting of each, for a trial)
import { spawnSync, spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, statfsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, DEFAULT_MODEL, MODELS_DIR, modelPath, SERVER_BIN, modelFolder } from '../../index.mjs';
import { serverArgs } from '../../index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // the repo
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const model = MODELS[DEFAULT_MODEL];
const BENCH = join(dirname(SERVER_BIN), 'llama-bench'); // built beside the server, see models/runtime/engine
const out = { at: new Date().toISOString(), bench: [], reread: [], ptq1: null };
const log = (s) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${s}`);

function bench(file, extra, label) {
  const a = ['-m', file, '-ngl', '99', '-p', '512,2048', '-n', '128', '-r', '2', '-o', 'json', ...extra];
  const r = spawnSync(BENCH, a, { encoding: 'utf8', timeout: 30 * 60_000, maxBuffer: 64 << 20 });
  let rows = [];
  try { rows = JSON.parse(r.stdout.slice(r.stdout.indexOf('['))); } catch { out.bench.push({ label, error: (r.stderr || r.stdout).slice(-300) }); return; }
  for (const x of rows) {
    const test = x.n_gen ? `tg${x.n_gen}` : `pp${x.n_prompt}`;
    out.bench.push({ label, test, tps: Math.round(x.avg_ts * 10) / 10, ub: x.n_ubatch, fa: x.flash_attn, k: x.type_k, v: x.type_v });
  }
  log(`${label}: ${rows.map((x) => `${x.n_gen ? `tg${x.n_gen}` : `pp${x.n_prompt}`} ${Math.round(x.avg_ts * 10) / 10}`).join(' · ')}`);
}

// 1. llama-bench, one change at a time from today's settings
const file = modelPath(model);
bench(file, ['-fa', '1', '-ctk', 'q8_0', '-ctv', 'q8_0', '-ub', '512'], 'today (batch 512, flash on, 8-bit cache)');
const quick = args.includes('--quick');
if (!quick) for (const ub of ['128', '256', '1024', '2048']) bench(file, ['-fa', '1', '-ctk', 'q8_0', '-ctv', 'q8_0', '-ub', ub, '-b', String(Math.max(2048, Number(ub)))], `batch ${ub}`);
if (!quick) bench(file, ['-fa', '0', '-ctk', 'f16', '-ctv', 'f16', '-ub', '512'], 'flash attention off (needs an f16 cache)');
if (!quick) bench(file, ['-fa', '1', '-ctk', 'f16', '-ctv', 'f16', '-ub', '512'], 'full-size (f16) cache');

// 2. Re-reading per turn, by batch size (checkpoints come once per batch)
const PORT = 17655;
const post = async (path, body) => { const t0 = Date.now(); const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); return { secs: (Date.now() - t0) / 1000, n: j.timings?.prompt_n, j }; };
const big = readFileSync(join(root, 'terminal', 'src', 'flows', 'change.mjs'), 'utf8').slice(0, 9000);
for (const ub of quick ? [256] : [128, 256, 512]) {
  const a = [...serverArgs(model, { ctx: 32768, port: PORT }), '-ub', String(ub)];
  const srv = spawn(SERVER_BIN, a, { stdio: 'ignore' });
  try {
    for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
    const msgs = [{ role: 'system', content: 'You are a careful programmer.' }, { role: 'user', content: `Here is a file:\n\`\`\`js\n${big}\n\`\`\`\nSay "ok".` }];
    const first = await post('/v1/chat/completions', { messages: msgs, max_tokens: 4, temperature: 0, id_slot: 0, chat_template_kwargs: { enable_thinking: false } });
    const turns = [];
    for (let t = 1; t <= 4; t++) {
      msgs.push({ role: 'assistant', content: first.j.choices?.[0]?.message?.content ?? 'ok' }, { role: 'user', content: `Question ${t}: name one function in the file.` });
      const r = await post('/v1/chat/completions', { messages: msgs, max_tokens: 12, temperature: 0, id_slot: 0, chat_template_kwargs: { enable_thinking: false } });
      turns.push({ reread: r.n, secs: r.secs });
    }
    const fp = (() => { try { const t = execFileSync('footprint', ['-p', String(srv.pid)], { encoding: 'utf8' }); return Number(/phys_footprint:\s*([\d.]+)\s*MB/.exec(t)?.[1] ?? 0) / 1000; } catch { return null; } })();
    out.reread.push({ ub, firstTokens: first.n, firstSecs: first.secs, turns, avgReread: Math.round(turns.reduce((s, t) => s + t.reread, 0) / turns.length), avgSecs: Math.round(turns.reduce((s, t) => s + t.secs, 0) / turns.length * 10) / 10, serverGb: fp });
    log(`batch ${ub}: first read ${first.n} tokens in ${first.secs}s; each turn re-reads ~${out.reread.at(-1).avgReread} tokens, ~${out.reread.at(-1).avgSecs}s`);
  } catch (e) { out.reread.push({ ub, error: String(e.message ?? e) }); }
  srv.kill();
  await new Promise((r) => srv.once('exit', r));
}

// 3. The smaller file (PTQ1_0), only with room to spare
const freeGb = (() => { const s = statfsSync(MODELS_DIR); return (s.bavail * s.bsize) / 1e9; })();
if (args.includes('--skip-ptq1') || quick) out.ptq1 = { skipped: 'asked to skip' };
else if (freeGb < 12) out.ptq1 = { skipped: `only ${freeGb.toFixed(1)} GB free (needs 12)` };
else {
  const name = 'Ternary-Bonsai-2-27B-PTQ1_0.gguf';
  const dest = join(MODELS_DIR, name);
  const url = `https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf/resolve/main/${name}`;
  log(`downloading ${name} (5.95 GB) to measure it; it is deleted afterwards`);
  const t0 = Date.now();
  const dl = spawnSync('curl', ['-L', '--fail', '-s', '-o', `${dest}.part`, url], { timeout: 60 * 60_000 });
  if (dl.status !== 0) out.ptq1 = { error: `download failed (${dl.status})` };
  else {
    const h = createHash('sha256');
    for await (const c of createReadStream(`${dest}.part`)) h.update(c);
    const sha = h.digest('hex');
    const meta = JSON.parse(execFileSync('curl', ['-sL', 'https://huggingface.co/api/models/prism-ml/Ternary-Bonsai-2-27B-gguf/tree/main'], { encoding: 'utf8' })).find((f) => f.path === name);
    if (!meta || meta.lfs?.oid !== sha) out.ptq1 = { error: 'fingerprint does not match PrismML\'s' };
    else {
      spawnSync('mv', [`${dest}.part`, dest]);
      out.ptq1 = { downloadSecs: Math.round((Date.now() - t0) / 1000), sha: sha.slice(0, 12) };
      const before = out.bench.length;
      bench(dest, ['-fa', '1', '-ctk', 'q8_0', '-ctv', 'q8_0', '-ub', '512'], 'smaller file PTQ1_0 (5.95 GB)');
      out.ptq1.results = out.bench.slice(before);
    }
  }
  rmSync(`${dest}.part`, { force: true });
  rmSync(dest, { force: true });
  out.ptq1.deleted = !existsSync(dest);
}

const outFile = opt('out', join(modelFolder(model), 'results', `speed-${out.at.replace(/[:.]/g, '-')}.json`));
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(out, null, 1));
log(`saved ${outFile}`);
