#!/usr/bin/env bun
// The working icon in its three looks, side by side in your real terminal: the
// app's own Spinner line, fed one turn whose timing follows Bonsai 2 27B's
// measured speeds on this Mac (writes 13.8 tokens/s, reads ~60 tokens/s).
//   bun run spin        space pauses · q quits
import React, { useEffect, useState } from 'react';
import { render, useApp, useInput, useStdout, Box, Text } from 'ink';
import { Spinner } from '../../src/app/screen.jsx';
import { C } from '../../src/ui/theme.mjs';

// One turn: what Bonsai is doing, for how long, and whether tokens come out.
export const TURN = [
  { key: 'read', what: 'reading your message', secs: 3, tps: 0 },
  { key: 'think', what: 'thinking', secs: 5, tps: 13.8 },
  { key: 'tool', what: 'Read runs', secs: 0.5, tps: 0 },
  { key: 'readfile', what: 'reading the file it opened (360 tokens at ~60/s)', secs: 6, tps: 0 },
  { key: 'write', what: 'writing the reply', secs: 7, tps: 13.8 },
];
export const TOTAL = TURN.reduce((a, p) => a + p.secs, 0);

// Tokens written by `t` seconds into the turn, and when the last one came.
export function turnAt(t) {
  let start = 0, tokens = 0, lastAt = null, phase = TURN[0], inPhase = 0, phaseStart = 0;
  for (const p of TURN) {
    const inside = Math.min(Math.max(0, t - start), p.secs);
    const n = p.tps ? Math.floor(inside * p.tps) : 0;
    if (n > 0) lastAt = start + n / p.tps;
    tokens += n;
    if (t >= start) { phase = p; inPhase = n; phaseStart = start; }
    start += p.secs;
  }
  return { tokens, lastAt, phase, inPhase, phaseStart };
}

const LOOKS = ['classic', 'bloom', 'orbit'];
const LABEL = { classic: 'Now', bloom: '1 · Bloom', orbit: '2 · Orbit' };

function Demo() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [t, setT] = useState(0);
  const [paused, setPaused] = useState(false);
  // ~24 redraws a second, as the app does while tokens stream in.
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setT((x) => (x + 0.04) % TOTAL), 40);
    return () => clearInterval(id);
  }, [paused]);
  useInput((input, key) => {
    if (input === 'q' || key.escape) exit();
    if (input === ' ') setPaused((p) => !p);
  });
  const width = Math.max(60, stdout?.columns ?? 100);
  const { tokens, lastAt, phase } = turnAt(t);
  const base = 1_000_000;
  const live = { phase: 'working', turnStart: base, verb: 'Baking', tokens, lastTokenAt: lastAt == null ? null : base + lastAt * 1000 };
  const cells = 40;
  const at = Math.round((t / TOTAL) * cells);
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text><Text bold>The working icon</Text><Text color={C.dim}>  ·  3 looks, one turn  ·  space pauses · q quits</Text></Text>
      <Box height={1} />
      {LOOKS.map((look) => (
        <Box key={look}>
          <Box width={13}><Text color={C.dim}>{LABEL[look]}</Text></Box>
          <Spinner app={{ live, now: base + t * 1000, width: width - 16, spinner: look }} />
        </Box>
      ))}
      <Text>
        <Text color={C.accentDim}>{'━'.repeat(at)}</Text><Text color={C.faint}>{'━'.repeat(cells - at)}</Text>
        <Text color={phase.tps ? C.accent : C.dim}>  {phase.tps ? '↓ writing' : '· no tokens'}</Text><Text color={C.dim}>  {phase.what}{paused ? '  (paused)' : ''}</Text>
      </Text>
      <Box height={1} />
      <Text color={C.dim}>Bonsai uses Orbit.  BONSAI_SPINNER=classic bonsai  or  =bloom  shows another look</Text>
    </Box>
  );
}

if (import.meta.main) render(<Demo />);
