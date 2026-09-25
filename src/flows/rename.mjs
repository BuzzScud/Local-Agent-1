// Built-in rename: every use of a name in the project's code, shown as one
// diff and applied in one go. No model needed.
// Only code changes: a word inside quotes or a comment is text, not the name
// ("rename test to check" once turned 'node:test' into 'node:check'). A name
// imported from a package keeps its real name and gets an alias
// (import { test as check } from 'node:test'). Text files (README, JSON, …)
// are left alone. What was left alone is counted and shown.
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { walk } from '../tools/fs.mjs';

const CODE = /\.(m?[jt]sx?|cjs|mts|cts|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|vue|svelte|sh)$/i;
const TEXT = /\.(md|json|ya?ml|toml|html|css|scss|sql|txt)$/i;
const HASH_COMMENTS = /\.(py|rb|sh)$/i;
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

// Which characters are text (inside quotes or a comment) rather than code.
// JavaScript-style (// and /* */, '…' "…" `…` with ${…} as code) or, for
// Python, Ruby and shell, # comments and '''…''' / """…""" as well.
export function textMask(src, { hash = false } = {}) {
  const mask = new Uint8Array(src.length);
  const stack = []; // open ${ … } inside template strings: brace depth per level
  let i = 0;
  const mark = (a, b) => mask.fill(1, a, b);
  while (i < src.length) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    const three = src.slice(i, i + 3);
    if (!hash && two === '//') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; mark(i, end); i = end; continue; }
    if (!hash && two === '/*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; mark(i, end); i = end; continue; }
    if (hash && c === '#') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; mark(i, end); i = end; continue; }
    if (hash && (three === '"""' || three === "'''")) { const e = src.indexOf(three, i + 3); const end = e < 0 ? src.length : e + 3; mark(i, end); i = end; continue; }
    if (c === '"' || c === "'" || (!hash && c === '`')) {
      let j = i + 1;
      const start = i;
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') { j += 2; continue; }
        if (c === '`' && src[j] === '$' && src[j + 1] === '{') break; // code starts
        if (c !== '`' && src[j] === '\n') break; // an unclosed quote ends at the line
        j++;
      }
      if (c === '`' && src[j] === '$') { mark(start, j + 2); stack.push(0); i = j + 2; continue; }
      mark(start, Math.min(j + 1, src.length));
      i = j + 1;
      continue;
    }
    if (stack.length && c === '{') { stack[stack.length - 1]++; i++; continue; }
    if (stack.length && c === '}') {
      if (stack[stack.length - 1] > 0) { stack[stack.length - 1]--; i++; continue; }
      // Back inside the template string.
      stack.pop();
      let j = i + 1;
      while (j < src.length && src[j] !== '`') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') break;
        j++;
      }
      if (src[j] === '$') { mark(i, j + 2); stack.push(0); i = j + 2; continue; }
      mark(i, Math.min(j + 1, src.length));
      i = j + 1;
      continue;
    }
    i++;
  }
  return mask;
}

// A module that is not part of the project: a package or a built-in.
const jsExternal = (spec) => !/^(\.|\/|~\/|@\/|#)/.test(spec);
const pyExternal = (cwd, mod) => !mod.startsWith('.') && !existsSync(join(cwd, `${mod.split('.')[0]}.py`)) && !existsSync(join(cwd, mod.split('.')[0]));

// Uses of `from` inside imports from outside the project: the imported (real)
// name must stay, so a bare `test` becomes `test as check` (or `test: check`
// in a require), and in `test as t` the name `test` is not touched.
function importSpots(src, from, to, { python, cwd }) {
  const spots = new Map(); // index → replacement text ('' = leave alone)
  const each = (list, listAt, sepAs) => {
    const re = /([A-Za-z_$][\w$]*)(\s*(?:as|:)\s*[A-Za-z_$][\w$]*)?/g;
    for (const m of list.matchAll(re)) {
      if (m[1] !== from || m[1] === 'type') continue;
      const at = listAt + m.index;
      spots.set(at, m[2] ? '' : `${from}${sepAs}${to}`);
    }
  };
  if (python) {
    for (const m of src.matchAll(/^[ \t]*from\s+([\w.]+)\s+import\s+\(?([^)\n]*)/gm)) {
      if (!pyExternal(cwd, m[1])) continue;
      each(m[2], m.index + m[0].length - m[2].length, ' as ');
    }
    return spots;
  }
  for (const m of src.matchAll(/\bimport\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g)) {
    if (!jsExternal(m[3])) continue;
    each(m[1], m.index + m[0].indexOf('{') + 1, ' as ');
  }
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*(['"])([^'"]+)\2\s*\)/g)) {
    if (!jsExternal(m[3])) continue;
    each(m[1], m.index + m[0].indexOf('{') + 1, ': ');
  }
  return spots;
}

// One file: the new text, how many uses changed and how many were left alone.
export function renameInCode(src, from, to, { python = false, hash = python, cwd = '.' } = {}) {
  const re = new RegExp(`(?<![\\w$])${esc(from)}(?![\\w$])`, 'g');
  const mask = textMask(src, { hash });
  const spots = importSpots(src, from, to, { python, cwd });
  let out = '';
  let last = 0;
  let count = 0;
  let skipped = 0;
  for (const m of src.matchAll(re)) {
    const at = m.index;
    if (mask[at]) { skipped++; continue; }
    let repl = to;
    if (spots.has(at)) {
      repl = spots.get(at);
      if (!repl) continue; // the real name in `test as t`
    }
    out +=src.slice(last, at) + repl;
    last = at + m[0].length;
    count++;
  }
  return { after: out + src.slice(last), count, skipped };
}

export function planRename(cwd, from, to) {
  const files = [];
  const leftText = []; // text files that mention the name (not changed)
  let leftInCode = 0; // uses inside quotes or comments (not changed)
  for (const f of walk(cwd)) {
    if (f.dir) continue;
    const code = CODE.test(f.path);
    if (!code && !TEXT.test(f.path)) continue;
    const abs = join(cwd, f.path);
    try { if (statSync(abs).size > 1e6) continue; } catch { continue; }
    const before = readFileSync(abs, 'utf8');
    if (!before.includes(from)) continue;
    if (!code) {
      const n = (before.match(new RegExp(`(?<![\\w$])${esc(from)}(?![\\w$])`, 'g')) ?? []).length;
      if (n) leftText.push({ rel: f.path, count: n });
      continue;
    }
    const python = /\.py$/i.test(f.path);
    const r = renameInCode(before, from, to, { python, hash: HASH_COMMENTS.test(f.path), cwd });
    leftInCode += r.skipped;
    if (!r.count) continue;
    files.push({ rel: f.path, abs, before, after: r.after, count: r.count, hunk: lineHunks(before, r.after) });
  }
  return { files, total: files.reduce((n, f) => n + f.count, 0), leftInCode, leftText };
}

// "Left alone: 2 in quotes or comments; README.md (1)." or ''.
export function leftAloneNote(plan) {
  const parts = [];
  if (plan.leftInCode) parts.push(`${plan.leftInCode} in quotes or comments`);
  if (plan.leftText?.length) parts.push(plan.leftText.map((f) => `${f.rel} (${f.count})`).join(', '));
  return parts.length ? `Left alone: ${parts.join('; ')}.` : '';
}

export function applyRename(plan) {
  for (const f of plan.files) writeFileSync(f.abs, f.after);
}
