// The Agentic Coder hub: `/weights`, `/docs`, `coding weights` and `coding docs`
// all start this one small local server (127.0.0.1 only). It hands out
//   /                 the hub page (hub.html, built in): tabs Weights · Harness · Structure (its two pages: Structure and Flow) · Arena · Test builder · Memory · Instructions · All docs · Help
//   /weights          the weights viewer (weights.html, built in)
//   /model.json       the model file's name and size; /model with a Range header, its bytes
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
//   /builder, /builder.json, /builder/…   the Test builder tab: making tests of your own, in full, by level
//     (Easy, Medium, Hard): paste a list of prompts, checks suggested from each prompt's words, try them with
//     no model (builder-hub.mjs). The tests are the Arena's "My tests", on this Mac only
//   /memory, /memory.json the memory: what Agentic Coder remembers about you and this project (memory-hub.mjs)
// The DOCS folder is `cli docs/` at the top of the repo on this Mac (older
// Macs: `agentic-coder DOCS/`): see docs-dir.mjs.
import { statSync, existsSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import html from './weights.html' with { type: 'text' };
import hubHtml from './hub.html' with { type: 'text' };
import helpHtml from './help.html' with { type: 'text' };
import testsHtml from './tests.html' with { type: 'text' };
import memoryHtml from './memory.html' with { type: 'text' };
import instructionsHtml from './instructions.html' with { type: 'text' };
import builderHtml from './builder.html' with { type: 'text' };
import { builderRoute } from './builder-hub.mjs';
import { instructionsRoute } from './instructions-hub.mjs';
import { memoryRoute } from './memory-hub.mjs';
import { harnessRoute } from './harness-hub.mjs';
import { flowRoute } from './flow-hub.mjs';
import { helpData, VERSION } from './help.mjs';
import { MODELS, DEFAULT_MODEL, LINGER_SECS, MODELS_DIR, readEdited, writeEdited, removeEdited, editedFileName, recordData, startBattle } from '../../../models/index.mjs';
import { applyEdits } from './gguf-edit.mjs';
import { findDocsDir } from './docs-dir.mjs';

// The memory's own files sit in the folder too (the hub's Memory tab shows them): never listed or served as pages.
const NOT_PAGES = 'memory-about-you';
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

// Every page in the folder and its subfolders (one level), newest first, each
// with its group; the pinned pages are the newest files whose names say
// harness and structure outside "older versions", so a new version pins itself.
export function listDocs(dir) {
  if (!dir) return { dir: null, missing: true, pinned: {}, groups: GROUPS, pages: [] };
  const pages = [];
  const add = (group, sub) => { for (const f of readdirSync(join(dir, sub))) { if (f.startsWith('.') || !KINDS[ext(f)]) continue; const st = statSync(join(dir, sub, f)); if (!st.isFile()) continue; pages.push({ file: sub ? `${sub}/${f}` : f, name: f, group, kind: KINDS[ext(f)][0], size: st.size, mtime: st.mtimeMs, saved: new Date(st.mtimeMs).toISOString().slice(0, 10), title: ext(f) === '.html' ? titleOf(join(dir, sub, f)) : '' }); } };
  add('unsorted', '');
  for (const g of readdirSync(dir)) if (!g.startsWith('.') && g !== NOT_PAGES && statSync(join(dir, g)).isDirectory()) add(g, g);
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
const envPort = Number((process.env.AGENTIC_HUB_PORT ?? process.env.BONSAI_HUB_PORT) || NaN);
export const HUB_PORT = Number.isInteger(envPort) && envPort >= 0 ? envPort : 8757;

// onEdits: called after a save or revert of the edited copy (the app shows a
// note and lights the weights badge). Editing endpoints:
//   GET  /edits.json    what is saved: the manifest, or { saved: null }
//   POST /edits/save    { edits } → a fresh clone of the original + all edits
//   POST /edits/revert  deletes the copy and its manifest
// onDesign: called when the Instructions page saves a design style (the app's
// window uses it from its next page request).
// cwd: the folder whose memory the Memory tab shows.
export function startWeightsServer({ path, docsDir = findDocsDir(), port = HUB_PORT, onEdits, onDesign, cwd = process.cwd(), instructionsHome }) {
  // Help and docs work before the model is downloaded; only Weights needs it.
  const missing = !path || !existsSync(path);
  const size = missing ? 0 : statSync(path).size;
  const name = path ? basename(path) : '';
  const model = MODELS[DEFAULT_MODEL];
  const serve = (p) => Bun.serve({
    hostname: '127.0.0.1', port: p,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.startsWith('/edits')) {
        const bad = (m, code = 400) => Response.json({ error: m }, { status: code, headers: { 'cache-control': 'no-store' } });
        if (url.pathname === '/edits.json' && req.method === 'GET') return Response.json({ saved: readEdited() }, { headers: { 'cache-control': 'no-store' } });
        if (url.pathname === '/edits/save' && req.method === 'POST') {
          if (missing) return bad('the model file is not on this Mac yet', 404);
          let edits; try { ({ edits } = await req.json()); } catch { return bad('the request body is not JSON'); }
          try {
            const file = editedFileName(model);
            const r = await applyEdits({ src: path, dest: join(MODELS_DIR, file), edits });
            const saved = { base: DEFAULT_MODEL, file, saved: new Date().toISOString(), edits };
            writeEdited(saved);
            onEdits?.({ kind: 'save', saved, rowsChanged: r.rowsChanged });
            return Response.json({ ok: true, saved, rowsChanged: r.rowsChanged, bytesChanged: r.bytesChanged });
          } catch (e) { return bad(e.message); }
        }
        if (url.pathname === '/edits/revert' && req.method === 'POST') {
          const was = removeEdited();
          onEdits?.({ kind: 'revert', was });
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
      if (url.pathname === '/instructions') return page(instructionsHtml);
      if (url.pathname.startsWith('/instructions')) return instructionsRoute(req, url, cwd, instructionsHome, { onDesign });
      if (url.pathname.startsWith('/memory')) { const r = await memoryRoute(req, url, cwd); if (r) return r; }
      if (url.pathname === '/tests.json') return Response.json(recordData(), { headers: { 'cache-control': 'no-store' } });
      if (url.pathname === '/help.json') return Response.json(helpData({ version: VERSION, modelName: model?.name ?? '', effort: model?.thinkingLevels ?? [], lingerMins: LINGER_SECS / 60 }), { headers: { 'cache-control': 'no-store' } });
      if (url.pathname === '/model.json') return Response.json(missing ? { name, size: 0, missing: true } : { name, size });
      if (url.pathname === '/model') {
        if (missing) return new Response('the model file is not on this Mac yet', { status: 404 });
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get('range') || '');
        if (!range) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
        const a = Number(range[1]); const b = range[2] === '' ? size - 1 : Math.min(size - 1, Number(range[2]));
        if (a > b || a >= size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
        return new Response(Bun.file(path).slice(a, b + 1), { status: 206, headers: { 'content-type': 'application/octet-stream', 'content-length': String(b - a + 1), 'content-range': `bytes ${a}-${b}/${size}`, 'accept-ranges': 'bytes' } });
      }
      if (url.pathname === '/docs.json') return Response.json(listDocs(docsDir), { headers: { 'cache-control': 'no-store' } });
      if (url.pathname.startsWith('/docs/')) {
        if (!docsDir) return new Response('the DOCS folder was not found', { status: 404 });
        const file = decodeURIComponent(url.pathname.slice(6));
        const full = resolve(docsDir, file);
        // Only a file in the folder or one of its groups, never a path out of it.
        const parts = file.split('/');
        const clean = parts.length <= 2 && parts[0] !== NOT_PAGES && parts.every((p) => p && p === basename(p) && p !== '..' && !p.startsWith('.'));
        if (!clean || !KINDS[ext(file)] || !full.startsWith(resolve(docsDir) + '/') || !existsSync(full) || !statSync(full).isFile()) return new Response('not found', { status: 404 });
        return new Response(Bun.file(full), { headers: { 'content-type': KINDS[ext(file)][1], 'cache-control': 'no-store' } });
      }
      return new Response('not found', { status: 404 });
    },
  });
  let server;
  try { server = serve(port); } catch (e) { if (!port) throw e; server = serve(0); }
  return { url: `http://127.0.0.1:${server.port}/`, port: server.port, size, name, missing, docsDir, stop: () => server.stop(true) };
}
