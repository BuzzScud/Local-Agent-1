// A note after every answer (19 Oct 2026, the owner: "ensure the agentic coder updates memory after
// every result"; their picks: a note plus the facts, right after each answer, notes kept two weeks and
// then folded in). One entry per answer in that day's file beside the facts, <memory>/notes/YYYY-MM-DD.md:
// when it ended, how, what was asked, what it said, the files and the check. The app writes it with no
// model call, so an answer is never left out because the facts save found nothing worth keeping (the
// eight answers of 19 Oct kept nothing and said nothing). Past NOTE_DAYS a day's notes are read once for
// what still matters (AutoSave.fold), then moved to notes/folded/: nothing is deleted.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { locked, looksSecret } from './facts.mjs';

export const NOTE_DAYS = 14;

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => { const t = oneLine(s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
// A line that holds a key, a token or a password is left out, as a fact with one would be.
const clean = (s) => (looksSecret(s) ? '(left out: it held a key or a password)' : s);
// The day on this Mac's clock: a note written at 21:00 in New York belongs to that day, not UTC's next one.
export const localDay = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// The project's memory when there is one, else the one about you (the home folder, ~/Desktop).
const homeOf = (dirs) => dirs.project ?? dirs.you;
export const notesFolder = (dirs) => join(homeOf(dirs), 'notes');

const ENDED = { passed: 'passed its check', failed: 'failed its check', stuck: 'got stuck', stopped: 'stopped by you', declined: 'you said no', done: 'done' };

export function noteEntry(lesson, at = new Date()) {
  const lines = [`## ${hhmm(at)} · ${ENDED[lesson.outcome] ?? lesson.outcome ?? 'done'}`, `- Asked: ${clean(cut(lesson.request, 300))}`];
  // A code block in the answer is the work itself, not what it says: shown as (code).
  if (lesson.answer) lines.push(`- Said: ${clean(cut(String(lesson.answer).replace(/```[\s\S]*?(```|$)/g, ' (code) '), 400))}`);
  if (lesson.files?.length) lines.push(`- Files: ${lesson.files.slice(0, 12).join(', ')}`);
  if (lesson.check?.cmd) lines.push(`- Check: ${clean(cut(lesson.check.cmd, 160))}${lesson.check.ok === true ? ' ✓' : lesson.check.ok === false ? ' ✗' : ''}`);
  for (const w of (lesson.warnings ?? []).slice(-2)) lines.push(`- Note: ${clean(cut(w, 200))}`);
  return `${lines.join('\n')}\n`;
}

// Appended under the memory's lock, so two windows in one folder never write over each other's entry.
export function writeNote(dirs, lesson, { now = new Date() } = {}) {
  const dir = notesFolder(dirs), day = localDay(now), file = join(dir, `${day}.md`);
  return locked(homeOf(dirs), () => {
    mkdirSync(dir, { recursive: true });
    const head = existsSync(file) ? '' : `# Notes · ${day}\n\nWhat each answer here did, one entry each, written as it ended. Kept ${NOTE_DAYS} days, then read once for what still matters and moved to folded/.\n`;
    appendFileSync(file, `${head}\n${noteEntry(lesson, now)}`);
    return { file, day };
  });
}

export const readNote = (file) => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };
const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.md$/;

// How many answers today's file holds (the memory's status line).
export function notesToday(dirs, now = new Date()) {
  return (readNote(join(notesFolder(dirs), `${localDay(now)}.md`)).match(/^## /gm) ?? []).length;
}

// The days kept NOTE_DAYS full days already, oldest first.
export function dueNotes(dirs, now = new Date()) {
  const dir = notesFolder(dirs);
  if (!existsSync(dir)) return [];
  const before = localDay(new Date(now.getTime() - NOTE_DAYS * 86_400_000));
  return readdirSync(dir).filter((f) => DAY_FILE.test(f) && f.slice(0, 10) < before).sort().map((f) => ({ day: f.slice(0, 10), file: join(dir, f) }));
}

// Read for what still matters: the day's file moves to notes/folded/, kept, out of the way.
export function foldNote(dirs, note) {
  const to = join(notesFolder(dirs), 'folded');
  mkdirSync(to, { recursive: true });
  renameSync(note.file, join(to, `${note.day}.md`));
}
