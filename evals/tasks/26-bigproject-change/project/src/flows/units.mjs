// The piece of a file a try rewrites. Small files are rewritten whole; in a
// bigger file, one function (JavaScript or Python) is cut out, rewritten and
// put back. Bonsai 2 27B writes about 10 tokens a second, so rewriting a whole
// 150-line file took ~4 minutes a try; one function takes under one.
export const WHOLE_FILE_MAX = 80;
// Up to this size the model still reads the whole file, so it knows the names
// and helpers around the function it rewrites. Reading is ~6x faster than
// writing, and the prompt cache keeps it for later tries.
export const SHOW_WHOLE_MAX = 300;

// Line range [start, end] (0-based, inclusive) of a named function.
export function findFunction(text, name, lang) {
  const lines = text.split('\n');
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (lang === 'python') {
    const i = lines.findIndex((l) => new RegExp(`^\\s*(async\\s+)?def\\s+${n}\\s*\\(`).test(l));
    if (i < 0) return null;
    const indent = /^\s*/.exec(lines[i])[0].length;
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      if (/^\s*/.exec(lines[j])[0].length <= indent) break;
      end = j;
    }
    return { start: i, end };
  }
  const head = new RegExp(`(function\\s*\\*?\\s+${n}\\s*\\(|(?:const|let|var)\\s+${n}\\s*=|^\\s*(?:async\\s+)?${n}\\s*\\([^)]*\\)\\s*\\{|${n}\\s*:\\s*(?:async\\s*)?(?:function|\\())`);
  const i = lines.findIndex((l) => head.test(l));
  if (i < 0) return null;
  // Count braces from the header on, ignoring strings and comments (roughly).
  let depth = 0;
  let seen = false;
  for (let j = i; j < lines.length; j++) {
    const code = lines[j].replace(/\/\/.*$/, '').replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
    for (const ch of code) {
      if (ch === '{') { depth++; seen = true; }
      else if (ch === '}') depth--;
    }
    if (seen && depth <= 0) return { start: i, end: j };
    if (!seen && /;\s*$/.test(code) && j > i) return { start: i, end: j }; // one-line arrow
  }
  return null;
}

// Named functions in a file (for the model to choose from in a big file).
export function functionNames(text, lang) {
  const re = lang === 'python' ? /^\s*(?:async\s+)?def\s+(\w+)/gm : /(?:function\s*\*?\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/g;
  return [...new Set([...text.matchAll(re)].map((m) => m[1] ?? m[2]).filter(Boolean))];
}

export function functionAtLine(text, line, lang) {
  for (const name of functionNames(text, lang)) {
    const r = findFunction(text, name, lang);
    if (r && line - 1 >= r.start && line - 1 <= r.end) return { name, ...r };
  }
  return null;
}

// Asked for one function, a model sometimes sends the whole file back. Treat
// the reply as the whole file when it defines other functions of the file
// (two, or the only other one), or starts like the file and is about as long.
export function isWholeFile(code, original, unitName, lang) {
  const others = new Set(functionNames(original, lang).filter((n) => n !== unitName));
  const defined = functionNames(code, lang).filter((n) => others.has(n)).length;
  if (others.size && defined >= Math.min(2, others.size)) return true;
  const first = (t) => t.split('\n').find((l) => l.trim())?.trim();
  return code.split('\n').length >= original.split('\n').length * 0.9 && first(code) === first(original);
}

export function splice(text, range, replacement) {
  const lines = text.split('\n');
  return [...lines.slice(0, range.start), ...replacement.replace(/\n$/, '').split('\n'), ...lines.slice(range.end + 1)].join('\n');
}

export const langFor = (rel) => (rel.endsWith('.py') ? 'python' : /\.(m?[jt]sx?|cjs)$/.test(rel) ? 'js' : null);
