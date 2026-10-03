// Check first, for a bug the test suite cannot see on a page (a layout bug:
// something covered, behind, underneath). Before any fix, Agentic Coder opens the
// page in the browser the project already has (Playwright), does what the
// request describes, finds what covers what and why, and writes a small
// check that fails today. The fix is then tried against that check, and the
// check stays in the project so the bug cannot come back (bug-fixing.md,
// steps 1, 7 and 9).
//   the page          named in the request, or the model's pick of the project's pages
//   how to open it    a "page" entry in .agentic/settings.json, the way the
//                     project's own page checks do it (their comments), a
//                     script in package.json, or the folder as plain files
//   what to do        the model picks steps from what is on the page
//   what covers what  found in the browser; the model says which one the request means
//   why               the layers of the two, and the lines that set them
// Words alone found this kind of bug 0 times in 14; with a failing check 1 in 2.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { complete } from './llm.mjs';
import { filesInText, pickFile, isTestFile, taskWords } from './localize.mjs';
import { probeScript, checkScript, MARKS } from './pagescripts.mjs';

const PAGE = /\.html?$/;
const STYLED = /\.(html?|css|scss|less|vue|svelte|m?[jt]sx?|cjs)$/;
const SIZE = { width: 1440, height: 900 };
const ENGINES = ['webkit', 'chromium'];
const FOLDER = '.agentic-check'; // in the scratch copy only

// A kind whose main tool is a browser check (terminal/rules/bug-fixing.md).
export const canPageCheck = (kind) => /browser/i.test(kind?.tool ?? '');

// The nearest folder, from the page up, whose node_modules holds Playwright.
export function findBrowser(cwd, pageRel) {
  for (let d = dirname(pageRel); ; d = dirname(d)) {
    if (existsSync(join(cwd, d, 'node_modules', 'playwright', 'package.json'))) return d;
    if (d === '.' || d === '/') return null;
  }
}

const read = (p, max = 8000) => { try { return readFileSync(p, 'utf8').slice(0, max); } catch { return ''; } };
const PORT_ENV = /(?:environ(?:\.get)?\s*[[(]\s*|getenv\(\s*|process\.env\.|process\.env\[\s*)["']?([A-Z][A-Z0-9_]*PORT[A-Z0-9_]*)/;
const RUNNER = /^((?:[A-Z][A-Z0-9_]*=\S+\s+)*)((?:python3?|node|bun|deno|npx|npm|pnpm|yarn|php|ruby|uvicorn|flask|go)\s+[^#]+?)\s*(?:#\s*(.*))?$/;

// The project's own page checks under the page's folder (they use a browser).
export function pageChecks(cwd, pageRel, files) {
  const top = dirname(pageRel) === '.' ? '' : `${dirname(pageRel)}/`;
  return files.filter((f) => f.startsWith(top) && /\.(m?[jt]s|cjs|py)$/.test(f) && isTestFile(f)).slice(0, 60)
    .filter((f) => /playwright|puppeteer/.test(read(join(cwd, f))));
}

// A server the project's own page checks say to start, from their comments:
//   // DEV_PORT=8878 python3 tools/devserver.py      # in desks/chart, leave it running
export function serveFromChecks(cwd, checks) {
  const seen = new Map(); // command → { n, dirs, envs }
  for (const rel of checks) {
    for (const raw of read(join(cwd, rel), 3000).split('\n')) {
      const c = /^\s*(?:\/\/|#|\*)\s*(.*)$/.exec(raw)?.[1]?.trim();
      const m = c ? RUNNER.exec(c) : null;
      if (!m) continue;
      const cmd = m[2].trim().replace(/\s+/g, ' ');
      const script = cmd.split(' ').slice(1).find((w) => /[/.]/.test(w) && !w.startsWith('-'));
      // The line that runs a check is not the line that starts the page.
      if (!script || isTestFile(script) || cmd.includes(basename(rel)) || /\btest\b/.test(cmd)) continue;
      const said = /\bin\s+([\w./-]+)/.exec(m[3] ?? '')?.[1]?.replace(/[.,;:]+$/, '');
      let dir = said && existsSync(join(cwd, said, script)) ? said : null;
      for (let d = dirname(rel); !dir; d = dirname(d)) {
        if (existsSync(join(cwd, d, script))) dir = d;
        if (d === '.' || d === '/') break;
      }
      if (!dir) continue;
      const e = seen.get(cmd) ?? { n: 0, dir, script, envs: [] };
      e.n++;
      e.envs.push(...m[1].trim().split(/\s+/).filter(Boolean));
      seen.set(cmd, e);
    }
  }
  const best = [...seen].sort((a, b) => b[1].n - a[1].n)[0];
  if (!best) return null;
  const [cmd, e] = best;
  const text = read(join(cwd, e.dir, e.script), 20000);
  const portEnv = e.envs.map((a) => a.split('=')[0]).find((n) => /PORT/.test(n)) ?? PORT_ENV.exec(text)?.[1] ?? null;
  const port = Number(/\bport\b[^\n]{0,60}?\b(\d{4,5})\b/i.exec(text)?.[1] ?? 0) || null;
  if (!portEnv && !port) return null;
  return { serve: { cmd, dir: e.dir, ...(portEnv ? { portEnv } : { port }) }, url: '/', how: `${cmd}, as the project's own page checks do` };
}

// A dev script in the package.json the page belongs to.
export function serveFromPackage(cwd, pageRel) {
  for (let d = dirname(pageRel); ; d = dirname(d)) {
    const p = join(cwd, d, 'package.json');
    if (existsSync(p)) {
      let scripts = {};
      try { scripts = JSON.parse(readFileSync(p, 'utf8')).scripts ?? {}; } catch {}
      const name = ['dev', 'start', 'serve', 'preview'].find((n) => typeof scripts[n] === 'string');
      const inside = relative(d === '.' ? '' : d, pageRel);
      // Only the package's own front page: a script serves a site, not any file in it.
      if (name && /^(?:public\/)?index\.html?$/.test(inside)) {
        const s = scripts[name];
        if (/\bvite\b/.test(s)) return { serve: { cmd: 'npx vite --port {port} --strictPort', dir: d }, url: '/', how: 'vite, from package.json' };
        if (/\bnext\b/.test(s)) return { serve: { cmd: 'npx next dev -p {port}', dir: d }, url: '/', how: 'next dev, from package.json' };
        return { serve: { cmd: `npm run ${name}`, dir: d, portEnv: 'PORT' }, url: '/', how: `npm run ${name}, from package.json` };
      }
    }
    if (d === '.' || d === '/') return null;
  }
}

// Every way to open the page, the likeliest first. The last always exists:
// the page's folder served as plain files.
export function waysToOpen(cwd, pageRel, files) {
  const ways = [];
  try {
    const where = '.agentic';
    const s = JSON.parse(readFileSync(join(cwd, where, 'settings.json'), 'utf8')).page;
    if (s?.serve) ways.push({ serve: { cmd: String(s.serve), dir: String(s.in ?? '.'), ...(typeof s.port === 'number' ? { port: s.port } : { portEnv: String(s.port ?? 'PORT') }) }, url: String(s.url ?? '/'), how: `${s.serve}, from ${where}/settings.json` });
  } catch {}
  const fromChecks = serveFromChecks(cwd, pageChecks(cwd, pageRel, files));
  if (fromChecks) ways.push(fromChecks);
  const fromPackage = serveFromPackage(cwd, pageRel);
  if (fromPackage) ways.push(fromPackage);
  ways.push({ files: dirname(pageRel), url: `/${basename(pageRel)}`, how: 'its folder as plain files' });
  return ways;
}

async function probe(ctx, scratch, job) {
  scratch.write(`${FOLDER}/probe.mjs`, probeScript());
  scratch.write(`${FOLDER}/job.json`, JSON.stringify({ ...job, root: scratch.dir, engines: ENGINES, size: SIZE }));
  const r = await scratch.run(`node ${FOLDER}/probe.mjs ${FOLDER}/job.json`, { signal: ctx.signal, timeoutMs: 150_000 });
  const a = r.out.indexOf(MARKS[0]);
  const b = r.out.lastIndexOf(MARKS[1]);
  if (a < 0 || b < a) return { ok: false, ms: r.ms, error: r.timedOut ? 'the browser did not finish in time' : (r.out.trim().split('\n').slice(-2).join(' ') || 'the browser gave no answer').slice(0, 300) };
  try { return { ...JSON.parse(r.out.slice(a + MARKS[0].length, b)), ms: r.ms }; } catch { return { ok: false, ms: r.ms, error: 'the browser gave an answer that could not be read' }; }
}

const stepText = (s) => (s.do === 'press' ? `press ${s.text}` : s.do === 'type' ? `type "${s.text}" in ${s.on}` : `${s.do} ${s.on}`);
export const stepsText = (steps) => (steps.length ? steps.map(stepText).join(', then ') : 'opening the page');

// Words a user puts in quotes, and words that look like a name on screen.
const quotedIn = (task) => [...task.matchAll(/["“']([^"”'\n]{2,40})["”']/g)].map((m) => m[1].trim().toLowerCase());

// What on the page the request's words point at, first.
function rankOutline(outline, words, max = 60) {
  const seen = new Set();
  return outline.filter((o) => (seen.has(o.sel) ? false : seen.add(o.sel)))
    .map((o, i) => ({ ...o, i, n: words.filter((w) => `${o.sel} ${o.label}`.toLowerCase().includes(w)).length }))
    .sort((a, b) => b.n - a.n || a.i - b.i).slice(0, max);
}

async function pickSteps(ctx, { task, pageRel, outline }) {
  if (!outline.length) return [];
  const list = outline.map((o, i) => `${i + 1}. ${o.sel}   (${o.kind}${o.label ? `: ${o.label}` : ''})`).join('\n');
  const r = await complete({ instructions: ctx.instructions, url: ctx.url, model: ctx.model, slot: ctx.slot, signal: ctx.signal, temperature: 0, maxTokens: 300,
    system: 'You turn a bug report about a web page into the steps that make the bug show.',
    user: `The report:\n${task}\n\nThe page ${pageRel} is open in a browser. What can be clicked or typed in on it:\n${list}\n\nWhich steps make the problem show, the way the report describes it? Use only what the report says: click, type (with the text to type), hover, or press (with the key, such as Enter). If the problem shows as soon as the page opens, give no steps.`,
    schema: { type: 'object', properties: { steps: { type: 'array', maxItems: 6, items: { type: 'object', properties: { do: { type: 'string', enum: ['click', 'type', 'hover', 'press'] }, on: { type: 'string', enum: outline.map((o) => o.sel) }, text: { type: 'string' } }, required: ['do', 'on'] } } }, required: ['steps'] } });
  return (r.json?.steps ?? []).filter((s) => s && (s.do !== 'type' || s.text) && (s.do !== 'press' || s.text)).map((s) => ({ do: s.do, on: s.on, ...(s.text ? { text: String(s.text).slice(0, 80) } : {}) })).slice(0, 6);
}

// The covering things found are grouped by the layer they sit in: a legend's
// rows and numbers are one legend.
export function groupPairs(pairs, words = []) {
  const groups = new Map();
  for (const p of pairs) {
    const by = p.layers?.c?.sel ?? p.by;
    const key = `${p.covered} < ${by}`;
    const g = groups.get(key) ?? { covered: p.covered, coveredText: p.coveredText, fresh: p.fresh, coveredBefore: p.coveredBefore, by, byText: '', byBefore: false, points: 0, x: p.x, y: p.y, layers: p.layers };
    if (p.by === by || p.byText.length > g.byText.length) g.byText = p.byText;
    g.byBefore ||= p.byBefore;
    g.points += p.points;
    groups.set(key, g);
  }
  const hits = (g) => words.filter((w) => `${g.covered} ${g.coveredText} ${g.by} ${g.byText}`.toLowerCase().includes(w)).length;
  return [...groups.values()].map((g) => ({ ...g, n: hits(g) })).sort((a, b) => b.n - a.n || Number(b.fresh) - Number(a.fresh) || b.points - a.points).slice(0, 12);
}

async function pickPair(ctx, { task, steps, pairs }) {
  if (!pairs.length) return null;
  const list = pairs.map((p, i) => `${i + 1}. ${p.covered}${p.coveredText ? ` ("${p.coveredText}")` : ''} is covered by ${p.by}${p.byText ? ` ("${p.byText}")` : ''}`).join('\n');
  const r = await complete({ instructions: ctx.instructions, url: ctx.url, model: ctx.model, slot: ctx.slot, signal: ctx.signal, temperature: 0, maxTokens: 40,
    system: 'You match a bug report about a web page to what a browser found on the page.',
    user: `The report:\n${task}\n\nAfter ${stepsText(steps)}, the browser finds these things covered by something else:\n${list}\n\nWhich one is the problem the report describes? Answer none if none of them is.`,
    schema: { type: 'object', properties: { pair: { type: 'string', enum: [...pairs.map((_, i) => String(i + 1)), 'none'] } }, required: ['pair'] } });
  return pairs[Number(r.json?.pair) - 1] ?? null;
}

// Why one covers the other, in plain words, from the layers the browser read.
export function layersText(pair) {
  const L = pair.layers;
  if (!L) return '';
  const name = (w, fallback) => w?.sel ?? fallback;
  const a = name(L.a, pair.covered);
  const c = name(L.c, pair.by);
  const lev = (w, n) => (w ? `${w.z === 'auto' ? 'no z-index (layer 0)' : `z-index ${w.z}`}, position ${w.position}` : n < 0 ? 'not positioned, so under everything that is' : 'layer 0');
  const lines = [];
  const inA = L.a && L.a.sel !== pair.covered ? `${pair.covered} sits inside ${a}` : `${pair.covered} is its own layer`;
  const inC = L.c && L.c.sel !== pair.by ? `${pair.by} sits inside ${c}` : `${pair.by} is its own layer`;
  lines.push(`Why: ${inA}, and ${inC}. The browser compares ${a} with ${c} (both inside ${L.shared}), not the things inside them:`);
  lines.push(`  ${a}: ${lev(L.a, L.levelA)}`);
  lines.push(`  ${c}: ${lev(L.c, L.levelC)}${L.cLater ? ', and later in the page' : ''}`);
  if (L.levelC > L.levelA) lines.push(`  ${c} is on the higher layer, so it is drawn on top.`);
  else if (L.levelC === L.levelA) lines.push(L.cLater ? `  Same layer: the one later in the page is drawn on top, and that is ${c}.` : `  Same layer, and ${a} is later in the page: the layers alone do not explain it.`);
  else lines.push('  The layers alone do not explain it; look at how the two are placed.');
  if (L.a && L.own && L.own.sel !== L.a.sel && L.own.z !== 'auto') lines.push(`  The z-index ${L.own.z} of ${pair.covered} only counts inside ${a}.`);
  const n = Math.max(L.levelA, L.levelC);
  lines.push(`To put ${pair.covered} on top, change one value: raise the z-index of ${a} above ${n}, or lower the z-index of ${c} below ${Math.min(L.levelA, L.levelC)}.`);
  return lines.join('\n');
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The lines that set the z-index of the two layers, in the project's files:
// a stylesheet rule (its selector, then z-index before the closing brace),
// or a line near the element's name when a script or a style attribute sets it.
export function findSpots(cwd, files, pageRel, pair) {
  const L = pair.layers;
  if (!L) return [];
  const near = dirname(pageRel) === '.' ? '' : `${dirname(pageRel)}/`;
  const pool = files.filter((f) => STYLED.test(f) && !isTestFile(f) && !/(^|\/)(node_modules|vendor|dist|build|archive)\//.test(f));
  const ordered = [...pool.filter((f) => f === pageRel), ...pool.filter((f) => f !== pageRel && f.startsWith(near)), ...pool.filter((f) => !f.startsWith(near))].slice(0, 1500);
  const texts = new Map();
  const lines = (rel) => { if (!texts.has(rel)) { let t = []; try { t = readFileSync(join(cwd, rel), 'utf8').split('\n'); } catch {} texts.set(rel, t); } return texts.get(rel); };
  const spots = [];
  const add = (who, rel, i, what) => { if (!spots.some((s) => s.rel === rel && s.line === i + 1)) spots.push({ for: who.sel, rel, line: i + 1, text: lines(rel)[i].trim().slice(0, 160), what }); };
  // Only the two layers the browser compares: what sits inside them does not decide it.
  for (const who of [L.a, L.c].filter(Boolean)) {
    const before = spots.length;
    for (const rule of who.rules ?? []) {
      if (spots.length - before >= 4) break;
      if (rule.selector) {
        const last = rule.selector.trim().split(/\s+/).pop();
        const re = new RegExp(`(^|[\\s,>+~}])${escapeRe(last)}\\s*([,{]|$)`);
        const sheet = rule.sheet ? rule.sheet.replace(/^\/+/, '') : '';
        const where = sheet ? [...ordered.filter((f) => sheet.endsWith(f) || f.endsWith(sheet) || basename(f) === basename(sheet)), ...ordered.filter((f) => PAGE.test(f))] : ordered;
        search: for (const rel of [...new Set(where)]) {
          const t = lines(rel);
          for (let i = 0; i < t.length; i++) {
            if (t[i].length > 1500 || !re.test(t[i])) continue;
            for (let k = i; k < Math.min(t.length, i + 40); k++) {
              if (new RegExp(`z-index\\s*:\\s*${escapeRe(rule.value)}\\b`).test(t[k])) { add(who, rel, k, `${rule.selector} { z-index: ${rule.value} }`); break search; }
              if (k > i && /}/.test(t[k])) break;
            }
          }
        }
      } else if (rule.inline) {
        const names = [who.id, ...who.classes].filter(Boolean);
        search: for (const rel of ordered.filter((f) => f.startsWith(near))) {
          const t = lines(rel);
          for (let i = 0; i < t.length; i++) {
            if (t[i].length > 1500 || !new RegExp(`z-?index\\W{1,4}${escapeRe(rule.value)}\\b`, 'i').test(t[i])) continue;
            const around = t.slice(Math.max(0, i - 3), i + 4).join('\n');
            if (names.some((n) => new RegExp(`(^|[^\\w-])${escapeRe(n)}($|[^\\w-])`).test(around))) { add(who, rel, i, `z-index ${rule.value} set on ${who.sel} itself (a style attribute or a script)`); break search; }
          }
        }
      }
    }
  }
  return spots;
}

// The lines around each spot, in the form the tries read (as excerpts.mjs).
export function spotsText(cwd, spots, around = 6) {
  const byFile = new Map();
  for (const s of spots) byFile.set(s.rel, [...(byFile.get(s.rel) ?? []), s.line - 1]);
  const parts = [];
  for (const [rel, at] of byFile) {
    let t;
    try { t = readFileSync(join(cwd, rel), 'utf8').replace(/\n$/, '').split('\n'); } catch { continue; }
    const keep = new Set();
    for (const i of at) for (let k = Math.max(0, i - around); k <= Math.min(t.length - 1, i + around); k++) if (t[k].length <= 1500) keep.add(k);
    const nums = [...keep].sort((x, y) => x - y);
    let run = [nums[0]];
    const flush = () => parts.push(`${rel} (lines ${run[0] + 1}-${run.at(-1) + 1}):\n\`\`\`\n${run.map((i) => t[i]).join('\n')}\n\`\`\``);
    for (const i of nums.slice(1)) { if (i === run.at(-1) + 1) run.push(i); else { flush(); run = [i]; } }
    if (nums.length) flush();
  }
  return parts.join('\n\n');
}

const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'page';

// Where the check goes: with the project's own page checks, or in a checks
// folder beside the page.
export function checkPath(cwd, pageRel, checks, covered) {
  const dirs = new Map();
  for (const c of checks) dirs.set(dirname(c), (dirs.get(dirname(c)) ?? 0) + 1);
  const dir = [...dirs].sort((a, b) => b[1] - a[1])[0]?.[0] ?? join(dirname(pageRel), 'checks');
  const name = `${slug(covered)}-on-top`;
  for (let i = 1; ; i++) {
    const rel = join(dir, `${name}${i > 1 ? `-${i}` : ''}.mjs`);
    if (!existsSync(join(cwd, rel))) return rel;
  }
}

// Makes the check. Returns { ok: true, cmd, rel, text, report, spots, files,
// words } or { ok: false, why }. Nothing in your project is touched: the
// browser works on the scratch copy.
export async function pageCheckFirst(ctx, task, { scratch, files, plan }) {
  const { cwd } = ctx;
  const pages = files.filter((f) => PAGE.test(f) && !isTestFile(f));
  if (!pages.length) return { ok: false, why: 'the project has no page to open in a browser' };
  plan?.step(0);
  const named = filesInText(cwd, task).find((f) => PAGE.test(f));
  const pageRel = named ?? await pickFile({ instructions: ctx.instructions, url: ctx.url, model: ctx.model, slot: ctx.slot, cwd, task, files: pages, exts: PAGE, signal: ctx.signal , embedder: ctx.embedder });
  if (!pageRel) return { ok: false, why: 'could not tell which page the request is about' };
  const browser = findBrowser(cwd, pageRel);
  if (browser === null) return { ok: false, why: `there is no browser to check ${pageRel} with (Playwright is not installed in this project)` };

  // Open it: the first way that shows a page with something on it.
  let open = null;
  let first = null;
  const failed = [];
  for (const way of waysToOpen(cwd, pageRel, files)) {
    if (ctx.signal?.aborted) return { ok: false, why: 'stopped' };
    const { how, ...spec } = way;
    const r = await probe(ctx, scratch, { mode: 'outline', browser, ...spec });
    const ok = r.ok && r.shown >= 3;
    ctx.tool('Browser', `open ${pageRel} (${how})`, { kind: 'bash', code: ok ? 0 : 1, lines: [ok ? `${r.shown} things on the page, ${r.outline.length} to click or type in${r.errors?.length ? `; the page logged ${r.errors.length} error${r.errors.length === 1 ? '' : 's'}` : ''}` : r.error ?? 'the page came up empty'], ms: r.ms }, !ok);
    if (ok) { open = { how, spec }; first = r; break; }
    failed.push(`${how}: ${r.error ?? 'the page came up empty'}`);
  }
  if (!open) return { ok: false, why: `could not open ${pageRel} in a browser (${failed.join('; ').slice(0, 300)})` };

  plan?.step(1);
  const words = taskWords(task, 16);
  const quoted = quotedIn(task);
  const steps = await pickSteps(ctx, { task, pageRel, outline: rankOutline(first.outline, words) });
  const after = await probe(ctx, scratch, { mode: 'after', browser, ...open.spec, steps, words, quoted });
  if (!after.ok) {
    ctx.tool('Browser', stepsText(steps), { kind: 'bash', code: 1, lines: [after.error], ms: after.ms }, true);
    return { ok: false, why: `the steps did not work in the browser (${after.error})` };
  }
  const pairs = groupPairs(after.pairs ?? [], [...words, ...quoted]);
  ctx.tool('Browser', stepsText(steps), { kind: 'bash', code: 0, lines: pairs.length ? pairs.slice(0, 6).map((p) => `${p.covered} is covered by ${p.by}${p.byText ? ` ("${p.byText.slice(0, 40)}")` : ''}`) : ['nothing on the page is covered by something else'], ms: after.ms });
  if (!pairs.length) return { ok: false, why: `in the browser nothing is covered after ${stepsText(steps)}, so the bug did not show` };
  const pair = await pickPair(ctx, { task, steps, pairs });
  if (!pair) return { ok: false, why: 'none of the covered things the browser found matches the request' };

  // The check, and one run of it: it must fail today, and for this reason.
  const checks = pageChecks(cwd, pageRel, files);
  const rel = checkPath(cwd, pageRel, checks, pair.covered);
  // keep: with the covered thing out of the way the covering one must still
  // be seen, so a fix cannot pass by pushing it under the rest of the page.
  // Dropped when it is already hidden there today.
  const spec = { browser, engines: ENGINES, size: SIZE, ...open.spec, waitFor: [pair.coveredBefore ? pair.covered : null, pair.byBefore ? pair.by : null].filter(Boolean), steps, covered: pair.covered, by: pair.by, keep: true };
  const write = () => checkScript({ spec, up: relative(dirname(rel), '.') || '.', head: [
    `After ${stepsText(steps)}: ${pair.covered} must be on top of ${pair.by}.`,
    `  node ${rel}        exit 0 = pass · 1 = the bug shows · 2 = the check could not run`,
    `Made by Agentic Coder on ${new Date().toISOString().slice(0, 10)} from the request:`,
    ...task.split('\n')[0].slice(0, 300).match(/.{1,96}(?:\s|$)/g).map((l) => `  ${l.trim()}`),
    `It opens ${pageRel} itself (${open.how}) in a headless browser, at ${SIZE.width}x${SIZE.height}, and reaches nothing outside this Mac.`,
  ] });
  const cmd = `node ${rel}`;
  let text = write();
  scratch.write(rel, text);
  let run = await scratch.run(cmd, { signal: ctx.signal, timeoutMs: 150_000 });
  if (run.code === 1 && /is no longer seen/.test(run.out)) {
    spec.keep = false;
    text = write();
    scratch.write(rel, text);
    run = await scratch.run(cmd, { signal: ctx.signal, timeoutMs: 150_000 });
  }
  ctx.tool('Bash', cmd, { kind: 'bash', code: run.code, lines: run.out.trimEnd().split('\n').slice(-12), ms: run.ms }, run.code !== 0);
  if (run.code !== 1) {
    scratch.restore(rel);
    return { ok: false, why: run.code === 0 ? 'the check Agentic Coder made passes today, so it does not show the bug' : `the check Agentic Coder made could not run (${/^ERROR (.+)$/m.exec(run.out)?.[1] ?? 'no result'})` };
  }
  const spots = findSpots(cwd, files, pageRel, pair);
  const report = [
    `What the browser shows (${pageRel}, ${SIZE.width}x${SIZE.height}, after ${stepsText(steps)}):`,
    `  ${pair.covered}${pair.coveredText ? ` ("${pair.coveredText}")` : ''} is covered by ${pair.by}${pair.byText ? ` ("${pair.byText}")` : ''} at ${pair.x},${pair.y}.`,
    layersText(pair),
    ...(spots.length ? ['Where those layers are set:', ...spots.map((s) => `  ${s.rel}:${s.line}  ${s.text}   (${s.what})`)] : []),
  ].filter(Boolean).join('\n');
  return { ok: true, cmd, rel, text, run, report, spots, files: [...new Set(spots.map((s) => s.rel))], pageRel, pair, steps, how: open.how,
    words: `After ${stepsText(steps)}, ${pair.covered} must be on top of ${pair.by}. Today it fails: ${pair.by}${pair.byText ? ` ("${pair.byText.slice(0, 40)}")` : ''} covers it.` };
}
