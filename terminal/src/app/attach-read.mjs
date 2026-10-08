// What the model gets for a dropped file that is not a picture or a PDF (8 Oct 2026, the owner's
// picks): text, code, CSV and JSON as numbered lines, as an @file comes; Word, RTF and web pages as
// their text (textutil); an Excel workbook's sheets as rows; a zip's and a folder's list of what is
// inside; anything else by name and size. A big one sends its first part and says where the rest
// is: the copy (or, for Word and Excel, its text saved beside the attachments), which the model may
// read with Read even outside the project (agent-pages.mjs attachedOpen).
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { HOME } from '../../../models/index.mjs';
import { readFile } from '../tools/read.mjs';
import { docText, fileKind, kindLabel, sheetsOf, walkFolder, wordCount, zipNames } from '../tools/office.mjs';
import { fmtBytes } from './attach.mjs';

// Lines of a text file that go with the message, as for an @file.
export const TEXT_LINES = 400;
// The most names a zip's or a folder's list gives.
const LIST_MAX = 400;
const tilde = (p) => (p && p.startsWith(`${homedir()}/`) ? `~${p.slice(homedir().length)}` : p);
const num = (n) => n.toLocaleString('en-US');
const plural = (n, w) => `${num(n)} ${w}${n === 1 ? '' : 's'}`;

// A workbook as text: each sheet under a line with its name and size, its rows as comma-separated cells.
export function sheetsText(file) {
  return sheetsOf(file).map((s) => `--- sheet "${s.name}": ${plural(s.rows.length, 'row')} × ${plural(s.cols, 'column')} ---\n${s.rows.join('\n')}`).join('\n\n');
}

// A folder's files as an indented list, a folder's name ending in /. Answers { text, files, more }.
export function folderList(dir, { max = LIST_MAX } = {}) {
  const w = walkFolder(dir);
  const lines = w.entries.slice(0, max).map((e) => {
    const depth = e.rel.split('/').length - 1;
    return `${'  '.repeat(depth)}${basename(e.rel)}${e.dir ? `/${e.skipped ? ' (not listed)' : ''}` : ` (${fmtBytes(e.bytes)})`}`;
  });
  const more = w.entries.length - lines.length;
  return { text: lines.join('\n') + (more > 0 || w.cut ? `\n… ${more > 0 ? `${num(more)} more` : 'and more'}` : ''), files: w.files, bytes: w.bytes, cut: w.cut };
}

// One file or folder for the model. file: the copy (or the folder itself); token: its chip; shown:
// what to call it (where it came from); maxChars: the most of its text that goes. Answers
// { label, text, reads: [paths the model may Read] }. Throws when it cannot be read at all.
export function fileForModel(file, { token, shown = null, maxChars = 30_000, textDir = join(HOME, 'attachments') } = {}) {
  const { kind, sub } = fileKind(file);
  const at = shown ?? token;
  const here = tilde(file);
  if (kind === 'folder') {
    const l = folderList(file);
    return {
      label: `folder, ${plural(l.files, 'file')}`,
      text: `<folder path="${at}">\n${l.text.slice(0, maxChars)}\n</folder>\n(${token} is the folder ${here}. Read, List and Search may open what is in it.)`,
      reads: [file],
    };
  }
  if (sub === 'text') {
    const r = readFile(file, { limit: TEXT_LINES });
    let body = r.numbered;
    let lines = r.shown;
    if (body.length > maxChars) { body = body.slice(0, maxChars); lines = body.split('\n').length; }
    const more = r.lineCount > lines ? `\n(${token}: lines 1–${num(lines)} of ${num(r.lineCount)} above. The whole file is ${here}: Read it from line ${num(lines + 1)} for the rest.)` : '';
    return { label: plural(r.lineCount, 'line'), text: `<file path="${at}">\n${body}\n</file>${more}`, reads: [file] };
  }
  if (sub === 'doc' || sub === 'sheet') {
    const whole = sub === 'doc' ? docText(file) : sheetsText(file);
    const what = sub === 'doc' ? `${kindLabel(file, sub)}, ~${plural(wordCount(whole), 'word')}` : `Excel, ${plural((whole.match(/^--- sheet /gm) ?? []).length, 'sheet')}`;
    let more = '';
    const reads = [file];
    if (whole.length > maxChars) {
      // Its text beside the attachments, so the rest can be read with Read (a .docx itself cannot).
      mkdirSync(textDir, { recursive: true });
      const txt = join(textDir, `${basename(file)}.txt`);
      writeFileSync(txt, whole);
      reads.push(txt);
      more = `\n(${token}: the first ${num(maxChars)} of ${num(whole.length)} characters of its text above. All of it is in ${tilde(txt)}: Read it for the rest.)`;
    }
    return { label: what, text: `<file path="${at}" kind="${what}">\n${whole.slice(0, maxChars)}\n</file>${more}`, reads };
  }
  if (sub === 'zip') {
    const names = zipNames(file);
    const list = names.slice(0, LIST_MAX).join('\n') + (names.length > LIST_MAX ? `\n… ${num(names.length - LIST_MAX)} more` : '');
    return { label: `zip, ${plural(names.length, 'file')}`, text: `<file path="${at}" kind="zip, ${plural(names.length, 'file')}">\n${list.slice(0, maxChars)}\n</file>\n(${token} is a zip, not unpacked here; it is ${here}.)`, reads: [file] };
  }
  const label = `${kindLabel(file, sub)} file, ${fmtBytes(statSize(file))}`;
  return { label: `${label}, not read`, text: `(${token} is ${at}: a ${label}. It is not text, so none of it is shown here; the file is ${here}.)`, reads: [file] };
}
// A file's size; a package (a .pages "file" is a folder) the size of what is in it.
const statSize = (file) => { try { return statSync(file).isDirectory() ? walkFolder(file).bytes : statSync(file).size; } catch { return null; } };
