// The loop board as the coding window's own screen (/loops, 4 Oct 2026, the owner's pick: "open it in
// the same window"): the rows loops-draw.mjs draws, each piece in its colour. It takes the whole window
// while it is open (screen.jsx), as /agents' tree does, and leaves the last line free for the cursor.
// LoopsLine: the line above the prompt box that keeps the loops in sight while you are in the chat.
import React from 'react';
import { Box, Text } from 'ink';
import { STYLE, BG } from './loops-draw.mjs';

// A piece's style ("warn b on needs") as Ink's colours.
const props = new Map();
function styleOf(s) {
  let out = props.get(s);
  if (out) return out;
  const [fg, bg] = String(s).split(' on ');
  const names = fg.split(' ');
  out = { color: `ansi256(${STYLE[names[0]] ?? STYLE.text})`, ...(names.includes('b') ? { bold: true } : {}), ...(bg ? { backgroundColor: `ansi256(${BG[bg] ?? bg})` } : {}) };
  props.set(s, out);
  return out;
}
export function LoopsView({ frame, columns }) {
  return (
    <Box flexDirection="column" width={columns}>
      {frame.map((r, i) => (
        <Text key={i} wrap="truncate-end">{r.map(([t, s], j) => <Text key={j} {...styleOf(s)}>{t}</Text>)}</Text>
      ))}
    </Box>
  );
}
export function LoopsLine({ segs }) {
  if (!segs) return null;
  return <Box paddingX={1}><Text wrap="truncate-end">{segs.map(([t, s], j) => <Text key={j} {...styleOf(s)}>{t}</Text>)}</Text></Box>;
}
