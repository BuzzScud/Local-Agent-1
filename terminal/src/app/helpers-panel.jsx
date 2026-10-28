// The helpers panel over the prompt box (helpers-panel.mjs works out its rows): a round box, one row a helper or
// side job, the columns lined up, the memory line last.
import React from 'react';
import { Box, Text } from 'ink';
import { C } from '../ui/theme.mjs';
import { helperRows } from './helpers-panel.mjs';

export function HelpersPanel({ helpers, loaded, width }) {
  const p = helperRows(helpers, { loaded });
  if (!p) return null;
  const kindW = Math.max(8, ...p.rows.map((r) => r.kind.length));
  const modelW = Math.max(10, ...p.rows.map((r) => r.model.length));
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.faint} paddingX={1} width={width}>
      <Text color={C.dim} wrap="truncate-end">{p.title}</Text>
      {p.rows.map((r, i) => (
        <Box key={i}>
          <Text color={r.running ? C.accent : r.mark === '✗' ? C.warn : C.dim}>{r.mark} </Text>
          <Text>{r.kind.padEnd(kindW)} </Text>
          <Text color={C.accent}>{r.model.padEnd(modelW)} </Text>
          <Box flexGrow={1} flexShrink={1}><Text color={C.dim} wrap="truncate-end">{r.what}</Text></Box>
          <Text color={C.dim}> {r.secs} s</Text>
        </Box>
      ))}
      {p.memory ? <Text color={C.dim} wrap="truncate-end">{p.memory}</Text> : null}
    </Box>
  );
}
