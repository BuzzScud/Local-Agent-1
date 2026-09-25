// Edit blocks: how a try describes changes to several files, or several
// places in one file, without rewriting whole files (writing is the slow
// part: about 10 tokens a second). The model copies the old lines and writes
// the new ones; the blocks are matched the way the Edit tool matches (exact,
// then forgiving of indentation and one-character slips).
import { findEdit } from '../agent/tools.mjs';
import { functionNames, langFor } from './units.mjs';

export const BLOCKS_FORMAT = `Reply with edit blocks only, one block per change, in exactly this form:
### path/to/file.mjs
<<<<<<< OLD
the exact lines to replace, copied from the file
=======
the new lines
>>>>>>> NEW

Rules: OLD must be copied exactly and appear once in that file. Several blocks may name the same file. To add to the end of a file, leave OLD empty. To create a new file, name a path that does not exist and leave OLD empty. Nothing else in the reply.`;

// [{ path, old, new }] from a reply; the whole reply may sit in a code fence.
export function parseBlocks(text) {
  let t = text ?? '';
  const fenced = /```[\w.+-]*[ \t]*\n([\s\S]*?)```/.exec(t);
  if (fenced && !/^###\s/m.test(t.slice(0, fenced.index))) t = fenced[1];
  const out = [];
  const re = /^###\s+(\S[^\n]*?)\s*\n<{4,}\s*OLD[^\n]*\n([\s\S]*?)^={4,}[^\n]*\n([\s\S]*?)^>{4,}\s*NEW[^\n]*$/gm;
  for (const m of t.matchAll(re)) {
    const path = m[1].replace(/^[`'"]+|[`'"]+$/g, '').replace(/^\.\//, '');
    out.push({ path, old: m[2].replace(/\n$/, ''), new: m[3].replace(/\n$/, '') });
  }
  return out;
}

// Applies blocks to the texts read(rel) gives (null = no such file). Returns
// the new text of every touched file, or the first error.
export function applyBlocks(blocks, read) {
  const files = new Map();
  const current = (rel) => (files.has(rel) ? files.get(rel) : read(rel));
  if (!blocks.length) return { error: 'no edit blocks in the reply' };
  for (const b of blocks) {
    if (!b.path || /(^|\/)\.\.(\/|$)/.test(b.path) || b.path.startsWith('/')) return { error: `bad path in a block: ${b.path}` };
    const before = current(b.path);
    if (!b.old.trim()) {
      const after = before === null ? `${b.new.replace(/\n*$/, '\n')}` : `${before.replace(/\n*$/, '\n')}${b.new.replace(/\n*$/, '\n')}`;
      files.set(b.path, after);
      continue;
    }
    if (before === null) return { error: `${b.path} does not exist, but the block has OLD lines to replace` };
    const m = findEdit(before, b.old, b.new, { replaceAll: false });
    if (!m.ok) return { error: `${b.path}: ${m.error}` };
    files.set(b.path, m.after);
  }
  return { files };
}

// A change that quietly removes code: exported or top-level names that were
// there before and are gone after, when the task never asks to remove
// anything; or far more lines removed than added. (A wider fix once passed
// the four tests of a 200-line file by deleting eight other functions.)
export function guardChange(rel, before, after, task = '') {
  if (before == null) return null;
  const lang = langFor(rel);
  const asksRemoval = /\b(remove|delete|drop|strip|get rid of|take out|clean ?up|unused|dead code)\b/i.test(task);
  if (lang && !asksRemoval) {
    const gone = functionNames(before, lang).filter((n) => !functionNames(after, lang).includes(n));
    if (gone.length) return `${rel}: the change removes ${gone.slice(0, 4).join(', ')}${gone.length > 4 ? ` and ${gone.length - 4} more` : ''}, which the task does not ask for`;
  }
  const b = before.split('\n').length;
  const a = after.split('\n').length;
  if (!asksRemoval && b - a > Math.max(20, Math.round(b * 0.25))) return `${rel}: the change removes ${b - a} more lines than it adds; keep the rest of the file as it is`;
  return null;
}
