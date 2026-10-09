// The Agentic Coder hub: `/weights`, `/docs`, `coding weights` and `coding docs`
// all start this one small local server (127.0.0.1 only). It hands out
//   /                 the hub page (hub.html, built in): tabs Weights · Harness · Structure (its two pages: Structure and Flow) · Arena · Remote · Memory · Instructions · All docs · Help
//   /weights          the weights viewer (weights.html, built in): every model in /model, one alone or side by side
//   /models.json      those models: each one's file, size, tags (default, in use now, not on this Mac) and edited copy
//   /model/<id>       with a Range header, that model's bytes
//   /model.json       the first model file's name and size; /model with a Range header, its bytes (a page opened on one file)
//   /docs.json        the pages in the DOCS folder by group (its subfolders), newest first, with the pinned structure page (and a harness page kept there, under All docs)
//   /docs/<group>/<file>  one page from that folder (html, pdf, png), read live
//   /help, /help.json the Help page and what it lists (help.mjs)
//   /harness, /harness.json the Harness tab: one harness, every model in /model beside the others, read live (harness-hub.mjs)
//   /flow, /flow.json the Flow page, in the Structure tab: how Agentic Coder works as a flow diagram, every model in /model drawn into it, read live (flow-hub.mjs)
//   /arena            the Arena tab: run a test on one model, or battle two. It is the arena runner's own page
//                     (models/evals/battle/): started when it is not up, and told this hub's address so its
//                     Record button can show the page below. /battle is the same (its name before 30 Sep 2026)
//   /tests, /tests.json   the test record: every test run and its result, read live from ~/.agentic-coder/tests/record.jsonl
//                     (the Arena shows it over its own page)
//   /builder, /builder.json, /builder/…   the Test builder (a window over the Arena since 30 Sep 2026): making tests of your own, in full, by level
//     (Easy, Medium, Hard): paste a list of prompts, checks suggested from each prompt's words, try them with
//     no model (builder-hub.mjs). The tests are the Arena's "My tests", on this Mac only
//   /memory, /memory.json the memory: what Agentic Coder remembers about you and this project (memory-hub.mjs)
//   /profiles, /profiles.json, /profiles/…   the Profiles tab: the profiles of /profiles, read from and saved to
//                     the same file (profiles-hub.mjs)
//   /remote, /remote.json, /remote/…   the Remote tab: the models on the services saved with /remote, a card each,
//                     one model in full, and Try it · Load · Unload (remote-hub.mjs)
//   /calc, /calc.json, /calc/…   the Calculator tab: the calculator link live, where it runs (inside the web or its
//                     own background service), its login, and the reports it filed (calc-hub.mjs)
//   /favicon.ico      the tab icon every page asks for: the Visor bot (favicon.mjs)
// The DOCS folder is the repo's docs/ (the main folder's, from a worktree),
// with the owner's own things in docs/private/: see docs-dir.mjs.
import { statSync, existsSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import html from './weights.html' with { type: 'text' };
import hubHtml from './hub.html' with { type: 'text' };
import helpHtml from './help.html' with { type: 'text' };
import testsHtml from './tests.html' with { type: 'text' };
import memoryHtml from './memory.html' with { type: 'text' };
import instructionsHtml from './instructions.html' with { type: 'text' };
import builderHtml from './builder.html' with { type: 'text' };
import remoteHtml from './remote.html' with { type: 'text' };
import profilesHtml from './profiles.html' with { type: 'text' };
import calcHtml from './calc.html' with { type: 'text' };
import { builderRoute } from './builder-hub.mjs';
import { instructionsRoute } from './instructions-hub.mjs';
import { memoryRoute } from './memory-hub.mjs';
import { remoteHub } from './remote-hub.mjs';
import { profilesHub } from './profiles-hub.mjs';
import { calcHub } from './calc-hub.mjs';
import { harnessRoute } from './harness-hub.mjs';
import { flowRoute } from './flow-hub.mjs';
import { helpData, VERSION, setupModels } from './help.mjs';
import { MODELS, DEFAULT_MODEL, LINGER_SECS, MODELS_DIR, modelPath, readEdited, readEditedAll, writeEdited, removeEdited, editedFileName, recordData, startBattle } from '../../../models/index.mjs';
import { loadSettings } from './store.mjs';
import { applyEdits } from './gguf-edit.mjs';
import { findDocsDir } from './docs-dir.mjs';
import { faviconPng } from './favicon.mjs';

// Folders that are not pages: the memory's own files (the hub's Memory tab shows them;
// now in private/, once at the top) and the index's tools. Never listed or served.
const NOT_PAGES = new Set(['memory-about-you', 'tools']);
export { findDocsDir };

const KINDS = { '.html': ['page', 'text/html; charset=utf-8'], '.pdf': ['PDF', 'application/pdf'], '.png': ['image', 'image/png'], '.jpg': ['image', 'image/jpeg'], '.jpeg': ['image', 'image/jpeg'], '.md': ['notes', 'text/markdown; charset=utf-8'] };
const ext = (f) => { const m = /\.[a-z0-9]+$/i.exec(f); return m ? m[0].toLowerCase() : ''; };

// The <title> of a page, from its first few KB.
function titleOf(path) {
  try { const fd = openSync(path, 'r'); const b = Buffer.alloc(8192); const n = readSync(fd, b, 0, b.length, 0); closeSync(fd); const m = /<title>([^<]*)<\/title>/i.exec(b.toString('utf8', 0, n)); return m ? m[1].trim() : ''; } catch { return ''; }
}

// The folder's groups are its subfolders, shown in this order; a file at the
// top level is "unsorted" and shown first so it gets filed.
export const GROUPS = ['unsorted', 'diagrams', 'reports', 'tests', 'design rounds', 'other', 'older versions'];

// Every page in the folder and its subfolders (one level; README.md at the top is
// the index GitHub shows, not a page), newest first, each
// with its group; the pinned pages are the newest files whose names say
// harness and structure outside "older versions", so a new version pins itself.
export function listDocs(dir) {
  if (!dir) return { dir: null, missing: true, pinned: {}, groups: GROUPS, pages: [] };
  const pages = [];
  const add = (group, sub) => { for (const f of readdirSync(join(dir, sub))) { if (f.startsWith('.') || !KINDS[ext(f)] || (!sub && f === 'README.md')) continue; const st = statSync(join(dir, sub, f)); if (!st.isFile()) continue; pages.push({ file: sub ? `${sub}/${f}` : f, name: f, group, kind: KINDS[ext(f)][0], size: st.size, mtime: st.mtimeMs, saved: new Date(st.mtimeMs).toISOString().slice(0, 10), title: ext(f) === '.html' ? titleOf(join(dir, sub, f)) : '' }); } };
  add('unsorted', '');
  for (const g of readdirSync(dir)) if (!g.startsWith('.') && !NOT_PAGES.has(g) && statSync(join(dir, g)).isDirectory()) add(g, g);
  pages.sort((a, b) => b.mtime - a.mtime);
  const pin = (word) => pages.find((p) => p.kind === 'page' && p.group !== 'older versions' && p.name.toLowerCase().includes(word)) ?? null;
  const groups = [...GROUPS.filter((g) => pages.some((p) => p.group === g)), ...[...new Set(pages.map((p) => p.group))].filter((g) => !GROUPS.includes(g))];
  return { dir, missing: false, pinned: { harness: pin('harness'), structure: pin('structure') }, groups, pages };
}

// The hub's usual address. A fixed port keeps the page's saved place (the
// open tensor, the Channels and Layers results) from one start to the next,
// since the browser keeps those per address. Taken already (a second Agentic Coder
// window) → any free port. AGENTIC_HUB_PORT overrides; 0 = any free port, which
// every test run uses: a test's hub (no model file) on 8757 answered the tab
// the real hub had opened, and Weights said the model was missing (27 Sep).
const envPort = Number(process.env.AGENTIC_HUB_PORT || NaN);
export const HUB_PORT = Number.isInteger(envPort) && envPort >= 0 ? envPort : 8757;

// onEdits: called after a save or revert of an edited copy (the app shows a
// note and lights the weights badge). Each model has its own copy. Editing endpoints:
//   GET  /edits.json    what is saved: { saved: the first model's manifest or null, all: { model id: manifest } }
//   POST /edits/save    { model, edits } → a fresh clone of that model's original + all edits
//   POST /edits/revert  { model } → deletes that model's copy and its manifest
// (with no model named: the model whose file this hub was started on)
// models: the models the Weights tab shows (the /model list).
// onDesign: called when the Instructions page saves a design style (the app's
// window uses it from its next page request).
// cwd: the folder whose memory the Memory tab shows.
// The Weights tab reads GGUF files: an MLX model's pack (format 'mlx', Bonsai 2 27B ConstantKV) is not one, so it is left out.
export function startWeightsServer({ path, models = Object.values(MODELS).filter((m) => m.format !== 'mlx'), docsDir = findDocsDir(), port = HUB_PORT, onEdits, onDesign, cwd = process.cwd(), instructionsHome }) {
  // Help and docs work before the model is downloaded; only Weights needs it.
  const missing = !path || !existsSync(path);
  const size = missing ? 0 : statSync(path).size;
  const name = path ? basename(path) : '';
  const model = MODELS[DEFAULT_MODEL];
  const noStore = { 'cache-control': 'no-store' };
  const remote = remoteHub({ cwd });
  const profiles = profilesHub({ cwd });
  const calc = calcHub();
  // The models as the Weights tab shows them, read each time: the tags are the Harness
  // tab's (the model /model saved last is the one in use), and a file can arrive or go.
  const modelsData = () => {
    const want = String(loadSettings(cwd).model ?? '').replace(/-edited$/, '');
    const inUse = models.some((m) => m.id === want) ? want : (models.some((m) => m.id === DEFAULT_MODEL) ? DEFAULT_MODEL : models[0]?.id ?? null);
    const edited = readEditedAll();
    return { inUse, models: models.map((m) => {
      const file = modelPath(m); const there = existsSync(file);
      return { id: m.id, name: m.name, by: m.by ?? '', file: m.file, size: there ? statSync(file).size : 0, missing: !there,
        tags: [m.id === DEFAULT_MODEL ? 'default' : '', m.id === inUse ? 'in use now' : '', there ? '' : 'not on this Mac'].filter(Boolean), edited: edited[m.id] ?? null };
    }) };
  };
  // A file's bytes by range: 206 with exactly what was asked, 416 without a range (whole-file reads are not offered).
  const bytesOf = (req, file) => {
    const total = statSync(file).size;
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get('range') || '');
    if (!range) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${total}` } });
    const a = Number(range[1]); const b = range[2] === '' ? total - 1 : Math.min(total - 1, Number(range[2]));
    if (a > b || a >= total) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${total}` } });
    return new Response(Bun.file(file).slice(a, b + 1), { status: 206, headers: { 'content-type': 'application/octet-stream', 'content-length': String(b - a + 1), 'content-range': `bytes ${a}-${b}/${total}`, 'accept-ranges': 'bytes' } });
  };
  const serve = (p) => Bun.serve({
    hostname: '127.0.0.1', port: p,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.startsWith('/edits')) {
        const bad = (m, code = 400) => Response.json({ error: m }, { status: code, headers: { 'cache-control': 'no-store' } });
        if (url.pathname === '/edits.json' && req.method === 'GET') return Response.json({ saved: readEdited(DEFAULT_MODEL), all: readEditedAll() }, { headers: noStore });
        // Which model an edit is for: the one named, which must be in the list; with none named, the file this hub was started on.
        let body = {}; if (req.method === 'POST') { try { body = (await req.json()) ?? {}; } catch { if (url.pathname === '/edits/save') return bad('the request body is not JSON'); } }
        const named = body.model != null ? models.find((m) => m.id === body.model) : null;
        if (body.model != null && !named) return bad(`no model called ${String(body.model).slice(0, 40)} in /model`, 404);
        const src = named ? modelPath(named) : path; const base = named ? named.id : DEFAULT_MODEL;
        if (url.pathname === '/edits/save' && req.method === 'POST') {
          if (!src || !existsSync(src)) return bad('the model file is not on this Mac yet', 404);
          try {
            const file = editedFileName(named ?? model);
            const r = await applyEdits({ src, dest: join(MODELS_DIR, file), edits: body.edits });
            const saved = { base, file, saved: new Date().toISOString(), edits: body.edits };
            writeEdited(saved);
            onEdits?.({ kind: 'save', saved, rowsChanged: r.rowsChanged });
            return Response.json({ ok: true, saved, rowsChanged: r.rowsChanged, bytesChanged: r.bytesChanged });
          } catch (e) { return bad(e.message); }
        }
        if (url.pathname === '/edits/revert' && req.method === 'POST') {
          const was = removeEdited(base);
          onEdits?.({ kind: 'revert', was, base });
          return Response.json({ ok: true });
        }
        return bad('not found', 404);
      }
      const page = (text) => new Response(text, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
      if (url.pathname === '/') return page(hubHtml);
      if (url.pathname === '/weights') return page(html);
      if (url.pathname === '/help') return page(helpHtml);
      if (url.pathname === '/flow' || url.pathname === '/flow.json') return flowRoute(url, cwd);
      if (url.pathname === '/harness' || url.pathname === '/harness.json') return harnessRoute(url, cwd);
      if (url.pathname === '/tests') return page(testsHtml);
      if (url.pathname === '/builder') return page(builderHtml);
      if (url.pathname === '/builder.json' || url.pathname.startsWith('/builder/')) return builderRoute(req, url);
      // The Arena runs on its own (it keeps going when this window closes): started here when it is
      // not up, then shown at its own address, with this hub's address (its Record button shows /tests
      // from here) and what /test asked for: a test, who runs it, thinking, the New test window, the record.
      if (url.pathname === '/arena' || url.pathname === '/battle') {
        try {
          const b = await startBattle();
          const to = new URL(b.url);
          to.searchParams.set('hub', url.origin);
          for (const k of ['test', 'model', 'n', 'think', 'new', 'record']) { const v = url.searchParams.get(k); if (v) to.searchParams.set(k, v.slice(0, 80)); }
          return Response.redirect(to.href, 302);
        }
        catch (e) { return page(`<!doctype html><meta charset="utf-8"><body style="font:14px -apple-system,sans-serif;padding:24px"><h3>The Arena did not start</h3><p>${String(e.message).replace(/[<>&]/g, '')}</p><p>Open the Arena tab again to try once more.</p>`); }
      }
      if (url.pathname === '/memory') return page(memoryHtml);
      if (url.pathname === '/profiles') return page(profilesHtml);
      if (url.pathname === '/profiles.json' || url.pathname.startsWith('/profiles/')) { const r = await profiles.route(req, url); if (r) return r; }
      if (url.pathname === '/remote') return page(remoteHtml);
      if (url.pathname === '/calc') return page(calcHtml);
      if (url.pathname === '/calc.json' || url.pathname.startsWith('/calc/')) { const r = await calc.route(req, url); if (r) return r; }
      if (url.pathname.startsWith('/remote')) { const r = await remote.route(req, url); if (r) return r; }
      if (url.pathname === '/instructions') return page(instructionsHtml);
      if (url.pathname.startsWith('/instructions')) return instructionsRoute(req, url, cwd, instructionsHome, { onDesign });
      if (url.pathname.startsWith('/memory')) { const r = await memoryRoute(req, url, cwd); if (r) return r; }
      if (url.pathname === '/tests.json') return Response.json(recordData(), { headers: { 'cache-control': 'no-store' } });
      if (url.pathname === '/help.json') return Response.json(helpData({ version: VERSION, modelName: model?.name ?? '', effort: model?.thinkingLevels ?? [], lingerMins: LINGER_SECS / 60, models: setupModels(MODELS, DEFAULT_MODEL) }), { headers: { 'cache-control': 'no-store' } });
      if (url.pathname === '/model.json') return Response.json(missing ? { name, size: 0, missing: true } : { name, size });
      if (url.pathname === '/models.json') return Response.json(modelsData(), { headers: noStore });
      if (url.pathname.startsWith('/model/')) {
        const m = models.find((x) => x.id === decodeURIComponent(url.pathname.slice(7)));
        if (!m || !existsSync(modelPath(m))) return new Response(m ? 'that model file is not on this Mac yet' : 'no such model', { status: 404 });
        return bytesOf(req, modelPath(m));
      }
      if (url.pathname === '/model') {
        if (missing) return new Response('the model file is not on this Mac yet', { status: 404 });
        return bytesOf(req, path);
      }
      if (url.pathname === '/docs.json') return Response.json(listDocs(docsDir), { headers: { 'cache-control': 'no-store' } });
      if (url.pathname.startsWith('/docs/')) {
        if (!docsDir) return new Response('the DOCS folder was not found', { status: 404 });
        const file = decodeURIComponent(url.pathname.slice(6));
        let full = resolve(docsDir, file);
        // Only a file in the folder or one of its groups, never a path out of it.
        const parts = file.split('/');
        const clean = parts.length <= 2 && !NOT_PAGES.has(parts[0]) && parts.every((p) => p && p === basename(p) && p !== '..' && !p.startsWith('.'));
        // A page a newer run replaced moves to "older versions": its old link (a test-record line) still opens it.
        if (clean && parts.length === 2 && !existsSync(full) && existsSync(resolve(docsDir, 'older versions', parts[1]))) full = resolve(docsDir, 'older versions', parts[1]);
        if (!clean || !KINDS[ext(file)] || !full.startsWith(resolve(docsDir) + '/') || !existsSync(full) || !statSync(full).isFile()) return new Response('not found', { status: 404 });
        return new Response(Bun.file(full), { headers: { 'content-type': KINDS[ext(file)][1], 'cache-control': 'no-store' } });
      }
      if (url.pathname === '/favicon.ico') return new Response(faviconPng(), { headers: { 'content-type': 'image/png', 'cache-control': 'max-age=86400' } });
      return new Response('not found', { status: 404 });
    },
  });
  let server;
  try { server = serve(port); } catch (e) { if (!port) throw e; server = serve(0); }
  return { url: `http://127.0.0.1:${server.port}/`, port: server.port, size, name, missing, docsDir, stop: () => { remote.stop(); server.stop(true); } };
}
