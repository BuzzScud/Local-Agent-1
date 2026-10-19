// The memory at a start (18 Oct 2026, the owner's picks after nine days of saves about them failing unseen): the link
// about you found again when its folder moved, the facts kept while a folder could not be written saved now, and the
// memory in one line ("Memory · 13 about you · 22 this project · last saved 18 Oct") for the start page, the window
// and /memory. agent/memory-home.mjs has the parts; this joins them with openMemory and applySave.
import { join } from 'node:path';
import { openMemory } from '../agent/facts.mjs';
import { applySave } from '../agent/lessons.mjs';
import { repairYou, repairWords, saveHeld, memoryStatus, statusWords } from '../agent/memory-home.mjs';
import { findPrivateDir } from './docs-dir.mjs';

// Where the owner's memory about them is kept on this Mac: the project's private folder. Never with a home of a test's
// own (AGENTIC_HOME) or a folder named outright (AGENTIC_MEMORY): those are never a link to repair.
export function memoryPlaces() {
  if (process.env.AGENTIC_HOME || process.env.AGENTIC_MEMORY) return [];
  const priv = findPrivateDir();
  return priv ? [join(priv, 'memory-about-you')] : [];
}

// Once a process: the first start that reads the memory (the start page's loader in cli.jsx, else the window's App)
// repairs the link, and the window's start says what it did.
let repaired = null;
export function repairMemory() { repaired ??= repairYou({ places: memoryPlaces() }); return repaired; }

// → { link, held, status, words, notes: [{ text, tone }] }, also kept for sayMemory (the window's start says it once
// its page is up).
let started = null;
export function startMemory(cwd, { rules = null } = {}) {
  const link = repairMemory();
  try { openMemory(cwd, { rules }); } catch { /* said by the status: the folder is missing */ }
  let held = { saved: 0, left: 0 };
  try { held = saveHeld(applySave); } catch { /* tried again at the next start */ }
  const status = memoryStatus(cwd);
  const notes = [repairWords(link), held.saved ? { text: `Memory: saved ${held.saved} fact${held.saved === 1 ? '' : 's'} kept while the folder could not be written`, tone: 'dim' } : null].filter(Boolean);
  started = { link, held, status, words: statusWords(status), notes };
  return started;
}

// What the start says about it (App.jsx): the notes, then the one line, in the start page while it is up
// (start-notes.jsx, home-looks.jsx) and as a note once it has gone. m: the last startMemory's.
export function sayMemory({ sayStart, push }, m = started) {
  if (!m) return;
  for (const n of m.notes) push({ type: 'note', ...n });
  // AGENTIC_MEMORY_LINE=off (the app tests' screens): no line, but a folder found again or missing is still said.
  if (/^(off|0|false|no)$/i.test(process.env.AGENTIC_MEMORY_LINE ?? '')) return;
  const warn = m.status.state === 'broken';
  sayStart({ kind: 'memory', words: m.words, warn }, { type: 'note', text: `${m.words} · /memory shows it`, tone: warn ? 'warn' : 'dim' });
}
