// The files a command wrote (4 Oct 2026). Write and Edit are counted as they happen; a script that
// writes a page (with open(path, 'w') in Python) was not, so nothing checked the report page
// Qwen3.6 made on the Desktop, and the second look never knew of it. After a command that is not
// read-only, the files it names and the files at the top of the work folder and the Desktop are
// looked at: those changed since it started are the files it wrote.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, isAbsolute, basename } from 'node:path';

const SKIP = /(^|\/)(node_modules|\.git|\.agentic|__pycache__)(\/|$)/;
// Paths a command's words name: quoted ones (spaces and all), and bare words with a file's ending.
export function pathsNamed(command, { cwd, home }) {
  const text = String(command ?? '');
  const out = new Set();
  const add = (p) => {
    const s = String(p).trim();
    if (!s || s.length > 400 || /[*?$`]/.test(s)) return;
    const full = s === '~' || s.startsWith('~/') ? join(home, s.slice(1)) : isAbsolute(s) ? s : resolve(cwd, s);
    out.add(full);
  };
  for (const m of text.matchAll(/(['"])([^'"\n]{1,400})\1/g)) if (/\.[A-Za-z0-9]{1,6}$/.test(m[2]) && /[/.]/.test(m[2])) add(m[2]);
  const bare = text.replace(/(['"])[^'"\n]{1,400}\1/g, ' ');
  for (const m of bare.matchAll(/(?:^|[\s=(>])((?:~\/|\.{1,2}\/|\/)?[\w.@%+-]+(?:\/[\w.@%+-]+)*\.[A-Za-z0-9]{1,6})(?=$|[\s;)|&>])/gm)) add(m[1]);
  return [...out];
}

// The text that ties a file to a command: the command, what it printed, and the scripts it ran
// (python3 make_page.py: the script's own text, when it is a small code file).
const SCRIPT = /\.(py|m?js|cjs|ts|sh|zsh|bash|rb|pl|r|jl)$/i;
function ties(command, { cwd, home, said = '', ran = command }) {
  const texts = [String(command ?? ''), String(said ?? '')];
  for (const p of pathsNamed(ran, { cwd, home })) {
    if (!SCRIPT.test(p)) continue;
    try { if (statSync(p).size <= 200_000) texts.push(readFileSync(p, 'utf8')); } catch { /* not there */ }
  }
  const text = texts.join('\n');
  // Its name, or its name without the ending as a whole word (open(f"{name}.html") with name = 'report').
  return (abs) => {
    const name = basename(abs);
    const stem = name.replace(/\.[^.]+$/, '');
    return text.includes(name) || (stem.length >= 4 && new RegExp(`(?<![\\w-])${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(text));
  };
}

// The files changed at or after `since` (ms): the paths the command names, and the files at the
// top of each of `dirs`. [{ abs, bytes }], newest first, at most `max`.
// `shared`: the folders of `dirs` that other sessions and apps write to as well (the Desktop). A file
// found there counts only when the command, what it printed (`said`) or a script it ran (`ran`: the
// command as it ran, SCRIPTS/… made full) names it. 7 Oct 2026: a page another session wrote on the
// Desktop while a command ran was said to be the command's, and checked as one.
export function filesMade(command, { since, cwd, home, dirs = [], shared = [], said = '', ran = command, max = 8 }) {
  const seen = new Map();
  let tied = null;
  const look = (abs, mine = () => true) => {
    if (seen.has(abs) || SKIP.test(abs)) return;
    try {
      const st = statSync(abs);
      if (st.isFile() && st.mtimeMs >= since - 1000 && mine(abs)) seen.set(abs, { abs, bytes: st.size, at: st.mtimeMs });
    } catch { /* not there */ }
  };
  for (const p of pathsNamed(command, { cwd, home })) look(p);
  for (const d of new Set(dirs.filter(Boolean))) {
    let names = [];
    try { names = readdirSync(d); } catch { continue; }
    const mine = shared.includes(d) ? (abs) => (tied ??= ties(command, { cwd, home, said, ran }))(abs) : undefined;
    for (const n of names.slice(0, 2000)) if (!n.startsWith('.')) look(join(d, n), mine);
  }
  return [...seen.values()].sort((a, b) => b.at - a.at).slice(0, max);
}

const size = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${(b / 1e3).toFixed(1)} KB` : `${b} bytes`);
// "(This command wrote ~/Desktop/report.html (18.8 KB).)"
export function madeNote(files, said) {
  if (!files.length) return '';
  return `(This command wrote ${files.map((f) => `${said(f.abs)} (${size(f.bytes)})`).join(', ')}.)`;
}
