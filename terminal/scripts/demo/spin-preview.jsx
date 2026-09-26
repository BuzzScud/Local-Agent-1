// The working icon's design round as one page: the app's own live area (the
// Spinner line, "∴ Thinking…", the running tool) rendered by Ink in 256 colours
// for every 40 ms of one turn, in each look, plus each look's frames drawn large.
// Writes to the DOCS folder. Run: FORCE_COLOR=2 bun terminal/scripts/demo/spin-preview.jsx
import React from 'react';
import { Box, renderToString } from 'ink';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { homedir } from 'node:os';
import { Item, LiveArea } from '../../src/app/screen.jsx';
import { SPINNERS, spinFrame } from '../../src/ui/theme.mjs';
import { TURN, TOTAL, turnAt } from './spin.jsx';
import { docsPath } from '../../../docs/to-docs.mjs';

if (process.env.FORCE_COLOR !== '2') throw new Error('run with FORCE_COLOR=2 (Apple Terminal = 256 colours)');
const COLS = 64;
const STEP = 0.04;
const BASE = 1_000_000;
const LOOKS = ['classic', 'bloom', 'orbit'];
const ASK = 'fix the failing test in export.mjs';
const REPLY = 'The test expects `total` to leave out cancelled trades, but `sumTrades` adds every row. I will filter the cancelled ones out first, then run the tests again.';
const ansiNum = (c) => Number(/ansi256\((\d+)\)/.exec(c)[1]);

// What the screen holds at `t`: the lines already printed above, and the live state.
function stateAt(t, look) {
  const { tokens, lastAt, phase, inPhase } = turnAt(t);
  const done = (key) => t >= TURN.slice(0, TURN.findIndex((p) => p.key === key) + 1).reduce((a, p) => a + p.secs, 0);
  const items = [{ key: 'u', type: 'user', text: ASK }];
  if (done('think')) items.push({ key: 'th', type: 'thinking', secs: 5 });
  if (done('tool')) items.push({ key: 'rd', type: 'tool', label: 'Read', arg: 'export.mjs', view: { kind: 'read', lines: 19, total: 19 } });
  const live = { phase: 'working', turnStart: BASE, verb: 'Baking', tokens, lastTokenAt: lastAt == null ? null : BASE + lastAt * 1000 };
  if (phase.key === 'think') live.thinking = { text: '…', startedAt: BASE + 3000 };
  if (phase.key === 'tool') live.running = { label: 'Read', arg: 'export.mjs' };
  if (phase.key === 'write' && inPhase) live.text = REPLY.slice(0, inPhase * 4);
  return { items, app: { live, now: BASE + t * 1000, width: COLS, rows: 43, perm: null, spinner: look } };
}

const n = Math.round(TOTAL / STEP);
const screens = {};
const icons = {};
for (const look of LOOKS) {
  screens[look] = [];
  icons[look] = [];
  for (let i = 0; i < n; i++) {
    const t = i * STEP;
    const { items, app } = stateAt(t, look);
    screens[look].push(renderToString(
      <Box flexDirection="column" width={COLS}>
        {items.map((it) => <Box key={it.key} flexDirection="column" marginBottom={1} width={COLS}><Item it={it} width={COLS} model="Bonsai 2 27B" cwd="~/demo" loaded="" /></Box>)}
        <LiveArea app={app} />
      </Box>,
      { columns: COLS },
    ));
    const f = spinFrame(look, t, { tokens: app.live.tokens, sinceToken: app.live.lastTokenAt ? (app.now - app.live.lastTokenAt) / 1000 : Infinity });
    icons[look].push([f.glyph, ansiNum(f.color)]);
  }
}

const hex2 = (v) => v.toString(16).padStart(2, '0');
const lv = [0, 95, 135, 175, 215, 255];
const hexOf = (c) => { const k = c - 16; return `#${hex2(lv[Math.floor(k / 36)])}${hex2(lv[Math.floor(k / 6) % 6])}${hex2(lv[k % 6])}`; };
const LOOK_INFO = {
  classic: { title: 'Now', tag: "Claude Code's star", idea: 'A star that grows and shrinks, always the same green. The same icon as Claude Code.', facts: ['10 frames, 8 a second', 'one colour'] },
  bloom: { title: '1 · Bloom', tag: 'a flower that breathes', idea: 'A flower that opens and closes, getting brighter as it opens. Slow and calm: one breath every 1.2 seconds. Moves on the clock only.', facts: ['6 frames, 5 a second', 'green 65 → 120 → 65'] },
  orbit: { title: '2 · Orbit', tag: 'moves with every token', idea: 'Dots going round. Each token Bonsai writes moves them one step, so the icon runs fast and bright while it writes, and drifts slowly, dimmer, while it reads or a tool runs.', facts: ['10 frames', '1 step per token + 3 a second', 'bright writing · dim waiting'] },
};
const looks = LOOKS.map((id) => {
  const s = SPINNERS[id];
  const colors = s.perToken ? s.frames.map(() => 114) : s.frames.map((_, i) => (s.colors ? s.colors[i] : 114));
  return { id, ...LOOK_INFO[id], frames: s.frames, colors: colors.map(hexOf), wait: s.waitColor ? hexOf(s.waitColor) : null };
});
const meta = { step: STEP, total: TOTAL, n, cols: COLS, phases: TURN, looks, pal: Object.fromEntries([65, 71, 114, 120].map((c) => [c, hexOf(c)])), built: new Date().toISOString() };
const payload = gzipSync(JSON.stringify({ screens, icons }), { level: 9 }).toString('base64');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bonsai working icon</title>
<style>
  :root {
    --page: #f3f3f1; --ink: #1d1d1f; --muted: #6b6b70; --line: #d9d9d6; --card: #ffffff;
    --accent: #3f8f3f; --accent-soft: #e4f1e1; --chip: #ecece9; --term: #171717;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --page: #101011; --ink: #ececee; --muted: #9a9aa0; --line: #2c2c30; --card: #18181a;
      --accent: #87d787; --accent-soft: #1c2a1c; --chip: #232326;
    }
  }
  :root[data-theme="dark"] {
    --page: #101011; --ink: #ececee; --muted: #9a9aa0; --line: #2c2c30; --card: #18181a;
    --accent: #87d787; --accent-soft: #1c2a1c; --chip: #232326;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--page); color: var(--ink); }
  body { font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width: 1480px; margin: 0 auto; padding: 22px 16px 40px; }
  h1 { font-size: 20px; margin: 0 0 2px; letter-spacing: -0.01em; }
  h2 { font-size: 13px; margin: 26px 0 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 600; }
  .sub { color: var(--muted); margin: 0; max-width: 900px; }
  code { font: 12.5px ui-monospace, "SF Mono", Menlo, monospace; background: var(--chip); border-radius: 4px; padding: 1px 5px; }
  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  @media (max-width: 1180px) { .grid { grid-template-columns: minmax(0, 1fr); max-width: 640px; } }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px; min-width: 0; }
  .head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
  .head b { font-size: 16px; }
  .head span { color: var(--muted); font-size: 13px; }
  .card.now .head b { color: var(--muted); }
  .stage { background: var(--term); border-radius: 10px; height: 132px; display: flex; align-items: center; justify-content: center; gap: 22px; }
  .big { font: 64px/1 "SF Mono", SFMono-Regular, ui-monospace, Menlo, monospace; width: 1.2em; text-align: center; }
  .small { font: 11px/13px "SF Mono", SFMono-Regular, ui-monospace, Menlo, monospace; color: #fff; white-space: pre; }
  .small .cap { color: #8a8a8a; font-size: 10px; display: block; margin-top: 6px; font-family: -apple-system, sans-serif; }
  .idea { margin: 10px 0 8px; min-height: 60px; }
  .strip { display: flex; flex-wrap: wrap; gap: 4px; }
  .strip i { font: 20px/30px "SF Mono", SFMono-Regular, ui-monospace, Menlo, monospace; font-style: normal; width: 30px; height: 30px; text-align: center;
    background: var(--term); border-radius: 6px; outline: 2px solid transparent; outline-offset: 1px; }
  .strip i.on { outline-color: var(--accent); }
  .facts { color: var(--muted); font-size: 12.5px; margin-top: 8px; }
  .facts span + span::before { content: " · "; }

  .win { border-radius: 10px; overflow: hidden; box-shadow: 0 8px 28px rgba(0,0,0,.28), 0 0 0 1px rgba(0,0,0,.4); min-width: 0; }
  .bar { height: 26px; background: #2d2d2f; display: flex; align-items: center; padding: 0 10px; position: relative; }
  .dots i { display: inline-block; width: 11px; height: 11px; border-radius: 50%; margin-right: 7px; }
  .dots i:nth-child(1) { background: #ff5f57; } .dots i:nth-child(2) { background: #febc2e; } .dots i:nth-child(3) { background: #28c840; }
  .bar .title { position: absolute; left: 0; right: 0; text-align: center; color: #a8a8ab; font-size: 12px; pointer-events: none; }
  .screen { background: var(--term); color: #fff; color-scheme: dark; padding: 4px 6px; overflow: hidden;
    font: 11px/13px "SF Mono", SFMono-Regular, ui-monospace, Menlo, monospace; white-space: pre; font-variant-ligatures: none;
    height: calc(12 * 13px + 8px); display: flex; flex-direction: column; justify-content: flex-end; }
  .screen div { height: 13px; flex: none; }
  .screen .g { display: inline-block; width: 1ch; text-align: center; overflow: visible; }
  .zoom .screen { font-size: 22px; line-height: 26px; height: calc(12 * 26px + 8px); }
  .zoom .screen div { height: 26px; }
  .zoom .grid.terms { grid-template-columns: minmax(0, 1fr); max-width: none; }

  .player { display: flex; align-items: center; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
  .btn { font: inherit; background: var(--card); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: 5px 12px; cursor: pointer; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #0b1a0b; font-weight: 600; min-width: 84px; }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  .seg button { font: inherit; border: 0; background: var(--card); color: var(--muted); padding: 5px 10px; cursor: pointer; }
  .seg button[aria-pressed="true"] { background: var(--chip); color: var(--ink); font-weight: 600; }
  .clock { font: 13px ui-monospace, "SF Mono", Menlo, monospace; color: var(--muted); min-width: 110px; }
  .phases { position: relative; display: flex; height: 40px; flex: 1 1 520px; min-width: 280px; cursor: pointer; border-radius: 8px; overflow: hidden; border: 1px solid var(--line); }
  .ph { position: relative; display: flex; flex-direction: column; justify-content: center; padding: 0 8px; font-size: 12px; line-height: 1.2; overflow: hidden; white-space: nowrap;
    background: var(--chip); color: var(--muted); border-right: 1px solid var(--line); }
  .ph:last-child { border-right: 0; }
  .ph.w { background: var(--accent-soft); color: var(--ink); }
  .ph small { font-size: 11px; color: var(--muted); }
  .head-line { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--ink); pointer-events: none; }
  .now-says { margin-top: 8px; color: var(--muted); }
  .now-says b { color: var(--ink); }

  .notes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  @media (max-width: 1180px) { .notes { grid-template-columns: minmax(0, 1fr); max-width: 640px; } }
  .notes h3 { font-size: 13px; margin: 0 0 6px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .notes p, .notes ul { margin: 0 0 6px; }
  .notes ul { padding-left: 18px; }
  pre { background: var(--chip); border-radius: 8px; padding: 8px 10px; margin: 6px 0; overflow-x: auto; font: 12.5px/1.5 ui-monospace, "SF Mono", Menlo, monospace; }
  .foot { color: var(--muted); font-size: 12.5px; margin-top: 18px; }
</style>
</head>
<body>
<main>
  <h1>Bonsai Code · the working icon: 2 designs</h1>
  <p class="sub">The icon next to <b>Baking…</b> while Bonsai thinks, reads and writes (and on the <b>Starting Bonsai 2 27B…</b> line). Today it is Claude Code's own star. Both designs are real code in the app now, behind a switch; every terminal line on this page is the app's own spinner, drawn by Ink in 256 colours.</p>

  <h2>The three looks</h2>
  <div class="grid" id="looks"></div>

  <h2>In the terminal, at your Terminal's size (SF Mono 11 pt, "Basic")</h2>
  <div class="grid terms" id="terms"></div>
  <div class="player">
    <button class="btn primary" id="play">Pause</button>
    <span class="clock" id="clock">0.0 s</span>
    <div class="phases" id="phases"><span class="head-line" id="headline"></span></div>
    <span class="seg" role="group" aria-label="Size"><button id="z1" aria-pressed="true">Actual size</button><button id="z2" aria-pressed="false">2×</button></span>
  </div>
  <div class="now-says" id="says"></div>

  <h2>Notes</h2>
  <div class="notes">
    <div class="card">
      <h3>Where the icon shows</h3>
      <ul>
        <li>the working line under every turn: <code>✻ Baking… (12s · ↓ 340 tokens · esc to interrupt)</code></li>
        <li>the <code>Starting Bonsai 2 27B…</code> line while the model loads (no tokens yet, so Orbit drifts dim there)</li>
      </ul>
      <p>Not changed yet: the <code>✳</code> on the line a finished turn leaves (<code>✳ Baked for 41s · done 12:58 PM</code>) and the <code>✻</code> in the welcome box. Both are Claude Code's star too.</p>
    </div>
    <div class="card">
      <h3>Try it in your Terminal</h3>
      <p>All three side by side, the same turn as above:</p>
      <pre>cd ~/Desktop/bonsai-code
bun run spin</pre>
      <p>One of them in Bonsai itself, on a real turn:</p>
      <pre>BONSAI_SPINNER=bloom bonsai
BONSAI_SPINNER=orbit bonsai</pre>
      <p>Plain <code>bonsai</code> still shows today's star.</p>
    </div>
    <div class="card">
      <h3>What is real here</h3>
      <ul>
        <li><b>Real:</b> the terminal lines. The app's own <code>LiveArea</code> and <code>Spinner</code> (terminal/src/app/screen.jsx) rendered for every 40 ms, with the icon from <code>spinFrame</code> in terminal/src/ui/theme.mjs.</li>
        <li><b>Built from measurements:</b> the turn's timing. Bonsai 2 27B on this Mac writes 13.8 tokens/s and reads about 60/s; the phases and their lengths are an example turn, not a recording.</li>
        <li><b>Close, not exact:</b> the glyphs. ✿ ❀ ❁ ✻ and the braille dots come from macOS fallback fonts in both Safari and Terminal; each is drawn in one cell here, as Terminal does.</li>
      </ul>
    </div>
  </div>
  <p class="foot" id="foot"></p>
</main>

<script id="meta" type="application/json">${JSON.stringify(meta).replace(/</g, '\\u003c')}</script>
<script id="frames" type="text/plain">${payload}</script>
<script>
(async () => {
  const meta = JSON.parse(document.getElementById('meta').textContent);
  const $ = (id) => document.getElementById(id);

  // Apple Terminal "Basic" (dark) palette + xterm-256
  const BASE = ['#000000','#990000','#00a600','#999900','#0000b2','#b200b2','#00a6b2','#bfbfbf',
                '#666666','#e50000','#00d900','#e5e500','#0000ff','#e500e5','#00e5e5','#e5e5e5'];
  const hex = (n) => n.toString(16).padStart(2, '0');
  const PAL = BASE.slice();
  const lv = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) PAL.push('#' + hex(lv[r]) + hex(lv[g]) + hex(lv[b]));
  for (let i = 0; i < 24; i++) { const v = 8 + i * 10; PAL.push('#' + hex(v) + hex(v) + hex(v)); }
  const FG = '#ffffff', BG = '#171717';
  const mix = (a, b, k) => { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const x = p(a), y = p(b); return '#' + x.map((v, i) => hex(Math.round(v * k + y[i] * (1 - k)))).join(''); };
  const esc = (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c);

  function lineToHtml(line) {
    let st = { fg: null, bg: null, b: 0, d: 0, i: 0, u: 0, v: 0, s: 0 };
    let out = '', buf = '', cur = '';
    const style = () => {
      let fg = st.fg ?? FG, bg = st.bg;
      if (st.v) { const f = fg; fg = bg ?? BG; bg = f; }
      if (st.d) fg = mix(fg, bg ?? BG, 0.55);
      const css = [];
      if (fg !== FG) css.push('color:' + fg);
      if (bg) css.push('background:' + bg);
      if (st.b) css.push('font-weight:700');
      if (st.i) css.push('font-style:italic');
      const deco = [st.u && 'underline', st.s && 'line-through'].filter(Boolean).join(' ');
      if (deco) css.push('text-decoration:' + deco);
      return css.join(';');
    };
    const flush = () => { if (!buf) return; out += cur ? '<span style="' + cur + '">' + buf + '</span>' : buf; buf = ''; };
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '\\x1b' && line[i + 1] === '[') {
        const m = /^\\x1b\\[([0-9;]*)m/.exec(line.slice(i));
        if (m) {
          flush();
          const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
          for (let k = 0; k < codes.length; k++) {
            const c = codes[k];
            if (c === 0) st = { fg: null, bg: null, b: 0, d: 0, i: 0, u: 0, v: 0, s: 0 };
            else if (c === 1) st.b = 1; else if (c === 2) st.d = 1; else if (c === 3) st.i = 1; else if (c === 4) st.u = 1;
            else if (c === 7) st.v = 1; else if (c === 9) st.s = 1;
            else if (c === 22) { st.b = 0; st.d = 0; } else if (c === 23) st.i = 0; else if (c === 24) st.u = 0;
            else if (c === 27) st.v = 0; else if (c === 29) st.s = 0;
            else if (c >= 30 && c <= 37) st.fg = PAL[c - 30]; else if (c >= 90 && c <= 97) st.fg = PAL[c - 82];
            else if (c >= 40 && c <= 47) st.bg = PAL[c - 40]; else if (c >= 100 && c <= 107) st.bg = PAL[c - 92];
            else if (c === 39) st.fg = null; else if (c === 49) st.bg = null;
            else if ((c === 38 || c === 48) && codes[k + 1] === 5) { const col = PAL[codes[k + 2]]; if (c === 38) st.fg = col; else st.bg = col; k += 2; }
          }
          cur = style();
          i += m[0].length - 1;
          continue;
        }
      }
      const cp = ch.codePointAt(0);
      // One cell per character that may come from a fallback font, as in Terminal.
      if (cp > 0x7e && !(cp >= 0x2500 && cp <= 0x257f)) buf += '<span class="g">' + esc(ch) + '</span>';
      else buf += esc(ch);
    }
    flush();
    return out || ' ';
  }
  const toHtml = (s) => s.split('\\n').map((l) => '<div>' + lineToHtml(l) + '</div>').join('');

  const b64 = $('frames').textContent.trim();
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const { screens, icons } = JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  const cache = {};
  const htmlOf = (look, i) => { const k = look + i; return cache[k] ?? (cache[k] = toHtml(screens[look][i])); };

  // Look cards
  const looksEl = $('looks');
  for (const L of meta.looks) {
    const card = document.createElement('div');
    card.className = 'card' + (L.id === 'classic' ? ' now' : '');
    card.innerHTML =
      '<div class="head"><b>' + L.title + '</b><span>' + L.tag + '</span></div>' +
      '<div class="stage"><span class="big" id="big-' + L.id + '"></span><span class="small"><span id="sm-' + L.id + '"></span> Baking…<span class="cap">actual size</span></span></div>' +
      '<p class="idea">' + L.idea + '</p>' +
      '<div class="strip" id="strip-' + L.id + '">' + L.frames.map((f, i) => '<i style="color:' + L.colors[i] + '">' + f + '</i>').join('') +
      (L.wait ? '<i title="waiting colour" style="color:' + L.wait + '">' + L.frames[0] + '</i>' : '') + '</div>' +
      '<div class="facts">' + L.facts.map((f) => '<span>' + f + '</span>').join('') + (L.wait ? '<span>last chip = the dim waiting colour</span>' : '') + '</div>';
    looksEl.appendChild(card);
  }

  // Terminal windows
  const termsEl = $('terms');
  for (const L of meta.looks) {
    const w = document.createElement('div');
    w.className = 'win';
    w.innerHTML = '<div class="bar"><span class="dots"><i></i><i></i><i></i></span><span class="title">' + L.title + ' — bonsai — ' + meta.cols + '×12</span></div><div class="screen" id="scr-' + L.id + '"></div>';
    termsEl.appendChild(w);
  }

  // Timeline
  const phasesEl = $('phases');
  for (const p of meta.phases) {
    const d = document.createElement('div');
    d.className = 'ph' + (p.tps ? ' w' : '');
    d.style.flex = p.secs + ' 1 0';
    d.innerHTML = '<span>' + (p.key === 'readfile' ? 'reading the file' : p.what) + '</span><small>' + (p.tps ? p.tps + ' tokens/s' : p.secs < 1 ? '&nbsp;' : 'no tokens') + '</small>';
    d.title = p.what + ' (' + p.secs + ' s)';
    phasesEl.appendChild(d);
  }

  let t = 0, playing = true, last = performance.now(), shown = -1;
  const idx = () => Math.min(meta.n - 1, Math.floor(t / meta.step));
  function phaseAt(x) { let s = 0; for (const p of meta.phases) { if (x < s + p.secs) return p; s += p.secs; } return meta.phases[meta.phases.length - 1]; }
  function draw() {
    const i = idx();
    if (i === shown) return;
    shown = i;
    for (const L of meta.looks) {
      const [g, c] = icons[L.id][i];
      const big = $('big-' + L.id); big.textContent = g; big.style.color = PAL[c];
      const sm = $('sm-' + L.id); sm.textContent = g; sm.style.color = PAL[c];
      const strip = $('strip-' + L.id).children;
      const fi = L.frames.indexOf(g);
      for (let k = 0; k < strip.length; k++) strip[k].classList.toggle('on', L.wait ? (c !== 114 ? k === strip.length - 1 : k === fi) : k === fi && (L.id !== 'bloom' || PAL[c] === L.colors[k]));
      $('scr-' + L.id).innerHTML = htmlOf(L.id, i);
    }
    $('clock').textContent = t.toFixed(1).padStart(4, ' ') + ' s of ' + meta.total + ' s';
    $('headline').style.left = (t / meta.total * 100) + '%';
    const p = phaseAt(t);
    $('says').innerHTML = 'Bonsai is <b>' + p.what + '</b>' + (p.tps ? ': tokens coming out at ' + p.tps + ' a second, so Orbit runs fast and bright.' : ': no tokens, so Orbit slows to a dim drift; Now and Bloom keep their pace.');
  }
  function tick(now) {
    if (playing) { t = (t + (now - last) / 1000) % meta.total; }
    last = now;
    draw();
    requestAnimationFrame(tick);
  }
  $('play').onclick = () => { playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play'; };
  phasesEl.onclick = (e) => { const r = phasesEl.getBoundingClientRect(); t = Math.max(0, Math.min(meta.total - 0.001, (e.clientX - r.left) / r.width * meta.total)); shown = -1; draw(); };
  const zoom = (on) => { document.body.classList.toggle('zoom', on); $('z1').setAttribute('aria-pressed', String(!on)); $('z2').setAttribute('aria-pressed', String(on)); };
  $('z1').onclick = () => zoom(false); $('z2').onclick = () => zoom(true);
  document.addEventListener('keydown', (e) => { if (e.key === ' ') { e.preventDefault(); $('play').click(); } });
  $('foot').textContent = 'Built ' + new Date(meta.built).toLocaleString() + ' by terminal/scripts/demo/spin-preview.jsx · ' + meta.n + ' frames per look, one every ' + (meta.step * 1000) + ' ms.';
  requestAnimationFrame(tick);
})();
</script>
</body>
</html>
`;
const target = docsPath('design rounds/bonsai-spinner-2-designs-2026-09-26.html');
writeFileSync(target, html);
console.log(`${n} frames × ${LOOKS.length} looks → ${target.replace(homedir(), '~')} (${(html.length / 1e3).toFixed(0)} kB)`);
