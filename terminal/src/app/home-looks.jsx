// The home screen (8 Oct 2026, the owner's ask: "redesign the home screen entirely"; of two rounds of three
// live designs they picked "2 · Menu": "build design 2"). One box in the middle of the window: the
// conversations to pick up, then what you can do, each row with its own key on the right, so the page
// teaches them; above it the model and the folder. Every row is an item: each conversation, and the
// actions (a new conversation, start or stop the model, switch model, the mode, all conversations, /init,
// settings, the other look). tab steps into the page from an empty prompt, the arrows move between the
// items (homeNav), enter does what the picked one says (its words are on the page's last row), esc or a
// typed letter goes back to the prompt, and a click on an item does it too (homeItems has where each one
// is). The page before it, the Launcher (start.jsx: the bot, the name in block letters), is still there:
// /home switches between the two (settings.json "homeLook"; AGENTIC_HOME_LOOK for one window), live while
// the page is up, which is until your first message. The page is as tall as its room (start.room), no
// wider than the window, and its items stay in place whatever the model is doing (off, loading, ready).
import React from 'react';
import { Box, Text } from 'ink';
import { HUE } from '../ui/theme.mjs';
import { StartPage, recentRows, ago, recentOf, subjectOf, tidySubject, gitWords, notesWords } from './start.jsx';

export const HOME_LOOKS = [
  { id: 'menu', name: 'Menu', note: 'one list: the conversations, then what you can do, each with its key' },
  { id: 'launcher', name: 'Launcher', note: 'the bot, the name in block letters, one column to pick up or start' },
];
// A look by its id, name or number (1 is the Menu); anything else is the Menu.
export function lookOf(v) {
  const w = String(v ?? '').trim().toLowerCase();
  if (/^\d+$/.test(w)) return HOME_LOOKS[Number(w) - 1]?.id ?? 'menu';
  return HOME_LOOKS.find((l) => l.id === w || l.name.toLowerCase() === w)?.id ?? 'menu';
}
export const nextLook = (v) => HOME_LOOKS[(HOME_LOOKS.findIndex((l) => l.id === lookOf(v)) + 1) % HOME_LOOKS.length].id;

// Colours by xterm-256 number. SEL: the row or button picked (the prompt's own selection blue).
const WHITE = 255, LIGHT = 252, PATH = 250, DIM = 245, FAINT = 240, EDGE = 238, SEL = 24;

// A row is a list of pieces { t, fg, bg, b }; every glyph used here is one cell wide.
const P = (t, fg, o = {}) => ({ t: String(t), fg, ...o });
const cells = (t) => [...t].length;
const span = (parts) => parts.reduce((n, x) => n + cells(x.t), 0);
// Exactly w cells: cut with … where it does not fit, spaces (on `bg`) after it.
function fit(parts, w, bg) {
  const out = [];
  let n = 0;
  for (const x of parts) {
    const c = [...x.t];
    if (n + c.length <= w) { out.push(x); n += c.length; continue; }
    const room = w - n;
    if (room > 0) out.push({ ...x, t: room > 1 ? `${c.slice(0, room - 1).join('').trimEnd()}…` : '…' });
    n += cells(out.at(-1)?.t ?? '');
    break;
  }
  return n < w ? [...out, P(' '.repeat(w - n), undefined, { bg })] : out;
}
// Left and right in w cells, the left cut first.
function spread(left, right, w, bg) {
  const r = span(right);
  if (r + 1 > w) return fit(left, w, bg);
  return [...fit(left, w - r - 1, bg), P(' ', undefined, { bg }), ...right];
}
const centre = (parts, w) => { const n = span(parts); return n >= w ? fit(parts, w) : [P(' '.repeat(Math.floor((w - n) / 2))), ...parts]; };
const cut = (s, n) => (cells(s) <= n ? s : `${[...s].slice(0, Math.max(1, n - 1)).join('').trimEnd()}…`);
const fitPath = (p, max) => (cells(p) <= max ? p : `…${[...p].slice(cells(p) - max + 1).join('')}`);
const ink = (n) => (n == null ? undefined : `ansi256(${n})`);
// A row picked: on the selection blue, its words brighter.
const lit = (parts, on) => (!on ? parts : parts.map((x) => ({ ...x, bg: x.bg ?? SEL, fg: x.fg === PATH || x.fg === DIM || x.fg === FAINT ? LIGHT : x.fg })));
function Line({ parts }) {
  if (!parts?.length) return <Text> </Text>;
  // neighbouring pieces of one colour drawn as one
  const runs = [];
  for (const x of parts) {
    const last = runs.at(-1);
    if (last && last.fg === x.fg && last.bg === x.bg && Boolean(last.b) === Boolean(x.b)) last.t += x.t;
    else runs.push({ ...x });
  }
  return <Text wrap="truncate-end">{runs.map((x, i) => <Text key={i} color={ink(x.fg)} backgroundColor={ink(x.bg)} bold={Boolean(x.b)}>{x.t}</Text>)}</Text>;
}

// What every look says of the model and the folder.
const TURN = ['◐', '◓', '◑', '◒'];
const BREATH = [HUE.deep, HUE.dim, HUE.accent, HUE.bright, HUE.accent, HUE.dim];
const breath = (walk) => (walk == null ? HUE.accent : BREATH[Math.floor(walk / 2) % BREATH.length]);
const stateOf = (s, loading) => (loading ? 'loading' : s.off ? 'off' : 'ready');
// How much of the start is left (start-times.mjs), as a bar w cells wide with its words.
function barParts(loading, w) {
  if (loading.phase === 'waiting') return [P('starts once the memory is free', DIM)];
  const est = loading.left;
  if (!est) return [P('timing this start for next time', DIM)];
  const words = est.over ? ' longer than usual' : ` about ${Math.max(1, Math.round(est.left))} s left`;
  const n = Math.max(4, w - words.length);
  const done = est.over ? n : Math.min(n, Math.max(0, Math.round((est.done || 0) * n)));
  return [P('━'.repeat(done), est.over ? HUE.dim : HUE.accent), P('─'.repeat(n - done), FAINT), P(words, DIM)];
}
// The model's state in a few words: ● ready, ◐ starting 12s, ○ off.
const chipParts = (state, loading, k, walk) => (state === 'ready' ? [P('● ', breath(walk)), P('ready', HUE.accent)] : state === 'off' ? [P('○ off', DIM)] : [P(`${TURN[k % 4]} starting ${Math.floor(loading.secs)}s`, HUE.bright)]);
const where = (cwd) => (cwd === '~' ? '~ · your home folder' : cwd ?? '');
const gitShort = (s) => { const g = gitWords(s.git); return g === 'no git' ? 'no git' : g.replace(/^git /, ''); };
// A conversation's subject as the Launcher has it; a shell command reads as one.
const subject = (r) => tidySubject(subjectOf(r));

// What the page offers besides the conversations, in the order tab takes them. `does`: what enter
// does, said on the page's last row while the item is picked. start: only with the model on this Mac;
// its label changes with the model's state, so it keeps the width of the longest (wide).
export function actionsOf(s, loading = null, k = 0) {
  const state = stateOf(s, loading);
  const all = s.recent ?? [];
  return [
    { id: 'new', label: 'New conversation', key: 'just type', does: 'puts you in the box below, to type what you want' },
    ...(s.local === false ? [] : [state === 'off'
      ? { id: 'start', wide: 15, label: 'Start the model', key: 'ctrl+t', does: `loads ${s.model ?? 'the model'}${s.typical ? `, about ${Math.max(1, Math.round(s.typical))} s` : ''}` }
      : state === 'loading'
        ? { id: 'start', wide: 15, label: `Starting ${TURN[k % 4]} ${Math.floor(loading.secs)}s`, key: 'ctrl+t', does: 'stops the start', busy: true }
        : { id: 'start', wide: 15, label: 'Stop the model', key: 'ctrl+t', does: 'unloads the model and gives its memory back' }]),
    { id: 'model', label: 'Switch model', key: '/model', does: 'opens the list of models' },
    { id: 'mode', label: `Mode · ${s.mode ?? 'manual'}`, key: 'shift+tab', does: 'switches to the next mode' },
    ...(all.length ? [{ id: 'resume', label: `All conversations · ${all.length}`, key: '/resume', does: 'lists every conversation in this folder' }] : []),
    ...(s.notes?.includes('AGENTS.md') ? [] : [{ id: 'init', label: 'Write AGENTS.md', key: '/init', does: 'writes notes about this project for the model to read' }]),
    { id: 'settings', label: 'Settings', key: '/settings', does: 'opens every setting in one menu' },
    { id: 'look', label: 'The Launcher', key: '/home', does: 'shows this page as it was before: the bot and one column' },
  ];
}
// The last row: how to get into the page, or, with an item picked, what enter does with it.
function hintParts(items, focus, w) {
  const it = items.find((x) => x.key === focus);
  if (!it) {
    const full = [P('tab', WHITE), P(' to pick from this page with the arrows', DIM), P('  ·  ', FAINT), P('or just type below', DIM)];
    return span(full) <= w ? full : [P('tab', WHITE), P(' picks from this page', DIM)];
  }
  const keys = [P('   '), P('↑↓←→', WHITE), P(' move  ', DIM), P('esc', WHITE), P(' back to typing', DIM)];
  const does = (n) => [P('↵', WHITE), P(` ${cut(it.does, n)}`, LIGHT)];
  return span([...does(999), ...keys]) <= w ? [...does(999), ...keys] : does(w - 2);
}
const convDoes = (r, i) => `opens conversation ${i + 1} again: ${cut(subject(r), 48)}`;

// A look's rows and its items: { rows, pad, items: [{ key, kind, id, does, rects: [{ row, from, to }] }] }
// (rows counted from the page's first; from and to are cells from 1, before pad).
function layoutOf(look, { start, width, loading = null, walk = null, focus = null }) {
  const s = start ?? {};
  const room = Math.max(4, s.room ?? 22);
  const k = loading ? Math.floor(loading.secs * 2) : 0;
  const out = menu({ s, width: Math.max(30, width), room, loading, k, walk, focus });
  // as tall as its room, so the prompt box stays at the foot of the window; the hint on its last row
  const hint = out.rows.pop();
  while (out.rows.length < room - 1) out.rows.push([]);
  out.rows.length = room - 1;
  out.rows.push(hint);
  out.items = out.items.map((it) => ({ ...it, rects: it.rects.filter((r) => r.row < room - 1) })).filter((it) => it.rects.length);
  return out;
}

export function HomePage(props) {
  const look = lookOf(props.start?.look);
  if (look === 'launcher') return <StartPage {...props} />;
  const { rows, pad } = layoutOf(look, props);
  return (
    <Box flexDirection="column" width={props.width}>
      {rows.map((r, i) => <Box key={i} paddingLeft={pad}><Line parts={r} /></Box>)}
    </Box>
  );
}
// The Menu's title row ("Agentic Coder" and the model), counted from the page's first row: the bot stands
// over it (bot-layer.jsx).
export function homeTitleRow(start, width) {
  const { rows } = layoutOf('menu', { start, width });
  return Math.max(0, rows.findIndex((r) => r?.length));
}
// The items of the page as drawn, with where each one is on the window: [{ key, kind, id, does,
// rects: [{ row, from, to }] }] (from and to: cells from 1). The Launcher has its conversations only.
export function homeItems(start, width) {
  const look = lookOf(start?.look);
  if (look === 'launcher') return recentRows(start, width).map((r) => ({ key: `conv:${r.id}`, kind: 'conv', id: r.id, rects: [{ row: r.row, from: r.from, to: r.to }] }));
  const { items, pad } = layoutOf(look, { start, width });
  return items.map((it) => ({ ...it, rects: it.rects.map((r) => ({ row: r.row, from: pad + r.from, to: Math.min(width, pad + r.to) })) }));
}
// The item a click lands on (row from the page's first, col from 1), or null.
export const itemAt = (items, row, col) => items.find((it) => it.rects.some((r) => r.row === row && col >= r.from && col <= r.to)) ?? null;
// The next item from `key` in a direction (up, down, left, right), by where they sit: the nearest
// one that way, one in the same column or row first; tab and shift+tab (next, back) go in order.
export function homeNav(items, key, dir) {
  if (!items.length) return null;
  const at = items.findIndex((x) => x.key === key);
  if (at < 0) return items[0].key;
  if (dir === 'next' || dir === 'back') return items[(at + (dir === 'next' ? 1 : items.length - 1)) % items.length].key;
  const mid = (it) => ({ y: it.rects.reduce((n, r) => n + r.row, 0) / it.rects.length, x: (it.rects[0].from + it.rects[0].to) / 2, from: it.rects[0].from, to: it.rects[0].to });
  const c = mid(items[at]);
  let best = null, score = Infinity;
  for (const it of items) {
    if (it.key === key) continue;
    const p = mid(it);
    const overlap = p.from <= c.to && p.to >= c.from; // the same column
    let along, across;
    if (dir === 'up' || dir === 'down') {
      along = dir === 'up' ? c.y - p.y : p.y - c.y;
      across = overlap ? 0 : Math.abs(p.x - c.x) / 4;
    } else {
      along = (dir === 'left' ? c.x - p.x : p.x - c.x) / 4;
      across = Math.abs(p.y - c.y);
      if (overlap) continue;
    }
    if (along <= 0.4) continue;
    const sc = along + across * 3;
    if (sc < score) { score = sc; best = it; }
  }
  return best?.key ?? key;
}

// ── Menu ────────────────────────────────────────────────────────────────────────────────────────
// One box in the middle: the conversations to pick up, then what you can do, each row with its own
// key on the right, so the page teaches them. Above it the model and the folder in two lines.
function menu({ s, width, room, loading, k, walk, focus }) {
  const state = stateOf(s, loading);
  const all = s.recent ?? [];
  const recent = recentOf(all, 99);
  const now = s.now ?? Date.now();
  const acts = actionsOf(s, loading, k);
  const BW = Math.max(30, Math.min(width - 4, 80));
  const pad = Math.floor((width - BW) / 2);
  const inner = BW - 4;
  const mid = (parts) => centre(parts, BW);
  const row = (parts, on = false) => [P('│ ', EDGE), ...lit(fit(parts, inner), on), P(' │', EDGE)];
  const title = mid([P('Agentic Coder', WHITE, { b: true }), P('    '), P(s.model ?? 'the model', LIGHT), P('  '), ...chipParts(state, loading, k, walk)]);
  const sub = mid([P(fitPath(where(s.cwd), Math.floor(BW / 2)), PATH), P('  ·  ', FAINT), P(gitShort(s), DIM), P('  ·  ', FAINT), P(notesWords(s.notes), DIM)]);
  const convRow = (r, i, on) => spread([P(on ? '❯ ' : '  ', HUE.accent), P(String(i + 1).padStart(2), WHITE), P('  '), P(subject(r), on ? WHITE : PATH, { b: on })], [P(ago(r.updated, now), on ? LIGHT : FAINT)], inner);
  const actRow = (a, on) => spread([P(on ? '❯ ' : '  ', HUE.accent), P('    '), P(a.label, a.busy ? HUE.bright : WHITE, { b: on })], a.busy ? barParts(loading, Math.min(32, inner - 30)) : [P(a.key, on ? LIGHT : FAINT)], inner);
  const page = (on, n) => {
    const out = [];
    const items = [];
    out.push(title);
    if (on.sub) out.push(sub);
    if (on.gap) out.push([]);
    out.push([P('╭', EDGE), P('─'.repeat(BW - 2), EDGE), P('╮', EDGE)]);
    if (on.air) out.push(row([]));
    if (on.labels) out.push(row([P('  '), P('PICK UP', FAINT)]));
    if (!recent.length) out.push(row([P('  '), P('No conversations here yet.', DIM)]));
    recent.slice(0, n).forEach((r, i) => {
      const key = `conv:${r.id}`;
      items.push({ key, kind: 'conv', id: r.id, does: convDoes(r, i), rects: [{ row: out.length, from: 3, to: BW - 2 }] });
      out.push(row(convRow(r, i, focus === key), focus === key));
    });
    out.push(on.air ? row([]) : row([P('─'.repeat(inner), 236)]));
    if (on.labels) out.push(row([P('  '), P('START', FAINT)]));
    acts.forEach((a) => {
      const key = `act:${a.id}`;
      items.push({ key, kind: 'act', id: a.id, does: a.does, rects: [{ row: out.length, from: 3, to: BW - 2 }] });
      out.push(row(actRow(a, focus === key), focus === key));
    });
    if (on.air) out.push(row([]));
    out.push([P('╰', EDGE), P('─'.repeat(BW - 2), EDGE), P('╯', EDGE)]);
    return { out, items };
  };
  const on = { sub: true, gap: true, air: true, labels: true };
  const most = Math.max(1, Math.min(recent.length, 8));
  const size = (n) => page(on, n).out.length + 2; // and a blank row and the hint
  for (const part of ['air', 'labels', 'gap', 'sub']) {
    if (size(Math.min(most, 3)) <= room) break;
    on[part] = false;
  }
  let n = most;
  while (n > 1 && size(n) > room) n--;
  if (size(n) > room) {
    // a short window (the / menu open under the page, say): no box, as many rows as fit, a conversation
    // first when there is one, then the actions in order
    const rows = [title];
    const items = [];
    const fits = Math.max(0, room - 2);
    const list = [...recent.slice(0, Math.max(1, fits - acts.length)).map((r, i) => ({ r, i })), ...acts.map((a) => ({ a }))].slice(0, fits);
    for (const x of list) {
      const key = x.r ? `conv:${x.r.id}` : `act:${x.a.id}`;
      items.push({ key, kind: x.r ? 'conv' : 'act', id: x.r ? x.r.id : x.a.id, does: x.r ? convDoes(x.r, x.i) : x.a.does, rects: [{ row: rows.length, from: 3, to: BW - 2 }] });
      rows.push([P('  '), ...lit(x.r ? convRow(x.r, x.i, focus === key) : actRow(x.a, focus === key), focus === key)]);
    }
    rows.push(centre(hintParts(items, focus, BW), BW));
    return { rows, pad, items };
  }
  const { out, items } = page(on, n);
  const lift = Math.max(0, Math.floor((room - 1 - out.length) / 2));
  const rows = [...Array.from({ length: lift }, () => []), ...out];
  for (const it of items) for (const r of it.rects) r.row += lift;
  while (rows.length < room - 1) rows.push([]);
  rows.push(centre(hintParts(items, focus, BW), BW));
  return { rows, pad, items };
}
