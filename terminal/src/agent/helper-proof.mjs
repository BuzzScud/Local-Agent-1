// A helper's report, checked against the files before the conversation gets it (28 Oct 2026, the owner's picks
// after the Bonsai helpers check: "proof in the report" and "check the helper's claims"). Measured that day: after a
// 2B helper's report, 9B read the same files again itself (8 replies, about 70 s of 218), and in another run the 2B
// named a function that is nowhere in the project. No model here: the app reads the lines a report cites and looks
// for the names it gives. The lines say what the files hold, not that the helper picked the right ones: told to trust
// them ("no need to read them again"), 9B took 2B's wrong function three runs of three, so the block says neither.
//   checkReport(report, cwd) → { proof: ['helpers-panel.mjs:19  export const KEEP_DONE_MS = 6000;', …],
//                                 problems: ['`saveProfileWithModel` is not in the project', …] }
//   proofBlock(checked)        → the lines that go under the report, or ''
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.agentic', '__pycache__', '.venv', 'venv']);
const TEXT = /\.(m?[jt]sx?|cjs|mts|cts|py|json|md|sh|css|html?|sql|ya?ml|swift|go|rs|java|rb|php|vue|svelte|toml|txt)$/i;
// How much of a project is looked through for a name (a big project is looked at in part, and a name not met is
// then not called missing).
const MAX_FILES = 3000;
const MAX_BYTES = 400_000;
const MAX_PROOF = 8;
const LINE_CHARS = 160;

// path:line, "line 19 in a.mjs", "a.mjs, line 19", "a.mjs (line 19)"; the path as the report wrote it.
const FILE = String.raw`((?:[\w@.+-]+\/)*[\w@+-][\w@.+-]*\.(?:m?[jt]sx?|cjs|mts|cts|py|json|md|sh|css|html?|sql|ya?ml|swift|go|rs|java|rb|php|vue|svelte|toml|txt))`;
const CITES = [
  new RegExp(String.raw`${FILE}\x60?\s*:\s*(?:line\s*)?(\d{1,6})`, 'gi'),
  new RegExp(String.raw`\blines?\s+(\d{1,6})\s+(?:in|of)\s+\x60?${FILE}`, 'gi'),
  new RegExp(String.raw`${FILE}\x60?\s*[,(]\s*lines?\s+(\d{1,6})`, 'gi'),
];
export function citesOf(report) {
  const t = String(report ?? '');
  const out = [];
  const seen = new Set();
  for (const [i, re] of CITES.entries()) {
    for (const m of t.matchAll(re)) {
      const [path, line] = i === 1 ? [m[2], Number(m[1])] : [m[1], Number(m[2])];
      const k = `${path}:${line}`;
      if (!seen.has(k)) { seen.add(k); out.push({ path, line, at: m.index }); }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// The code names a report gives, at least 4 characters: anything in backticks or written as a call, and words shaped
// like code anywhere (camelCase, CONSTANT_CASE, snake_case). "the `helpersTo` function", "writeProfiles()",
// "KEEP_DONE_MS"; in "`export const KEEP_DONE_MS = 6000`" the name, not the keywords. Files and numbers are not names.
const WORDS = new Set(['true', 'false', 'null', 'undefined', 'this', 'that', 'then', 'line', 'lines', 'file', 'files', 'function', 'const', 'export', 'return', 'import', 'async', 'await', 'seconds', 'default', 'class', 'from', 'let', 'var', 'new']);
const CODEY = /^(?:[a-z][a-z0-9]*[A-Z][\w$]*|[A-Z][A-Z0-9]*_[A-Z0-9_]+|[a-z][a-z0-9]*_[a-z0-9_]+)$/;
export function namesOf(report) {
  const t = String(report ?? '').replace(new RegExp(FILE, 'gi'), ' ');
  const out = new Set();
  const add = (w, any) => { if (w.length >= 4 && !WORDS.has(w.toLowerCase()) && !/^\d/.test(w) && (any || CODEY.test(w))) out.add(w); };
  for (const m of t.matchAll(/`([^`\n]+)`/g)) {
    const words = m[1].match(/[A-Za-z_$][\w$]*/g) ?? [];
    if (words.length === 1) add(words[0], true); else for (const w of words) add(w, false);
  }
  for (const m of t.matchAll(/\b([A-Za-z_$][\w$]{3,})\(\)/g)) add(m[1], true);
  for (const m of t.replace(/`[^`\n]*`/g, ' ').matchAll(/[A-Za-z_$][\w$]*/g)) add(m[0], false);
  return [...out];
}

// The project's text files, at most MAX_FILES, the folder's own first.
function filesOf(cwd) {
  const out = [];
  const walk = (dir, depth) => {
    if (out.length >= MAX_FILES || depth > 12) return;
    let list;
    try { list = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    list.sort((a, b) => Number(a.isDirectory()) - Number(b.isDirectory()) || a.name.localeCompare(b.name));
    for (const e of list) {
      if (out.length >= MAX_FILES) return;
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, depth + 1); } else if (TEXT.test(e.name)) out.push(p);
    }
  };
  walk(cwd, 0);
  return { files: out, whole: out.length < MAX_FILES };
}
// A line that defines the name (function, class, const…, or name = / name: a function).
const defOf = (n) => { const e = n.replace(/\$/g, '\\$'); return new RegExp(String.raw`(?:function\*?|class|const|let|var|def|fn|func)\s+${e}\b|\b${e}\s*[:=]\s*(?:async\s*)?(?:function|\()`); };
const textOf = (abs) => { try { return statSync(abs).size > MAX_BYTES ? null : readFileSync(abs, 'utf8'); } catch { return null; } };
const inside = (cwd, abs) => abs === cwd || abs.startsWith(cwd.endsWith(sep) ? cwd : `${cwd}${sep}`);
const show = (s) => (s.length > LINE_CHARS ? `${s.slice(0, LINE_CHARS)}…` : s);

export function checkReport(report, cwd) {
  const root = resolve(cwd);
  let all = null;
  const project = () => (all ??= filesOf(root));
  // A cited path: as written from the folder, else the one file of that name in the project.
  const find = (path) => {
    const abs = resolve(root, path);
    if (inside(root, abs) && existsSync(abs)) return abs;
    const named = project().files.filter((f) => basename(f) === basename(path));
    return named.length === 1 ? named[0] : null;
  };
  const proof = [];
  const problems = [];
  const names = namesOf(report);
  const placed = new Set(); // names shown on a proof line
  for (const c of citesOf(report)) {
    if (proof.length >= MAX_PROOF) break;
    const abs = find(c.path);
    if (!abs) { problems.push(`${c.path} is not in the project`); continue; }
    const rel = relative(root, abs);
    const lines = (textOf(abs) ?? '').split('\n');
    // A name the report gives beside this cite: the line of the file it is really on, the nearest to the one cited
    // (a cite a line or forty off still shows the right line, and says what it was cited as).
    const around = String(report).slice(Math.max(0, c.at - 200), c.at + 200);
    const where = (n) => {
      const near = (test) => lines.map((l, i) => (test(l) ? i + 1 : 0)).filter(Boolean).sort((a, b) => Math.abs(a - c.line) - Math.abs(b - c.line))[0];
      const def = defOf(n);
      return near((l) => def.test(l)) ?? near((l) => l.includes(n));
    };
    const meant = names.find((n) => !placed.has(n) && around.includes(n) && where(n));
    if (c.line < 1 || (c.line > lines.length && !meant)) { problems.push(`${rel}:${c.line} is past the end (it has ${lines.length} lines)`); continue; }
    const at = meant ? where(meant) : c.line;
    if (meant) placed.add(meant);
    proof.push(`${rel}:${at}  ${show(lines[at - 1].trim())}${at !== c.line ? `  (cited as line ${c.line})` : ''}`);
  }
  // Every other name: where it is defined (or first used), or that it is nowhere in the project.
  for (const n of names) {
    if (placed.has(n) || proof.length >= MAX_PROOF) continue;
    const { files, whole } = project();
    let hit = null, first = null;
    const def = defOf(n);
    for (const f of files) {
      const t = textOf(f);
      if (!t || !t.includes(n)) continue;
      const ls = t.split('\n');
      const i = ls.findIndex((l) => def.test(l));
      if (i >= 0) { hit = { f, i }; break; }
      first ??= { f, i: ls.findIndex((l) => l.includes(n)) };
    }
    const found = hit ?? first;
    if (found) { placed.add(n); proof.push(`${relative(root, found.f)}:${found.i + 1}  ${show(readFileSync(found.f, 'utf8').split('\n')[found.i].trim())}`); } else if (whole) problems.push(`\`${n}\` is not in the project`);
  }
  return { proof, problems };
}

// What goes under the report for the conversation: the lines, read just now, and what could not be confirmed.
export function proofBlock({ proof, problems }) {
  const parts = [];
  if (proof.length) parts.push(`The lines it cites, read from the files by Agentic Coder just now:\n${proof.map((p) => `  ${p}`).join('\n')}`);
  if (problems.length) parts.push(`Not confirmed by the files: ${problems.join('; ')}.`);
  return parts.join('\n\n');
}

// Sent to the helper once when its report names what the files do not have.
export const recheckNote = (problems) => `Agentic Coder checked your report against the files: ${problems.join('; ')}. Look again with your tools and send the report again, with file:line for each thing you name.`;
