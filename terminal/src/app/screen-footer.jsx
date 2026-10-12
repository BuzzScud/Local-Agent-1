// The bottom of the window (screen.jsx): the shortcuts, the footer and its status rows, and
// the prompt box. Moved from screen.jsx word for word.
import React, { useRef, useLayoutEffect, useState } from 'react';
import { Box, Text, useCursor } from 'ink';
import { cursorCell, rowText, selection, promptTextWidth } from './edit-input.mjs';
import { C } from '../ui/theme.mjs';
import { modeLabel, MODE_SHORT } from '../ui/parts.jsx';
import { pressureWord, footerLabel } from './mac-memory.mjs';
import { gaugesOf, gaugeLine, fitRemote } from './remote-footer.mjs';
import { usagePanel, usageChip, textOf as segsText } from './usage-bar.mjs';
import { PRESSURE_COLOR } from './screen-items.jsx';

// The / menu's rows at most (the whole menu; the rest is in /settings): 18 still fits an 80 × 24 window.
export const MENU_ROWS = 18;
const SHORTCUTS = [
  ['/ for commands', 'shift+tab to switch mode'],
  ['@ to attach a file', 'ctrl+o to expand the last output'],
  ['! to run a shell command', 'esc to interrupt Agentic Coder'],
  ['\\ + enter for a new line', 'ctrl+c twice to quit'],
  ['↑ ↓ for earlier prompts', '⌥a to select all · delete clears it'],
  ['click or drag to move or select', 'ctrl+z to undo · ctrl+y to redo'],
  ['ctrl+t to start or stop the model', 'or click its label'],
];
// On a remote nothing loads on this Mac: ctrl+t opens the model list, and the keys for big
// models join it (remote-footer.mjs, 2 Oct 2026).
const REMOTE_SHORTCUTS = [
  ...SHORTCUTS.slice(0, -1),
  ['ctrl+t to switch the model', 'ctrl+r for a second opinion now'],
  ['ctrl+p to compact now', '/meters for the whole server line'],
];
export const shortcutsOf = (remote) => (remote ? REMOTE_SHORTCUTS : SHORTCUTS);
// Rows the shortcuts take under the footer (? opens them).
export const shortcutRows = (remote) => shortcutsOf(remote).length + 1;

// The model's label on the footer's right, longest first (a narrow window takes a shorter one).
// modelState: { state: off · loading · on, name, gb }; null for a server given with --url.
// ctrl+t switches it, and so does a click on it (/mouse on).
// A remote (remote: true): the model and where it runs, as it connects, loads there,
// reconnects or stops answering; a click on it opens /model.
export function modelLabels(ms) {
  if (!ms) return [];
  if (ms.remote) {
    const { name, where } = ms;
    if (ms.state === 'connecting') return [`◐ connecting to ${where}…`, '◐ connecting…', '◐'];
    if (ms.state === 'reconnecting') return [`◐ reconnecting to ${where}…`, '◐ reconnecting…', '◐'];
    if (ms.state === 'down') return [`✗ ${where} is not answering`, '✗ not answering', '✗'];
    if (ms.state === 'loading') return [`◐ ${name} loading on the service${ms.gb ? ` · ${ms.gb.toFixed(1)} GB` : ''}`, `◐ ${name} loading`, '◐ loading'];
    // The profile the conversation is on (App.jsx profileTag), when profiles route it.
    const p = ms.profile ? `${ms.profile} · ` : '';
    return [`● ${p}${name} on ${where}`, `● ${p}${name}`, '● remote'];
  }
  if (ms.state === 'off') return ['○ model off · ctrl+t start', '○ model off · ctrl+t', '○ off'];
  if (ms.state === 'loading') return [`◐ ${ms.name} loading · ctrl+t stop`, '◐ loading · ctrl+t stop', '◐ loading'];
  const gb = ms.gb ? ` · ${ms.gb.toFixed(1)} GB` : '';
  return [`● ${ms.name}${gb} · ctrl+t stop`, `● ${ms.name} · ctrl+t stop`, '● on · ctrl+t stop', '● on'];
}

// The footer's pieces, worked out once for the drawing and for a click on the model's label
// (App.jsx). The right side ends two cells from the window's edge; a narrow window drops the
// label's detail first, then the Mac's memory. The mode is its short name (MODE_SHORT), with no
// "(shift+tab to cycle)": the owner's pick "1 · Tidy", 9 Oct 2026. On a remote it is remoteParts
// below: gauges, no Mac.
// labelAt: the label's first and last cell on the footer's row, counted from 1.
export function footerParts(app) {
  const { mode, notice, width } = app;
  // Until your first message a tip sits here (start.jsx); the start page's steps say what the
  // start waits for.
  const tip = app.tip ?? null;
  const left = notice ?? (app.inputMode === 'bash' ? '! shell mode: runs the command yourself' : tip ? `※ Tip: ${tip}` : '? for shortcuts');
  // The update and weights badges share the lower right with the mode label; so does "⇄ on <this
  // Mac>" while another Mac has a window on this session (App.jsx).
  // (Loops made in this window come first: "↻ 2 loops · 1 needs you", App.jsx.)
  const badges = [app.loopsBadge, app.shareBadge, app.updateBadge, app.weightsBadge].filter(Boolean).join('  ');
  if (app.modelState?.remote) return remoteParts(app, left, badges);
  // The Mac's memory, live, after the model's label.
  const mac = app.mac ? footerLabel(app.mac) : '';
  const modeText = MODE_SHORT[mode] ?? '';
  const room = width - 4 - Math.min(left.length, 15) - 2;
  const labels = modelLabels(app.modelState);
  const ls = labels.length ? labels : [''];
  const tries = [
    ...ls.map((label) => ({ label, mac })),
    ...ls.map((label) => ({ label, mac: '' })),
  ];
  // The cost meter (/remote, spend.mjs) leads the right side while it fits, and goes first when it does not.
  const spend = app.spend ?? '';
  const all = spend ? [...tries.map((t) => ({ ...t, spend })), ...tries] : tries;
  const textOf = (t) => [t.spend, t.label, t.mac && `● ${t.mac}`, badges, modeText].filter(Boolean).join(' · ');
  const pick = all.find((t) => textOf(t).length <= room) ?? all.at(-1);
  const from = width - 2 - textOf(pick).length + 1;
  const lead = pick.spend ? pick.spend.length + 3 : 0; // the label starts after the cost meter and its " · "
  return { left: wholeTip(app, left, textOf(pick)), spend: pick.spend ?? '', label: pick.label, mac: pick.mac, badges, labelAt: pick.label ? { from: from + lead, to: from + lead + pick.label.length - 1 } : null };
}

// A tip shows whole or not at all: one that does not fit beside the right side gives its place to
// "? for shortcuts" (a cut tip read "ctrl+b sends this windo…").
function wholeTip(app, left, right) {
  if (!app.tip || app.notice || app.inputMode === 'bash') return left;
  return left.length + 2 + right.length <= app.width - 4 ? left : '? for shortcuts';
}

// On a remote (remote-footer.mjs): no Mac's memory, which holds no model then, and no cost meter
// (/meters has it). Once the first answer has a speed, gauges take the left side, unless a note,
// a tip or shell mode is there; the right is the model, where it runs and the mode. On the Claude
// API the model's name goes alone, then what is left of the month ("$61.68 left", usageChip).
function remoteParts(app, left, badges) {
  const { width, mode } = app;
  const ms = app.modelState;
  const modeText = MODE_SHORT[mode] ?? '';
  const labels = modelLabels(ms);
  const near = app.usage && ms.state === 'on' ? labels[1] : labels[0];
  // On the Claude API, what is left of the month after the model's name (usage-bar.mjs usageChip).
  const chip = app.usage ? segsText(usageChip(app.usage)) : '';
  const rightOf = (label) => [label, chip, badges, modeText].filter(Boolean).join(' · ');
  const list = gaugesOf(app.gaugeList);
  const quiet = !app.notice && app.inputMode !== 'bash' && !app.tip;
  const g = ms.state === 'on' && quiet && app.gauges && gaugeLine(app.gauges, list).length ? app.gauges : null;
  let label, gauges = null;
  if (g) {
    const f = fitRemote({ avail: width - 4, g, list, right: ({ where, bare }) => rightOf(bare ? labels[2] : where ? near : labels[1]) });
    label = f.bare ? labels[2] : f.where ? near : labels[1];
    gauges = f.gauges.length ? f.gauges : null;
  } else {
    const room = width - 4 - Math.min(left.length, 15) - 2;
    const tries = [near, ...labels.slice(1)];
    label = tries.find((l) => rightOf(l).length <= room) ?? tries.at(-1);
  }
  const from = width - 2 - rightOf(label).length + 1;
  return { left: wholeTip(app, left, rightOf(label)), gauges, spend: '', label, mac: '', badges, labelAt: { from, to: from + label.length - 1 } };
}

const WHITE = 'ansi256(255)'; // the start page's white (start.jsx)
// A row of usage-bar.mjs's pieces ({ t, fg, bg, b }, colours as xterm-256 numbers), one cell each.
function Segs({ segs }) {
  return <Text wrap="truncate-end">{segs.map((s, i) => <Text key={i} color={`ansi256(${s.fg})`} backgroundColor={s.bg == null ? undefined : `ansi256(${s.bg})`} bold={s.b}>{s.t}</Text>)}</Text>;
}
// /usage (app-slash.mjs): the card over the prompt, live while it is open; esc closes it.
export function UsagePanel({ app }) {
  if (!app.usage) return null;
  return <Box flexDirection="column" width={app.width}>{usagePanel(app.usage, app.width, { now: app.now, live: app.usageLive, asking: app.picker?.asking, edit: app.picker?.editing }).map((r, i) => <Segs key={i} segs={r} />)}</Box>;
}
// The gauges' tones (remote-footer.mjs) as colours.
const TONE = { dim: C.dim, value: WHITE, live: C.accent, bar: C.accentDim, warn: C.warn, bad: C.bad };

// The footer's rows, inside the prompt box under its dotted rule (the owner's pick "Panel", 8 Oct
// 2026: "more uniform … even spacing between edges and borders"): the prompt, the footer and the Claude
// API's usage share one frame, each row one cell in from its border, so every row starts and
// ends in the same columns. Tidied on 9 Oct 2026 (the owner's pick "1 · Tidy"): each row is words on
// the left and words on the right, ending on the same column; the box's bottom edge is the window's
// last row (patches/ink@7.1.1.patch). Since "3 · One row" (9 Oct 2026) the Claude API's usage is no row
// of its own: "$61.68 left" sits in the footer's right side, after the model. An open menu takes
// the footer's place, as in Claude Code: the box closes under the prompt and the menu sits under it.
const footInBox = (app) => !app.menu?.items?.length;
function FooterRows({ app, border }) {
  const { mode, notice, width } = app;
  const p = footerParts(app);
  const ms = app.modelState;
  const on = ms?.state === 'on';
  // A remote's dot: blue (the app's own) when on, orange while it connects or loads, red when it does not answer;
  // the model's name stands out from where it runs.
  const dot = on ? C.accent : !ms?.remote ? C.dim : ms.state === 'down' ? C.bad : C.warn;
  const named = ms?.remote && on && p.label.startsWith(`● ${ms.name}`);
  // A remote that does not answer says so in red, not only its dot.
  const down = ms?.remote && ms.state === 'down';
  const pieces = [
    p.spend ? <Text color={C.dim}>{p.spend}</Text> : null,
    p.label ? <Text color={down ? C.bad : C.dim}><Text color={dot}>{p.label[0]}</Text>{named ? <><Text> </Text><Text color={WHITE}>{ms.name}</Text>{p.label.slice(2 + ms.name.length)}</> : p.label.slice(1)}</Text> : null,
    app.usage ? <Text>{usageChip(app.usage).map((x, i) => <Text key={i} color={`ansi256(${x.fg})`} bold={x.b}>{x.t}</Text>)}</Text> : null,
    p.mac ? <Text color={C.dim}><Text color={PRESSURE_COLOR[pressureWord(app.mac)]}>●</Text> {p.mac}</Text> : null,
    p.badges ? <Text color={C.accent}>{p.badges}</Text> : null,
    modeLabel(mode, { short: true }),
  ].filter(Boolean);
  const inner = width - 4;
  return (
    <Box flexDirection="column">
      {/* The rule across the box, from border to border (├╌╌┤): drawn over the box's sides. */}
      <Box marginLeft={-2} width={width} height={1}><Text color={border}>{`├${'╌'.repeat(Math.max(0, width - 2))}┤`}</Text></Box>
      <Box width={inner} justifyContent="space-between" height={1} overflow="hidden">
        {/* A long left side (a tip) is cut to what is left; the right side stays whole, two spaces clear of it. */}
        <Box flexShrink={1} marginRight={2}>
          {p.gauges
            ? <Text wrap="truncate-end">{p.gauges.map((s, i) => <Text key={i} color={TONE[s.tone]}>{s.text}</Text>)}</Text>
            : <Text color={notice ? C.warn : C.dim} wrap="truncate-end">{p.left}</Text>}
        </Box>
        <Box flexShrink={0}><Text wrap="truncate-start">{pieces.map((el, i) => <React.Fragment key={i}>{i ? <Text color={C.dim}> · </Text> : null}{el}</React.Fragment>)}</Text></Box>
      </Box>
    </Box>
  );
}
// Under the box: the shortcuts, while ? shows them.
export function Footer({ app }) {
  if (!footInBox(app) || !app.showShortcuts) return null;
  return (
    <Box flexDirection="column">
      {app.showShortcuts ? (
        <Box flexDirection="column" paddingX={2} marginTop={1}>
          {shortcutsOf(app.modelState?.remote).map(([a, b], i) => <Text key={i} color={C.dim}>{a.padEnd(36)}{b}</Text>)}
        </Box>
      ) : null}
    </Box>
  );
}

// One row of the prompt with part of it selected: the selected characters on
// a blue background, the rest plain. A selected line break (brk, where the
// line ends) shows as one highlighted space.
function selectedRow(text, start, sel, brk) {
  const out = [];
  let run = '', on = null, at = start;
  const flush = () => { if (run) out.push(on ? <Text key={out.length} backgroundColor={C.selBg} color="white">{run}</Text> : <Text key={out.length}>{run}</Text>); run = ''; };
  const add = (ch, s) => { if (on !== null && s !== on) flush(); on = s; run += ch; };
  for (const ch of text) { add(ch, at >= sel[0] && at < sel[1]); at += ch.length; }
  if (brk != null && brk >= sel[0] && brk < sel[1]) add(' ', true);
  flush();
  return out;
}

// Where a box is drawn in the live area, from the layout of it and its parents.
const offsetOf = (el) => {
  let x = 0, y = 0;
  for (let n = el; n; n = n.parentNode) { const l = n.yogaNode?.getComputedLayout(); if (l) { x += l.left; y += l.top; } }
  return { x, y };
};

// The prompt, in rows it wraps itself (the same rows ↑ ↓ move through). The
// terminal's own cursor is put where you type: ⌥-click in Terminal counts
// the arrow keys it sends from it, and an input method opens its box there.
export function PromptBox({ app }) {
  const { input, width, inputMode } = app;
  const border = inputMode === 'bash' ? C.edits : C.border;
  const prefix = inputMode === 'bash' ? '!' : '>';
  const opts = { width: promptTextWidth(width), skip: inputMode === 'bash' ? 1 : 0 };
  const { row: curRow, x: curX, rows } = cursorCell(input, opts);
  const sel = selection(input);
  const ref = useRef(null);
  const [at, setAt] = useState(null);
  useLayoutEffect(() => { const o = offsetOf(ref.current); if (o.x !== at?.x || o.y !== at?.y) setAt(o); });
  const { setCursorPosition } = useCursor();
  setCursorPosition(at && !app.leaving ? { x: at.x + 4 + curX, y: at.y + 1 + curRow } : undefined);
  const v = input.value;
  return (
    <Box ref={ref} borderStyle="round" borderColor={border} paddingX={1} width={width} flexDirection="column">
      {rows.map((r, i) => {
        const lead = i === 0 ? <Text color={inputMode === 'bash' ? C.edits : undefined}>{prefix} </Text> : <Text>  </Text>;
        if (i === 0 && !v.slice(opts.skip)) return <Text key={i}>{lead}<Text color={C.dim}>{app.placeholder}</Text></Text>;
        const t = rowText(v, r, opts);
        if (sel && sel[0] <= r.end && sel[1] > r.start) return <Text key={i}>{lead}{selectedRow(t, r.start, sel, r.last && r.end < v.length ? r.end : null)}</Text>;
        // "/btw " typed: its argument's hint after the cursor
        if (app.argHint && i === curRow && r.last && input.cursor === r.end) return <Text key={i} wrap="truncate-end">{lead}{t} <Text color={C.dim}>{app.argHint}</Text></Text>;
        return <Text key={i}>{lead}{t}</Text>;
      })}
      {footInBox(app) ? <FooterRows app={app} border={border} /> : null}
    </Box>
  );
}
