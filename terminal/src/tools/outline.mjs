// A long file's parts with their line ranges, so the model reads only the
// part it needs instead of the whole file (reading is the slow part: ~60
// tokens a second, so a 600-line file costs ~2½ minutes every time).
//   JavaScript/TypeScript: functions, classes and their methods, const arrow
//   functions, exported values. Python: def and class. Pages, Markdown, tables
//   and JSON (outlineText only): docParts. Anything else: blocks of 60 lines.

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

// The parts of a page or a data file, which have no functions (4 Oct 2026: a 770-line report page
// came back as "too long, and it has no functions to list", the model never read a part of it and
// said it had found the formulas in it). A page: its headings, its sections and tabs with an id, its
// styles and scripts. Markdown: its headings. A table (CSV, TSV): the header row, then the rows with
// the first one shown. JSON: the keys at the top. Fewer than two found: [] (blocks of 60 lines then).
// The keys most of a JSON-lines file's records have (of its first 50), as "a, b, c".
function recordKeys(lines) {
  const count = new Map();
  for (const l of lines.slice(0, 50)) { try { const o = JSON.parse(l); if (o && typeof o === 'object' && !Array.isArray(o)) { const k = Object.keys(o).join(', '); count.set(k, (count.get(k) ?? 0) + 1); } } catch {} }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}
const clean = (s, n = 70) => { const t = String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z]+;|&#\d+;/g, ' ').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
export function docParts(text, path = '') {
  const lines = text.split('\n');
  const found = [];
  if (/\.(s?html?|xhtml|vue|svelte)$/i.test(path)) {
    lines.forEach((l, i) => {
      const h = /<h([1-3])\b[^>]*>(.*?)(?:<\/h\1>|$)/i.exec(l);
      if (h && clean(h[2])) { found.push({ name: `h${h[1]} ${clean(h[2])}`, line: i + 1 }); return; }
      const sec = /<(section|article|main|nav|aside|div)\b[^>]*\bid=["']([^"']+)["'][^>]*>/i.exec(l);
      if (sec && (sec[1].toLowerCase() !== 'div' || /\b(class|role)=["'][^"']*\b(tab|panel|section|page|pane)/i.test(sec[0]))) { found.push({ name: `${sec[1].toLowerCase()} #${sec[2]}`, line: i + 1 }); return; }
      if (/<style\b/i.test(l)) found.push({ name: 'styles (<style>)', line: i + 1 });
      else if (/<script\b/i.test(l)) found.push({ name: `script${/\bsrc=/.test(l) ? ' (a link)' : ''}`, line: i + 1 });
      else if (/<body\b/i.test(l)) found.push({ name: 'body', line: i + 1 });
    });
  } else if (/\.(md|markdown|mdx)$/i.test(path)) {
    let fenced = false;
    lines.forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
      const h = !fenced && /^(#{1,3})\s+(.+)/.exec(l);
      if (h) found.push({ name: `${h[1]} ${clean(h[2])}`, line: i + 1 });
    });
  } else if (/\.(csv|tsv)$/i.test(path)) {
    const rows = lines.filter((l) => l.trim()).length;
    const sep = /\.tsv$/i.test(path) ? '\t' : ',';
    const cols = lines[0]?.split(sep).length ?? 0;
    if (rows < 2) return [];
    return [
      { name: `header, ${cols} columns: ${clean(lines[0].split(sep).join(', '), 160)}`, line: 1, end: 1, top: true },
      { name: `${rows - 1} rows; the first: ${clean(lines[1], 160)}`, line: 2, end: lines.length, top: true },
    ];
  } else if (/\.(ndjson|jsonl)$/i.test(path)) {
    // One record a line: how many, the keys of the first, and the first itself.
    // A first line with keys of its own (a "meta" header) is said apart from the records.
    const rows = lines.filter((l) => l.trim()).length;
    if (rows < 2) return [];
    const keys = recordKeys(lines);
    const keysOf = (l) => { try { const o = JSON.parse(l); return o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).join(', ') : ''; } catch { return ''; } };
    if (keys && keysOf(lines[0]) !== keys) {
      return [
        { name: `a header line with ${clean(keysOf(lines[0]) || 'no keys', 60)}: ${clean(lines[0], 120)}`, line: 1, end: 1, top: true },
        { name: `${rows - 1} records, one a line, each with ${clean(keys, 160)}; the first: ${clean(lines[1], 160)}`, line: 2, end: lines.length, top: true },
      ];
    }
    return [{ name: `${rows} records, one a line${keys ? `, each with ${clean(keys, 160)}` : ''}; the first: ${clean(lines[0], 160)}`, line: 1, end: lines.length, top: true }];
  } else if (/\.json$/i.test(path)) {
    // The keys one level in, each on a line of its own (a file laid out by JSON.stringify(x, null, 2)).
    const first = lines.findIndex((l, i) => i > 0 && /^\s+"[^"]+"\s*:/.test(l));
    if (first >= 0) {
      const indent = /^(\s+)/.exec(lines[first])[1];
      const key = new RegExp(`^${indent}"([^"]+)"\\s*:\\s*(.?)`);
      lines.forEach((l, i) => {
        const m = key.exec(l);
        if (m) found.push({ name: `"${m[1]}"${m[2] === '[' ? ' (a list)' : m[2] === '{' ? ' (an object)' : `: ${clean(l.split(':').slice(1).join(':'), 50)}`}`, line: i + 1 });
      });
    }
  }
  // A section or tab whose heading follows at once: one part, named by both.
  for (let k = found.length - 2; k >= 0; k--) {
    if (/^(section|article|main|nav|aside|div) #/.test(found[k].name) && found[k + 1].line - found[k].line <= 3 && /^h[1-3] /.test(found[k + 1].name)) {
      found[k + 1] = { ...found[k + 1], name: `${found[k].name.split(' ')[1]} · ${found[k + 1].name}`, line: found[k].line };
      found.splice(k, 1);
    }
  }
  if (found.length < 2) return [];
  return found.map((p, k) => ({ ...p, top: true, end: (found[k + 1]?.line ?? lines.length + 1) - 1 }));
}

// What a JSON file holds, in one line: its keys, and for a list its length and the keys of its
// items ("projections: a list of 437, each with id, name, ticker…, one a line from line 2").
export function jsonShape(text) {
  let v;
  // Up to 50 MB (an export's projections.json is 22 MB, ~0.1 s to read).
  try { if (text.length > 5e7) return ''; v = JSON.parse(text); } catch { return ''; }
  const item = (x) => (Array.isArray(x) ? `a list of ${x.length}${x[0] && typeof x[0] === 'object' && !Array.isArray(x[0]) ? `, each with ${Object.keys(x[0]).slice(0, 14).join(', ')}${Object.keys(x[0]).length > 14 ? '…' : ''}` : ''}` : x && typeof x === 'object' ? `an object with ${Object.keys(x).slice(0, 10).join(', ')}${Object.keys(x).length > 10 ? '…' : ''}` : clean(JSON.stringify(x), 40));
  if (Array.isArray(v)) return `It is ${item(v)}.`;
  if (!v || typeof v !== 'object') return '';
  const keys = Object.keys(v).slice(0, 12).map((k) => {
    const x = v[k];
    // Where its first item starts: its first key's first place after the list's own key.
    const k0 = Array.isArray(x) && x.length >= 10 && x[1] && typeof x[1] === 'object' ? Object.keys(x[1])[0] : null;
    const from = k0 ? text.indexOf(`"${k}"`) : -1;
    const first = from >= 0 ? text.indexOf(`"${k0}"`, from) : -1;
    const at = first > 0 ? text.slice(0, first).split('\n').length : 0;
    const oneALine = at > 0 && text.split('\n').length - at + 1 >= x.length;
    return `${k}: ${item(x)}${at > 0 ? ` (the first at line ${at}${oneALine ? ', one a line' : ''})` : ''}`;
  });
  return `It holds ${keys.join('; ')}${Object.keys(v).length > 12 ? '; …' : ''}.`;
}

// What a table's rows hold, worked out from all of them (CSV, TSV, NDJSON; 4 Oct 2026): the time
// column's range, its usual step and longest gaps, the rows in each day, month or year, and each
// number column's range and median, with how many rows sit under a tenth of the median. Why: a
// year of hourly bars whose first row (the outline's "the first:") had traded one contract; the
// file was thin and full of day-long gaps until mid-2026, which nothing in the outline said, and
// a "2-hour" test ran across those gaps. '' when it has nothing to say.
const TIME_COL = /^(ts|t|time|timestamp|date|datetime|created_at|time_utc|day)$/i;
const ISO = /^\d{4}-\d{2}-\d{2}/;
const num = (x) => (typeof x === 'number' ? x : String(x ?? '').trim() === '' ? NaN : Number(String(x).trim().replace(/^"|"$/g, '')));
const nice = (x) => (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('en-US') : String(Number(x.toPrecision(6))));
const dur = (ms) => { const m = ms / 60000; return m < 1 ? `${Math.round(ms / 1000)}s` : m < 60 ? `${Math.round(m)}m` : m < 1440 * 2 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
export function tableProfile(text, path) {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 3 || lines.length > 300_000) return '';
  let cols, rows;
  if (/\.(ndjson|jsonl)$/i.test(path)) {
    const keys = recordKeys(lines);
    const recs = [];
    for (const l of lines) { try { const o = JSON.parse(l); if (o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).join(', ') === keys) recs.push(o); } catch {} }
    if (recs.length < 2) return '';
    cols = Object.keys(recs[0]).slice(0, 30);
    rows = recs.map((o) => cols.map((c) => o[c]));
  } else if (/\.(csv|tsv)$/i.test(path)) {
    const sep = /\.tsv$/i.test(path) ? '\t' : ',';
    cols = lines[0].split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    rows = lines.slice(1).map((l) => l.split(sep));
  } else return '';
  const out = [];
  // The time column: by its name, else the first column whose first value is a date.
  const raw0 = (i) => (typeof rows[0][i] === 'string' ? rows[0][i].trim().replace(/^"|"$/g, '') : rows[0][i]);
  let ti = cols.findIndex((c) => TIME_COL.test(c));
  if (ti < 0) ti = cols.findIndex((_, i) => ISO.test(String(raw0(i) ?? '')));
  const timeOf = (v) => {
    const s = typeof v === 'string' ? v.trim().replace(/^"|"$/g, '') : v;
    if (typeof s === 'string' && ISO.test(s)) return Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s);
    const n = num(s);
    return n > 1e12 && n < 1e14 ? n : n > 1e9 && n < 1e11 ? n * 1000 : NaN;
  };
  if (ti >= 0) {
    const pts = rows.map((r) => ({ ms: timeOf(r[ti]), raw: r[ti] })).filter((p) => Number.isFinite(p.ms));
    if (pts.length >= 2) {
      const ordered = pts.every((p, i) => i === 0 || p.ms >= pts[i - 1].ms);
      if (!ordered) pts.sort((a, b) => a.ms - b.ms);
      const iso = (p) => (typeof p.raw === 'string' && ISO.test(p.raw.trim()) ? p.raw.trim().replace(/^"|"$/g, '') : new Date(p.ms).toISOString());
      const at = (p) => iso(p).replace('T', ' ').slice(0, 16);
      const steps = pts.slice(1).map((p, i) => ({ d: p.ms - pts[i].ms, after: pts[i] })).filter((s) => s.d > 0);
      const sorted = steps.map((s) => s.d).sort((a, b) => a - b);
      const usual = sorted[Math.floor(sorted.length / 2)] ?? 0;
      const share = usual ? Math.round((steps.filter((s) => Math.abs(s.d - usual) <= usual * 0.01).length / steps.length) * 100) : 0;
      const gaps = usual ? steps.filter((s) => s.d > usual * 3).sort((a, b) => b.d - a.d).slice(0, 2) : [];
      out.push(`${cols[ti]}: ${at(pts[0])} → ${at(pts.at(-1))}${ordered ? '' : ' (not in time order)'}${usual ? `; usual step ${dur(usual)} (${share}% of steps)` : ''}${gaps.length ? `; longest gaps ${gaps.map((g) => `${dur(g.d)} after ${at(g.after)}`).join(', ')}` : ''}`);
      const span = pts.at(-1).ms - pts[0].ms;
      const [cut, per] = span <= 16 * 86_400_000 ? [10, 'day'] : span <= 16 * 31 * 86_400_000 ? [7, 'month'] : [4, 'year'];
      const by = new Map();
      for (const p of pts) { const k = iso(p).slice(0, cut); by.set(k, (by.get(k) ?? 0) + 1); }
      if (by.size > 1 && by.size <= 17) out.push(`rows by ${per}: ${[...by].map(([k, n]) => `${k} ${n.toLocaleString('en-US')}`).join(' · ')}`);
    }
  }
  // The number columns: range and median; a column that is never negative also says how many rows
  // sit under a tenth of its median (a thin stretch: volume 1 where the median is thousands).
  const said = [];
  for (let i = 0; i < cols.length && said.length < 8; i++) {
    if (i === ti) continue;
    const vals = rows.map((r) => num(r[i])).filter(Number.isFinite);
    if (vals.length < rows.length * 0.9) continue;
    vals.sort((a, b) => a - b);
    const med = vals[Math.floor(vals.length / 2)];
    const thin = vals[0] >= 0 && med > 0 ? vals.filter((v) => v < med / 10).length / vals.length : 0;
    said.push(`${cols[i]} ${nice(vals[0])} … ${nice(vals.at(-1))} (median ${nice(med)}${thin >= 0.1 ? `; ${Math.round(thin * 100)}% of rows under a tenth of it` : ''})`);
  }
  if (said.length) out.push(said.join(' · '));
  if (!out.length) return '';
  return `What the rows hold (worked out from all ${rows.length.toLocaleString('en-US')}):\n${out.map((l) => `  ${l}`).join('\n')}`;
}

export function outlineText(text, path, { max = 80 } = {}) {
  const shape = /\.json$/i.test(path) ? jsonShape(text) : '';
  if (shape) return `${path} is ${text.split('\n').length} lines, too long to show at once. ${shape}\n${outlineText(text, `${path}\u0000`, { max }).split('\n').slice(1).join('\n')}`.replace(/\u0000/g, '');
  const docs = docParts(text, path);
  const parts = docs.length ? docs : outline(text, path);
  const total = text.split('\n').length;
  const width = String(total).length;
  const rows = parts.slice(0, max).map((p) => `  ${`${p.line}-${p.end}`.padEnd(width * 2 + 2)} ${p.top ? '' : '  '}${p.name ?? `lines ${p.line}-${p.end}`}`);
  const more = parts.length > max ? `\n  … and ${parts.length - max} more parts` : '';
  const big = parts.filter((p) => p.top).sort((a, b) => (b.end - b.line) - (a.end - a.line))[0];
  // A long page or stylesheet has no functions to list: blocks of 60 lines say
  // nothing (a 27,000-line page gave 450 of them), so only the way in is given.
  if (parts.length > 12 && parts.every((p) => !p.name)) return `${path} is ${total} lines, too long to show at once, and it has no functions to list. Read only the part you need: Read again with find (a word or a name, such as an id or a class) to see the lines around it, or with offset (first line) and limit (number of lines).`;
  const profile = /\.(csv|tsv|ndjson|jsonl)$/i.test(path) ? tableProfile(text, path) : '';
  return `${path} is ${total} lines, too long to show at once. Its parts (lines, name):\n${rows.join('\n')}${more}${profile ? `\n${profile}` : ''}\nRead only the part you need: Read again with find (a word or a name) to see the lines around it, or with offset (first line) and limit (number of lines)${big ? `, e.g. offset ${big.line} and limit ${Math.min(200, big.end - big.line + 1)} for ${big.name ?? 'the largest part'}` : ''}.`;
}
