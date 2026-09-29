// The design examples (src/agent/design.mjs) and the layout check
// (src/flows/layoutcheck.mjs): cards read from a folder, matched to a request
// to make or restyle a page, carried with that request, reachable read-only as
// DESIGN/; the page the model made opened in a real browser and what is broken
// sent back once. Built against a fixture folder, never the real one.
import { test, expect, afterAll } from 'bun:test';
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
  'can you make a landing page for my trading app?', 'the settings screen looks dated, redesign it'];
const NOT = ['fix the bug in export.py', 'what does the dashboard do?', 'add a --json flag to export.mjs', 'rename total to sum', 'add unit tests for the parser',
  'make the chart function faster', 'build the app', 'add a column to the users table', 'why is the page blank?', 'update the api route for /users', 'write a python script that renames my photos',
  'explain how the reranker works', 'run the tests'];
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

test('the switches: saved settings, with AGENTIC_DESIGN, AGENTIC_LAYOUT and AGENTIC_DESIGN_SETS on top', () => {
  const keep = { d: process.env.AGENTIC_DESIGN, l: process.env.AGENTIC_LAYOUT, s: process.env.AGENTIC_DESIGN_SETS };
  try {
    delete process.env.AGENTIC_DESIGN; delete process.env.AGENTIC_LAYOUT; delete process.env.AGENTIC_DESIGN_SETS;
    expect(D.designSettings(undefined)).toEqual({ auto: true, check: true, sets: 'all' });
    expect(D.designSettings({ auto: false, sets: ['opus'] })).toEqual({ auto: false, check: true, sets: ['opus'] });
    process.env.AGENTIC_DESIGN = 'on'; process.env.AGENTIC_LAYOUT = 'off'; process.env.AGENTIC_DESIGN_SETS = 'Fable, opus';
    expect(D.designSettings({ auto: false })).toEqual({ auto: true, check: false, sets: ['fable', 'opus'] });
  } finally {
    for (const [k, v] of [['AGENTIC_DESIGN', keep.d], ['AGENTIC_LAYOUT', keep.l], ['AGENTIC_DESIGN_SETS', keep.s]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
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

test.skipIf(!chrome)('in a real browser: a page too wide for a phone and faint text are found; the fixed page is clean', async () => {
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

test.skipIf(!chrome)('the agent: a page request brings the cards; the page it wrote is checked, sent back once, and checked again after the fix', async () => {
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
}, 90_000);
