// The design studio (src/agent/studio.mjs): UI pieces read from a folder, the
// ones that fit a page request sent with it in the example card's place, the
// CSS for the page's Tailwind classes built into the page after every change
// (offline), and that built line folded when the model reads the page. Built
// against a fixture folder, never the real one.
import { test, expect, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const FIX = join(tmpdir(), `agentic-studio-fixture-${process.pid}`);
const CARDS = join(tmpdir(), `agentic-studio-cards-${process.pid}`);
process.env.AGENTIC_STUDIO_DIR = FIX;
process.env.AGENTIC_DESIGN_DIR = CARDS;
const S = await import('../src/agent/studio.mjs');
const D = await import('../src/agent/design.mjs');
const { resolvePath, prepare, execute } = await import('../src/agent/tools.mjs');

const piece = (name, words, body) => `<!--\n# ${name}\n- For: ${name.toLowerCase()}\n- Words: ${words}\n-->\n${body}\n`;
const STAT = '<article class="rounded-card border border-line bg-surface p-5"><h3 class="text-muted">Revenue</h3><p class="text-4xl font-semibold tabular-nums">$48,920</p></article>';
function fixture() {
  rmSync(FIX, { recursive: true, force: true });
  rmSync(CARDS, { recursive: true, force: true });
  for (const k of ['cards', 'nav', 'popups']) mkdirSync(join(FIX, 'components', k), { recursive: true });
  writeFileSync(join(FIX, 'components', 'cards', 'stat-card.html'), piece('Stat card', 'stat card, data card, metric, kpi, revenue, sparkline', STAT));
  writeFileSync(join(FIX, 'components', 'cards', 'notification.html'), piece('Notification card', 'notification, toast, inbox item, dismiss', '<div class="bg-surface p-4">New message</div>'));
  writeFileSync(join(FIX, 'components', 'cards', 'product-card.html'), piece('Product card', 'product card, product, shop, item, cart', '<div class="bg-surface p-4">Headphones</div>'));
  writeFileSync(join(FIX, 'components', 'nav', 'tabs.html'), piece('Tabs', 'tabs, tab bar, sections', '<div role="tablist" class="flex gap-1">Tabs</div>'));
  writeFileSync(join(FIX, 'components', 'popups', 'modal.html'), piece('Modal dialog', 'modal, dialog, popup', `<dialog class="rounded-card">${'<p class="p-4">a long line of the dialog</p>'.repeat(120)}</dialog>`));
  writeFileSync(join(FIX, 'components', 'cards', 'notes.txt'), 'not a piece');
  for (const d of ['your rules', 'opus']) mkdirSync(join(CARDS, d), { recursive: true });
  writeFileSync(join(CARDS, 'your rules', 'rules.md'), '# The rules\n- For: every page\n- Words: page\n- Always: yes\n\n## Fit\n- Never scroll sideways.\n');
  writeFileSync(join(CARDS, 'opus', 'widget.md'), '# Widget\n- For: a widget\n- Words: widget, card, kanban\n\n## Look\n- Colours: `--bg:#fff`\n');
}
fixture();
afterAll(() => { rmSync(FIX, { recursive: true, force: true }); rmSync(CARDS, { recursive: true, force: true }); });

test('a piece is its head comment (name, For, Words) and its HTML; pieces are read kind by kind, .html only', () => {
  const p = S.parsePiece(piece('Stat card', 'Stat card, KPI ,  metric', STAT));
  expect(p).toMatchObject({ name: 'Stat card', for: 'stat card', words: ['stat card', 'kpi', 'metric'] });
  expect(p.body.startsWith('<article')).toBe(true);
  const { kinds, pieces } = S.readPieces(FIX);
  expect(kinds.map((k) => k.name)).toEqual(['cards', 'nav', 'popups']);
  expect(pieces.map((x) => x.file)).not.toContain('components/cards/notes.txt');
  expect(pieces.find((x) => x.name === 'Tabs').file).toBe('components/nav/tabs.html');
});

test('the best piece comes; the next only when it fits nearly as well; the others are named by path', () => {
  // "inbox item" also finds the product card, by far less well than the notification: it stays out
  const n = S.pickPieces('Write an in-app notification card, like an inbox item, with Dismiss', { dir: FIX });
  expect(n.pieces.map((x) => x.name)).toEqual(['Notification card']);
  expect(n.more.map((x) => x.name)).toContain('Product card');
  // two that both fit come together
  const two = S.pickPieces('a stat card for revenue, in a page with tabs and sections', { dir: FIX });
  expect(two.pieces.map((x) => x.name)).toEqual(['Stat card', 'Tabs']);
  // nothing fits: no pieces (the design cards then come as before)
  expect(S.pickPieces('a kanban board for my tasks', { dir: FIX }).pieces).toEqual([]);
});

test('the notes: the shell, the theme\'s colours and the pieces whole; a piece too long is named, never cut', () => {
  const notes = S.studioNotes(S.pickPieces('a stat card for revenue', { dir: FIX }), FIX);
  expect(notes.text).toContain('<body class="min-h-screen bg-paper text-ink font-sans antialiased">');
  expect(notes.text).toContain('paper, surface, subtle, ink, muted, line, accent, accent-ink, accent-soft, good, good-soft');
  expect(notes.text).toContain(`[Piece · STUDIO/components/cards/stat-card.html: Stat card, for stat card]\n${STAT}`);
  expect(notes.text).toMatch(/no dark: classes/);
  expect(notes.chars).toBeLessThanOrEqual(S.STUDIO_CHARS);
  const long = S.studioNotes(S.pickPieces('a modal dialog popup', { dir: FIX }), FIX);
  expect(long).toBeNull(); // the only piece that fits is too long to hand over whole
  expect(S.studioNotes({ pieces: [], more: [] }, FIX)).toBeNull();
});

test('STUDIO/ paths reach the folder read-only, as DESIGN/ does; climbing out does not work', async () => {
  const cwd = join(tmpdir(), `agentic-studio-cwd-${process.pid}`); mkdirSync(cwd, { recursive: true });
  const p = resolvePath(cwd, 'STUDIO/components/cards/stat-card.html');
  expect(p.abs).toBe(join(FIX, 'components', 'cards', 'stat-card.html'));
  expect(p.shelf?.name).toBe('STUDIO');
  const r = await execute('Read', { path: 'STUDIO/components/cards/stat-card.html' }, {}, { cwd });
  expect(r.text).toContain('$48,920');
  expect(prepare('Write', { path: 'STUDIO/components/cards/new.html', content: 'x' }, { cwd }).error).toMatch(/read-only/);
  expect(S.studioPathFor('STUDIO/../../etc/passwd', FIX)).toBeNull();
  rmSync(cwd, { recursive: true, force: true });
});

test('the switch: on by default, settings.json design.studio and AGENTIC_STUDIO on top', () => {
  const keep = process.env.AGENTIC_STUDIO;
  try {
    delete process.env.AGENTIC_STUDIO;
    expect(D.designSettings({}).studio).toBe(true);
    expect(D.designSettings({ studio: false }).studio).toBe(false);
    process.env.AGENTIC_STUDIO = 'on';
    expect(D.designSettings({ studio: false }).studio).toBe(true);
    process.env.AGENTIC_STUDIO = 'off';
    expect(D.designSettings({}).studio).toBe(false);
  } finally { if (keep === undefined) delete process.env.AGENTIC_STUDIO; else process.env.AGENTIC_STUDIO = keep; }
});

const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sales</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-paper text-ink font-sans">
<main class="mx-auto max-w-6xl p-4 md:p-8"><article class="rounded-card border border-line bg-surface p-5"><p class="text-blue-500 text-4xl tabular-nums">$48,920</p><button class="bg-accent text-accent-ink hover:opacity-90">Go</button></article></main>
<script>document.querySelector('button').onclick = (e) => e.target.classList.toggle('hidden');</script>
</body>
</html>
`;

test('the build: the CSS for the page\'s classes in one line before </head>, offline; the Tailwind link out; a stock colour named; a rebuild changes nothing', async () => {
  const r = await S.buildStyles(PAGE, { theme: S.DEFAULT_THEME });
  expect(r.skipped).toBeUndefined();
  expect(r.cdn).toBe(1);
  expect(r.html).not.toContain('cdn.tailwindcss.com');
  expect(r.stock).toEqual(['text-blue-500']);
  const line = r.html.split('\n').find((l) => l.startsWith('<style id="studio-css">'));
  expect(line).toBeTruthy();
  expect(r.html.indexOf(line)).toBeLessThan(r.html.indexOf('</head>'));
  // the classes the page uses (a class only its script adds too), its theme colours, the reset
  for (const sel of ['.bg-paper', '.rounded-card', '.md\\:p-8', '.hover\\:opacity-90', '.hidden', '.tabular-nums']) expect(line).toContain(sel);
  expect(line).toContain('--paper: #f7f6f2');
  expect(line).toContain('prefers-color-scheme: dark');
  expect(line).not.toContain('.text-blue-500');
  expect(line).toMatch(/tailwindcss v[\d.]+ \| MIT License/); // Tailwind's own notice stays
  const again = await S.buildStyles(r.html, { theme: S.DEFAULT_THEME });
  expect(again.html).toBe(r.html);
  expect(S.buildNote('sales.html', r)).toMatch(/draw nothing: text-blue-500\./);
});

test('the build leaves a plain-CSS page alone, but always rebuilds a page it built before', async () => {
  const plain = '<!doctype html><html><head><style>.card{padding:8px}</style></head><body><div class="card">Hi</div><h1 class="title">Yo</h1></body></html>';
  expect((await S.buildStyles(plain, { theme: S.DEFAULT_THEME })).skipped).toMatch(/Tailwind class/);
  const built = (await S.buildStyles(PAGE, { theme: S.DEFAULT_THEME })).html;
  const fewer = built.replace(/<main[\s\S]*<\/main>/, '<p class="p-4">Only one class now</p>');
  const r = await S.buildStyles(fewer, { theme: S.DEFAULT_THEME });
  expect(r.skipped).toBeUndefined();
  expect(r.html).toContain('.p-4');
  expect(r.html).not.toContain('.rounded-card');
});

test('read folded, edited for real: the model sees a one-line note where the CSS is, and an edit that names the note means the real line', async () => {
  const built = (await S.buildStyles(PAGE, { theme: S.DEFAULT_THEME })).html;
  const shown = S.hideBuilt(built);
  expect(shown.split('\n').length).toBe(built.split('\n').length); // line numbers do not move
  expect(shown).toContain(`<style id="studio-css">${S.BUILT_NOTE}</style>`);
  expect(shown).not.toContain('--paper');
  const cwd = join(tmpdir(), `agentic-studio-read-${process.pid}`); mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, 'sales.html'), built);
  const read = await execute('Read', { path: 'sales.html' }, {}, { cwd });
  expect(read.text).toContain(S.BUILT_NOTE);
  expect(read.text).not.toContain('--paper: #f7f6f2');
  const folded = shown.split('\n').find((l) => l.includes(S.BUILT_NOTE));
  const p = prepare('Edit', { path: 'sales.html', old_text: `${folded}\n</head>`, new_text: `${folded}\n<link rel="icon" href="data:,">\n</head>` }, { cwd });
  expect(p.error).toBeUndefined();
  expect(p.after).toContain('--paper: #f7f6f2'); // the real line kept
  rmSync(cwd, { recursive: true, force: true });
});

test('the agent: a page request gets the pieces in the example card\'s place; the page it writes gets its styles built, said to it in the same reply', async () => {
  const { Agent } = await import('../src/agent/agent.mjs');
  const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');
  const { startFakeServer } = await import('./fake-server.mjs');
  const { systemPrompt } = await import('../src/agent/prompt.mjs');
  const cwd = join(tmpdir(), `agentic-studio-agent-${process.pid}`); rmSync(cwd, { recursive: true, force: true }); mkdirSync(cwd, { recursive: true });
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'sales.html', content: PAGE } } },
    { tool: { name: 'Edit', args: { path: 'sales.html', old_text: 'text-blue-500', new_text: 'text-ink' } } },
    { text: 'I made sales.html from the stat card.' },
  ]);
  const notes = [];
  const agent = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd, system: systemPrompt({ cwd, git: 'test', tests: null }), thinking: false, ctx: 32768, mode: 'edits', flows: false, verify: false, checkIns: false, ask: async () => ({ choice: 'yes' }), design: { auto: true, check: false } });
  agent.on('note', (e) => notes.push(e.text));
  const keep = { d: process.env.AGENTIC_DESIGN, s: process.env.AGENTIC_STUDIO, l: process.env.AGENTIC_LAYOUT };
  process.env.AGENTIC_DESIGN = 'on'; process.env.AGENTIC_STUDIO = 'on'; process.env.AGENTIC_LAYOUT = 'off';
  try { await agent.send('make a stat card page for my revenue'); } finally {
    for (const [k, v] of [['AGENTIC_DESIGN', keep.d], ['AGENTIC_STUDIO', keep.s], ['AGENTIC_LAYOUT', keep.l]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await fake.close();
  }
  const first = JSON.stringify(fake.requests[0].messages);
  expect(first).toContain('[Piece · STUDIO/components/cards/stat-card.html');
  expect(first).toContain('[Rules · DESIGN/your rules/rules.md]');
  expect(first).not.toContain('[Example · DESIGN/opus/widget.md]'); // the piece took its place
  expect(notes.some((t) => /^Design studio: your rules\/rules \+ studio\/cards\/stat-card \(≈[\d,]+ tokens\)\.$/.test(t))).toBe(true);
  // the Write's result said what was built and which colour draws nothing
  const afterWrite = JSON.stringify(fake.requests[1].messages.at(-1));
  expect(afterWrite).toContain('Agentic Coder built the styles');
  expect(afterWrite).toContain('text-blue-500');
  expect(notes.some((t) => /^Built the styles into sales\.html \(\d+ classes, [\d.]+ KB, [\d.]+ s\), in place of the Tailwind link; not in your theme: text-blue-500\.$/.test(t))).toBe(true);
  // after the Edit: rebuilt, the stock colour gone, still one built line
  const page = readFileSync(join(cwd, 'sales.html'), 'utf8');
  expect(page.match(/<style id="studio-css">/g).length).toBe(1);
  expect(page).toContain('.text-ink');
  expect(page).not.toContain('cdn.tailwindcss.com');
  expect(JSON.stringify(fake.requests[2].messages.at(-1))).not.toContain('draw nothing');
  expect(fake.remaining()).toBe(0);
  rmSync(cwd, { recursive: true, force: true });
}, 60_000);

test('the agent: with the studio off, a page request gets the cards as before and nothing is built', async () => {
  const { Agent } = await import('../src/agent/agent.mjs');
  const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');
  const { startFakeServer } = await import('./fake-server.mjs');
  const { systemPrompt } = await import('../src/agent/prompt.mjs');
  const cwd = join(tmpdir(), `agentic-studio-off-${process.pid}`); rmSync(cwd, { recursive: true, force: true }); mkdirSync(cwd, { recursive: true });
  const fake = await startFakeServer([{ tool: { name: 'Write', args: { path: 'sales.html', content: PAGE } } }, { text: 'Done.' }]);
  const agent = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd, system: systemPrompt({ cwd, git: 'test', tests: null }), thinking: false, ctx: 32768, mode: 'edits', flows: false, verify: false, checkIns: false, ask: async () => ({ choice: 'yes' }), design: { auto: true, check: false, studio: false } });
  const keep = { d: process.env.AGENTIC_DESIGN, s: process.env.AGENTIC_STUDIO };
  process.env.AGENTIC_DESIGN = 'on'; delete process.env.AGENTIC_STUDIO;
  try { await agent.send('make a stat card widget page for my revenue'); } finally {
    for (const [k, v] of [['AGENTIC_DESIGN', keep.d], ['AGENTIC_STUDIO', keep.s]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await fake.close();
  }
  const first = JSON.stringify(fake.requests[0].messages);
  expect(first).toContain('[Example · DESIGN/opus/widget.md]');
  expect(first).not.toContain('[Piece ·');
  expect(readFileSync(join(cwd, 'sales.html'), 'utf8')).toBe(PAGE);
  rmSync(cwd, { recursive: true, force: true });
}, 60_000);
