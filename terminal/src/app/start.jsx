// The start page (29 Sep 2026, the user's pick: "like Claude", open; upgraded 1 Oct, "1 · Studio").
// No box: a titled line, then two columns. Left, centred: a greeting, the Visor bot, the model and
// its state (off, the start's steps, ready). Right: Recent activity with each one's prompts, This
// folder as labelled rows, a Try row of keys. Until your first message the page stays live (Screen
// holds it back from the scrollback), so the bot and the state line follow the model: asleep and
// "off", then the steps after /start, then ready. Your first message prints it once. The safety
// check (cli.jsx) uses the same columns. The tips live on the line under the prompt box (startTip).
import React from 'react';
import { Box, Text, renderToString } from 'ink';
import { C } from '../ui/theme.mjs';
import { wrap } from '../ui/parts.jsx';
import { RAIL } from './rail.jsx';
import { VERSION } from './help.mjs';

const WHITE = 'ansi256(255)';
const PATH = 'ansi256(250)';

// "1h ago", "3d ago": how long since a conversation was last saved.
export function ago(iso, now = Date.now()) {
  const m = Math.round((now - new Date(iso)) / 60000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
// A saved title is the first 80 characters of the prompt: one line, without separator runs, and
// with … where it was cut when saved.
export function titleOf(s) {
  const t = String(s.title ?? '').replace(/[-=_─*#]{3,}/g, ' ').replace(/\s+/g, ' ').trim() || '(untitled)';
  return String(s.title ?? '').length >= 80 ? `${t}…` : t;
}
// What a conversation is about, for Recent activity. A saved title is the start of its first
// prompt, and prompts often open the same way ("Create a self-contained HTML file for a …"), which
// left the part that differs cut off. That usual opening goes; the subject stays, up to the end of
// its sentence. A title that does not open that way is shown as it is.
const OPENING = new RegExp(String.raw`^(?:please\s+)?(?:can you\s+)?(?:create|write|make|build|generate|code|design|implement|draft)\s+(?:me\s+)?(?:(?:a|an|one|the|some)\s+)?(?:(?:single|self-contained|standalone|simple|basic|complete|new|small|tiny|quick|one-file|working)[\s,]+)*(?:(?:html|css|js|javascript|typescript|python|react|node|bash|shell|svg|web)\s+)?(?:file|page|app|script|program|component|document|website|site|module|function|tool|game)s?\s+(?:(?:called|named)\s+)?(?:(?:for|that|which|to|showing|with)\s+(?:(?:renders|displays|shows|draws|has|holds)\s+)?(?:(?:a|an|the)\s+)?)?`, 'i');
export function nameOf(s) {
  const title = titleOf(s);
  const m = OPENING.exec(title);
  if (!m) return title;
  let rest = title.slice(m[0].length).replace(/…$/, '');
  const end = /[.!?;:](\s|$)/.exec(rest);
  const whole = Boolean(end) && end.index >= 6;
  if (whole) rest = rest.slice(0, end.index);
  if (rest.trim().length < 3) return title;
  rest = rest.trim();
  // a capital for a word, never for a file or code name (notes.html stays as it is)
  const first = /^[a-z][a-z-]*(\s|$)/.test(rest) ? `${rest[0].toUpperCase()}${rest.slice(1)}` : rest;
  return `${first}${!whole && title.endsWith('…') ? '…' : ''}`;
}
// The newest conversations, the same prompt run again shown once.
export function recentOf(list, n = 3) {
  const seen = new Set();
  return list.filter((s) => { const k = titleOf(s); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, n);
}
// gitSummary (prompt.mjs) in the page's words.
export function gitWords(git) {
  if (!git || git === 'not a git repository') return 'no git';
  return git.replace(/^branch (\S+), /, 'git $1 · ').replace('no uncommitted changes', 'clean').replace(/(\d+) changed files?/, '$1 changed');
}
export function notesWords(notes = []) {
  if (notes.includes('AGENTS.md')) return `reads ${notes.join(' + ')}`;
  return notes.length ? `no AGENTS.md yet · reads ${notes.join(' + ')}` : 'no AGENTS.md yet';
}
const where = (cwd) => (cwd === '~' ? '~ · your home folder' : cwd);
const cut = (s, n) => (s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1))}…`);
const fitPath = (p, max) => (p.length <= max ? p : `…${p.slice(p.length - max + 1)}`);

// The tip on the line under the prompt box until the first message (one each start; a folder with
// no AGENTS.md always gets /init first). What the start waits for is on the page (stepsLine).
export const TIPS = [
  '@ attaches a file to your message',
  'shift+tab switches between manual, accept edits, plan and auto',
  '/resume picks up an earlier conversation',
  'esc twice rewinds the files and the conversation',
  '! runs a shell command yourself',
  '/btw asks a side question without stopping the work',
];
export const INIT_TIP = '/init writes an AGENTS.md with notes about this project';
// Only in a window that can do it: one showing a background session (app/sessions.mjs).
const BG_TIP = 'ctrl+b sends this window to the background; coding attach opens it again';
// AGENTIC_TIPS=off leaves the line as "? for shortcuts" (the app's tests set it: a random tip would
// change every screen they read).
export const tipsOn = (env = process.env) => !/^(off|0|false|no)$/i.test(env.AGENTIC_TIPS ?? '');
export const startTip = (start, pick = (xs) => xs[Math.floor(Math.random() * xs.length)]) => (!tipsOn() ? null : start?.notes?.includes('AGENTS.md') ? pick(process.env.AGENTIC_IN_HOST ? [...TIPS, BG_TIP] : TIPS) : INIT_TIP);

// The Visor bot II (1 Oct 2026, the user's pick "1 · Studio"): a white helmet with a dark glass
// visor, its eyes in green light, an antenna whose light pulses while the model loads, ear lights,
// a chest strip that fills, arms and feet; shaded with light from the top left. It says what the
// model is doing: asleep (– – and a Z) while it is off, looking about while it loads, happy (^ ^)
// when it is ready, one eye open at the safety check. Drawn from shapes, 22 × 20 pixels, two to a
// character, so 22 columns × 10 rows.
const BOT_W = 22, BOT_H = 20;
// A rounded rectangle, both ends included; the corners cut on a circle of radius r.
function roundRect(x0, y0, x1, y1, r = 0) {
  const pts = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x - Math.min(Math.max(x, x0 + r), x1 - r), dy = y - Math.min(Math.max(y, y0 + r), y1 - r);
    if (dx * dx + dy * dy <= r * r + r * 0.6) pts.push([x, y]);
  }
  return pts;
}
const fill = (px, pts, c) => { for (const [x, y] of pts) px[y][x] = c; };
const edgeOf = (pts) => { const has = new Set(pts.map(([x, y]) => `${x},${y}`)); return (x, y) => has.has(`${x},${y}`); };
// A shape lit from the top left: tones = [rim light, top, middle, bottom, shadow rim]. Shaded a
// whole character (two pixel rows) at a time, so a change of tone never falls inside one.
function shade(px, pts, tones) {
  const inn = edgeOf(pts);
  const ys = pts.map(([, y]) => y), top = Math.min(...ys) >> 1, span = Math.max(1, (Math.max(...ys) >> 1) - top);
  for (const [x, y] of pts) {
    const c = y >> 1, t = (c - top) / span;
    let tone = t < 0.34 ? tones[1] : t < 0.7 ? tones[2] : tones[3];
    if (!inn(x, 2 * c + 2) || !inn(x + 1, y)) tone = tones[4];
    if (!inn(x, 2 * c - 1) || (!inn(x - 1, y) && t < 0.6)) tone = tones[0];
    px[y][x] = tone;
  }
}
const AWAKE = { helm: [255, 255, 253, 250, 246], body: [254, 252, 250, 248, 244], arm: [252, 250, 248, 247, 244], foot: [250, 248, 246, 244, 241], visor: 233, rim: 236, glint: 239, glint2: 237, pod: 248, podShade: 245, neck: 242, stripOff: 237, hand: 246 };
const ASLEEP = { helm: [249, 248, 246, 244, 241], body: [247, 246, 244, 243, 240], arm: [246, 245, 243, 242, 240], foot: [244, 243, 241, 240, 238], visor: 233, rim: 235, glint: 237, glint2: 235, pod: 243, podShade: 241, neck: 239, stripOff: 236, hand: 241 };
export const BOT_STRIP_ROW = 16; // the chest strip's top pixel row (two tall), x 7–14
// A shape's columns cut to whole characters: each starts on an even pixel row and ends on an odd
// one, so no edge falls inside a character, where Terminal would show a sliver (botGlyph).
function whole(pts) {
  const cols = new Map();
  for (const [x, y] of pts) { const c = cols.get(x) ?? [y, y]; cols.set(x, [Math.min(c[0], y), Math.max(c[1], y)]); }
  return pts.filter(([x, y]) => { const [a, b] = cols.get(x); return y >= a + (a % 2) && y <= b - (1 - (b % 2)); });
}
// state: 'off' | 'trust' | 'loading' | 'ready'; k: the step while it loads (two a second); look:
// where you are typing, 0–1 across the window (null when the prompt is empty): awake, it looks down
// at the prompt box, a little left or right with the cursor.
// The pixels' colours (xterm-256 numbers), null where the window shows through.
export function botPixels(state, k = 0, look = null) {
  const px = Array.from({ length: BOT_H }, () => Array(BOT_W).fill(null));
  const asleep = state === 'off' || state === 'trust', ready = state === 'ready';
  const P = asleep ? ASLEEP : AWAKE;
  const pulse = (steps) => steps[k % steps.length];
  fill(px, roundRect(10, 0, 11, 1), asleep ? 240 : ready ? 114 : pulse([71, 114, 120, 157, 120, 114])); // the antenna's light
  const ear = asleep ? 239 : ready ? 114 : (k % 4 < 2 ? 120 : 71);
  fill(px, roundRect(1, 4, 1, 9), P.pod); fill(px, roundRect(BOT_W - 2, 4, BOT_W - 2, 9), P.podShade);
  for (const x of [0, BOT_W - 1]) fill(px, [[x, 6], [x, 7]], ear);
  shade(px, roundRect(2, 2, 19, 11, 4), P.helm);
  // the visor set into the helmet: its rim dark at the bottom right, glints at the top left
  const visor = whole(roundRect(4, 4, 17, 9, 2)), inV = edgeOf(visor);
  for (const [x, y] of visor) px[y][x] = !inV(x, 2 * (y >> 1) + 2) || !inV(x + 1, y) ? P.rim : P.visor;
  fill(px, [[6, 4], [6, 5], [5, 6], [5, 7]], P.glint); fill(px, [[15, 4], [15, 5]], P.glint2);
  // neck, body, the chest strip, arms and hands, legs, feet
  fill(px, roundRect(9, 12, 12, 13), P.neck);
  shade(px, roundRect(5, 14, 16, 17), P.body);
  const lit = ready ? 8 : asleep ? 0 : k % 9;
  for (let i = 0; i < 8; i++) fill(px, [[7 + i, BOT_STRIP_ROW], [7 + i, BOT_STRIP_ROW + 1]], i < lit ? (ready ? 114 : 120) : P.stripOff);
  for (const x of [2, 18]) { shade(px, roundRect(x, 14, x + 1, 17), P.arm); fill(px, roundRect(x, 18, x + 1, 19), P.hand); }
  fill(px, roundRect(4, 14, 4, 15), P.arm[3]); fill(px, roundRect(17, 14, 17, 15), P.arm[3]);
  for (const x of [5, 12]) { fill(px, roundRect(x, 18, x + 3, 19), P.foot[1]); fill(px, roundRect(x + 4, 18, x + 4, 19), P.foot[4]); }
  // the face
  const eyes = (pts, c) => fill(px, pts, c);
  const SHUT = [[6, 7], [7, 7], [8, 7], [13, 7], [14, 7], [15, 7]];
  if (state === 'off') {
    eyes(SHUT, 65);
    fill(px, [[18, 0], [19, 0], [20, 0], [21, 0], [20, 1], [19, 2], [18, 3], [19, 3], [20, 3], [21, 3]], 243); // Z
  } else if (state === 'trust') {
    eyes(SHUT.slice(0, 3), 65);
    eyes(roundRect(13, 6, 14, 7), 71);
  } else if (look != null) {
    const dx = look < 0.34 ? -1 : look < 0.67 ? 0 : 1;
    for (const x of [7 + dx, 13 + dx]) { eyes(roundRect(x, 8, x + 1, 9), ready ? 157 : 120); eyes([[x, 8]], ready ? 194 : 157); }
  } else if (ready) {
    eyes([[6, 7], [7, 6], [8, 6], [9, 7], [12, 7], [13, 6], [14, 6], [15, 7]], 157);
  } else if (k % 10 === 9) {
    eyes([[7, 7], [8, 7], [13, 7], [14, 7]], 120); // a blink
  } else {
    const dx = [0, 0, 1, 1, 0, 0, -1, -1][k % 8]; // it looks right, then left
    for (const x of [7 + dx, 13 + dx]) { eyes(roundRect(x, 6, x + 1, 7), 120); eyes([[x, 6]], 157); } // a glint in each eye
  }
  return px;
}
// Two pixel rows to a line, drawn for how Terminal.app draws SF Mono: a line is 14.32 pt tall at
// 12 pt, ▀ covers 2.145–8.145 of it and ▄ 8.145–14.145, and a background colour fills all of it
// (measured from Terminal's own SF-Mono-Regular.otf). So the same colour above and below is a space
// on that background. A cell with two pixels leaves a sliver of its background showing: 0.175 pt
// under ▄ (the upper pixel's colour) or 2.145 pt above ▀ (the lower one's). Each cell takes the
// glyph whose sliver matches the pixels beside it, so no line shows through the bot; the first bot
// used █ ▀ ▄ alone and left a gap under every row.
const WINDOW_GREY = 30; // the window's own colour (Terminal's dark Basic, #1e1e1e)
const CUBE = [0, 95, 135, 175, 215, 255];
export function greyOf(n) {
  if (n == null) return WINDOW_GREY;
  if (n >= 232) return 8 + (n - 232) * 10;
  const i = n - 16;
  return Math.round(0.3 * CUBE[Math.floor(i / 36)] + 0.59 * CUBE[Math.floor(i / 6) % 6] + 0.11 * CUBE[i % 6]);
}
const apart = (a, b) => Math.abs(greyOf(a) - greyOf(b));
// up / top / bottom / down: the pixel above the cell, its two, the one below it.
export function botGlyph(up, top, bottom, down) {
  if (top == null && bottom == null) return { ch: ' ' };
  if (top === bottom) return { ch: ' ', bg: top };
  const lower = 0.175 * Math.min(apart(top, bottom), apart(top, down)); // ▄: the upper colour under it
  const upper = top == null ? Infinity : 2.145 * Math.min(apart(bottom, up), apart(bottom, top)); // ▀: the lower colour over it
  if (upper < lower) return { ch: '▀', fg: top, bg: bottom ?? undefined };
  if (bottom == null) return { ch: '▄', fg: top, inverse: true }; // the window's colour drawn on the upper one
  return { ch: '▄', fg: bottom, bg: top ?? undefined };
}
export function botCells(state, k = 0, look = null) {
  const px = botPixels(state, k, look);
  const rows = [];
  for (let y = 0; y < px.length; y += 2) rows.push(px[y].map((top, x) => botGlyph(px[y - 1]?.[x] ?? null, top, px[y + 1]?.[x] ?? null, px[y + 2]?.[x] ?? null)));
  return rows;
}
const ink = (n) => (n == null ? undefined : `ansi256(${n})`);
export function botRows(state, k = 0, look = null) {
  return botCells(state, k, look).map((row, y) => (
    <Text key={`bot${y}`}>{row.map((c, x) => <Text key={x} color={ink(c.fg)} backgroundColor={ink(c.bg)} inverse={c.inverse}>{c.ch}</Text>)}</Text>
  ));
}

// The two columns: the left one centred, a thin rail between, the right one as it comes.
const leftWidth = (width) => (width >= 100 ? 40 : 30);
function Split({ width, left, right }) {
  const L = leftWidth(width);
  const RW = Math.max(10, width - L - 3);
  const n = Math.max(left.length, right.length);
  return (
    <Box flexDirection="column" width={width}>
      {Array.from({ length: n }, (_, i) => (
        <Box key={i} flexDirection="row">
          <Box width={L} flexShrink={0} justifyContent="center">{left[i] ?? <Text> </Text>}</Box>
          <Box width={3} flexShrink={0}><Text color={RAIL}>│  </Text></Box>
          <Box width={RW} flexShrink={0}>{right[i] ?? <Text> </Text>}</Box>
        </Box>
      ))}
    </Box>
  );
}
function TitleLine({ width }) {
  const words = `Agentic Coder v${VERSION} `;
  return <Text><Text color={RAIL}>── </Text><Text bold color={WHITE}>Agentic Coder</Text><Text color={C.dim}> v{VERSION} </Text><Text color={RAIL}>{'─'.repeat(Math.max(0, width - 3 - words.length))}</Text></Text>;
}
const Heading = ({ children, color = C.accent }) => <Text bold color={color}>{children}</Text>;

// The model's state under its name. Loading: the start's steps on one line, ✓ done, ◐ now with
// its seconds, ○ still to come, in the longest words that fit the column (App's startPhase:
// loading or waiting = the model, reading or restoring = the instructions).
const STEP = { loading: 0, waiting: 0, reading: 1, restoring: 1 };
const TURN = ['◐', '◓', '◑', '◒'];
function stepsLine(loading, room, k = 0) {
  const at = STEP[loading.phase] ?? 0;
  const secs = ` ${Math.floor(loading.secs)}s`;
  const way = (words, rule) => words.flatMap((w, i) => [
    ...(i ? [[rule, i <= at ? C.accent : C.faint]] : []),
    [`${i < at ? '✓' : i === at ? TURN[k % 4] : '○'} `, i <= at ? C.accent : C.faint],
    [w, i < at ? C.dim : i === at ? WHITE : C.faint],
    ...(i === at ? [[secs, C.dim]] : []),
  ]);
  const model = loading.phase === 'waiting' ? ['waiting for memory', 'waiting'] : ['model', 'model'];
  const notes = loading.phase === 'restoring' ? ['restoring', 'restoring'] : ['instructions', 'reading'];
  const long = [model[0], notes[0], 'ready'], short = [model[1], notes[1], 'ready'];
  const ways = [way(long, ' ━━ '), way(long, ' ─ '), way(short, ' ─ '), way(short, ' ')];
  const fit = ways.find((p) => p.reduce((n, [t]) => n + t.length, 0) <= room) ?? ways.at(-1);
  return <Text wrap="truncate-end">{fit.map(([t, c], i) => <Text key={i} color={c}>{t}</Text>)}</Text>;
}
function stateLine(s, loading, room, k, wide) {
  if (loading) return stepsLine(loading, room, k);
  // off: the model is not loaded; it waits for /start
  if (s.off) return <Text wrap="truncate-end"><Text color={C.faint}>○ </Text><Text color={C.dim}>off · </Text><Text color={C.accent}>{room >= 26 ? '/start wakes it up' : '/start'}</Text></Text>;
  const ctxK = s.ctx ? `${Math.round(s.ctx / 1024)}k` : '';
  return <Text wrap="truncate-end"><Text color={C.accent}>● ready</Text><Text color={C.dim}>{s.effort ? ` · ${wide ? `effort ${s.effort}` : s.effort}` : ''}{ctxK ? ` · ${ctxK}${wide ? ' context' : ''}` : ''}</Text></Text>;
}
// How long the start takes (start-times.mjs), under its steps: while it loads, a bar with what is
// left; with the model off, how long /start usually takes; once ready, how long this one took.
// The same row in every state, so nothing moves.
function timeLine(s, loading, room) {
  if (loading) {
    if (loading.phase === 'waiting') return <Text color={C.dim} wrap="truncate-end">starts once the memory is free</Text>;
    const est = loading.left;
    if (!est) return <Text color={C.dim} wrap="truncate-end">{room >= 31 ? 'timing this start for next time' : 'timing this start'}</Text>;
    const words = est.over ? ' longer than usual' : ` about ${Math.max(1, Math.round(est.left))} s left`;
    const n = Math.max(4, room - words.length);
    // Between 0 and n whatever done says: a bar of negative length ends the app (String.repeat).
    const lit = est.over ? n : Math.min(n, Math.max(0, Math.round((est.done || 0) * n)));
    return <Text wrap="truncate-end"><Text color={est.over ? C.accentDim : C.accent}>{'━'.repeat(lit)}</Text><Text color={C.faint}>{'─'.repeat(n - lit)}</Text><Text color={C.dim}>{words}</Text></Text>;
  }
  if (s.off) return s.typical ? <Text color={C.dim}>{`/start takes about ${Math.max(1, Math.round(s.typical))} s`}</Text> : <Text> </Text>;
  return s.took ? <Text color={C.dim}>{`started in ${Math.max(1, Math.round(s.took))} s`}</Text> : <Text> </Text>;
}
// A row on the right: a label, then its value.
const Labelled = ({ label, children, color = PATH }) => <Text wrap="truncate-end"><Text color={C.dim}>{label.padEnd(8)}</Text><Text color={color}>{children}</Text></Text>;
// The keys worth knowing on the first day, as many as fit.
const TRY = [['@', 'a file'], ['!', 'a command'], ['/', 'every command'], ['shift+tab', 'switch mode'], ['esc esc', 'rewind']];
function keysLine(keys, room) {
  const fit = [];
  let used = 0;
  for (const [key, words] of keys) {
    const n = (fit.length ? 3 : 0) + key.length + 1 + words.length;
    if (used + n > room) break;
    used += n;
    fit.push([key, words]);
  }
  return <Text>{fit.map(([key, words], i) => <React.Fragment key={key}>{i ? <Text>   </Text> : null}<Text color={WHITE}>{key}</Text><Text color={C.dim}> {words}</Text></React.Fragment>)}</Text>;
}
const keyed = (els) => els.map((el, i) => el && React.cloneElement(el, { key: i }));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// start: { model, effort, ctx, cwd, git, notes, also, recent, now, off } (off: the model is not loaded; also: this folder's own settings
// file and a start-up mode saved with /permissions, a line each). loading: null once ready, or
// { phase, secs, left } while the model loads (the page is live then; left: startLeft). typing:
// where the cursor is, 0–1 across the window, while the prompt has text (the bot glances at it).
export function StartPage({ start, width, loading = null, typing = null }) {
  const L = leftWidth(width);
  const RW = Math.max(10, width - L - 3);
  const wide = width >= 100;
  const s = start ?? {};
  // two steps a second: the page is redrawn only when the bot or the seconds move
  const k = loading ? Math.floor(loading.secs * 2) : 0;
  const recent = recentOf(s.recent ?? []);
  const left = [
    <Text bold color={WHITE}>{(s.recent ?? []).length ? 'Welcome back!' : 'Welcome!'}</Text>, null,
    ...botRows(loading ? 'loading' : s.off ? 'off' : 'ready', k, typing), null,
    <Text bold color={WHITE} wrap="truncate-end">{s.model ?? 'the model'}</Text>,
    stateLine(s, loading, L - 2, k, wide),
    timeLine(s, loading, L - 2),
  ];
  const countW = 10;
  const tW = Math.max(8, RW - 9 - countW - 1);
  const git = gitWords(s.git);
  const rule = <Text color={C.faint}>{'─'.repeat(Math.max(10, RW - 2))}</Text>;
  const right = [
    <Heading>Recent activity</Heading>,
    ...(recent.length
      ? [...recent.map((r) => <Box width={RW - 1}><Box flexGrow={1}><Text wrap="truncate-end"><Text color={C.dim}>{ago(r.updated, s.now).padEnd(9)}</Text><Text color={PATH}>{cut(nameOf(r), tW)}</Text></Text></Box><Text color={C.faint}>{plural(r.turns ?? 1, 'prompt').padStart(countW)}</Text></Box>),
        <Text color={C.dim} wrap="truncate-end">click one, or <Text color={WHITE}>/resume</Text> for more · <Text color={WHITE}>coding -c</Text> goes on with the last one</Text>]
      : [<Text color={C.dim}>No conversations here yet</Text>, <Text color={C.dim} wrap="truncate-end"><Text color={WHITE}>/init</Text> writes an AGENTS.md for this project</Text>]),
    rule,
    <Heading>This folder</Heading>,
    <Labelled label="where">{fitPath(where(s.cwd ?? ''), RW - 10)}</Labelled>,
    <Labelled label="git" color={C.dim}>{git === 'no git' ? 'none here' : git.replace(/^git /, '')}</Labelled>,
    <Labelled label="reads" color={C.dim}>{notesWords(s.notes).replace(/^reads /, '')}</Labelled>,
    ...(s.also ?? []).map((l) => <Labelled label="" color={C.dim}>{l}</Labelled>),
    rule,
    <Heading>Try</Heading>,
    keysLine(TRY, RW - 2),
  ];
  return (
    <Box flexDirection="column" width={width}>
      <TitleLine width={width} />
      <Text> </Text>
      <Split width={width} left={keyed(left)} right={keyed(right)} />
    </Box>
  );
}

// Where each Recent activity row is on the page (4 Oct 2026, the owner's ask: "allow me to access this
// by clicking"): [{ id, row, from, to }], row counted from the page's first line, from and to the
// cells (from 1) its words take. Found in the page as drawn, so a change of layout cannot move them.
const ANSI = /\x1b\[[0-9;]*m/g;
export function recentRows(start, width) {
  const s = start ?? {};
  const recent = recentOf(s.recent ?? []);
  if (!recent.length) return [];
  const lines = renderToString(<StartPage start={s} width={width} />, { columns: width }).split('\n').map((l) => l.replace(ANSI, ''));
  const RW = Math.max(10, width - leftWidth(width) - 3);
  const tW = Math.max(8, RW - 9 - 10 - 1);
  const out = [];
  for (const r of recent) {
    const name = cut(nameOf(r), tW);
    const row = lines.findIndex((l, i) => l.includes(name) && !out.some((o) => o.row === i));
    if (row < 0) continue;
    const from = leftWidth(width) + 4;
    out.push({ id: r.id, row, from, to: width });
  }
  return out;
}

// The safety check, in the start page's columns: the bot peeking, the folder not trusted yet, the
// question with its two answers (selected: the row ❯ marks).
const TRUST_TEXT = 'Is this a folder you created or one you trust? Agentic Coder reads its notes (AGENTS.md) into the model, and can read, edit and run things here once you allow them. A yes covers this folder and everything inside it, and is remembered.';
export const TRUST_OPTIONS = ['Yes, I trust this folder', 'No, exit'];
export function TrustPage({ width, cwd, model, selected = 0 }) {
  const L = leftWidth(width);
  const RW = Math.max(10, width - L - 3);
  const left = [
    <Text bold color={WHITE}>Welcome!</Text>, null,
    ...botRows('trust'), null,
    <Text bold color={WHITE} wrap="truncate-end">{model}</Text>,
    <Text color={C.dim}>wakes up after you say yes</Text>, null,
  ];
  const right = [
    <Heading color={C.warn}>Quick safety check</Heading>,
    <Labelled label="folder">{fitPath(cwd, RW - 10)}</Labelled>,
    <Labelled label="" color={C.warn}>not trusted yet · nothing read here yet</Labelled>,
    <Text> </Text>,
    ...wrap(TRUST_TEXT, RW - 1).map((l) => <Text>{l}</Text>),
    <Text> </Text>,
    ...TRUST_OPTIONS.map((o, i) => <Text color={i === selected ? C.ask : undefined}>{i === selected ? '❯' : ' '} {i + 1}. {o}</Text>),
    <Text color={C.dim}>Enter to confirm · Esc to exit</Text>,
  ];
  return (
    <Box flexDirection="column" width={width}>
      <TitleLine width={width} />
      <Text> </Text>
      <Split width={width} left={keyed(left)} right={keyed(right)} />
    </Box>
  );
}

// Where to start, in the same columns: `coding` typed in the home folder asks which folder to
// work in before anything is read (start-folder.mjs). Each folder is a card (2 Oct 2026, the
// owner's pick "1 · Cards"): the folder and what it is, what it suits, then what the app already
// knows of it (folderFacts): its conversations and whether a yes covers it. The card picked has
// its border lit in the choice colour. The right column is as tall as the bot's, so both end together.
const FOLDER_TEXT = 'It reads, searches and runs things in one folder. You typed coding in your home folder, so it asks which one first.';
const FOLDER_KEYS = [['↑↓', 'choose'], ['enter', 'start here'], ['esc', 'exit']];
const CARD_EDGE = 'ansi256(238)';
const span = (segs) => segs.reduce((n, [t]) => n + t.length, 0);
// Pieces [text, colour, bold] on the left and on the right, spaces between: `w` columns in all.
const spread = (left, right, w) => [...left, [' '.repeat(Math.max(1, w - span(left) - span(right)))], ...right];
const pieces = (segs) => segs.map(([t, c, b], i) => <Text key={i} color={c} bold={Boolean(b)}>{t}</Text>);
// A card, drawn a row at a time (Split lines its columns up row by row), `w` columns wide.
export function folderCard(f, i, on, w, now = Date.now()) {
  const edge = on ? C.ask : CARD_EDGE;
  const inner = w - 4;
  const row = (segs) => <Text><Text color={edge}>│ </Text>{pieces(segs)}<Text color={edge}> │</Text></Text>;
  const title = spread(
    [[on ? '❯ ' : '  ', C.ask], [`${i + 1}  `, on ? C.ask : C.faint], [fitPath(f.shown, inner - 6 - f.what.length), on ? WHITE : PATH, true]],
    [[f.what, on ? PATH : C.dim]], inner);
  const trust = f.trusted ? ['✓ trusted', on ? C.accent : C.accentDim] : ['safety check next', C.warn];
  const convs = f.convs ? plural(f.convs, 'conversation') : 'no conversations yet';
  const long = f.convs && f.last ? `${convs} · last ${ago(f.last, now)}` : convs;
  const known = 5 + long.length + 1 + trust[0].length <= inner ? long : convs;
  return [
    <Text color={edge}>╭{'─'.repeat(w - 2)}╮</Text>,
    row(title),
    row(spread([['     '], [cut(f.good ?? '', inner - 5), on ? PATH : C.dim]], [], inner)),
    row(spread([['     '], [known, C.dim]], [trust], inner)),
    <Text color={edge}>╰{'─'.repeat(w - 2)}╯</Text>,
  ];
}
// folders: startFolders' rows with folderFacts' (convs, last, trusted).
export function FolderPage({ width, folders, model, selected = 0, now = Date.now() }) {
  const L = leftWidth(width);
  const RW = Math.max(10, width - L - 3);
  const left = [
    <Text bold color={WHITE}>Welcome!</Text>, null,
    ...botRows('trust'), null,
    <Text bold color={WHITE} wrap="truncate-end">{model}</Text>,
    <Text color={C.dim}>wakes up where you pick</Text>, null,
  ];
  const right = [
    <Heading>Where should it work?</Heading>,
    ...wrap(FOLDER_TEXT, RW - 2).map((l) => <Text color={C.dim}>{l}</Text>),
    <Text> </Text>,
    ...folders.flatMap((f, i) => folderCard(f, i, i === selected, RW - 1, now)),
    keysLine(FOLDER_KEYS, RW - 2),
  ];
  return (
    <Box flexDirection="column" width={width}>
      <TitleLine width={width} />
      <Text> </Text>
      <Split width={width} left={keyed(left)} right={keyed(right)} />
    </Box>
  );
}
