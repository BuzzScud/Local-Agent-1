// The design examples (src/agent/design.mjs) and the layout check
// (src/flows/layoutcheck.mjs): cards read from a folder, matched to a request
// to make or restyle a page, carried with that request, reachable read-only as
// DESIGN/; the page the model made opened in a real browser and what is broken
// sent back once. Built against a fixture folder, never the real one.
import { test, expect, afterAll } from 'bun:test';
import { needs } from './needs.mjs';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const FIX = join(tmpdir(), `agentic-design-fixture-${process.pid}`);
process.env.AGENTIC_DESIGN_DIR = FIX;
const D = await import('../src/agent/design.mjs');
const L = await import('../src/flows/layoutcheck.mjs');
const { resolvePath, prepare, execute } = await import('../src/agent/tools.mjs');

const card = (name, fields, body = '## Look\n- Colours: `--bg:#fff`\n\n## Do\n- One thing.') =>
  `# ${name}\n${Object.entries(fields).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n${body}\n`;
function fixture() {
  rmSync(FIX, { recursive: true, force: true });
  for (const d of ['your rules', 'your picks', 'opus', 'fable']) mkdirSync(join(FIX, d), { recursive: true });
  writeFileSync(join(FIX, 'README.md'), '# For people, not a card');
  writeFileSync(join(FIX, 'your rules', 'rules.md'), card('The rules', { For: 'every page', Words: 'page', Always: 'yes' }, '## Fit\n- Never scroll sideways.'));
  writeFileSync(join(FIX, 'your picks', 'report.md'), card('Simple report', { For: 'a report', Words: 'report, summary, status', Page: 'report.html', Default: 'yes' }));
  writeFileSync(join(FIX, 'your picks', 'report.html'), '<!doctype html><title>Report</title><h1>Hi</h1>');
  writeFileSync(join(FIX, 'opus', 'dashboard.md'), card('Status dashboard', { For: 'a dashboard', Words: 'dashboard, monitor, metrics, miner' }));
  writeFileSync(join(FIX, 'fable', 'dashboard.md'), card('Dashboard', { For: 'a dashboard', Words: 'dashboard, stats' }));
  writeFileSync(join(FIX, 'fable', 'explainer.md'), card('Explainer', { For: 'teaching', Words: 'explain, how it works' }));
  // a long card: cut at a section, its code fence closed
  writeFileSync(join(FIX, 'opus', 'widget.md'), card('Widget', { For: 'a widget', Words: 'widget, timer' }, `## Skeleton\n\`\`\`html\n${'<div class="x">a line of the skeleton</div>\n'.repeat(120)}\`\`\`\n\n## Do\n- The end.`));
}
fixture();
afterAll(() => rmSync(FIX, { recursive: true, force: true }));

test('a card is its name, its header lines and the rest; a README is not a card; sets are the subfolders', () => {
  const c = D.parseCard(card('Status dashboard', { For: 'a dashboard', Words: 'Dashboard, KPI ,  metrics', Always: 'yes' }));
  expect(c).toMatchObject({ name: 'Status dashboard', for: 'a dashboard', words: ['dashboard', 'kpi', 'metrics'], always: true, default: false, page: null });
  expect(c.body.startsWith('## Look')).toBe(true);
  const { sets, cards } = D.readCards(FIX);
  expect(sets.map((s) => s.name)).toEqual(['your rules', 'your picks', 'opus', 'fable']); // the user's own first
  expect(cards.some((c) => /readme/i.test(c.file))).toBe(false);
  expect(cards.find((c) => c.file === 'your picks/report.md').page).toBe('your picks/report.html');
});

// Every request here was sorted by hand: a page to make or restyle, or not.
const PAGES = ['make a dashboard for my xmr miner fleet', 'create a self contained html file with a weather widget', 'build a notes app page where I can add and delete notes',
  'make a page that shows the test results before and after', 'restyle index.html so it looks more modern', 'make my portfolio site look better', 'build a todo list app',
  'make a countdown timer', 'make a table of my github repos with sort and filter', 'create a login form', 'design a pricing page', 'add a dark mode to the page',
  'can you make a landing page for my trading app?', 'the settings screen looks dated, redesign it',
  // the kinds the first cards had nothing for (29 Sep): each is a page when asked for this way
  'make a chat window like messages', 'make a map of my stores', 'make a music player', 'show my sales as a bar chart', 'make a profile card',
  'build a timeline of the project', 'make a small game in the browser', 'build a photo gallery', 'create a kanban board for my tasks', 'make a calendar for this month',
  'build a support chat', 'build a store locator',
  // the ten kinds added 30 Sep (landing, pricing, shop, blog, portfolio, docs, invoice, timeline, survey, empty states)
  'build an online shop for my candles', 'make a storefront for my prints', 'make a blog for my recipes', 'create an invoice for 3 hours of work',
  'make a survey about lunch', 'add an empty state to the notes list', 'make a pricing table with 3 plans', 'make a 404 page', 'build a docs site for my library',
  'make a receipt for the order', 'make a playful landing page'];
const NOT = ['fix the bug in export.py', 'what does the dashboard do?', 'add a --json flag to export.mjs', 'rename total to sum', 'add unit tests for the parser',
  'make the chart function faster', 'build the app', 'add a column to the users table', 'why is the page blank?', 'update the api route for /users', 'write a python script that renames my photos',
  'explain how the reranker works', 'run the tests',
  'add a map from user ids to names', 'build a chat bot that answers in slack', 'add a card field to the payment endpoint', 'add a player class to the engine',
  'show the logs in the terminal', 'what does the calendar do?', 'plot the loss curve in a graph with matplotlib', 'make a chart of the results in a jupyter notebook',
  'write a blog post about rust', 'add a poll interval to the fetcher', 'build an in-memory store for sessions', 'write a changelog for v2'];
test('a request to make or restyle a page is a design request; questions, fixes and code-only work are not', () => {
  expect(PAGES.filter((t) => !D.isDesignRequest(t))).toEqual([]);
  expect(NOT.filter((t) => D.isDesignRequest(t))).toEqual([]);
});

test('the rules always come, then the ONE best example; the others that fit are named by path', () => {
  const p = D.pickCards('make a dashboard for my miner', { dir: FIX });
  expect(p.always.map((c) => c.file)).toEqual(['your rules/rules.md']);
  expect(p.examples.map((c) => c.file)).toEqual(['opus/dashboard.md']); // 2 words (dashboard, miner) beat 1
  expect(p.more.map((c) => c.file)).toEqual(['fable/dashboard.md']);
  // a tie goes to the set listed first; "explains" finds the card word "explain"
  expect(D.pickCards('make a dashboard', { dir: FIX }).examples[0].file).toBe('opus/dashboard.md');
  expect(D.pickCards('make a page that explains the cache', { dir: FIX }).examples[0].file).toBe('fable/explainer.md');
  // nothing matches: the Default card
  expect(D.pickCards('make a page about my cat', { dir: FIX }).examples[0].file).toBe('your picks/report.md');
  // only the sets that are on
  const f = D.pickCards('make a dashboard for my miner', { dir: FIX, sets: ['fable'] });
  expect(f.always).toEqual([]);
  expect(f.examples.map((c) => c.file)).toEqual(['fable/dashboard.md']);
});

test('a word that says nothing about the kind of page (window, simple) does not pick a card', () => {
  mkdirSync(join(FIX, 'your picks'), { recursive: true });
  writeFileSync(join(FIX, 'your picks', 'wizard.md'), card('Step wizard in a window', { For: 'a runbook', Words: 'wizard, steps, simple' }));
  writeFileSync(join(FIX, 'opus', 'chat.md'), card('Chat', { For: 'a conversation', Words: 'chat, messages' }));
  try {
    expect(D.scoreCard(D.readCards(FIX).cards.find((c) => c.file === 'your picks/wizard.md'), 'make a simple chat window')).toBe(0);
    // before, "window" (its name) tied with "chat", and the user's own set won the tie
    expect(D.pickCards('make a chat window', { dir: FIX }).examples[0].file).toBe('opus/chat.md');
    expect(D.pickCards('make a step by step wizard in a simple window', { dir: FIX }).examples[0].file).toBe('your picks/wizard.md');
  } finally { rmSync(join(FIX, 'your picks', 'wizard.md')); rmSync(join(FIX, 'opus', 'chat.md')); }
});

test('the notes fit their budget, cut a long card at a line and close its code fence, and point at the full page', () => {
  const n = D.designNotes(D.pickCards('make a report page', { dir: FIX }), FIX);
  expect(n.text).toContain('[Rules · DESIGN/your rules/rules.md]');
  expect(n.text).toContain('[Example · DESIGN/your picks/report.md]');
  expect(n.text).toContain('A full page built this way: DESIGN/your picks/report.html');
  const w = D.designNotes(D.pickCards('make a timer widget', { dir: FIX }), FIX);
  expect(w.chars).toBeLessThanOrEqual(D.NOTE_CHARS);
  expect(w.text).toContain('(… the rest is in DESIGN/opus/widget.md)');
  expect((w.text.match(/```/g) ?? []).length % 2).toBe(0);
  expect(D.designNotes({ always: [], examples: [], more: [] }, FIX)).toBeNull();
});

// The looks (30 Sep): a card marked "- Look: yes" restyles any kind, picked by its Words.
function withLooks(fn) {
  const look = (name, words, colour) => card(name, { For: 'any kind of page', Words: words, Look: 'yes' }, `## Look\n- Colours: \`--bg:${colour}\` ($5 of paint)\n\n## Do\n- Keep it ${name}.\n\n## Don't\n- No stripes.`);
  writeFileSync(join(FIX, 'opus', 'look-bold.md'), look('Bold look', 'bold, playful, fun', '#ff0'));
  writeFileSync(join(FIX, 'fable', 'look-bold.md'), look('Loud look', 'bold, playful, fun', '#f0f'));
  writeFileSync(join(FIX, 'opus', 'look-dark.md'), look('Dark look', 'dark, night, moody', '#000'));
  writeFileSync(join(FIX, 'opus', 'look-calm.md'), look('Calm look', 'calm, minimal, clean', '#eee'));
  try { fn(); } finally { for (const f of ['opus/look-bold.md', 'fable/look-bold.md', 'opus/look-dark.md', 'opus/look-calm.md']) rmSync(join(FIX, f)); }
}

test('a look is picked by its words and comes from the example\'s own set; a look card is never the example; "dark mode" asks for a switch, not the dark look', () => withLooks(() => {
  const p = D.pickCards('make a playful dashboard for my miner', { dir: FIX });
  expect(p.examples.map((c) => c.file)).toEqual(['opus/dashboard.md']);
  expect(p.look.file).toBe('opus/look-bold.md');
  expect(p.more.some((c) => c.look)).toBe(false);
  // the fable dashboard gets the fable set's bold look (a different name, the same file)
  expect(D.pickCards('make a playful dashboard', { dir: FIX, style: 'fable' }).look.file).toBe('fable/look-bold.md');
  // no look word: the example's own look, as before
  expect(D.pickCards('make a dashboard', { dir: FIX }).look).toBeNull();
  expect(D.pickCards('add a dark mode toggle to the dashboard', { dir: FIX }).look).toBeNull();
  expect(D.pickCards('clean up the dashboard layout', { dir: FIX }).look).toBeNull(); // a tidy, not the calm look
  expect(D.pickCards('make a clean dashboard', { dir: FIX }).look.file).toBe('opus/look-calm.md');
  expect(D.pickCards('make a dark dashboard for night trading', { dir: FIX }).look.file).toBe('opus/look-dark.md');
  // two looks named: the one with more words, then the one named first
  expect(D.pickLook('a calm, minimal page that is a bit fun', D.readCards(FIX).cards).file).toBe('opus/look-calm.md');
  expect(D.pickLook('a moody but playful page', D.readCards(FIX).cards).file).toBe('opus/look-dark.md');
  // a request only for a look still gets the Default card as its example, in that look
  const d = D.pickCards('make a bold page about my cat', { dir: FIX });
  expect(d.examples[0].file).toBe('your picks/report.md');
  expect(d.look.file).toBe('opus/look-bold.md');
}));

test('in a look, the example keeps its skeleton and its Do lines, with its Look section swapped for the look\'s and the look\'s Do and Don\'t after', () => withLooks(() => {
  const n = D.designNotes(D.pickCards('make a playful dashboard for my miner', { dir: FIX }), FIX);
  expect(n.text).toContain('[Example · DESIGN/opus/dashboard.md · in the Bold look from DESIGN/opus/look-bold.md]');
  expect(n.text).toContain('## Look (Bold look)\n- Colours: `--bg:#ff0` ($5 of paint)');
  expect(n.text).not.toContain('`--bg:#fff`'); // the example's own colours are gone
  expect(n.text).toContain('## Do\n- One thing.'); // the example's own Do stays
  expect(n.text).toContain('## Do (Bold look)\n- Keep it Bold look.');
  expect(n.text).toContain("## Don't (Bold look)\n- No stripes.");
  expect(n.cards.map((c) => c.file)).toEqual(['your rules/rules.md', 'opus/dashboard.md', 'opus/look-bold.md']);
  expect(n.chars).toBeLessThanOrEqual(D.NOTE_CHARS + D.LOOK_CHARS);
  expect(D.cardSection("## Do\n- a\n\n## Don't\n- b", "Don't")).toBe("## Don't\n- b");
  expect(D.cardSection("## Don't\n- b\n\n## Do\n- a", 'Do')).toBe('## Do\n- a');
}));

test('the style: opus or fable wins with its own best fitting card, even over a closer one; mix takes turns and the hub only peeks', () => {
  expect(D.pickCards('make a dashboard', { dir: FIX }).examples[0].file).toBe('opus/dashboard.md'); // auto: the set order
  expect(D.pickCards('make a dashboard', { dir: FIX, style: 'fable' }).examples[0].file).toBe('fable/dashboard.md');
  expect(D.pickCards('make a dashboard for my miner', { dir: FIX, style: 'fable' }).examples[0].file).toBe('fable/dashboard.md');
  expect(D.pickCards('make a dashboard for my miner', { dir: FIX, style: 'fable' }).more.map((c) => c.file)).toEqual(['opus/dashboard.md']);
  // the chosen set has nothing that fits: the usual order
  expect(D.pickCards('make a timer widget', { dir: FIX, style: 'fable' }).examples[0].file).toBe('opus/widget.md');
  const home = join(tmpdir(), `agentic-design-turn-${process.pid}`);
  try {
    expect(D.mixTurn({ home, peek: true })).toBe('opus');
    expect(D.mixTurn({ home })).toBe('opus');
    expect(D.mixTurn({ home, peek: true })).toBe('fable');
    expect(D.mixTurn({ home })).toBe('fable');
    expect(D.mixTurn({ home })).toBe('opus');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('/design lists the looks apart from the kinds, and stars the chosen style', () => withLooks(() => {
  const s = D.designSummary({ ...D.designSettings({}), style: 'fable' }, FIX);
  const row = (name) => s.rows.find((r) => r[0].includes(name));
  expect(row('opus')[1]).toMatch(/^2 cards: dashboard, widget · looks: bold, calm, dark$/);
  expect(row('fable')[0]).toBe('● fable ★');
  expect(s.style).toBe('fable');
}));

test('DESIGN/ paths reach the folder read-only, as MATH/ does; climbing out does not work', async () => {
  const cwd = join(tmpdir(), `agentic-design-proj-${process.pid}`); mkdirSync(cwd, { recursive: true });
  const p = resolvePath(cwd, 'DESIGN/opus/dashboard.md');
  expect(p).toMatchObject({ inside: true, design: true, abs: join(FIX, 'opus', 'dashboard.md') });
  expect(resolvePath(cwd, 'DESIGN/../secrets.txt').design).toBeUndefined();
  expect(resolvePath(cwd, join(FIX, 'fable', 'dashboard.md')).rel).toBe('DESIGN/fable/dashboard.md'); // a full path too
  expect(prepare('Write', { path: 'DESIGN/opus/new.md', content: 'x' }, { cwd }).error).toMatch(/design examples, which are read-only/);
  const read = await execute('Read', { path: 'DESIGN/opus/dashboard.md' }, {}, { cwd });
  expect(read.text).toContain('Status dashboard');
  const list = await execute('List', { path: 'DESIGN/opus' }, {}, { cwd });
  expect(list.text).toContain('DESIGN/opus/dashboard.md');
  const found = await execute('Search', { pattern: 'miner', path: 'DESIGN' }, {}, { cwd });
  expect(found.text).toContain('DESIGN/opus/dashboard.md');
});

test('the switches: saved settings, with AGENTIC_DESIGN, AGENTIC_LAYOUT, AGENTIC_LAYOUT_ASK and AGENTIC_DESIGN_SETS on top', () => {
  const keep = { d: process.env.AGENTIC_DESIGN, l: process.env.AGENTIC_LAYOUT, a: process.env.AGENTIC_LAYOUT_ASK, s: process.env.AGENTIC_DESIGN_SETS, st: process.env.AGENTIC_DESIGN_STYLE, so: process.env.AGENTIC_STUDIO };
  try {
    delete process.env.AGENTIC_DESIGN; delete process.env.AGENTIC_LAYOUT; delete process.env.AGENTIC_LAYOUT_ASK; delete process.env.AGENTIC_DESIGN_SETS;
    delete process.env.AGENTIC_DESIGN_STYLE; delete process.env.AGENTIC_STUDIO;
    expect(D.designSettings(undefined)).toEqual({ auto: true, check: true, ask: true, sets: 'all', style: 'auto', studio: true, polish: true, brief: true, learn: true, library: true, look: null });
    expect(D.designSettings({ auto: false, sets: ['opus'] })).toEqual({ auto: false, check: true, ask: true, sets: ['opus'], style: 'auto', studio: true, polish: true, brief: true, learn: true, library: true, look: null });
    expect(D.designSettings({ ask: false }).ask).toBe(false); // /design ask off: it checks by itself
    expect(D.designSettings({ style: 'fable' }).style).toBe('fable');
    expect(D.designSettings({ style: 'purple' }).style).toBe('auto'); // not a style: the usual order
    process.env.AGENTIC_DESIGN = 'on'; process.env.AGENTIC_LAYOUT = 'off'; process.env.AGENTIC_LAYOUT_ASK = 'off'; process.env.AGENTIC_DESIGN_SETS = 'Fable, opus'; process.env.AGENTIC_DESIGN_STYLE = 'Mix';
    expect(D.designSettings({ auto: false, style: 'opus' })).toEqual({ auto: true, check: false, ask: false, sets: ['fable', 'opus'], style: 'mix', studio: true, polish: true, brief: true, learn: true, library: true, look: null });
  } finally {
    for (const [k, v] of [['AGENTIC_DESIGN', keep.d], ['AGENTIC_LAYOUT', keep.l], ['AGENTIC_LAYOUT_ASK', keep.a], ['AGENTIC_DESIGN_SETS', keep.s], ['AGENTIC_DESIGN_STYLE', keep.st], ['AGENTIC_STUDIO', keep.so]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('the layout check: problems in plain words, each once; head lines checked from the source', () => {
  const found = (over = {}) => ({ w: 390, h: 844, errors: [], sideways: null, wide: [], overlaps: [], spills: [], cuts: [], contrast: [], faint: 0, tiny: 0, tinyEx: null, blank: false, ...over });
  const html = '<!doctype html><html><head><title>x</title></head><body></body></html>';
  const out = L.problemsOf(html, [
    { pass: L.PASSES[0], found: found({ w: 1440, errors: ['Uncaught ReferenceError: nope is not defined (line 9)'], contrast: [{ el: '"Updated" (span.meta)', fg: '#bbbbbb', bg: '#ffffff', ratio: 1.9, need: 4.5 }] }) },
    { pass: L.PASSES[1], found: found({ sideways: 932, wide: [{ el: '"B" (div.card)', inside: 'div.grid', width: 300, right: 620, left: 320 }], errors: ['Uncaught ReferenceError: nope is not defined (line 9)'] }) },
    { pass: L.PASSES[2], failed: 'timed out' },
  ]);
  expect(out[0]).toMatch(/no <meta charset="utf-8">/);
  expect(out[1]).toMatch(/no <meta name="viewport"/);
  expect(out.filter((p) => p.includes('nope is not defined'))).toHaveLength(1); // the same error at two sizes: once
  expect(out.some((p) => /On a phone \(390 px wide\) the page scrolls sideways \(932 px wide in a 390 px window\)\. "B" \(div\.card\), inside div\.grid, is 300 px wide and reaches 620 px/.test(p))).toBe(true);
  expect(out.some((p) => /too faint to read at 1440×900: "Updated" \(span\.meta\) is #bbbbbb on #ffffff \(1\.9:1; needs 4\.5:1\)/.test(p))).toBe(true);
  expect(L.layoutNote('page.html', out)).toMatch(/^The layout check opened page\.html in a browser[\s\S]*\n1\. [\s\S]*Fix these in the page with Edit/);
});

// Qwen, 30 Sep: the media player's play button was #1c1b18 on #2a78d6 (3.9:1) at 1440 px and
// 2.4:1 in dark mode. Only the first was told (one key for both), and the "fix" went the wrong
// way: white on a lighter blue, 3.7:1. Now dark mode is told too, with a colour that passes.
test('the layout check: faint text is told in light and in dark mode, each with a colour that passes and which way it goes', () => {
  const found = (over = {}) => ({ w: 1440, h: 900, errors: [], sideways: null, wide: [], overlaps: [], spills: [], cuts: [], contrast: [], faint: 1, tiny: 0, tinyEx: null, blank: false, ...over });
  const html = '<meta charset="utf-8"><meta name="viewport" content="width=device-width">';
  const play = '"▶" (button.main-play-btn)';
  const out = L.problemsOf(html, [
    { pass: L.PASSES[0], found: found({ contrast: [{ el: play, fg: '#ffffff', bg: '#3b82f6', ratio: 3.7, need: 4.5 }] }) },
    { pass: L.PASSES[1], found: found({ w: 390, contrast: [{ el: play, fg: '#ffffff', bg: '#3b82f6', ratio: 3.7, need: 4.5 }] }) },
    { pass: L.PASSES[2], found: found({ contrast: [{ el: play, fg: '#ffffff', bg: '#60a5fa', ratio: 2.5, need: 4.5 }] }) },
  ]);
  expect(out).toHaveLength(2); // the phone's is the same as 1440 px; dark mode's colours are its own
  // a page with no dark colours of its own: the same pair in dark mode is told once
  const same = L.problemsOf(html, [
    { pass: L.PASSES[0], found: found({ contrast: [{ el: play, fg: '#ffffff', bg: '#3b82f6', ratio: 3.7, need: 4.5 }] }) },
    { pass: L.PASSES[2], found: found({ contrast: [{ el: play, fg: '#ffffff', bg: '#3b82f6', ratio: 3.7, need: 4.5 }] }) },
  ]);
  expect(same).toHaveLength(1);
  expect(out[0]).toMatch(/^Text is too faint to read at 1440×900: "▶" \(button\.main-play-btn\) is #ffffff on #3b82f6 \(3\.7:1; needs 4\.5:1\)\. To pass: keep the text and make the background darker, such as (#[0-9a-f]{6}) \((\d\.\d):1\)\.$/);
  expect(out[1]).toMatch(/^Text is too faint to read in dark mode: "▶" \(button\.main-play-btn\) is #ffffff on #60a5fa \(2\.5:1; needs 4\.5:1\)\. To pass: keep the text and make the background darker, such as #[0-9a-f]{6}/);
  // the colours given really pass
  for (const p of out) {
    const [, hex] = /such as (#[0-9a-f]{6})/.exec(p);
    expect(L.contrastOf('#ffffff', hex)).toBeGreaterThanOrEqual(4.5);
  }
  // each way that works: grey text on white can only get darker; dark text on the old blue
  // only passes with a lighter blue; white on it only with a darker one
  const grey = L.passingColours('#b0b0b0', '#ffffff', 4.5);
  expect(grey.back).toBeNull();
  expect(grey.text.way).toBe('darker');
  expect(L.contrastOf(grey.text.hex, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  const ink = L.passingColours('#1c1b18', '#2a78d6', 4.5);
  expect(ink.text).toBeNull(); // not even black reaches 4.8:1 on it
  expect(ink.back.way).toBe('lighter');
  expect(L.contrastOf('#1c1b18', ink.back.hex)).toBeGreaterThanOrEqual(4.5);
  expect(L.passingColours('#ffffff', '#2a78d6', 4.5).back.way).toBe('darker');
  // large text needs 3:1
  expect(L.contrastOf('#ffffff', L.passingColours('#ffffff', '#60a5fa', 3).back.hex)).toBeGreaterThanOrEqual(3);
  // the second time, the note says the last change did not fix it
  expect(L.layoutNote('card.html', out, true)).toMatch(/^The layout check looked at card\.html again after your fix, and it still finds:\n1\. [\s\S]*\nYour last change did not fix these\. Fix them with Edit \(small edits, not a rewrite\); where a colour is given, use it\./);
  expect(L.layoutNote('card.html', out.slice(0, 1), true)).toContain('Your last change did not fix it. Fix it with Edit');
});

test('the probe goes first in <head> on its own line, so script line numbers stay right; server pages are left alone', () => {
  const html = '<!doctype html>\n<html>\n<head><meta charset="utf-8">\n<script>x()</script>';
  const out = L.withProbe(html, '/tmp/site', 'file:///tmp/p/probe.js');
  expect(out.split('\n')).toHaveLength(4);
  expect(out).toContain('<head><script src="file:///tmp/p/probe.js"></script><base href="file:///tmp/site/"><meta charset="utf-8">');
  expect(L.needsServer('<script type="module" src="/src/main.jsx"></script>')).toMatch(/dev server/);
  expect(L.needsServer('<h1>{{ title }}</h1>')).toMatch(/template/);
  expect(L.needsServer('<link rel="stylesheet" href="style.css"><script src="app.js"></script><a href="/about">About</a>')).toBeNull();
});

test('the pages to check: the .html files changed, and a page beside a changed stylesheet that uses it', () => {
  const cwd = join(tmpdir(), `agentic-design-pages-${process.pid}`); mkdirSync(join(cwd, 'site'), { recursive: true });
  writeFileSync(join(cwd, 'site', 'index.html'), '<link rel="stylesheet" href="style.css">');
  writeFileSync(join(cwd, 'site', 'other.html'), '<p>no styles</p>');
  writeFileSync(join(cwd, 'site', 'style.css'), 'body{}');
  writeFileSync(join(cwd, 'notes.html'), '<p>notes</p>');
  expect(L.pagesToCheck(cwd, ['notes.html', 'app.mjs'])).toEqual(['notes.html']);
  expect(L.pagesToCheck(cwd, ['site/style.css'])).toEqual(['site/index.html']);
  expect(L.pagesToCheck(cwd, ['README.md'])).toEqual([]);
});

// The rest needs a real browser: Chrome, or the one Playwright keeps.
const chrome = L.findChrome();
const BAD = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bad</title>
<style>body{margin:0;font-family:sans-serif}.grid{display:grid;grid-template-columns:300px 300px;gap:10px}.meta{color:#c8c8c8}</style></head>
<body><div class="grid"><div>Revenue</div><div>Costs</div></div><p class="meta">Updated 3 min ago</p></body></html>`;
const GOOD = BAD.replace('grid-template-columns:300px 300px', 'grid-template-columns:repeat(auto-fit,minmax(min(100%,140px),1fr))').replace('color:#c8c8c8', 'color:#595959');

test.skipIf(needs('chrome', () => chrome))('in a real browser: a page too wide for a phone and faint text are found; the fixed page is clean', async () => {
  const dir = join(tmpdir(), `agentic-design-real-${process.pid}`); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'bad.html'), BAD);
  writeFileSync(join(dir, 'good.html'), GOOD);
  const bad = await L.layoutCheck(join(dir, 'bad.html'), { chrome });
  expect(bad.skipped).toBeUndefined();
  expect(bad.problems.some((p) => /On a phone \(390 px wide\) the page scrolls sideways/.test(p))).toBe(true);
  expect(bad.problems.some((p) => /"Updated 3 min ago" \(p\.meta\) is #c8c8c8 on #ffffff/.test(p))).toBe(true);
  const good = await L.layoutCheck(join(dir, 'good.html'), { chrome });
  expect(good.problems).toEqual([]);
}, 60_000);

// Qwen's weather page (29 Sep): "Load Different Data" picked a random scenario
// and drew the sunny one anyway. Beside it, buttons that are fine but look dead
// on a first click: a Reset on a fresh page, an Add with nothing typed, a Copy
// that only copies, a Back that only works after Next.
const BUTTONS = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Weather</title></head>
<body><div id="w"></div><ol id="list"></ol><p id="n">0</p><input id="city">
<button id="load">Load Different Data</button><button id="more">More</button><button id="reset">Reset</button>
<button id="add">Add</button><button id="copy">Copy</button><button id="next">Next</button><button id="back">Back</button><button id="oops">Oops</button>
<script>
var data = { sunny: 'Sunny 24°', rainy: 'Rain 12°', snowy: 'Snow -2°' }, n = 0, card = 0;
function render() { document.getElementById('w').textContent = data.sunny; }
render();
document.getElementById('load').onclick = function () { var keys = Object.keys(data); var randomKey = keys[Math.floor(Math.random() * keys.length)]; render(); };
document.getElementById('more').onclick = function () { n++; document.getElementById('n').textContent = n; };
document.getElementById('reset').onclick = function () { n = 0; document.getElementById('n').textContent = n; };
document.getElementById('add').onclick = function () { var v = document.getElementById('city').value; if (!v) return; var li = document.createElement('li'); li.textContent = v; document.getElementById('list').appendChild(li); };
document.getElementById('copy').onclick = function () { navigator.clipboard && navigator.clipboard.writeText('24°').catch(function () {}); };
document.getElementById('next').onclick = function () { card++; document.title = 'Card ' + card; };
document.getElementById('back').onclick = function () { if (card > 0) { card--; document.title = 'Card ' + card; } };
document.getElementById('oops').onclick = function () { nothere(); };
</script></body></html>`;

test.skipIf(needs('chrome', () => chrome))('in a real browser: the click pass finds the dead button and the one that throws, and leaves the working ones alone', async () => {
  const dir = join(tmpdir(), `agentic-design-clicks-${process.pid}`); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'weather.html'), BUTTONS);
  const r = await L.layoutCheck(join(dir, 'weather.html'), { chrome });
  const clicks = r.problems.filter((p) => /^Clicking /.test(p));
  expect(clicks.some((p) => /^Clicking "Load Different Data" \(button#load\) changes nothing/.test(p))).toBe(true);
  expect(clicks.some((p) => /^Clicking "Oops" \(button#oops\) gives an error: .*nothere/.test(p))).toBe(true);
  for (const fine of ['more', 'reset', 'add', 'copy', 'next', 'back']) expect(clicks.some((p) => p.includes(`button#${fine})`) && /changes nothing/.test(p))).toBe(false);
  expect(L.layoutNote('weather.html', r.problems)).toMatch(/clicked its buttons/);
  const plain = await L.layoutCheck(join(dir, 'weather.html'), { chrome, clicks: false });
  expect(plain.problems.some((p) => /^Clicking /.test(p))).toBe(false);
}, 60_000);

// 30 Sep (the design studio's pieces): text for screen readers only is never drawn, so it
// overlaps or is cut by nothing; and a sign-in button works once its password box is filled.
const QUIET = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in</title>
<style>.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border-width:0}.box{position:relative}.icon{position:absolute;left:0}</style></head>
<body><div class="box"><label class="sr-only" for="q">Search the whole site for orders</label><span class="icon">⌕</span><input id="q"></div>
<form id="f"><input type="email" required><input type="password" required><button>Sign in</button></form><p id="said"></p>
<script>document.getElementById('f').onsubmit = function (e) { e.preventDefault(); document.getElementById('said').textContent = 'Signing in'; };</script></body></html>`;

test.skipIf(needs('chrome', () => chrome))('in a real browser: screen-reader-only text is not "overlapping" or "cut", and a sign-in button counts once its password box is filled', async () => {
  const dir = join(tmpdir(), `agentic-design-quiet-${process.pid}`); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'signin.html'), QUIET);
  const r = await L.layoutCheck(join(dir, 'signin.html'), { chrome });
  expect(r.problems).toEqual([]);
}, 60_000);

test.skipIf(needs('chrome', () => chrome))('the agent: a page request brings the cards; the page it wrote is checked, sent back once, and checked again after the fix', async () => {
  const { Agent } = await import('../src/agent/agent.mjs');
  const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');
  const { startFakeServer } = await import('./fake-server.mjs');
  const { systemPrompt } = await import('../src/agent/prompt.mjs');
  const cwd = join(tmpdir(), `agentic-design-agent-${process.pid}`); rmSync(cwd, { recursive: true, force: true }); mkdirSync(cwd, { recursive: true });
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'dash.html', content: BAD } } },
    { text: 'I made dash.html.' },
    { tool: { name: 'Edit', args: { path: 'dash.html', old_text: 'grid-template-columns:300px 300px', new_text: 'grid-template-columns:repeat(auto-fit,minmax(min(100%,140px),1fr))' } } },
    { tool: { name: 'Edit', args: { path: 'dash.html', old_text: 'color:#c8c8c8', new_text: 'color:#595959' } } },
    { text: 'The grid now wraps on a phone and the date is darker.' },
  ]);
  const notes = [];
  const agent = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd, system: systemPrompt({ cwd, git: 'test', tests: null }), thinking: false, ctx: 32768, mode: 'edits', flows: false, verify: false, checkIns: false, ask: async () => ({ choice: 'yes' }), design: { auto: true, check: true } });
  agent.on('note', (e) => notes.push(e.text));
  const keep = { d: process.env.AGENTIC_DESIGN, l: process.env.AGENTIC_LAYOUT };
  process.env.AGENTIC_DESIGN = 'on'; process.env.AGENTIC_LAYOUT = 'on';
  try { await agent.send('make a dashboard page for my miner'); } finally {
    for (const [k, v] of [['AGENTIC_DESIGN', keep.d], ['AGENTIC_LAYOUT', keep.l]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await fake.close();
  }
  // the cards went with the request, and said so
  expect(notes.some((t) => /^Design examples: your rules\/rules \+ opus\/dashboard \(≈[\d,]+ tokens\)\.$/.test(t))).toBe(true);
  expect(JSON.stringify(fake.requests[0].messages)).toContain('[Example · DESIGN/opus/dashboard.md]');
  // what was broken went back once, in plain words
  const back = JSON.stringify(fake.requests[2].messages.at(-1));
  expect(back).toContain('The layout check opened dash.html in a browser');
  expect(back).toContain('scrolls sideways');
  expect(notes.some((t) => /^Layout check, dash\.html: \d+ problems?/.test(t))).toBe(true);
  // after the fix it looked again and found nothing; nothing more was sent
  expect(notes.at(-1) ?? '').toMatch(/^Layout check, dash\.html: nothing broken/);
  expect(fake.remaining()).toBe(0);
  expect(readFileSync(join(cwd, 'dash.html'), 'utf8')).toContain('#595959');
  // fixed for real: no "Still broken" line
  expect(notes.some((t) => /^Still broken/.test(t))).toBe(false);
}, 90_000);

// Qwen, 30 Sep: "Changed the button text to meet the 4.5:1 contrast", and it was 4.1:1.
test.skipIf(needs('chrome', () => chrome))('the agent: a "fix" the layout check does not agree with ends the turn with a "Still broken" line, after the answer', async () => {
  const { Agent } = await import('../src/agent/agent.mjs');
  const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');
  const { startFakeServer } = await import('./fake-server.mjs');
  const { systemPrompt } = await import('../src/agent/prompt.mjs');
  const cwd = join(tmpdir(), `agentic-design-still-${process.pid}`); rmSync(cwd, { recursive: true, force: true }); mkdirSync(cwd, { recursive: true });
  const faint = GOOD.replace('color:#595959', 'color:#c8c8c8');
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'dash.html', content: faint } } },
    { text: 'I made dash.html.' },
    { tool: { name: 'Edit', args: { path: 'dash.html', old_text: 'color:#c8c8c8', new_text: 'color:#b0b0b0' } } },
    { text: 'Darkened the date so it meets the 4.5:1 contrast requirement.' },
    // the second round (LAYOUT_ROUNDS): still too light
    { tool: { name: 'Edit', args: { path: 'dash.html', old_text: 'color:#b0b0b0', new_text: 'color:#a0a0a0' } } },
    { text: 'Darkened the date again; it meets 4.5:1 now.' },
  ]);
  const seen = [];
  const agent = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd, system: systemPrompt({ cwd, git: 'test', tests: null }), thinking: false, ctx: 32768, mode: 'edits', flows: false, verify: false, checkIns: false, ask: async () => ({ choice: 'yes' }), design: { auto: false, check: true } });
  agent.on('note', (e) => seen.push({ type: 'note', text: e.text }));
  agent.on('assistant', (e) => { if (e.final) seen.push({ type: 'answer', text: e.text }); });
  const keep = process.env.AGENTIC_LAYOUT;
  process.env.AGENTIC_LAYOUT = 'on';
  try { await agent.send('make a dashboard page for my miner'); } finally {
    if (keep === undefined) delete process.env.AGENTIC_LAYOUT; else process.env.AGENTIC_LAYOUT = keep;
    await fake.close();
  }
  const last = seen.at(-1);
  expect(last.type).toBe('note');
  expect(last.text).toMatch(/^Still broken: Text is too faint to read .*"Updated 3 min ago" \(p\.meta\) is #a0a0a0 on #ffffff .*The page check looked at dash\.html again after the fix\.$/);
  // what was left after the first fix went back once more, with a colour that passes
  const again = fake.requests.map((r) => JSON.stringify(r.messages.at(-1))).filter((m) => m.includes('looked at dash.html again after your fix'));
  expect(again).toHaveLength(1);
  expect(again[0]).toContain('#b0b0b0 on #ffffff');
  expect(again[0]).toMatch(/To pass: keep the background and make the text darker, such as #[0-9a-f]{6}/);
  // it comes after the answer that said it was fixed
  expect(seen.findIndex((x) => x.type === 'answer' && /4\.5:1/.test(x.text))).toBeLessThan(seen.length - 1);
  expect(fake.remaining()).toBe(0);
}, 90_000);
