// Just enough Markdown for model replies: headings, lists, code blocks,
// `inline code`, **bold** and *italic*.
import React from 'react';
import { Box, Text } from 'ink';
import { C } from '../ui/theme.mjs';

const CODE = 'ansi256(152)'; // #afd7d7

export function Inline({ text, color }) {
  const parts = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)/g;
  let last = 0;
  let m;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<Text key={k++} color={color}>{text.slice(last, m.index)}</Text>);
    if (m[1]) parts.push(<Text key={k++} color={CODE}>{m[1].slice(1, -1)}</Text>);
    else if (m[2]) parts.push(<Text key={k++} bold color={color}>{m[2].slice(2, -2)}</Text>);
    else parts.push(<Text key={k++} italic color={color}>{m[3].slice(1, -1)}</Text>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<Text key={k++} color={color}>{text.slice(last)}</Text>);
  return <Text>{parts}</Text>;
}

export function Markdown({ text, color }) {
  const lines = text.replace(/\s+$/, '').split('\n');
  const out = [];
  let code = null;
  lines.forEach((line, i) => {
    const fence = /^\s*```/.test(line);
    if (fence) {
      if (code) { out.push(<Box key={`c${i}`} flexDirection="column" marginY={0}>{code.map((l, j) => <Text key={j} color={CODE}>  {l || ' '}</Text>)}</Box>); code = null; }
      else code = [];
      return;
    }
    if (code) { code.push(line); return; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { out.push(<Text key={i} bold color={color}>{h[2]}</Text>); return; }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      const bullet = /\d/.test(li[2]) ? li[2] : '•';
      out.push(<Box key={i} flexDirection="row"><Text color={color}>{li[1]}{bullet} </Text><Box flexShrink={1}><Inline text={li[3]} color={color} /></Box></Box>);
      return;
    }
    out.push(line.trim() ? <Inline key={i} text={line} color={color} /> : <Text key={i}> </Text>);
  });
  if (code) out.push(<Box key="cend" flexDirection="column">{code.map((l, j) => <Text key={j} color={CODE}>  {l || ' '}</Text>)}</Box>);
  return <Box flexDirection="column">{out}</Box>;
}
