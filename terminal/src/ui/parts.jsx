// Building blocks shared by the three designs, in Claude Code's visual language.
import React from 'react';
import { Box, Text } from 'ink';
import { C, spinGlyph, fmtSecs, fmtTok } from './theme.mjs';

export function wrap(text, width) {
  const lines = [];
  let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + w.length > width) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function Welcome({ session, width = 64 }) {
  return (
    <Box borderStyle="round" borderColor={C.accent} paddingX={1} width={width} flexDirection="column">
      <Text><Text color={C.accent}>✻</Text> Welcome to <Text bold>Agentic Coder</Text><Text color={C.dim}>  ·  {session.model}, on this Mac</Text></Text>
      <Text> </Text>
      <Text color={C.dim}>  /help for help · /model to switch models</Text>
      <Text> </Text>
      <Text color={C.dim}>  cwd: {session.cwd}</Text>
    </Box>
  );
}

export function Tips() {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={C.dim}> Tips for getting started:</Text>
      <Text color={C.dim}>  1. Run /init to write an AGENTS.md with notes about this project</Text>
      <Text color={C.dim}>  2. Ask for a change: Agentic Coder reads, edits and tests, and asks before it touches anything</Text>
      <Text color={C.dim}>  3. shift+tab switches between manual, accept edits, plan and auto</Text>
    </Box>
  );
}

export function UserMsg({ text }) {
  return <Row mark="&gt;" markColor={C.dim}><Text color={C.dim}>{text}</Text></Row>;
}

export function Row({ mark = '⏺', markColor, children }) {
  return (
    <Box flexDirection="row">
      <Box width={2} flexShrink={0}><Text color={markColor}>{mark}</Text></Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>{children}</Box>
    </Box>
  );
}

export function Result({ children }) {
  return (
    <Box flexDirection="row">
      <Box width={5} flexShrink={0}><Text color={C.dim}>  ⎿  </Text></Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>{children}</Box>
    </Box>
  );
}

export function ToolHead({ tool, arg, color = C.ok, dim = false }) {
  return (
    <Row markColor={color}>
      <Text color={dim ? C.dim : undefined}><Text bold>{tool}</Text>({arg})</Text>
    </Row>
  );
}

export function Diff({ hunk, width = 96 }) {
  return (
    <Box flexDirection="column">
      {hunk.map((l, i) => {
        const no = String((l.type === '-' ? l.oldNo : l.newNo) ?? '').padStart(4);
        const body = `${no} ${l.type} ${l.text}`.padEnd(width);
        const bg = l.type === '+' ? C.addBg : l.type === '-' ? C.delBg : undefined;
        return <Text key={i} wrap="truncate-end" backgroundColor={bg} color={l.type === ' ' ? C.dim : undefined}>{body}</Text>;
      })}
    </Box>
  );
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function testCounts(lines) {
  const pass = lines.map((l) => /ℹ pass (\d+)/.exec(l)).find(Boolean);
  const fail = lines.map((l) => /ℹ fail (\d+)/.exec(l)).find(Boolean);
  return pass ? { pass: Number(pass[1]), fail: Number(fail?.[1] ?? 0) } : null;
}

export function ToolResult({ item, diffWidth }) {
  const r = item.result;
  if (item.tool === 'Read') return <Result><Text>Read <Text bold>{r.lineCount}</Text> lines <Text color={C.dim}>(ctrl+o to expand)</Text></Text></Result>;
  if (item.tool === 'Update') {
    const parts = [r.additions && plural(r.additions, 'addition'), r.removals && plural(r.removals, 'removal')].filter(Boolean).join(' and ');
    return (
      <Result>
        <Text>Updated <Text bold>{item.arg}</Text> with {parts}</Text>
        <Diff hunk={r.hunk} width={diffWidth} />
      </Result>
    );
  }
  if (item.tool === 'Bash') {
    const shown = r.lines.slice(0, 3);
    const more = r.lines.length - shown.length;
    return (
      <Result>
        {shown.map((l, i) => <Text key={i} wrap="truncate-end">{l}</Text>)}
        {more > 0 ? <Text color={C.dim}>… +{more} lines (ctrl+o to expand)</Text> : null}
      </Result>
    );
  }
  return null;
}

export function Todos({ items, title = 'Update Todos' }) {
  return (
    <Box flexDirection="column">
      <Row markColor={C.ok}><Text bold>{title}</Text></Row>
      <Result>
        {items.map((it, i) => (
          <Text key={i} color={it.done ? C.dim : undefined} strikethrough={it.done} bold={!!it.active}>{it.done ? '☒' : '☐'} {it.text}</Text>
        ))}
      </Result>
    </Box>
  );
}

export function Spinner({ t, verb, secs, tokens, note }) {
  return (
    <Box marginBottom={1}>
      <Text>
        <Text color={C.accent}>{spinGlyph(t)} {verb}…</Text>
        <Text color={C.dim}> ({fmtSecs(secs)} · ↓ {fmtTok(tokens)} tokens{note ? ` · ${note}` : ''} · esc to interrupt)</Text>
      </Text>
    </Box>
  );
}

export function InputBox({ text, width, placeholder = 'Try "write a test for main()"' }) {
  return (
    <Box borderStyle="round" borderColor={C.border} paddingX={1} width={width}>
      <Text>
        &gt; {text}
        <Text inverse>{text ? ' ' : placeholder[0]}</Text>
        {text ? null : <Text color={C.dim}>{placeholder.slice(1)}</Text>}
      </Text>
    </Box>
  );
}

export const MODE_TEXT = { auto: '⏵⏵ auto mode on', edits: '⏵⏵ accept edits on', plan: '⏸ plan mode on', bypass: '⏵⏵ bypass permissions on' };
const MODE_COLOR = { auto: C.auto, edits: C.edits, plan: C.plan, bypass: C.bypass };
export const CYCLE_HINT = ' (shift+tab to cycle)';
// cycle: false leaves out the hint, for a narrow footer.
export function modeLabel(mode, { cycle = true } = {}) {
  if (!MODE_TEXT[mode]) return null;
  return <Text color={MODE_COLOR[mode]}>{MODE_TEXT[mode]}{cycle ? <Text color={C.dim}>{CYCLE_HINT}</Text> : null}</Text>;
}

export function Footer({ width, right }) {
  return (
    <Box width={width} justifyContent="space-between" paddingX={2}>
      <Text color={C.dim}>? for shortcuts</Text>
      {right ?? <Text> </Text>}
    </Box>
  );
}

const PERM = {
  Update: {
    title: 'Edit file',
    question: (a) => <Text>Do you want to make this edit to <Text bold>{a}</Text>?</Text>,
    options: ['Yes', 'Yes, allow all edits this session (shift+tab)', 'No, and tell Agentic Coder what to do differently (esc)'],
  },
  Bash: {
    title: 'Bash command',
    question: () => <Text>Do you want to proceed?</Text>,
    options: (a) => ['Yes', `Yes, and don't ask again for ${a} in this folder`, 'No, and tell Agentic Coder what to do differently (esc)'],
  },
};

export function Permission({ perm, width, cwd, diffWidth }) {
  const spec = PERM[perm.tool];
  const options = typeof spec.options === 'function' ? spec.options(perm.arg) : spec.options;
  return (
    <Box borderStyle="round" borderColor={C.ask} flexDirection="column" paddingX={1} width={width}>
      <Text bold color={C.ask}>{spec.title}</Text>
      {perm.tool === 'Update' ? (
        <Box borderStyle="round" borderColor={C.faint} flexDirection="column" paddingX={1} marginY={0}>
          <Text bold>{perm.arg}</Text>
          <Diff hunk={perm.step.result.hunk} width={diffWidth} />
        </Box>
      ) : (
        <Box flexDirection="column" paddingX={2} marginY={1}>
          <Text>{perm.arg}</Text>
          <Text color={C.dim}>in {cwd}</Text>
        </Box>
      )}
      {spec.question(perm.arg)}
      {options.map((o, i) => (
        <Text key={i} color={i === perm.selected ? C.ask : undefined}>{i === perm.selected ? '❯' : ' '} {i + 1}. {o}</Text>
      ))}
      {perm.hint ? <Text color={C.dim}>{perm.hint}</Text> : null}
    </Box>
  );
}
