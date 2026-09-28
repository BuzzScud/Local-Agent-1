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

// Only the lines that really differ, in order ('-' gone, '+' new): what a
// description of a change is written from. diffLines below shows one block
// from the first changed line to the last, so a change in two places far
// apart reads there as hundreds of lines removed and added again (a fix of
// 3 lines was once described as "removes nine functions").
export function changedLines(before, after, max = 4000) {
  let a = before.split('\n');
  let b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  a = a.slice(start, a.length - end);
  b = b.slice(start, b.length - end);
  // Too large to compare line by line: everything between counts as changed.
  if (a.length * b.length > max * max) return [...a.map((text) => ({ type: '-', text })), ...b.map((text) => ({ type: '+', text }))];
  // The longest run of lines the two share, by the usual table.
  const n = a.length; const m = b.length;
  const t = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const out = [];
  let i = 0; let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { i++; j++; } else if (t[i + 1][j] >= t[i][j + 1]) out.push({ type: '-', text: a[i++] });
    else out.push({ type: '+', text: b[j++] });
  }
  while (i < n) out.push({ type: '-', text: a[i++] });
  while (j < m) out.push({ type: '+', text: b[j++] });
  return out;
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
