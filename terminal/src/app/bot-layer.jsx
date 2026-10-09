// The Visor bot on the screen (9 Oct 2026, the owner's pick after five preview rounds: "its perfect";
// docs/private/design rounds/agentic-coder-bot-companion-preview-2026-10-08-v5.html). On the Menu start page
// it stands over the title; when you type it jumps onto the prompt box and rides your cursor; in a
// conversation it sits on the box (KEEP_ROWS rows above it are kept for it) and shows what the model does;
// its eyes follow the mouse; /bot hides it (a wave, a dive into the box) and shows it (it pops back out).
// What it does is bot-brain.mjs, how it looks bot-rig.mjs, which cells it covers bot-paint.mjs (all in
// ui/); this file feeds them where things are on the screen and draws the cells over everything else, as
// one layer of absolute boxes in the live part (screen.jsx), so whatever is under it shows around it.
// Frames: 30 a second while it moves, ten a second while it stands (a blink lasts 130 ms), and a frame is
// drawn only when a cell changed. AGENTIC_BOT=off leaves it out (the app tests); settings.json "bot": false
// is /bot hide, kept for every window.
import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { makeBrain } from '../ui/bot-brain.mjs';
import { botCellsAt } from '../ui/bot-paint.mjs';
import { homeTitleRow } from './home-looks.jsx';
import { cursorCell, promptTextWidth } from './edit-input.mjs';

const FAST = 33, CALM = 100;
export const KEEP_ROWS = 3;
// The fewest window rows that keep KEEP_ROWS for it in a conversation; a shorter window draws it over
// the rows above the box instead.
export const KEEP_FROM = 30;
export const botAllowed = (env = process.env) => !/^(off|0|false|no)$/i.test(env.AGENTIC_BOT ?? '');

// Rows from the live part's top to a node's: its top and its parents', up to the live part (Ink's layout).
function topIn(node, root) {
  let top = 0;
  for (let n = node; n && n !== root; n = n.parentNode) top += n.yogaNode?.getComputedTop?.() ?? 0;
  return top;
}

// app: the Screen's app; liveRef: the live part's box; boxRef: the prompt box's.
export function useBot(app, liveRef, boxRef) {
  const now = useRef(app);
  now.current = app;
  const [frame, setFrame] = useState({ cells: [], key: '', hidden: !app.botOn });
  const brain = useRef(null);
  const title = useRef({ key: '', row: 0 });
  const done = useRef({ working: false, until: 0 });
  useEffect(() => {
    if (!app.botAllowed) return undefined;
    let timer = null, last = Date.now(), stopped = false;
    const draw = (cells, hidden) => {
      const key = cells.map((c) => `${c.row},${c.col},${c.ch},${c.fg},${c.bg},${c.inverse ? 1 : 0}`).join('|');
      setFrame((f) => (f.key === key && f.hidden === hidden ? f : { cells, key, hidden }));
    };
    const tick = () => {
      if (stopped) return;
      const a = now.current, t = Date.now(), dt = (t - last) / 1000;
      last = t;
      const root = liveRef.current, box = boxRef.current;
      // nothing to stand on (a question or a picker in the box's place), a window too small, or the
      // Launcher, which has a bot of its own: not drawn, and its clock waits
      if (!root?.yogaNode || !box?.yogaNode || a.tooSmall || (a.hold && a.start?.look === 'launcher')) {
        draw([], !a.botOn);
        timer = setTimeout(tick, CALM);
        return;
      }
      const height = root.yogaNode.getComputedHeight();
      const boxTop = topIn(box, root);
      let home = null;
      if (a.hold && a.pageRef?.current) {
        const k = `${a.width}:${a.start?.room}:${a.start?.recent?.length}:${a.start?.look}:${a.start?.off}`;
        if (title.current.key !== k) title.current = { key: k, row: homeTitleRow(a.start, a.width) };
        const row = topIn(a.pageRef.current, root) + title.current.row;
        if (row >= 8) home = { x: Math.floor(a.width / 2), y: 2 * (row - 2) + 1 };
      }
      const { row, x } = cursorCell(a.input, { width: promptTextWidth(a.width) });
      // the pointer: Terminal counts rows from the window's first (1); the live part ends on the row
      // over the last one, which is the cursor's
      const p = a.botPointer?.current;
      const mouse = p ? { col: p.col - 1, row: p.row - (a.rows - height) } : null;
      const working = a.live?.phase === 'working';
      if (done.current.working && !working) done.current.until = t + 2500;
      done.current.working = working;
      const model = a.modelOff ? 'off' : a.starting ? 'loading' : working ? 'working' : t < done.current.until ? 'done' : 'ready';
      brain.current ??= makeBrain({ seed: t % 100000 });
      const o = brain.current.step(dt, {
        home, box: { top: boxTop, left: 0, right: a.width - 1 }, caret: { col: 4 + x, row: boxTop + 1 + row },
        text: a.input?.value ?? '', phase: a.hold ? 'start' : 'chat', model, mouse, hidden: !a.botOn, walkRange: 16,
      });
      draw(botCellsAt(o.pose, o.at, { cols: a.width, rows: height, shadow: o.shadow, clip: o.clip }), o.where === 'hidden');
      timer = setTimeout(tick, o.moving ? FAST : CALM);
    };
    timer = setTimeout(tick, FAST);
    return () => { stopped = true; clearTimeout(timer); };
  }, [app.botAllowed, liveRef, boxRef]);
  return frame;
}

const ink = (n) => (n == null ? undefined : `ansi256(${n})`);
// The bot's cells over the live part: each run of cells side by side on a row is one box, placed by
// its row and column; cells it does not cover are not written, so what is under them stays.
export function BotLayer({ cells }) {
  const runs = [];
  for (const c of cells) {
    const r = runs.at(-1);
    if (r && r.row === c.row && r.col + r.cells.length === c.col) r.cells.push(c);
    else runs.push({ row: c.row, col: c.col, cells: [c] });
  }
  return runs.map((r) => (
    <Box key={`${r.row}:${r.col}`} position="absolute" top={r.row} left={r.col}>
      <Text>{r.cells.map((c, i) => <Text key={i} color={ink(c.fg)} backgroundColor={ink(c.bg)} inverse={c.inverse}>{c.ch}</Text>)}</Text>
    </Box>
  ));
}
