// A long file's parts with their line ranges, so the model reads only the
// part it needs instead of the whole file (reading is the slow part: ~60
// tokens a second, so a 600-line file costs ~2½ minutes every time).
//   JavaScript/TypeScript: functions, classes and their methods, const arrow
//   functions, exported values. Python: def and class. Anything else: blocks
//   of 60 lines.

const JS = [
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/,
  /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/,
  /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:React\.)?(?:memo|forwardRef|useCallback|useMemo)\(/,
  /^(?:export\s+)?(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*=/, // constants such as TOOL_DEFS
  /^(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
];
const JS_METHOD = /^\s{2,4}(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?\*?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/;
const NOT_METHOD = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'with']);
const PY = [/^(?:async\s+)?def\s+([A-Za-z_]\w*)/, /^class\s+([A-Za-z_]\w*)/];

// Parts inside a big function (a React component's handlers and effects).
const JS_INNER = [
  /^\s{2,4}(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^\s{2,4}const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:useCallback|useMemo)\(/,
  /^\s{2,4}const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  /^\s{2,4}(useEffect|useLayoutEffect|useInput)\(/,
  /^\s{2,4}(return)\s*\(\s*$/,
];
const PY_INNER = /^\s{4}(?:async\s+)?def\s+([A-Za-z_]\w*)/;

export function outline(text, path = '') {
  const lines = text.split('\n');
  const py = /\.py$/i.test(path);
  const js = /\.(m?[jt]sx?|cjs|mts|cts|vue|svelte)$/i.test(path);
  const tops = [];
  if (js || py) {
    lines.forEach((l, i) => {
      for (const re of py ? PY : JS) {
        const m = re.exec(l);
        if (m) { tops.push({ name: m[1], line: i + 1, top: true, cls: /\bclass\s/.test(l) }); return; }
      }
    });
  }
  if (!tops.length || tops[0].line > 1) tops.unshift({ name: js || py ? 'imports and setup' : null, line: 1, top: true });
  tops.forEach((t, k) => { t.end = (tops[k + 1]?.line ?? lines.length + 1) - 1; });
  // Nothing recognised: blocks of 60 lines.
  if (tops.length === 1 && !tops[0].name) {
    const out = [];
    for (let a = 1; a <= lines.length; a += 60) out.push({ name: null, line: a, end: Math.min(lines.length, a + 59), top: true });
    return out;
  }
  const out = [];
  for (const t of tops) {
    out.push(t);
    if (!(t.cls || t.end - t.line > 80) || !t.name || t.name === 'imports and setup') continue;
    const inner = [];
    for (let i = t.line; i < t.end; i++) {
      const l = lines[i];
      let name = null;
      if (py) name = PY_INNER.exec(l)?.[1] ?? null;
      else {
        const mm = JS_METHOD.exec(l);
        if (t.cls && mm && !NOT_METHOD.has(mm[1])) name = mm[1];
        else for (const re of JS_INNER) { const m = re.exec(l); if (m) { name = m[1] === 'return' ? 'what it shows (return)' : m[1]; break; } }
      }
      if (name) inner.push({ name, line: i + 1, top: false });
    }
    inner.forEach((p, k) => { p.end = (inner[k + 1]?.line ?? t.end + 1) - 1; });
    out.push(...inner);
  }
  return out;
}

export function outlineText(text, path, { max = 80 } = {}) {
  const parts = outline(text, path);
  const total = text.split('\n').length;
  const width = String(total).length;
  const rows = parts.slice(0, max).map((p) => `  ${`${p.line}-${p.end}`.padEnd(width * 2 + 2)} ${p.top ? '' : '  '}${p.name ?? `lines ${p.line}-${p.end}`}`);
  const more = parts.length > max ? `\n  … and ${parts.length - max} more parts` : '';
  const big = parts.filter((p) => p.top).sort((a, b) => (b.end - b.line) - (a.end - a.line))[0];
  // A long page or stylesheet has no functions to list: blocks of 60 lines say
  // nothing (a 27,000-line page gave 450 of them), so only the way in is given.
  if (parts.length > 12 && parts.every((p) => !p.name)) return `${path} is ${total} lines, too long to show at once, and it has no functions to list. Read only the part you need: Read again with find (a word or a name, such as an id or a class) to see the lines around it, or with offset (first line) and limit (number of lines).`;
  return `${path} is ${total} lines, too long to show at once. Its parts (lines, name):\n${rows.join('\n')}${more}\nRead only the part you need: Read again with find (a word or a name) to see the lines around it, or with offset (first line) and limit (number of lines)${big ? `, e.g. offset ${big.line} and limit ${Math.min(200, big.end - big.line + 1)} for ${big.name ?? 'the largest part'}` : ''}.`;
}
