// The design system (18 Oct 2026, the owner: "i want to drastically improve / optimize the Agentic Coder Design
// System"; their picks, plan A: every model the same, their look first and a DESIGN.md offered, a bank of whole pages
// of every kind). What a page request gets besides the pieces and cards (design.mjs, studio.mjs):
//   the guide   terminal/rules/DESIGN-GUIDE.md: how to use a look (colour, type, space, surfaces, phone), with every
//               design request on every model
//   the look    the project's DESIGN.md (DESIGN_MD_PLACES), else the user's own in the design folder
//               (DESIGN/DESIGN.md), which takes the rules card's place; in a project with its own, only the user's
//               "Your rules" section comes with it. The google-labs design.md shape: colours, type and corners in
//               its front matter (library.mjs lookFromDesignMd reads them; the build takes the project's)
//   the bank    whole pages in the user's look, one file each, by kind (DESIGN/bank/<kind>/<id>.html, a picture
//               beside it, bank.json): the closest of the kind asked for comes as its outline and its skeleton
//   init        /design init: a project's DESIGN.md written from the styles it already has (designMdFromStyles)
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, basename, extname } from 'node:path';
import { designDir } from './design.mjs';
import { lookFromDesignMd } from './library.mjs';
// Read once: under Bun with a literal path, so the one-file app carries it inside it (as prompt-files.mjs does with
// TOOLS.md); under Node (the bench's scripts import the app's parts) from the disk.
async function loadGuide() {
  try {
    if (typeof Bun !== 'undefined') {
      const text = (await import('../../rules/DESIGN-GUIDE.md', { with: { type: 'text' } })).default;
      return text.startsWith('/$bunfs/') ? readFileSync(text, 'utf8') : text;
    }
    return readFileSync(new URL('../../rules/DESIGN-GUIDE.md', import.meta.url), 'utf8');
  } catch {
    return '';
  }
}
const GUIDE = await loadGuide();

const DESIGN_MD_PLACES = ['DESIGN.md', 'docs/DESIGN.md', '.agentic/DESIGN.md', 'design/DESIGN.md'];
export const LOOK_CHARS = 3600; // of a DESIGN.md, in the note
const BANK_CHARS = 6000; // of a bank page's skeleton, in the note
const SCRIPT_CHARS = 7000; // of its script: given whole or not at all (a script cut in the middle teaches nothing); the bank's longest is 6,600
// The bank's pages start from one stylesheet (DESIGN/bank/base.css: the look's tokens, .card, .btn, .tag, .field, the
// toast and dialog), put in each page between these marks. A skeleton leaves it out and the note gives it once: before
// 18 Oct 2026 it took 5,500 of the skeleton's 6,000 characters, so a model saw about 250 of the page's own markup.
const BASE_RE = /\/\* base: [^*]*\*\/[\s\S]*?\/\* end base \*\/\n?/;
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

// The guide, as the model gets it (its own heading off: the note says what it is).
export const designGuide = () => String(GUIDE).replace(/^# .*\n+/, '').trim();

// ---- the look ------------------------------------------------------------------------------------------------------

export function projectDesignMd(cwd) {
  if (!cwd) return null;
  return DESIGN_MD_PLACES.map((p) => join(cwd, p)).find(isFile) ?? null;
}
export const yourDesignMd = (dir = designDir()) => (dir && isFile(join(dir, 'DESIGN.md')) ? join(dir, 'DESIGN.md') : null);

// Which look a page here takes: { from: 'project' | 'yours', abs, text, look } (look: lookFromDesignMd's, or null
// when its front matter names no colours), or null with neither.
export function lookFor(cwd, dir = designDir()) {
  const own = projectDesignMd(cwd);
  const abs = own ?? yourDesignMd(dir);
  if (!abs) return null;
  const text = read(abs);
  if (!text.trim()) return null;
  let look = null;
  try { look = lookFromDesignMd(own ? 'project' : 'yours', text); } catch { look = null; }
  return { from: own ? 'project' : 'yours', abs, text, look };
}

// A Markdown file's "## Name" section, whole (to the next ## heading), or ''.
export function mdSection(text, name) {
  const m = new RegExp(`^##\\s+${name}\\s*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'mi').exec(String(text ?? ''));
  return m ? m[1].trim() : '';
}
// Cut at a line end within max characters, saying where the rest is.
function cut(text, max, where) {
  const t = String(text ?? '').trim();
  if (t.length <= max) return t;
  const at = t.lastIndexOf('\n', max);
  return `${t.slice(0, at > max / 2 ? at : max)}\n(… the rest: Read ${where})`;
}

// The look's part of the note. A project's DESIGN.md comes with the user's own rules (not their colours).
export function lookNote(look, { cwd, dir = designDir(), max = LOOK_CHARS } = {}) {
  if (!look) return '';
  if (look.from === 'yours') return `[Look · your DESIGN.md · DESIGN/DESIGN.md: every page takes it unless the project has its own]\n${cut(look.text, max, 'DESIGN/DESIGN.md')}`;
  const rel = relative(cwd ?? '', look.abs) || basename(look.abs);
  const rules = mdSection(read(yourDesignMd(dir) ?? ''), 'Your rules');
  return `[Look · this project's ${rel}: its colours, type and corners win; keep to them]\n${cut(look.text, max, rel)}${rules ? `\n\n[Your rules · DESIGN/DESIGN.md: they hold in every project]\n${cut(rules, 1600, 'DESIGN/DESIGN.md')}` : ''}`;
}

// ---- the bank ------------------------------------------------------------------------------------------------------

// The kinds of page the bank holds, each with the words a request says it with (the owner's picks: dashboards and
// data, app screens, landing and pricing, reports and slides, diagrams and flowcharts).
export const KINDS = {
  dashboard: ['dashboard', 'admin', 'analytics', 'metrics', 'kpi', 'stats', 'overview', 'monitor', 'status page', 'control panel', 'desk', 'portfolio tracker', 'trading', 'kanban', 'project board', 'task board'],
  table: ['table', 'data grid', 'list of', 'records', 'spreadsheet', 'inbox', 'orders', 'users list', 'log', 'directory'],
  chart: ['chart', 'graph', 'plot', 'visualization', 'visualisation', 'sparkline', 'heatmap'],
  settings: ['settings', 'preferences', 'account page', 'profile page', 'configuration', 'options page'],
  auth: ['login', 'log in', 'sign in', 'sign-in', 'signup', 'sign up', 'register', 'password reset', 'forgot password', '2fa', 'verification code'],
  form: ['form', 'checkout', 'survey', 'questionnaire', 'booking', 'wizard', 'onboarding', 'application form', 'contact form'],
  empty: ['empty state', 'empty screen', '404', 'error page', 'not found', 'maintenance', 'offline'],
  landing: ['landing', 'homepage', 'home page', 'hero', 'marketing', 'product page', 'website', 'launch page', 'waitlist', 'coming soon'],
  pricing: ['pricing', 'plans', 'subscription', 'tiers', 'compare plans'],
  report: ['report', 'results', 'summary page', 'audit', 'findings', 'explainer', 'brief', 'postmortem', 'changelog', 'release notes', 'invoice', 'receipt', 'statement'],
  slides: ['slides', 'slide deck', 'deck', 'presentation', 'keynote', 'pitch'],
  diagram: ['diagram', 'architecture', 'org chart', 'mind map', 'sequence', 'swimlane', 'timeline', 'roadmap', 'gantt', 'map of'],
  flowchart: ['flowchart', 'flow chart', 'flow diagram', 'process flow', 'decision tree', 'user flow'],
  card: ['card', 'widget', 'tile', 'badge', 'notification', 'player', 'pass', 'ticket', 'post', 'calendar invite', 'to-do list', 'todo list', 'checklist'],
  // 18 Oct 2026, kinds the requests use that had no page: their own pages in the bank.
  calendar: ['calendar', 'agenda', 'month view', 'week view', 'event calendar'],
  chat: ['chat', 'messenger', 'messaging', 'direct messages', 'chat app', 'inbox chat'],
  docs: ['docs', 'documentation', 'api reference', 'api docs', 'knowledge base', 'help center', 'developer guide'],
  gallery: ['gallery', 'photo grid', 'image grid', 'lightbox', 'album', 'mood board', 'photo wall'],
  game: ['game', 'puzzle', 'memory game', 'tic tac toe', 'snake', 'wordle', 'quiz game', 'arcade', 'sudoku', 'crossword'],
  tool: ['calculator', 'converter', 'estimator', 'mortgage', 'loan', 'unit converter', 'generator'],
  article: ['blog', 'blog post', 'article', 'essay', 'newsletter', 'long read', 'case study', 'story page'],
};
const WORDS = Object.entries(KINDS).flatMap(([kind, words]) => words.map((w) => ({ kind, w, re: new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s-]+')}s?\\b`, 'i') })));

// The kind of page a request asks for, or null: the earliest word in it wins, the longer of two at one place.
export function kindOf(text) {
  const t = String(text ?? '');
  let best = null;
  for (const x of WORDS) {
    const m = x.re.exec(t);
    if (!m) continue;
    if (!best || m.index < best.at || (m.index === best.at && x.w.length > best.w.length)) best = { kind: x.kind, at: m.index, w: x.w };
  }
  return best?.kind ?? null;
}

const bankDir = (dir = designDir()) => (dir ? join(dir, 'bank') : null);
// bank.json: [{ id, kind, title, for, words: [], outline: [], works: [], general?, file, picture }]; the files beside it.
export function readBank(dir = designDir()) {
  const b = bankDir(dir);
  if (!b) return [];
  let list = [];
  try { list = JSON.parse(read(join(b, 'bank.json'))); } catch { return []; }
  return (Array.isArray(list) ? list : []).filter((e) => e && e.id && e.kind && e.file && isFile(join(b, e.file)));
}

// The page of the bank for a request: the kind asked for, then the most of its words the request uses. null: none of
// that kind (a page of another kind would pull it the wrong way).
export function pickBankPage(text, { dir = designDir(), bank = readBank(dir) } = {}) {
  const kind = kindOf(text);
  if (!kind) return null;
  const words = String(text ?? '').toLowerCase();
  const same = bank.filter((e) => e.kind === kind);
  if (!same.length) return null;
  const score = (e) => (e.words ?? []).filter((w) => words.includes(String(w).toLowerCase())).length;
  // A tie (often: no words in common) goes to the kind's general page, the one most requests of the kind can grow from.
  return [...same].sort((a, b) => score(b) - score(a) || Number(Boolean(b.general)) - Number(Boolean(a.general)) || a.id.localeCompare(b.id))[0];
}

// A page made short enough to hand over and still show how it is built: its scripts left out, long text cut to its
// first words, a run of more than two lines of the same shape kept to two, then cut at max characters.
export function skeletonOf(html, max = BANK_CHARS) {
  let t = String(html ?? '').replace(BASE_RE, '/* the base styles (DESIGN/bank/base.css) */\n').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script>/* … */</script>');
  t = t.replace(/>([^<>]{70,})</g, (m, s) => `>${s.trim().split(/\s+/).slice(0, 8).join(' ')} …<`);
  const lines = t.split('\n');
  const out = [];
  const shape = (l) => { const m = /^(\s*)<([a-z0-9-]+)((?:\s+class="[^"]*")?)/i.exec(l); return m ? `${m[1]}<${m[2]}${m[3]}` : null; };
  for (let i = 0; i < lines.length;) {
    const s = shape(lines[i]);
    let j = i + 1;
    while (s && j < lines.length && shape(lines[j]) === s) j++;
    const run = j - i;
    if (s && run > 2) { out.push(lines[i], lines[i + 1], `${/^\s*/.exec(lines[i])[0]}<!-- ${run - 2} more like these -->`); i = j; continue; }
    out.push(lines[i]);
    i++;
  }
  t = out.filter((l) => l.trim()).join('\n');
  return t.length <= max ? t : `${t.slice(0, t.lastIndexOf('\n', max))}\n<!-- … cut here -->`;
}

// A page's own scripts, as one text (those with a src left out).
export function scriptOf(html) {
  return [...String(html ?? '').matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim()).filter(Boolean).join('\n\n');
}
// The page as the model gets it: what it is for, its outline and how its parts work (works: its controls, in words),
// the skeleton, its script whole when it fits (the controls working is half of what the page shows; 18 Oct 2026,
// after 19 of the 40 pages had buttons that did nothing), and the base styles once (base: false points to the file).
export function bankNote(entry, { dir = designDir(), max = BANK_CHARS, scriptMax = SCRIPT_CHARS, base = true } = {}) {
  if (!entry) return '';
  const html = read(join(bankDir(dir), entry.file));
  if (!html) return '';
  const list = (xs) => (xs ?? []).map((o) => `- ${o}`).join('\n');
  const outline = list(entry.outline), works = list(entry.works);
  const script = scriptOf(html);
  const css = BASE_RE.test(html) ? read(join(bankDir(dir), 'base.css')).trim() : '';
  const parts = [
    `[Whole page · DESIGN/bank/${entry.file} · ${entry.title}: a finished ${entry.kind} page in the user's look]`,
    entry.for ?? '',
    outline ? `How it is laid out:\n${outline}` : '',
    works ? `How it works (every control does what it says):\n${works}` : '',
    `Its skeleton (text shortened, scripts after it):\n\`\`\`html\n${skeletonOf(html, max)}\n\`\`\``,
    script && script.length <= scriptMax ? `Its script: one state, one draw from it, every control wired:\n\`\`\`js\n${script}\n\`\`\`` : script ? `Its script is ${script.length.toLocaleString('en-US')} characters: Read DESIGN/bank/${entry.file} to see how its parts work.` : '',
    css ? (base ? `The base styles it starts from (DESIGN/bank/base.css, your look as CSS):\n\`\`\`css\n${css}\n\`\`\`` : 'Its base styles (your look as CSS: tokens, .card, .btn, .tag, .field, the toast and dialog) are in DESIGN/bank/base.css.') : '',
    `Build yours on this structure, its spacing and its working parts, with the request's own content; where the request asks for something else, the request wins. Read DESIGN/bank/${entry.file} for the whole page.`,
  ];
  return parts.filter(Boolean).join('\n');
}

// ---- styles: a look asked for by name -------------------------------------------------------------------------------

// A style is a DESIGN.md of its own in DESIGN/styles/<id>.md (18 Oct 2026, the owner's ask for "taste cards for
// specific styles": editorial, terminal, playful, brutalist…). Its front matter names the words a request says it
// with (words: "editorial, magazine, serif"), and may point to pictures and pages to look at (pictures:, links:).
// A request that says one gets it in place of the look; the user's own rules still hold.
const STYLE_CHARS = 3000;
const stylesDir = (dir = designDir()) => (dir ? join(dir, 'styles') : null);
const frontKey = (text, key) => (new RegExp(`^${key}:\\s*"?([^"\\n]*)"?\\s*$`, 'm').exec(/^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '')?.[1] ?? '').trim();
const listOf = (s) => s.split(',').map((w) => w.trim()).filter(Boolean);
export function readStyleCards(dir = designDir()) {
  const d = stylesDir(dir);
  let files = [];
  try { files = readdirSync(d).filter((f) => f.endsWith('.md') && !/^readme/i.test(f)).sort(); } catch { return []; }
  return files.map((f) => {
    const text = read(join(d, f));
    return { id: f.replace(/\.md$/, ''), file: f, name: frontKey(text, 'name') || f.replace(/\.md$/, ''), words: listOf(frontKey(text, 'words')), pictures: listOf(frontKey(text, 'pictures')), links: listOf(frontKey(text, 'links')), text };
  }).filter((s) => s.words.length);
}
// "Add a dark mode" or "clean up the code" ask for a switch or a tidy, not a style.
const NOT_A_STYLE = /\b(?:dark|light)[- ]mode\b|\bclean(?:ed|ing)?[- ]?up\b/gi;
// The style a request names, or null: the earliest word in it wins, the longer of two at one place.
export function pickStyle(text, { dir = designDir(), styles = readStyleCards(dir) } = {}) {
  const t = String(text ?? '').replace(NOT_A_STYLE, ' ');
  let best = null;
  for (const s of styles) for (const w of s.words) {
    const m = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s-]+')}\\b`, 'i').exec(t);
    if (m && (!best || m.index < best.at || (m.index === best.at && w.length > best.w.length))) best = { style: s, at: m.index, w };
  }
  return best ? { ...best.style, word: best.w } : null;
}
export function styleNote(style, { dir = designDir(), max = STYLE_CHARS } = {}) {
  if (!style) return '';
  const rules = mdSection(read(yourDesignMd(dir) ?? ''), 'Your rules');
  const look = [style.pictures.length ? `Pictures of it to look at: ${style.pictures.map((p) => `DESIGN/styles/${p}`).join(', ')}` : '', style.links.length ? `Pages in this style: ${style.links.join(', ')}` : ''].filter(Boolean).join('\n');
  return `[Style · DESIGN/styles/${style.file} · asked for ("${style.word}"): its colours, type and shapes replace your look for this page. The whole page below uses your look's tokens (--paper, --surface, --ink, --accent…): give them this style's values]\n${cut(style.text.replace(/^---\n[\s\S]*?\n---\n*/, ''), max, `DESIGN/styles/${style.file}`)}${look ? `\n${look}` : ''}${rules ? `\n\n[Your rules · DESIGN/DESIGN.md: they hold in every style]\n${cut(rules, 1600, 'DESIGN/DESIGN.md')}` : ''}`;
}

// ---- /design init: a DESIGN.md from a project's own styles ----------------------------------------------------------

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', 'vendor', '.cache', '.turbo', 'target', '.agentic']);
// The style text of a project: its .css/.scss/.less files and the <style> of its .html pages (at most 300 files).
function stylesOf(cwd, { limit = 300 } = {}) {
  const found = [];
  const walk = (d, depth) => {
    if (depth > 6 || found.length >= limit) return;
    let names = [];
    try { names = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      if (found.length >= limit) return;
      if (e.name.startsWith('.') && e.name !== '.agentic') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, depth + 1); continue; }
      const ext = extname(e.name).toLowerCase();
      if (['.css', '.scss', '.less'].includes(ext)) found.push({ file: relative(cwd, p), text: read(p).slice(0, 400_000) });
      else if (['.html', '.htm', '.vue', '.svelte'].includes(ext)) {
        const css = [...read(p).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
        if (css.trim()) found.push({ file: relative(cwd, p), text: css.slice(0, 400_000) });
      }
    }
  };
  walk(cwd, 0);
  return found;
}

const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;
const hex6 = (c) => { const h = c.toLowerCase(); return h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h; };
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => { const [r, g, b] = rgbOf(h).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const sat = (h) => { const [r, g, b] = rgbOf(h); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
const hue = (h) => { const [r, g, b] = rgbOf(h).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (x * 60 + 360) % 360; };
const count = (list) => { const m = new Map(); for (const x of list) m.set(x, (m.get(x) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
// What a custom property's name says it is for.
const ROLE_NAMES = [
  ['paper', /(^|-)(bg|background|paper|canvas|page|base)($|-)/], ['surface', /(surface|card|panel|raise|elevated|sheet)/],
  ['muted', /(muted|mute|subtle|secondary|dim|faint|soft-text|text-2|fg-2)/], ['ink', /(^|-)(text|ink|fg|foreground|body|copy)($|-)/],
  ['line', /(border|line|hairline|divider|stroke|rule)/], ['accent', /(accent|primary|brand|link|blue|focus)/],
  ['good', /(success|good|ok|green|positive)/], ['wait', /(warning|warn|caution|amber|yellow|pending)/], ['bad', /(danger|error|bad|red|negative|critical)/],
];

// The look a project's styles show: { colours: { paper, surface, ink, muted, line, accent, accentInk, good, wait, bad },
// dark: {…} (from a dark block's properties), font, sizes: [px…], radius, step, files }.
export function readStyles(cwd) {
  const files = stylesOf(cwd);
  const all = files.map((f) => f.text).join('\n');
  const light = {}, dark = {};
  // :root / html / body custom properties, and the same names inside a dark block.
  const DARK = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?\})\s*\}|\[data-theme=["']?dark["']?\][^{]*\{([^}]*)\}|\.dark\s*\{([^}]*)\}/gi;
  const darkBlocks = [...all.matchAll(DARK)].map((m) => m[1] ?? m[2] ?? m[3] ?? '').join('\n');
  const props = (text, into) => { for (const m of text.matchAll(/--([\w-]+)\s*:\s*([^;}{]+)/g)) { const v = m[2].trim(); const h = v.match(HEX)?.[0]; if (h && !(m[1] in into)) into[m[1]] = hex6(h); } };
  props(darkBlocks, dark);
  props(all.replace(DARK, ''), light);
  const byRole = (vars) => {
    const out = {};
    for (const [name, value] of Object.entries(vars)) {
      const role = ROLE_NAMES.find(([, re]) => re.test(name.toLowerCase()))?.[0];
      if (role && !out[role]) out[role] = value;
      if (/on-?(accent|primary|brand)|accent-?(ink|fg|text|contrast)/.test(name.toLowerCase()) && !out.accentInk) out.accentInk = value;
    }
    return out;
  };
  const colours = byRole(light);
  // What no property names: from the colours the styles use most, by what they look like.
  const used = count([...all.matchAll(HEX)].map((m) => hex6(m[0])));
  const greys = used.filter(([c]) => sat(c) < 0.18).map(([c]) => c);
  const vivid = used.filter(([c]) => sat(c) >= 0.35).map(([c]) => c);
  const lights = greys.filter((c) => lum(c) > 0.7), darks = greys.filter((c) => lum(c) < 0.08), mids = greys.filter((c) => lum(c) >= 0.15 && lum(c) <= 0.55);
  colours.paper ??= lights[0] ?? '#ffffff';
  colours.surface ??= lights.find((c) => c !== colours.paper) ?? colours.paper;
  colours.ink ??= darks[0] ?? '#1a1a1a';
  colours.muted ??= mids[0] ?? '#666666';
  colours.line ??= lights.find((c) => c !== colours.paper && c !== colours.surface && lum(c) < 0.9) ?? '#e2e2e2';
  colours.accent ??= vivid.find((c) => { const h = hue(c); return h >= 180 && h <= 290; }) ?? vivid[0] ?? '#2563eb';
  colours.good ??= vivid.find((c) => { const h = hue(c); return h >= 90 && h <= 170; }) ?? '#2e7d4f';
  colours.wait ??= vivid.find((c) => { const h = hue(c); return h >= 30 && h < 60; }) ?? '#a8670b';
  colours.bad ??= vivid.find((c) => { const h = hue(c); return h < 20 || h > 340; }) ?? '#c0392b';
  colours.accentInk ??= lum(colours.accent) > 0.45 ? '#111111' : '#ffffff';
  const font = count([...all.matchAll(/font-family\s*:\s*([^;}{]+)/gi)].map((m) => m[1].trim().replace(/\s+/g, ' ')).filter((f) => !/inherit|monospace|ui-monospace|menlo|courier/i.test(f)))[0]?.[0] ?? null;
  const px = (v, n) => (/rem$/.test(v) ? Math.round(n * 16) : Math.round(n));
  const sizes = count([...all.matchAll(/font-size\s*:\s*([\d.]+)(px|rem)\b/gi)].map((m) => px(m[2], Number(m[1])))).slice(0, 7).map(([v]) => v).sort((a, b) => a - b);
  const radius = count([...all.matchAll(/border-radius\s*:\s*([\d.]+)(px|rem)\b/gi)].map((m) => px(m[2], Number(m[1]))).filter((v) => v > 0 && v < 40))[0]?.[0] ?? null;
  const spaces = [...all.matchAll(/(?:padding|margin|gap)\s*:\s*([^;}{]+)/gi)].flatMap((m) => [...m[1].matchAll(/([\d.]+)(px|rem)/g)].map((x) => px(x[2], Number(x[1])))).filter((v) => v > 0);
  const step = spaces.length && spaces.filter((v) => v % 8 === 0).length / spaces.length >= 0.6 ? 8 : spaces.length ? 4 : null;
  return { colours, dark: byRole(dark), font, sizes, radius, step, files: files.map((f) => f.file) };
}

// The DESIGN.md text for a project (google-labs design.md: front matter, then sections in words).
function designMdFromStyles(cwd, { name = basename(cwd), today = new Date() } = {}) {
  const s = readStyles(cwd);
  if (!s.files.length) return null;
  const c = s.colours, d = s.dark;
  const date = today.toISOString().slice(0, 10);
  const y = (v) => JSON.stringify(v);
  const front = ['---', `name: ${y(name)}`, `description: ${y(`The look of ${name}, read from its styles by Agentic Coder (/design init) on ${date}. Pages made here follow it; edit it to change them.`)}`,
    'colors:', ...[['canvas', c.paper], ['surface-card', c.surface], ['ink', c.ink], ['ink-mute', c.muted], ['hairline', c.line], ['primary', c.accent], ['on-primary', c.accentInk], ['success', c.good], ['warning', c.wait], ['error', c.bad]].map(([k, v]) => `  ${k}: ${y(v)}`),
    ...(s.font ? ['typography:', '  body:', `    fontFamily: ${s.font}`, `    fontSize: ${s.sizes.find((v) => v >= 14 && v <= 18) ?? 16}px`] : []),
    ...(s.radius ? ['rounded:', `  md: ${s.radius}px`] : []), '---'];
  const darkLine = Object.keys(d).length ? `Dark mode (from the styles' dark block): ${Object.entries(d).map(([k, v]) => `${k} ${v}`).join(', ')}.` : 'The styles have no dark block: in dark mode keep the same roles, with a dark paper and light ink, at the same contrast.';
  const body = [
    `# ${name}: design`, '',
    '## Overview',
    `Read from ${s.files.length} style file${s.files.length === 1 ? '' : 's'} (${s.files.slice(0, 6).join(', ')}${s.files.length > 6 ? ', …' : ''}). New pages and parts here should look like they were always part of it.`, '',
    '## Colors',
    `Paper ${c.paper}, cards ${c.surface}, text ${c.ink}, second text ${c.muted}, lines ${c.line}. One accent, ${c.accent}, with ${c.accentInk} on it. States only: done ${c.good}, waiting ${c.wait}, failed ${c.bad}.`,
    darkLine, '',
    '## Typography',
    `${s.font ? `Font: ${s.font}. ` : ''}${s.sizes.length ? `Sizes in use: ${s.sizes.map((v) => `${v}px`).join(', ')}; keep to these.` : 'Keep to one small scale of sizes.'}`, '',
    '## Layout and spacing',
    s.step ? `Spacing comes in steps of ${s.step}px.` : 'Keep spacing to one step and its multiples.', '',
    '## Shapes',
    s.radius ? `Corners: ${s.radius}px on cards and controls.` : 'One corner radius throughout.', '',
    "## Do's and Don'ts", '', '### Do',
    '- Use the colours above by their roles, and the type sizes already in use.',
    '- Match the spacing and corners of the pages that are here.', '',
    "### Don't",
    '- Bring in new colours, fonts or a framework this project does not use.',
    '- Use the accent for decoration: it marks the main action and what is selected.', '',
  ];
  return `${front.join('\n')}\n\n${body.join('\n')}`;
}

// Writes it at the project's top as DESIGN.md: { abs, text } or { exists } / { none } (no styles to read).
export function writeDesignMd(cwd, opts = {}) {
  const there = projectDesignMd(cwd);
  if (there) return { exists: there };
  const text = designMdFromStyles(cwd, opts);
  if (!text) return { none: true };
  const abs = join(cwd, 'DESIGN.md');
  writeFileSync(abs, text);
  return { abs, text };
}

// Offered once a project (the owner's pick "Your look, then offer one"): <home>/design-md-offers.json, by folder.
export function offeredBefore(home, cwd) {
  try { return Boolean(JSON.parse(read(join(home, 'design-md-offers.json')))[cwd]); } catch { return false; }
}
export function markOffered(home, cwd, answer) {
  let all = {};
  try { all = JSON.parse(read(join(home, 'design-md-offers.json'))) ?? {}; } catch { all = {}; }
  all[cwd] = { answer, at: new Date().toISOString() };
  try { mkdirSync(home, { recursive: true }); writeFileSync(join(home, 'design-md-offers.json'), `${JSON.stringify(all, null, 2)}\n`); } catch {}
}

// "Not quite": a rule the user keeps for every page, under "## Your rules" in their DESIGN.md. → the file, or null.
export function addRule(rule, dir = designDir()) {
  const abs = yourDesignMd(dir);
  const line = `- ${String(rule ?? '').replace(/\s+/g, ' ').trim()}`;
  if (!abs || line.length < 6) return null;
  const text = read(abs);
  if (text.includes(line)) return abs;
  const at = /^##\s+Your rules\s*$/mi.exec(text);
  let next;
  if (!at) next = `${text.trimEnd()}\n\n## Your rules\n${line}\n`;
  else {
    const after = text.slice(at.index + at[0].length);
    const end = /^##\s/m.exec(after);
    const cutAt = at.index + at[0].length + (end ? end.index : after.length);
    next = `${text.slice(0, cutAt).trimEnd()}\n${line}\n${end ? `\n${text.slice(cutAt)}` : ''}`;
  }
  writeFileSync(abs, next);
  return abs;
}

// A project worth offering a DESIGN.md for: styles of its own besides the pages this message made.
export function hasStylesOf(cwd, made = []) {
  const mine = new Set(made.map((p) => String(p)));
  return stylesOf(cwd, { limit: 40 }).some((f) => !mine.has(f.file));
}

// What the design system adds to a page request's notes (agent-notes.mjs), in this order: the look (or the style the
// request names), the guide, the
// bank's page of the kind asked for. Every model gets all three (the owner, 18 Oct 2026: "i do want this to be apart of
// any model used in the agentic coder"); one with less than 64k of memory a shorter look and a shorter skeleton, since
// its room is for the page it writes. → { text, names, look, page }.
export function systemNotes(text, { cwd, ctx = 65536, dir = designDir() } = {}) {
  const look = lookFor(cwd, dir);
  const style = pickStyle(text, { dir });
  const big = ctx >= 65536;
  const parts = [];
  const names = [];
  // A style the request names takes the look's place (the user's rules come with it); else the look.
  if (style) { parts.push(styleNote(style, { dir, max: big ? STYLE_CHARS : 1600 })); names.push(`style/${style.id}`); }
  else if (look) { parts.push(lookNote(look, { cwd, dir, max: big ? LOOK_CHARS : 1800 })); names.push(look.from === 'project' ? relative(cwd, look.abs) || 'DESIGN.md' : 'your DESIGN.md'); }
  parts.push(`[Design guide · how to use the look]\n${designGuide()}`);
  names.push('the design guide');
  const page = pickBankPage(text, { dir });
  const pageText = page ? bankNote(page, big ? { dir } : { dir, max: 2400, scriptMax: 1500, base: false }) : '';
  if (pageText) { parts.push(pageText); names.push(`bank/${page.id}`); }
  return { text: parts.join('\n\n'), names, look, style, page: pageText ? page : null };
}
