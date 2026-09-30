// Do the design examples make the model's pages better? (29 Sep 2026: "can we
// teach the models to be better designers by having a folder hold design
// examples?") The same five page requests, the user's own from Agentic Coder's
// history, are run with the real model the way `coding -p` runs them, once per
// arm, each in an empty folder:
//   today   no design cards, no layout check (how it worked before)
//   cards   the cards from every set, no layout check
//   full    the cards and the layout check (what /design turns on)
//   opus    only the Opus 5.5 cards, no layout check
//   fable   only the Fable 5.1 cards, no layout check
// Every page it made is then measured the same way, whatever the arm: the
// layout check's problems (sideways scroll, overlapping or faint text, script
// errors, missing head lines), and two screenshots (1440×900 and a 390-wide
// phone) for looking at by eye. The page of results goes in docs/gemma-docs/test/.
//   node models/evals/bench/design/run.mjs --model gemma [--arms today,full | all] [--pages all | 1,3] [--minutes 8] [--record]
//   node models/evals/bench/design/run.mjs --page-only      rebuilds the page from what is saved
// One big model at a time: it refuses to start while another is loaded.
// --set components (or the path of a JSON file, [{ id, name, prompt }]): those
// requests instead of the five, for the UI component battle (components.mjs,
// which gives --out and makes the page and the record line itself). Such a run
// uses the tests' settings (32k, or the Tests page's panel), not the app's saved
// ones, takes its pictures closer (900×620, a component is small), and keeps
// each run's steps (log.json).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { MODELS, DEFAULT_MODEL, ModelServer, modelFolder, contextCheck, hasDraft, recordTest, codeLabel } from '../../../index.mjs';
import { runHeadless, loadSettings, readLimits, modelWithLimits, testLimits, testDefaults, layoutCheck, findChrome, designDir, readCards } from '../../../../terminal/index.mjs';
import { buildPage, resultsDirs, PAGE_OUT } from './page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..'); // the repo this code runs from
// Where the results go: the main folder when the test runs from a copy of it
// (AGENTIC_REPO=~/Desktop/agentic-coder), so the raw runs land in its models/
// and the page in its docs/, as every other test's do.
const home = process.env.AGENTIC_REPO ?? root;
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const today = new Date().toLocaleDateString('en-CA'); // the local date, 2026-09-29

// The user's own page requests (~/.agentic-coder/history.jsonl, 26–28 Sep),
// with "download it to my desktop" swapped for a file name in the folder.
// Kept in pages.json, so the memory can tell them apart from real work (models/evals/prompts.mjs).
export const PAGES = JSON.parse(readFileSync(join(here, 'pages.json'), 'utf8'));
export const ARMS = {
  today: { label: 'Today (no cards)', design: { auto: false, check: false } },
  cards: { label: 'Cards, all sets', design: { auto: true, check: false, sets: 'all' } },
  full: { label: 'Cards + layout check', design: { auto: true, check: true, sets: 'all' } },
  opus: { label: 'Opus cards only', design: { auto: true, check: false, sets: ['opus'] } },
  fable: { label: 'Fable cards only', design: { auto: true, check: false, sets: ['fable'] } },
};

// A named set of requests, or a file of them: [{ id, name, prompt, file? }].
export const SETS = { components: join(here, 'components.json') };
export function readSet(name) {
  const list = JSON.parse(readFileSync(SETS[name] ?? name, 'utf8'));
  return list.map((p) => ({ file: `${p.id}.html`, ...p }));
}

const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

// One screenshot, as a small JPEG (sips on a Mac; the PNG elsewhere): half
// the window's size, or `scale` of it.
function shoot(chrome, page, out, w, h, scale = 0.5) {
  const png = out.replace(/\.jpg$/, '.png');
  const prof = mkdtempSync(join(tmpdir(), 'agentic-shot-'));
  const r = spawnSync(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--hide-scrollbars', `--user-data-dir=${prof}`, `--window-size=${w},${h}`, '--virtual-time-budget=3000', `--screenshot=${png}`, `file://${page}`], { timeout: 30_000, stdio: 'ignore' });
  if (r.status !== 0 || !existsSync(png)) return null;
  const s = spawnSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '62', '-Z', String(Math.round(Math.max(w, h) * scale)), png, '--out', out], { stdio: 'ignore' });
  return s.status === 0 && existsSync(out) ? basename(out) : basename(png);
}

// The page it made: the file the request names, else the newest .html in the folder.
function pageMade(dir, want) {
  if (existsSync(join(dir, want))) return join(dir, want);
  const html = readdirSync(dir).filter((f) => /\.html?$/i.test(f)).map((f) => join(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return html[0] ?? null;
}

async function main() {
  if (args.includes('--page-only')) {
    const out = buildPage({ dirs: resultsDirs(home, opt('date', today)), out: opt('out', PAGE_OUT(home, opt('date', today))) });
    console.log(out ? `page: ${relative(home, out)}` : 'nothing saved for that date yet');
    return 0;
  }
  const base0 = MODELS[opt('model', DEFAULT_MODEL)];
  if (!base0) { console.error(`no model "${opt('model')}"; one of: ${Object.keys(MODELS).join(', ')}`); return 2; }
  const armIds = (opt('arms', 'today,full') === 'all' ? Object.keys(ARMS) : opt('arms', 'today,full').split(',')).map((a) => a.trim()).filter(Boolean);
  const bad = armIds.filter((a) => !ARMS[a]);
  if (bad.length) { console.error(`no arm ${bad.join(', ')}; the arms: ${Object.keys(ARMS).join(', ')}`); return 2; }
  const set = opt('set', null);
  let from = PAGES;
  if (set) { try { from = readSet(set); } catch (e) { console.error(`no set "${set}" (${e.message})`); return 2; } }
  const pages = opt('pages', 'all') === 'all' ? from : opt('pages').split(',').map((n) => from[Number(n) - 1] ?? from.find((p) => p.id === n)).filter(Boolean);
  if (!pages.length) { console.error(`no page ${opt('pages')}; the pages: ${from.map((p) => p.id).join(', ')}`); return 2; }
  const chrome = findChrome();
  if (!chrome) { console.error('refused: no headless Chrome on this Mac to measure the pages (Chrome, or Playwright\'s own).'); return 5; }
  const dir = designDir();
  const sets = readCards(dir).sets;
  if (!dir || !sets.length) { console.error('refused: the "design examples" folder is missing or empty (docs/private/design examples).'); return 6; }
  // The arms decide; nothing in the environment may.
  for (const k of ['AGENTIC_DESIGN', 'AGENTIC_LAYOUT', 'AGENTIC_DESIGN_SETS']) delete process.env[k];

  const settings = loadSettings(root);
  const limits = set ? testLimits(base0) ?? testDefaults(base0) : readLimits(settings, base0);
  const model = modelWithLimits(base0, limits);
  const ctx = Number(opt('ctx', limits.context || 32768));
  const thinking = opt('effort', settings.effort ?? 'low') !== 'low';
  const effort = thinking ? 'high' : undefined;
  const minutes = Number(opt('minutes', 8));
  const total = armIds.length * pages.length;

  const running = spawnSync('ps', ['-axwwo', 'command'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /^\/\S*llama-server\s/.test(l));
  const big = Object.values(MODELS).filter((m) => running.some((l) => l.includes(`/${m.file} `)));
  if (big.length) { console.error(`refused: ${big.map((m) => m.name).join(', ')} is loaded (one big model at a time). Quit Agentic Coder, run coding stop, then try again.`); return 3; }
  console.log(`${model.name} · ${thinking ? 'High' : 'Low'} effort · ${armIds.length} arm${armIds.length === 1 ? '' : 's'} (${armIds.join(', ')}) × ${pages.length} pages = ${total} runs · at most ${minutes} min each`);
  console.log(`design examples: ${sets.map((s) => `${s.name} ${s.cards.length}`).join(' · ')}`);
  if (!contextCheck(model, ctx, { draft: hasDraft(model) }).fits) console.log('waiting for memory to free up (up to 2 minutes)…');
  for (let i = 0; i < 24 && !contextCheck(model, ctx, { draft: hasDraft(model) }).fits; i++) await new Promise((r) => setTimeout(r, 5000));
  const fit = contextCheck(model, ctx, { draft: hasDraft(model) });
  if (!fit.fits) { console.error(`refused: ${fit.note}`); return 4; }

  const outDir = opt('out', join(home, 'models', basename(modelFolder(model)), 'results', `design-${set ? 'components' : 'bench'}-${today}`));
  mkdirSync(outDir, { recursive: true });
  const runsFile = join(outDir, 'runs.json');
  const saved = existsSync(runsFile) ? JSON.parse(readFileSync(runsFile, 'utf8')) : [];

  try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  console.log('loading the model…');
  const l0 = Date.now();
  const srv = new ModelServer(model);
  const stopAll = async () => { try { await srv.stop(); } catch {} };
  let stopping = false;
  let current = null;
  // Control-C, or the Tests tab's Stop (SIGTERM).
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => {
    if (!stopping) { stopping = true; console.log('\nstopping after this page (Control-C again quits at once)…'); current?.abort(); return; }
    await stopAll(); process.exit(130);
  });
  process.on('unhandledRejection', () => {});
  const st = await srv.start({ ctx, share: false, lingerSecs: 0 });
  const slots = st.slots > 1 ? { main: 0, side: 1 } : undefined;
  console.log(`loaded in ${Math.round((Date.now() - l0) / 1000)} s`);

  const t0 = Date.now();
  let n = 0;
  for (const arm of armIds) {
    for (const pg of pages) {
      if (stopping) break;
      n++;
      const cwd = mkdtempSync(join(tmpdir(), `agentic-design-${arm}-${pg.id}-`));
      const notes = [];
      let tools = 0;
      const ac = new AbortController();
      current = ac;
      const timer = setTimeout(() => ac.abort(), minutes * 60_000);
      const r0 = Date.now();
      let r = null;
      let error = null;
      process.stdout.write(`[${n}/${total}] ${arm} · ${pg.id} … `);
      try {
        r = await runHeadless({
          prompt: pg.prompt, cwd, url: srv.url, model, ctx, thinking, effort, flows: true, slots, warm: Boolean(slots), limits, autoApprove: true,
          memory: false, signal: ac.signal, design: ARMS[arm].design,
          onEvent: (type, ev) => { if (type === 'note') notes.push(ev.text); if (type === 'tool') tools++; },
        });
      } catch (e) { error = e.message; }
      clearTimeout(timer);
      const secs = (Date.now() - r0) / 1000;
      const made = pageMade(cwd, pg.file);
      const keep = join(outDir, arm, pg.id);
      mkdirSync(keep, { recursive: true });
      let measured = null;
      const shots = {};
      if (made) {
        copyFileSync(made, join(keep, basename(made)));
        measured = await layoutCheck(made, { chrome });
        shots.desktop = set ? shoot(chrome, made, join(keep, 'desktop.jpg'), 900, 620, 1) : shoot(chrome, made, join(keep, 'desktop.jpg'), 1440, 900);
        shots.phone = shoot(chrome, made, join(keep, 'phone.jpg'), 390, 844, set ? 0.75 : 0.5);
      }
      if (set && r?.log) writeFileSync(join(keep, 'log.json'), JSON.stringify(r.log, null, 1));
      const row = {
        at: new Date().toISOString(), code: codeLabel(root), model: model.id, name: model.name, effort: effort ?? 'low', arm, page: pg.id, ...(pg.name ? { title: pg.name } : {}), secs, error,
        reason: ac.signal.aborted && !stopping ? 'time' : r?.reason ?? (error ? 'error' : 'stopped'), tools, outTokens: r?.outTokens ?? null, thinkTokens: r?.thinkTokens ?? null,
        file: made ? relative(home, join(keep, basename(made))) : null, bytes: made ? statSync(made).size : 0,
        problems: measured?.problems ?? null, skipped: measured?.skipped ?? null, shots,
        cards: notes.find((t) => t.startsWith('Design examples:')) ?? null, layoutNotes: notes.filter((t) => t.startsWith('Layout check')),
        finalText: String(r?.finalText ?? '').slice(0, 400),
      };
      writeFileSync(join(keep, 'run.json'), JSON.stringify(row, null, 1));
      const i = saved.findIndex((x) => x.arm === arm && x.page === pg.id);
      if (i >= 0) saved[i] = row; else saved.push(row);
      writeFileSync(runsFile, JSON.stringify(saved, null, 1));
      console.log(`${mmss(secs * 1000)} · ${made ? `${basename(made)} · ${row.problems == null ? `not measured (${row.skipped})` : `${row.problems.length} layout problem${row.problems.length === 1 ? '' : 's'}`}` : 'no page made'}${row.reason === 'time' ? ' · stopped at the time limit' : ''}`);
      // The line the Tests tab counts: a page with nothing for the layout check to find passes.
      if (set && !(stopping && row.reason !== 'time' && !made)) console.log(`${row.problems && !row.problems.length ? 'PASS' : 'FAIL'} ${arm === 'today' ? 'folder off' : 'folder on'} · ${pg.id} · ${!made ? 'no page made' : row.problems == null ? 'not measured' : `${row.problems.length} layout problem${row.problems.length === 1 ? '' : 's'}`} · ${mmss(secs * 1000)}`);
    }
  }
  current = null;
  await stopAll();
  const wall = (Date.now() - t0) / 1000;
  console.log(`${stopping ? 'stopped' : 'done'} after ${mmss(wall * 1000)} · saved ${relative(home, runsFile)}`);
  if (set) return 0; // the caller's page and record line
  const page = buildPage({ dirs: resultsDirs(home, today), out: PAGE_OUT(home, today) });
  if (page) console.log(`page: ${relative(home, page)}`);
  if (args.includes('--record')) {
    const mine = saved.filter((x) => armIds.includes(x.arm) && pages.some((p) => p.id === x.page));
    const clean = mine.filter((x) => x.problems && x.problems.length === 0).length;
    recordTest({ kind: 'other', name: `Design examples: before/after pages (${armIds.join(', ')})`, code: codeLabel(root), model: model.id, effort: effort ?? 'low', ctx, secs: wall,
      passed: clean, total: mine.length, result: stopping ? 'stopped' : undefined,
      note: armIds.map((a) => { const rs = mine.filter((x) => x.arm === a && x.problems); return `${a}: ${rs.filter((x) => !x.problems.length).length}/${rs.length} clean, ${(rs.reduce((s, x) => s + x.problems.length, 0) / (rs.length || 1)).toFixed(1)} problems a page`; }).join('; '),
      raw: relative(home, outDir), page: page ? relative(home, page) : '' });
  }
  return 0;
}

if (import.meta.main ?? process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await main());
