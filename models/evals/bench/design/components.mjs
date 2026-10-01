// UI component battle (▶ Run tests → UI component battle, `/test components`):
// do Gemma and Qwen build a small UI component well, and is the design folder
// (docs/private/design examples) working? The user's own component requests
// (components.json), in three parts, on one model a run:
//   1 · Card pick    no model: is each request seen as a page request, and
//                    which cards of the design folder go along with it
//   2 · Folder on    the model builds each component with the cards and the
//                    layout check (what /design turns on)
//   3 · Folder off   the same requests with neither, so every page has a
//                    before and an after
//   4 · Studio on    the same requests with the design studio's pieces in the
//                    example card's place, their styles built into the page,
//                    and the layout check (terminal/src/agent/studio.mjs; added
//                    30 Sep, before the first run); its own blind vote against
//                    the folder-on page. Not part of the folder's rule below
// Run it on Gemma and on Qwen: the results page (one a day, docs/tests/)
// puts the two side by side, with a blind vote on the pictures.
// The rules, written before the first run (30 Sep 2026):
//   a card pick passes when the request is seen as a page request and an
//     example card fits its words (not just the fallback card);
//   a page passes when one was made and the layout check finds nothing in it;
//   the folder is working on a model when every request got a fitting card,
//     every folder-on run carried its cards, and the folder-on pages have no
//     more layout problems in all than the folder-off ones;
//   the battle: a point for a clean folder-on page, a point for your vote.
//   node models/evals/bench/design/components.mjs --model qwen [--think on|off] [--only 1,3] [--minutes 10] [--order on,off,studio]
//   --order on,off: the first three parts only (no studio)
//   --no-record: a look only; no line in the test record
//   --page-only [--date 2026-09-30]: the page again from what is saved, no model
//   --dry: print the card pick and the command it would run, and stop
// From a copy of the repo, AGENTIC_REPO=~/Desktop/agentic-coder sends the raw
// runs to the main folder's models/ and the page to its docs/.
// Stop (the Tests tab's Stop, SIGTERM): the page under way is stopped, the rest
// is not started, and the results page shows what ran.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { MODELS, DEFAULT_MODEL, modelFolder, recordTest, codeLabel } from '../../../index.mjs';
import { designDir, readCards, isDesignRequest, pickCards, designNotes, scoreCard, testLimits, testDefaults, readPieces, pickPieces } from '../../../../terminal/index.mjs';
import { DOCS_DIR } from '../../../../docs/tools/to-docs.mjs';
import { readSet } from './run.mjs';
import { buildBattlePage, modelSummary } from './components-page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..'); // the repo this code runs from
export const RESULTS = (date) => `design-components-${date}`;
export const PAGE = (date) => `tests/agentic-coder-ui-component-battle-${date}.html`;
export const RULE = 'a fitting card for every request, carried on every folder-on run, and no more layout problems with the folder on';

const cardName = (c) => c.file.replace(/\.md$/i, '');

// Part 1, for one request: what the app would send along with it.
export function cardPick(p, { dir = designDir(), cards } = {}) {
  const page = isDesignRequest(p.prompt);
  const pick = pickCards(p.prompt, { dir, cards, sets: 'all', style: 'auto' });
  const notes = designNotes(pick, dir);
  const example = pick.examples[0] ?? null;
  const fits = Boolean(example) && scoreCard(example, p.prompt) > 0;
  return {
    id: p.id, page, rules: pick.always.map(cardName), example: example ? cardName(example) : null, fits,
    look: pick.look && example ? cardName(pick.look) : null, more: pick.more.map(cardName),
    sent: notes ? notes.cards.map(cardName) : [], chars: notes?.chars ?? 0, pass: page && fits && Boolean(notes),
    // What the studio part sends instead of the example card (no rule: a look).
    pieces: pickPieces(p.prompt).pieces.map((x) => x.file.replace(/^components\//, '').replace(/\.html?$/i, '')),
  };
}
export const pickWords = (k) => (!k.page ? 'not seen as a page request, so no cards go along'
  : !k.example ? 'a page request, but the folder has no example card for it'
  : `${[...k.rules, k.example].join(' + ')}${k.look ? `, in the ${basename(k.look).replace(/^look-/, '')} look` : ''}${k.fits ? '' : ' (the fallback card: none fits its words)'} · ${k.chars.toLocaleString('en-US')} characters`);

// models/<model>/results/design-components-<date>/ for every model that has one.
export function battleDirs(home, date) {
  const models = join(home, 'models');
  return readdirSync(models).map((m) => join(models, m, 'results', RESULTS(date))).filter((d) => existsSync(join(d, 'runs.json')));
}

// The page of a day, from every model's saved runs. null: nothing saved.
export function writeBattlePage({ home, docsDir, date, requests }) {
  const dirs = battleDirs(home, date);
  if (!dirs.length || !existsSync(docsDir)) return null;
  const html = buildBattlePage({ dirs, date, requests, rule: RULE });
  if (!html) return null;
  mkdirSync(join(docsDir, 'tests'), { recursive: true });
  writeFileSync(join(docsDir, PAGE(date)), html);
  return PAGE(date);
}

async function main() {
  const home = process.env.AGENTIC_REPO ?? root; // where the results go
  const docsDir = process.env.AGENTIC_DOCS ?? (home === root ? DOCS_DIR : join(home, 'docs'));
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
  const today = new Date().toLocaleDateString('en-CA'); // the local date, 2026-09-30
  const all = readSet(opt('set', 'components'));
  if (args.includes('--page-only')) {
    const page = writeBattlePage({ home, docsDir, date: opt('date', today), requests: all });
    console.log(page ? `results page: ${page}` : 'nothing saved for that date yet');
    return 0;
  }
  const model = MODELS[opt('model', DEFAULT_MODEL)];
  if (!model) { console.error(`no model "${opt('model')}"; one of: ${Object.keys(MODELS).join(', ')}`); return 2; }
  const think = opt('think', 'off') === 'on';
  const only = opt('only', null);
  const requests = only ? only.split(',').map((n) => all[Number(n) - 1] ?? all.find((p) => p.id === n.trim() || String(p.n) === n.trim())).filter(Boolean) : all;
  if (!requests.length) { console.error(`no request ${only}; the requests: ${all.map((p, i) => `${i + 1} ${p.id}`).join(', ')}`); return 2; }
  const order = opt('order', 'on,off,studio').split(',').map((o) => o.trim());
  if (!order.includes('on') || !order.includes('off') || order.some((o) => !['on', 'off', 'studio'].includes(o)) || new Set(order).size !== order.length) { console.error('--order: on and off in either order, and studio if wanted (on,off,studio)'); return 2; }
  const minutes = Number(opt('minutes', 10));
  const look = args.includes('--no-record');
  const out = opt('out', join(home, 'models', basename(modelFolder(model)), 'results', RESULTS(today)));
  // The parts decide; nothing in the environment may.
  for (const k of ['AGENTIC_DESIGN', 'AGENTIC_LAYOUT', 'AGENTIC_DESIGN_SETS', 'AGENTIC_DESIGN_STYLE', 'AGENTIC_STUDIO']) delete process.env[k];

  // Part 1: the card pick.
  const dir = designDir();
  const sets = dir ? readCards(dir).sets : [];
  if (!dir || !sets.length) { console.error('refused: the "design examples" folder is missing or empty (docs/private/design examples; AGENTIC_DESIGN_DIR names another).'); return 6; }
  const studio = order.includes('studio');
  if (studio && !readPieces().pieces.length) { console.error('refused: the "design studio" folder is missing or has no pieces (docs/private/design studio). --order on,off runs without it.'); return 6; }
  console.log(`UI component battle on ${model.name}${think ? ', thinking at High' : ', thinking off'}: ${requests.length} request${requests.length === 1 ? '' : 's'}, ${studio ? 'four' : 'three'} parts`);
  console.log(`Part 1 · Card pick (no model). design examples: ${sets.map((s) => `${s.name} ${s.cards.length}`).join(' · ')}`);
  const picks = requests.map((p) => cardPick(p, { dir }));
  for (const k of picks) console.log(`${k.pass ? 'PASS' : 'FAIL'} card pick · ${k.id} · ${pickWords(k)}${studio ? ` · studio: ${k.pieces.length ? k.pieces.join(' + ') : 'no piece fits (the cards go instead)'}` : ''}`);

  const arms = order.map((o) => ({ on: 'full', off: 'today', studio: 'studio' }[o]));
  const runArgs = [join(here, 'run.mjs'), '--model', model.id, '--set', opt('set', 'components'), '--arms', arms.join(','), '--pages', requests.map((p) => p.id).join(','),
    '--effort', think ? 'high' : 'low', '--minutes', String(minutes), '--out', out];
  if (args.includes('--dry')) { console.log(`parts 2 ${order.length === 2 ? 'and 3' : `to ${order.length + 1}`}: ${[process.execPath, ...runArgs].join(' ')}`); return 0; }

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'pick.json'), JSON.stringify({ at: new Date().toISOString(), code: codeLabel(root), folder: sets.map((s) => ({ set: s.name, cards: s.cards.length })), picks }, null, 1));

  // Parts 2 and 3: one run of run.mjs, the folder on and then off (or as --order says).
  console.log(`Parts 2 to ${order.length + 1} · ${order.map((o) => (o === 'studio' ? 'studio on' : `folder ${o}`)).join(', then ')}: ${requests.length * order.length} pages, at most ${minutes} min each`);
  let stopping = false;
  let child = null;
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log('stopping: the page under way is stopped, and the rest is not started');
    // Control-C in a terminal reaches run.mjs by itself (the same process group); the Tests tab's Stop does not.
    if (sig === 'SIGTERM') child?.kill('SIGTERM');
  });
  const t0 = Date.now();
  let ran = 0; // pages this run got to
  const code = await new Promise((ok) => {
    child = spawn(process.execPath, runArgs, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    createInterface({ input: child.stdout }).on('line', (l) => { if (/^(PASS|FAIL) (folder|studio) /.test(l)) ran++; console.log(l); });
    createInterface({ input: child.stderr }).on('line', (l) => console.error(l));
    child.on('exit', (c) => ok(c));
  });
  child = null;
  const wall = (Date.now() - t0) / 1000;
  // Refused before a page (the other model is loaded, no memory, no Chrome): nothing to show or record.
  if (code !== 0 && !stopping && !ran) { console.log(`parts 2 and 3 did not start (code ${code}): no results page, no line in the test record`); return code ?? 1; }
  if (code !== 0 && !stopping) console.log(`the run ended with code ${code}`);

  let runs = [];
  try { runs = JSON.parse(readFileSync(join(out, 'runs.json'), 'utf8')); } catch { /* no page was run */ }
  const mine = runs.filter((r) => requests.some((p) => p.id === r.page));
  const s = modelSummary({ picks, runs: mine, requests });
  const full = !stopping && code === 0 && s.on.runs === requests.length && s.off.runs === requests.length && (!studio || s.studio.runs === requests.length);
  const page = writeBattlePage({ home, docsDir, date: today, requests: all });
  if (page) console.log(`results page: ${page}`);
  else console.log(`no results page: ${existsSync(docsDir) ? 'no page was run' : `the DOCS folder is not here (${docsDir})`}`);
  const limits = testLimits(model) ?? testDefaults(model);
  const passed = picks.filter((k) => k.pass).length + s.on.clean + s.off.clean + (studio ? s.studio.clean : 0);
  if (look) console.log('a look only: no line in the test record');
  else recordTest({
    kind: 'other', model: model.id, name: `UI component battle${only ? `, requests ${only}` : ''}`, code: codeLabel(root), effort: think ? 'high' : 'low', ctx: limits.context ?? null,
    passed, total: picks.length + mine.length, secs: wall, result: full ? (s.working ? 'pass' : 'fail') : 'stopped', part: Boolean(only),
    note: `card pick ${picks.filter((k) => k.pass).length} of ${picks.length} · folder on: ${s.on.clean} of ${s.on.runs} clean, ${s.on.problems} problems, cards on ${s.on.carried} of ${s.on.runs} · folder off: ${s.off.clean} of ${s.off.runs} clean, ${s.off.problems} problems${studio ? ` · studio on: ${s.studio.clean} of ${s.studio.runs} clean, ${s.studio.problems} problems, pieces on ${s.studio.pieces} of ${s.studio.runs}` : ''}`,
    bar: RULE, raw: relative(home, out), page: page ?? '',
  });
  console.log(`UI component battle on ${model.name}: card pick ${picks.filter((k) => k.pass).length} of ${picks.length}, folder on ${s.on.clean} of ${s.on.runs} clean, folder off ${s.off.clean} of ${s.off.runs} clean${studio ? `, studio on ${s.studio.clean} of ${s.studio.runs} clean` : ''} · ${full ? (s.working ? 'THE FOLDER IS WORKING' : 'THE FOLDER IS NOT WORKING') : 'PART RUN'}`);
  return 0;
}

if (import.meta.main ?? process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await main());
