// Finding the code a request is about: files named in it, files a failing
// test run points at (stack frames, the failing tests' imports), and, when
// neither says, the model choosing from the project's own file list.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, basename, normalize } from 'node:path';
import { walk } from '../tools/fs.mjs';
import { resolvePath, didYouMean } from '../agent/tools.mjs';
import { complete } from './llm.mjs';

export const isTestFile = (rel) => /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[mc]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$/.test(rel);
export const CODE = /\.(m?[jt]sx?|cjs|py)$/;

export function projectFiles(cwd, max = 4000) {
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

// The model chooses the file from the project's list (forced JSON, so the
// answer is always one of the real files).
export async function pickFile({ url, model, slot, cwd, task, files, signal }) {
  const code = files.filter((f) => CODE.test(f) && !isTestFile(f)).slice(0, 150);
  if (!code.length) return null;
  if (code.length === 1) return code[0];
  const words = [...new Set((task.match(/[A-Za-z_]\w{3,}/g) ?? []).map((w) => w.toLowerCase()))].slice(0, 8);
  const hints = code.map((f) => {
    let text = '';
    try { text = readFileSync(join(cwd, f), 'utf8').slice(0, 20000).toLowerCase(); } catch {}
    const n = words.filter((w) => text.includes(w)).length;
    return `${f}${n ? `  (mentions ${n} word${n === 1 ? '' : 's'} from the task)` : ''}`;
  }).join('\n');
  const r = await complete({
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
