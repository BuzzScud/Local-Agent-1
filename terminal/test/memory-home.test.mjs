// The memory about you, found again when its folder moved (18 Oct 2026, the owner: "i dont see any memorys"): on their
// Mac ~/.agentic/memory was a link to the project's old place, so from 9 Oct every save about them failed, a save that
// failed there took the project's facts down with it, and nothing said so. The link repaired (never a real folder
// touched), each folder saved on its own, what could not be written kept and saved at the next start, the line after a
// save, and the memory in one line for the start, /memory, the window and the hub. Throwaway homes only.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readlinkSync, lstatSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { youState, repairYou, repairWords, memoryFolderNow, heldSaves, saveHeld, memoryStatus, statusWords } from '../src/agent/memory-home.mjs';
import { applySave, saveLine } from '../src/agent/lessons.mjs';
import { applyChanges, readFacts, memoryDirs } from '../src/agent/facts.mjs';
import { actionsOf } from '../src/app/home-looks.jsx';
import { startLine } from '../src/app/start-notes.jsx';
import { viewItem } from '../src/window/view.mjs';
import { memoryRoute } from '../src/app/memory-hub.mjs';
import { sayMemory } from '../src/app/memory-start.mjs';

// A home whose memory about you lives in a project's private folder, reached by a link, as on the owner's Mac.
function home({ moved = false } = {}) {
  const h = mkdtempSync(join(tmpdir(), 'agentic-memhome-'));
  const old = join(h, 'Desktop', 'agentic-coder', 'docs', 'private', 'memory-about-you');
  const now = join(h, 'Desktop', 'PROJECTS', 'agentic-coder', 'docs', 'private', 'memory-about-you');
  const at = moved ? now : old;
  mkdirSync(at, { recursive: true });
  applyChanges(at, { add: [{ kind: 'you', text: 'Explain things simply, in three to five plain steps.' }] }, { why: 'test', today: '2026-10-09' });
  mkdirSync(join(h, '.agentic'), { recursive: true });
  symlinkSync(old, join(h, '.agentic', 'memory'));
  const repo = join(h, 'Desktop', 'PROJECTS', 'shop');
  mkdirSync(join(repo, '.git'), { recursive: true });
  return { h, old, now, link: join(h, '.agentic', 'memory'), repo };
}
const clearHeld = () => { for (const p of heldSaves()) rmSync(p.file, { force: true }); };

test('the folder about you: a folder, a link to one, none yet, or a link to a folder that is gone', () => {
  const ok = home();
  expect(youState(ok.h)).toMatchObject({ state: 'ok', target: ok.old });
  const gone = home({ moved: true });
  expect(youState(gone.h)).toMatchObject({ state: 'broken', dir: gone.link, target: gone.old });
  const none = mkdtempSync(join(tmpdir(), 'agentic-memhome-none-'));
  expect(youState(none).state).toBe('none');
  const real = mkdtempSync(join(tmpdir(), 'agentic-memhome-real-'));
  mkdirSync(join(real, '.agentic', 'memory'), { recursive: true });
  expect(youState(real).state).toBe('ok');
});

test('a link to a moved folder is pointed where it is now; nothing else is ever changed', () => {
  const m = home({ moved: true });
  expect(memoryFolderNow(m.old, { home: m.h })).toBe(m.now);
  const r = repairYou({ home: m.h });
  expect(r).toMatchObject({ state: 'fixed', from: m.old, to: m.now });
  expect(lstatSync(m.link).isSymbolicLink()).toBe(true);
  expect(readlinkSync(m.link)).toBe(m.now);
  expect(readFacts(m.link).map((f) => f.text)).toEqual(['Explain things simply, in three to five plain steps.']);
  expect(repairWords(r).text).toContain('the folder about you had moved · found it at');
  expect(repairYou({ home: m.h }).state).toBe('ok'); // once is enough
  // A place given first wins (the app's own private folder), and one that holds no memory is passed over.
  const two = home({ moved: true });
  const elsewhere = join(two.h, 'kept', 'memory-about-you');
  mkdirSync(join(elsewhere, 'facts'), { recursive: true });
  expect(memoryFolderNow(two.old, { home: two.h, places: [join(two.h, 'empty'), elsewhere] })).toBe(elsewhere);
  // Nowhere to be found: missing, and the link is left as it was.
  const lost = home({ moved: true });
  rmSync(join(lost.h, 'Desktop', 'PROJECTS', 'agentic-coder'), { recursive: true });
  const r2 = repairYou({ home: lost.h });
  expect(r2.state).toBe('missing');
  expect(readlinkSync(lost.link)).toBe(lost.old);
  expect(repairWords(r2)).toMatchObject({ tone: 'warn' });
  // A real folder is never touched.
  const real = mkdtempSync(join(tmpdir(), 'agentic-memhome-real-'));
  mkdirSync(join(real, '.agentic', 'memory'), { recursive: true });
  expect(repairYou({ home: real }).state).toBe('ok');
});

test('a save with the folder about you gone: the project still saves, the rest is said and kept, then saved at the next start', () => {
  clearHeld();
  const m = home({ moved: true });
  const adds = [
    { kind: 'you', text: 'Show results pages with the verdict first, then the numbers.' },
    { kind: 'project', text: 'The shop tests run with npm test from the project folder.' },
  ];
  const out = applySave({ cwd: m.repo, home: m.h, adds }, { today: '2026-10-18' });
  // Before, the first folder's error ended the save and took the project's fact with it.
  expect(out.added.map((f) => f.text)).toEqual(['The shop tests run with npm test from the project folder.']);
  expect(readFacts(memoryDirs(m.repo, m.h).project)).toHaveLength(1);
  expect(out.failed).toHaveLength(1);
  expect(out.failed[0]).toMatchObject({ about: 'you', n: 1, kept: true });
  expect(out.failed[0].why).toContain('the memory folder is missing');
  const line = saveLine(out);
  expect(line).toStartWith('Memory: 1 saved · 1 about this project · "The shop tests run');
  expect(line).toContain('not saved about you: the memory folder is missing');
  expect(line).toEndWith('kept for the next start');
  expect(heldSaves()).toHaveLength(1);
  // Still gone at the next start: it waits.
  expect(saveHeld(applySave)).toEqual({ saved: 0, left: 1 });
  // Found again: written, and the kept save is gone.
  expect(repairYou({ home: m.h }).state).toBe('fixed');
  expect(saveHeld(applySave)).toEqual({ saved: 1, left: 0 });
  expect(readFacts(m.link).map((f) => f.text).sort()).toEqual(['Explain things simply, in three to five plain steps.', 'Show results pages with the verdict first, then the numbers.']);
  expect(heldSaves()).toHaveLength(0);
  // Nothing saved anywhere: the line still says why.
  const g = home({ moved: true });
  const only = applySave({ cwd: g.repo, home: g.h, adds: [adds[0]] }, { today: '2026-10-18', hold: false });
  expect(saveLine(only)).toMatch(/^Memory: not saved about you: the memory folder is missing \(.*\)$/);
  clearHeld();
});

test('the line after a save says how many went to each memory', () => {
  const m = home();
  const out = applySave({ cwd: m.repo, home: m.h, adds: [
    { kind: 'you', text: 'Put explainer pages in tabs that fit the window.' },
    { kind: 'you', text: 'Ask before changing what a trading desk does by itself.' },
    { kind: 'project', text: 'The shop keeps its prices in cents.' },
  ] }, { today: '2026-10-18' });
  expect(out.failed).toEqual([]);
  expect(saveLine(out)).toStartWith('Memory: 3 saved · 2 about you, 1 about this project · "');
  expect(saveLine(out)).toEndWith('/memory shows it, /memory undo takes it back');
});

test('the memory in one line: the start page, the Launcher, the window, /memory and the hub', async () => {
  const m = home();
  applyChanges(memoryDirs(m.repo, m.h).project, { add: [{ kind: 'project', text: 'The shop keeps its prices in cents.' }] }, { why: 'save', today: '2026-10-18' });
  const st = memoryStatus(m.repo, m.h);
  expect(st).toMatchObject({ you: 1, project: 1, state: 'ok' });
  expect(statusWords(st)).toBe(`Memory · 1 about you · 1 this project · last saved ${new Date(st.last).getDate()} Oct`);
  expect(statusWords({ you: 0, project: null, last: null, state: 'ok' })).toBe('Memory · 0 about you · nothing saved yet');
  expect(statusWords({ you: 0, project: 3, last: null, state: 'broken' })).toBe('Memory · the folder about you is missing · 3 this project · nothing saved yet');
  // The Menu's row (enter: /memory) and the Launcher's line, which loses it first in a narrow window.
  const said = { memory: { words: 'Memory · 13 about you · 22 this project · last saved 18 Oct' } };
  const row = actionsOf({ said, recent: [], notes: ['AGENTS.md'], local: false }).find((x) => x.id === 'memory');
  expect(row).toMatchObject({ label: said.memory.words, key: '/memory' });
  expect(actionsOf({ said: {}, recent: [], notes: ['AGENTS.md'], local: false }).some((x) => x.id === 'memory')).toBe(false);
  const words = (w) => startLine({ ...said, mode: { mode: 'bypass', word: 'bypass permissions' } }, w).flat().map((x) => x.t).join('');
  expect(words(200)).toContain('13 about you');
  expect(words(60)).not.toContain('about you');
  // The window shows it as a note.
  expect(viewItem({ key: 'k', type: 'startnotes', said })).toMatchObject({ t: 'note', text: `${said.memory.words} · /memory shows it`, tone: 'dim' });
  expect(viewItem({ key: 'k', type: 'startnotes', said: {} }).t).toBe('skip');
  // The start: the line in the page while it is up, else a note; AGENTIC_MEMORY_LINE=off (the app tests) leaves it out.
  const parts = []; const notes = [];
  const was = process.env.AGENTIC_MEMORY_LINE;
  delete process.env.AGENTIC_MEMORY_LINE;
  sayMemory({ sayStart: (p, n) => { parts.push(p); notes.push(n); }, push: (n) => notes.push(n) }, { notes: [{ text: 'Memory: the folder about you had moved · found it', tone: 'dim' }], status: st, words: statusWords(st) });
  expect(parts).toEqual([{ kind: 'memory', words: statusWords(st), warn: false }]);
  expect(notes.map((n) => n.text)).toEqual(['Memory: the folder about you had moved · found it', `${statusWords(st)} · /memory shows it`]);
  process.env.AGENTIC_MEMORY_LINE = 'off';
  parts.length = 0;
  sayMemory({ sayStart: (p) => parts.push(p), push: () => {} }, { notes: [], status: st, words: statusWords(st) });
  expect(parts).toEqual([]);
  if (was === undefined) delete process.env.AGENTIC_MEMORY_LINE; else process.env.AGENTIC_MEMORY_LINE = was;
  // The hub: the line and a stamp that changes with a save, so its page redraws by itself.
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-memhub-'));
  mkdirSync(join(cwd, '.git'));
  const get = async () => (await memoryRoute(new Request('http://127.0.0.1/memory.json'), new URL('http://127.0.0.1/memory.json'), cwd)).json();
  const a = await get();
  expect(a.status.words).toStartWith('Memory · ');
  expect(a.status.state).not.toBe('broken');
  applyChanges(memoryDirs(cwd).project, { add: [{ kind: 'project', text: 'The hub redraws when a window saves.' }] }, { why: 'save', today: '2026-10-18' });
  const b = await get();
  expect(b.stamp).not.toBe(a.stamp);
  expect(b.status.words).toContain('1 this project');
});

test('a test never reaches the real memory folder: no places to look in with a home of its own', async () => {
  const { memoryPlaces } = await import('../src/app/memory-start.mjs');
  expect(process.env.AGENTIC_HOME).toBeTruthy();
  expect(memoryPlaces()).toEqual([]);
  expect(existsSync(join(process.env.AGENTIC_HOME, 'memory-jobs')) ? readdirSync(join(process.env.AGENTIC_HOME, 'memory-jobs')).filter((f) => f.startsWith('held-')) : []).toEqual([]);
});
