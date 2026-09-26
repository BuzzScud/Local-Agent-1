// A walk through every screen of the app, at one window size, with resizes
// along the way: the real app in a resizable terminal, the model scripted.
// Each screen is captured (as HTML with Terminal's colours) and checked.
//   node terminal/scripts/ui-walk.mjs [--cols 155 --rows 43] [--out file.json] [--only tour,flows]
import { cpSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openTerm } from '../test/term.mjs';
import { startFakeServer } from '../test/fake-server.mjs';
import { demoReplies } from '../test/demo-script.mjs';
import { checkScreen } from '../test/screen-checks.mjs';
import { termToHtml } from '../test/term-html.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const COLS = Number(opt('cols', 155));
const ROWS = Number(opt('rows', 43));
const only = opt('only', null)?.split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LONG = 'The project is a small Node.js script that reads trades.json and prints it as CSV. It has two tests in export.test.mjs, both passing, and no dependencies beyond Node itself. The main function reads the file, maps each trade to a line with the symbol, side, quantity and price, and joins the lines with newlines.';
const REPLY = `## What export.mjs does\n\n${LONG}\n\n- **toCsv(rows)** turns the rows into CSV text, one line per trade\n- **main(argv)** reads the file named on the command line (default \`trades.json\`)\n- It exits with code 0 when it worked\n\n\`\`\`js\nexport function toCsv(rows) {\n  return [HEADER, ...rows.map((r) => [r.symbol, r.side, r.qty, r.price].join(','))].join('\\n');\n}\n\`\`\`\n\nRun it with \`node export.mjs trades.json\`.`;
const THINK = 'The user asks me to think it over. The file is short, so the question is really about the design: whether the CSV header belongs in toCsv or in main, and whether quantities should be formatted. '.repeat(6);

function setup(from = 'demo-project') {
  const base = mkdtempSync(join(tmpdir(), 'bonsai-walk-'));
  const cwd = join(base, 'project');
  cpSync(join(root, from), cwd, { recursive: true });
  return { cwd, env: { BONSAI_HOME: join(base, 'home') } };
}

const shots = [];
async function shot(t, name, { anchored = false, expectBox = true, note = '', must = [], mustNot = [] } = {}) {
  await t.settle();
  const lines = await t.lines();
  const all = await t.lines({ all: true });
  const b = t.term.buffer.active;
  const html = termToHtml(t.term, { from: b.viewportY, to: b.viewportY + t.rows });
  const checks = checkScreen(lines, { cols: t.cols, rows: t.rows, anchored, expectBox, scrollback: all });
  const screenText = lines.map((l) => l.text).join('\n');
  for (const m of must) checks.push({ what: `shows "${m}"`, ok: screenText.includes(m), detail: '' });
  for (const m of mustNot) checks.push({ what: `does not show "${m}"`, ok: !screenText.includes(m), detail: '' });
  // Full clears (screen + scrollback) so far: one per resize is expected, more means flicker.
  const clears = t.raw().toString('latin1').split('\x1b[3J').length - 1;
  shots.push({ name, cols: t.cols, rows: t.rows, html, text: lines.map((l) => l.text).join('\n'), checks, note, clears, resizes: t.resizes ?? 0 });
  const bad = checks.filter((c) => !c.ok);
  console.log(`${bad.length ? '✗' : '✓'} ${name} (${t.cols}×${t.rows})${bad.length ? ` — ${bad.map((c) => `${c.what}${c.detail ? ` [${c.detail}]` : ''}`).join('; ')}` : ''}`);
}

// Resize and wait for the app to settle (it redraws once the drag stops).
async function resize(t, c, r) { t.resizes = (t.resizes ?? 0) + 1; t.resize(c, r); await sleep(120); await t.idle(500, 5000); }
async function drag(t, from, to, r) {
  const step = from > to ? -5 : 5;
  t.resizes = (t.resizes ?? 0) + 1;
  for (let c = from; step < 0 ? c >= to : c <= to; c += step) { t.resize(c, r); await sleep(25); }
  await sleep(120);
  await t.idle(500, 5000);
}

async function clearInput(t) { for (let i = 0; i < 3; i++) { t.key('esc'); await sleep(120); } await t.idle(); }

// The resizes run in each state: shrink, grow, a fast drag, height only, too small, back.
async function resizes(t, label, opts = {}) {
  opts = { ...opts, anchored: !opts.noAnchor };
  const [sc, sr] = t.cols === 80 && t.rows === 24 ? [90, 26] : [80, 24];
  await resize(t, sc, sr); await shot(t, `${label} · resized to ${sc}×${sr}`, opts);
  await resize(t, 200, 50); await shot(t, `${label} · grown to 200×50`, opts);
  await drag(t, 155, 85, 43); await shot(t, `${label} · dragged 155→85`, opts);
  await resize(t, 120, 24); await shot(t, `${label} · height only (120×24)`, opts);
  await resize(t, 70, 20); await shot(t, `${label} · too small (70×20)`, { ...opts, expectBox: false });
  await resize(t, COLS, ROWS); await shot(t, `${label} · back to ${COLS}×${ROWS}`, opts);
}

async function tour() {
  const { cwd, env } = setup();
  const replies = [
    { reasoning: 'Read the file first.', tool: { name: 'Read', args: { path: 'export.mjs' } } },
    { text: REPLY },
    ...demoReplies,
    // After "Done" with changes, Bonsai checks the work against the request (verifyDone).
    { text: '{"done": true, "missing": ""}' },
    { reasoning: THINK.repeat(14), text: 'Done thinking: keep the header in toCsv.' },
    { text: 'Second answer, sent after the first finished.' },
    { reasoning: THINK + THINK },
  ];
  const fake = await startFakeServer(replies, { delayMs: 12 });
  const t = openTerm({ cwd, cols: COLS, rows: ROWS, env, args: ['--url', fake.url, '--no-flows', '--layout', 'classic'] });
  try {
    await t.waitFor('? for shortcuts'); await t.idle();
    await shot(t, 'welcome', { anchored: true });
    await t.type('?'); await t.idle(); await shot(t, 'shortcuts (?)');
    await t.type('?'); await t.idle();
    await t.type('/'); await t.idle(); await shot(t, 'slash menu', { anchored: false });
    await t.type('mo'); await t.idle(); await shot(t, 'slash menu filtered (/mo)', { anchored: false });
    await clearInput(t);
    await t.type('/model'); t.key('enter'); await t.waitFor('Pick the model'); await t.idle();
    await shot(t, '/model picker');
    await resizes(t, '/model picker');
    t.key('esc'); await t.idle();
    await t.type('first line\\'); t.key('enter'); await t.type('second line of a longer message'); await t.idle();
    await shot(t, 'multi-line input', { anchored: false });
    await clearInput(t);
    await t.type('explain export.mjs'); t.key('enter');
    await t.waitFor('esc to interrupt'); await shot(t, 'working (spinner)');
    await t.waitFor('node export.mjs trades.json', 20_000); await t.waitGone('esc to interrupt'); await t.idle();
    await shot(t, 'markdown reply', { anchored: true });
    await resizes(t, 'idle after a reply', { anchored: false });
    await t.type('/stats'); t.key('enter'); await t.idle(); await shot(t, '/stats', { anchored: false });
    await t.type('/help'); t.key('enter'); await t.idle(); await shot(t, '/help', { anchored: false });
    await t.type('add a --json flag to export.mjs'); t.key('enter');
    await t.waitFor('Do you want to make this edit'); await t.idle(); await shot(t, 'permission: edit with diff');
    await resizes(t, 'permission prompt');
    t.key('enter');
    await t.waitFor('export.test.mjs?'); await t.idle(); await shot(t, 'permission: second edit');
    t.key('enter');
    await t.waitFor('Do you want to proceed?'); await t.idle(); await shot(t, 'permission: bash command');
    t.key('enter');
    await t.waitFor('tests pass', 20_000); await t.waitGone('esc to interrupt'); await t.idle();
    await shot(t, 'task done (diffs, bash output)', { anchored: true });
    await t.type('!ls'); await t.idle(); await shot(t, 'shell mode (!)', { anchored: false });
    t.key('enter'); await t.waitFor('export.mjs'); await t.idle(); await shot(t, 'shell output', { anchored: true });
    t.key('ctrlL'); await t.idle();
    await t.type('think it over'); t.key('enter');
    await t.waitFor('Thinking…'); await sleep(800); await shot(t, 'live layout: thinking window');
    await t.type('/'); await sleep(400); await shot(t, 'menu open while working', { must: ['esc to interrupt', '/help'] });
    t.key('esc'); await sleep(400);
    await shot(t, 'esc closes the menu (still working)', { must: ['esc to interrupt'], mustNot: ['/help'], note: 'The first esc closes the menu and Bonsai keeps working.' });
    t.key('backspace'); await sleep(200);
    await resizes(t, 'while thinking');
    await t.type('a second question'); t.key('enter'); await sleep(400);
    await shot(t, 'queued message', { must: ['Queued: a second question'] });
    await t.waitFor('Second answer', 60_000); await t.waitGone('esc to interrupt', 30_000); await t.idle();
    await shot(t, 'live layout: after (meters)', { anchored: true });
    t.key('ctrlL'); await t.idle();
    await t.type('keep going'); t.key('enter'); await t.waitFor('esc to interrupt'); await sleep(500);
    t.key('esc'); await t.waitGone('esc to interrupt'); await t.idle();
    await shot(t, 'interrupted', { must: ['Interrupted'] });
    await resizes(t, 'long conversation', { anchored: false });
    t.key('ctrlC'); await sleep(150); t.key('ctrlC'); await t.waitFor('Saved. Continue', 5000).catch(() => {}); await t.idle();
    await shot(t, 'exit', { expectBox: false });
  } catch (e) {
    console.log(`✗ tour stopped: ${e.message.split('\n')[0]}`);
    await shot(t, 'tour stopped here', { note: e.message.split('\n')[0] });
  } finally {
    await t.close(); await fake.close();
  }
}

async function flows() {
  const { cwd, env } = setup('test/fixture-fix');
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(join(cwd, 'stats.mjs'), 'utf8');
  const wrong = '```js\n' + src.replace('  return sorted[mid];', '  return (sorted[mid] + sorted[mid + 1]) / 2;') + '```';
  const right = '```js\n' + src.replace('  return sorted[mid];', '  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;') + '```';
  const fake = await startFakeServer([{ text: wrong }, { text: right }, { text: 'Averages the two middle values for an even count.' }], { delayMs: 6 });
  const t = openTerm({ cwd, cols: COLS, rows: ROWS, env, args: ['--url', fake.url] });
  try {
    await t.waitFor('? for shortcuts'); await t.idle();
    await t.type('The tests fail. Find the bug and fix it.'); t.key('enter');
    await t.waitFor('Do you want to make this edit to stats.mjs?', 30_000); await t.idle();
    await shot(t, 'fix path: plan, tries and the edit prompt');
    t.key('enter'); await t.waitFor('Fixed stats.mjs'); await t.idle();
    await t.type('Rename median to middleValue'); t.key('enter');
    await t.waitFor('files?'); await t.idle(); await shot(t, 'rename prompt');
    await resizes(t, 'rename prompt');
    t.key('enter'); await t.waitFor('Renamed median to middleValue'); await t.idle();
    await shot(t, 'after fix + rename', { anchored: true });
  } catch (e) {
    console.log(`✗ flows stopped: ${e.message.split('\n')[0]}`);
    await shot(t, 'flows stopped here', { note: e.message.split('\n')[0] });
  } finally {
    await t.close(); await fake.close();
  }
}

// The three questions that let you steer: "where do you see it?" before a fix
// that points nowhere, a check-in after 8 looks with no change, and the plan
// before the first edit on auto-accept.
async function steer() {
  const run = async (name, args, replies, body) => {
    const { cwd, env } = setup();
    const fake = await startFakeServer(replies, { delayMs: 6 });
    const t = openTerm({ cwd, cols: COLS, rows: ROWS, env, args: ['--url', fake.url, ...args] });
    try { await t.waitFor('? for shortcuts'); await t.idle(); await body(t); } catch (e) {
      console.log(`✗ ${name} stopped: ${e.message.split('\n')[0]}`);
      await shot(t, `${name} stopped here`, { note: e.message.split('\n')[0] });
    } finally { await t.close(); await fake.close(); }
  };
  await run('ask where', [], [], async (t) => {
    await t.type('the csv header is shown twice when the list is empty, fix it'); t.key('enter');
    await t.waitFor('Where do you see it'); await t.idle();
    await shot(t, 'ask where first', { must: ['Bonsai asks', 'Type an answer', 'Stop here'] });
    await resizes(t, 'ask where first');
    t.key('esc'); await t.idle();
    await shot(t, 'ask where: esc stops', { anchored: false, mustNot: ['Type an answer'] });
  });
  const looks = Array.from({ length: 8 }, (_, i) => ({ tool: { name: 'Read', args: { path: i % 2 ? 'export.test.mjs' : 'export.mjs' } } }));
  await run('check-in', ['--no-flows'], [...looks, { text: 'It reads trades.json and prints CSV.' }], async (t) => {
    await t.type('what does export.mjs do?'); t.key('enter');
    await t.waitFor('Am I on the right track', 30_000); await t.idle();
    await shot(t, 'check-in while exploring', { must: ['Keep going', 'Type an answer', 'Stop here'] });
    await resizes(t, 'check-in');
    t.key('enter'); await t.waitFor('prints CSV'); await t.idle();
    await shot(t, 'after "keep going"', { anchored: true, must: ['prints CSV'] });
  });
  const edit = { tool: { name: 'Edit', args: { path: 'export.mjs', old_text: '  return toCsv(rows);', new_text: "  if (argv.includes('--json')) return JSON.stringify(rows, null, 2);\n  return toCsv(rows);" } } };
  await run('plan', ['--no-flows', '--mode', 'edits'], [{ tool: { name: 'Read', args: { path: 'export.mjs' } } }, edit, { text: 'Added --json.' }, { text: '{"done": true, "missing": ""}' }], async (t) => {
    await t.type('add a --json flag to export.mjs'); t.key('enter');
    await t.waitFor('Before I change anything', 30_000); await t.idle();
    await shot(t, 'plan before the first edit (auto-accept)', { must: ['Before I change anything', 'Say yes', 'Type an answer'] });
    await resizes(t, 'plan question');
    t.key('enter');
    await t.waitFor('Added --json', 60_000); await t.idle();
    await shot(t, 'after the plan: edited and checked', { anchored: true, must: ['Added --json'] });
  });
}

const t0 = Date.now();
if (!only || only.includes('tour')) await tour();
if (!only || only.includes('flows')) await flows();
if (!only || only.includes('steer')) await steer();
const failed = shots.filter((s) => s.checks.some((c) => !c.ok)).length;
console.log(`${shots.length} screens at ${COLS}×${ROWS}, ${shots.length - failed} clean, ${failed} with problems · ${Math.round((Date.now() - t0) / 1000)}s`);
const out = opt('out', join(root, 'scripts', `ui-walk-${COLS}x${ROWS}.json`));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), cols: COLS, rows: ROWS, shots }, null, 1));
process.exit(0);
