// The design system (18 Oct 2026, the owner's plan A: "i want to drastically improve / optimize the Agentic Coder Design
// System"): the guide every design request gets, the look (a project's DESIGN.md, else the user's own, with their rules
// in every project), /design init writing a project's DESIGN.md from its styles, the bank of whole pages picked by kind,
// "Not quite" kept as a rule, the scores of the four-way look, and the four-way picture itself. Fixture folders only.
import { test, expect } from 'bun:test';
import { needs } from './needs.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CARDS = mkdtempSync(join(tmpdir(), 'agentic-design-system-'));
process.env.AGENTIC_DESIGN_DIR = CARDS;
const DS = await import('../src/agent/design-system.mjs');
const { lookFromDesignMd } = await import('../src/agent/library.mjs');
const { scoresOf, RUBRIC } = await import('../src/agent/helper-models.mjs');
const { findChrome } = await import('../src/flows/layoutcheck.mjs');
const { pagePictures, VIEWS } = await import('../src/flows/page-pictures.mjs');

const YOURS = `---
name: "Your look"
description: "Warm paper, one blue accent."
colors:
  canvas: "#f7f6f2"
  surface-card: "#ffffff"
  ink: "#1c1b18"
  ink-mute: "#6b675e"
  hairline: "#e3dfd5"
  primary: "#1f66bd"
  on-primary: "#ffffff"
---

# Your look

## Colors
Warm paper.

## Your rules
- Never scroll sideways.
- No thin coloured stripe on a card's edge.
`;
writeFileSync(join(CARDS, 'DESIGN.md'), YOURS);

test('the guide: what every design request gets, on every model; short enough to send each time', () => {
  const g = DS.designGuide();
  for (const part of ['## Colour', '## Type', '## Space and alignment', '## Surfaces', '## Phone', '## Finish']) expect(g).toContain(part);
  expect(g).toContain('One accent');
  expect(g.length).toBeLessThan(3200); // about 700 tokens
  expect(g.startsWith('# ')).toBe(false); // its heading is the note's
});

test('the kind of page a request asks for: the earliest word, the longer at one place, none for a request that names no page', () => {
  const kinds = {
    'make me a dashboard for my trading account': 'dashboard',
    'Build one HTML file for a pricing page with three plans': 'pricing',
    'Draw a flowchart as one HTML file of how an online order is paid': 'flowchart',
    'Build one self-contained HTML file for a file or document card': 'card',
    'a sign in screen with a password reset link': 'auth',
    'Make a slide deck as one HTML file about our third quarter': 'slides',
    'write a results report of the test run': 'report',
    'a settings page for notifications': 'settings',
    'an org chart of the team': 'diagram',
    'Build one HTML file for the project board of a small video studio': 'dashboard',
    'a kanban for my tasks': 'dashboard',
    'a landing page for the app with a waitlist': 'landing',
    'fix the off-by-one in parse()': null,
  };
  for (const [t, k] of Object.entries(kinds)) expect([t, DS.kindOf(t)]).toEqual([t, k]);
});

test("the look: a project's DESIGN.md wins, with the user's rules and not their colours; else the user's own; never a stray file", () => {
  const plain = mkdtempSync(join(tmpdir(), 'agentic-ds-plain-'));
  const yours = DS.lookFor(plain);
  expect(yours).toMatchObject({ from: 'yours' });
  expect(yours.look.colours ?? yours.look.c ?? yours.look).toBeTruthy();
  const note = DS.lookNote(yours, { cwd: plain });
  expect(note).toStartWith('[Look · your DESIGN.md · DESIGN/DESIGN.md');
  expect(note).toContain('#1f66bd');
  const project = mkdtempSync(join(tmpdir(), 'agentic-ds-project-'));
  mkdirSync(join(project, 'docs'));
  writeFileSync(join(project, 'docs', 'DESIGN.md'), YOURS.replace('#1f66bd', '#7c3aed').replace('"Your look"', '"Shop"'));
  const own = DS.lookFor(project);
  expect(own).toMatchObject({ from: 'project', abs: join(project, 'docs', 'DESIGN.md') });
  const n2 = DS.lookNote(own, { cwd: project });
  expect(n2).toStartWith("[Look · this project's docs/DESIGN.md: its colours, type and corners win");
  expect(n2).toContain('#7c3aed');
  expect(n2).toContain("[Your rules · DESIGN/DESIGN.md: they hold in every project]\n- Never scroll sideways.");
  // A long DESIGN.md is cut at a line, saying where the rest is.
  const long = DS.lookNote({ ...own, text: `${own.text}\n${'- another rule that goes on\n'.repeat(400)}` }, { cwd: project, max: 900 });
  expect(long).toContain('(… the rest: Read docs/DESIGN.md)');
});

test('/design init: a DESIGN.md from the styles a project already has, read back as its look; written once; none without styles', () => {
  const p = mkdtempSync(join(tmpdir(), 'agentic-ds-init-'));
  mkdirSync(join(p, 'src'));
  mkdirSync(join(p, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(p, 'node_modules', 'x', 'skip.css'), ':root { --bg: #ff0000; }');
  writeFileSync(join(p, 'src', 'app.css'), `:root { --bg: #fafaf9; --surface: #ffffff; --text: #18181b; --muted: #71717a; --border: #e4e4e7; --primary: #0f766e; --on-primary: #ffffff; --danger: #dc2626; }
@media (prefers-color-scheme: dark) { :root { --bg: #0c0a09; --text: #fafaf9; } }
body { font-family: Inter, system-ui, sans-serif; font-size: 15px; }
.card { border-radius: 10px; padding: 16px 24px; gap: 8px; }
h1 { font-size: 28px; } h2 { font-size: 20px; } small { font-size: 12px; } .btn { border-radius: 10px; padding: 8px 16px; }`);
  writeFileSync(join(p, 'index.html'), '<html><head><style>.hero { margin: 32px 0; font-size: 15px; }</style></head><body></body></html>');
  const s = DS.readStyles(p);
  expect(s.files.sort()).toEqual(['index.html', 'src/app.css']);
  expect(s.colours).toMatchObject({ paper: '#fafaf9', surface: '#ffffff', ink: '#18181b', muted: '#71717a', line: '#e4e4e7', accent: '#0f766e', accentInk: '#ffffff', bad: '#dc2626' });
  expect(s.dark).toMatchObject({ paper: '#0c0a09', ink: '#fafaf9' });
  expect(s).toMatchObject({ font: 'Inter, system-ui, sans-serif', radius: 10, step: 8 });
  expect(s.sizes).toEqual([12, 15, 20, 28]);
  const r = DS.writeDesignMd(p, { name: 'Shop', today: new Date('2026-10-18T12:00:00Z') });
  expect(r.abs).toBe(join(p, 'DESIGN.md'));
  expect(r.text).toContain('description: "The look of Shop, read from its styles by Agentic Coder (/design init) on 2026-10-18.');
  expect(r.text).toContain('Dark mode (from the styles\' dark block): paper #0c0a09, ink #fafaf9.');
  const look = lookFromDesignMd('shop', r.text);
  expect(look).not.toBeNull();
  expect(JSON.stringify(look)).toContain('#0f766e');
  expect(DS.writeDesignMd(p)).toEqual({ exists: join(p, 'DESIGN.md') });
  expect(DS.lookFor(p)).toMatchObject({ from: 'project' });
  expect(DS.writeDesignMd(mkdtempSync(join(tmpdir(), 'agentic-ds-none-')))).toEqual({ none: true });
  // Offered once a project; a project's own page made this message is not a style of its own.
  const home = mkdtempSync(join(tmpdir(), 'agentic-ds-home-'));
  expect(DS.offeredBefore(home, p)).toBe(false);
  DS.markOffered(home, p, 'no');
  expect(DS.offeredBefore(home, p)).toBe(true);
  const fresh = mkdtempSync(join(tmpdir(), 'agentic-ds-fresh-'));
  writeFileSync(join(fresh, 'page.html'), '<style>body{color:#111}</style>');
  expect(DS.hasStylesOf(fresh, ['page.html'])).toBe(false);
  expect(DS.hasStylesOf(fresh, [])).toBe(true);
});

test('the bank: the page of the kind asked for, as its outline and a skeleton cut to fit; none of another kind', () => {
  const bank = join(CARDS, 'bank');
  mkdirSync(join(bank, 'dashboard'), { recursive: true });
  mkdirSync(join(bank, 'pricing'), { recursive: true });
  const rows = Array.from({ length: 9 }, (_, i) => `      <tr class="row"><td>Order ${i + 1}</td><td>$${(i + 1) * 10}.00</td></tr>`).join('\n');
  const page = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<style>\n:root { --paper: #f7f6f2; }\n.grid { display: grid; gap: 16px; }\n</style>\n</head>\n<body>\n  <header class="top"><h1>Trading desk</h1></header>\n  <p class="lead">${'This sentence is long enough that it should be cut down to its first few words in the skeleton. '.repeat(2)}</p>\n  <table>\n${rows}\n  </table>\n  <script>console.log('x'.repeat(5000))</script>\n</body>\n</html>\n`;
  writeFileSync(join(bank, 'dashboard', 'trading-desk.html'), page);
  writeFileSync(join(bank, 'dashboard', 'ops-status.html'), '<!doctype html><html><body><h1>Ops</h1></body></html>');
  writeFileSync(join(bank, 'pricing', 'three-plans.html'), '<!doctype html><html><body><h1>Plans</h1></body></html>');
  writeFileSync(join(bank, 'bank.json'), JSON.stringify([
    { id: 'trading-desk', kind: 'dashboard', title: 'Trading desk', for: 'A desk: numbers first, then positions.', words: ['trading', 'positions', 'pnl'], outline: ['Header with the account and the day', 'Four numbers', 'Positions table'], file: 'dashboard/trading-desk.html' },
    { id: 'ops-status', kind: 'dashboard', title: 'Ops status', words: ['server', 'uptime'], outline: [], file: 'dashboard/ops-status.html' },
    { id: 'three-plans', kind: 'pricing', title: 'Three plans', words: ['plans'], outline: [], file: 'pricing/three-plans.html' },
    { id: 'gone', kind: 'pricing', title: 'Gone', words: [], outline: [], file: 'pricing/gone.html' },
  ]));
  expect(DS.readBank().map((e) => e.id)).toEqual(['trading-desk', 'ops-status', 'three-plans']); // a file not there is left out
  expect(DS.pickBankPage('a dashboard of my trading positions and pnl')?.id).toBe('trading-desk');
  expect(DS.pickBankPage('a dashboard of server uptime')?.id).toBe('ops-status');
  expect(DS.pickBankPage('a slide deck about Q3')).toBeNull(); // no slides in this bank: no page of another kind
  const sk = DS.skeletonOf(page);
  expect(sk).toContain('<script>/* … */</script>');
  expect(sk).toContain('This sentence is long enough that it should …');
  expect(sk).toContain('<!-- 7 more like these -->');
  expect(sk.match(/<tr class="row">/g)).toHaveLength(2);
  expect(DS.skeletonOf(page, 200).endsWith('<!-- … cut here -->')).toBe(true);
  const note = DS.bankNote(DS.pickBankPage('trading dashboard'));
  expect(note).toStartWith("[Whole page · DESIGN/bank/dashboard/trading-desk.html · Trading desk: a finished dashboard page in the user's look]");
  expect(note).toContain('How it is laid out:\n- Header with the account and the day\n- Four numbers');
  expect(note).toContain('Read DESIGN/bank/dashboard/trading-desk.html for the whole page.');
});

test('what a page request gets, in order: the look, the guide, the whole page; a small model gets the same, shorter', () => {
  const plain = mkdtempSync(join(tmpdir(), 'agentic-ds-notes-'));
  const big = DS.systemNotes('a trading dashboard with positions', { cwd: plain, ctx: 262144 });
  expect(big.names).toEqual(['your DESIGN.md', 'the design guide', 'bank/trading-desk']);
  const at = (s) => big.text.indexOf(s);
  expect(at('[Look ·')).toBe(0);
  expect(at('[Look ·')).toBeLessThan(at('[Design guide'));
  expect(at('[Design guide')).toBeLessThan(at('[Whole page'));
  const small = DS.systemNotes('a trading dashboard with positions', { cwd: plain, ctx: 32768 });
  expect(small.names).toEqual(['your DESIGN.md', 'the design guide', 'bank/trading-desk']);
  expect(small.text.length).toBeLessThanOrEqual(big.text.length); // the same here: these fixtures fit whole either way
});

test('"Not quite" kept as a rule: under Your rules in the user\'s DESIGN.md, once; a section made when there is none', () => {
  expect(DS.addRule('Cards never wider than 440 px')).toBe(join(CARDS, 'DESIGN.md'));
  DS.addRule('Cards never wider than 440 px');
  const text = readFileSync(join(CARDS, 'DESIGN.md'), 'utf8');
  expect(text.match(/Cards never wider than 440 px/g)).toHaveLength(1);
  expect(DS.mdSection(text, 'Your rules').split('\n')).toEqual(['- Never scroll sideways.', "- No thin coloured stripe on a card's edge.", '- Cards never wider than 440 px']);
  const other = mkdtempSync(join(tmpdir(), 'agentic-ds-rules-'));
  writeFileSync(join(other, 'DESIGN.md'), '# Look\n\n## Colors\nBlue.\n');
  DS.addRule('No emoji as icons', other);
  expect(readFileSync(join(other, 'DESIGN.md'), 'utf8')).toBe('# Look\n\n## Colors\nBlue.\n\n## Your rules\n- No emoji as icons\n');
  expect(DS.addRule('x', other)).toBeNull(); // too short to be a rule
});

test('the four-way look, scored: six points 1-5, what is 3 or less goes back with what to change; an answer in the old shape still reads', () => {
  expect(RUBRIC.map(([k]) => k)).toEqual(['focus', 'spacing', 'alignment', 'contrast', 'finish', 'phone']);
  const r = scoresOf('focus: 4 | ok\nspacing: 3 | the stat cards touch the chart: 24 px between them\nalignment: 5 | ok\ncontrast: 2 | the labels in dark mode are too faint\nfinish: 4 | ok\nphone: 3 |');
  expect(r).toMatchObject({ ok: false, score: 3.5, scores: { focus: 4, spacing: 3, alignment: 5, contrast: 2, finish: 4, phone: 3 } });
  expect(r.findings).toEqual(['spacing (3/5): the stat cards touch the chart: 24 px between them', 'contrast (2/5): the labels in dark mode are too faint', `phone (3/5): ${RUBRIC[5][1]}`]);
  expect(scoresOf('- **focus**: 5/5 — ok\n- **spacing**: 5/5 — ok\n- alignment: 4 - ok\n- contrast: 5 - ok\n- finish: 5\n- phone: 4 | ok')).toMatchObject({ ok: true, findings: [], score: 4.7 });
  expect(scoresOf('LGTM')).toMatchObject({ ok: true, scores: null });
  expect(scoresOf('- The title is too small: make it 32 px.')).toMatchObject({ ok: false, findings: ['The title is too small: make it 32 px.'], scores: null });
});

test.skipIf(needs('chrome', findChrome))('the page four ways in one picture: desktop and phone, light above dark, each named', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-ds-pic-'));
  const abs = join(dir, 'page.html');
  writeFileSync(abs, '<!doctype html><html><head><meta charset="utf-8"><style>:root{color-scheme:light dark}body{margin:0;font:16px sans-serif;background:#fff;color:#111}@media (prefers-color-scheme: dark){body{background:#111;color:#eee}}</style></head><body><h1>Hello</h1></body></html>');
  const r = await pagePictures(abs);
  expect(r).not.toBeNull();
  expect(r.views).toEqual(VIEWS.map((v) => v.name));
  expect(r.views).toEqual(['Desktop · light', 'Phone · light', 'Desktop · dark', 'Phone · dark']);
  expect(r.w).toBeGreaterThan(900);
  expect(r.h).toBeGreaterThan(900);
  const png = Buffer.from(r.data, 'base64');
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(r.w);
  expect(existsSync(abs)).toBe(true);
}, 60_000);
