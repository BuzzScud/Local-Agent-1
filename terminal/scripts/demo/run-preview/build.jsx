// The countdown-card run of 1 Oct 2026 (Bonsai 2 27B, 16k, thinking cap 4,096), replayed
// through the app's real screen twice: Now (the main folder's code) and New (this worktree).
// Times are from the model server's log, the words and steps from the saved session.
// Writes one page to docs/design rounds. Run: FORCE_COLOR=2 bun terminal/scripts/demo/run-preview/build.jsx
import React from 'react';
import { renderToString } from 'ink';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { docsPath, mainFolder } from '../../../../docs/tools/to-docs.mjs';
import { Screen as NewScreen } from '../../../src/app/screen.jsx';

if (process.env.FORCE_COLOR !== '2') throw new Error('run with FORCE_COLOR=2 (Apple Terminal = 256 colours)');
const MAIN = mainFolder();
const nowHead = execSync(`git -C "${MAIN}" log -1 --format=%h`).toString().trim();
const dirty = execSync(`git -C "${MAIN}" status --short -- terminal/src`).toString().trim();
if (dirty) console.warn(`note: the main folder has changes in terminal/src; Now draws them too:\n${dirty}`);
const { Screen: NowScreen } = await import(join(MAIN, 'terminal/src/app/screen.jsx'));

const COLS = 104;
const ROWS = 30;
const BASE = 1_000_000_000;
const T0 = new Date('2026-10-01T11:28:52');
const session = JSON.parse(readFileSync(join(homedir(), '.agentic-coder/sessions/Users-christiantavarez/2026-10-01T15-22-52-234Z.json'), 'utf8'));
const rec = Object.fromEntries(session.items.map((it) => [it.key, it]));
// The file as the Write saved it (the saved session keeps every line; the file on the Desktop
// has since had its 7 leaked lines taken out).
const fileLines = rec.i18.view.hunk.filter((l) => l.type === '+').map((l) => l.text);
const file = fileLines.join('\n');
const clean = fileLines.slice(0, 188).join('\n'); // 189–195 are the leaked tool-call lines
const argsOf = (content) => `{"path":"Desktop/countdown-card.html","content":"${JSON.stringify(content).slice(1, -1)}`;
const ROOM = 6144; // 2,048 answer + 4,096 thinking cap
const CAP = 4096;
const STEPPED = 64; // thinking cap once half the request's time is gone
const START = 7065; // tokens of the request's start, first call
const RESTART = 7300; // after each restart from notes

// ── the run, second by second from 11:28:52 ──────────────────────────────────
const NO_THOUGHT = "(This try's thinking was not saved by the app. The log gives only the reply's total: 6,144 tokens.)";
const P = [
  { from: 0, to: 3, kind: 'lookup' },
  { from: 3, to: 55, kind: 'reading' },
  { from: 55, to: 405, kind: 'think', n: 3900, cap: CAP, text: NO_THOUGHT },
  { from: 405, to: 581, kind: 'write', n: 2000, pre: 3900, content: clean, cap: CAP },
  { from: 581, to: 687, kind: 'notes', stale: true },
  { from: 687, to: 737, kind: 'reading' },
  { from: 737, to: 745, kind: 'think', n: STEPPED, cap: STEPPED, text: rec.i17.text },
  { from: 745, to: 903, kind: 'write', n: 1940, pre: STEPPED, content: file, cap: STEPPED },
  { from: 903, to: 914, kind: 'running', label: 'Write', arg: 'Desktop/countdown-card.html' },
  { from: 914, to: 1016, kind: 'notes' },
  { from: 1016, to: 1054, kind: 'summary' },
  { from: 1054, to: 1184, kind: 'reading' },
  { from: 1184, to: 1193, kind: 'think', n: STEPPED, cap: STEPPED, text: rec.i22.text },
  { from: 1193, to: 1195, kind: 'running', label: 'Read', arg: 'Desktop/countdown-card.html' },
  { from: 1195, to: 1395, kind: 'notes' },
  { from: 1395, to: 1439, kind: 'summary' },
  { from: 1439, to: 1575, kind: 'reading' },
  { from: 1575, to: 1583, kind: 'think', n: STEPPED, cap: STEPPED, text: rec.i27.text },
  { from: 1583, to: 1584, kind: 'running', label: 'List', arg: 'Desktop' },
  { from: 1584, to: 1784, kind: 'notes' },
  { from: 1784, to: 1916, kind: 'reading' },
  { from: 1916, to: 1920, kind: 'think', n: 44, cap: STEPPED, text: rec.i30.text },
  { from: 1920, to: 1927, kind: 'running', label: 'Read', arg: 'Desktop/countdown-card.html' },
  { from: 1927, to: 1991, kind: 'notes' },
];
const END = 1991;

// What each side prints, and when. New: the same events in the new words (agent.mjs).
const note = (text, tone = 'dim') => ({ type: 'note', rail: true, text, tone });
const E = [
  { at: 0, both: { ...rec.i11 } },
  { at: 3, both: { ...rec.i12 } },
  { at: 581, now: rec.i13, neu: note('File too long for one reply (cut at 6.1k of 6.1k tokens): asked it to build countdown-card.html in parts') },
  { at: 581, now: rec.i14, neu: note('Memory full (1): saving notes, then carrying on') },
  { at: 687, now: rec.i15, neu: note('Picked up from its notes (1)') },
  { at: 687, now: rec.i16, neu: note('Half of the 15 minutes for this request used: thinking briefly from here, to finish in time') },
  { at: 745, both: rec.i17 },
  { at: 914, both: rec.i18 },
  { at: 914, now: rec.i19, neu: note('Memory full (2): saving notes, then carrying on') },
  { at: 1016, neu: note('Notes came out empty: freeing memory another way') },
  { at: 1016, now: rec.i20, neu: note('Summarizing the conversation to free memory…') },
  { at: 1054, now: rec.i21, neu: note('Summarized (1), carrying on') },
  { at: 1193, both: rec.i22 },
  { at: 1195, both: rec.i23 },
  { at: 1195, now: rec.i24, neu: note('Memory full (3): saving notes, then carrying on') },
  { at: 1395, neu: note('Notes came out empty: freeing memory another way') },
  { at: 1395, now: rec.i25, neu: note('Summarizing the conversation to free memory…') },
  { at: 1439, now: rec.i26, neu: note('Summarized (2), carrying on') },
  { at: 1583, both: rec.i27 },
  { at: 1584, both: rec.i28 },
  { at: 1584, now: rec.i29, neu: note('Memory full (4): saving notes, then carrying on') },
  { at: 1784, neu: note('Notes came out empty: freeing memory another way') },
  { at: 1920, both: rec.i30 },
  { at: 1922, both: rec.i31 },
  { at: 1927, now: rec.i32, neu: note('Memory full (5): saving notes, then carrying on') },
];

const phaseAt = (t) => P.find((p) => t >= p.from && t < p.to) ?? null;
const frac = (p, t) => Math.min(1, Math.max(0, (t - p.from) / (p.to - p.from)));
// Tokens streamed to the screen by `t` (the spinner's ↓ count).
const tokensBy = (t) => P.filter((p) => p.n).reduce((s, p) => s + Math.round(p.n * frac(p, t)), 0);
// What the app counted as used: the start plus this reply so far; frozen until a restart.
function ctxAt(t) {
  let used = START;
  for (const p of P) {
    if (p.from > t) break;
    if (p.kind === 'reading' && p.from > 0) used = RESTART;
    if (p.n) used += Math.round(p.n * frac(p, t)) + (p.kind === 'write' ? 0 : 0);
    if (p.kind === 'running' && t >= p.to) used += 250; // the tool's output
  }
  return used;
}

// A step that streams: the live fields the App keeps (App.jsx `stream`).
function streamLive(p, t, now) {
  const f = frac(p, t);
  const n = Math.round(p.n * f);
  const secs = Math.max(0.001, t - p.from);
  const base = { waiting: false, firstTokenAt: BASE + p.from * 1000, lastTokenAt: now, liveTps: secs > 0.7 ? n / secs : null, thinkCap: p.cap, room: ROOM };
  if (p.kind === 'think') {
    const text = p.text.slice(0, Math.max(1, Math.round(p.text.length * f)));
    return { ...base, streamTokens: n, thinking: { text, startedAt: BASE + p.from * 1000, tokens: n } };
  }
  const content = p.content.slice(0, Math.round(p.content.length * f));
  return { ...base, streamTokens: p.pre + n, writing: { name: 'Write', args: argsOf(content), tokens: n } };
}

function liveAt(t, side) {
  const now = BASE + t * 1000;
  const live = { phase: 'working', rail: true, verb: 'Computing', past: 'Computed', turnStart: BASE, tokens: tokensBy(t), stepStart: now, pre: null };
  if (t >= END) return { phase: 'idle' };
  const p = phaseAt(t);
  if (!p) return { ...live, waiting: true, lastTokenAt: null };
  live.stepStart = BASE + p.from * 1000;
  if (p.kind === 'lookup' || p.kind === 'reading') return { ...live, waiting: true, lastTokenAt: null };
  if (p.kind === 'think' || p.kind === 'write') return { ...live, ...streamLive(p, t, now) };
  if (p.kind === 'running') return { ...live, waiting: false, lastTokenAt: BASE + p.from * 1000, running: { label: p.label, arg: p.arg } };
  // Notes and summaries stream nothing to the screen. Today the cut-off Write's row stays up
  // (its reply never reached 'assistant', which clears it).
  if (side === 'now' && p.stale) {
    const w = P[P.indexOf(p) - 1];
    return { ...live, ...streamLive(w, w.to, BASE + w.to * 1000), lastTokenAt: BASE + w.to * 1000, liveTps: null };
  }
  return { ...live, waiting: false, lastTokenAt: BASE + p.from * 1000, task: p.kind === 'notes' ? 'saving notes' : 'summarizing' };
}

function itemsAt(t, side) {
  const out = [];
  E.forEach((e, i) => {
    if (e.at > t) return;
    const it = e.both ?? (side === 'now' ? e.now : e.neu);
    if (it) out.push({ ...it, key: `e${i}` });
  });
  if (t >= END) out.push({ key: 'end', type: 'done', rail: true, reason: 'interrupted', at: T0.getTime() + END * 1000, secs: END });
  return out;
}

function appAt(t, side, extra = {}) {
  const now = BASE + t * 1000;
  return {
    width: COLS, rows: ROWS, now, modelName: 'Bonsai 2 27B', cwd: homedir(), cwdShort: '~', redraw: 0, mode: 'ask',
    input: { value: '', cursor: 0 }, placeholder: 'Try "fix the failing tests"', ctx: 16384, spinner: 'orbit',
    stats: { ctxUsed: ctxAt(t), replyRoom: side === 'new' ? ROOM : undefined },
    modelState: { state: 'on', name: 'Bonsai 2 27B', gb: 9.6 }, mac: { total: 16 * 2 ** 30, avail: 0.9 * 2 ** 30, level: 2 },
    items: itemsAt(t, side), live: liveAt(t, side), ...extra,
  };
}

// The window as the terminal shows it: the conversation from the top (scrolled once it is
// taller), blank lines, then the prompt box and the lines under it on the last rows.
function draw(Screen, app) {
  const out = renderToString(<Screen app={app} />, { columns: COLS }).split('\n');
  const box = out.findIndex((l) => l.includes('╭'));
  const top = box >= 0 ? out.slice(0, box) : out;
  const bottom = box >= 0 ? out.slice(box) : [];
  const room = ROWS - 1 - bottom.length;
  const shown = top.length > room ? top.slice(top.length - room) : [...top, ...Array(room - top.length).fill('')];
  return [...shown, ...bottom].join('\n');
}

// ── frames ───────────────────────────────────────────────────────────────────
const times = new Set();
for (let t = 0; t <= END + 4; t += 2) times.add(t);
for (const p of P) { times.add(p.from); times.add(p.from + 0.5); times.add(Math.max(p.from, p.to - 0.01)); }
for (const e of E) times.add(e.at);
times.add(680); // the screenshot: 11m 20s in
const ts = [...times].filter((t) => t >= 0 && t <= END + 4).sort((a, b) => a - b);
const pool = [];
const ids = new Map();
const keep = (s) => { if (!ids.has(s)) { ids.set(s, pool.length); pool.push(s); } return ids.get(s); };
const frames = ts.map((t) => [t, keep(draw(NowScreen, appAt(t, 'now'))), keep(draw(NewScreen, appAt(t, 'new')))]);
console.log(`${frames.length} frames, ${pool.length} distinct screens`);

// ── with the fixes: planned, drawn by the new screen ─────────────────────────
const planned = [
  {
    title: 'Before it starts: one warning, no loop',
    text: 'Done by another session (commit 42ade27). Its start (instructions, request, notes and cards) leaves no room at 16k, so notes would free nothing. It says so once, carries on without notes, and shrinks the thinking to what fits (here about 3.7k instead of 4.1k).',
    t: 40, items: [{ ...rec.i11 }, { ...rec.i12 }, note("The 16k memory is nearly all taken by this request's start (about 8,365 tokens: the instructions, the request and what came with it), so notes would free nothing; carrying on without them. A bigger memory in /effort gives it room.", 'warn')],
  },
  {
    title: 'Thinking: the cap meter turns orange near the end',
    text: 'Try 1 spent about 3.9k of its 4.1k thinking cap before the Write began, so the file had about 2k tokens left. The meter shows that while it happens.',
    t: 380, items: [{ ...rec.i11 }, { ...rec.i12 }],
  },
  {
    title: 'Writing: the reply-room meter shows the cut coming',
    text: 'At 85% of the reply room the meter turns orange and says "near the limit". Try 1 crossed it about a minute before it was cut.',
    t: 560, items: [{ ...rec.i11 }, { ...rec.i12 }],
  },
  {
    title: 'After a cut: what was written is kept and finished',
    text: 'Built in this change: the whole lines already written are saved through the usual Write (it asks as ever), and the next reply carries on from line 189 with Edit instead of starting over. Tested with a stand-in model; not yet run on Bonsai.',
    t: 600, items: [{ ...rec.i11 }, { ...rec.i12 }, note('File too long for one reply (cut at 5.9k of 6.1k tokens): saving its first 188 lines, then carrying on from there'), { ...rec.i18, view: { ...rec.i18.view, hunk: rec.i18.view.hunk.slice(0, 189), additions: 188 } }],
  },
  {
    title: 'Leaked tool-call text: turned back, never saved',
    text: "Done by another session (commit 42ade27). Try 2's Write ended with its next call (lines 189–195). The Write is turned back at the first such line and the model sends it again without them.",
    t: 914, items: [{ ...rec.i11 }, { ...rec.i12 }, { ...rec.i17 }, { type: 'tool', rail: true, label: 'Write', arg: 'Desktop/countdown-card.html', view: { kind: 'error', message: 'Turned back: line 190 is tool-call text (</function>)' }, error: true }],
  },
].map((f) => {
  const app = appAt(f.t, 'new');
  app.items = f.items.map((it, i) => ({ ...it, key: `p${i}` }));
  if (f.t === 914 || f.t === 600) app.live = { phase: 'working', rail: true, verb: 'Computing', turnStart: BASE, tokens: 4100, stepStart: BASE + f.t * 1000, waiting: true, lastTokenAt: null };

  return { title: f.title, text: f.text, screen: draw(NewScreen, app) };
});

// ── the page ─────────────────────────────────────────────────────────────────
const data = {
  frames, pool, end: END, t0: T0.getTime(), shot: 680, nowHead,
  chapters: [
    { at: 0, label: 'Request' }, { at: 300, label: 'Try 1 thinks' }, { at: 470, label: 'Try 1 writes' },
    { at: 680, label: 'Your screenshot' }, { at: 800, label: 'Try 2 saves the file' }, { at: 1000, label: 'The loop' }, { at: END, label: 'Esc' },
  ],
  planned,
};
const packed = gzipSync(Buffer.from(JSON.stringify(data))).toString('base64');
const tpl = readFileSync(new URL('./page.html', import.meta.url), 'utf8');
const html = tpl.replace('__DATA__', packed).replace(/__NOWHEAD__/g, nowHead);
const target = docsPath('design rounds/live-run-screen-preview-2026-10-01.html');
writeFileSync(target, html);
console.log(`${target} · ${(html.length / 1024).toFixed(0)} KB`);
