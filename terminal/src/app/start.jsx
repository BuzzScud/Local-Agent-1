// The start page (29 Sep 2026, the user's pick: "like Claude", open; upgraded 1 Oct, "1 · Studio").
// No box: a titled line, then two columns. Left, centred: a greeting, the Visor bot, the model and
// its state (off, the start's steps, ready). Right: Recent activity with each one's prompts, This
// folder as labelled rows, a Try row of keys. Until your first message the page stays live (Screen
// holds it back from the scrollback), so the bot and the state line follow the model: asleep and
// "off", then the steps after /start, then ready. Your first message prints it once. The safety
// check (cli.jsx) uses the same columns. The tips live on the line under the prompt box (startTip).
import React from 'react';
import { Box, Text } from 'ink';
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
  'shift+tab switches between ask first, auto-edit and plan',
  '/resume picks up an earlier conversation',
  'esc twice rewinds the files and the conversation',
  '! runs a shell command yourself',
  '/btw asks a side question without stopping the work',
];
export const INIT_TIP = '/init writes an AGENTS.md with notes about this project';
// AGENTIC_TIPS=off leaves the line as "? for shortcuts" (the app's tests set it: a random tip would
// change every screen they read).
export const tipsOn = (env = process.env) => !/^(off|0|false|no)$/i.test(env.AGENTIC_TIPS ?? '');
export const startTip = (start, pick = (xs) => xs[Math.floor(Math.random() * xs.length)]) => (!tipsOn() ? null : start?.notes?.includes('AGENTS.md') ? pick(TIPS) : INIT_TIP);

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
// A shape lit from the top left: tones = [rim light, top, middle, bottom, shadow rim].
function shade(px, pts, tones) {
  const inn = edgeOf(pts);
  const ys = pts.map(([, y]) => y), top = Math.min(...ys), span = Math.max(1, Math.max(...ys) - top);
  for (const [x, y] of pts) {
    const t = (y - top) / span;
    let c = t < 0.34 ? tones[1] : t < 0.7 ? tones[2] : tones[3];
    if (!inn(x, y + 1) || !inn(x + 1, y)) c = tones[4];
    if (!inn(x, y - 1) || (!inn(x - 1, y) && t < 0.6)) c = tones[0];
    px[y][x] = c;
  }
}
const AWAKE = { helm: [255, 255, 253, 250, 246], body: [254, 252, 250, 248, 244], arm: [252, 250, 248, 247, 244], foot: [250, 248, 246, 244, 241], visor: 233, rim: 236, glint: 239, glint2: 237, pod: 248, podShade: 245, neck: 242, panel: 234, stripOff: 237, hand: 246, leg: 245 };
const ASLEEP = { helm: [249, 248, 246, 244, 241], body: [247, 246, 244, 243, 240], arm: [246, 245, 243, 242, 240], foot: [244, 243, 241, 240, 238], visor: 233, rim: 235, glint: 237, glint2: 235, pod: 243, podShade: 241, neck: 239, panel: 234, stripOff: 236, hand: 241, leg: 240 };
export const BOT_STRIP_ROW = 15; // the chest strip's pixel row, x 7–14
// state: 'off' | 'trust' | 'loading' | 'ready'; k: the step while it loads (two a second).
// The pixels' colours (xterm-256 numbers), null where the window shows through.
export function botPixels(state, k = 0) {
  const px = Array.from({ length: BOT_H }, () => Array(BOT_W).fill(null));
  const asleep = state === 'off' || state === 'trust', ready = state === 'ready';
  const P = asleep ? ASLEEP : AWAKE;
  const pulse = (steps) => steps[k % steps.length];
  fill(px, [[10, 0], [11, 0]], asleep ? 240 : ready ? 114 : pulse([71, 114, 120, 157, 120, 114])); // the antenna's light
  fill(px, [[10, 1]], P.helm[2]); fill(px, [[11, 1]], P.helm[4]);
  const ear = asleep ? 239 : ready ? 114 : (k % 4 < 2 ? 120 : 71);
  for (const x of [1, BOT_W - 2]) fill(px, [5, 6, 7, 8].map((y) => [x, y]), x === 1 ? P.pod : P.podShade);
  for (const x of [0, BOT_W - 1]) fill(px, [[x, 6], [x, 7]], ear);
  shade(px, roundRect(2, 2, 19, 11, 4), P.helm);
  // the visor set into the helmet: its rim dark at the bottom right, a glint at the top left
  const visor = roundRect(4, 4, 17, 9, 2), inV = edgeOf(visor);
  for (const [x, y] of visor) px[y][x] = !inV(x, y + 1) || !inV(x + 1, y) ? P.rim : P.visor;
  fill(px, [[6, 5], [5, 6]], P.glint); fill(px, [[7, 5], [15, 5]], P.glint2);
  // neck, body, the chest panel with its strip, arms, legs, feet
  fill(px, roundRect(9, 12, 12, 12), P.neck);
  shade(px, roundRect(5, 13, 16, 17, 1), P.body);
  fill(px, roundRect(7, 14, 14, 16), P.panel);
  const lit = ready ? 8 : asleep ? 0 : k % 9;
  for (let i = 0; i < 8; i++) px[BOT_STRIP_ROW][7 + i] = i < lit ? (ready ? 114 : 120) : P.stripOff;
  for (const x of [2, 18]) { shade(px, roundRect(x, 13, x + 1, 16), P.arm); fill(px, [[x, 17], [x + 1, 17]], P.hand); }
  fill(px, [[4, 13], [17, 13]], P.arm[3]);
  fill(px, [[7, 18], [8, 18], [13, 18], [14, 18]], P.leg);
  shade(px, roundRect(5, 19, 9, 19), P.foot); shade(px, roundRect(12, 19, 16, 19), P.foot);
  fill(px, [[9, 19], [16, 19]], P.foot[4]);
  // the face
  const eyes = (pts, c) => fill(px, pts, c);
  const SHUT = [[6, 7], [7, 7], [8, 7], [13, 7], [14, 7], [15, 7]];
  if (state === 'off') {
    eyes(SHUT, 65);
    fill(px, [[18, 0], [19, 0], [20, 0], [21, 0], [20, 1], [19, 2], [18, 3], [19, 3], [20, 3], [21, 3]], 243); // Z
  } else if (state === 'trust') {
    eyes(SHUT.slice(0, 3), 65);
    eyes([[13, 6], [14, 6], [13, 7], [14, 7]], 71);
  } else if (ready) {
    eyes([[6, 7], [7, 6], [8, 6], [9, 7], [12, 7], [13, 6], [14, 6], [15, 7]], 157);
  } else if (k % 10 === 9) {
    eyes([[7, 7], [8, 7], [13, 7], [14, 7]], 120); // a blink
  } else {
    const dx = [0, 0, 1, 1, 0, 0, -1, -1][k % 8]; // it looks right, then left
    for (const x of [7 + dx, 13 + dx]) { eyes([[x + 1, 6], [x, 7], [x + 1, 7]], 120); eyes([[x, 6]], 194); } // a glint in each eye
  }
  return px;
}
// Two pixel rows to a line, drawn so every cell is filled the whole way down: in Terminal.app,
// SF Mono's █ ▀ ▄ cover only the middle 84% of a line (measured from its own font file), which
// left a thin seam under each row of the first bot. A background colour fills the whole cell, so:
// the same colour above and below is a space on that background; two colours are ▄ in the lower
// one on the upper one; the upper one alone is ▄ in the window's colour on it (inverse); the lower
// one alone is ▄.
export function botRows(state, k = 0) {
  const px = botPixels(state, k);
  const rows = [];
  for (let y = 0; y < px.length; y += 2) {
    rows.push(<Text key={`bot${y}`}>{px[y].map((top, x) => {
      const bottom = px[y + 1]?.[x] ?? null;
      if (top == null && bottom == null) return <Text key={x}> </Text>;
      if (top == null) return <Text key={x} color={`ansi256(${bottom})`}>▄</Text>;
      if (bottom == null) return <Text key={x} color={`ansi256(${top})`} inverse>▄</Text>;
      if (bottom === top) return <Text key={x} backgroundColor={`ansi256(${top})`}> </Text>;
      return <Text key={x} color={`ansi256(${bottom})`} backgroundColor={`ansi256(${top})`}>▄</Text>;
    })}</Text>);
  }
  return rows;
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
export function stepsLine(loading, room, k = 0) {
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
// A row on the right: a label, then its value.
const Labelled = ({ label, children, color = PATH }) => <Text wrap="truncate-end"><Text color={C.dim}>{label.padEnd(8)}</Text><Text color={color}>{children}</Text></Text>;
// The keys worth knowing on the first day, as many as fit.
const TRY = [['@', 'a file'], ['!', 'a command'], ['/', 'every command'], ['shift+tab', 'ask · edit · plan'], ['esc esc', 'rewind']];
function tryLine(room) {
  const fit = [];
  let used = 0;
  for (const [key, words] of TRY) {
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
// { phase, secs } while the model loads (the page is live then).
export function StartPage({ start, width, loading = null }) {
  const L = leftWidth(width);
  const RW = Math.max(10, width - L - 3);
  const wide = width >= 100;
  const s = start ?? {};
  // two steps a second: the page is redrawn only when the bot or the seconds move
  const k = loading ? Math.floor(loading.secs * 2) : 0;
  const recent = recentOf(s.recent ?? []);
  const left = [
    <Text bold color={WHITE}>{(s.recent ?? []).length ? 'Welcome back!' : 'Welcome!'}</Text>, null,
    ...botRows(loading ? 'loading' : s.off ? 'off' : 'ready', k), null,
    <Text bold color={WHITE} wrap="truncate-end">{s.model ?? 'the model'}</Text>,
    stateLine(s, loading, L - 2, k, wide),
  ];
  const countW = 10;
  const tW = Math.max(8, RW - 9 - countW - 1);
  const git = gitWords(s.git);
  const rule = <Text color={C.faint}>{'─'.repeat(Math.max(10, RW - 2))}</Text>;
  const right = [
    <Heading>Recent activity</Heading>,
    ...(recent.length
      ? [...recent.map((r) => <Box width={RW - 1}><Box flexGrow={1}><Text wrap="truncate-end"><Text color={C.dim}>{ago(r.updated, s.now).padEnd(9)}</Text><Text color={PATH}>{cut(titleOf(r), tW)}</Text></Text></Box><Text color={C.faint}>{plural(r.turns ?? 1, 'prompt').padStart(countW)}</Text></Box>),
        <Text color={C.dim} wrap="truncate-end"><Text color={WHITE}>/resume</Text> for more · <Text color={WHITE}>coding -c</Text> goes on with the last one</Text>]
      : [<Text color={C.dim}>No conversations here yet</Text>, <Text color={C.dim} wrap="truncate-end"><Text color={WHITE}>/init</Text> writes an AGENTS.md for this project</Text>]),
    rule,
    <Heading>This folder</Heading>,
    <Labelled label="where">{fitPath(where(s.cwd ?? ''), RW - 10)}</Labelled>,
    <Labelled label="git" color={C.dim}>{git === 'no git' ? 'none here' : git.replace(/^git /, '')}</Labelled>,
    <Labelled label="reads" color={C.dim}>{notesWords(s.notes).replace(/^reads /, '')}</Labelled>,
    ...(s.also ?? []).map((l) => <Labelled label="" color={C.dim}>{l}</Labelled>),
    rule,
    <Heading>Try</Heading>,
    tryLine(RW - 2),
  ];
  return (
    <Box flexDirection="column" width={width}>
      <TitleLine width={width} />
      <Text> </Text>
      <Split width={width} left={keyed(left)} right={keyed(right)} />
    </Box>
  );
}

// The safety check, in the start page's columns: the bot peeking, the folder not trusted yet, the
// question with its two answers (selected: the row ❯ marks).
export const TRUST_TEXT = 'Is this a folder you created or one you trust? Agentic Coder reads its notes (AGENTS.md) into the model, and can read, edit and run things here once you allow them. A yes covers this folder and everything inside it, and is remembered.';
export const TRUST_OPTIONS = ['Yes, I trust this folder', 'No, exit'];
export function TrustPage({ width, cwd, model, selected = 0 }) {
  const L = leftWidth(width);
  const RW = Math.max(10, width - L - 3);
  const left = [
    <Text bold color={WHITE}>Welcome!</Text>, null,
    ...botRows('trust'), null,
    <Text bold color={WHITE} wrap="truncate-end">{model}</Text>,
    <Text color={C.dim}>wakes up after you say yes</Text>,
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
