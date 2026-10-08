// The design library (8 Oct 2026, the owner: "can we make the agents better at ui design and design
// in general? can we download the latest ui designs and templates for the agentic coder to use?").
// Free UI libraries are downloaded from GitHub into the design studio's library/ folder and turned
// into studio pieces in the user's own look; brand looks (DESIGN.md files) become themes a request
// can ask for ("like Linear"); Anthropic's design skills come along as guides the model can Read.
// `/design update` fetches the newest of each and says what changed; `/design library` lists them.
// Their picks: every source and every design in it (a piece that cannot be pasted whole, or needs
// a library's own script, stays in the folder and is named, never picked); the user's look on every
// piece, a brand look only when asked.
//   where     <design studio>/library/ (private, never in git; STUDIO/library/… to the model):
//             library.json (the sources' versions and each piece's check), LICENSES/<source>.txt,
//             pieces/<source>/<kind>/<name>.html (HTML + Tailwind in the user's colours),
//             pages/<source>/<name>.html (whole pages, named, never pasted),
//             react/shadcn/<group>/<name>.tsx (React projects only), looks/<id>/ (theme.css, look.md,
//             DESIGN.md), skills/<name>/ (as their makers wrote them)
//   sources   SOURCES: the repo, its licence, what it gives
//   colours   toTokens: stock Tailwind colours (gray-900, indigo-600, white) and Flowbite's own names
//             (brand, heading, body) become the theme's (ink, accent, surface…), by what each one is
//             for and what it sits on (white text on the accent is accent-ink; on a dark band, paper);
//             dark: classes go (the theme's colours switch by themselves)
//   the check every piece, built and opened in headless Chrome by the caller's `check` (studio.mjs
//             checkPiece): a piece with a problem is kept and named, never picked
//   network   api.github.com (the newest commit), codeload.github.com (one archive a source)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, cpSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { contrastOf, passingColours } from '../flows/layoutcheck.mjs';

export const FOLDER = 'library';
export const SOURCES = [
  { id: 'hyperui', repo: 'markmead/hyperui', name: 'HyperUI', licence: 'MIT', gives: 'HTML + Tailwind pieces and 5 whole pages' },
  { id: 'flowbite', repo: 'themesberg/flowbite', name: 'Flowbite', licence: 'MIT', gives: 'HTML + Tailwind pieces' },
  { id: 'shadcn', repo: 'shadcn-ui/ui', name: 'shadcn/ui', licence: 'MIT', gives: 'React pieces, for React projects' },
  { id: 'design-md', repo: 'VoltAgent/awesome-design-md', name: 'awesome-design-md', licence: 'MIT', gives: 'brand looks (DESIGN.md)' },
  { id: 'anthropic', repo: 'anthropics/skills', name: "Anthropic's skills", licence: 'Apache-2.0', gives: 'design skills and 10 themes' },
];
// Anthropic's skills that are about design (brand-guidelines is Anthropic's own brand: left out).
export const SKILLS = ['frontend-design', 'canvas-design', 'theme-factory', 'web-artifacts-builder', 'algorithmic-art'];

export const libraryDir = (studio) => (studio ? join(studio, FOLDER) : null);
const manifestFile = (lib) => join(lib, 'library.json');

export function readManifest(lib) {
  try { return JSON.parse(readFileSync(manifestFile(lib), 'utf8')); } catch { return { version: 1, sources: {}, pieces: {}, looks: [] }; }
}

// ── Download ───────────────────────────────────────────────────────────────

const UA = { 'user-agent': 'agentic-coder', accept: 'application/vnd.github+json' };

// The newest commit of a source's default branch: { sha, date }.
export async function latestRef(src, { fetchImpl = fetch, signal } = {}) {
  const r = await fetchImpl(`https://api.github.com/repos/${src.repo}/commits/${src.branch ?? 'HEAD'}`, { headers: UA, signal });
  if (!r.ok) throw new Error(`GitHub answered ${r.status} for ${src.repo}${r.status === 403 ? ' (60 looks an hour without a sign-in: try again later)' : ''}`);
  const j = await r.json();
  return { sha: j.sha, date: j.commit?.committer?.date ?? null };
}

// The source's files at that commit, unpacked into a new folder: its path (the archive's one top folder).
export async function download(src, sha, { fetchImpl = fetch, signal } = {}) {
  const r = await fetchImpl(`https://codeload.github.com/${src.repo}/tar.gz/${sha}`, { headers: { 'user-agent': 'agentic-coder' }, signal });
  if (!r.ok) throw new Error(`GitHub answered ${r.status} for ${src.repo}'s files`);
  const box = mkdtempSync(join(tmpdir(), `agentic-library-${src.id}-`));
  const tgz = join(box, 'src.tgz');
  writeFileSync(tgz, Buffer.from(await r.arrayBuffer()));
  const out = join(box, 'tree');
  mkdirSync(out);
  // tar refuses paths that leave the folder (.. or /) by itself; nothing in it is ever run.
  const t = spawnSync('tar', ['-xzf', tgz, '-C', out], { timeout: 120_000, stdio: 'ignore' });
  rmSync(tgz, { force: true });
  if (t.status !== 0) throw new Error(`could not unpack ${src.repo}`);
  const top = readdirSync(out).filter((n) => !n.startsWith('.'));
  return { tree: top.length === 1 ? join(out, top[0]) : out, box };
}

// ── Reading the sources' files ────────────────────────────────────────────

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const list = (p) => { try { return readdirSync(p).filter((n) => !n.startsWith('.')).sort(); } catch { return []; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const words = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const single = (w) => (/ies$/.test(w) ? `${w.slice(0, -3)}y` : /(ss|us)$/.test(w) ? w : /(x|ch|sh)es$/.test(w) ? w.slice(0, -2) : /s$/.test(w) ? w.slice(0, -1) : w);
const title = (s) => String(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const sentence = (s, max = 160) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); const m = /^(.{20,}?[.!?])(\s|$)/.exec(t); return (m ? m[1] : t).slice(0, max); };

// A front matter's plain fields (title, description, a list of terms, the components' titles).
function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(String(text ?? '').replace(/\r/g, ''));
  const head = m ? m[1] : '';
  const field = (k) => (new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(head)?.[1] ?? '').trim().replace(/^['"]|['"]$/g, '');
  const listOf = (k) => { const at = new RegExp(`^${k}:\\s*\\n((?:\\s+-.*\\n?)+)`, 'm').exec(head); return at ? at[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean) : []; };
  return { head, field, listOf, body: m ? text.slice(m[0].length) : text };
}

// The words a request for each kind of piece uses, past the kind's own name (a request says
// "call to action", never "ctas"). Kinds not here go by their name and their source's words.
const KIND_WORDS = {
  accordion: 'faq, collapsible, expandable, disclosure', accordions: 'faq, collapsible, expandable, disclosure',
  alerts: 'alert, banner, callout, message, notice, warning', announcements: 'announcement, announcement bar, top bar, promo bar',
  avatar: 'avatar, profile picture, user image', badge: 'badge, tag, pill, label, chip', badges: 'badge, tag, pill, label, chip',
  banner: 'banner, cookie banner, promo banner', banners: 'banner, cookie banner, promo banner',
  'blog-cards': 'blog card, article card, post card, blog post', 'bottom-navigation': 'bottom navigation, tab bar, mobile nav',
  breadcrumb: 'breadcrumb, breadcrumbs', breadcrumbs: 'breadcrumb, breadcrumbs', 'button-group': 'button group, segmented buttons, toolbar',
  'button-groups': 'button group, segmented buttons, toolbar', buttons: 'button, buttons, call to action', card: 'card, cards',
  cards: 'card, cards', carousel: 'carousel, slider, slideshow', carts: 'shopping cart, cart, checkout, basket',
  charts: 'chart, graph, bar chart, line chart', 'chat-bubble': 'chat, chat bubble, message bubble, chat window, messages',
  checkbox: 'checkbox, check box', checkboxes: 'checkbox, check box', 'contact-forms': 'contact form, get in touch, contact us',
  ctas: 'call to action, cta, sign up section', datepicker: 'date picker, calendar input', 'details-list': 'details list, description list, key value, properties',
  'device-mockups': 'device mockup, phone mockup, laptop mockup', dividers: 'divider, separator', drawer: 'drawer, side panel, slide over, off canvas',
  dropdown: 'dropdown, dropdown menu, menu, select menu', dropdowns: 'dropdown, dropdown menu, menu', 'empty-content': 'empty state, nothing here, no results',
  'empty-states': 'empty state, nothing here, no results, blank state', faqs: 'faq, frequently asked questions, questions and answers',
  'feature-grids': 'features, feature grid, feature list, benefits', 'file-input': 'file upload, upload, attach file', 'file-uploaders': 'file upload, upload, drag and drop, dropzone',
  filters: 'filter, filters, facets, refine', 'floating-label': 'floating label, text field, input', footer: 'footer, site footer', footers: 'footer, site footer',
  forms: 'form, input, fields', gallery: 'gallery, image grid, photos', grids: 'grid, layout grid', headers: 'header, navbar, nav bar, top bar, navigation',
  indicators: 'indicator, status dot, notification dot', 'input-field': 'text field, input, text input', inputs: 'text field, input, text input',
  jumbotron: 'hero, hero section, jumbotron, banner', kbd: 'keyboard key, shortcut, kbd', 'list-group': 'list group, list, menu list',
  loaders: 'loader, spinner, loading, skeleton', 'logo-clouds': 'logo cloud, logos, customers, trusted by', media: 'media object, image with text',
  'mega-menu': 'mega menu, big menu, navigation', modal: 'modal, dialog, pop-up, popup', modals: 'modal, dialog, pop-up, popup',
  navbar: 'navbar, nav bar, header, top bar, navigation', 'newsletter-signup': 'newsletter, email signup, subscribe', 'number-input': 'number input, quantity, stepper input',
  pagination: 'pagination, pager, page numbers', 'phone-input': 'phone number input, telephone', polls: 'poll, vote, survey question',
  popover: 'popover, popup, hint', pricing: 'pricing, pricing table, plans, tiers, price', 'product-cards': 'product card, shop item, store item',
  'product-collections': 'product grid, product listing, collection, shop', progress: 'progress bar, progress', 'progress-bars': 'progress bar, progress',
  'qr-code': 'qr code', 'quantity-inputs': 'quantity, quantity input, stepper', radio: 'radio, radio buttons, choice', 'radio-groups': 'radio, radio buttons, choice group',
  range: 'slider, range, range input', 'range-inputs': 'slider, range, range input', rating: 'rating, stars, review stars', 'search-input': 'search, search bar, search box',
  sections: 'section, content section, hero', select: 'select, dropdown, picker', selects: 'select, dropdown, picker', 'side-menu': 'sidebar, side menu, side navigation',
  sidebar: 'sidebar, side menu, side navigation', skeleton: 'skeleton, loading placeholder', 'skip-links': 'skip link, accessibility',
  'speed-dial': 'speed dial, floating action button, fab', spinner: 'spinner, loader, loading', stats: 'stat, stats, metric, kpi, number, stat card, data card',
  stepper: 'stepper, steps, wizard, progress steps', steps: 'steps, stepper, wizard, progress steps', tables: 'table, data table, grid, rows',
  tabs: 'tabs, tab bar, segmented', 'team-sections': 'team, team members, people, about us', testimonials: 'testimonial, testimonials, reviews, quotes',
  textarea: 'textarea, text area, message box, comment box', textareas: 'textarea, text area, message box, comment box',
  timeline: 'timeline, activity, history, events', timelines: 'timeline, activity, history, events', timepicker: 'time picker, time input',
  toast: 'toast, notification, snackbar, alert', toasts: 'toast, notification, snackbar, alert', toggle: 'toggle, switch, on off', toggles: 'toggle, switch, on off',
  tooltips: 'tooltip, hint', typography: 'typography, text, headings', 'vertical-menu': 'vertical menu, side menu, navigation list', video: 'video, video player, media player',
  blockquote: 'blockquote, quote', headings: 'heading, title', images: 'image, picture, figure', lists: 'list, bullet list',
};

// ── Colours: stock Tailwind and Flowbite's names → the user's theme ─────────

const NEUTRAL = /^(?:slate|gray|grey|zinc|neutral|stone)$/;
const ACCENT = /^(?:blue|indigo|violet|purple|sky|cyan|teal|fuchsia)$/;
const GOOD = /^(?:green|emerald|lime)$/;
const WAIT = /^(?:yellow|amber|orange)$/;
const BAD = /^(?:red|rose|pink)$/;
const PROPS = '(bg|text|border(?:-[xytrblse])?|divide|ring-offset|ring|outline|from|via|to|fill|stroke|decoration|placeholder|caret|accent|shadow|inset-ring)';
const COLOUR_CLASS = new RegExp(`^${PROPS}-([a-z]+(?:-[a-z]+)*?)(?:-(\\d{2,3}))?(?:\\/(\\d{1,3}))?$`);
const STATE = { good: 'good', wait: 'wait', bad: 'bad' };

// Flowbite 4's own colour names (its themes' --color-…), by what each is for.
const FLOWBITE = {
  brand: 'accent', 'brand-strong': 'accent', 'brand-medium': 'accent-soft', 'brand-soft': 'accent-soft', 'brand-softer': 'accent-soft', 'brand-subtle': 'accent-soft', 'brand-light': 'accent-soft',
  'fg-brand': 'accent', 'fg-brand-strong': 'accent', 'fg-brand-subtle': 'accent',
  heading: 'ink', body: 'muted', 'body-subtle': 'muted', muted: 'muted',
  default: 'line', 'default-medium': 'line', 'default-strong': 'muted', 'default-subtle': 'line',
  'neutral-primary': 'surface', 'neutral-primary-soft': 'surface', 'neutral-primary-medium': 'surface', 'neutral-primary-strong': 'subtle',
  'neutral-secondary': 'subtle', 'neutral-secondary-soft': 'subtle', 'neutral-secondary-medium': 'subtle', 'neutral-secondary-strong': 'line', 'neutral-secondary-strongest': 'line',
  'neutral-tertiary': 'subtle', 'neutral-tertiary-soft': 'subtle', 'neutral-tertiary-medium': 'line', 'neutral-quaternary': 'line', 'neutral-quaternary-medium': 'line',
  success: 'good', 'success-strong': 'good', 'success-medium': 'good-soft', 'success-soft': 'good-soft', 'success-subtle': 'good-soft', 'fg-success': 'good', 'fg-success-strong': 'good',
  danger: 'bad', 'danger-strong': 'bad', 'danger-medium': 'bad-soft', 'danger-soft': 'bad-soft', 'danger-subtle': 'bad-soft', 'fg-danger': 'bad', 'fg-danger-strong': 'bad',
  warning: 'wait', 'warning-strong': 'wait', 'warning-medium': 'wait-soft', 'warning-soft': 'wait-soft', 'warning-subtle': 'wait-soft', 'fg-warning': 'wait', 'fg-warning-subtle': 'wait',
  dark: 'ink', 'dark-strong': 'ink', 'dark-soft': 'ink', 'dark-subtle': 'muted', 'dark-backdrop': 'ink', light: 'subtle', 'light-medium': 'subtle', 'light-subtle': 'subtle',
  disabled: 'subtle', 'fg-disabled': 'muted', buffer: 'subtle', 'buffer-medium': 'line', 'buffer-strong': 'line',
  'fg-yellow': 'wait', 'fg-warning-strong': 'wait', headings: 'ink', 'fg-purple': 'accent', 'fg-pink': 'bad', 'fg-cyan': 'accent', 'fg-indigo': 'accent', 'fg-lime': 'good',
};
// Flowbite's corner sizes past Tailwind's own.
const RADII = { base: 'lg', xxs: 'xs' };

const isBack = (prop) => prop === 'bg' || prop === 'from' || prop === 'via' || prop === 'to';
const isText = (prop) => ['text', 'fill', 'stroke', 'placeholder', 'decoration', 'caret', 'accent'].includes(prop);

// What a background class makes the element under its text: 'accent', 'dark', a state, or 'light'.
function backOf(colour) {
  if (!colour) return null;
  const base = colour.replace(/\/\d+$/, '');
  if (base === 'accent') return 'accent';
  if (base === 'ink') return 'dark';
  if (STATE[base]) return base;
  return 'light';
}

// One colour (a family and a shade, or a Flowbite name) as the theme's, for one property, on `on`
// (what the nearest background is). null: the class goes (a shadow's colour, say).
function themeColour(prop, name, shade, on) {
  const n = shade ? Number(shade) : null;
  const dark = on === 'dark' || on === 'accent' || on === 'good' || on === 'wait' || on === 'bad';
  if (prop === 'shadow' || prop === 'inset-ring') return null;
  if (name === 'transparent' || name === 'current' || name === 'inherit') return name;
  if (name === 'white') {
    if (isBack(prop)) return 'surface';
    if (isText(prop)) return on === 'accent' ? 'accent-ink' : on === 'dark' || STATE[on] ? 'paper' : 'accent-ink';
    return on === 'dark' ? 'paper/20' : 'surface';
  }
  if (name === 'black') return isBack(prop) ? 'ink' : isText(prop) ? 'ink' : 'line';
  const flow = FLOWBITE[name];
  if (flow) {
    if (isText(prop) && dark && (flow === 'ink' || flow === 'muted')) return flow === 'ink' ? 'paper' : 'paper/70';
    return flow;
  }
  if (NEUTRAL.test(name)) {
    if (isBack(prop)) return n == null || n <= 100 ? 'subtle' : n <= 300 ? 'line' : n <= 600 ? 'muted' : 'ink';
    if (isText(prop)) {
      if (on === 'dark') return n == null || n <= 300 ? 'paper' : n <= 600 ? 'paper/70' : 'paper/50';
      return n == null || n >= 700 ? 'ink' : n >= 400 ? 'muted' : 'line';
    }
    if (on === 'dark') return 'paper/20';
    return n == null || n <= 300 ? 'line' : n <= 600 ? 'muted' : 'ink';
  }
  const family = ACCENT.test(name) ? 'accent' : GOOD.test(name) ? 'good' : WAIT.test(name) ? 'wait' : BAD.test(name) ? 'bad' : null;
  if (!family) return undefined; // not a colour (bg-linear-to-r, text-sm, border-2)
  if (isBack(prop)) return n != null && n <= 200 ? `${family}-soft` : family;
  if (isText(prop)) {
    if (on === family && (n == null || n <= 300)) return family === 'accent' ? 'accent-ink' : 'paper';
    return n != null && n <= 200 && dark ? (family === 'accent' ? 'accent-ink' : 'paper') : family;
  }
  return n != null && n <= 200 ? `${family}-soft` : family;
}

// One class → the theme's: { cls, back } (cls null: dropped). `on`: the background it sits on.
export function tokenClass(cls, on = 'light') {
  const at = cls.lastIndexOf(':');
  const variants = at >= 0 ? cls.slice(0, at + 1) : '';
  let base = at >= 0 ? cls.slice(at + 1) : cls;
  if (/(^|:)dark:/.test(variants) || variants.startsWith('dark:')) return { cls: null };
  const bang = base.startsWith('!') ? '!' : '';
  if (bang) base = base.slice(1);
  const r = /^(rounded(?:-[trblse]{1,2})?)-(base|xxs)$/.exec(base);
  if (r) return { cls: `${variants}${bang}${r[1]}-${RADII[r[2]]}` };
  const m = COLOUR_CLASS.exec(base);
  if (!m) return { cls };
  const [, prop, name, shade, alpha] = m;
  const colour = themeColour(prop, name, shade, on);
  if (colour === undefined) return { cls };
  if (colour === null) return { cls: null };
  // A hover darker than the colour it starts from: the same colour, a little see-through.
  const hover = /(^|:)(hover|active|focus|focus-visible):$/.test(variants) && isBack(prop) && /^(accent|good|wait|bad|ink)$/.test(colour) && Number(shade) >= 600;
  const a = alpha ? `/${alpha}` : hover && !colour.includes('/') ? '/90' : '';
  const out = `${variants}${bang}${prop}-${colour.includes('/') && a ? colour.split('/')[0] : colour}${colour.includes('/') && !a ? '' : a}`;
  return { cls: out, back: !variants && isBack(prop) && prop === 'bg' ? backOf(colour) : null };
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'stop', 'use']);
const PLACEHOLDER = "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 3'%3E%3Crect width='4' height='3' fill='%23d9d5cc'/%3E%3C/svg%3E";

// A piece's HTML with every colour class in the theme's, pictures from the internet swapped for a
// plain block (the page opens with no internet), and the stock colours it still has listed.
export function toTokens(html) {
  const stack = [{ tag: '#root', back: 'light' }];
  const left = new Set();
  const out = String(html).replace(/<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (all, close, tag, attrs) => {
    if (!tag) return all;
    const t = tag.toLowerCase();
    if (close) {
      const i = stack.map((s) => s.tag).lastIndexOf(t);
      if (i > 0) stack.length = i;
      return all;
    }
    const on = stack[stack.length - 1].back;
    let back = null;
    let a = attrs.replace(/\bclass(Name)?\s*=\s*(["'])([\s\S]*?)\2/, (m, nm, q, val) => {
      // The element's own background first: its text sits on it.
      const classes = val.split(/\s+/).filter(Boolean);
      for (const c of classes) { const r = tokenClass(c, on); if (r.back) back = r.back; }
      const mine = back ?? on;
      const next = [];
      for (const c of classes) {
        const r = tokenClass(c, mine);
        if (r.cls == null) continue;
        if (!next.includes(r.cls)) next.push(r.cls);
      }
      for (const c of next) if (STOCK_LEFT.test(c)) left.add(c);
      return `class${nm ?? ''}=${q}${next.join(' ')}${q}`;
    });
    if (t === 'img') a = a.replace(/\bsrc\s*=\s*(["'])(?:https?:)?\/[^"']*\1/i, `src="${PLACEHOLDER}"`).replace(/\s+srcset\s*=\s*(["'])[^"']*\1/i, '');
    const selfClosed = /\/\s*$/.test(attrs) || VOID.has(t);
    if (!selfClosed) stack.push({ tag: t, back: back ?? on });
    return `<${tag}${a}>`;
  });
  return { html: out, left: [...left] };
}
const STOCK_LEFT = /^(?:[a-z0-9-]+:)*(?:bg|text|border(?:-[trblxyse])?|ring|ring-offset|outline|divide|from|via|to|fill|stroke|decoration|placeholder|caret|accent)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|white|black)(?:-\d{2,3})?(?:\/\d+)?$/;

// A piece file: its head comment (as the studio reads it) and the HTML.
function pieceFile({ name, forText, words: w, source, needs, html }) {
  const head = ['<!--', `# ${name}`, `- For: ${forText}`, `- Words: ${[...new Set(w.map((x) => x.trim().toLowerCase()).filter(Boolean))].join(', ')}`, `- Source: ${source}`];
  if (needs) head.push(`- Needs: ${needs}`);
  head.push('-->');
  return `${head.join('\n')}\n${html.trim()}\n`;
}

// Scripts a piece's HTML must not carry along: the library's own page scripts and styles.
const stripPage = (html) => html.replace(/<script\b[^>]*\bsrc=["'][^"']*["'][^>]*>\s*<\/script>\s*/gi, '').replace(/<link\b[^>]*>\s*/gi, '');
const bodyOf = (html) => { const m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html); return m ? m[1] : html; };
const GENERIC_TERMS = /^(?:cards?|sections?|pages?|components?|elements?|ui|layouts?|blocks?|buttons?|design)$/i;
const kindWords = (slug) => [words(slug), single(words(slug)), ...String(KIND_WORDS[slug] ?? '').split(',')];

// HyperUI: public/examples/<category>/<slug>/<n>.html, named by src/content/collection/<category>/<slug>.mdx.
export function fromHyperUI(tree) {
  const out = [];
  const ex = join(tree, 'public', 'examples');
  for (const category of list(ex)) {
    if (category === 'templates') {
      // Whole pages (templates/<name>/<n>.html): named with a request that fits, never pasted.
      for (const t of list(join(ex, category))) {
        for (const f of list(join(ex, category, t)).filter((n) => /^\d+\.html$/.test(n))) {
          const html = read(join(ex, category, t, f));
          if (!html) continue;
          const { html: page, left } = toTokens(stripPage(html));
          const n = f.replace(/\.html$/, '');
          out.push({ rel: `pages/hyperui/${t}/${n}.html`, text: pieceFile({ name: `${title(t)} · page ${n} (whole page)`, forText: `a whole ${words(t)} page, as a starting point`, words: [words(t), `${words(t)} page`, `${words(t)} template`], source: `HyperUI (MIT) · templates/${t}/${n}`, html: page }), left, page: true });
        }
      }
      continue;
    }
    for (const slug of list(join(ex, category))) {
      const meta = frontMatter(read(join(tree, 'src', 'content', 'collection', category, `${slug}.mdx`)) ?? '');
      const comps = meta.listOf('components').map((l) => (/title:\s*['"](.+?)['"]/.exec(l)?.[1] ?? '').trim());
      // A tag every piece of a kind could have ("card", "section") says nothing about which one fits.
      const terms = meta.listOf('terms').filter((w) => !GENERIC_TERMS.test(w.trim()));
      const brutal = category === 'neobrutalism';
      for (const f of list(join(ex, category, slug))) {
        const m = /^(\d+)\.html$/.exec(f);
        if (!m) continue; // the -dark copies: the theme's colours switch by themselves
        const raw = read(join(ex, category, slug, f));
        if (!raw) continue;
        const { html, left } = toTokens(stripPage(bodyOf(raw)));
        const variant = comps[Number(m[1]) - 1] || `Version ${m[1]}`;
        const kind = brutal ? `neobrutalism-${slug}` : slug;
        const base = brutal ? kindWords(slug).map((w) => w && `neobrutalism ${w.trim()}`).concat(['neobrutalism', 'brutalist']) : kindWords(slug).concat(terms);
        out.push({
          rel: `pieces/hyperui/${kind}/${m[1]}.html`,
          text: pieceFile({ name: `${title(slug)} · ${variant}`, forText: `${sentence(meta.field('description') || `${words(slug)} pieces`)}`, words: base, source: `HyperUI (MIT) · ${category}/${slug}/${m[1]}`, html }),
          left,
        });
      }
    }
  }
  return out;
}

// What a Flowbite example needs from Flowbite's own script (its data-… switches) to work.
const FLOWBITE_JS = /\bdata-(?:modal|dropdown|collapse|accordion|tooltip|popover|drawer|dismiss|tabs|carousel|dial|copy-to-clipboard|input-counter|datepicker|tooltip)[\w-]*\s*=/i;
const NEEDS_LIB = /\b(?:ApexCharts|simpleDatatables|new\s+Datepicker|flowbite)\b/;

// Flowbite: content/<group>/<kind>.md, each {{< example >}} … {{< /example >}} a piece, named by the heading above it.
export function fromFlowbite(tree) {
  const out = [];
  for (const group of ['components', 'forms', 'typography', 'plugins']) {
    for (const f of list(join(tree, 'content', group))) {
      if (!/\.md$/.test(f)) continue;
      const text = read(join(tree, 'content', group, f));
      if (!text) continue;
      const slug = f.replace(/\.md$/, '');
      const fm = frontMatter(text);
      const kindName = fm.field('title').replace(/^Tailwind CSS\s+/i, '').replace(/\s*-\s*Flowbite.*$/i, '') || title(slug);
      let heading = kindName;
      let lead = '';
      let n = 0;
      const re = /^(#{2,3})\s+(.+)$|\{\{<\s*example\b[^>]*>\}\}([\s\S]*?)\{\{<\s*\/example\s*>\}\}/gm;
      let m;
      while ((m = re.exec(fm.body))) {
        if (m[1]) {
          heading = m[2].trim();
          lead = sentence(fm.body.slice(m.index + m[0].length).split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('{{') && !p.startsWith('#')) ?? '');
          continue;
        }
        const html = m[3].trim();
        if (!html || /\{\{/.test(html)) continue;
        n++;
        const { html: conv, left } = toTokens(html);
        const needs = NEEDS_LIB.test(conv) ? 'a script library Flowbite uses (charts, tables or dates)' : FLOWBITE_JS.test(conv) ? "Flowbite's script for its data- switches (or a few lines of your own)" : null;
        out.push({
          rel: `pieces/flowbite/${slug}/${String(n).padStart(2, '0')}-${words(heading).replace(/ /g, '-').slice(0, 40) || 'example'}.html`,
          text: pieceFile({ name: `${kindName} · ${heading}`, forText: lead || sentence(fm.field('description')) || kindName, words: [...kindWords(slug), words(kindName), single(words(kindName))], source: `Flowbite (MIT) · ${group}/${slug} · ${heading}`, needs, html: conv }),
          left,
          needs: Boolean(needs),
        });
      }
    }
  }
  return out;
}

// shadcn/ui: React files as they are (a React project uses its own shadcn colours), for React projects only.
export function fromShadcn(tree) {
  const out = [];
  const reg = join(tree, 'apps', 'v4', 'registry', 'new-york-v4');
  const blockInfo = read(join(reg, 'blocks', '_registry.ts')) ?? '';
  const describe = (name) => new RegExp(`name:\\s*"${name}"[\\s\\S]{0,200}?description:\\s*"([^"]*)"`).exec(blockInfo)?.[1] ?? '';
  const nameWords = (n) => {
    const w = words(n.replace(/-\d+$/, '').replace(/^chart-/, ''));
    const parts = w.split(' ');
    return [w, parts.length > 1 && /^chart/.test(n) ? `${parts.slice(0, 2).reverse().join(' ')} chart` : '', /^chart/.test(n) ? `${parts[0]} chart` : '', parts[0]];
  };
  for (const group of ['blocks', 'charts', 'ui', 'examples']) {
    for (const f of list(join(reg, group))) {
      if (f.startsWith('_')) continue;
      const p = join(reg, group, f);
      let body;
      let name = f.replace(/\.tsx?$/, '');
      if (isDir(p)) {
        // A block: its page and its own components, in one file, each under its path.
        const files = [];
        const walk = (d, rel = '') => { for (const x of list(d)) { const q = join(d, x); if (isDir(q)) walk(q, `${rel}${x}/`); else if (/\.tsx?$/.test(x)) files.push([`${rel}${x}`, read(q) ?? '']); } };
        walk(p);
        if (!files.length) continue;
        body = files.map(([r, t]) => `// ── ${group}/${name}/${r}\n${t.trim()}`).join('\n\n');
      } else if (/\.tsx?$/.test(f)) body = read(p) ?? '';
      else continue;
      const desc = describe(name);
      const head = [`// # ${title(name)} (shadcn/ui, ${group})`, `// - For: ${desc || `${group === 'ui' ? 'the base component:' : group === 'charts' ? 'a chart:' : group === 'blocks' ? 'a whole block:' : 'an example:'} ${words(name.replace(/^chart-/, ''))}`}`, `// - Words: ${[...new Set([...nameWords(name), ...(group === 'blocks' ? kindWords(name.replace(/-\d+$/, '')) : [])].map((x) => x.trim()).filter(Boolean))].join(', ')}`, `// - Source: shadcn/ui (MIT) · apps/v4/registry/new-york-v4/${group}/${f}`, '// - React: yes'];
      out.push({ rel: `react/shadcn/${group}/${name}.tsx`, text: `${head.join('\n')}\n${body.trim()}\n`, react: true });
    }
  }
  return out;
}

// ── Looks ─────────────────────────────────────────────────────────────────

const HEX = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/i;
const long = (h) => (h.length === 4 ? `#${[...h.slice(1)].map((c) => c + c).join('')}` : h).toLowerCase();
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const mix = (a, b, t) => `#${[1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('')}`;
// The colour, moved until it reads at `need` against `on` (the same hue); itself when it already does.
function readable(fg, on, need) {
  if (contrastOf(fg, on) >= need) return fg;
  return passingColours(fg, on, need).text?.hex ?? (lum(on) > 0.4 ? '#1c1b18' : '#f7f6f2');
}

// The theme's colours from a look's own: every name filled, every pair readable.
export function lookColours(c) {
  const paper = long(c.paper);
  const darkLook = lum(paper) < 0.2;
  const sameMode = (h) => h && Math.abs(lum(long(h)) - lum(paper)) < 0.3;
  const surface = long(sameMode(c.surface) ? c.surface : (darkLook ? mix(paper, '#ffffff', 0.05) : mix(paper, '#ffffff', 0.6)));
  const subtle = long(sameMode(c.subtle) ? c.subtle : (darkLook ? mix(surface, '#ffffff', 0.06) : mix(surface, '#000000', 0.04)));
  const ink = readable(long(c.ink ?? (darkLook ? '#f2f2f2' : '#111111')), surface, 7);
  const muted = readable(long(c.muted ?? mix(ink, surface, 0.4)), surface, 4.6);
  const line = long(c.line && contrastOf(long(c.line), surface) < 3 ? c.line : mix(ink, surface, 0.85));
  let accent = long(c.accent ?? ink);
  accent = readable(accent, surface, 3.2);
  const accentInk = readable(long(c.accentInk ?? (lum(accent) > 0.4 ? '#111111' : '#ffffff')), accent, 4.6);
  const accentSoft = long(c.accentSoft ?? mix(accent, surface, 0.85));
  const state = (key, fallback) => readable(long(c[key] ?? fallback), surface, 4.6);
  const good = state('good', darkLook ? '#6fcf8f' : '#1f7a3d');
  const wait = state('wait', darkLook ? '#e8b04a' : '#8a5a00');
  const bad = state('bad', darkLook ? '#f28b82' : '#b42318');
  return {
    mode: darkLook ? 'dark' : 'light',
    vars: { paper, surface, subtle, ink, muted, line, accent, 'accent-ink': accentInk, 'accent-soft': accentSoft, good, 'good-soft': mix(good, surface, 0.85), wait, 'wait-soft': mix(wait, surface, 0.85), bad, 'bad-soft': mix(bad, surface, 0.85) },
  };
}

// A DESIGN.md: its colours, type and corners. Two shapes are in the wild: google-labs-code/design.md's
// front matter (colors:, typography:, rounded:), and the older prose one ("## 2. Color Palette & Roles",
// a line per colour: "- **Near Black** (`#121212`): Deepest background surface"), read by what each is for.
export function lookFromDesignMd(id, text) {
  const t = String(text ?? '').replace(/\r/g, '');
  const fm = /^---\n([\s\S]*?)\n---/.exec(t);
  const body = fm ? t.slice(fm[0].length) : t;
  const section = (re) => { const m = new RegExp(`^##\\s+(?:\\d+\\.\\s*)?(?:${re})[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'mi').exec(body); return m ? m[1] : ''; };
  const dd = section("Do'?s and Don'?ts|Do and Don'?t|Dos and Donts");
  const bullets = (re) => { const m = re.exec(dd); return m ? m[1].split('\n').map((l) => l.trim()).filter((l) => /^[-*]\s/.test(l)).slice(0, 3).map((l) => l.replace(/\*\*/g, '').replace(/`?\{colors\.[\w-]+\}`?/g, 'the accent')) : []; };
  const dos = bullets(/###\s*Do'?s?\b[^\n]*\n([\s\S]*?)(?=###|$)/i);
  const donts = bullets(/###\s*Don'?ts?\b[^\n]*\n([\s\S]*?)(?=###|$)/i);
  let c;
  let family = null;
  let radius = null;
  let about = '';
  if (fm) {
    const block = (k) => { const m = new RegExp(`^${k}:\\s*\\n((?:[ \\t]+.*\\n?)+)`, 'm').exec(`${fm[1]}\n`); return m ? m[1] : ''; };
    const colours = {};
    for (const l of block('colors').split('\n')) { const m = /^\s+([\w-]+):\s*["']?(#[0-9a-fA-F]{3,6})\b/.exec(l); if (m) colours[m[1]] = m[2]; }
    const pick = (...keys) => keys.map((k) => colours[k]).find(Boolean);
    if (!pick('canvas', 'background', 'surface', 'canvas-soft', 'bg')) return null;
    const ink = pick('ink', 'text', 'foreground', 'on-canvas', 'body-strong', 'body');
    const muted = [pick('ink-mute', 'ink-muted', 'muted', 'mute', 'ink-secondary', 'body-muted', 'ink-subtle', 'text-muted', 'body')].find((x) => x && x.toLowerCase() !== String(ink).toLowerCase());
    c = {
      paper: pick('canvas', 'background', 'bg', 'canvas-soft', 'surface'),
      surface: pick('surface-card', 'surface-1', 'card', 'surface', 'canvas-soft'),
      subtle: pick('surface-soft', 'surface-2', 'canvas-soft', 'surface-strong'),
      ink, muted,
      line: pick('hairline', 'border', 'divider', 'hairline-soft', 'hairline-strong'),
      accent: pick('primary', 'brand', 'accent', 'link'),
      accentInk: pick('on-primary', 'on-brand'),
      good: pick('success', 'semantic-success'), wait: pick('warning', 'semantic-warning'), bad: pick('error', 'danger', 'semantic-error'),
    };
    const fonts = block('typography');
    family = /^\s+body[\w-]*:\s*\n(?:\s{4,}.*\n)*?\s{4,}fontFamily:\s*(.+)$/m.exec(fonts)?.[1] ?? /fontFamily:\s*(.+)$/m.exec(fonts)?.[1] ?? null;
    radius = /^\s+(?:lg|md|card):\s*([\d.]+px)/m.exec(block('rounded'))?.[1] ?? null;
    about = /^description:\s*([\s\S]*?)$/m.exec(fm[1])?.[1] ?? '';
  } else {
    const pal = section('[^\\n]*Colou?r');
    const rows = [...pal.matchAll(/^###\s+(.+)$|^\s*[-*]\s+\*\*([^*]+)\*\*\s*\(`(#[0-9a-fA-F]{3,6})`\)\s*:?\s*(.*)$/gm)];
    let group = '';
    const lists = { paper: [], surface: [], ink: [], muted: [], line: [], accent: [], good: [], wait: [], bad: [] };
    for (const r of rows) {
      if (r[1]) { group = r[1].toLowerCase(); continue; }
      const what = `${group} ${r[2]} ${r[4]}`.toLowerCase();
      const hex = long(r[3]);
      if (/error|negative|danger|destructive/.test(what)) lists.bad.push(hex);
      if (/warning|caution/.test(what)) lists.wait.push(hex);
      if (/success|positive|confirm/.test(what)) lists.good.push(hex);
      if (/border|divider|separator|hairline|outline/.test(what)) lists.line.push(hex);
      if (/secondary text|muted|caption|tertiary|subdued|placeholder|inactive|meta/.test(what)) lists.muted.push(hex);
      if (/text|headline|heading|copy|ink/.test(what) && !/background|button|border/.test(what)) lists.ink.push(hex);
      if (/card|container|elevated|panel|surface/.test(what)) lists.surface.push(hex);
      if (/background|canvas|page|base surface|deepest/.test(what)) lists.paper.push(hex);
      if (/brand|accent|cta|call to action|primary|link|button|highlight/.test(what)) lists.accent.push(hex);
    }
    // Page, card, text and line colours are near-grey: a saturated one is a brand colour on a band or a button.
    const grey = (h) => { const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return Math.max(...v) - Math.min(...v) < 60; };
    const paper = lists.paper.find(grey) ?? lists.surface.find(grey);
    if (!paper) return null;
    const near = (list) => list.filter(grey).sort((a, b) => Math.abs(lum(a) - lum(paper)) - Math.abs(lum(b) - lum(paper)))[0];
    const surface = near(lists.surface.filter((h) => Math.abs(lum(h) - lum(paper)) < 0.3));
    const on = surface ?? paper;
    const ink = lists.ink.filter(grey).sort((a, b) => contrastOf(b, on) - contrastOf(a, on))[0];
    const muted = lists.muted.filter((h) => grey(h) && contrastOf(h, on) >= 3 && h !== ink).sort((a, b) => Math.abs(contrastOf(a, on) - 5) - Math.abs(contrastOf(b, on) - 5))[0];
    const line = lists.line.filter((h) => grey(h) && contrastOf(h, on) > 1.1 && contrastOf(h, on) < 3).sort((a, b) => contrastOf(a, on) - contrastOf(b, on))[0];
    const accent = lists.accent.find((h) => !grey(h) && contrastOf(h, on) >= 2) ?? lists.accent.find((h) => contrastOf(h, on) >= 2);
    c = { paper, surface, ink, muted, line, accent, good: lists.good[0], wait: lists.wait[0], bad: lists.bad[0] };
    const type = section('[^\\n]*Typograph');
    family = /\|\s*(?:Primary|Body|Base|Text)[^|]*\|\s*`?([^|`]+?)`?\s*\|/i.exec(type)?.[1] ?? /\*\*(?:Primary|Body)[^*]*\*\*:?\s*`?([^`\n]+)/i.exec(type)?.[1] ?? null;
    about = section('[^\\n]*(?:Theme|Atmosphere|Overview)').split(/\n\s*\n/).map((x) => x.trim()).find((x) => x && !x.startsWith('#')) ?? '';
  }
  if (family) family = family.trim().replace(/^["']|["']$/g, '').replace(/["']/g, '').replace(/\s*,\s*/g, ', ');
  if (family && (/^[\d.]/.test(family) || !/[a-z]/i.test(family))) family = null;
  return { id, name: lookName(id), ...lookColours(c), font: family, radius, about: sentence(about.replace(/\*\*/g, '').replace(/`/g, ''), 320), dos, donts };
}

// theme-factory's themes: four colours and two fonts.
export function lookFromThemeFactory(id, text) {
  const t = String(text ?? '');
  const rows = [...t.matchAll(/\*\*([^*]+)\*\*:\s*`(#[0-9a-fA-F]{6})`\s*-\s*([^\n]*)/g)].map((m) => ({ name: m[1], hex: m[2], role: m[3].toLowerCase() }));
  if (rows.length < 3) return null;
  const by = (re) => rows.find((r) => re.test(r.role))?.hex;
  const bg = by(/primary background|background/) ?? rows[0].hex;
  const ink = by(/text/) ?? (lum(long(bg)) < 0.2 ? '#f5f5f5' : '#1a1a1a');
  const accent = by(/^accent|primary accent|accent color|highlight/) ?? rows.find((r) => r.hex !== bg && r.hex !== ink)?.hex;
  const font = /\*\*Body Text\*\*:\s*([^\n]+)/.exec(t)?.[1].trim() ?? null;
  const c = lookColours({ paper: bg, ink, accent });
  return { id, name: /^#\s+(.+)$/m.exec(t)?.[1].trim() ?? title(id), ...c, font, radius: null, about: sentence(/^#.*\n+([^\n]+)/m.exec(t)?.[1] ?? '', 240), dos: [], donts: [] };
}

const NAMES = { 'linear.app': 'Linear', 'mistral.ai': 'Mistral', 'x.ai': 'xAI', 'together.ai': 'Together AI', 'opencode.ai': 'OpenCode', 'bmw-m': 'BMW M', 'dell-1996': 'Dell 1996', 'nintendo-2001': 'Nintendo 2001', theverge: 'The Verge', posthog: 'PostHog', elevenlabs: 'ElevenLabs', mongodb: 'MongoDB', hashicorp: 'HashiCorp', clickhouse: 'ClickHouse', runwayml: 'Runway', voltagent: 'VoltAgent', playstation: 'PlayStation', ibm: 'IBM', hp: 'HP', bmw: 'BMW', minimax: 'MiniMax', cal: 'Cal.com', 'wise': 'Wise' };
export const lookName = (id) => NAMES[id] ?? title(id.replace(/\.(app|ai|com)$/, ''));
// The words a request names a look by: "like Linear", "Stripe style", "in the style of Notion". A name
// that is also a common word (together, cal, wise, clay) only with its full name.
const COMMON = new Set(['together.ai', 'cal', 'wise', 'clay', 'expo', 'sanity', 'meta', 'warp', 'resend', 'lovable', 'uber', 'x.ai', 'hp', 'wired']);
export function lookNames(look) {
  const names = new Set([look.id, words(look.name)]);
  if (!COMMON.has(look.id)) names.add(words(look.id.replace(/\.(app|ai|com)$/, '')));
  if (look.id === 'x.ai') names.add('xai');
  if (look.id === 'cal') names.add('cal com');
  return [...names].filter(Boolean).map((n) => n.toLowerCase());
}

// The look a request asks for by name, or null: "like Linear", "Linear style", "the Stripe look".
export function askedLook(text, looks) {
  const t = ` ${String(text ?? '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ')} `;
  for (const look of looks) {
    for (const n of lookNames(look)) {
      const e = n.replace(/[.]/g, '\\.?').replace(/ /g, '\\s+');
      if (new RegExp(`\\b(?:like|as|of|resembles?|resembling|similar to|inspired by|in the style of|style of)\\s+(?:the\\s+)?${e}(?:'s)?\\b|\\b${e}(?:'s)?[\\s-]+(?:style|look|theme|inspired|vibe|feel|design|aesthetic)\\b`).test(t)) return look;
    }
  }
  return null;
}

// A look's theme.css: the base theme with the look's colours in both modes (a look is one mode:
// its page does not switch), its font first and its corners.
export function lookTheme(look, base) {
  const vars = Object.entries(look.vars).map(([k, v]) => `--${k}: ${v};`).join(' ');
  let t = String(base).replace(/:root\s*\{[^}]*\}/, `:root {\n  color-scheme: ${look.mode};\n  ${vars}\n}`)
    .replace(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{[^}]*\}\s*\}/, `@media (prefers-color-scheme: dark) {\n  :root { ${vars} }\n}`);
  if (look.font) t = t.replace(/--font-sans:[^;]*;/, `--font-sans: ${look.font.replace(/;/g, '')}, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;`);
  if (look.radius) t = t.replace(/--radius-card:[^;]*;/, `--radius-card: ${look.radius};`);
  return t;
}

// The look card that goes with a request that asks for it (≤ LOOK_CARD chars).
export const LOOK_CARD = 1400;
export function lookCard(look) {
  const v = look.vars;
  const lines = [
    `# ${look.name} look`,
    '- Look: yes',
    `- Words: ${lookNames(look).map((n) => `like ${n}, ${n} style`).join(', ')}`,
    '',
    '## Look',
    look.about ? `- ${look.about}` : null,
    `- ${look.mode === 'dark' ? 'Dark' : 'Light'} page: page ${v.paper}, cards ${v.surface}, text ${v.ink}, second text ${v.muted}, lines ${v.line}, accent ${v.accent} with ${v['accent-ink']} on it.`,
    look.font ? `- Type: ${look.font.split(',').slice(0, 2).join(',').trim()} (the system font stands in when it is not installed).` : null,
    look.radius ? `- Corners: ${look.radius} on cards.` : null,
    look.dos.length ? '\n## Do' : null, ...look.dos,
    look.donts.length ? "\n## Don't" : null, ...look.donts,
    '- Never the brand\'s name, logo or wording on the page: its colours, type and spacing only.',
  ].filter((l) => l != null);
  let text = lines.join('\n');
  while (text.length > LOOK_CARD && lines.length > 8) { lines.splice(lines.length - 2, 1); text = lines.join('\n'); }
  return text.slice(0, LOOK_CARD);
}

export function readLooks(lib) {
  const dir = lib ? join(lib, 'looks') : null;
  const out = [];
  for (const id of list(dir)) {
    try { out.push(JSON.parse(readFileSync(join(dir, id, 'look.json'), 'utf8'))); } catch {}
  }
  return out;
}

// ── The update ────────────────────────────────────────────────────────────

const hash = (t) => createHash('sha1').update(t).digest('hex').slice(0, 12);

// What one source's files become: [{ rel, text, left?, needs?, page?, react? }], plus looks and kept folders.
export function convert(src, tree) {
  if (src.id === 'hyperui') return { files: fromHyperUI(tree) };
  if (src.id === 'flowbite') return { files: fromFlowbite(tree) };
  if (src.id === 'shadcn') return { files: fromShadcn(tree) };
  if (src.id === 'design-md') {
    const looks = [];
    for (const id of list(join(tree, 'design-md'))) {
      const md = read(join(tree, 'design-md', id, 'DESIGN.md'));
      const look = md && lookFromDesignMd(id, md);
      if (look) looks.push({ look, files: [['DESIGN.md', md]] });
    }
    return { files: [], looks };
  }
  if (src.id === 'anthropic') {
    const looks = [];
    const themes = join(tree, 'skills', 'theme-factory', 'themes');
    for (const f of list(themes)) {
      const look = lookFromThemeFactory(f.replace(/\.md$/, ''), read(join(themes, f)));
      if (look) looks.push({ look: { ...look, id: `theme-${look.id}` }, files: [[f, read(join(themes, f))]] });
    }
    return { files: [], looks, folders: SKILLS.filter((s) => isDir(join(tree, 'skills', s))).map((s) => [join(tree, 'skills', s), `skills/${s}`]) };
  }
  return { files: [] };
}

const LICENCE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENCE'];
const licenceOf = (tree) => LICENCE_FILES.map((f) => read(join(tree, f))).find(Boolean);

// Fetch (or take from `from`: <from>/<source id>/, unpacked), convert and check every source.
//   studio   the design studio folder (the library goes in its library/)
//   check    async (pieceText, rel) => problems[] | null: the browser check of one piece (studio.mjs)
//   from     a folder of unpacked sources (tests, and a re-make with no internet)
//   only     source ids; force: make again even when the version is the same
//   say      (line) => void: progress for the screen
// Returns { sources: [{ id, name, ref, date, same, added, changed, removed, pieces, ok, held, looks, error }], took }.
//   recheck  check every piece again, not only the changed ones (after a change to the check itself)
export async function updateLibrary({ studio, check, from = null, only = null, force = false, recheck = false, say = () => {}, fetchImpl = fetch, signal, jobs = 4, baseTheme = '' } = {}) {
  const t0 = Date.now();
  if (!studio) throw new Error('no design studio folder (docs/private/design studio)');
  const lib = libraryDir(studio);
  mkdirSync(lib, { recursive: true });
  const manifest = readManifest(lib);
  const results = [];
  for (const src of SOURCES.filter((s) => !only || only.includes(s.id))) {
    const row = { id: src.id, name: src.name, licence: src.licence };
    let box = null;
    try {
      let tree;
      let ref;
      if (from) {
        tree = join(from, src.id);
        if (!isDir(tree)) { row.error = 'not in the folder given'; results.push(row); continue; }
        ref = { sha: `local-${hash(String(statSync(tree).mtimeMs))}`, date: new Date(statSync(tree).mtimeMs).toISOString() };
      } else {
        ref = await latestRef(src, { fetchImpl, signal });
        if (!force && !recheck && manifest.sources[src.id]?.ref === ref.sha) { results.push({ ...row, ...manifest.sources[src.id], same: true }); say(`${src.name}: already the newest (${ref.sha.slice(0, 7)}).`); continue; }
        say(`${src.name}: downloading ${ref.sha.slice(0, 7)}…`);
        ({ tree, box } = await download(src, ref.sha, { fetchImpl, signal }));
      }
      const made = convert(src, tree);
      const before = Object.fromEntries(Object.entries(manifest.pieces).filter(([, p]) => p.source === src.id));
      // The new files go into a folder of their own, then take the old ones' place.
      const stage = join(lib, `.new-${src.id}`);
      rmSync(stage, { recursive: true, force: true });
      const pieces = {};
      for (const f of made.files) {
        mkdirSync(join(stage, dirname(f.rel)), { recursive: true });
        writeFileSync(join(stage, f.rel), f.text);
        pieces[f.rel] = { source: src.id, hash: hash(f.text), chars: f.text.length, ...(f.react ? { react: true } : {}), ...(f.page ? { page: true } : {}), ...(f.needs ? { needs: true } : {}), ...(f.left?.length ? { left: f.left.slice(0, 6) } : {}) };
      }
      const looks = [];
      for (const { look, files } of made.looks ?? []) {
        const at = join(stage, 'looks', look.id);
        mkdirSync(at, { recursive: true });
        for (const [n, t] of files) writeFileSync(join(at, n), t ?? '');
        writeFileSync(join(at, 'look.json'), `${JSON.stringify({ ...look, source: src.id }, null, 1)}\n`);
        writeFileSync(join(at, 'look.md'), `${lookCard(look)}\n`);
        if (baseTheme) writeFileSync(join(at, 'theme.css'), lookTheme(look, baseTheme));
        looks.push(look.id);
      }
      for (const [abs, rel] of made.folders ?? []) cpSync(abs, join(stage, rel), { recursive: true });
      // The browser check: only pieces that changed (a kept check stands for the same text).
      const kept = (rel, p) => !recheck && before[rel]?.hash === p.hash && before[rel].check;
      const toCheck = Object.entries(pieces).filter(([rel, p]) => !p.react && !p.page && !p.needs && !kept(rel, p));
      for (const [rel, p] of Object.entries(pieces)) if (kept(rel, p)) p.check = before[rel].check;
      if (check && toCheck.length) {
        say(`${src.name}: checking ${toCheck.length} piece${toCheck.length === 1 ? '' : 's'} in a browser (about ${Math.max(1, Math.round((toCheck.length * 0.6) / jobs / 60))} min)…`);
        let next = 0;
        let done = 0;
        const worker = async () => {
          while (next < toCheck.length) {
            if (signal?.aborted) return;
            const [rel, p] = toCheck[next++];
            const text = readFileSync(join(stage, rel), 'utf8');
            let problems;
            try { problems = await check(text, rel); } catch (e) { problems = [`could not be checked: ${e.message}`]; }
            p.check = problems == null ? 'unchecked' : problems.length ? problems.slice(0, 3) : 'ok';
            if (p.left?.length && p.check === 'ok') p.check = [`colours not in the theme: ${p.left.join(', ')}`];
            done++;
            if (done % 100 === 0) say(`${src.name}: ${done} of ${toCheck.length} checked…`);
          }
        };
        await Promise.all(Array.from({ length: Math.min(jobs, toCheck.length) }, worker));
      }
      // Put the new files in place of the old ones of this source.
      for (const area of ['pieces', 'pages', 'react']) {
        const old = join(lib, area, src.id);
        const neu = join(stage, area, src.id);
        rmSync(old, { recursive: true, force: true });
        if (isDir(neu)) { mkdirSync(join(lib, area), { recursive: true }); renameSync(neu, old); }
      }
      for (const id of manifest.looks.filter((l) => l.source === src.id).map((l) => l.id)) rmSync(join(lib, 'looks', id), { recursive: true, force: true });
      for (const id of looks) { mkdirSync(join(lib, 'looks'), { recursive: true }); rmSync(join(lib, 'looks', id), { recursive: true, force: true }); renameSync(join(stage, 'looks', id), join(lib, 'looks', id)); }
      for (const [, rel] of made.folders ?? []) { rmSync(join(lib, rel), { recursive: true, force: true }); mkdirSync(dirname(join(lib, rel)), { recursive: true }); renameSync(join(stage, rel), join(lib, rel)); }
      rmSync(stage, { recursive: true, force: true });
      const licence = licenceOf(tree) ?? (made.folders?.length ? 'Apache-2.0: see each skill\'s LICENSE.txt' : null);
      if (licence) { mkdirSync(join(lib, 'LICENSES'), { recursive: true }); writeFileSync(join(lib, 'LICENSES', `${src.id}.txt`), `${src.name} · https://github.com/${src.repo} · ${ref.sha}\n\n${licence}`); }
      // The manifest: this source's pieces and looks in place of its old ones.
      for (const rel of Object.keys(before)) delete manifest.pieces[rel];
      Object.assign(manifest.pieces, pieces);
      manifest.looks = [...manifest.looks.filter((l) => l.source !== src.id), ...looks.map((id) => ({ id, source: src.id }))];
      const counts = {
        added: Object.keys(pieces).filter((r) => !before[r]).length,
        changed: Object.keys(pieces).filter((r) => before[r] && before[r].hash !== pieces[r].hash).length,
        removed: Object.keys(before).filter((r) => !pieces[r]).length,
        pieces: Object.keys(pieces).length,
        ok: Object.values(pieces).filter((p) => p.check === 'ok').length,
        held: Object.values(pieces).filter((p) => Array.isArray(p.check) || p.needs).length,
        react: Object.values(pieces).filter((p) => p.react).length,
        pages: Object.values(pieces).filter((p) => p.page).length,
        looks: looks.length,
        skills: (made.folders ?? []).length,
      };
      manifest.sources[src.id] = { repo: src.repo, ref: ref.sha, date: ref.date, fetched: new Date().toISOString(), licence: src.licence, ...counts };
      manifest.updated = new Date().toISOString();
      writeFileSync(manifestFile(lib), `${JSON.stringify(manifest, null, 1)}\n`);
      results.push({ ...row, ref: ref.sha, date: ref.date, ...counts });
      say(`${src.name}: ${[counts.react ? `${counts.react} React pieces` : counts.pieces ? `${counts.pieces} pieces (${counts.ok} pass the check${counts.pages ? `, ${counts.pages} whole pages` : ''})` : null, counts.looks ? `${counts.looks} looks` : null, counts.skills ? `${counts.skills} skills` : null].filter(Boolean).join(', ')}.`);
    } catch (e) {
      if (signal?.aborted) throw e;
      row.error = e.message;
      results.push(row);
      say(`${src.name}: ${e.message}.`);
    } finally {
      if (box) rmSync(box, { recursive: true, force: true });
    }
  }
  return { sources: results, took: (Date.now() - t0) / 1000, lib };
}

// The library's files for the picker: [{ file (from the studio folder), react, page, needs, check }].
export function libraryFiles(studio) {
  const lib = libraryDir(studio);
  if (!lib || !existsSync(manifestFile(lib))) return [];
  const m = readManifest(lib);
  return Object.entries(m.pieces).map(([rel, p]) => ({ file: `${FOLDER}/${rel}`, ...p })).filter((p) => existsSync(join(studio, p.file)));
}

// The newest change of the library (for a reader that keeps what it read).
export function libraryStamp(studio) {
  try { return statSync(manifestFile(libraryDir(studio))).mtimeMs; } catch { return 0; }
}

// /design library: a row per source, then the looks.
export function librarySummary(studio) {
  const lib = libraryDir(studio);
  const m = lib ? readManifest(lib) : { sources: {}, looks: [] };
  const rows = SOURCES.map((s) => {
    const r = m.sources[s.id];
    if (!r) return [s.name, `not downloaded yet · ${s.gives} · ${s.licence}`];
    const html = r.pieces - (r.react ?? 0) - (r.pages ?? 0);
    const what = [html ? `${html} pieces (${r.ok} picked from, ${r.held} kept but not picked)` : null, r.react ? `${r.react} React pieces` : null, r.pages ? `${r.pages} whole pages` : null, r.looks ? `${r.looks} looks` : null, r.skills ? `${r.skills} skills` : null].filter(Boolean).join(', ');
    return [s.name, `${what} · ${s.licence} · ${String(r.ref).slice(0, 7)} of ${String(r.date ?? '').slice(0, 10)}`];
  });
  const looks = readLooks(lib);
  if (looks.length) rows.push(['Looks', looks.map((l) => l.name).sort((a, b) => a.localeCompare(b)).join(', ')]);
  return { dir: lib, rows, updated: m.updated ?? null };
}

