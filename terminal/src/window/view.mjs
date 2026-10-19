// What the window draws, as plain data (12 Oct 2026: Agentic Coder in its own window, design 2). The app's
// printed conversation (screen.jsx printedOf: rail.jsx's grouping, task-rows.jsx's task rows) becomes view items
// the window's page draws with HTML; anything it has no view of its own for is sent as the app's own drawing
// (ANSI lines, `ansiRows`), so nothing the terminal shows is missing from the window. No React, no Ink here.
import { homedir } from 'node:os';
import { groupFacts, TASKS, gist } from '../app/rail.jsx';

const CUBE = [0, 95, 135, 175, 215, 255];
const hex2 = (n) => n.toString(16).padStart(2, '0');
// An xterm-256 colour as #rrggbb (the app draws by number; the window by colour).
export function xterm(n) {
  const BASE = ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5', '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff'];
  if (n < 16) return BASE[n];
  if (n < 232) { const k = n - 16; return `#${hex2(CUBE[Math.floor(k / 36)])}${hex2(CUBE[Math.floor(k / 6) % 6])}${hex2(CUBE[k % 6])}`; }
  const v = 8 + 10 * (n - 232);
  return `#${hex2(v)}${hex2(v)}${hex2(v)}`;
}
const hexOf = (ansi) => xterm(Number(/ansi256\((\d+)\)/.exec(String(ansi))?.[1] ?? 245));
const HOME = homedir();
const one = (s) => String(s ?? '').replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();
const tilde = (s) => String(s ?? '').split(HOME).join('~');
const short = (s, n = 160) => { const t = tilde(one(s)); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const base = (p) => String(p ?? '').split('/').pop();
const flat = (list) => list.flatMap((x) => (x.type === 'looks' ? x.list : [x])).filter((x) => x.type !== 'machine');

// One step in a few words: what it was, on what, how it went.
function stepOf(x) {
  if (x.type === 'thinking') return { k: 'thought', words: short(gist(x.text, 160)) };
  if (x.type === 'text') return { k: 'said', words: short(x.text) };
  if (x.type === 'user') return { k: 'you', words: short(x.text) };
  if (x.type === 'note') return { k: 'note', words: short(x.text), tone: x.tone };
  if (x.type !== 'tool') return { k: x.type, words: short(x.text ?? x.label ?? '') };
  const v = x.view ?? {};
  const s = { k: v.kind ?? 'tool', label: x.label, words: short(x.arg, 140), err: Boolean(x.error) };
  if (v.kind === 'bash') s.end = `${(v.lines ?? []).length} lines · exit ${v.code ?? 0}`;
  else if (v.kind === 'diff') { let a = 0, r = 0; for (const h of v.hunk ?? []) { if (h.type === '+') a++; else if (h.type === '-') r++; } s.words = base(v.path); s.end = `+${a} −${r}`; }
  else if (v.kind === 'read') s.end = `${v.lines ?? 0} lines`;
  else if (v.kind === 'done') s.end = 'already made';
  else if (v.kind === 'search' || v.kind === 'list') s.end = `${v.count ?? 0} found`;
  else if (v.kind === 'todos') { s.words = `${(v.items ?? []).length} to-dos`; s.label = 'To-do'; }
  else if (v.kind === 'answer') { s.words = short(v.question ?? x.arg, 140); s.end = short(v.text, 80); }
  return s;
}
function factsOf(f) {
  if (!f) return null;
  return { steps: f.steps, reads: f.reads, commands: f.commands, thoughts: f.thoughts, answers: f.answers.length, fails: f.failures.length, test: f.test?.words ?? null, testBad: Boolean(f.test?.bad), files: f.files.map((x) => ({ name: base(x.path), a: x.a, r: x.r, created: x.created })) };
}
const rowOf = (r) => ({ id: r.id, words: short(r.text ?? r.guess, 220), said: Boolean(r.text), facts: factsOf(r.facts), steps: flat(r.list).map(stepOf) });
const taskOf = (task) => ({ label: TASKS[task]?.label ?? 'WORKING', color: hexOf(TASKS[task]?.title ?? 'ansi256(245)') });

// A printed item as the window draws it, or null: the window shows the app's own drawing of it instead.
export function viewItem(it) {
  switch (it.type) {
    case 'user': return it.rail ? null : { t: 'user', key: it.key, text: tilde(it.text), cards: (it.cards ?? []).map((c) => tilde(c.text)) };
    case 'text': return { t: 'text', key: it.key, text: tilde(it.text) };
    case 'taskrun': {
      const all = groupFacts(it.run.rows.flatMap((r) => r.list));
      const last = [...it.run.rows].reverse().find((r) => r.text);
      return { t: 'taskrun', key: it.id, id: it.id, open: Boolean(it.open), first: Boolean(it.first), ...taskOf(it.run.task), last: short(last ? last.text : it.run.rows[0].guess, 220), said: Boolean(last), rows: it.run.rows.map(rowOf), openRows: [...(it.openRows ?? [])], facts: factsOf(all) };
    }
    case 'taskend': { const f = groupFacts(it.rows.flatMap((r) => r.list)); return { t: 'taskend', key: `end${it.rows[0]?.id}`, facts: factsOf(f) }; }
    // text: why a reply that did not end done stopped ("Interrupted · …", END_WORDS), as the terminal's end line says it.
    case 'done': return { t: 'done', key: it.key, past: it.past, secs: it.secs, at: it.at, usd: it.usd ?? 0, steps: it.steps ?? 0, reason: it.reason, text: it.text ?? null, left: it.left ?? 0 };
    case 'made': return { t: 'made', key: it.key, files: (it.files ?? []).map((f) => ({ name: base(f.path), created: f.created })) };
    case 'note': return it.check ? null : { t: 'note', key: it.key, text: short(it.text, 600), tone: it.tone ?? 'dim' };
    case 'divider': return { t: 'divider', key: it.key, text: short(it.text, 200) };
    case 'sorted': return { t: 'note', key: it.key, text: short(it.text, 300), tone: 'dim' };
    // The start's memory line shows in the window as a note (memory-start.mjs); the rest of the start is the page's.
    case 'startnotes': return it.said?.memory ? { t: 'note', key: it.key, text: `${it.said.memory.words} · /memory shows it`, tone: it.said.memory.warn ? 'warn' : 'dim' } : { t: 'skip', key: it.key };
    case 'welcome': case 'machine': return { t: 'skip', key: it.key };
    default: return null;
  }
}
// The turn under way (task-rows.jsx LiveRun's `held`): the task row so far and the row under way.
export function heldView(held) {
  if (!held) return null;
  if (held.type !== 'tasklive') return { t: 'heldsteps', steps: flat(Array.isArray(held) ? held : held.list ?? [held]).map(stepOf) };
  const f = held.list.length ? groupFacts(held.list) : null;
  const run = held.run;
  return {
    t: 'live', first: Boolean(held.first),
    run: run ? { ...taskOf(run.task), rows: run.rows.map(rowOf), last: short([...run.rows].reverse().find((r) => r.text)?.text ?? run.rows[0].guess, 220) } : null,
    now: { ...taskOf(f?.task ?? 'thinking'), words: held.line ? short(held.line.text, 220) : 'Working', steps: flat(held.list).map(stepOf), n: f?.steps ?? 0 },
  };
}

// ANSI text (Ink's output) as rows of runs: [text, fg, bg, flags] with fg/bg as #rrggbb or null and flags
// 1 bold · 2 dim · 4 italic · 8 underline · 16 inverse. A wide character keeps its width in the text.
export function ansiRows(text) {
  return String(text ?? '').split('\n').map((line) => {
    const runs = [];
    let st = { fg: null, bg: null, f: 0 };
    const push = (t) => { const last = runs.at(-1); if (last && last[1] === st.fg && last[2] === st.bg && last[3] === st.f) last[0] += t; else runs.push([t, st.fg, st.bg, st.f]); };
    for (const m of line.matchAll(/\x1b\[([0-9;]*)m|\x1b\][^\x07]*\x07|([^\x1b]+)/g)) {
      if (m[2] !== undefined) { push(m[2]); continue; }
      if (m[1] === undefined) continue;
      const p = m[1] === '' ? [0] : m[1].split(';').map(Number);
      for (let k = 0; k < p.length; k++) {
        const n = p[k];
        if (n === 0) st = { fg: null, bg: null, f: 0 };
        else if (n === 1) st = { ...st, f: st.f | 1 }; else if (n === 2) st = { ...st, f: st.f | 2 }; else if (n === 3) st = { ...st, f: st.f | 4 };
        else if (n === 4) st = { ...st, f: st.f | 8 }; else if (n === 7) st = { ...st, f: st.f | 16 };
        else if (n === 22) st = { ...st, f: st.f & ~3 }; else if (n === 23) st = { ...st, f: st.f & ~4 }; else if (n === 24) st = { ...st, f: st.f & ~8 }; else if (n === 27) st = { ...st, f: st.f & ~16 };
        else if (n === 39) st = { ...st, fg: null }; else if (n === 49) st = { ...st, bg: null };
        else if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97)) st = { ...st, fg: xterm(n >= 90 ? n - 82 : n - 30) };
        else if ((n >= 40 && n <= 47) || (n >= 100 && n <= 107)) st = { ...st, bg: xterm(n >= 100 ? n - 92 : n - 40) };
        else if ((n === 38 || n === 48) && p[k + 1] === 5) { st = { ...st, [n === 38 ? 'fg' : 'bg']: xterm(p[k + 2]) }; k += 2; }
        else if ((n === 38 || n === 48) && p[k + 1] === 2) { st = { ...st, [n === 38 ? 'fg' : 'bg']: `#${[p[k + 2], p[k + 3], p[k + 4]].map((v) => hex2(v ?? 0)).join('')}` }; k += 4; }
      }
    }
    while (runs.length && /^\s*$/.test(runs.at(-1)[0]) && !runs.at(-1)[2]) runs.pop();
    return runs;
  });
}
// The pretend terminal's cells (vt.mjs) as the same rows of runs, from row `from` (the window's fallback).
export function cellRows(grid, from = 0, to = grid.length) {
  const col = (c) => (c == null ? null : typeof c === 'string' ? c : xterm(c));
  return grid.slice(from, to).map((row) => {
    const runs = [];
    for (const c of row) {
      if (c.ch === '') continue;
      const f = (c.b ? 1 : 0) | (c.d ? 2 : 0) | (c.i ? 4 : 0) | (c.u ? 8 : 0) | (c.v ? 16 : 0);
      const fg = col(c.fg), bg = col(c.bg);
      const last = runs.at(-1);
      if (last && last[1] === fg && last[2] === bg && last[3] === f) last[0] += c.ch; else runs.push([c.ch, fg, bg, f]);
    }
    while (runs.length && /^\s*$/.test(runs.at(-1)[0]) && !runs.at(-1)[2]) runs.pop();
    return runs;
  });
}
