// The parts of a file a fix needs, when the whole file cannot be shown: a
// page or stylesheet (no functions to pick), or code too big to read whole.
// The model names a few exact strings to look for (a selector, an id, a
// name); the lines that hold them, with a little around each, are shown,
// and the fix comes back as edit blocks against those lines.
import { readFileSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { complete } from './llm.mjs';

// Local stylesheets a page loads: a page's look often lives there.
export function linkedFiles(cwd, rel, files) {
  if (!/\.html?$/.test(rel)) return [];
  let text = '';
  try { text = readFileSync(join(cwd, rel), 'utf8'); } catch { return []; }
  const out = [];
  for (const m of text.matchAll(/<link[^>]+href=["']([^"'#?]+\.css)["']/g)) {
    if (/^[a-z]+:|^\/\//i.test(m[1])) continue;
    const p = normalize(m[1].startsWith('/') ? m[1].slice(1) : join(dirname(rel), m[1]));
    if (files.includes(p)) out.push(p);
  }
  return [...new Set(out)];
}

// Lines holding the most distinct terms first, each with `around` lines of
// context, until `maxLines` are shown. Lines too long to copy (minified
// code) are left out.
export function excerpts(cwd, files, terms, { around = 3, maxLines = 220, maxLineLen = 1500 } = {}) {
  const want = [...new Set(terms.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2))];
  if (!want.length) return { text: '', hits: 0, lines: 0 };
  const hits = [];
  const texts = new Map();
  files.forEach((rel, fi) => {
    let lines;
    try { lines = readFileSync(join(cwd, rel), 'utf8').replace(/\n$/, '').split('\n'); } catch { return; }
    texts.set(rel, lines);
    lines.forEach((line, i) => {
      if (line.length > maxLineLen) return;
      const low = line.toLowerCase();
      const n = want.filter((t) => low.includes(t)).length;
      if (n) hits.push({ rel, fi, i, n });
    });
  });
  hits.sort((a, b) => b.n - a.n || a.fi - b.fi || a.i - b.i);
  const keep = new Map(); // rel → Set of line numbers
  let count = 0;
  for (const h of hits) {
    if (count >= maxLines) break;
    const lines = texts.get(h.rel);
    const set = keep.get(h.rel) ?? new Set();
    keep.set(h.rel, set);
    for (let i = Math.max(0, h.i - around); i <= Math.min(lines.length - 1, h.i + around); i++) {
      if (!set.has(i) && lines[i].length <= maxLineLen) { set.add(i); count++; }
    }
  }
  const parts = [];
  for (const rel of files) {
    const set = keep.get(rel);
    if (!set?.size) continue;
    const lines = texts.get(rel);
    const nums = [...set].sort((a, b) => a - b);
    let run = [nums[0]];
    const flush = () => parts.push(`${rel} (lines ${run[0] + 1}-${run.at(-1) + 1}):\n\`\`\`\n${run.map((i) => lines[i]).join('\n')}\n\`\`\``);
    for (const i of nums.slice(1)) { if (i === run.at(-1) + 1) run.push(i); else { flush(); run = [i]; } }
    flush();
  }
  return { text: parts.join('\n\n'), hits: hits.length, lines: count, files: [...keep.keys()] };
}

// The lines of one file around the given line numbers (from 0), in the same
// form as excerpts(): each run with its line range, ready to copy into an edit.
export function linesAround(rel, lines, hits, { around = 3, maxLines = 80, maxLineLen = 1500 } = {}) {
  const keep = new Set();
  for (const h of hits) {
    if (keep.size >= maxLines) break;
    for (let i = Math.max(0, h - around); i <= Math.min(lines.length - 1, h + around); i++) if (lines[i].length <= maxLineLen) keep.add(i);
  }
  const nums = [...keep].sort((a, b) => a - b);
  if (!nums.length) return '';
  const parts = [];
  let run = [nums[0]];
  const flush = () => parts.push(`${rel} (lines ${run[0] + 1}-${run.at(-1) + 1}):\n\`\`\`\n${run.map((i) => lines[i]).join('\n')}\n\`\`\``);
  for (const i of nums.slice(1)) { if (i === run.at(-1) + 1) run.push(i); else { flush(); run = [i]; } }
  flush();
  return parts.join('\n\n');
}

// The strings to look for, from the model (forced JSON).
export async function searchTerms(ctx, { task, digest, files }) {
  const r = await complete({
    instructions: ctx.instructions,
    url: ctx.url, model: ctx.model, slot: ctx.slot, signal: ctx.signal, temperature: 0, maxTokens: 150,
    system: 'You find the code a bug fix must change.',
    user: `Task: ${task}\n\nWhat the check says:\n${digest.slice(0, 3000)}\n\nFiles: ${files.join(', ')}\n\nGive up to 6 exact strings to search these files for: ids, class names, CSS selectors or properties, function or variable names. Not common words.`,
    schema: { type: 'object', properties: { terms: { type: 'array', items: { type: 'string' }, maxItems: 6 } }, required: ['terms'] },
  });
  return (r.json?.terms ?? []).filter((t) => typeof t === 'string' && t.trim()).slice(0, 6);
}
