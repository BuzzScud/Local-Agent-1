// The Bonsai hub: `/weights`, `/docs`, `bonsai weights` and `bonsai docs`
// all start this one small local server (127.0.0.1 only). It hands out
//   /                 the hub page (hub.html, built in): tabs Weights · Harness · Structure · All docs
//   /weights          the weights viewer (weights.html, built in)
//   /model.json       the model file's name and size; /model with a Range header, its bytes
//   /docs.json        the pages in the DOCS folder by group (its subfolders), newest first, with the pinned harness and structure pages
//   /docs/<group>/<file>  one page from that folder (html, pdf, png), read live
// The DOCS folder is `bonsai-code DOCS/` at the top of the repo on this Mac:
// BONSAI_DOCS names it outright, else BONSAI_REPO (the launcher passes it),
// else the repo this source runs from.
import { statSync, existsSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import html from './weights.html' with { type: 'text' };
import hubHtml from './hub.html' with { type: 'text' };

export function findDocsDir() {
  const tries = [process.env.BONSAI_DOCS, process.env.BONSAI_REPO && join(process.env.BONSAI_REPO, 'bonsai-code DOCS'), join(import.meta.dir, '..', '..', '..', 'bonsai-code DOCS')].filter(Boolean);
  return tries.find((d) => { try { return statSync(d).isDirectory(); } catch { return false; } }) ?? null;
}

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
  for (const g of readdirSync(dir)) if (!g.startsWith('.') && statSync(join(dir, g)).isDirectory()) add(g, g);
  pages.sort((a, b) => b.mtime - a.mtime);
  const pin = (word) => pages.find((p) => p.kind === 'page' && p.group !== 'older versions' && p.name.toLowerCase().includes(word)) ?? null;
  const groups = [...GROUPS.filter((g) => pages.some((p) => p.group === g)), ...[...new Set(pages.map((p) => p.group))].filter((g) => !GROUPS.includes(g))];
  return { dir, missing: false, pinned: { harness: pin('harness'), structure: pin('structure') }, groups, pages };
}

// The hub's usual address. A fixed port keeps the page's saved place (the
// open tensor, the Channels and Layers results) from one start to the next,
// since the browser keeps those per address. Taken already (a second Bonsai
// window) → any free port. BONSAI_HUB_PORT overrides.
export const HUB_PORT = Number(process.env.BONSAI_HUB_PORT) || 8757;

export function startWeightsServer({ path, docsDir = findDocsDir(), port = HUB_PORT }) {
  const size = statSync(path).size;
  const name = basename(path);
  const serve = (p) => Bun.serve({
    hostname: '127.0.0.1', port: p,
    fetch(req) {
      const url = new URL(req.url);
      const page = (text) => new Response(text, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
      if (url.pathname === '/') return page(hubHtml);
      if (url.pathname === '/weights') return page(html);
      if (url.pathname === '/model.json') return Response.json({ name, size });
      if (url.pathname === '/model') {
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
        const clean = parts.length <= 2 && parts.every((p) => p && p === basename(p) && p !== '..' && !p.startsWith('.'));
        if (!clean || !KINDS[ext(file)] || !full.startsWith(resolve(docsDir) + '/') || !existsSync(full) || !statSync(full).isFile()) return new Response('not found', { status: 404 });
        return new Response(Bun.file(full), { headers: { 'content-type': KINDS[ext(file)][1], 'cache-control': 'no-store' } });
      }
      return new Response('not found', { status: 404 });
    },
  });
  let server;
  try { server = serve(port); } catch (e) { if (!port) throw e; server = serve(0); }
  return { url: `http://127.0.0.1:${server.port}/`, port: server.port, size, name, docsDir, stop: () => server.stop(true) };
}
