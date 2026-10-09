// Where should it work? The page `coding` shows when typed in the home folder, before anything in a folder is
// read (start-folder.mjs, cli.jsx pickStartFolder). The owner's pick of three designs drawn by the real code,
// "2 · Doors" (9 Oct 2026; the round is private: docs/private/design rounds/agentic-coder-where-should-it-work-
// 3-designs-2026-10-09.html). Before it, "1 · Cards" (2 Oct): the bot on the left and a card per folder in the
// window's top rows. Now the bot on top, then the folders side by side, each with what it is, what it suits,
// its last three conversations and how many it has (folderFacts: the app's own records, nothing in the folder),
// in the middle of the window's height. The one picked has its whole edge in the choice colour (never a
// stripe). ←→ or ↑↓ move (pick.mjs), 1 and 2 pick, enter starts there, esc leaves. A short window drops the
// bot, then the lead, then the conversations, then what each suits; under 90 columns the two stand one above
// the other.
import React from 'react';
import { Box, Text } from 'ink';
import { HUE } from '../ui/theme.mjs';
import { ago, botRows, botCells, tidySubject, subjectOf, recentOf } from './start.jsx';

// Colours by xterm-256 number, as the start page's Menu has them (home-looks.jsx); ASK is the choice colour (C.ask).
const WHITE = 255, LIGHT = 252, PATH = 250, DIM = 245, FAINT = 240, EDGE = 238, ASK = 147, WARN = 215;
const P = (t, fg, o = {}) => ({ t: String(t), fg, ...o });
const cells = (t) => [...t].length;
const span = (parts) => parts.reduce((n, x) => n + cells(x.t), 0);
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
function spread(left, right, w, bg) {
  const r = span(right);
  if (r + 1 > w) return fit(left, w, bg);
  return [...fit(left, w - r - 1, bg), P(' ', undefined, { bg }), ...right];
}
const centre = (parts, w) => { const n = span(parts); return n >= w ? fit(parts, w) : [P(' '.repeat(Math.floor((w - n) / 2))), ...parts]; };
const fitPath = (p, max) => (cells(p) <= max ? p : `…${[...p].slice(cells(p) - max + 1).join('')}`);
const ink = (n) => (n == null ? undefined : `ansi256(${n})`);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const subject = (r) => tidySubject(subjectOf(r));
// A folder's last conversations as the start page lists them (the same prompt again shown once), without the
// app's own restart notes.
const lastOf = (f, n) => recentOf((f.recent ?? []).filter((x) => !/^\(Agentic Coder restarted/.test(x.title ?? '')), n);
function wrapWords(text, w) {
  const out = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && cells(line) + 1 + cells(word) > w) { out.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}
function Line({ parts }) {
  if (!parts?.length) return <Text> </Text>;
  const runs = [];
  for (const x of parts) {
    const last = runs.at(-1);
    if (last && last.fg === x.fg && last.bg === x.bg && Boolean(last.b) === Boolean(x.b)) last.t += x.t;
    else runs.push({ ...x });
  }
  return <Text wrap="truncate-end">{runs.map((x, i) => <Text key={i} color={ink(x.fg)} backgroundColor={ink(x.bg)} bold={Boolean(x.b)}>{x.t}</Text>)}</Text>;
}
const Rows = ({ rows, width, pad = 0 }) => (
  <Box flexDirection="column" width={width}>{rows.map((r, i) => (r?.el ? <Box key={i} paddingLeft={r.pad ?? 0}>{r.el}</Box> : <Box key={i} paddingLeft={pad}><Line parts={r} /></Box>))}</Box>
);
// In the middle of the window's height: blank rows over it, so its middle is the window's.
const lifted = (rows, height) => [...Array.from({ length: Math.max(0, Math.floor((height - rows.length) / 2)) }, () => []), ...rows];

const LEAD = 'It reads, searches and runs things in one folder. You typed coding in your home folder, so it asks which one first.';
const convWord = (f) => (f.convs ? plural(f.convs, 'conversation') : 'no conversations yet');
const trustMark = (f, on) => (f.trusted ? P('✓', on ? HUE.accent : HUE.dim) : P('!', WARN));
const trustWord = (f) => (f.trusted ? P('trusted', HUE.dim) : P('safety check next', WARN));
// The keys under the doors: what enter does with the folder picked, then the rest.
const keysParts = (f, w, more = []) => {
  const does = [P('↵', WHITE), P(` starts in ${f.shown}`, LIGHT)];
  const rest = [P('    '), ...more, P('esc', WHITE), P(' exit', DIM)];
  return span([...does, ...rest]) <= w ? [...does, ...rest] : [...does, P('  '), P('esc', WHITE), P(' exit', DIM)];
};

// rows: how many of the window's rows the page may take (it sits in their middle, never taller); folders:
// startFolders' rows with folderFacts' (convs, last, trusted, recent).
export function FolderPage({ width, rows = 24, folders, selected = 0, now = Date.now() }) {
  const TW = Math.max(40, Math.min(width - 4, 124));
  const pad = Math.floor((width - TW) / 2);
  const across = width >= 90;
  const w = across ? Math.floor((TW - 2) / folders.length) : TW;
  const door = (f, i, on2) => {
    const on = i === selected;
    const edge = on ? ASK : EDGE;
    const inner = w - 6;
    const r = (parts) => [P('│  ', edge), ...fit(parts, inner), P('  │', edge)];
    const last = lastOf(f, on2.last);
    return [
      [P('╭', edge), P('─'.repeat(w - 2), edge), P('╮', edge)],
      r(spread([P(on ? '❯ ' : '  ', ASK), P(String(i + 1), on ? ASK : FAINT, { b: on })], [trustMark(f, on), P(' '), trustWord(f)], inner)),
      r([P('  '), P(fitPath(f.shown, inner - 2), on ? WHITE : PATH, { b: true })]),
      r([P('  '), P(f.what, on ? LIGHT : DIM)]),
      ...(on2.good ? [r([P('  '), P(f.good, DIM)])] : []),
      ...(on2.last ? [
        r([]),
        r([P('  '), P(last.length ? 'LAST HERE' : 'LAST', FAINT)]),
        ...(last.length ? last.map((x) => r(spread([P('  · ', FAINT), P(subject(x), on ? PATH : DIM)], [P(ago(x.updated, now), FAINT)], inner))) : [r([P('  '), P(f.trusted ? 'the first one starts here' : 'a safety check comes first', DIM)])]),
        ...Array.from({ length: on2.last - Math.max(1, last.length) }, () => r([])),
        r([]),
      ] : []),
      r([P('  '), P(convWord(f), on ? LIGHT : DIM)]),
      [P('╰', edge), P('─'.repeat(w - 2), edge), P('╯', edge)],
    ];
  };
  const bw = botCells('trust')[0].length;
  const build = (on2) => {
    const doors = folders.map((f, i) => door(f, i, on2));
    const out = [];
    if (on2.bot) { for (const b of botRows('trust')) out.push({ el: b, pad: Math.floor((width - bw) / 2) }); out.push([]); }
    out.push(centre([P('Where should it work?', HUE.accent, { b: true })], TW));
    if (on2.lead) for (const l of wrapWords(LEAD, Math.min(TW, 76))) out.push(centre([P(l, DIM)], TW));
    out.push([]);
    if (across) for (let k = 0; k < doors[0].length; k++) out.push(doors.flatMap((d, i) => [...(i ? [P('  ')] : []), ...d[k]]));
    else for (const d of doors) out.push(...d);
    out.push([]);
    out.push(centre(keysParts(folders[selected], TW, [P(across ? '←→' : '↑↓', WHITE), P(' move  ', DIM), P('1 2', WHITE), P(' pick  ', DIM)]), TW));
    return out;
  };
  // A short window drops the bot first, then the lead, then the last conversations, then what each suits.
  const on2 = { bot: true, lead: true, last: 3, good: true };
  let out = build(on2);
  for (const step of [() => { on2.bot = false; }, () => { on2.lead = false; }, () => { on2.last = 1; }, () => { on2.last = 0; }, () => { on2.good = false; }]) {
    if (out.length <= rows) break;
    step();
    out = build(on2);
  }
  return <Rows rows={lifted(out, rows)} width={width} pad={pad} />;
}
