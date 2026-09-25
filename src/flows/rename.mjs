// Built-in rename: every whole-word use of a name, in every text file of the
// project, shown as one diff and applied in one go. No model needed.
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { walk } from '../tools/fs.mjs';

const TEXT = /\.(m?[jt]sx?|cjs|mts|cts|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|vue|svelte|html|css|scss|md|json|ya?ml|toml|sh|sql)$/i;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Changed lines grouped into hunks with one line of context (line count is unchanged by a rename).
export function lineHunks(before, after, context = 1) {
  const a = before.split('\n');
  const b = after.split('\n');
  const changed = a.map((l, i) => l !== b[i]);
  const hunk = [];
  let last = -10;
  for (let i = 0; i < a.length; i++) {
    const near = changed.slice(Math.max(0, i - context), i + context + 1).some(Boolean);
    if (!near) continue;
    if (i > last + 1 && hunk.length) hunk.push({ type: ' ', text: '…', gap: true });
    if (changed[i]) { hunk.push({ type: '-', oldNo: i + 1, text: a[i] }); hunk.push({ type: '+', newNo: i + 1, text: b[i] }); }
    else hunk.push({ type: ' ', oldNo: i + 1, newNo: i + 1, text: a[i] });
    last = i;
  }
  return hunk;
}

export function planRename(cwd, from, to) {
  const re = new RegExp(`(?<![\\w$])${esc(from)}(?![\\w$])`, 'g');
  const files = [];
  for (const f of walk(cwd)) {
    if (f.dir || !TEXT.test(f.path)) continue;
    const abs = join(cwd, f.path);
    try { if (statSync(abs).size > 1e6) continue; } catch { continue; }
    const before = readFileSync(abs, 'utf8');
    const count = (before.match(re) ?? []).length;
    if (!count) continue;
    const after = before.replace(re, to);
    files.push({ rel: f.path, abs, before, after, count, hunk: lineHunks(before, after) });
  }
  return { files, total: files.reduce((n, f) => n + f.count, 0) };
}

export function applyRename(plan) {
  for (const f of plan.files) writeFileSync(f.abs, f.after);
}
