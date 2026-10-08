// The design pipeline (8 Oct 2026, the owner's picks): what a page request asks for decides which studio
// piece and card go with it (design.mjs askedThing, kindHits; studio.mjs pickPieces); a six-line plan
// before writing (pageBrief); the layout check and a look at a picture of the page before you are asked
// (polishPage, pageReviewer); and "Looks good" offering to keep the page as one of your picks (savePick).
// Built against fixture folders, never the real ones.
import { test, expect, afterAll } from 'bun:test';
import { needs } from './needs.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-design-pipe-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const CARDS = join(tmpdir(), `agentic-design-pipe-cards-${process.pid}`);
const STUDIO = join(tmpdir(), `agentic-design-pipe-studio-${process.pid}`);
process.env.AGENTIC_DESIGN_DIR = CARDS;
process.env.AGENTIC_STUDIO_DIR = STUDIO;
const D = await import('../src/agent/design.mjs');
const S = await import('../src/agent/studio.mjs');
const { Agent, AUTO } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { findChrome } = await import('../src/flows/layoutcheck.mjs');
const { LOOK_OVER } = await import('../src/agent/helper-models.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL, setEndpoint, dropEndpoint } = await import('../../models/index.mjs');

const card = (name, words, extra = '') => `# ${name}\n- For: ${name.toLowerCase()}\n- Words: ${words}\n${extra}\n## Look\n- Colours: \`--bg:#fff\`\n\n## Do\n- One thing.\n`;
const piece = (name, words) => `<!--\n# ${name}\n- For: ${name.toLowerCase()}\n- Words: ${words}\n-->\n<div class="bg-surface p-4">${name}</div>\n`;
function fixtures() {
  rmSync(CARDS, { recursive: true, force: true });
  rmSync(STUDIO, { recursive: true, force: true });
  for (const d of ['your rules', 'your picks', 'opus', 'fable']) mkdirSync(join(CARDS, d), { recursive: true });
  writeFileSync(join(CARDS, 'your rules', 'rules.md'), '# The rules\n- For: every page\n- Words: page\n- Always: yes\n\n## Fit\n- Never scroll sideways.\n');
  writeFileSync(join(CARDS, 'fable', 'widget.md'), card('Widget', 'widget, card, data card, badge, small, countdown'));
  writeFileSync(join(CARDS, 'fable', 'report.md'), card('Report', 'report, results, pass, fail, summary'));
  writeFileSync(join(CARDS, 'opus', 'invoice.md'), card('Invoice', 'invoice, receipt, bill'));
  writeFileSync(join(CARDS, 'opus', 'dashboard.md'), card('Dashboard', 'dashboard, stats'));
  writeFileSync(join(CARDS, 'opus', 'media-player.md'), card('Media player', 'media player, music player, playlist'));
  for (const k of ['cards', 'forms']) mkdirSync(join(STUDIO, 'components', k), { recursive: true });
  writeFileSync(join(STUDIO, 'components', 'cards', 'goal-progress.html'), piece('Goal progress', 'goal, progress, progress bar, target'));
  writeFileSync(join(STUDIO, 'components', 'cards', 'weather-card.html'), piece('Weather card', 'weather, forecast, city, temperature'));
  writeFileSync(join(STUDIO, 'components', 'cards', 'media-player.html'), piece('Media player', 'media player, music player, now playing, track'));
  writeFileSync(join(STUDIO, 'components', 'cards', 'notification.html'), piece('Notification card', 'notification, toast, inbox item, dismiss'));
  writeFileSync(join(STUDIO, 'components', 'forms', 'toggle-switch.html'), piece('Toggle switch', 'toggle, switch, on off'));
  writeFileSync(join(STUDIO, 'components', 'forms', 'file-upload.html'), piece('File upload', 'upload, file upload, drop zone, choose file'));
}
fixtures();
afterAll(() => { rmSync(CARDS, { recursive: true, force: true }); rmSync(STUDIO, { recursive: true, force: true }); });

// The owner's own card prompts (8 Oct 2026), cut to their first sentences.
const FILE = 'Build one self-contained HTML file for a file or document card. Show a file-type badge, the owner, a small progress or sync indicator, and Open and Share.';
const PASS = 'Build one HTML file for a travel boarding-pass card. Include the carrier, the city codes, gate and seat.';
const PLAYER = 'Create a self-contained HTML file for a compact media player card. Show a progress bar and play, skip and like buttons; toggle play state.';
const NOTE = 'Write a self-contained HTML file for an in-app notification card with Dismiss and View.';
const BILL = 'Build a self-contained HTML file for a billing or invoice snapshot. Show the status pill and the line items.';

test('the thing a request asks for: its phrase, the words that say its kind, and its noun', () => {
  expect(D.askedThing(FILE)).toEqual({ phrase: 'file or document card', words: ['file', 'document'], head: 'card' });
  expect(D.askedThing(PASS)).toEqual({ phrase: 'travel boarding pass card', words: ['travel', 'boarding', 'pass'], head: 'card' });
  expect(D.askedThing('Make one HTML file that displays a social feed post. Include an avatar.')).toEqual({ phrase: 'social feed post', words: ['social', 'feed', 'post'], head: 'post' });
  expect(D.askedThing('redesign the settings page so it looks modern').words).toEqual(['settings', 'page']);
  expect(D.askedThing('a kanban board for my tasks')).toBeNull(); // nothing says "a … <thing>": the words alone, as before
});

test('a piece goes only when it says the thing asked for: a part the request names never brings a wrong one', () => {
  const names = (t) => S.pickPieces(t).pieces.map((p) => p.name);
  // before: a goal card (its "progress") and a toggle switch for a file card; a weather card (its "city") for a boarding pass
  expect(names(FILE)).toEqual([]);
  expect(names(PASS)).toEqual([]);
  // the right one still comes, and a second one for a part the request names (its progress bar)
  expect(names(PLAYER)).toEqual(['Media player', 'Goal progress']);
  expect(S.pickPieces(PLAYER, { ctx: 32_768 }).pieces.map((p) => p.name)).toEqual(['Media player']); // 32k: one piece
  expect(names(NOTE)).toEqual(['Notification card']);
});

test('one word alone does not say a thing of two (a report\'s "pass", a file upload\'s "file"); one of two it offers does', () => {
  expect(D.pickCards(PASS).examples[0].file).toBe('fable/widget.md'); // not fable/report.md
  expect(D.pickCards(FILE).examples[0].file).toBe('fable/widget.md');
  expect(D.pickCards(BILL).examples[0].file).toBe('opus/invoice.md'); // "billing or invoice": the invoice card
  expect(D.pickCards(PLAYER)).toMatchObject({ hits: 2 }); // "media player", both words
});

test('the page plan: six lines asked for, read back in order; an answer without them is no plan', () => {
  const { system, user } = D.briefAsk(PASS, '[Example · DESIGN/fable/widget.md]\n# Widget\n\n## Look\n- Colours: `--bg:#fff`\n\n## Do\n- One thing.');
  expect(system).toBe(D.BRIEF_SYSTEM);
  expect(user).toContain('boarding-pass card');
  expect(user).toContain("The design example's look:\n## Look\n- Colours: `--bg:#fff`");
  const brief = D.parseBrief('Sure!\n**Main thing:** the route, SFO → JFK\n- Size: a card 380 px wide, centred\nParts, top to bottom: carrier, route, gate and seat\nLook: white card, blue accent\nStates: none\nPhone: full width less 16 px');
  expect(brief.split('\n').map((l) => l.split(':')[0])).toEqual(D.BRIEF_LINES);
  expect(D.parseBrief('Main thing: x\nSize: y')).toBeNull();
  expect(D.briefNote('Main thing: x')).toStartWith('The plan for this page');
});

test('a kept page: a card in your picks with the page beside it, found by what it is; it wins over the other sets and the studio', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-keep-'));
  const page = join(dir, 'boarding.html');
  writeFileSync(page, '<!doctype html><html><head><meta charset="utf-8"><title>Pass</title><style>:root{--paper:#f7f6f2;--accent:#1f66bd}@media (prefers-color-scheme: dark){:root{--paper:#15161a}}.pass{max-width:380px;border-radius:14px;font-family:system-ui}</style></head><body><main class="pass"><header class="top"><h1>SFO → JFK</h1></header><dl id="seat"></dl></main></body></html>');
  const kept = D.savePick({ abs: page, request: PASS, dir: CARDS });
  expect(kept).toEqual({ card: 'your picks/travel-boarding-pass-card.md', page: 'your picks/travel-boarding-pass-card.html' });
  expect(readFileSync(join(CARDS, kept.page), 'utf8')).toBe(readFileSync(page, 'utf8'));
  const c = D.parseCard(readFileSync(join(CARDS, kept.card), 'utf8'), kept.card);
  expect(c.name).toBe('Travel boarding pass card');
  expect(c.words).toContain('boarding pass');
  expect(c.words.every((w) => w.includes(' '))).toBe(true); // never a single word
  expect(c.page).toBe('travel-boarding-pass-card.html');
  expect(c.body).toContain('- Colours: --paper: #f7f6f2; --accent: #1f66bd');
  expect(c.body).toContain('- Dark mode: --paper: #15161a');
  expect(c.body).toContain('main.pass\n  header.top\n    h1\n  dl#seat');
  // the next boarding pass gets it, ahead of the widget card; a second keep is -2
  const next = D.pickCards('Make a boarding pass card for my flight to Lisbon');
  expect(next.examples[0].file).toBe('your picks/travel-boarding-pass-card.md');
  expect(next.hits).toBeGreaterThan(0);
  expect(D.savePick({ abs: page, request: PASS, dir: CARDS }).card).toBe('your picks/travel-boarding-pass-card-2.md');
  rmSync(join(CARDS, 'your picks'), { recursive: true, force: true });
  mkdirSync(join(CARDS, 'your picks'));
});

const model = MODELS[DEFAULT_MODEL];
const PAGE = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pass</title>
<style>:root{color-scheme:light dark}body{margin:0;font-family:system-ui,sans-serif;background:#ffffff;color:#1c1b18}@media (prefers-color-scheme:dark){body{background:#15161a;color:#f2f2f2}}main{max-width:400px;margin:24px auto;padding:16px}button{font:inherit;padding:8px 14px;border-radius:8px;border:0;background:#1f66bd;color:#ffffff}</style></head>
<body><main>${body}</main></body></html>`;
const DEAD = PAGE('<h1>SFO to JFK</h1><p>Gate B12 · Seat 14C</p><button id="download" type="button">Download</button>');
const GOOD = PAGE('<h1>SFO to JFK</h1><p>Gate B12 · Seat 14C</p>');
const answering = (answers, asked) => async (req) => {
  if (req.name !== 'Ask') return { choice: 'yes' };
  asked.push(req.args.question);
  return { choice: 'answer', text: answers.shift() };
};
const lastUser = (req) => [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
const withEnv = async (vars, fn) => {
  const keep = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return await fn(); } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

const chrome = findChrome();
test.skipIf(needs('chrome', () => chrome))('fix first, then ask: the layout check sends what is broken back before you are asked, and the question says so', () => withEnv({ AGENTIC_LAYOUT: 'on' }, async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-polish-'));
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'pass.html', content: DEAD } } },
    { text: 'Download saves the pass now.' },
    { text: 'never sent' },
  ]);
  const asked = [];
  const agent = new Agent({ url: fake.url, model, cwd, home: cwd, system: systemPrompt({ cwd, git: 'test', tests: null }), thinking: false, mode: 'edits', flows: false, verify: false, confirmPlan: false, checkIns: false, ask: answering(['Looks good'], asked), openPage: () => {}, pageAsk: true });
  const reason = await agent.send(PASS);
  await fake.close();
  expect(reason).toBe('done');
  const back = lastUser(fake.requests[1]);
  expect(back).toStartWith(AUTO);
  expect(back).toContain('Clicking "Download" (button#download) changes nothing');
  expect(asked).toEqual(['pass.html is saved and open in your browser (checked first: 1 layout problem sent back). Have a look: is it right?']);
  expect(fake.remaining()).toBe(1);
}), 60_000);

test.skipIf(needs('chrome', () => chrome))('on a model on another machine that sees: a plan before writing, a look at a picture before you are asked, and "Looks good" keeps the page', () => withEnv({ AGENTIC_LAYOUT: 'on', AGENTIC_DESIGN: 'on' }, async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-review-'));
  const isPlan = (j) => j.messages?.[0]?.content === D.BRIEF_SYSTEM;
  const isLook = (j) => j.messages?.[0]?.content === LOOK_OVER;
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'pass.html', content: GOOD } } },
    { text: 'Made the route larger.' },
    { text: 'never sent' },
  ], { delayMs: 0, route: (j) => (isPlan(j) ? { text: 'Main thing: the route\nSize: a card 380 px wide, centred\nParts: route, gate, seat\nLook: white card, blue accent\nStates: none\nPhone: full width' } : isLook(j) ? { text: '- The route is no larger than the gate: make the h1 36 px.' } : null) });
  setEndpoint(fake.url, { remote: true, kind: 'openai', model: 'seer', label: 'svc' });
  try {
    const asked = [];
    const notes = [];
    const agent = new Agent({ url: fake.url, model: { ...model, remote: { model: 'seer' } }, cwd, home: cwd, system: systemPrompt({ cwd, git: 'test', tests: null }), thinking: false, mode: 'edits', flows: false, verify: false, confirmPlan: false, checkIns: false, hooks: [], ask: answering(['Looks good', 'Yes, keep it'], asked), openPage: () => {}, pageAsk: true });
    agent.canSee = true;
    agent.on('note', (n) => notes.push(n.text));
    expect(agent.pageReviewer()).toMatchObject({ name: 'seer' });
    const reason = await agent.send(PASS);
    expect(reason).toBe('done');
    const plan = fake.requests.find(isPlan);
    expect(plan.messages[1].content).toContain('boarding-pass card');
    const first = fake.requests.find((j) => !isPlan(j) && !isLook(j));
    expect(JSON.stringify(first.messages)).toContain('The plan for this page');
    const look = fake.requests.find(isLook);
    expect(JSON.stringify(look.messages)).toContain('image_url');
    expect(JSON.stringify(look.messages)).toContain('Its plan:\\nMain thing: the route');
    const sent = fake.requests.filter((j) => !isPlan(j) && !isLook(j)).map(lastUser);
    expect(sent.some((u) => u.startsWith(AUTO) && u.includes('make the h1 36 px'))).toBe(true);
    expect(asked[0]).toBe('pass.html is saved and open in your browser (checked first: nothing broken, 1 design note from seer sent back). Have a look: is it right?');
    expect(asked[1]).toBe('Keep pass.html as one of your picks? Later requests for a travel boarding pass card get it as their example.');
    expect(existsSync(join(CARDS, 'your picks', 'travel-boarding-pass-card.md'))).toBe(true);
    expect(notes).toContain('Kept as DESIGN/your picks/travel-boarding-pass-card.md, with the page beside it.');
  } finally { await fake.close(); dropEndpoint?.(fake.url); rmSync(join(CARDS, 'your picks'), { recursive: true, force: true }); mkdirSync(join(CARDS, 'your picks')); }
}), 60_000);

test('who looks at the picture: the model the window is on when it sees; else the helper; never the Claude API or this Mac', () => {
  const at = (url, model, extra = {}) => Object.assign(new Agent({ url, model, cwd: tmpdir(), system: 'x', memory: false }), extra);
  setEndpoint('http://svc.test:1', { remote: true, kind: 'openai', model: 'seer' });
  setEndpoint('http://claude.test:1', { remote: true, kind: 'claude', model: 'claude-opus-5-5' });
  try {
    expect(at('http://svc.test:1', { ...model, remote: { model: 'seer' } }, { canSee: true }).pageReviewer()).toMatchObject({ name: 'seer' });
    expect(at('http://svc.test:1', { ...model, remote: { model: 'blind' } }, { canSee: false }).pageReviewer()).toBeNull(); // no helper on an OpenAI service
    expect(at('http://claude.test:1', { ...model, remote: { model: 'claude-opus-5-5' } }, { canSee: true }).pageReviewer()).toBeNull();
    expect(at('http://127.0.0.1:1', model, { canSee: true }).pageReviewer()).toBeNull();
  } finally { dropEndpoint?.('http://svc.test:1'); dropEndpoint?.('http://claude.test:1'); }
});
