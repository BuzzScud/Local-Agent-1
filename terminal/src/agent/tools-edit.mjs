// Edit matching and the syntax checks after a change (tools.mjs). Moved from tools.mjs word for word.
import { extname, join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, rmSync } from 'node:fs';

// Edit matching: exact first; then line by line ignoring trailing spaces;
// then ignoring indentation (re-indenting the new text to match). Each
// fallback must still find exactly one place.
// How alike two lines are, 0..1 (edit distance on the trimmed text).
export function similarity(a, b) {
  a = a.trim(); b = b.trim();
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  if (Math.abs(a.length - b.length) > Math.max(a.length, b.length) * 0.3) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

// One line must be long (20+ characters) and 93% the same; several lines each
// 85% and 93% on average. "a + c" for "a + b" is a different line, not a typo.
export function fuzzyFind(fileLines, want) {
  const single = want.length === 1;
  if (single ? want[0].trim().length < 20 : !want.some((l) => l.trim().length >= 8)) return null;
  const min = single ? 0.93 : 0.85;
  const hits = [];
  for (let i = 0; i + want.length <= fileLines.length; i++) {
    let worst = 1;
    let sum = 0;
    for (let j = 0; j < want.length && worst >= min; j++) {
      const sim = !want[j].trim() && !fileLines[i + j].trim() ? 1 : similarity(fileLines[i + j], want[j]);
      worst = Math.min(worst, sim);
      sum += sim;
    }
    if (worst >= min && sum / want.length >= 0.93) hits.push({ at: i, worst });
  }
  return hits.length === 1 ? hits[0] : null;
}

// Where old_text starts, each time it appears: its place in the text and its line (from 1).
const startsOf = (text, needle) => {
  const out = [];
  let line = 1;
  let counted = 0;
  for (let at = text.indexOf(needle); at >= 0 && needle; at = text.indexOf(needle, at + needle.length)) {
    for (let k = text.indexOf('\n', counted); k >= 0 && k < at; k = text.indexOf('\n', k + 1)) line++;
    counted = at;
    out.push({ at, line });
  }
  return out;
};
// Of several places (each with its first line and how many lines it spans), the one Edit's line
// names: the place holding that line, else the one starting within 3 lines of it.
const placeAt = (places, line, span) => {
  if (!Number.isInteger(line) || line < 1) return null;
  return places.find((p) => line >= p.line && line < p.line + span) ?? places.find((p) => Math.abs(p.line - line) <= 3) ?? null;
};
// The file's own lines, numbered as Read shows them, for an error the model can act on without a Read
// (5 Oct 2026: in 40 runs on a service most failed Edits were a stale old_text, each followed by a Read).
const SHOWN_MAX = 30;
const shownLines = (fileLines, from, count) => fileLines.slice(from, from + Math.min(count, SHOWN_MAX))
  .map((l, k) => `${String(from + k + 1).padStart(5)}\t${l.length > 400 ? `${l.slice(0, 400)}…` : l}`).join('\n');

// line: when old_text appears more than once, the line the one meant starts on (from Read).
// at: the line (from 1) where the change starts, on a match.
export function findEdit(text, oldText, newText, { replaceAll = false, line = null } = {}) {
  const places = startsOf(text, oldText);
  const count = places.length;
  const span = oldText.replace(/\n$/, '').split('\n').length;
  if (count >= 1 && replaceAll) return { ok: true, after: text.split(oldText).join(newText), how: 'all', count, at: places[0].line };
  if (count === 1) return { ok: true, after: text.replace(oldText, () => newText), how: 'exact', at: places[0].line };
  if (count > 1) {
    const pick = placeAt(places, Number(line), span);
    if (pick) return { ok: true, after: text.slice(0, pick.at) + newText + text.slice(pick.at + oldText.length), how: 'line', at: pick.line };
    const lines = [...new Set(places.map((p) => p.line))].slice(0, 8).join(', ');
    return { ok: false, error: `old_text appears ${count} times (lines ${lines}).${line ? ` None of them is at line ${line}.` : ''} Pass line with the one you mean (the line it starts on), or include more surrounding lines so it matches once, or set replace_all to true to change all of them.` };
  }
  // The change is already there (the model is repeating an edit it made).
  if (newText.trim() && text.includes(newText.trim())) return { ok: false, error: 'This change is already in the file: new_text is there and old_text is gone. Do not repeat it; go on with the next step.' };
  const fileLines = text.split('\n');
  const want = oldText.replace(/\n$/, '').split('\n');
  for (const mode of ['trailing', 'indent']) {
    const norm = mode === 'trailing' ? (s) => s.trimEnd() : (s) => s.trim();
    const hits = [];
    for (let i = 0; i + want.length <= fileLines.length; i++) {
      let ok = true;
      for (let j = 0; j < want.length; j++) if (norm(fileLines[i + j]) !== norm(want[j])) { ok = false; break; }
      if (ok) hits.push(i);
    }
    const one = hits.length === 1 ? hits[0] : placeAt(hits.map((i) => ({ i, line: i + 1 })), Number(line), want.length)?.i;
    if (one !== undefined) {
      const i = one;
      let repl = newText.replace(/\n$/, '').split('\n');
      if (mode === 'indent') {
        const have = /^\s*/.exec(fileLines[i])[0];
        const gave = /^\s*/.exec(want[0])[0];
        repl = repl.map((l) => (l.startsWith(gave) ? have + l.slice(gave.length) : l));
      }
      const after = [...fileLines.slice(0, i), ...repl, ...fileLines.slice(i + want.length)].join('\n');
      return { ok: true, after, how: mode, at: i + 1 };
    }
    if (hits.length > 1) return { ok: false, error: `old_text matches ${hits.length} places (lines ${hits.slice(0, 8).map((i) => i + 1).join(', ')}); pass line with the one you mean, or include more surrounding lines so it matches once.` };
  }
  // Point at the closest line to help the model try again.
  // Near-copies: the model mistyped a character or two. Accept only one
  // clear place where every line is at least 85% the same, and put back the
  // real text of the lines it meant to keep (they carry the same typo).
  const fuzzy = fuzzyFind(fileLines, want);
  if (fuzzy) {
    const i = fuzzy.at;
    const real = fileLines.slice(i, i + want.length);
    const map = new Map(want.map((w, j) => [w, real[j]]));
    const repl = newText.replace(/\n$/, '').split('\n').map((l) => map.get(l) ?? l);
    const after = [...fileLines.slice(0, i), ...repl, ...fileLines.slice(i + want.length)].join('\n');
    return { ok: true, after, how: 'fuzzy', at: i + 1 };
  }
  // The line sharing the longest start with old_text's first line.
  const firstAt = Math.max(0, want.findIndex((l) => l.trim()));
  const first = (want[firstAt] ?? '').trim();
  let near = -1;
  let best = 0;
  fileLines.forEach((l, i) => {
    const t = l.trim();
    let n = 0;
    while (n < t.length && n < first.length && t[n] === first[n]) n++;
    if (n > best) { best = n; near = i; }
  });
  if (best < Math.min(8, Math.ceil(first.length * 0.5))) near = -1;
  if (near < 0) return { ok: false, error: 'old_text was not found in the file. Read the file again and copy old_text exactly (or Search for it, if it is in another file).' };
  // The place as the file has it now, so the next Edit can copy from it at once: from where old_text
  // would start, its length and a line more; and the first of its lines that is not the same.
  const from = Math.max(0, near - firstAt);
  let differs = from;
  while (differs - from < want.length && differs < fileLines.length && fileLines[differs].trim() === want[differs - from].trim()) differs++;
  const now = shownLines(fileLines, from, want.length + 1);
  return { ok: false, error: `old_text was not found in the file. The closest match is line ${near + 1}: "${fileLines[near].trim().slice(0, 120)}"; your old_text differs from line ${differs + 1} on. Those lines are now:\n${now}\nCopy old_text exactly from these lines (without the numbers) and send the Edit again.` };
}

// Small models copy Read's line numbers ("    12\t…") into what they write.
// When most lines carry one, take them off.
export function stripLineNumbers(text) {
  if (typeof text !== 'string' || !text) return { text, stripped: false };
  // Read's header line ("strings.mjs (9 lines):") copied along with the text.
  const header = /^[^\n]*\((?:\d+ lines?|lines \d+-\d+ of \d+[^)]*)\):[ \t]*\n/;
  if (header.test(text)) return { text: stripLineNumbers(text.replace(header, '')).text, stripped: true };
  // Numbers on lines of their own ("    1\ncode\n    2\n…"), rising: drop those lines.
  {
    const ls = text.split('\n');
    const bare = ls.map((l, i) => (/^\s*\d+\s*$/.test(l) ? i : -1)).filter((i) => i >= 0);
    const vals = bare.map((i) => Number(ls[i]));
    const rising = vals.every((v, k) => k === 0 || v === vals[k - 1] + 1);
    if (bare.length >= 3 && rising && vals[0] <= 1 + (vals.length > 50 ? 1000 : 50) && bare.length >= ls.filter((l) => l.trim()).length * 0.35) {
      const drop = new Set(bare);
      return { text: ls.filter((_, i) => !drop.has(i)).join('\n').replace(/^ {4}/gm, (m) => m), stripped: true };
    }
  }
  const lines = text.split('\n');
  const full = lines.filter((l) => l.trim());
  // "   12\tcode", "   12    code", or a numbered empty line "   12"
  const re = /^\s*(\d+)(?:\t| {2,}|$)/;
  const nums = full.map((l) => re.exec(l)).filter(Boolean).map((m) => Number(m[1]));
  // At least two numbered lines, one of them with content after the number
  // (a lone "8790" is a number, not a line from Read).
  const withContent = full.filter((l) => /^\s*\d+(?:\t| {2,})\S/.test(l)).length;
  if (nums.length < 2 || !withContent || nums.length < full.length * 0.6) return { text, stripped: false };
  // The numbers must run upward, as Read prints them; otherwise it is real content.
  let rising = 0;
  for (let i = 1; i < nums.length; i++) if (nums[i] > nums[i - 1]) rising++;
  if (nums.length > 2 && rising < (nums.length - 1) * 0.8) return { text, stripped: false };
  const strip = (l) => (re.test(l) ? l.replace(/^\s*\d+(?:\t| {4}| {2,3}|$)/, '') : l);
  return { text: lines.map(strip).join('\n'), stripped: true };
}

// Does this text still parse? JavaScript via `node --check`, JSON, Python.
// Returns the error, or null (also when the language or checker is unknown).
// more (the lsp helper, agent/helpers.mjs): also JSX and TypeScript (bun's
// parser) and the scripts inside a page.
export function syntaxError(path, text, { more = false } = {}) {
  const ext = extname(path).toLowerCase();
  if (ext === '.json') { try { JSON.parse(text); return null; } catch (e) { return e.message; } }
  if (more && ['.jsx', '.ts', '.tsx', '.mts', '.cts'].includes(ext)) return checkWith(bunBin(), ['build', '--no-bundle'], ext, text, { bun: true });
  if (more && (ext === '.html' || ext === '.htm')) return pageScriptError(text);
  const cmd = ['.js', '.mjs', '.cjs'].includes(ext) ? ['node', ['--check']] : ext === '.py' ? ['python3', ['-m', 'py_compile']] : null;
  if (!cmd) return null;
  return checkWith(cmd[0], cmd[1], ext, text);
}

// One checker run on a copy of the text. null when it parses, or when the
// checker is not on this Mac.
function checkWith(bin, args, ext, text, { bun = false } = {}) {
  const tmp = join(tmpdir(), `agentic-check-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  writeFileSync(tmp, text);
  const r = spawnSync(bin, [...args, tmp], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
  rmSync(tmp, { force: true });
  if (r.error || r.status === 0) return null;
  const out = `${r.stderr}${r.stdout}`;
  const line = new RegExp(`${tmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+)`).exec(out)?.[1];
  const msg = (bun ? out.split('\n').find((l) => /^error:/.test(l.trim()))?.trim().replace(/^error:\s*/, '') : out.split('\n').find((l) => /Error/.test(l))?.trim()) ?? 'syntax error';
  return line ? `${msg} (line ${line})` : msg;
}

// bun: the one that runs Agentic Coder (the app is built with it) or the usual place.
function bunBin() {
  if (/(^|\/)bun$/.test(process.execPath)) return process.execPath;
  const home = join(homedir(), '.bun', 'bin', 'bun');
  return existsSync(home) ? home : 'bun';
}

// A page's own scripts (not the ones it loads with src): the first that does
// not parse, with its line in the page.
export function pageScriptError(html) {
  let n = 0;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = m[1];
    const code = m[2];
    if (/\bsrc\s*=/.test(attrs) || !code.trim()) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase() ?? '';
    const at = html.slice(0, m.index + m[0].indexOf('>') + 1).split('\n').length - 1; // lines before the script's first line
    let err = null;
    if (/json/.test(type)) { try { JSON.parse(code); } catch (e) { err = e.message; } }
    else if (!type || /javascript|ecmascript|module/.test(type)) err = checkWith('node', ['--check'], type === 'module' ? '.mjs' : '.js', code);
    else continue;
    if (err) return err.replace(/\(line (\d+)\)$/, (_, l) => `(line ${at + Number(l)} of the page)`) + (/\(line/.test(err) ? '' : ` (in the script that starts on line ${at + 1} of the page)`);
    if (++n >= 8) break;
  }
  return null;
}
