// What the window draws, as plain data (12 Oct 2026: Agentic Coder in its own window, design 2). The app's
// printed conversation (screen.jsx printedOf: rail.jsx's grouping, task-rows.jsx's task rows) becomes view items
// the window's page draws with HTML; anything it has no view of its own for is sent as the app's own drawing
// (ANSI lines, `ansiRows`), so nothing the terminal shows is missing from the window. No React, no Ink here.
import { homedir } from 'node:os';
import { groupFacts, TASKS, gist } from '../app/rail.jsx';
import { readResults } from '../flows/results.mjs';

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

// A step whole, as the window's timeline draws it (27 Oct 2026, the owner's pick "7 · Smooth" after five rounds of
// designs, docs/private/design rounds/agentic-coder-window-steps-v5-2026-10-27.html): what it was, on what, how it went,
// when it started and how long it took, and what opens under it. Kept short: a change's first 60 lines, a command's
// first 6 and last 18, 30 lines of a file, a thought whole. The app's own reading for the model (memory, Claude's notes,
// design cards: type 'machine') is a step too.
const flatAll = (list) => (list ?? []).flatMap((x) => (x.type === 'looks' ? x.list : [x]));
const lines = (t, n) => String(t ?? '').split('\n').filter(Boolean).slice(0, n).map((l) => tilde(l).slice(0, 200));
export function stepView(x) {
  const s = { key: x.key, at: x.at ?? null };
  if (x.type === 'thinking') return { ...s, k: 'think', text: tilde(x.text), tokens: x.tokens ?? 0, ms: x.secs >= 0.05 ? Math.round(x.secs * 1000) : null };
  if (x.type === 'text') return { ...s, k: 'said', text: tilde(x.text) };
  if (x.type === 'note') return { ...s, k: 'note', text: short(x.text, 600), tone: x.tone ?? 'dim' };
  if (x.type === 'machine') {
    const notes = (x.contexts ?? []).flatMap((c) => (c.items ?? []).map((i) => ({ from: i.from, text: short(i.text, 400), tokens: i.tokens ?? 0 })));
    const ms = (x.contexts ?? []).reduce((n, c) => n + (c.ms ?? 0), 0);
    return { ...s, k: 'machine', notes, tokens: (x.contexts ?? []).reduce((n, c) => n + (c.tokens ?? 0), 0), ms: ms || null, design: x.design ?? [] };
  }
  if (x.type !== 'tool') return { ...s, k: x.type, text: short(x.text ?? x.label ?? '') };
  const v = x.view ?? {};
  const d = { ...s, k: v.kind ?? 'tool', label: x.label, arg: tilde(x.arg ?? ''), err: Boolean(x.error), ms: x.ms ?? v.ms ?? null };
  if (v.kind === 'diff') {
    let add = 0, del = 0;
    for (const h of v.hunk ?? []) { if (h.type === '+') add++; else if (h.type === '-') del++; }
    return { ...d, path: tilde(v.path), created: Boolean(v.created), add, del, hunk: (v.hunk ?? []).slice(0, 60).map((h) => [h.type, h.oldNo ?? null, h.newNo ?? null, String(h.text ?? '').slice(0, 200)]), more: Math.max(0, (v.hunk ?? []).length - 60) };
  }
  if (v.kind === 'bash' || v.kind === 'job') {
    const all = (v.lines ?? []).map((l) => tilde(l).slice(0, 220));
    const r = readResults(all.join('\n'), v.code ?? 0);
    return { ...d, code: v.code ?? 0, n: all.length, head: all.slice(0, 6), tail: all.length > 6 ? all.slice(-18) : [], tests: r && (r.passed != null || r.failed != null) ? { passed: r.passed ?? 0, failed: r.failed ?? 0 } : null };
  }
  if (v.kind === 'read' || v.kind === 'same') return { ...d, lines: v.lines ?? 0, total: v.total ?? null, outline: Boolean(v.outline), content: lines(v.content, 30) };
  if (v.kind === 'search' || v.kind === 'list') return { ...d, count: v.count ?? 0, content: lines(v.content, 16) };
  // a step on the to-do list: the app says "done", the model may say "completed"
  if (v.kind === 'todos') return { ...d, items: (v.items ?? []).map((t) => ({ text: short(t.text ?? t.content, 200), done: t.status === 'done' || t.status === 'completed', now: t.status === 'in_progress' })) };
  if (v.kind === 'answer') return { ...d, question: short(v.question ?? x.arg, 400), answer: short(v.text, 200) };
  if (v.kind === 'error') return { ...d, err: true, message: short(v.message, 400) };
  if (v.kind === 'websearch') return { ...d, query: tilde(v.query ?? (x.arg && x.arg !== '""' ? String(x.arg).replace(/^"|"$/g, '') : '')), count: v.count ?? 0, service: v.service ?? '', sources: (v.sources ?? []).slice(0, 20).map((r) => ({ title: short(r.title, 160), url: String(r.url ?? ''), age: r.age ?? null })) };
  if (v.kind === 'fetched') return { ...d, url: v.url ?? x.arg ?? '', status: v.status ?? null };
  return d;
}
const todoNow = (x) => (x?.type === 'tool' && x.view?.kind === 'todos' ? (x.view.items ?? []).find((t) => t.status !== 'done' && t.status !== 'completed')?.text ?? null : null);
// The parts of a reply (the same pick): each line the model says starts one, and so does a move in its plan, the to-do
// it works on (its own line names the part then). ctx carries the to-do from one item to the next and every step met.
export function partsOf(rows, ctx = { plan: null, raws: new Map() }) {
  const parts = [];
  for (const r of rows ?? []) {
    let cur = { key: null, title: short(r.text ?? r.guess ?? '', 300), said: Boolean(r.text), plan: false, keys: [], row: r.id ?? null };
    parts.push(cur);
    for (const x of flatAll(r.list)) {
      const now = todoNow(x);
      if (now && now !== ctx.plan) {
        ctx.plan = now;
        if (cur.keys.length) { cur = { key: null, title: short(now, 300), said: true, plan: true, keys: [], row: null }; parts.push(cur); }
        // the to-do names the part; the model's own line stays, as the first line of its timeline
        else Object.assign(cur, { title: short(now, 300), said: true, plan: true, ...(cur.said && !cur.plan ? { line: cur.title } : {}) });
      }
      cur.keys.push(x.key);
      ctx.raws?.set(x.key, x);
    }
  }
  // a line said with no step after it (another line came) is a part of its own, keyed by its row
  for (const p of parts) { p.key = p.keys.length ? `p:${p.keys[0]}` : `p:r:${p.row}`; delete p.row; }
  return parts.filter((p) => p.keys.length || (p.said && !p.key.endsWith(':null')));
}

// A printed item as the window draws it, or null: the window shows the app's own drawing of it instead.
// ctx (the bridge's, one a redraw): the plan carried across the reply's parts, and every step met.
export function viewItem(it, ctx) {
  switch (it.type) {
    case 'user': return it.rail ? null : { t: 'user', key: it.key, text: tilde(it.text), cards: (it.cards ?? []).map((c) => tilde(c.text)) };
    case 'text': return { t: 'text', key: it.key, text: tilde(it.text) };
    case 'taskrun': {
      const all = groupFacts(it.run.rows.flatMap((r) => r.list));
      const last = [...it.run.rows].reverse().find((r) => r.text);
      return { t: 'taskrun', key: it.id, id: it.id, open: Boolean(it.open), first: Boolean(it.first), ...taskOf(it.run.task), last: short(last ? last.text : it.run.rows[0].guess, 220), said: Boolean(last), rows: it.run.rows.map(rowOf), openRows: [...(it.openRows ?? [])], facts: factsOf(all), ...(ctx ? { parts: partsOf(it.run.rows, ctx) } : {}) };
    }
    case 'taskend': { const f = groupFacts(it.rows.flatMap((r) => r.list)); return { t: 'taskend', key: `end${it.rows[0]?.id}`, facts: factsOf(f) }; }
    // text: why a reply that did not end done stopped ("Interrupted · …", END_WORDS), as the terminal's end line says it.
    case 'done': return { t: 'done', key: it.key, past: it.past, secs: it.secs, at: it.at, usd: it.usd ?? 0, steps: it.steps ?? 0, calls: it.calls ?? null, reason: it.reason, text: it.text ?? null, left: it.left ?? 0 };
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
// The turn under way (task-rows.jsx LiveRun's `held`): the task row so far and the row under way. With ctx (the bridge):
// its parts too, the part under way last, its line (what the model said before it) as its title.
export function heldView(held, ctx) {
  if (!held) return null;
  if (held.type !== 'tasklive') return { t: 'heldsteps', steps: flat(Array.isArray(held) ? held : held.list ?? [held]).map(stepOf) };
  const f = held.list.length ? groupFacts(held.list) : null;
  const run = held.run;
  // the stretch under way: its last part is the one the window draws as under way (a move in the plan may have closed
  // others in it); with no step done yet it is only its line, which names the part the window starts for it
  // its line is the words alone (task-rows.jsx: oneLine)
  const line = typeof held.line === 'string' ? held.line : held.line?.text ?? null;
  const done = ctx ? partsOf(run?.rows ?? [], ctx) : [];
  const now = ctx ? partsOf([{ text: line, list: held.list }], ctx) : [];
  if (now.length) now[now.length - 1].now = true;
  const parts = ctx ? [...done, ...now] : null;
  return {
    t: 'live', first: Boolean(held.first), ...(parts ? { parts, line: line ? short(line, 300) : null, plan: ctx.plan } : {}),
    run: run ? { ...taskOf(run.task), rows: run.rows.map(rowOf), last: short([...run.rows].reverse().find((r) => r.text)?.text ?? run.rows[0].guess, 220) } : null,
    now: { ...taskOf(f?.task ?? 'thinking'), words: line ? short(line, 220) : 'Working', steps: flat(held.list).map(stepOf), n: f?.steps ?? 0 },
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
