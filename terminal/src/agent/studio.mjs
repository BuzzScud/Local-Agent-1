// The design studio: a folder of ready-made UI pieces (cards, forms, navigation,
// tables, pop-ups) written with Tailwind classes in the user's own look, the way
// Preline or Float UI keep theirs. A request to make a page brings the pieces
// that fit it, as real code, so a small model puts proven parts together instead
// of inventing a design; after each change Agentic Coder builds the CSS for the
// page's classes into the page itself, so it still opens with a double-click and
// no internet (30 Sep 2026: "a design studio folder that contains designs and
// styles and ui components like preline.co").
//   where     `docs/private/design studio/` (AGENTIC_STUDIO_DIR names another):
//             styles/theme.css (the colours, type and corners, light and dark) and
//             components/<kind>/<name>.html, one piece each
//   a piece   an .html fragment that starts with a comment: "# Name", "- For:",
//             "- Words:" (as a design card's), then the HTML and any small <script>
//   when      a page request that gets the design examples (design.mjs), with the
//             studio on; the pieces then take the place of the example card, and
//             the rules card still comes
//   how much  the PIECES best pieces by their Words (scoreCard, as the cards), at
//             most STUDIO_CHARS together; others that fit are named by path, and
//             the model may Read them under STUDIO/ (read-only). The folder's size
//             never changes the reading: the app picks, the model reads two pieces
//   the build Tailwind's own compiler (the tailwindcss package, offline, ~10 ms)
//             turns the classes on the page into one <style id="studio-css"> line
//             in <head>, rebuilt after every Write or Edit of the page. The theme
//             has only the user's colours, so a stock colour (bg-blue-500) draws
//             nothing and is sent back to be swapped. Read shows that line folded
//             (hideBuilt), so the model never reads or edits the built CSS
//   switch    settings.json "design": { studio }, AGENTIC_STUDIO (on|off), /design studio [on|off]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep, relative, isAbsolute, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { findPrivateDir, mainFolder } from '../app/docs-dir.mjs';
import { scoreCard } from './design.mjs';

export const FOLDER = 'design studio';
export const PIECES = 2; // pieces that go along with a request
export const MORE = 3; // other fitting pieces named by path
export const PIECE_CHARS = 2600; // of one piece: a longer one is named, never cut (cut HTML is broken HTML)
export const STUDIO_CHARS = 6400; // the head and the pieces together
// Fewer Tailwind classes than this on a page that was never built: a plain-CSS
// page, which the build's reset (Tailwind's preflight) would only spoil.
export const MIN_CLASSES = 5;

export function studioDir() {
  const named = process.env.AGENTIC_STUDIO_DIR;
  if (named) return existsSync(named) ? resolve(named) : null;
  const own = findPrivateDir();
  const d = own ? join(own, FOLDER) : null;
  return d && existsSync(d) ? d : null;
}

// The user's look (the rules card's colours) as a Tailwind theme: only these
// colours exist, and each switches with the system's dark mode by itself, so a
// piece needs no dark: classes. The blue is #1f66bd (5.3–5.7:1), one step
// deeper than the rules card's old #2a78d6 (4.1–4.4:1 as text and under white
// text); the rules card has used #1f66bd too since 30 Sep. Used when the folder
// has no styles/theme.css.
export const DEFAULT_THEME = `@import "tailwindcss";
@theme { --color-*: initial; }
@theme inline {
  --color-paper: var(--paper); --color-surface: var(--surface); --color-subtle: var(--subtle);
  --color-ink: var(--ink); --color-muted: var(--muted); --color-line: var(--line);
  --color-accent: var(--accent); --color-accent-ink: var(--accent-ink); --color-accent-soft: var(--accent-soft);
  --color-good: var(--good); --color-good-soft: var(--good-soft);
  --color-wait: var(--wait); --color-wait-soft: var(--wait-soft);
  --color-bad: var(--bad); --color-bad-soft: var(--bad-soft);
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --radius-card: 14px;
}
:root {
  color-scheme: light dark;
  --paper: #f7f6f2; --surface: #ffffff; --subtle: #f1efe9; --ink: #1c1b18; --muted: #6b675e; --line: #e3dfd5;
  --accent: #1f66bd; --accent-ink: #ffffff; --accent-soft: #e3eefb;
  --good: #1f7a3d; --good-soft: #e3f2e7; --wait: #8a5a00; --wait-soft: #fbefd5; --bad: #b42318; --bad-soft: #fbe4e1;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #15161a; --surface: #1d1f24; --subtle: #24262c; --ink: #ecebe6; --muted: #a4a19a; --line: #34363e;
    --accent: #6aa5ec; --accent-ink: #0e1726; --accent-soft: #1f3350;
    --good: #6fcf8f; --good-soft: #173523; --wait: #e8b04a; --wait-soft: #3a2c10; --bad: #f28b82; --bad-soft: #3d1a18;
  }
}
`;

export function readTheme(dir = studioDir()) {
  if (dir) { try { return readFileSync(join(dir, 'styles', 'theme.css'), 'utf8'); } catch {} }
  return DEFAULT_THEME;
}

// The colour names a theme makes (--color-<name>), for the model's note.
export const themeColours = (theme) => [...new Set([...theme.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]).filter((n) => n !== '*'))];

// The comment at the top of a piece: "# Name", "- For:", "- Words:".
export function parsePiece(text, file = '') {
  const t = text.replace(/\r/g, '');
  const m = /^\s*<!--([\s\S]*?)-->\s*/.exec(t);
  const head = m ? m[1] : '';
  const name = /^\s*#\s+(.+)$/m.exec(head)?.[1].trim() ?? file.split('/').pop().replace(/\.html?$/i, '');
  const field = (k) => new RegExp(`^\\s*-\\s*${k}\\s*:\\s*(.*)$`, 'im').exec(head)?.[1].trim() ?? '';
  return {
    name,
    for: field('for'),
    words: field('words').toLowerCase().split(',').map((w) => w.trim()).filter(Boolean),
    body: m ? t.slice(m[0].length).trim() : t.trim(),
  };
}

// Every piece in components/, kind by kind (the subfolder is the kind).
export function readPieces(dir = studioDir()) {
  const root = dir ? join(dir, 'components') : null;
  if (!root || !existsSync(root)) return { dir: dir ?? null, kinds: [], pieces: [] };
  const pieces = [];
  const walk = (rel) => {
    let names = [];
    try { names = readdirSync(join(root, rel)).sort(); } catch { return; }
    for (const n of names) {
      if (n.startsWith('.')) continue;
      const r = rel ? `${rel}/${n}` : n;
      let st;
      try { st = statSync(join(root, r)); } catch { continue; }
      if (st.isDirectory()) { walk(r); continue; }
      if (!/\.html?$/i.test(n)) continue;
      let text;
      try { text = readFileSync(join(root, r), 'utf8'); } catch { continue; }
      pieces.push({ ...parsePiece(text, r), kind: rel.split('/')[0] || 'other', file: `components/${r}`, chars: text.length });
    }
  };
  walk('');
  const kinds = [...new Set(pieces.map((p) => p.kind))].map((name) => ({ name, pieces: pieces.filter((p) => p.kind === name) }));
  return { dir, kinds, pieces };
}

// The pieces that go along with a request: the best one by its Words (and the
// words of its name), and the next best only when it fits nearly as well (at
// least 2, and half the best's score: a notification card's "inbox item" once
// brought the product card along); then up to MORE others that fit, by path.
export function pickPieces(text, { dir = studioDir(), pieces } = {}) {
  const all = pieces ?? readPieces(dir).pieces;
  const fits = all.map((p) => ({ p, score: scoreCard(p, text) })).filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.file.localeCompare(b.p.file));
  const top = fits[0]?.score ?? 0;
  const close = (x, i) => i === 0 || (x.score >= 2 && x.score * 2 >= top);
  const sent = fits.filter(close).slice(0, PIECES);
  return { pieces: sent.map((x) => x.p), more: fits.filter((x) => !sent.includes(x)).slice(0, MORE).map((x) => x.p) };
}

const SHELL = '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>…</title></head>\n<body class="min-h-screen bg-paper text-ink font-sans antialiased">…</body>\n</html>';

function head(colours) {
  return `The design studio (the user's own UI pieces, read-only under STUDIO/): build this page from the pieces below. Copy their HTML and their Tailwind classes, put this request's own words and numbers in them, and join them into one page, starting from this shell:\n${SHELL}\nStyle with Tailwind classes only. The colours are the user's theme and there are no others: ${colours.map((c) => c).join(', ')} (as bg-…, text-…, border-…; paper is the page, surface a card, subtle a hover or table head; good, wait and bad only for a state, with their -soft for a tag's background). Stock Tailwind colours (blue-500, gray-600, white, black) do not exist here and draw nothing. Light and dark mode switch by themselves: no dark: classes. Do not add Tailwind's <script> or a <link> to it: Agentic Coder builds the CSS for your classes into the page after every change. A <style> of your own is fine for what classes cannot do.`;
}

// The text that goes with the request, and the pieces in it.
export function studioNotes(pick, dir = studioDir()) {
  if (!pick.pieces.length) return null;
  const parts = [head(themeColours(readTheme(dir)))];
  const used = [];
  let room = STUDIO_CHARS - parts[0].length;
  const skipped = [];
  for (const p of pick.pieces) {
    const t = `[Piece · STUDIO/${p.file}: ${p.name}${p.for ? `, for ${p.for}` : ''}]\n${p.body}`;
    if (t.length > PIECE_CHARS + 200 || t.length > room) { skipped.push(p); continue; }
    parts.push(t);
    used.push(p);
    room -= t.length + 2;
  }
  if (!used.length) return null;
  const more = [...skipped, ...pick.more];
  if (more.length) parts.push(`Other pieces that fit (Read one only if the page needs it): ${more.map((p) => `STUDIO/${p.file}`).join(', ')}.`);
  const text = parts.join('\n\n');
  return { text, pieces: used, chars: text.length };
}

// "STUDIO/…" in a tool's path: the studio folder, read-only (tools.mjs).
export function studioPathFor(p, dir = studioDir()) {
  if (p !== 'STUDIO' && !p.startsWith('STUDIO/')) return null;
  if (!dir) return null;
  const abs = resolve(dir, p === 'STUDIO' ? '.' : p.slice(7));
  if (abs !== resolve(dir) && !abs.startsWith(`${resolve(dir)}${sep}`)) return null;
  return { abs, rel: p };
}

export function inStudioDir(abs, dir = studioDir()) {
  if (!dir) return null;
  const r = relative(dir, abs);
  if (r.startsWith('..') || isAbsolute(r)) return null;
  return `STUDIO${r ? `/${r.split(sep).join('/')}` : ''}`;
}

// /design studio alone: the pieces, kind by kind.
export function studioSummary(dir = studioDir()) {
  const { kinds } = readPieces(dir);
  return { dir, rows: kinds.map((k) => [k.name, `${k.pieces.length} piece${k.pieces.length === 1 ? '' : 's'}: ${k.pieces.map((p) => p.file.split('/').pop().replace(/\.html?$/i, '')).join(', ')}`]) };
}

// ── The build ──────────────────────────────────────────────────────────────

const BUILT_RE = /<style id="studio-css">[\s\S]*?<\/style>\s?/;
export const BUILT_NOTE = '/* built by Agentic Coder from the Tailwind classes: rebuilt after every change, so change the classes, never this line */';
export const isBuilt = (html) => /<style id="studio-css">/.test(html ?? '');

// The page as the model reads it: the built line folded to a note (one line
// stays one line, so line numbers do not move).
export function hideBuilt(text) {
  if (!isBuilt(text)) return text;
  return text.replace(/<style id="studio-css">[^\n]*?<\/style>/, () => `<style id="studio-css">${BUILT_NOTE}</style>`);
}

// An Edit's old text with the folded line in it: the real line back, so it
// matches the file.
export function realBuilt(oldText, before) {
  if (typeof oldText !== 'string' || !oldText.includes(BUILT_NOTE)) return oldText;
  const real = /<style id="studio-css">[^\n]*?<\/style>/.exec(before ?? '')?.[0];
  return real ? oldText.replace(`<style id="studio-css">${BUILT_NOTE}</style>`, () => real) : oldText;
}

// Where the tailwindcss package is: beside this source, or in the repo the
// launcher names (the built app runs from elsewhere).
function tailwindDir() {
  const tries = [];
  try { tries.push(dirname(createRequire(import.meta.url).resolve('tailwindcss/package.json'))); } catch {}
  const repo = process.env.AGENTIC_REPO ?? process.env.BONSAI_REPO;
  if (repo) tries.push(join(repo, 'node_modules', 'tailwindcss'), join(mainFolder(repo), 'node_modules', 'tailwindcss'));
  try { tries.push(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'node_modules', 'tailwindcss')); } catch {}
  return tries.find((d) => existsSync(join(d, 'index.css'))) ?? null;
}

// A new compiler for every build (~10 ms): Tailwind's keeps every class it has
// ever been given, so a shared one would carry a page's old classes into the next.
async function compilerFor(theme) {
  const tw = tailwindDir();
  if (!tw) throw new Error('the tailwindcss package is not installed (npm install in the repo)');
  const { compile } = await import('tailwindcss');
  const c = await compile(theme, {
    base: tw,
    loadStylesheet: async (id, base) => {
      const file = id === 'tailwindcss' ? join(tw, 'index.css') : /^tailwindcss\//.test(id) ? join(tw, id.slice(12)) : resolve(base, id);
      return { path: file, base: dirname(file), content: readFileSync(file, 'utf8') };
    },
  });
  return c;
}

// Every word on the page that could be a class (Tailwind scans text the same
// way: a word that is no class makes nothing).
export function candidates(html) {
  const out = new Set();
  for (const raw of html.split(/[\s"'`<>]+/)) {
    const w = raw.replace(/^[,;(){}]+|[,;(){}]+$/g, '');
    if (w && w.length <= 120 && /[a-z]/.test(w)) out.add(w);
  }
  return [...out];
}

// The words in class="…" attributes: the classes the page means.
export function classWords(html) {
  const out = new Set();
  for (const m of html.matchAll(/\bclass(?:Name)?\s*=\s*(["'])([\s\S]*?)\1/g)) for (const w of m[2].split(/\s+/)) if (w && !w.includes('${')) out.add(w);
  return [...out];
}

// A class as it appears in a selector (".md\:grid-cols-2").
export function escapeClass(c) {
  const e = c.replace(/[^a-zA-Z0-9_\- -￿]/g, (ch) => `\\${ch}`);
  return /^\d/.test(e) ? `\\3${e[0]} ${e.slice(1)}` : e;
}

const STOCK = /^(?:[a-z0-9-]+:)*(?:bg|text|border(?:-[trblxy])?|ring|ring-offset|outline|divide|from|via|to|fill|stroke|decoration|placeholder|caret|accent|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|white|black)(?:-\d{2,3})?(?:\/\d+)?$/;
const CDN = /<script\b[^>]*\bsrc=["'][^"']*(?:cdn\.tailwindcss\.com|tailwindcss)[^"']*["'][^>]*>\s*<\/script>\s?|<script\b[^>]*>\s*tailwind\.config\s*=[\s\S]*?<\/script>\s?|<link\b[^>]*\bhref=["'][^"']*tailwind[^"']*["'][^>]*>\s?/gi;

// The page with the CSS for its classes built in: { html, bytes, ms, classes,
// stock, cdn } or { skipped: why } (nothing to change).
export async function buildStyles(html, { theme = readTheme(), force = false } = {}) {
  const t0 = Date.now();
  const was = isBuilt(html);
  let page = html.replace(BUILT_RE, '');
  const cdn = (page.match(CDN) ?? []).length;
  page = page.replace(CDN, '');
  // A <style type="text/tailwindcss"> of the page's own goes into the build (the browser skips it).
  const own = [...page.matchAll(/<style[^>]*type=["']text\/tailwindcss["'][^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  const compiler = await compilerFor(own ? `${theme}\n${own}` : theme);
  const css = compiler.build(candidates(page));
  const words = classWords(page);
  const used = words.filter((w) => css.includes(`.${escapeClass(w)}`));
  if (!was && !force && !cdn && used.length < MIN_CLASSES) return { skipped: `${used.length} Tailwind class${used.length === 1 ? '' : 'es'} on the page` };
  const stock = words.filter((w) => !used.includes(w) && STOCK.test(w)).slice(0, 8);
  const banner = /^\/\*![^*]*\*\//.exec(css)?.[0] ?? '';
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const line = `<style id="studio-css">${BUILT_NOTE}${banner}${flat}</style>`;
  // On a line of its own, before </head>, so a rebuild finds the page as it was.
  const at = /<\/head>/i.exec(page);
  const before = at ? page.slice(0, at.index) : '';
  const out = at ? `${before}${before.endsWith('\n') ? '' : '\n'}${line}\n${page.slice(at.index)}`
    : /<head[^>]*>/i.test(page) ? page.replace(/<head[^>]*>/i, (m) => `${m}\n${line}`)
      : `${line}\n${page}`;
  return { html: out, bytes: line.length, ms: Date.now() - t0, classes: used.length, stock, cdn };
}

// What the model hears after a build.
export function buildNote(rel, r) {
  const parts = [`Agentic Coder built the styles for its ${r.classes} Tailwind classes into ${rel} (one <style id="studio-css"> line, ${(r.bytes / 1024).toFixed(1)} KB): it is rebuilt after every change, so change the classes, never that line.`];
  if (r.cdn) parts.push('It took out the Tailwind <script>/<link>, which needs the internet: the built line replaces it.');
  if (r.stock.length) parts.push(`These classes use colours that are not in the user's theme, so they draw nothing: ${r.stock.join(', ')}. Swap them for the theme's (paper, surface, subtle, ink, muted, line, accent, accent-ink, accent-soft, good, wait, bad and their -soft).`);
  return parts.join(' ');
}
