// Edit tool: exact find-and-replace. The text to find must appear exactly once,
// so a small model can never change the wrong spot. planEdit() makes the diff
// for the permission prompt; applyEdit() writes it.
import { readFileSync, writeFileSync } from 'node:fs';

const CONTEXT = 2;

export function planEdit(path, oldText, newText) {
  const before = readFileSync(path, 'utf8');
  const count = before.split(oldText).length - 1;
  if (count === 0) return { ok: false, error: `The text to replace was not found in ${path}.` };
  if (count > 1) return { ok: false, error: `The text to replace appears ${count} times in ${path}; include more surrounding lines.` };
  const after = before.replace(oldText, () => newText);
  return { ok: true, path, before, after, ...diffLines(before, after) };
}

export function applyEdit(plan) {
  writeFileSync(plan.path, plan.after);
  return plan;
}

// One hunk around the changed block: common prefix and suffix are context.
export function diffLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }
  // A pure insertion or deletion can slide: prefer the version that starts
  // with the blank line, the way people write diffs.
  if (endA < start) while (start > 0 && b[start - 1] === b[endB] && b[endB].trim() === '') { start--; endB--; endA--; }
  if (endB < start) while (start > 0 && a[start - 1] === a[endA] && a[endA].trim() === '') { start--; endA--; endB--; }
  const lines = [];
  for (let i = Math.max(0, start - CONTEXT); i < start; i++) lines.push({ type: ' ', oldNo: i + 1, newNo: i + 1, text: a[i] });
  for (let i = start; i <= endA; i++) lines.push({ type: '-', oldNo: i + 1, text: a[i] });
  for (let i = start; i <= endB; i++) lines.push({ type: '+', newNo: i + 1, text: b[i] });
  const shift = endB - endA;
  for (let i = endA + 1; i <= Math.min(a.length - 1, endA + CONTEXT); i++) {
    if (a[i] === '' && i === a.length - 1) break;
    lines.push({ type: ' ', oldNo: i + 1, newNo: i + 1 + shift, text: a[i] });
  }
  return {
    hunk: lines,
    additions: Math.max(0, endB - start + 1),
    removals: Math.max(0, endA - start + 1),
  };
}
