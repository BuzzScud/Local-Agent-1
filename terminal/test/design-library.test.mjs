// The design library (8 Oct 2026, the owner: "can we download the latest ui designs and templates for
// the agentic coder to use?"): free libraries' pieces turned into the user's colours, brand looks a
// request asks for by name, /design update from unpacked sources (no internet here), the picker with
// the library's pieces beside the user's own, a look's colours in the built page, and a page request
// answered with no page sent back once to write it.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-library-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const L = await import('../src/agent/library.mjs');
const S = await import('../src/agent/studio.mjs');
const D = await import('../src/agent/design.mjs');
const { Agent } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');
const { contrastOf } = await import('../src/flows/layoutcheck.mjs');

const put = (root, rel, text) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text); };

test('stock Tailwind and Flowbite colours become the theme\'s, by what each is for and what it sits on', () => {
  const t = (c, on) => L.tokenClass(c, on).cls;
  expect(t('text-gray-900')).toBe('text-ink');
  expect(t('text-gray-500')).toBe('text-muted');
  expect(t('bg-gray-50')).toBe('bg-subtle');
  expect(t('bg-white')).toBe('bg-surface');
  expect(t('border-gray-200')).toBe('border-line');
  expect(t('bg-indigo-600')).toBe('bg-accent');
  expect(t('hover:bg-indigo-700')).toBe('hover:bg-accent/90');
  expect(t('bg-green-100')).toBe('bg-good-soft');
  expect(t('text-red-700')).toBe('text-bad');
  expect(t('dark:bg-gray-900')).toBe(null); // the theme switches by itself
  expect(t('shadow-gray-200')).toBe(null);
  expect(t('text-sm')).toBe('text-sm');
  expect(t('bg-brand')).toBe('bg-accent'); // Flowbite's names
  expect(t('text-heading')).toBe('text-ink');
  expect(t('rounded-base')).toBe('rounded-lg');
  // White text: on the accent it is accent-ink; on a dark band, paper (so dark mode keeps it readable).
  const { html, left } = L.toTokens('<div class="bg-indigo-600"><p class="text-white">a</p></div><section class="bg-gray-900"><h2 class="text-white">b</h2><p class="text-gray-400">c</p></section><img src="https://images.unsplash.com/x.jpg" alt="x">');
  expect(html).toContain('<p class="text-accent-ink">');
  expect(html).toContain('<h2 class="text-paper">');
  expect(html).toContain('<p class="text-paper/70">');
  expect(html).not.toContain('unsplash');
  expect(left).toEqual([]);
});

const MD = `---
version: alpha
name: Shop-design
description: "A calm shop: deep navy text on white, one violet accent."
colors:
  primary: "#533afd"
  on-primary: "#ffffff"
  ink: "#0d253d"
  ink-mute: "#64748d"
  canvas: "#ffffff"
  canvas-soft: "#f6f9fc"
  hairline: "#e3e8ee"
typography:
  body-md:
    fontFamily: "Inter, system-ui, sans-serif"
rounded:
  md: 8px
---

## Do's and Don'ts

### Do
- Keep the accent for buttons.

### Don't
- Don't use the accent for body text.
`;
const PROSE = `# Design System Inspired by Night Radio

## 1. Visual Theme & Atmosphere

A dark music player where the art brings the colour.

## 2. Color Palette & Roles

### Primary Brand
- **Radio Green** (\`#1ed760\`): Primary brand accent, play buttons, CTAs
- **Near Black** (\`#121212\`): Deepest background surface
- **Dark Surface** (\`#181818\`): Cards, containers, elevated surfaces

### Text
- **White** (\`#ffffff\`): primary text
- **Silver** (\`#b3b3b3\`): Secondary text, muted labels

## 7. Do's and Don'ts

### Do
- Let the album art carry the colour.
`;

test('a DESIGN.md becomes a look (front matter or prose), every pair readable, and a request names it', () => {
  const a = L.lookFromDesignMd('stripe', MD);
  expect(a.mode).toBe('light');
  expect(a.vars.accent).toBe('#533afd');
  expect(a.vars.ink).toBe('#0d253d');
  expect(a.font).toBe('Inter, system-ui, sans-serif');
  expect(a.radius).toBe('8px');
  expect(a.dos).toEqual(['- Keep the accent for buttons.']);
  const b = L.lookFromDesignMd('night-radio', PROSE);
  expect(b.mode).toBe('dark');
  expect(b.vars.paper).toBe('#121212');
  expect(b.vars.accent).toBe('#1ed760');
  // Every look reads: text on cards at 7:1 or more, second text at 4.5:1.
  for (const l of [a, b]) {
    expect(contrastOf(l.vars.ink, l.vars.surface)).toBeGreaterThanOrEqual(7);
    expect(contrastOf(l.vars.muted, l.vars.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastOf(l.vars['accent-ink'], l.vars.accent)).toBeGreaterThanOrEqual(4.5);
  }
  const card = L.lookCard(a);
  expect(card.length).toBeLessThanOrEqual(L.LOOK_CARD);
  expect(card).toContain('Never the brand');
  const looks = [a, b, { ...a, id: 'together.ai', name: 'Together AI' }];
  expect(L.askedLook('make a pricing page like Stripe', looks)?.id).toBe('stripe');
  expect(L.askedLook('a player in the Night Radio style', looks)?.id).toBe('night-radio');
  expect(L.askedLook('put the parts together like a pro', looks)).toBe(null); // a common word is no look
  expect(L.askedLook('make a pricing page', looks)).toBe(null);
  // Its theme: the look's colours in both modes, its font first, its corners.
  const theme = L.lookTheme(a, S.DEFAULT_THEME);
  expect(theme).toContain('--accent: #533afd;');
  expect(theme).toContain('color-scheme: light;');
  expect(theme).not.toContain('#1f66bd');
});

// Five small sources, unpacked as GitHub gives them.
function sources() {
  const from = mkdtempSync(join(tmpdir(), 'agentic-library-from-'));
  put(from, 'hyperui/LICENSE', 'MIT License\n');
  put(from, 'hyperui/src/content/collection/application/stats.mdx', "---\ntitle: Stats\ndescription: Stat blocks for key metrics. More text.\nterms:\n  - analytics\ncomponents:\n  - { title: 'Title and value', dark: true }\n  - { title: 'Title, value and icon', dark: true }\n---\n");
  put(from, 'hyperui/public/examples/application/stats/1.html', '<!doctype html><html><head><link href="/component.css" rel="stylesheet" /></head><body class="p-6"><article class="rounded-lg border border-gray-100 bg-white p-6"><p class="text-sm text-gray-500">Profit</p><p class="text-2xl font-medium text-gray-900">$404.32</p></article></body></html>');
  put(from, 'hyperui/public/examples/application/stats/1-dark.html', '<body class="bg-gray-900"></body>');
  put(from, 'hyperui/public/examples/application/stats/2.html', '<body><article class="rounded-lg border border-gray-100 bg-white p-6"><p class="text-sm text-gray-500">Sales</p><p class="text-2xl text-gray-900">1,204</p></article></body>');
  put(from, 'hyperui/public/examples/templates/storefront/1.html', '<body><main class="bg-white"><h1 class="text-gray-900">Shop</h1></main></body>');
  put(from, 'flowbite/LICENSE.md', 'MIT\n');
  put(from, 'flowbite/content/components/modal.md', '---\ntitle: Tailwind CSS Modal - Flowbite\n---\n\n## Default modal\n\nUse the modal to show a dialog.\n\n{{< example >}}\n<button data-modal-target="m" class="bg-brand text-white">Open</button>\n{{< /example >}}\n');
  put(from, 'flowbite/content/components/badge.md', '---\ntitle: Tailwind CSS Badge - Flowbite\n---\n\n## Default badge\n\nA small label.\n\n{{< example >}}\n<span class="bg-brand-softer text-fg-brand-strong rounded-base px-2">New</span>\n{{< /example >}}\n');
  put(from, 'shadcn/LICENSE.md', 'MIT\n');
  put(from, 'shadcn/apps/v4/registry/new-york-v4/charts/chart-bar-stacked.tsx', 'export function ChartBarStacked() { return <div className="bg-card">chart</div> }\n');
  put(from, 'shadcn/apps/v4/registry/new-york-v4/blocks/login-03/page.tsx', 'export default function Page() { return <main className="bg-background">login</main> }\n');
  put(from, 'design-md/LICENSE', 'MIT\n');
  put(from, 'design-md/design-md/stripe/DESIGN.md', MD);
  put(from, 'design-md/design-md/broken/DESIGN.md', '# nothing here\n');
  put(from, 'anthropic/skills/frontend-design/SKILL.md', '---\nname: frontend-design\n---\n# Frontend Design\n');
  put(from, 'anthropic/skills/frontend-design/LICENSE.txt', 'Apache License 2.0\n');
  put(from, 'anthropic/skills/theme-factory/themes/ocean-depths.md', '# Ocean Depths\n\nA calm maritime theme.\n\n## Color Palette\n\n- **Deep Navy**: `#1a2332` - Primary background color\n- **Teal**: `#2d8b8b` - Accent color for highlights\n- **Cream**: `#f1faee` - Text and light backgrounds\n\n## Typography\n\n- **Body Text**: DejaVu Sans\n');
  return from;
}

test('/design update: every source made into pieces, looks and skills, checked, listed, and only what changed checked again', async () => {
  const studio = mkdtempSync(join(tmpdir(), 'agentic-library-studio-'));
  const from = sources();
  const checked = [];
  const check = async (text, rel) => { checked.push(rel); return /Sales/.test(text) ? ['Text is too faint'] : []; };
  const r = await L.updateLibrary({ studio, from, check, baseTheme: S.DEFAULT_THEME });
  const by = Object.fromEntries(r.sources.map((x) => [x.id, x]));
  expect(by.hyperui).toMatchObject({ pieces: 3, ok: 1, held: 1, pages: 1, added: 3 });
  expect(by.flowbite).toMatchObject({ pieces: 2, ok: 1, held: 1 }); // the modal needs Flowbite's script: kept, never checked or picked
  expect(by.shadcn).toMatchObject({ pieces: 2, react: 2 });
  expect(by['design-md']).toMatchObject({ looks: 1 });
  expect(by.anthropic).toMatchObject({ looks: 1, skills: 2 }); // frontend-design and theme-factory
  const lib = L.libraryDir(studio);
  const stat = readFileSync(join(lib, 'pieces/hyperui/stats/1.html'), 'utf8');
  expect(stat).toMatch(/^<!--\n# Stats · Title and value\n- For: Stat blocks for key metrics\.\n- Words: stats, stat, /);
  expect(stat).toContain('class="rounded-lg border border-line bg-surface p-6"');
  expect(stat).not.toContain('component.css');
  expect(existsSync(join(lib, 'pieces/hyperui/stats/1-dark.html'))).toBe(false);
  expect(readFileSync(join(lib, 'pieces/flowbite/badge/01-default-badge.html'), 'utf8')).toContain('class="bg-accent-soft text-accent rounded-lg px-2"');
  expect(existsSync(join(lib, 'react/shadcn/charts/chart-bar-stacked.tsx'))).toBe(true);
  expect(existsSync(join(lib, 'looks/stripe/theme.css'))).toBe(true);
  expect(existsSync(join(lib, 'looks/theme-ocean-depths/look.md'))).toBe(true);
  expect(existsSync(join(lib, 'skills/frontend-design/LICENSE.txt'))).toBe(true);
  expect(readFileSync(join(lib, 'LICENSES/hyperui.txt'), 'utf8')).toContain('MIT License');
  expect(checked.sort()).toEqual(['pieces/flowbite/badge/01-default-badge.html', 'pieces/hyperui/stats/1.html', 'pieces/hyperui/stats/2.html']);
  const sum = L.librarySummary(studio);
  expect(sum.rows.find((x) => x[0] === 'HyperUI')[1]).toContain('2 pieces (1 picked from, 1 kept but not picked), 1 whole pages');
  // Again, one piece changed and one gone: only the changed one is checked; the counts say so.
  put(from, 'hyperui/public/examples/application/stats/1.html', '<body><article class="bg-white p-4"><p class="text-gray-900">Profit</p></article></body>');
  rmSync(join(from, 'hyperui/public/examples/templates'), { recursive: true });
  checked.length = 0;
  const again = await L.updateLibrary({ studio, from, check, only: ['hyperui'], force: true });
  expect(again.sources[0]).toMatchObject({ pieces: 2, changed: 1, removed: 1, added: 0 });
  expect(checked).toEqual(['pieces/hyperui/stats/1.html']);
  expect(existsSync(join(lib, 'pages/hyperui'))).toBe(false);
});

test('the picker: the library beside the user\'s own (theirs first), only checked pieces, one version of a kind, React pieces in a React project', async () => {
  const studio = mkdtempSync(join(tmpdir(), 'agentic-library-pick-'));
  put(studio, 'styles/theme.css', S.DEFAULT_THEME);
  put(studio, 'components/cards/stat-card.html', '<!--\n# Stat card\n- For: one number\n- Words: stat card, metric\n-->\n<article class="bg-surface">x</article>');
  await L.updateLibrary({ studio, from: sources(), check: async (text) => (/Sales/.test(text) ? ['faint'] : []), baseTheme: S.DEFAULT_THEME });
  const names = (t, o = {}) => S.pickPieces(t, { dir: studio, ...o }).pieces.map((p) => p.file);
  expect(names('make a stat card for revenue')).toEqual(['components/cards/stat-card.html']); // the user's own wins a tie
  expect(names('make a stats block for analytics')[0]).toBe('library/pieces/hyperui/stats/1.html'); // the checked version, not the held one
  expect(names('make a stats block for analytics')).not.toContain('library/pieces/hyperui/stats/2.html');
  expect(names('add a modal dialog')).toEqual([]); // needs Flowbite's script: named in the folder, never handed over
  expect(names('make a stats block for analytics', { library: false })).toEqual([]);
  expect(names('build a stacked bar chart', { react: true })).toEqual(['library/react/shadcn/charts/chart-bar-stacked.tsx']);
  expect(names('build a stacked bar chart')).toEqual([]); // not a React project: no React pieces
  const notes = S.studioNotes(S.pickPieces('build a stacked bar chart', { dir: studio, react: true }), studio);
  expect(notes.text).toMatch(/^The design studio has React pieces for this React project/);
  expect(S.usesReact(studio)).toBe(false);
  put(studio, 'package.json', '{"dependencies":{"react":"19.1.0"}}');
  expect(S.usesReact(studio)).toBe(true);
});

test('a look: asked for by name or set with /design look, written on the page and built in its colours', async () => {
  const studio = mkdtempSync(join(tmpdir(), 'agentic-library-look-'));
  put(studio, 'styles/theme.css', S.DEFAULT_THEME);
  await L.updateLibrary({ studio, from: sources(), only: ['design-md'], baseTheme: S.DEFAULT_THEME });
  expect(S.pickLookFor('a pricing card like Stripe', null, studio)?.id).toBe('stripe');
  expect(S.pickLookFor('a pricing card', 'stripe', studio)?.id).toBe('stripe');
  expect(S.pickLookFor('a pricing card', null, studio)).toBe(null);
  const look = S.pickLookFor('like stripe', null, studio);
  expect(S.lookNote(look)).toContain('<meta name="studio-look" content="stripe">');
  const page = S.withLook('<!doctype html><html><head><title>p</title></head><body class="bg-paper text-ink"><a class="bg-accent text-accent-ink p-2 rounded-card">Buy</a><p class="text-muted">x</p><p class="border-line">y</p></body></html>', 'stripe');
  expect(page).toContain('<meta name="studio-look" content="stripe">');
  const built = await S.buildStyles(page, { theme: S.themeFor(page, studio) });
  expect(built.html).toContain('#533afd');
  expect(built.html).not.toContain('#1f66bd');
  const mine = await S.buildStyles(page.replace(/<meta name="studio-look"[^>]*>/, ''), { theme: S.themeFor('', studio) });
  expect(mine.html).toContain('#1f66bd');
  expect(D.designSettings({ look: 'stripe' }).look).toBe('stripe');
  expect(D.designSettings({}).look).toBe(null);
});

test('diagrams, slide decks and posters are page requests; "the presentation layer" is not', () => {
  for (const t of ['draw a flowchart of the login flow', 'make a slide deck about our Q3 results', 'create a poster for the bake sale', 'make an org chart of the team', 'sketch a mind map of my thesis']) expect(D.isDesignRequest(t)).toBe(true);
  for (const t of ['create the presentation layer for the API', 'write a function that draws a diagram', 'what is a diagram?']) expect(D.isDesignRequest(t)).toBe(false);
  expect(D.askedThing('draw a flowchart of the login flow').head).toBe('flowchart');
});

test('a page asked for and none written: sent back once to write it, not to search an empty folder', async () => {
  const proj = mkdtempSync(join(tmpdir(), 'agentic-library-page-'));
  const remote = { ...MODELS[DEFAULT_MODEL], remote: { model: 'big-coder' } };
  const fake = await startFakeServer([
    { text: 'Main thing: a file card\nSize: 380 px\nParts: icon, name\nLook: warm paper\nStates: none\nPhone: full width' },
    { tool: { name: 'Write', args: { path: 'file-card.html', content: '<!doctype html><html><head><meta charset="utf-8"><title>f</title></head><body><p>Report.pdf</p></body></html>' } } },
    { text: 'Made file-card.html.' },
  ], { delayMs: 0 });
  try {
    const a = new Agent({ url: fake.url, model: remote, cwd: proj, system: systemPrompt({ cwd: proj, git: 'none' }), memory: false, flows: false, verify: false, mode: 'bypass', confirmPlan: false, way: 'model', hooks: ['look-first', 'real-files'] });
    const notes = [];
    a.on('note', (n) => notes.push(n.text));
    await a.send('Build one self-contained HTML file for a file card. Show a file-type badge and the name.');
    expect(notes).toContain('It answered without writing the page (only its plan); asked it to write it.');
    expect(notes.some((n) => /answered without looking at the project/.test(n))).toBe(false);
    expect(existsSync(join(proj, 'file-card.html'))).toBe(true);
  } finally { fake.close(); }
});

const { needs } = await import('./needs.mjs');
const { layoutCheck, findChrome } = await import('../src/flows/layoutcheck.mjs');
test.skipIf(needs('chrome', findChrome))('the layout check: a closed <details> hides all but its summary (no "text on top of text" for an FAQ)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-library-details-'));
  const page = (open) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>FAQ</title><style>body{font:16px system-ui;margin:24px}details p{margin-top:-1.4em}</style></head><body><details${open ? ' open' : ''}><summary>How do I get started?</summary><p>Open the app and follow the steps on the first screen.</p></details></body></html>`;
  writeFileSync(join(dir, 'closed.html'), page(false));
  writeFileSync(join(dir, 'open.html'), page(true));
  const closed = await layoutCheck(join(dir, 'closed.html'), { clicks: false });
  expect(closed.problems.filter((p) => /on top of other text/.test(p))).toEqual([]);
  const open = await layoutCheck(join(dir, 'open.html'), { clicks: false });
  expect(open.problems.some((p) => /on top of other text/.test(p))).toBe(true); // opened, the overlap is real and still found
}, 60_000);

test('a call written as text with its tag cut short (<Search> for <function=Search>, no <tool_call>) runs as the call', async () => {
  const { toolCallInText } = await import('../src/agent/agent-said.mjs');
  expect(toolCallInText('Let me look:\n\n<Search>\n<parameter=pattern>\nfile-card\n</parameter>\n</function>')).toEqual({ name: 'Search', args: '{"pattern":"file-card"}', before: 'Let me look:' });
  expect(toolCallInText('<div class="card">\n<p>Report.pdf</p>\n</div>')).toBe(null); // a page is no call
  const proj = mkdtempSync(join(tmpdir(), 'agentic-library-textcall-'));
  const remote = { ...MODELS[DEFAULT_MODEL], remote: { model: 'big-coder' } };
  const fake = await startFakeServer([
    { text: '<Write>\n<parameter=path>\nfile-card.html\n</parameter>\n<parameter=content>\n<!doctype html><html><head><meta charset="utf-8"><title>f</title></head><body><p>Report.pdf</p></body></html>\n</parameter>\n</function>' },
    { text: 'Made file-card.html.' },
  ], { delayMs: 0 });
  try {
    const a = new Agent({ url: fake.url, model: remote, cwd: proj, system: systemPrompt({ cwd: proj, git: 'none' }), memory: false, flows: false, verify: false, mode: 'bypass', confirmPlan: false, way: 'model' });
    await a.send('Build one self-contained HTML file for a file card. Show the name.');
    expect(readFileSync(join(proj, 'file-card.html'), 'utf8')).toContain('Report.pdf');
  } finally { fake.close(); }
});
