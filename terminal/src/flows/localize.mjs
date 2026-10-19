// Finding the code a request is about: files named in it, files a failing
// test run points at (stack frames, the failing tests' imports), and, when
// neither says, the model choosing from the project's own file list.
import { readFileSync, statSync } from 'node:fs';
import { join, dirname, basename, normalize } from 'node:path';
import { walk } from '../tools/fs.mjs';
import { resolvePath, didYouMean } from '../agent/tools.mjs';
import { complete } from './llm.mjs';
import { repoMap } from '../tools/repomap.mjs';
import { rankFiles, MIN_CLOSE } from '../agent/rank.mjs';

export const isTestFile = (rel) => /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.[mc]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$/.test(rel);
export const CODE = /\.(m?[jt]sx?|cjs|py)$/;
// What a fix may change: code, and the pages and stylesheets a bug may sit in.
export const EDITABLE = /\.(m?[jt]sx?|cjs|py|html?|css|scss|less|vue|svelte)$/;

export function projectFiles(cwd, max = 20000) {
  const out = [];
  for (const f of walk(cwd)) { if (!f.dir) out.push(f.path); if (out.length >= max) break; }
  return out;
}

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

// Files named in the request ("export.mjs", "src/stats.py").
export function filesInText(cwd, text) {
  const hits = [];
  for (const tok of text.match(/[\w./-]+\.[A-Za-z]{1,5}\b/g) ?? []) {
    const p = resolvePath(cwd, tok.replace(/[.,;:]+$/, ''));
    if (p.inside && isFile(p.abs)) hits.push(p.rel);
    else { const alt = didYouMean(cwd, tok); if (alt.length === 1) hits.push(alt[0]); }
  }
  return [...new Set(hits)];
}

// Relative imports of a file: JS import/require, Python sibling modules.
export function importsOf(cwd, rel) {
  let text;
  try { text = readFileSync(join(cwd, rel), 'utf8'); } catch { return []; }
  const out = [];
  for (const m of text.matchAll(/(?:from\s+|require\(\s*|import\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const p = normalize(join(dirname(rel), m[1]));
    for (const cand of [p, `${p}.js`, `${p}.mjs`, `${p}.ts`, `${p}.tsx`, `${p}.jsx`, join(p, 'index.js'), join(p, 'index.ts')]) {
      if (isFile(join(cwd, cand))) { out.push(cand); break; }
    }
  }
  if (rel.endsWith('.py')) {
    for (const m of text.matchAll(/^\s*(?:from\s+(\.?[\w.]+)\s+import|import\s+([\w.]+))/gm)) {
      const mod = (m[1] ?? m[2]).replace(/^\./, '').replace(/\./g, '/');
      for (const cand of [join(dirname(rel), `${mod}.py`), `${mod}.py`, join('src', `${mod}.py`)]) if (isFile(join(cwd, cand))) { out.push(normalize(cand)); break; }
    }
  }
  return [...new Set(out)];
}

export function testsFor(cwd, rel, files) {
  return files.filter((f) => isTestFile(f) && importsOf(cwd, f).includes(rel));
}

// The test files that check a change, the closest first, at most `max` (18 Oct 2026: the app's own check ran a whole
// suite of 3 to 6 minutes after every change; its 2-minute limit cut it off, and the apps its tests had started ran
// on). Closest: a test file the change itself made or changed, then one named after a changed file, then one that
// imports a changed file, then one that imports a file that does; among equals, the one whose name shares more words
// with a changed file's. A name alone is not enough when the test's imports go elsewhere (a practice project's own
// agent.test.mjs is not agent.mjs's). [] when none does: the whole suite runs then.
export const COVER_MAX = 5;
const words = (rel) => basename(rel).replace(/\.[^.]+$/, '').replace(/(^test_|[._-](test|spec)$)/, '').split(/[^a-z0-9]+/i).filter(Boolean).map((w) => w.toLowerCase());
export function coveringTests(cwd, changed, files, max = COVER_MAX) {
  const tests = files.filter(isTestFile);
  const code = changed.filter((f) => !isTestFile(f));
  const stems = new Set(code.map((f) => words(f).join('-')));
  const imports = new Map();
  const importsOfCached = (rel) => { if (!imports.has(rel)) imports.set(rel, importsOf(cwd, rel)); return imports.get(rel); };
  const rank = (t) => {
    if (changed.includes(t)) return 0;
    const direct = importsOfCached(t);
    const first = code.some((f) => direct.includes(f));
    const second = !first && direct.some((d) => !isTestFile(d) && code.some((f) => importsOfCached(d).includes(f)));
    if (stems.has(words(t).join('-')) && (first || second || !direct.length)) return 1;
    return first ? 2 : second ? 3 : null;
  };
  const near = (t) => Math.max(0, ...code.map((f) => words(f).filter((w) => words(t).includes(w)).length));
  return tests.map((t) => ({ t, r: rank(t) })).filter((x) => x.r !== null)
    .sort((a, b) => a.r - b.r || near(b.t) - near(a.t) || a.t.localeCompare(b.t)).slice(0, max).map((x) => x.t);
}

// Source files a failing run points at, most likely first.
export function sourcesFromFailure(cwd, out, files) {
  const hits = [];
  for (const m of out.matchAll(/([\w./-]+\.(?:m?[jt]sx?|cjs|py))[:"](?:,? line )?(\d+)/g)) {
    const rel = normalize(m[1].replace(/^(?:file:\/\/)?\.?\/?/, ''));
    if (files.includes(rel) && !isTestFile(rel)) hits.push(rel);
  }
  const tests = files.filter((f) => isTestFile(f) && out.includes(basename(f)));
  for (const t of tests) for (const imp of importsOf(cwd, t)) if (!isTestFile(imp)) hits.push(imp);
  return { sources: [...new Set(hits)], tests };
}

// The code files a task could be about, each with its size, its top-level
// names (from the project map) and how many words of the task it mentions;
// the likeliest first. What the model chooses from. Every code file is
// ranked before the list is cut, so a big project's first folders A to Z
// do not crowd out the one the task is about.
const STOP = new Set(['the', 'and', 'for', 'fix', 'bug', 'not', 'but', 'are', 'was', 'can', 'you', 'its', 'has', 'had', 'did', 'does', 'when', 'with', 'this', 'that', 'from', 'into', 'then', 'than', 'what', 'where', 'which', 'there', 'their', 'they', 'them', 'have', 'should', 'would', 'could', 'must', 'make', 'please', 'also', 'just', 'some', 'every', 'any', 'all', 'now', 'done', 'fails', 'check', 'pass', 'passes', 'work', 'works']);
export function taskWords(task, max = 12) {
  return [...new Set((task.match(/[A-Za-z_]\w{2,}/g) ?? []).map((w) => w.toLowerCase()))].filter((w) => !STOP.has(w)).slice(0, max);
}
export function fileHints(cwd, task, files, { max = 150, named = 60, exts = CODE, keepOrder = 0 } = {}) {
  const code = files.filter((f) => exts.test(f) && !isTestFile(f));
  const words = taskWords(task);
  let byRel = new Map();
  try { byRel = new Map(repoMap(cwd).entries.map((e) => [e.rel, e])); } catch {}
  // A word in the file's path counts twice: "chart" in desks/chart/… says more than one use inside.
  const scored = code.map((f) => {
    let text = '';
    try { text = readFileSync(join(cwd, f), 'utf8').slice(0, 20000).toLowerCase(); } catch {}
    const path = f.toLowerCase();
    return { f, n: words.filter((w) => text.includes(w)).length, p: words.filter((w) => path.includes(w)).length };
  });
  // keepOrder: the first files are already ranked (by meaning) and stay first.
  const head = scored.slice(0, keepOrder);
  const rest = scored.slice(keepOrder).sort((a, b) => (b.n + 2 * b.p) - (a.n + 2 * a.p) || b.n - a.n);
  const ordered = [...head, ...rest].slice(0, max);
  const lines = ordered.map(({ f, n }, i) => {
    const e = byRel.get(f);
    const names = e && i < named && e.names.length ? `: ${e.names.slice(0, 8).join(', ')}${e.names.length > 8 ? ', …' : ''}` : '';
    return `${f}${e ? ` (${e.lines} lines)` : ''}${names}${n ? `  · mentions ${n} word${n === 1 ? '' : 's'} from the task` : ''}`;
  });
  return { code: ordered.map((s) => s.f), text: lines.join('\n') };
}

// The model chooses the file from the project's list (forced JSON, so the
// answer is always one of the real files). With the memory's small model
// (embedder), the files are first ranked by meaning (agent/rank.mjs): a clear
// winner is taken without asking the model (one reply saved), and otherwise
// the closest files head the list it chooses from.
const CLEAR_LEAD = 0.05; // the best file's lead over the next that makes it a clear winner
export async function pickFile({ url, model, slot, cwd, task, files, signal, exts, embedder = null, instructions }) {
  let { code, text: hints } = fileHints(cwd, task, files, { exts });
  if (!code.length) return null;
  if (code.length === 1) return code[0];
  if (embedder) {
    let byRel = new Map();
    try { byRel = new Map(repoMap(cwd).entries.map((e) => [e.rel, e])); } catch {}
    const entries = code.map((rel) => byRel.get(rel) ?? { rel, lines: 0, names: [] });
    let ranked = null;
    try { ranked = await rankFiles(cwd, task, { embedder, entries, top: 5, signal }); } catch (e) { if (signal?.aborted || e.name === 'AbortError') throw e; }
    const best = ranked?.how === 'meaning' ? ranked.best : null;
    if (best?.length && best[0].score >= MIN_CLOSE && (best.length === 1 || best[0].score - best[1].score >= CLEAR_LEAD)) return best[0].rel;
    if (best?.length) {
      const first = best.map((b) => b.rel);
      ({ code, text: hints } = fileHints(cwd, task, [...first, ...code.filter((c) => !first.includes(c))], { exts, keepOrder: first.length }));
    }
  }
  const r = await complete({
    instructions,
    url, model, slot, signal, temperature: 0, maxTokens: 120,
    system: 'You choose which file in a project a task is about.',
    user: `Task: ${task}\n\nFiles:\n${hints}\n\nWhich one file must change to do this task?`,
    schema: { type: 'object', properties: { file: { type: 'string', enum: code } }, required: ['file'] },
  });
  return r.json?.file ?? null;
}

// Small data files the code or tests mention by name ('trades.json'), so the
// model can see what they hold.
export function relatedData(cwd, texts, maxBytes = 3000) {
  const out = [];
  const seen = new Set();
  for (const t of texts) {
    for (const m of t.matchAll(/['"`]([\w./-]+\.(?:json|csv|txt|ya?ml|tsv|xml|ini|toml))['"`]/g)) {
      const rel = m[1].replace(/^\.\//, '');
      if (seen.has(rel)) continue;
      seen.add(rel);
      try { const st = statSync(join(cwd, rel)); if (st.isFile() && st.size <= maxBytes) out.push({ rel, text: readFileSync(join(cwd, rel), 'utf8') }); } catch {}
    }
  }
  return out.slice(0, 3);
}
