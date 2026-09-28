// "Explain this code": a question gets the code it is about read before the
// model's first step, with no model call and no search:
//   files it names          read whole, or (long) their parts and the lines
//                           that match the question (agent.mjs, prefetch)
//   names it uses           `paginate()`, fitContext, "the test command" for
//                           testCommand: the part of the file that defines
//                           each, found in the project map
//   a very small project    all of its code (three files, 200 lines at most)
// The model then answers from what is in front of it, and may still look
// further. Nothing is changed in a question turn (agent.mjs, runTool).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoMap, CODE_FILE } from '../tools/repomap.mjs';
import { outline } from '../tools/outline.mjs';
import { searchFiles } from '../tools/fs.mjs';
import { taskWords, isTestFile } from './localize.mjs';

const PART_MAX = 120; // lines of one definition shown
const PARTS = 3;
const SMALL = 12; // code files
// Everyday words: a name made only of these says nothing about the question.
const COMMON = new Set(['get', 'set', 'run', 'main', 'init', 'test', 'tests', 'file', 'files', 'data', 'list', 'name', 'value', 'values', 'default', 'function', 'project', 'code', 'line', 'lines', 'type', 'item', 'items', 'index', 'text', 'read', 'write', 'change', 'changes', 'command',
  'for', 'the', 'and', 'with', 'from', 'this', 'that', 'what', 'does', 'where', 'which', 'when', 'how', 'all', 'any', 'new', 'one', 'two', 'use', 'has', 'not', 'are', 'was', 'can', 'its', 'into', 'out', 'add', 'make', 'show', 'return', 'returns', 'is', 'to', 'of', 'in', 'on', 'it']);

// fitContext → [fit, context]; to_dict → [to, dict]; TOOL_DEFS → [tool, defs].
export const nameWords = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[\s_$]+/).filter(Boolean).map((w) => w.toLowerCase());

// "commands" for command, "sorted" for sort: the same word in another form.
const same = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) <= 3);
const asToken = (name) => new RegExp(`(^|[^\\w$])${name.replace(/[$]/g, '\\$')}(?=$|[^\\w$])`);

// How well a name from the project map fits the question:
//   10  the question uses the name itself
//    6  every word of the name, in a row ("the test command" for testCommand)
//    4  every word of the name, somewhere in the question
//    2  part of the name ("tax" for addTax): shown only beside nothing better
// A name of one word (check, read, sorted) is also an everyday word: it
// counts only when the question writes it as code (`read`, read()).
export function nameScore(name, question, words, written = namesIn(question)) {
  const parts = nameWords(name);
  if (written.includes(name) || (parts.length >= 2 && asToken(name).test(question))) return 10;
  if (parts.length < 2) return 0;
  const at = parts.map((p) => words.findIndex((w) => same(w, p)));
  const hit = parts.filter((_, k) => at[k] >= 0);
  if (hit.length === parts.length && at.every((i, k) => k === 0 || i === at[k - 1] + 1)) return 6;
  if (!hit.some((p) => p.length >= 3 && !COMMON.has(p))) return 0;
  return hit.length === parts.length ? 4 : 2;
}

// Names the question writes the way code does: fitContext, to_dict, paginate(), `x`.
export function namesIn(question) {
  const out = [];
  for (const m of question.matchAll(/`([A-Za-z_$][\w$.]*)(?:\(\))?`|\b([A-Za-z_$][\w$]*)\(\)|\b([a-z]+[A-Z][\w$]*)\b|\b([A-Za-z]\w*_\w+)\b/g)) out.push((m[1] ?? m[2] ?? m[3] ?? m[4]).split('.').pop());
  return [...new Set(out)];
}

// Copies of code that are not the project's own: practice projects, fixtures, old versions.
const ASIDE = /(^|\/)(tasks?|fixtures?|reference|archive|examples?|samples?|vendor|dist|build|backups?|older versions)\//i;

// The parts of the project a question is about: [{ rel, name, from, to,
// total, text, score }], the best first, at most three. Files in `skip` are
// already in front of the model.
export function partsFor(cwd, asked, { skip = [], max = PARTS } = {}) {
  let entries = [];
  try { entries = repoMap(cwd).entries.filter((e) => !skip.includes(e.rel) && !isTestFile(e.rel)); } catch { return []; }
  // "Don't change any files" is about the answer, not about the code.
  const question = asked.replace(/[^.?!\n]*\b(?:don'?t|do not|without|no)\s+(?:chang|edit|touch|modif)[^.?!\n]*[.?!]?/gi, ' ');
  const words = question.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? [];
  const written = namesIn(question);
  const place = (rel) => Math.min(2, taskWords(question, 24).filter((w) => rel.toLowerCase().includes(w)).length) * 0.5 - (ASIDE.test(rel) ? 3 : 0) - rel.split('/').length * 0.01;
  const found = [];
  for (const e of entries) {
    for (const name of e.names) {
      const score = nameScore(name, question, words, written);
      if (score) found.push({ rel: e.rel, name, score: score + place(e.rel) });
    }
  }
  // A name the question writes as code: where it is defined, anywhere in the
  // project (a method of a class is at the top of no file; a big project has
  // more files than the map holds).
  for (const name of written) {
    const n = name.replace(/[$]/g, '\\$');
    const r = searchFiles(cwd, { pattern: `(function|class|def|const|let|var)[ \t]+${n}\\b|^[ \t]*(static[ \t]+|async[ \t]+|get[ \t]+|set[ \t]+)*${n}[ \t]*\\(`, max: 40 });
    for (const line of r.lines ?? []) {
      const rel = line.split(':')[0];
      if (!CODE_FILE.test(rel) || skip.includes(rel) || isTestFile(rel) || found.some((f) => f.rel === rel && f.name === name)) continue;
      found.push({ rel, name, score: 10 + place(rel), inner: true });
    }
  }
  found.sort((a, b) => b.score - a.score);
  const texts = new Map();
  const textOf = (rel) => { if (!texts.has(rel)) { let t = ''; try { t = readFileSync(join(cwd, rel), 'utf8'); } catch {} texts.set(rel, t); } return texts.get(rel); };
  const out = [];
  for (const f of found) {
    if (out.length >= max) break;
    // One place for each name: the best one.
    if (out.some((o) => o.name === f.name)) continue;
    // A weak match is shown only beside nothing better, alone, and in a
    // project small enough that part of a name still points somewhere.
    if (f.score < 3 && (out.length || entries.length > SMALL)) break;
    const text = textOf(f.rel);
    const part = outline(text, f.rel).find((p) => p.name === f.name && (f.inner || p.top));
    if (!part) continue;
    const lines = text.replace(/\n$/, '').split('\n');
    const to = Math.min(part.end, part.line + PART_MAX - 1, lines.length);
    out.push({ rel: f.rel, name: f.name, score: Math.round(f.score * 100) / 100, from: part.line, to, total: lines.length, text: lines.slice(part.line - 1, to).join('\n') });
    if (f.score < 3) break;
  }
  return out;
}

// A very small project: all of its code, whole ([{ rel, from: 1, to, total,
// text }]), or [] when it is bigger than three files or 200 lines.
export function wholeSmallProject(cwd, { skip = [], files = 3, lines = 200 } = {}) {
  let entries = [];
  try { entries = repoMap(cwd).entries.filter((e) => !isTestFile(e.rel)); } catch { return []; }
  if (!entries.length || entries.length > files || entries.reduce((n, e) => n + e.lines, 0) > lines) return [];
  const out = [];
  for (const e of entries) {
    if (skip.includes(e.rel)) continue;
    let text;
    try { text = readFileSync(join(cwd, e.rel), 'utf8'); } catch { continue; }
    if (text.includes('\u0000')) continue;
    const n = text.replace(/\n$/, '').split('\n').length;
    out.push({ rel: e.rel, from: 1, to: n, total: n, text: text.replace(/\n$/, '') });
  }
  return out;
}
