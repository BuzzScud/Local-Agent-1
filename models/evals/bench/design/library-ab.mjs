// Does the design library make the models' pages better? (8 Oct 2026, the owner: "can we make the agents
// better at ui design and design in general? can we download the latest ui designs and templates for the
// agentic coder to use?", and their go-ahead "build, measure, show me".) The owner's five card prompts and
// three of the new kinds (a pricing page, a slide deck, a flowchart: bench/design/library.json) run on a
// model on another machine the way `coding -p` runs them, each in an empty folder with a throwaway home,
// once for each arm:
//   before   --before <a checkout of the code before the library> with --cards-before <a copy of the
//            design examples as they were>; without --before, this code with the library off
//   after    this code: the library's pieces and looks, the new cards, the page fixes
// Every page is measured the same way, whatever the arm, with this code's layout check: made or not, its
// problems (a desktop, a phone, dark mode, every button clicked), a picture at 1440×900, and the time.
// The raw runs stay on the Mac (docs/private/design-runs/); library-ab-page.mjs draws the results page.
//   node models/evals/bench/design/library-ab.mjs --service <name in /remote> | --remote <address> --model <name> [--kind openai]
//        [--label gemma4] [--before <checkout> --cards-before <folder>] [--only id,id] [--minutes 15] [--out <folder>] [--no-record]
//   node models/evals/bench/design/library-ab-page.mjs <results folder> [<results folder>…] [--record]   the page from saved runs
// Each run prints a PASS or FAIL line (PASS: a page made with no layout problem). No address is ever
// written into the repo: a service comes from your saved /remote set-ups or the command line.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { layoutCheck, findChrome } from '../../../../terminal/index.mjs';
import { PRIVATE_DIR } from '../../../../docs/tools/to-docs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
export const PROMPTS = JSON.parse(readFileSync(join(here, 'library.json'), 'utf8'));
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

function service() {
  const settingsFile = join(process.env.AGENTIC_HOME ?? join(homedir(), '.agentic-coder'), 'settings.json');
  let real = {};
  try { real = JSON.parse(readFileSync(settingsFile, 'utf8')); } catch {}
  const name = opt('service', null);
  // A /remote set-up by name, an address given, or else the one /remote uses (as the Arena's other service tests).
  const remote = name ? real.remotes?.[name] : opt('remote', null) ? { address: opt('remote', null), port: null, connect: 'http', kind: opt('kind', 'openai'), model: opt('model', null), context: 0 } : real.remote;
  if (!remote?.address || !remote?.model) return { error: name ? `no /remote set-up named ${name}` : 'no model on another machine: set one with /remote, or give --service <name>, or --remote <address> and --model <name>' };
  return { remote: { ...remote, use: true }, real, label: opt('label', name ?? remote.model) };
}

// One run: { code, secs, dir, work }.
function runOne({ code, prompt, dir, remote, real, env: extra, minutes }) {
  const home = join(dir, 'home');
  const work = join(dir, 'work');
  mkdirSync(home, { recursive: true });
  mkdirSync(work, { recursive: true });
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ remote, remotes: { run: remote }, effort: real.effort, limits: real.limits, thinking: real.thinking, memory: false }, null, 1));
  writeFileSync(join(home, 'trust.json'), JSON.stringify({ [realpathSync(work)]: new Date().toISOString() }));
  const env = { ...process.env, AGENTIC_HOME: home, AGENTIC_MEMORY_SAVE: 'off', AGENTIC_TRANSCRIPT: join(dir, 'transcript.json'), AGENTIC_NO_OPEN: '1', AGENTIC_NEWS: 'off', AGENTIC_MCP: 'off', AGENTIC_DESIGN: 'on', AGENTIC_LAYOUT: 'on', AGENTIC_STUDIO: 'on', ...extra };
  for (const k of ['AGENTIC_STUDIO_DIR', ...(extra.AGENTIC_DESIGN_DIR ? [] : ['AGENTIC_DESIGN_DIR'])]) delete env[k];
  const t0 = Date.now();
  return new Promise((done) => {
    const c = spawn('bun', [join(code, 'terminal/src/cli.jsx'), '-p', prompt, '--yes'], { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    const kill = setTimeout(() => { c.kill('SIGTERM'); out += `\n[runner] stopped at ${minutes} min\n`; }, minutes * 60_000);
    const stop = setInterval(() => { if (stopping) c.kill('SIGTERM'); }, 1000);
    c.on('close', (codeOut) => { clearTimeout(kill); clearInterval(stop); writeFileSync(join(dir, 'log.txt'), out); done({ code: codeOut, secs: (Date.now() - t0) / 1000, dir, work }); });
  });
}

// A picture of the page at 1440×900, made smaller for the results page (JPEG, 900 px wide).
export function picture(chrome, page, out) {
  const prof = mkdtempSync(join(tmpdir(), 'agentic-library-shot-'));
  const png = `${out}.png`;
  try {
    spawnSync(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--hide-scrollbars', `--user-data-dir=${prof}`, '--window-size=1440,900', '--virtual-time-budget=2500', `--screenshot=${png}`, `file://${page}`], { timeout: 45_000, stdio: 'ignore' });
  } finally { rmSync(prof, { recursive: true, force: true }); }
  if (!existsSync(png)) return null;
  if (process.platform === 'darwin') spawnSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '62', '-Z', '900', png, '--out', `${out}.jpg`], { stdio: 'ignore', timeout: 20_000 });
  return existsSync(`${out}.jpg`) ? `${out}.jpg` : png;
}

// What the app said about the design (the "· Design …" line) and the page sent back unwritten.
export function notesOf(log) {
  const lines = String(log ?? '').split('\n').map((l) => l.replace(/^·\s*/, '').trim());
  return {
    design: lines.find((l) => /^Design (studio|examples)\b/.test(l)) ?? null,
    pageBack: lines.some((l) => /answered without writing the page/.test(l)),
    searched: lines.some((l) => /answered without looking at the project/.test(l)),
  };
}

async function main() {
  const s = service();
  if (s.error) { console.error(s.error); return 2; }
  const before = opt('before', null);
  const cardsBefore = opt('cards-before', null);
  if (before && !existsSync(join(before, 'terminal/src/cli.jsx'))) { console.error(`--before ${before} is not a checkout of Agentic Coder`); return 2; }
  const only = opt('only', null)?.split(',').map((x) => x.trim());
  const prompts = PROMPTS.filter((p) => !only || only.includes(p.id));
  const minutes = Number(opt('minutes', 15));
  const day = new Date().toLocaleDateString('en-CA');
  const out = opt('out', join(PRIVATE_DIR, 'design-runs', `library-${day}-${s.label.replace(/[^\w.-]+/g, '-')}`));
  mkdirSync(out, { recursive: true });
  const arms = before
    ? [{ id: 'before', code: before, env: { ...(cardsBefore ? { AGENTIC_DESIGN_DIR: cardsBefore } : {}) }, what: 'the code before the library' }, { id: 'after', code: root, env: { AGENTIC_DESIGN_LIBRARY: 'on' }, what: 'this code' }]
    : [{ id: 'before', code: root, env: { AGENTIC_DESIGN_LIBRARY: 'off' }, what: 'this code, library off' }, { id: 'after', code: root, env: { AGENTIC_DESIGN_LIBRARY: 'on' }, what: 'this code, library on' }];
  const chrome = findChrome();
  const resFile = join(out, 'results.json');
  let rows = [];
  try { rows = JSON.parse(readFileSync(resFile, 'utf8')); } catch {}
  writeFileSync(join(out, 'run.json'), JSON.stringify({ label: s.label, model: s.remote.model, kind: s.remote.kind, arms: arms.map((a) => ({ id: a.id, what: a.what })), minutes, started: new Date().toISOString(), prompts: prompts.map((p) => p.id) }, null, 1));
  console.log(`Design library before/after · ${s.label} (${s.remote.model}) · ${prompts.length} requests × ${arms.length} arms · at most ${minutes} min each · ${out.replace(homedir(), '~')}`);
  for (const p of prompts) {
    for (const arm of arms) {
      if (stopping) break;
      if (rows.some((r) => r.id === p.id && r.arm === arm.id)) continue; // a run kept from before: carry on after a stop
      const dir = join(out, p.id, arm.id);
      rmSync(dir, { recursive: true, force: true });
      const r = await runOne({ code: arm.code, prompt: p.prompt, dir, remote: s.remote, real: s.real, env: arm.env, minutes });
      const pages = existsSync(r.work) ? readdirSync(r.work).filter((n) => /\.html?$/i.test(n)) : [];
      const page = pages.find((n) => n.startsWith(p.id)) ?? pages[0] ?? null;
      let check = null;
      let shot = null;
      if (page) {
        const abs = join(r.work, page);
        try { check = await layoutCheck(abs, { chrome }); } catch (e) { check = { error: e.message }; }
        if (chrome) shot = picture(chrome, abs, join(dir, 'desk'));
      }
      let t = {};
      try { t = JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf8')); } catch {}
      const said = notesOf(readFileSync(join(dir, 'log.txt'), 'utf8'));
      const row = { label: s.label, id: p.id, name: p.name, kind: p.kind, arm: arm.id, secs: Math.round(r.secs), exit: r.code, reason: t.reason ?? null, steps: t.steps ?? null, outTokens: t.outTokens ?? null, page, problems: check?.problems ?? null, shot: shot ? shot.slice(out.length + 1) : null, ...said };
      rows = rows.filter((x) => !(x.id === p.id && x.arm === arm.id)).concat(row);
      writeFileSync(resFile, `${JSON.stringify(rows, null, 1)}\n`);
      const ok = page && row.problems && !row.problems.length;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${arm.id} · ${p.id} · ${!page ? 'no page made' : row.problems == null ? 'not measured' : `${row.problems.length} layout problem${row.problems.length === 1 ? '' : 's'}`} · ${row.secs} s`);
    }
  }
  console.log(`done · ${rows.length} runs in ${resFile.replace(homedir(), '~')}`);
  // The results page and the test record's line (a run of several services makes one page with --page later).
  if (!args.includes('--no-record') && !stopping) {
    const { buildLibraryPage } = await import('./library-ab-page.mjs');
    const r = await buildLibraryPage([out], { record: true });
    console.log(`page: ${r.page}`);
  }
  return 0;
}

if (import.meta.main) process.exit(await main());
