// The /agents screen in Ink: the rows agents-tree.mjs draws, each piece in its colour. It takes the
// whole window while it is open (screen.jsx), and leaves the last line free for the cursor.
import React from 'react';
import { Box, Text } from 'ink';
import { C } from '../ui/theme.mjs';
import { drawTree } from './agents-tree.mjs';

const COLOURS = {
  'c-accent': C.accent, 'c-accentDim': C.accentDim, 'c-dim': C.dim, 'c-faint': C.faint, 'c-white': 'ansi256(255)',
  'c-warn': C.warn, 'c-bad': C.bad, 'c-edits': C.edits, 'c-plan': C.plan, 'c-auto': C.auto, 'c-border': C.border,
  'c-rail': C.border, 'c-orange': 'ansi256(209)', 'c-blue': 'ansi256(111)',
};
const HL = 'ansi256(236)';
function styleOf(s) {
  const p = {};
  for (const k of String(s ?? '').split(' ')) {
    if (k === 'b') p.bold = true;
    else if (k === 'hl') p.backgroundColor = HL;
    else if (COLOURS[k]) p.color = COLOURS[k];
  }
  return p;
}
export function AgentsView({ state, columns, rows, now }) {
  const lines = drawTree(state, { cols: columns, rows: Math.max(10, rows - 1), now, reduced: process.env.AGENTIC_REDUCED_MOTION === '1' });
  return (
    <Box flexDirection="column" width={columns}>
      {lines.map((r, i) => (
        <Text key={i} wrap="truncate-end">{r.map((p, j) => <Text key={j} {...styleOf(p.s)}>{p.t}</Text>)}</Text>
      ))}
    </Box>
  );
}
// The one live line above the prompt box while it runs behind the chat.
export function AgentsLine({ segs }) {
  if (!segs) return null;
  return <Box paddingX={2}><Text wrap="truncate-end">{segs.map((p, j) => <Text key={j} {...styleOf(p.s)}>{p.t}</Text>)}</Text></Box>;
}
