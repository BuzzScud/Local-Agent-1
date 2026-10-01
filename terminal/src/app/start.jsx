// The start page (29 Sep 2026, the user's pick: "like Claude", open). No box: a titled line, then
// two columns. Left, centred: a greeting, the Visor bot, the model and the folder. Right: Recent
// activity, a thin line, This folder. Until your first message the page stays live (Screen holds it
// back from the scrollback), so the bot and the model line follow the model: asleep and "off", then
// what the start waits for after /start, then ready. Your first message prints it once. The safety
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
// no AGENTS.md always gets /init first), and the one said while a first start reads its instructions.
export const TIPS = [
  '@ attaches a file to your message',
  'shift+tab switches between ask first, auto-edit and plan',
  '/resume picks up an earlier conversation',
  'esc twice rewinds the files and the conversation',
  '! runs a shell command yourself',
  '/btw asks a side question without stopping the work',
];
export const INIT_TIP = '/init writes an AGENTS.md with notes about this project';
export const READING_TIP = 'the first start reads its instructions, about 30 s · type meanwhile';
// AGENTIC_TIPS=off leaves the line as "? for shortcuts" (the app's tests set it: a random tip would
// change every screen they read).
export const tipsOn = (env = process.env) => !/^(off|0|false|no)$/i.test(env.AGENTIC_TIPS ?? '');
export const startTip = (start, pick = (xs) => xs[Math.floor(Math.random() * xs.length)]) => (!tipsOn() ? null : start?.notes?.includes('AGENTS.md') ? pick(TIPS) : INIT_TIP);

// The Visor bot (1 Oct 2026, the user's pick after four rounds): a white helmet with a dark screen
// for a face, its eyes drawn on the screen in green light, two ear lights and a chest strip. It
// says what the model is doing: asleep (– –) while it is off, looking about while it loads (the
// ears blink, the strip fills), happy (^ ^) when it is ready, one eye open at the safety check.
// 20 × 14 pixels, two to a character (▀ with a background colour), so 20 columns × 7 rows.
const BOT = [
  '......hhhhhhhh......',
  '....hHHHHHHHHHHH....',
  '...HHVVVVVVVVVVHH...',
  '..eHVVVVVVVVVVVVHe..',
  '..eHVVVVVVVVVVVVHe..',
  '...HVVVVVVVVVVVVH...',
  '...HHVVVVVVVVVVHH...',
  '....GHHHHHHHHHHG....',
  '......GGGGGGGG......',
  '.....BBBBBBBBBB.....',
  '...aaB12345678Baa...',
  '.....BBBBBBBBBB.....',
  '......BB....BB......',
  '.....DDD....DDD.....',
];
const ASLEEP = { h: 248, H: 245, G: 241, V: 234, e: 239, B: 244, a: 242, D: 240 };
const AWAKE = { h: 255, H: 252, G: 246, V: 234, B: 250, a: 248, D: 245 };
const SHUT = [[6, 4], [7, 4], [8, 4], [11, 4], [12, 4], [13, 4]];
// state: 'off' | 'trust' | 'loading' | 'ready'; k: the step while it loads (two a second).
// The pixels' colours (xterm-256 numbers), null where the window shows through.
export function botPixels(state, k = 0) {
  const asleep = state === 'off' || state === 'trust';
  const ready = state === 'ready';
  const pal = asleep ? ASLEEP : { ...AWAKE, e: ready ? 114 : [120, 71][k % 2] };
  const lit = ready ? 8 : asleep ? 0 : k % 9; // the chest strip, lit from the left
  const px = BOT.map((row) => [...row].map((c) => (c === '.' ? null : /\d/.test(c) ? (Number(c) <= lit ? 120 : 237) : pal[c])));
  const eyes = (pts, color) => { for (const [x, y] of pts) px[y][x] = color; };
  if (state === 'off') eyes(SHUT, 65);
  else if (state === 'trust') eyes([...SHUT.slice(0, 3), [11, 3], [12, 3], [11, 4], [12, 4]], 65);
  else if (ready) eyes([[6, 3], [7, 3], [5, 4], [8, 4], [12, 3], [13, 3], [11, 4], [14, 4]], 157);
  else if (k % 10 === 9) eyes(SHUT, 120); // a blink
  else {
    const dx = [0, 0, 1, 1, 0, 0, -1, -1][k % 8]; // it looks right, then left
    eyes([[6, 3], [7, 3], [6, 4], [7, 4], [11, 3], [12, 3], [11, 4], [12, 4]].map(([x, y]) => [x + dx, y]), 120);
  }
  return px;
}
// Two pixel rows to a line: ▀ in the top one's colour on the bottom one's (█, ▀ or ▄ alone when
// one of them is empty or both match).
export function botRows(state, k = 0) {
  const px = botPixels(state, k);
  const rows = [];
  for (let y = 0; y < px.length; y += 2) {
    rows.push(<Text key={`bot${y}`}>{px[y].map((top, x) => {
      const bottom = px[y + 1]?.[x] ?? null;
      if (top == null && bottom == null) return <Text key={x}> </Text>;
      if (top == null) return <Text key={x} color={`ansi256(${bottom})`}>▄</Text>;
      if (bottom == null || bottom === top) return <Text key={x} color={`ansi256(${top})`}>{bottom == null ? '▀' : '█'}</Text>;
      return <Text key={x} color={`ansi256(${top})`} backgroundColor={`ansi256(${bottom})`}>▀</Text>;
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

// What the model line says while it loads: the start's phase (App's startPhase) and its seconds,
// in the longest words that fit the column (a long model name gets the short ones).
const PHASE = { loading: ['loading the model', 'loading'], reading: ['reading instructions', 'reading'], restoring: ['restoring instructions', 'restoring'], waiting: ['waiting for memory', 'waiting'] };
function phaseWords(name, phase, secs, room) {
  const [long, short] = PHASE[phase] ?? PHASE.loading;
  const s = `${Math.floor(secs)}s`;
  const ways = [[long, ` · ${s}`], [short, ` · ${s}`], [short, ` ${s}`], ['', s]];
  return ways.find(([w, t]) => `${name} · ${w}${t}`.length <= room) ?? ways.at(-1);
}

// start: { model, effort, ctx, cwd, git, notes, also, recent, now, off } (off: the model is not loaded; also: this folder's own settings
// file and a start-up mode saved with /permissions, a line each). loading: null once ready, or
// { phase, secs } while the model loads (the page is live then).
export function StartPage({ start, width, loading = null }) {
  const L = leftWidth(width);
  const RW = Math.max(10, width - L - 3);
  const wide = width >= 100;
  const s = start ?? {};
  const name = s.model ?? 'the model';
  const ctxK = s.ctx ? `${Math.round(s.ctx / 1024)}k` : '';
  // off: the model is not loaded (it waits for /start), said in the longest words that fit.
  const offWords = ['/start loads it', '/start', ''].find((w) => `${name} · off${w ? ` · ${w}` : ''}`.length <= L - 1) ?? '';
  const modelLine = loading
    ? (() => { const [w, t] = phaseWords(name, loading.phase, loading.secs, L - 1); return <Text wrap="truncate-end"><Text color={WHITE}>{name}</Text><Text color={C.dim}> · </Text><Text color={C.accent}>{w}</Text><Text color={C.dim}>{t}</Text></Text>; })()
    : s.off
    ? <Text wrap="truncate-end"><Text color={WHITE}>{name}</Text><Text color={C.dim}> · off</Text>{offWords ? <><Text color={C.dim}> · </Text><Text color={C.accent}>{offWords}</Text></> : null}</Text>
    : <Text wrap="truncate-end"><Text color={WHITE}>{name}</Text><Text color={C.dim}>{s.effort ? ` · ${wide ? `effort ${s.effort}` : s.effort}` : ''}{ctxK ? ` · ${ctxK}` : ''}</Text></Text>;
  const recent = recentOf(s.recent ?? []);
  const left = [
    <Text bold color={WHITE}>{(s.recent ?? []).length ? 'Welcome back!' : 'Welcome!'}</Text>, null,
    // two steps a second: the page is redrawn only when the bot or the seconds move
    ...botRows(loading ? 'loading' : s.off ? 'off' : 'ready', loading ? Math.floor(loading.secs * 2) : 0), null,
    modelLine,
    <Text color={PATH} wrap="truncate-end">{fitPath(where(s.cwd ?? ''), L - 2)}</Text>,
  ];
  const tW = Math.max(8, RW - 10 - 1);
  const right = [
    <Heading>Recent activity</Heading>,
    ...(recent.length
      ? [...recent.map((r) => <Text wrap="truncate-end"><Text color={C.dim}>{ago(r.updated, s.now).padEnd(10)}</Text><Text color={PATH}>{cut(titleOf(r), tW)}</Text></Text>), <Text color={C.dim}>/resume for more</Text>]
      : [<Text color={C.dim}>No conversations here yet</Text>, <Text color={C.dim} wrap="truncate-end">/init writes an AGENTS.md for this project</Text>]),
    <Text color={C.faint}>{'─'.repeat(Math.max(10, RW - 2))}</Text>,
    <Heading>This folder</Heading>,
    <Text color={C.dim} wrap="truncate-end">{gitWords(s.git)}</Text>,
    <Text color={C.dim} wrap="truncate-end">{notesWords(s.notes)}</Text>,
    ...(s.also ?? []).map((l) => <Text color={C.dim} wrap="truncate-end">{l}</Text>),
  ];
  return (
    <Box flexDirection="column" width={width}>
      <TitleLine width={width} />
      <Text> </Text>
      <Split width={width} left={left.map((el, i) => el && React.cloneElement(el, { key: i }))} right={right.map((el, i) => React.cloneElement(el, { key: i }))} />
    </Box>
  );
}

// The safety check, in the start page's columns: the bot peeking, nothing read yet, the question on
// the right with its two answers (selected: the row ❯ marks).
export const TRUST_TEXT = 'Is this a folder you created or one you trust? Agentic Coder reads its notes (AGENTS.md) into the model, and can read, edit and run things here once you allow them. A yes covers this folder and everything inside it, and is remembered.';
export const TRUST_OPTIONS = ['Yes, I trust this folder', 'No, exit'];
export function TrustPage({ width, cwd, model, selected = 0 }) {
  const L = leftWidth(width);
  const RW = Math.max(10, width - L - 3);
  const left = [
    <Text bold color={WHITE}>Welcome!</Text>, null,
    ...botRows('trust'), null,
    <Text color={WHITE} wrap="truncate-end">{model}</Text>,
    <Text color={C.dim}>loads after you say yes</Text>, null,
    <Text color={PATH} wrap="truncate-end">{fitPath(cwd, L - 2)}</Text>,
    <Text color={C.warn}>not trusted yet</Text>,
    <Text color={C.dim}>nothing read here yet</Text>,
  ];
  const right = [
    <Heading color={C.warn}>Quick safety check</Heading>,
    ...wrap(TRUST_TEXT, RW - 1).map((l) => <Text>{l}</Text>),
    <Text> </Text>,
    ...TRUST_OPTIONS.map((o, i) => <Text color={i === selected ? C.ask : undefined}>{i === selected ? '❯' : ' '} {i + 1}. {o}</Text>),
    <Text color={C.dim}>Enter to confirm · Esc to exit</Text>,
  ];
  return (
    <Box flexDirection="column" width={width}>
      <TitleLine width={width} />
      <Text> </Text>
      <Split width={width} left={left.map((el, i) => el && React.cloneElement(el, { key: i }))} right={right.map((el, i) => React.cloneElement(el, { key: i }))} />
    </Box>
  );
}
