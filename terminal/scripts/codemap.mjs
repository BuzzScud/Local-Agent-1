// `bun run codemap [<project folder>]`: writes the project's code map, docs/map/ (tools/codemap.mjs).
// A model writes the lines, one request per folder (the folder and its main files), deepest folders
// first so a folder's line can use its folders' lines; a line kept from before is used while its file
// is the same, so after a change only the changed files are sent. Where the model gives no line, the
// line is made from the code. Ends with the map's check (paths, size, no home paths or addresses).
//   bun run codemap [<folder>] [--remote <address>] [--model <name>] [--ctx 32768] [--jobs 2]
//        [--code-only] [--check] [--max <folders>]
//   --remote   an Ollama service (default: the address /remote saved); --model its model (Qwen3.6:35B-A3B)
//   --code-only  no model: every line from the code
//   --check      only the check of the docs/map already there
// The model is let go on the service when the labels are done or the run is stopped, unless it was
// loaded before the run (borrowOllama); while it runs, each request keeps it RUN_KEEP at most.
//   --set-file <fixes.json>  lines checked by hand against the code, [{ "path": "src/a.mjs" | "src/", "line": "…" }]:
//                kept as checked (✓) while the file is the same; the map is written again, no model asked
import { readFileSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { HOME, directUrl, borrowOllama, RUN_KEEP } from '../../models/index.mjs';
import { mapTree, fileCard, folderCard, folderHash, labelRequest, parseLabels, lineFor, loadLabels, saveLabels, writeMap, checkMap, LABEL_SYSTEM, MAP_DIR } from '../src/tools/codemap.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const root = resolve((args[0] && !args[0].startsWith('--') ? args[0] : '.').replace(/^~(?=\/|$)/, homedir()));
const shown = (p) => p.replace(homedir(), '~');
// The map's name: the repo's own (a worktree's main folder), without a GitHub download's "-main-2".
function mapName(dir) {
  const r = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: dir, encoding: 'utf8' });
  const common = r.status === 0 ? resolve(dir, r.stdout.trim()) : null;
  const name = common && basename(common) === '.git' ? basename(dirname(common)) : basename(dir);
  return name.replace(/-(main|master)(-\d+)?$/i, '');
}

if (args.includes('--check')) {
  const p = checkMap(root);
  console.log(p.length ? `docs/map of ${shown(root)}: ${p.length} problems\n${p.map((x) => `  ${x}`).join('\n')}` : `docs/map of ${shown(root)}: right`);
  process.exit(p.length ? 1 : 0);
}

let saved = null;
try { saved = JSON.parse(readFileSync(join(HOME, 'settings.json'), 'utf8')).remote ?? null; } catch {}
const address = opt('remote', null) ?? (saved?.address ? directUrl(saved) : null);
const model = opt('model', 'Qwen3.6:35B-A3B');
const ctx = Number(opt('ctx', 32768));
const jobs = Math.max(1, Number(opt('jobs', 2)));
const codeOnly = args.includes('--code-only') || !address;
const max = Number(opt('max', Infinity));

const t0 = Date.now();
const tree = mapTree(root);
const labels = loadLabels(root);
if (opt('set-file', null)) {
  const fixes = JSON.parse(readFileSync(resolve(opt('set-file')), 'utf8'));
  let n = 0;
  for (const { path, line } of fixes) {
    const rel = String(path).replace(/^\.\//, '').replace(/\/$/, '');
    const node = tree.nodes.get(rel);
    if (node) labels[`d:${rel}`] = { h: folderHash(folderCard(root, node)), line, by: 'checked' };
    else if (tree.files.includes(rel)) labels[`f:${rel}`] = { h: fileCard(root, rel).hash, line, by: 'checked' };
    else { console.log(`not in the project, left out: ${path}`); continue; }
    n++;
  }
  saveLabels(root, labels);
  writeMap(root, tree, labels, { name: mapName(root) });
  const problems = checkMap(root);
  console.log(`${n} lines kept as checked by hand; docs/map written again${problems.length ? `; the check found ${problems.length} problems:\n${problems.map((x) => `  ${x}`).join('\n')}` : '; the check: right.'}`);
  process.exit(problems.length ? 1 : 0);
}
const folders = [...tree.nodes.values()].filter((n) => n.rel).sort((a, b) => b.rel.split('/').length - a.rel.split('/').length || a.rel.localeCompare(b.rel));
console.log(`${shown(root)}: ${tree.files.length} files, ${folders.length} folders; lines by ${codeOnly ? 'the code alone' : `${model} at ${address}`}`);

// One folder: its card and its main files' cards to the model, the lines it gives kept.
async function ask(node) {
  const cards = node.picked.map((f) => fileCard(root, f));
  const childLabels = new Map(node.dirs.map((d) => [d.rel, labels[`d:${d.rel}`]?.line]).filter(([, l]) => l));
  const fh = folderHash(folderCard(root, node));
  const want = cards.filter((c) => !lineFor(labels, `f:${c.rel}`, c.hash));
  if (!want.length && lineFor(labels, `d:${node.rel}`, fh)) return 'kept';
  const body = { model, stream: false, think: false, format: 'json', keep_alive: RUN_KEEP, messages: [{ role: 'system', content: LABEL_SYSTEM }, { role: 'user', content: labelRequest(root, node, cards, childLabels) }], options: { num_ctx: ctx, num_predict: 1500, temperature: 0.2 } };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${address.replace(/\/$/, '')}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
      const j = await res.json();
      const got = parseLabels(j.message?.content ?? '', cards.map((c) => c.rel));
      if (!got) throw new Error('not the JSON asked for');
      const keep = (k, h, line) => { if (line && labels[k]?.by !== 'checked') labels[k] = { h, line, by: model }; };
      for (const c of cards) keep(`f:${c.rel}`, c.hash, got.files[c.rel]);
      keep(`d:${node.rel}`, fh, got.folder);
      return 'asked';
    } catch (e) {
      if (attempt === 2) { console.log(`  ✗ ${node.rel}: ${e.message}`); return 'failed'; }
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  return 'failed';
}

const counts = { asked: 0, kept: 0, failed: 0 };
// The model on the service: let go when the labels are done, or when the run is stopped (^C).
const hold = codeOnly ? null : await borrowOllama({ url: address, model });
const letGo = async () => {
  const r = await hold?.release();
  if (r === true) console.log(`Let go of ${model} on the service.`);
  else if (r === false && hold?.wasLoaded) console.log(`${model} was loaded on the service before this run, so it stays.`);
};
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { saveLabels(root, labels); letGo().finally(() => process.exit(130)); });
if (!codeOnly) try {
  // Deepest first; the folders of one depth side by side, `jobs` at a time.
  const depths = [...new Set(folders.map((n) => n.rel.split('/').length))];
  let done = 0;
  for (const depth of depths) {
    const queue = folders.filter((n) => n.rel.split('/').length === depth).slice(0, Math.max(0, max - done));
    await Promise.all(Array.from({ length: jobs }, async () => {
      for (let n = queue.shift(); n; n = queue.shift()) {
        counts[await ask(n)]++;
        done++;
        if (done % 10 === 0) { saveLabels(root, labels); console.log(`  ${done} of ${folders.length} folders · ${counts.asked} asked, ${counts.kept} kept, ${counts.failed} failed · ${Math.round((Date.now() - t0) / 1000)} s`); }
      }
    }));
  }
  // The top's own files.
  counts[await ask(tree.top)]++;
  saveLabels(root, labels);
} finally { await letGo(); }
const written = writeMap(root, tree, labels, { name: mapName(root) });
const problems = checkMap(root);
const byModel = Object.values(labels).filter((l) => l.by && l.by !== 'code').length;
console.log(`Wrote ${shown(join(root, MAP_DIR))}: ${written.length} files (largest ${Math.max(...written.map((w) => w.chars))} characters), in ${Math.round((Date.now() - t0) / 1000)} s; ${counts.asked} folders asked, ${counts.kept} kept, ${counts.failed} failed; ${byModel} lines from the model.`);
if (problems.length) { console.log(`The check found ${problems.length} problems:\n${problems.slice(0, 30).map((x) => `  ${x}`).join('\n')}`); process.exit(1); }
console.log('The check: right.');
