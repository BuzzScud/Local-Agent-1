// Long scripts as files (4 Oct 2026). A script typed into a command as a heredoc
// (python3 - <<'EOF' … EOF) of SCRIPT_LINES lines or more is also saved as a file, under the
// app's home (the owner's pick: your folders stay as they were), and the model reaches it as
// SCRIPTS/<n>-<name>.<ext>: it reads and edits it there like a file of the project, and runs it
// with `python3 SCRIPTS/…`, which the app maps to the real folder before the command runs.
//
// Why: on 4 Oct Qwen3.6 wrote a backtest and its report page as seven heredocs, 92,000
// characters in all; each fix of a one-word mistake sent the whole script again (13,000–22,000
// characters, two to three minutes each on the service), and a traceback's "line 279" of
// <stdin> was a line it could not look at. Now the command still runs as typed; the result
// names the file, says to Edit it, and shows the failing line of a traceback.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { HOME } from '../../../models/index.mjs';

const SCRIPT_LINES = 40;
const KEEP_DAYS = 7;
const RUN = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${process.pid}`;

// This window's folder of scripts (AGENTIC_SCRIPTS_DIR names another, for the tests).
export const scriptsDir = () => process.env.AGENTIC_SCRIPTS_DIR || join(HOME, 'scripts', RUN);
const within = (base, p) => { const r = relative(base, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

// A project with a SCRIPTS folder of its own keeps it: the name then means that folder.
const ownFolder = (cwd) => Boolean(cwd) && existsSync(join(cwd, 'SCRIPTS'));

// "SCRIPTS/…" → the file in the scripts folder; null when it is not such a path (or leaves it).
export function scriptsPathFor(p, cwd) {
  if (!(p === 'SCRIPTS' || String(p).startsWith('SCRIPTS/')) || ownFolder(cwd)) return null;
  const dir = scriptsDir();
  const abs = resolve(dir, String(p).slice('SCRIPTS'.length).replace(/^\//, ''));
  return within(dir, abs) ? { abs, rel: p } : null;
}

// A full path into the scripts folder, said as SCRIPTS/… (null when it is not in it).
export function inScripts(abs) {
  const dir = scriptsDir();
  return within(dir, abs) ? `SCRIPTS${abs === dir ? '' : `/${relative(dir, abs)}`}` : null;
}

// The script a command types in as a heredoc: { interp, body, ext } or null. Only a heredoc that
// feeds a language (python3 - <<'EOF', node <<EOF, bash <<EOF), not one that writes a file (cat > x <<EOF).
const HEREDOC = /^\s*(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*)?(python3?|node|bun|ruby|perl|bash|sh|zsh|Rscript)\b[^\n<|>]*<<-?\s*(['"]?)([A-Za-z_]\w*)\2[^\n]*\n([\s\S]*?)\n[ \t]*\3[ \t]*(?:\n|$)/;
export function heredocScript(command) {
  const m = HEREDOC.exec(String(command ?? ''));
  if (!m) return null;
  const interp = m[1];
  const body = m[4];
  const ext = /^python/.test(interp) ? 'py' : interp === 'node' || interp === 'bun' ? (/^\s*(import\s.+\sfrom\s|export\s)/m.test(body) ? 'mjs' : 'js') : interp === 'ruby' ? 'rb' : interp === 'perl' ? 'pl' : interp === 'Rscript' ? 'R' : 'sh';
  return { interp, body, ext };
}

// Folders of scripts older than KEEP_DAYS go when a new one is made.
function sweep(root) {
  try {
    for (const n of readdirSync(root)) {
      const p = join(root, n);
      if (p !== scriptsDir() && Date.now() - statSync(p).mtimeMs > KEEP_DAYS * 86_400_000) rmSync(p, { recursive: true, force: true });
    }
  } catch { /* none yet */ }
}

// A name for the script from its first function, else its first comment: "backtest", "build_report".
function slugOf(body) {
  const fn = /^\s*(?:def|function|async function|const)\s+([A-Za-z_]\w*)/m.exec(body)?.[1];
  const said = /^\s*(?:#|\/\/)\s*([A-Za-z][\w -]{2,40})/m.exec(body)?.[1];
  const s = String(fn ?? said ?? 'script').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  return s || 'script';
}

// Saves a long heredoc's script: { name: "SCRIPTS/3-backtest.py", abs, lines, interp, same }, or null
// (no heredoc, or a short one). The same script saved before is not saved again (same: true).
export function saveScript(command, cwd) {
  const s = heredocScript(command);
  if (!s || ownFolder(cwd)) return null;
  const lines = s.body.split('\n').length;
  if (lines < SCRIPT_LINES) return null;
  const dir = scriptsDir();
  let names = [];
  try { names = readdirSync(dir); } catch { mkdirSync(dir, { recursive: true }); sweep(join(dir, '..')); }
  for (const n of names) {
    try { if (readFileSync(join(dir, n), 'utf8') === s.body) return { name: `SCRIPTS/${n}`, abs: join(dir, n), lines, interp: s.interp, same: true }; } catch {}
  }
  const n = `${names.length + 1}-${slugOf(s.body)}.${s.ext}`;
  writeFileSync(join(dir, n), s.body);
  return { name: `SCRIPTS/${n}`, abs: join(dir, n), lines, interp: s.interp, same: false };
}

// Does a command use SCRIPTS/…? Then it gets the real folder, and its sandbox may read it.
const USES = /(^|[\s'"=(])SCRIPTS\//;
export const usesScripts = (command, cwd) => USES.test(String(command ?? '')) && !ownFolder(cwd);
export function commandWithScripts(command, cwd) {
  if (!usesScripts(command, cwd)) return command;
  return String(command).replace(/(^|[\s'"=(])SCRIPTS\//g, (_, b) => `${b}${scriptsDir()}/`);
}
// What a command printed, with the scripts folder said as SCRIPTS (a traceback names the file).
export const outputWithScripts = (text) => String(text ?? '').split(`${scriptsDir()}/`).join('SCRIPTS/');

// The place a failed script stopped: the last frame of a Python traceback (File "…", line N) or the
// first of a Node stack (file:N:M) that is in the script typed in (<stdin>, [stdin]), the scripts
// folder or the project, with the lines around it, numbered. '' when there is none.
export function failingLine(output, { body = null, saved = null, cwd = '' } = {}) {
  const text = String(output ?? '');
  const frames = [];
  for (const m of text.matchAll(/File "([^"]+)", line (\d+)/g)) frames.push({ file: m[1], line: Number(m[2]) });
  if (!frames.length) {
    const m = /(?:\(|\s|^)((?:\/|\[stdin\]|SCRIPTS\/)[^\s():]*):(\d+)(?::\d+)?/m.exec(text);
    if (m) frames.push({ file: m[1], line: Number(m[2]) });
  }
  for (const f of frames.reverse()) {
    let lines = null;
    let said = f.file;
    if (/^(<stdin>|\[stdin\]|-)$/.test(f.file) && body != null) { lines = body.split('\n'); said = saved ?? 'the script'; }
    else {
      const p = f.file.startsWith('SCRIPTS/') ? scriptsPathFor(f.file, cwd)?.abs : isAbsolute(f.file) ? f.file : join(cwd, f.file);
      if (!p || !(within(scriptsDir(), p) || (cwd && within(cwd, p)))) continue;
      try { lines = readFileSync(p, 'utf8').split('\n'); } catch { continue; }
      said = inScripts(p) ?? relative(cwd, p);
    }
    if (!lines || f.line < 1 || f.line > lines.length) continue;
    const from = Math.max(1, f.line - 2);
    const to = Math.min(lines.length, f.line + 2);
    const w = String(to).length;
    const shown = [];
    for (let i = from; i <= to; i++) shown.push(`${i === f.line ? '→' : ' '} ${String(i).padStart(w)} | ${lines[i - 1].slice(0, 200)}`);
    return `Line ${f.line} of ${said}, where it stopped:\n${shown.join('\n')}`;
  }
  return '';
}

// The line the result ends with for a saved script.
export function savedNote(s) {
  const run = `${/^python/.test(s.interp) ? 'python3' : s.interp} ${s.name}`;
  return s.same
    ? `(This is the script saved before as ${s.name}: to change it, Edit that file, then run \`${run}\`. Do not send the whole script again.)`
    : `(The script is saved as ${s.name}, ${s.lines} lines. To change it, Edit ${s.name}, then run \`${run}\`. Do not send the whole script again.)`;
}
