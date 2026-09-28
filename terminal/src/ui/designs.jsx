// The three terminal designs. Each is a pure view of stateAt(session, t):
// finished transcript lines go in <Static> (printed once, so your terminal's
// own scrollback keeps working), the live area is redrawn below them.
import React from 'react';
import { Box, Text, Static } from 'ink';
import { C, spinGlyph, fmtSecs, fmtTok } from './theme.mjs';
import {
  wrap, Welcome, Tips, UserMsg, Row, Result, ToolHead, ToolResult, Todos, Spinner, InputBox, Footer, Permission, modeLabel, Diff, testCounts,
} from './parts.jsx';

const diffW = (width) => Math.max(40, Math.min(100, width - 12));

function Transcript({ session, s, head, renderItem, skip = () => false }) {
  const items = [{ key: 'head' }, ...s.items.filter((it) => !skip(it))];
  return (
    <Static items={items}>
      {(it) => (
        <Box key={it.key} flexDirection="column" marginBottom={1}>
          {it.key === 'head' ? head : renderItem(it)}
        </Box>
      )}
    </Static>
  );
}

const classicItem = (dw) => (it) => {
  switch (it.type) {
    case 'user': return <UserMsg text={it.text} />;
    case 'thinking': return <Text color={C.think} italic>∴ Thought for {fmtSecs(it.secs)} <Text color={C.faint}>(ctrl+o to show thinking)</Text></Text>;
    case 'text':
    case 'final': return <Row><Text>{it.text}</Text></Row>;
    case 'tool': return <Box flexDirection="column"><ToolHead tool={it.tool} arg={it.arg} /><ToolResult item={it} diffWidth={dw} /></Box>;
    case 'todos': return <Todos items={it.items} />;
    default: return null;
  }
};

function bottom({ session, s, width, meters }) {
  if (s.permission) return <Permission perm={s.permission} width={width} cwd={session.cwd} diffWidth={diffW(width) - 4} />;
  return (
    <Box flexDirection="column">
      <InputBox text={s.phase === 'idle' ? s.typed : ''} width={width} />
      <Footer width={width} right={modeLabel(s.mode) ?? meters} />
    </Box>
  );
}

const ctxPct = (session, s) => Math.max(1, Math.round((s.ctx / session.contextWindow) * 100));

// ── 1 · Classic ─────────────────────────────────────────────────────────────
// Claude Code as it is: the welcome box, ⏺ / ⎿ steps, thinking folded to one
// line, one spinner, the input box and a quiet footer.
export function Classic({ session, s, width }) {
  const a = s.active;
  return (
    <Box flexDirection="column" width={width}>
      <Transcript session={session} s={s} renderItem={classicItem(diffW(width))} head={<Box flexDirection="column"><Welcome session={session} /><Tips /></Box>} />
      {a && (a.type === 'text' || a.type === 'final') ? <Box marginBottom={1}><Row><Text>{a.text}</Text></Row></Box> : null}
      {a && a.type === 'tool-running' ? <Box flexDirection="column" marginBottom={1}><ToolHead tool={a.tool} arg={a.arg} color={C.dim} /><Result><Text color={C.dim}>Running…</Text></Result></Box> : null}
      {a && s.phase === 'working' ? <Spinner t={s.t} verb={a.verb} secs={s.turnSecs} tokens={s.outTokens} note={a.type === 'thinking' ? 'thinking' : null} /> : null}
      {bottom({ session, s, width, meters: <Text color={C.dim}>{session.model} · {ctxPct(session, s)}% context</Text> })}
    </Box>
  );
}

// ── 2 · Live thinking ───────────────────────────────────────────────────────
// Same flow, but you watch the model work: its thinking streams in a
// 4-line window, a tool call shows how much of it is written, and a meter line
// shows speed, context and memory.
const liveItem = (width) => (it) => {
  if (it.type === 'thinking') {
    const first = wrap(it.text, Math.min(96, width - 8))[0];
    return (
      <Box flexDirection="column">
        <Text color={C.think} italic>∴ Thought for {fmtSecs(it.secs)} · {it.tokens} tokens <Text color={C.faint}>(ctrl+o to show)</Text></Text>
        <Text color={C.faint} italic>  {first} …</Text>
      </Box>
    );
  }
  return classicItem(diffW(width))(it);
};

function bar(frac, cells = 10) {
  const n = Math.min(cells, Math.max(frac > 0 ? 1 : 0, Math.round(frac * cells)));
  return '▰'.repeat(n) + '▱'.repeat(cells - n);
}

function Meters({ session, s }) {
  const speed = s.phase === 'done' || s.phase === 'idle' ? 'idle'
    : s.speed === 'out' ? `↓ ${session.decodeTps.toFixed(1)} tok/s writing`
      : s.speed === 'in' ? `↑ ${session.prefillTps} tok/s reading`
        : s.phase === 'waiting' ? 'waiting for you' : 'running tool';
  return (
    <Text color={C.dim}>
      {session.model}  <Text color={s.speed ? C.accent : C.dim}>{speed}</Text>  ctx <Text color={C.accentDim}>{bar(s.ctx / session.contextWindow)}</Text> {ctxPct(session, s)}% of {Math.round(session.contextWindow / 1024)}k  RAM {session.ramGb} GB
    </Text>
  );
}

export function LiveThinking({ session, s, width }) {
  const a = s.active;
  let live = null;
  if (a && a.type === 'thinking') {
    const lines = wrap(a.text, Math.min(96, width - 6));
    const tail = lines.slice(-4);
    live = (
      <Box flexDirection="column" marginTop={0}>
        <Text color={C.think} italic>∴ Thinking… {fmtSecs(a.secs)} · {a.tokens} tokens</Text>
        {tail.map((l, i) => <Text key={i}><Text color={C.accentDim}>┃ </Text><Text color={C.think} italic>{l}</Text></Text>)}
        {Array.from({ length: 4 - tail.length }, (_, i) => <Text key={`p${i}`} color={C.accentDim}>┃</Text>)}
      </Box>
    );
  } else if (a && (a.type === 'text' || a.type === 'final')) {
    live = <Row><Text>{a.text}</Text></Row>;
  } else if (a && a.type === 'tool-writing') {
    live = (
      <Box flexDirection="column">
        <ToolHead tool={a.tool} arg={a.arg} color={C.dim} dim />
        <Result><Text color={C.dim}>writing the {a.tool === 'Bash' ? 'command' : a.tool === 'Read' ? 'request' : 'edit'}… {a.tokens} of {a.total} tokens <Text color={C.accentDim}>{bar(a.tokens / a.total, 12)}</Text></Text></Result>
      </Box>
    );
  } else if (a && a.type === 'todos-writing') {
    live = <Box flexDirection="column"><ToolHead tool="Update Todos" arg="" color={C.dim} dim /><Result><Text color={C.dim}>writing the plan… {a.tokens} of {a.total} tokens <Text color={C.accentDim}>{bar(a.tokens / a.total, 12)}</Text></Text></Result></Box>;
  } else if (a && a.type === 'tool-running') {
    live = <Box flexDirection="column"><ToolHead tool={a.tool} arg={a.arg} color={C.dim} /><Result><Text color={C.dim}>Running…</Text></Result></Box>;
  }
  return (
    <Box flexDirection="column" width={width}>
      <Transcript session={session} s={s} renderItem={liveItem(width)} head={<Box flexDirection="column"><Welcome session={session} /><Tips /></Box>} />
      {live ? <Box marginBottom={1}>{live}</Box> : null}
      {a && s.phase === 'working' ? <Spinner t={s.t} verb={a.verb} secs={s.turnSecs} tokens={s.outTokens} /> : null}
      {bottom({ session, s, width, meters: null })}
      <Box paddingX={2}><Meters session={session} s={s} /></Box>
    </Box>
  );
}

// ── 3 · Task board ──────────────────────────────────────────────────────────
// Organised around "where are we in the task": a board pinned above the
// input lists the model's plan with a time per step and an estimate of what
// is left; finished steps shrink to one line each in the transcript.
function boardItem(session, width) {
  return (it) => {
    switch (it.type) {
      case 'user': return <UserMsg text={it.text} />;
      case 'thinking': return <Text color={C.think} italic>∴ Thought for {fmtSecs(it.secs)}</Text>;
      case 'todos': return null;
      case 'tool': {
        const r = it.result;
        let what = '';
        if (it.tool === 'Read') what = <Text>Read <Text bold>{it.arg}</Text> · {r.lineCount} lines</Text>;
        if (it.tool === 'Update') what = <Text>Updated <Text bold>{it.arg}</Text> · <Text color={C.ok}>+{r.additions}</Text> <Text color={C.bad}>−{r.removals}</Text></Text>;
        if (it.tool === 'Bash') {
          const n = testCounts(r.lines);
          what = <Text>Ran <Text bold>{it.arg}</Text> · {n ? <Text color={n.fail ? C.bad : C.ok}>{n.pass} passed, {n.fail} failed</Text> : `exit ${r.code}`}</Text>;
        }
        return <Text><Text color={it.tool === 'Bash' && r.code !== 0 ? C.bad : C.ok}>✓ </Text>{what}<Text color={C.dim}> · {fmtSecs(it.secs)}</Text>{it.tool === 'Update' ? <Text color={C.faint}>  (ctrl+o to show the diff)</Text> : null}</Text>;
      }
      case 'final': return (
        <Box flexDirection="column">
          <Row><Text>{it.text}</Text></Row>
        </Box>
      );
      default: return classicItem(diffW(width))(it);
    }
  };
}

function BoardLine({ w, left, right = '', color = C.border, fill = ' ' }) {
  const inner = w - 2;
  const l = typeof left === 'string' ? left : left.text;
  const r = typeof right === 'string' ? right : right.text;
  const gap = Math.max(1, inner - 2 - l.length - r.length);
  return (
    <Text>
      <Text color={color}>│</Text> {typeof left === 'string' ? left : left.node}{fill.repeat(gap)}{typeof right === 'string' ? <Text color={C.dim}>{right}</Text> : right.node} <Text color={color}>│</Text>
    </Text>
  );
}

function Board({ session, s, width }) {
  const w = Math.min(width, 110);
  const done = s.phase === 'done';
  const maxT = Math.max(16, Math.min(60, w - 26));
  const title = ` ${done ? '✓ Done' : 'Task'}: ${session.task.length > maxT ? `${session.task.slice(0, maxT - 1)}…` : session.task} `;
  const clock = ` ${fmtSecs(s.turnSecs)} `;
  const top = `╭─${title}${'─'.repeat(Math.max(1, w - 4 - title.length - clock.length))}${clock}─╮`;
  const a = s.active;
  const status = () => {
    if (s.permission) return { text: 'waiting for you', node: <Text color={C.ask} bold>waiting for you</Text> };
    if (!a) return { text: '', node: null };
    const t = a.type === 'thinking' ? `thinking · ${a.tokens} tok`
      : a.type === 'tool-writing' ? `writing the ${a.tool === 'Bash' ? 'command' : a.tool === 'Read' ? 'request' : 'edit'} · ${a.tokens}/${a.total} tok`
        : a.type === 'todos-writing' ? `writing the plan · ${a.tokens}/${a.total} tok`
          : a.type === 'tool-running' ? `running ${a.arg}`
            : a.type === 'prefill' ? 'reading the result' : 'writing';
    return { text: t, node: <Text color={C.accent}>{t}</Text> };
  };
  const rows = [];
  if (!s.todos) {
    const txt = `${spinGlyph(s.t)} Getting started: reading the code`;
    rows.push(<BoardLine key="gs" w={w} left={{ text: txt, node: <Text><Text color={C.accent}>{spinGlyph(s.t)}</Text> <Text bold>Getting started: reading the code</Text></Text> }} right={status()} />);
  } else {
    s.todos.forEach((td, i) => {
      const isDone = done || td.done || i < s.activeTodo;
      const isActive = !isDone && i === s.activeTodo;
      const secs = s.todoSecs[i];
      if (isDone) rows.push(<BoardLine key={i} w={w} left={{ text: `☒ ${td.text}`, node: <Text color={C.dim}>☒ {td.text}</Text> }} right={secs ? fmtSecs(secs) : ''} />);
      else if (isActive) {
        const g = spinGlyph(s.t);
        rows.push(<BoardLine key={i} w={w} left={{ text: `${g} ${td.text}`, node: <Text><Text color={s.permission ? C.ask : C.accent}>{g}</Text> <Text bold>{td.text}</Text></Text> }} right={status()} />);
      } else rows.push(<BoardLine key={i} w={w} left={`☐ ${td.text}`} />);
    });
  }
  const n = s.todos ? s.todos.length : 0;
  const finished = s.todos ? s.todos.filter((td, i) => done || td.done || i < s.activeTodo).length : 0;
  let eta = 'estimating…';
  if (done) eta = `${n} of ${n} steps · ↓ ${fmtTok(s.outTokens)} tokens written`;
  else if (n && finished) {
    const spent = s.todoSecs.slice(0, finished).reduce((x, y) => x + (y ?? 0), 0);
    const left = (spent / finished) * (n - finished);
    eta = `step ${finished + 1} of ${n} · about ${fmtSecs(left)} left (est.)`;
  }
  const foot = ` ${eta} `;
  const bottomLine = `╰${'─'.repeat(Math.max(1, w - 3 - foot.length))}${foot}─╯`;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={C.border}>{top.slice(0, 2)}<Text color={done ? C.ok : 'ansi256(255)'} bold>{title}</Text>{top.slice(2 + title.length, top.length - clock.length - 2)}<Text color={C.dim}>{clock}</Text>{'─╮'}</Text>
      {rows}
      <Text color={C.border}>{bottomLine.slice(0, bottomLine.length - foot.length - 2)}<Text color={C.dim}>{foot}</Text>{'─╯'}</Text>
    </Box>
  );
}

export function TaskBoard({ session, s, width }) {
  const a = s.active;
  const head = (
    <Text>
      <Text color={C.accent}>✻ </Text><Text bold>Agentic Coder</Text>
      <Text color={C.dim}>  ·  {session.model}  ·  {session.cwd}  ·  /help  ·  shift+tab: ask first / auto-edit / plan</Text>
    </Text>
  );
  return (
    <Box flexDirection="column" width={width}>
      <Transcript session={session} s={s} renderItem={boardItem(session, width)} head={head} skip={(it) => it.type === 'todos'} />
      {a && (a.type === 'text' || a.type === 'final') ? <Box marginBottom={1}><Row><Text>{a.text}</Text></Row></Box> : null}
      {s.turnStart !== null ? <Board session={session} s={s} width={width} /> : null}
      {bottom({ session, s, width, meters: <Text color={C.dim}>{session.model} · {ctxPct(session, s)}% context</Text> })}
    </Box>
  );
}

export const DESIGNS = [
  { id: 1, name: 'Classic', idea: 'Claude Code as it is: welcome box, ⏺ / ⎿ steps, thinking folded to one line, one spinner, a quiet footer.', View: Classic },
  { id: 2, name: 'Live thinking', idea: 'Watch it work: thinking streams in a 4-line window, tool calls show how much is written, a meter line shows speed, context and memory.', View: LiveThinking },
  { id: 3, name: 'Task board', idea: 'Where are we in the task: the plan pinned above the input with a time per step and what is left; finished steps shrink to one line.', View: TaskBoard },
];
