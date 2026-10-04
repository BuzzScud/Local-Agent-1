// The code map of a project (3 Oct 2026, the owner's picks): docs/map/ in the project, a ladder
// (agent/ladder.mjs) a model reads from the top down.
//   MAP.md         one line per top folder: what it holds, and the part that lists it
//   <part>.md      every folder under it with a plain line, its main files with a line each, the
//                  rest of its files by name; a part over 2,000 tokens hands its big folders to parts
//                  of their own (desks.md → desks--ladder.md)
// The lines are written by a model from a card per folder (its files' paths, names, opening
// comments and first lines; terminal/scripts/codemap.mjs), else made from the code itself (codeLine),
// and kept per file's content (labels.json under ~/.agentic-coder/maps), so after a change only the
// changed files are written again. A line checked against the code by hand ends in ✓.
// Repo-relative paths only: checkMap fails on a home folder's path, an account, a server's address,
// a path that is not in the project, or a part over 2,000 tokens.
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { userInfo } from 'node:os';
import { spawnSync } from 'node:child_process';
import { skipName, byPath } from './fs.mjs';
import { outline } from './outline.mjs';
import { CODE_FILE, SET_ASIDE } from './repomap.mjs';
import { HOME } from '../../../models/index.mjs';
import { holdsSecret } from '../agent/claude-notes.mjs';
import { splitPart, PART_CHARS, MAP_FILE } from '../agent/ladder.mjs';

export const MAP_DIR = join('docs', 'map');
export const FILES_PER_FOLDER = 5; // labelled; the others are named
const LABELLED = new RegExp(`${CODE_FILE.source.replace(/\)\$$/, '|md|sh|sql)$')}`, 'i');
const SECRET_FILE = /(^|\/)(\.env(\..*)?|.*secret.*|.*credential.*|.*\.(pem|key|p12|crt))$/i;
const ENTRY = /^(index|main|server|app|router|routes?|cli|README|AGENTS)\.[\w.]+$/i;

const git = (cwd, args) => {
  const r = spawnSync('git', ['-c', 'core.quotepath=off', ...args], { cwd, encoding: 'utf8', maxBuffer: 64e6, timeout: 15000 });
  return r.status === 0 ? r.stdout : null;
};

// Every file of the project worth a map: git's list in a repo (tracked and new, never ignored),
// else the folder walked; hidden and bulky folders left out.
export function projectFiles(root) {
  const listed = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  // The map itself is not mapped.
  const keep = (rel) => !rel.split('/').some(skipName) && !rel.startsWith(`${MAP_DIR}/`);
  if (listed !== null) return [...new Set(listed.split('\0').filter(Boolean))].filter(keep).filter((rel) => existsSync(join(root, rel))).sort(byPath);
  const out = [];
  const walk = (dir, rel, depth) => {
    if (depth > 12 || out.length > 40000) return;
    let list = [];
    try { list = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (skipName(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), r, depth + 1);
      else if (e.isFile()) out.push(r);
    }
  };
  walk(root, '', 0);
  return out.sort(byPath);
}

// How much each file was worked on lately (git: commits, the newer the more), else its time on disk.
function worked(root, files) {
  const log = git(root, ['log', '--no-renames', '--format=%x00', '--name-only', '-n', '1000']);
  const score = new Map();
  if (log !== null) {
    let i = 0;
    for (const line of log.split('\n')) {
      if (line.startsWith('\0')) i++;
      else if (line) score.set(line, (score.get(line) ?? 0) + 0.5 ** (i / 100));
    }
    return (rel) => score.get(rel) ?? 0;
  }
  return (rel) => { try { return statSync(join(root, rel)).mtimeMs / 1e12; } catch { return 0; } };
}

// The project as folders: { rel, dirs, files: [rel], picked: [rel] }. picked: the files labelled,
// at most FILES_PER_FOLDER, entry files first, then the most worked on, then the longest.
export function mapTree(root) {
  const files = projectFiles(root);
  const score = worked(root, files);
  const nodes = new Map([['', { rel: '', dirs: [], files: [] }]]);
  const nodeOf = (rel) => {
    if (nodes.has(rel)) return nodes.get(rel);
    const n = { rel, dirs: [], files: [] };
    nodes.set(rel, n);
    nodeOf(rel.includes('/') ? dirname(rel) : '').dirs.push(n);
    return n;
  };
  for (const f of files) nodeOf(f.includes('/') ? dirname(f) : '').files.push(f);
  for (const n of nodes.values()) {
    n.dirs.sort((a, b) => byPath(a.rel, b.rel));
    const aside = SET_ASIDE.test(`${n.rel}/`);
    const can = n.files.filter((f) => LABELLED.test(f) && !SECRET_FILE.test(f));
    n.picked = aside ? [] : can.map((f) => ({ f, s: (ENTRY.test(basename(f)) ? 10 : 0) + score(f), size: sizeOf(join(root, f)) }))
      .sort((a, b) => b.s - a.s || b.size - a.size).slice(0, FILES_PER_FOLDER).map((x) => x.f).sort(byPath);
    n.aside = aside;
  }
  return { root, nodes, top: nodes.get(''), files };
}
const sizeOf = (p) => { try { return statSync(p).size; } catch { return 0; } };

// What a file is, for the model that writes its line and for codeLine: its lines, the names it
// defines, its opening comment and its first lines. A line that holds a secret is never put in.
export function fileCard(root, rel) {
  let text = '';
  try { text = readFileSync(join(root, rel), 'utf8'); } catch { return { rel, lines: 0, names: [], opening: '', start: '', hash: '' }; }
  const hash = createHash('sha1').update(text).digest('hex').slice(0, 16);
  if (text.includes('\u0000')) return { rel, lines: 0, names: [], opening: '', start: '', hash };
  const lines = text.split('\n');
  const clean = (ls) => ls.filter((l) => !holdsSecret(l));
  let names = [];
  try { names = outline(text, rel).filter((p) => p.top && p.name && p.name !== 'imports and setup').map((p) => p.name).slice(0, 25); } catch {}
  const opening = [];
  if (/\.md$/i.test(rel)) {
    for (const l of lines.slice(0, 30)) { if (l.trim()) opening.push(l); if (opening.join(' ').length > 500) break; }
  } else {
    let i = 0;
    while (i < lines.length && (!lines[i].trim() || /^#!/.test(lines[i]) || /^['"]use (strict|client|server)/.test(lines[i].trim()))) i++;
    for (; i < Math.min(lines.length, 40); i++) {
      const l = lines[i].trim();
      if (/^(\/\/|#(?!include)|\*|\/\*|"""|'''|--|<!--)/.test(l) || (opening.length && /^\*\/|^"""|^'''/.test(l))) { opening.push(l.replace(/^(\/\/+|#+|\/\*+|\*+\/?|"""|'''|--|<!--)\s?/, '')); continue; }
      break;
    }
  }
  const start = clean(lines.filter((l) => l.trim() && !/^\s*(import |from |require\(|const \w+ = require)/.test(l)).slice(0, 14)).join('\n').slice(0, 700);
  return { rel, lines: lines.length, names, opening: clean(opening).join(' ').replace(/\s+/g, ' ').trim().slice(0, 600), start, hash };
}

// A folder's card: its files by name, its folders, the first lines of its README.
export function folderCard(root, node, labels = new Map()) {
  const readme = node.files.find((f) => /^readme\.md$/i.test(basename(f)));
  let about = '';
  if (readme) { try { about = readFileSync(join(root, readme), 'utf8').split('\n').filter((l) => l.trim() && !holdsSecret(l)).slice(0, 6).join(' ').slice(0, 400); } catch {} }
  const sub = node.dirs.map((d) => `${basename(d.rel)}/${labels.get(d.rel) ? ` (${labels.get(d.rel)})` : ''}`);
  const names = node.files.map((f) => basename(f));
  return { rel: node.rel || '.', files: names.slice(0, 40), more: Math.max(0, names.length - 40), dirs: sub.slice(0, 25), moreDirs: Math.max(0, sub.length - 25), about };
}

// A line from the code alone, when no model wrote one: the first sentence of the opening comment,
// else the names it defines, else its kind.
export function codeLine(card) {
  const first = card.opening.split(/(?<=[.!?])\s/)[0]?.replace(/^[#>*\s-]+/, '').trim();
  if (first && first.length >= 12) return first.length > 160 ? `${first.slice(0, 159)}…` : first;
  if (card.names?.length) return `defines ${card.names.slice(0, 6).join(', ')}${card.names.length > 6 ? ', …' : ''}`;
  return `${card.lines} lines`;
}
export function folderCodeLine(card) {
  if (card.about) { const s = card.about.replace(/^#+\s*/, '').split(/(?<=[.!?])\s/)[0].trim(); if (s.length >= 12) return s.slice(0, 160); }
  const parts = [];
  if (card.dirs.length) parts.push(`${card.dirs.length + card.moreDirs} folders: ${card.dirs.slice(0, 6).map((d) => d.replace(/ \(.*$/, '')).join(', ')}${card.dirs.length > 6 ? ', …' : ''}`);
  if (card.files.length) parts.push(`${card.files.length + card.more} files`);
  return parts.join('; ') || 'empty';
}

// The labels kept per project: { "f:<rel>": { h, line, by }, "d:<rel>": { h, line, by } }. by: the
// model that wrote it, 'code', or 'checked' (by hand against the code; kept while the file is the same).
export const labelsFile = (root, home = HOME) => join(home, 'maps', `labels-${createHash('sha1').update(root).digest('hex').slice(0, 16)}.json`);
export function loadLabels(root, home) { try { return JSON.parse(readFileSync(labelsFile(root, home), 'utf8')); } catch { return {}; } }
export function saveLabels(root, labels, home) { const f = labelsFile(root, home); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(labels, null, 1)); }
export const folderHash = (card) => createHash('sha1').update(JSON.stringify({ f: card.files, d: card.dirs.map((d) => d.replace(/ \(.*$/, '')), a: card.about })).digest('hex').slice(0, 16);

// The line kept for a file or folder, if it is still for the same content.
export function lineFor(labels, key, h) {
  const l = labels[key];
  return l && l.h === h && l.line ? l : null;
}

// docs/map/ written from the tree and the labels. → [{ file, chars }]
// A docs/map/ the map did not make (no MAP.md that starts "# Code map") is the project's own: never
// touched. Of its own, only the .md files are replaced; anything else in the folder stays.
export const ownMap = (dir) => !existsSync(dir) || readdirSync(dir).length === 0 || (() => { try { return readFileSync(join(dir, MAP_FILE), 'utf8').startsWith('# Code map'); } catch { return false; } })();
export function writeMap(root, tree, labels, { name = basename(root), when = new Date() } = {}) {
  const dir = join(root, MAP_DIR);
  if (!ownMap(dir)) throw new Error(`${MAP_DIR} in this project is not a code map this made: left as it is`);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith('.md')) rmSync(join(dir, f), { force: true });
  const cards = new Map();
  const card = (rel) => { if (!cards.has(rel)) cards.set(rel, fileCard(root, rel)); return cards.get(rel); };
  const mark = (l) => (l?.by === 'checked' ? ' ✓' : '');
  const fileLineOf = (rel) => {
    const c = card(rel);
    const l = lineFor(labels, `f:${rel}`, c.hash);
    return `${rel} (${c.lines}) — ${clean(l?.line ?? codeLine(c))}${mark(l)}`;
  };
  const dirLabel = (n) => {
    const c = folderCard(root, n);
    const l = lineFor(labels, `d:${n.rel}`, folderHash(c));
    return `${clean(l?.line ?? folderCodeLine(c))}${mark(l)}`;
  };
  const filesOf = (n, pad) => {
    const out = n.picked.map((f) => `${pad}- ${fileLineOf(f)}`);
    const rest = n.files.filter((f) => !n.picked.includes(f)).map((f) => basename(f));
    if (rest.length) out.push(`${pad}- also: ${cut(rest.join(', '), 300)}${rest.length > 20 ? ` (${rest.length} files)` : ''}`);
    return out;
  };
  const subtree = (n, pad = '') => [`${pad}- ${n.rel}/ — ${dirLabel(n)}`, ...(n.aside ? [] : filesOf(n, `${pad}  `)), ...(n.aside ? [] : n.dirs.flatMap((d) => subtree(d, pad)))];
  const size = (ls) => ls.reduce((s, l) => s + l.length + 1, 0);
  const written = [];
  const write = (file, text) => { writeFileSync(join(dir, file), text); written.push({ file, chars: text.length }); };
  const intro = (n) => `Every folder under ${n.rel}/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.`;
  const part = (n, pname) => {
    const lines = subtree(n);
    if (size(lines) <= PART_CHARS - 600) { write(`${pname}.md`, `# ${n.rel}/ — ${dirLabel(n)}\n\n${intro(n)}\n\n${lines.join('\n')}\n`); return; }
    const own = [`- ${n.rel}/ — ${dirLabel(n)}`, ...filesOf(n, '  ')];
    for (const d of n.dirs) {
      const sub = subtree(d);
      if (d.aside || size(sub) <= 1200) own.push(...sub);
      else { const child = `${pname}--${basename(d.rel).replace(/[^\w.-]+/g, '-')}`; own.push(`- ${d.rel}/ — ${dirLabel(d)} → ${child}.md`); part(d, child); }
    }
    for (const f of splitPart(pname, `${n.rel}/ — ${dirLabel(n)}`, `${intro(n)} A folder with an arrow has a part of its own.`, own)) write(f.file, f.text);
  };
  const top = tree.top;
  const mapLines = [];
  for (const d of top.dirs) {
    const pname = basename(d.rel).replace(/[^\w.-]+/g, '-');
    mapLines.push(`- ${d.rel}/ — ${dirLabel(d)} → ${pname}.md`);
    part(d, pname);
  }
  if (top.files.length) {
    const lines = filesOf(top, '');
    for (const f of splitPart('top', 'The files at the top of the project', 'Its main files with a line each, the rest by name.', lines)) write(f.file, f.text);
    mapLines.push(`- the files at the top (${cut(top.picked.map((f) => basename(f)).join(', '), 120)}) → top.md`);
  }
  const head = `# Code map · ${name}\n\nOne line per top folder: what it holds, then the part that lists every folder in it with its main files. Open a part with Map {"part": "<name>"} or Read docs/map/<name>.md, then the file itself. Made by \`bun run codemap\` on ${when.toISOString().slice(0, 10)}; a line can be out of date, the code is right. A line ending in ✓ was checked by hand against the code.\n\n`;
  write(MAP_FILE, `${head}${mapLines.join('\n')}\n`);
  return written;
}
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// One line, and never a home folder's path (written as ~).
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/(?<![\w.~-])\/(Users|home)\/[\w.-]+/g, '~').replace(/\s*[—–]\s*$/, '').trim();

// Problems with a project's docs/map: a path that is not in the project, a part over 2,000 tokens, a
// part MAP.md names that is missing, a home folder's path, this Mac's account name, an address or an
// e-mail. [] when right.
const HOME_PATH = /(?<![\w.~-])\/(Users|home)\/[\w.-]+/;
const ADDRESS = /\b(?!127\.0\.0\.1\b|0\.0\.0\.0\b)\d{1,3}(?:\.\d{1,3}){3}\b(?!\.\d)|\b[\w.+-]+@[a-z][\w-]*\.[a-z]{2,}\b/i;
export function checkMap(root) {
  const dir = join(root, MAP_DIR);
  if (!existsSync(join(dir, MAP_FILE))) return ['no docs/map/MAP.md'];
  const problems = [];
  const me = (() => { try { return userInfo().username.toLowerCase(); } catch { return ''; } })();
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    if (text.length > PART_CHARS) problems.push(`${f} is ${text.length} characters, over the ${PART_CHARS} of a part`);
    if (HOME_PATH.test(text)) problems.push(`${f} names a home folder's path`);
    if (me.length >= 4 && text.toLowerCase().includes(me)) problems.push(`${f} names this Mac's account`);
    if (ADDRESS.test(text)) problems.push(`${f} names an address (${ADDRESS.exec(text)[0]})`);
    for (const m of text.matchAll(/^\s*- ((?:[\w@.+-]+\/)*[\w@.+-]+\/?)(?= \(\d+\) — | — )/gm)) {
      const p = m[1].replace(/\/$/, '');
      if (p && !existsSync(join(root, p))) problems.push(`${f}: ${p} is not in the project`);
    }
    for (const m of text.matchAll(/→ ([\w.-]+\.md)\s*$/gm)) if (!files.includes(m[1])) problems.push(`${f}: names ${m[1]}, which is missing`);
  }
  return problems;
}

// The model's instructions and request for one folder (terminal/scripts/codemap.mjs sends them).
export const LABEL_SYSTEM = `You write the lines of a code map: one plain line for a folder and for each of its files, so someone who has never seen the project knows where things are. Each line: at most 20 words, everyday words, saying what it does or holds and naming the main thing in it (a page, a route, a job, a command, a test). Do not repeat the file's name. Say only what the card shows; when the card says little, say little. Answer with JSON only: {"folder": "<line>", "files": {"<path>": "<line>"}}, with a line for each file shown as FILE and no others.`;
export function labelRequest(root, node, cards, childLabels) {
  const fc = folderCard(root, node, childLabels);
  const fileText = cards.map((c) => `FILE ${c.rel} (${c.lines} lines)\n${c.names.length ? `defines: ${c.names.slice(0, 20).join(', ')}\n` : ''}${c.opening ? `opening comment: ${c.opening}\n` : ''}${c.start ? `first lines:\n${c.start}\n` : ''}`).join('\n');
  return `FOLDER ${fc.rel}/\nits files: ${fc.files.join(', ')}${fc.more ? ` and ${fc.more} more` : ''}\n${fc.dirs.length ? `its folders: ${fc.dirs.join('; ')}${fc.moreDirs ? ` and ${fc.moreDirs} more` : ''}\n` : ''}${fc.about ? `its README begins: ${fc.about}\n` : ''}\n${fileText}`;
}
// The model's answer: the folder's line and each file's, or null when it is not that JSON.
// An answer cut off at its length (the model named more files than asked, 3 Oct 2026) keeps the
// pairs it finished.
export function parseLabels(text, rels) {
  const raw = String(text);
  const m = /\{[\s\S]*\}/.exec(raw);
  let j = null;
  if (m) { try { j = JSON.parse(m[0]); } catch { j = null; } }
  if (!j && /^\s*\{/.test(raw)) {
    const pairs = [...raw.matchAll(/"((?:[^"\\]|\\.)+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((x) => [x[1], x[2]]);
    const folder = pairs.find(([k]) => k === 'folder')?.[1];
    const files = Object.fromEntries(pairs.filter(([k]) => k !== 'folder'));
    if (folder || Object.keys(files).length) j = { folder, files };
  }
  if (!j) return null;
  const line = (s) => { const t = clean(String(s ?? '')).replace(/^["'`]|["'`]$/g, ''); return t && !holdsSecret(t) && t.length <= 240 ? t : null; };
  const files = {};
  for (const r of rels) { const v = j.files?.[r] ?? j.files?.[basename(r)]; if (line(v)) files[r] = line(v); }
  return { folder: line(j.folder), files };
}
