#!/usr/bin/env bun
// Plays the recorded session in your real terminal with one of the designs.
//   bun run demo 1            (or 2, 3)   add --speed 1 for real time
// Keys: enter answers a question · space pauses · shift+tab switches mode · q quits
import React, { useEffect, useRef, useState } from 'react';
import { render, useApp, useInput, useStdout, Box, Text } from 'ink';
import { readFileSync } from 'node:fs';
import { stateAt } from '../../src/ui/state.mjs';
import { DESIGNS } from '../../src/ui/designs.jsx';
import { C } from '../../src/ui/theme.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const design = Math.min(3, Math.max(1, Number(opt('design', args.find((a) => /^[123]$/.test(a)) ?? '1')) || 1));
const speed = Math.max(0.25, Number(opt('speed', '4')) || 4);
const session = JSON.parse(readFileSync(new URL('./session.json', import.meta.url), 'utf8'));
const END = session.total + 0.3;
const MODES = ['ask', 'edits', 'plan'];

function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [t, setT] = useState(0);
  const [paused, setPaused] = useState(false);
  const [modeOverride, setModeOverride] = useState(null);
  const answered = useRef(new Set());
  const width = Math.max(60, stdout?.columns ?? 100);

  // The question the replay is holding on, if any.
  const holding = (at) => session.steps.find((x) => x.permission && at >= x.tAsk && at < x.tAsk + x.permission.wait && !answered.current.has(x.t0));

  useEffect(() => {
    const id = setInterval(() => {
      setT((prev) => {
        if (paused || holding(prev) || prev >= END) return prev;
        let next = Math.min(END, prev + 0.1 * speed);
        const ask = session.steps.find((x) => x.permission && prev < x.tAsk && next >= x.tAsk && !answered.current.has(x.t0));
        if (ask) next = ask.tAsk + 0.01;
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [paused]);

  useInput((input, key) => {
    if (input === 'q' || key.escape) { exit(); return; }
    if (key.tab && key.shift) { setModeOverride((m) => MODES[(MODES.indexOf(m ?? stateAt(session, t).mode) + 1) % MODES.length]); return; }
    const h = holding(t);
    if (key.return && h) { answered.current.add(h.t0); setT(h.tAsk + h.permission.wait + 0.01); return; }
    if (input === ' ') setPaused((p) => !p);
  });

  const s = stateAt(session, t);
  const h = holding(t);
  if (s.permission && h) s.permission = { ...s.permission, selected: h.permission.choice, hint: `demo: press enter to choose ${h.permission.choice + 1}` };
  if (modeOverride) s.mode = modeOverride;
  const { View } = DESIGNS[design - 1];
  const finished = t >= END;
  return (
    <Box flexDirection="column">
      <View session={session} s={s} width={width} />
      <Text color={C.faint}>
        {'  '}demo replay · design {design} · {speed}× · scripted model, real tools{paused ? ' · ⏸ paused (space)' : ''}{finished ? ' · finished, q to quit' : ' · q quits'}
      </Text>
    </Box>
  );
}

render(<App />, { exitOnCtrlC: true });
