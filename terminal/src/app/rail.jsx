// The conversation as a rail (design 2 of 29 Sep 2026, the user's pick): your message on a grey
// strip, then every step of the turn hung on one thin line, each with a mark for its kind, and
// the turn closed with ╰─ and how it ended.
//   ◇ thinking   ● a reply   ✎ a file made or changed   ○ a read, a list, a search
//   ❯ a command  ◎ the layout check   ⊘ not allowed / you said no   ✗ an error   · a note
// A step prints the rail line above itself (its link to the step before); the turn's steps
// have no blank line between them, and the end line leaves one under it.
import React from 'react';
import { Box, Text } from 'ink';
import { C, MARK, fmtSecs } from '../ui/theme.mjs';
import { wrap } from '../ui/parts.jsx';
import { Markdown } from './markdown.jsx';
import { money } from '../agent/spend.mjs';

export const RAIL = 'ansi256(243)'; // #767676: C.faint (#585858) all but vanishes as a thin line on a dark window
export const STRIP = 'ansi256(236)'; // #303030, the grey strip under your message
const PATH = 'ansi256(250)';
const CODE = 'ansi256(252)';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// A step: its mark in the rail's column, its words beside it.
export const Node = ({ g, c, children }) => (
  <Box flexDirection="row">
    <Box width={4} flexShrink={0}><Text color={c}>{'  '}{g}</Text></Box>
    <Box flexDirection="column" flexGrow={1} flexShrink={1}>{children}</Box>
  </Box>
);
// The rail going on, with words beside it (a step's lines) or none (the link between two steps).
// It is the left border of their box, so a line that wraps keeps the rail beside every row.
export const Pipe = ({ children }) => (
  <Box flexDirection="row">
    <Box width={2} flexShrink={0} />
    <Box borderStyle="single" borderTop={false} borderRight={false} borderBottom={false} borderColor={RAIL} paddingLeft={1} flexDirection="column" flexGrow={1} flexShrink={1}>{children ?? <Text> </Text>}</Box>
  </Box>
);
const Head = ({ verb, c, what, detail, hint }) => (
  <Text><Text color={c} bold>{verb}</Text>{what ? <Text color={PATH}>  {what}</Text> : null}{detail ? <Text color={C.dim}> · {detail}</Text> : null}{hint ? <Text color={C.faint}>  ({hint})</Text> : null}</Text>
);

// Your message: a grey strip across the window, a line of padding above and below.
export function UserStrip({ text, attached, width }) {
  const inner = Math.max(10, width - 4);
  const lines = String(text).split('\n').flatMap((l) => (l.trim() ? wrap(l, inner) : ['']));
  const row = (content, key) => <Text key={key} backgroundColor={STRIP}>{content}</Text>;
  return (
    <Box flexDirection="column" width={width}>
      {row(' '.repeat(width), 'top')}
      {lines.map((l, i) => row(<>{' '}<Text color={C.accent}>{i === 0 ? '›' : ' '}</Text>{' '}<Text color="ansi256(255)">{l.padEnd(inner)}</Text>{' '}</>, i))}
      {attached?.length ? row(<>{'   '}<Text color={C.dim}>{`Attached ${attached.map((a) => `${a.path} (${a.label ?? plural(a.lines, 'line')})`).join(', ')}`.slice(0, inner).padEnd(inner)}</Text>{' '}</>, 'att') : null}
      {row(' '.repeat(width), 'bottom')}
    </Box>
  );
}

// What came along with the request, in one dim line under it: the notes, the design cards, how it
// was sorted. ctrl+o lists the notes as before.
export function machineWords(m) {
  const parts = [];
  for (const c of m.contexts ?? []) {
    const sent = c.items.filter((x) => !x.skipped).length;
    parts.push(c.title === 'Helpers' ? `helpers brought ${sent}` : plural(sent, 'note'));
  }
  if (m.design?.length) parts.push(`design: ${m.design.map((d) => (d === 'your rules/rules' ? 'your rules' : d)).join(' + ')}`);
  if (m.sorted) parts.push(m.sorted.replace(/^Sorted as:\s*/i, '').replace(/ · /g, ', '));
  return parts.join(' · ');
}
export const MachineLine = ({ it }) => (
  <Node g="┊" c={RAIL}><Text color={C.dim}>{machineWords(it)}{(it.contexts ?? []).length ? <Text color={C.faint}>  (ctrl+o)</Text> : null}</Text></Node>
);

// A meter of `cells` blocks; `frac` 0–1.
export const meter = (frac, cells = 8) => {
  const n = Math.min(cells, Math.max(frac > 0 ? 1 : 0, Math.round(frac * cells)));
  return '▰'.repeat(n) + '▱'.repeat(cells - n);
};
export const kTok = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
// At this share of a limit a meter turns orange: the cut is near.
export const NEAR = 0.85;

// The gist of a thought, for its line once done: its first sentence that says something
// (small models open with "Let me check the details." and the step-down closes with
// "I have thought enough. Now I act on it.").
const FILLER = /^(i need to look into this|let me (check|look|think)( at)? (the|this|it)|i have thought enough|now i act on it|okay|ok|hmm+|alright|so|wait)\b/i;
export function gist(text, max = 90) {
  const s = String(text ?? '').split(/\n+|(?<=[.!?])\s+/).map((x) => x.replace(/\s+/g, ' ').trim()).find((x) => x.length >= 12 && !FILLER.test(x));
  if (!s) return '';
  const t = s.replace(/[.!?]$/, '');
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
export const ThoughtNode = ({ it }) => {
  const g = gist(it.text);
  return <Node g="◇" c={C.think}><Text color={C.think} italic wrap="truncate-end">thought {fmtSecs(Math.max(1, it.secs))}{g ? <Text color={C.dim} italic={false}> · {g}</Text> : it.tokens ? <Text color={C.faint}> · {plural(it.tokens, 'token')}</Text> : null}<Text color={C.faint} italic={false}>  (ctrl+o)</Text></Text></Node>;
};
// While it thinks: a meter against the thinking cap, then its latest three lines, with the
// model's own line breaks kept.
export function ThinkingLive({ thinking, now, width, cap }) {
  const secs = Math.max(0, (now - (thinking.startedAt ?? now)) / 1000);
  const tokens = thinking.tokens ?? 0;
  const paras = String(thinking.text ?? '').slice(-1500).split(/\n+/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const all = paras.flatMap((p) => wrap(p, Math.max(20, width - 8)));
  const lines = all.slice(-3);
  const frac = cap ? tokens / cap : 0;
  return (
    <Box flexDirection="column">
      <Node g="◇" c={C.think}><Text color={C.think} italic>thinking <Text color={C.faint} italic={false}>· {fmtSecs(secs)} · </Text>{cap ? <Text italic={false}><Text color={frac >= NEAR ? C.warn : C.think}>{meter(frac)}</Text><Text color={C.faint}> {kTok(tokens)} of {kTok(cap)}</Text></Text> : <Text color={C.faint} italic={false}>{plural(tokens, 'token')}</Text>}</Text></Node>
      {lines.map((l, i) => <Pipe key={i}><Text color={C.think} italic wrap="truncate-end">{i === 0 && all.length > 3 ? '…' : ' '}{l}</Text></Pipe>)}
    </Box>
  );
}

export const ReplyNode = ({ text }) => <Node g="●" c="ansi256(255)"><Markdown text={text} /></Node>;

// A tool's step, by what it did.
const kb = (b) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`);
export function ToolNode({ it }) {
  const v = it.view ?? {};
  const what = v.path ?? it.arg;
  const more = (n, hint = '') => <Pipe><Text color={C.dim}>{'      '}… {n} more {n === 1 ? 'line' : 'lines'}{hint ? <Text color={C.faint}>{hint}</Text> : null}</Text></Pipe>;
  switch (v.kind) {
    case 'diff': {
      if (v.created) {
        const bytes = v.hunk.reduce((n, l) => n + Buffer.byteLength(l.text ?? '') + 1, 0);
        const shown = v.hunk.slice(0, 8);
        return (
          <Box flexDirection="column">
            <Node g="✎" c={C.edits}><Head verb="Created" c={C.edits} what={what} detail={`${plural(v.additions ?? v.hunk.length, 'line')} · ${kb(bytes)}`} /></Node>
            {shown.map((l, i) => <Pipe key={i}><Text wrap="truncate-end"><Text color={C.faint}>{String(l.newNo ?? '').padStart(4)}  </Text><Text color={CODE}>{l.text || ' '}</Text></Text></Pipe>)}
            {v.hunk.length > 8 ? more(v.hunk.length - 8, '  (ctrl+o to see it)') : null}
          </Box>
        );
      }
      const changed = v.hunk.filter((l) => l.type !== ' ');
      const shown = changed.slice(0, 12);
      const a = v.additions ?? 0, r = v.removals ?? 0;
      const detail = a && a === r ? plural(a, 'line') : a && !r ? `+${plural(a, 'line')}` : r && !a ? `−${plural(r, 'line')}` : a ? `+${a} −${r}` : 'no change';
      return (
        <Box flexDirection="column">
          <Node g="✎" c={C.edits}><Head verb="Changed" c={C.edits} what={what} detail={detail} /></Node>
          {shown.map((l, i) => <Pipe key={i}><Text wrap="truncate-end"><Text color={C.faint}>{String((l.type === '-' ? l.oldNo : l.newNo) ?? '').padStart(4)}  </Text><Text color={l.type === '+' ? C.ok : C.bad}>{l.type} {l.text}</Text></Text></Pipe>)}
          {changed.length > 12 ? more(changed.length - 12) : null}
        </Box>
      );
    }
    case 'read': return <Node g="○" c={C.dim}><Head verb={v.outline ? 'Outline' : 'Read'} c="ansi256(250)" what={what} detail={v.outline ? `${v.parts} parts of ${plural(v.total, 'line')}` : `${plural(v.lines, 'line')}${v.total > v.lines ? ` of ${v.total}` : ''}`} hint="ctrl+o to expand" /></Node>;
    case 'screen': return <Node g="○" c={C.dim}><Head verb="Looked at" c="ansi256(250)" what={v.what} detail={`${v.size} · a picture, nothing clicked`} /></Node>;
    case 'same': return <Node g="○" c={C.dim}><Head verb="Read" c="ansi256(250)" what={what} detail="already read above, unchanged" /></Node>;
    case 'list': return <Node g="○" c={C.dim}><Head verb="Listed" c="ansi256(250)" what={it.arg} detail={plural(v.count, 'path')} /></Node>;
    case 'search': return <Node g="○" c={C.dim}><Head verb="Searched" c="ansi256(250)" what={it.arg} detail={plural(v.count, 'match')} /></Node>;
    case 'agent': return <Node g="◆" c={it.error ? C.bad : C.accent}><Head verb={it.label} c={it.error ? C.bad : C.accent} what={it.arg} detail={`${plural(v.steps ?? 0, 'step')} · ${fmtSecs(v.secs ?? 0)}${v.reason && !['done', 'answered'].includes(v.reason) ? ` · ${v.reason}` : ''}`} hint="ctrl+o for its steps and report" /></Node>;
    case 'websearch': return <Node g="○" c={C.dim}><Head verb="Searched the web" c="ansi256(250)" what={it.arg} detail={`${plural(v.count, 'result')}${v.service ? ` · ${v.service}` : ''}`} hint={v.content ? 'ctrl+o to expand' : undefined} /></Node>;
    case 'fetched': return v.moved
      ? <Node g="○" c={C.warn}><Head verb="Fetched" c={C.warn} what={it.arg} detail={`moves to ${v.moved}, not followed`} /></Node>
      : <Node g="○" c={C.dim}><Head verb="Fetched" c="ansi256(250)" what={it.arg} detail={[kb(v.bytes ?? 0), v.lines ? `${plural(v.lines, 'line')}${v.total > v.lines ? ` of ${v.total}` : ''}` : ''].filter(Boolean).join(' · ')} hint={v.content ? 'ctrl+o to expand' : undefined} /></Node>;
    case 'bash': {
      const shown = v.lines.slice(0, 4);
      return (
        <Box flexDirection="column">
          <Node g="❯" c={C.edits}><Head verb="Ran" c={C.edits} what={it.arg} /></Node>
          {shown.map((l, i) => <Pipe key={i}><Text wrap="truncate-end">{l || ' '}</Text></Pipe>)}
          {v.lines.length > 4 ? <Pipe><Text color={C.dim}>… +{v.lines.length - 4} lines <Text color={C.faint}>(ctrl+o to expand)</Text></Text></Pipe> : null}
          {v.timedOut ? <Pipe><Text color={C.warn}>Stopped after 2 minutes</Text></Pipe> : v.code ? <Pipe><Text color={C.bad}>Exit code {v.code}</Text></Pipe> : null}
        </Box>
      );
    }
    case 'opening': return (
      <Box flexDirection="column">
        <Node g="○" c={C.dim}><Head verb={v.title} c="ansi256(250)" what="" detail={v.lines[0] ?? ''} hint="ctrl+o to expand" /></Node>
        <Pipe><Text color={C.dim} wrap="truncate-end">$ {v.command}</Text></Pipe>
        {v.lines.slice(1).map((l, i) => <Pipe key={i}><Text wrap="truncate-end">{l}</Text></Pipe>)}
      </Box>
    );
    case 'todos': return (
      <Box flexDirection="column">
        <Node g="☐" c={C.ok}><Text bold>{it.label === 'Plan' ? 'Plan' : 'Update Todos'}</Text></Node>
        {v.items.map((t, i) => <Pipe key={i}><Text color={t.status === 'done' ? C.dim : undefined} strikethrough={t.status === 'done'} bold={t.status === 'in_progress'}>{t.status === 'done' ? '☒' : '☐'} {t.text}</Text></Pipe>)}
      </Box>
    );
    // A tool of an MCP server: its server and name, its arguments in a few words, then the first lines it answered.
    case 'mcp': {
      const lines = String(v.content ?? '').split('\n').filter((l) => l.trim());
      const shown = v.looked ? [] : lines.slice(0, 3);
      const c = it.error ? C.bad : C.accent;
      return (
        <Box flexDirection="column">
          <Node g="◈" c={c}><Head verb={it.label} c={c} what={it.arg} detail={v.looked ? 'its arguments, nothing ran' : [it.error ? 'the tool reported an error' : null, v.pictures ? `${plural(v.pictures, 'picture')}${v.shown ? '' : ' not shown'}` : null, v.ms >= 1000 ? fmtSecs(v.ms / 1000) : null].filter(Boolean).join(' · ') || 'MCP'} hint={v.looked ? 'ctrl+o to expand' : undefined} /></Node>
          {shown.map((l, i) => <Pipe key={i}><Text color={it.error ? C.bad : undefined} wrap="truncate-end">{l}</Text></Pipe>)}
          {lines.length > shown.length && !v.looked ? <Pipe><Text color={C.dim}>… +{lines.length - shown.length} lines <Text color={C.faint}>(ctrl+o to expand)</Text></Text></Pipe> : null}
        </Box>
      );
    }
    case 'toolsearch': return <Node g="○" c={C.dim}><Head verb="Searched the tools" c="ansi256(250)" what={it.arg} detail={v.tools?.length ? `loaded ${v.tools.join(', ')}` : 'nothing found'} /></Node>;
    case 'denied': return <Node g="⊘" c={C.warn}><Head verb="Not allowed" c={C.warn} what={`${it.label}(${it.arg})`} /><Text color={C.warn}>{v.message}</Text></Node>;
    case 'declined': return <Node g="⊘" c={C.dim}><Head verb="You said no" c={C.dim} what={`${it.label}(${it.arg})`} detail={v.feedback || ''} /></Node>;
    case 'answer': return <Node g="›" c={C.accent}><Head verb={it.label} c={C.accent} what={it.arg} /><Text><Text color={C.dim}>You: </Text>{v.text}</Text></Node>;
    case 'error': return <Node g="✗" c={C.bad}><Head verb={it.label} c={C.bad} what={it.arg} /><Text color={C.bad}>Error: {v.message}</Text></Node>;
    default: return <Node g="●" c={it.error ? C.bad : C.ok}><Head verb={it.label} c={it.error ? C.bad : C.ok} what={it.arg} /></Node>;
  }
}

// The layout check as a step: each problem named under it.
export function CheckNode({ check }) {
  const n = check.problems.length;
  const where = `1440 px, phone, dark · ${check.secs.toFixed(1)} s`;
  if (!n) return <Node g="◎" c={C.ok}><Text><Text color={C.ok} bold>Layout check</Text><Text color={PATH}>  {check.page}</Text><Text color={C.ok}>  ✓ nothing broken</Text><Text color={C.dim}> · {where}</Text></Text></Node>;
  return (
    <Box flexDirection="column">
      <Node g="◎" c={C.warn}><Text><Text color={C.warn} bold>Layout check</Text><Text color={PATH}>  {check.page}</Text><Text color={C.warn}>  ✗ {plural(n, 'problem')}{check.again ? ' left' : ''}</Text><Text color={C.dim}> · {where}{(check.sent ?? !check.again) ? ' · sent back to fix' : ''}</Text></Text></Node>
      {check.problems.slice(0, 6).map((p, i) => <Pipe key={i}><Text color="ansi256(250)">{p}</Text></Pipe>)}
      {n > 6 ? <Pipe><Text color={C.dim}>… {n - 6} more</Text></Pipe> : null}
    </Box>
  );
}

// A note that came during the turn.
export const NoteNode = ({ it }) => {
  const color = it.tone === 'error' ? C.bad : it.tone === 'warn' ? C.warn : it.tone === 'ok' ? C.ok : C.dim;
  return <Node g={it.tone === 'error' ? '✗' : '·'} c={color}><Text color={color}>{it.text}</Text></Node>;
};

// The turn's last line: how it ended.
const clock = (t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
export function EndLine({ it, counts = '' }) {
  const lead = <Text color={RAIL}>{'  ╰─ '}</Text>;
  // What the request cost on a paid service (/remote, spend.mjs).
  const cost = it.usd > 0 ? <Text color={C.dim}> · {money(it.usd)} for this request</Text> : null;
  if (it.reason === 'interrupted') return <Text>{lead}<Text color={C.warn}>■ {it.text ?? 'Interrupted · What should Agentic Coder do instead?'}</Text>{cost}</Text>;
  if (it.reason && it.reason !== 'done') return <Text>{lead}<Text color={it.left ? C.warn : C.dim}>{it.text ?? `Stopped (${it.reason})`}{it.left ? ` · ${plural(it.left, 'layout problem')} left` : ''}</Text><Text color={C.dim}>{it.secs >= 1 ? ` · ${fmtSecs(it.secs)}` : ''} · {clock(it.at)}</Text>{cost}</Text>;
  const left = it.left ? <Text color={C.warn}>✗ Ended with {plural(it.left, 'layout problem')} left · </Text> : null;
  const time = it.secs >= 1 ? `${it.past} for ${fmtSecs(it.secs)}${counts} · done ${clock(it.at)}` : `done ${clock(it.at)}`;
  return <Text>{lead}{left}<Text color={it.left ? C.warn : C.accent}>{it.left ? '' : `${MARK} `}</Text><Text color={C.dim}>{time}</Text>{cost}</Text>;
}

// While a tool call is being written: the file and how many lines so far, read from what has
// arrived of its arguments (JSON, so a new line is the two characters \n).
export function writingWhat(w) {
  if (!w?.name) return null;
  const args = String(w.args ?? '');
  const path = /"(?:path|file_path|file)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(args)?.[1];
  const file = path ? path.split('/').pop() : null;
  const lines = (args.match(/\\n/g) ?? []).length + (/"(?:content|new_string|new)"\s*:\s*"/.test(args) ? 1 : 0);
  return { name: w.name, file, lines };
}
// The content a Write or Edit has sent so far, as text: the end of its JSON string, unescaped.
export function writtenSoFar(args) {
  const m = /"(?:content|new_string|new)"\s*:\s*"/.exec(String(args ?? ''));
  if (!m) return '';
  const raw = String(args).slice(m.index + m[0].length).replace(/"\s*}?\s*$/, '');
  return raw.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '  ' : c === 'r' ? '' : c[0] === 'u' && c.length === 5 ? String.fromCharCode(parseInt(c.slice(1), 16)) : c));
}
// room: the most this reply may write (thinking and all); used: how much it has written.
export function WritingNode({ writing, room, used, tps }) {
  const w = writingWhat(writing);
  if (!w) return null;
  if (w.file && /^(Write|Edit|Update|MultiEdit|Create)/i.test(w.name)) {
    const frac = room ? Math.min(1, (used ?? 0) / room) : 0;
    const near = frac >= NEAR;
    const tail = writtenSoFar(writing.args).split('\n');
    const shown = tail.slice(-2);
    const first = tail.length - shown.length + 1;
    return (
      <Box flexDirection="column">
        <Node g="✎" c={C.edits}><Text><Text color={C.edits} bold>Writing</Text><Text color={PATH}>  {w.file}</Text><Text color={C.dim}> · {plural(w.lines, 'line')}</Text></Text></Node>
        {room ? <Pipe><Text><Text color={near ? C.warn : C.accentDim}>{'    '}{meter(frac, 10)}</Text><Text color={near ? C.warn : C.dim}> {kTok(used ?? 0)} of {kTok(room)} reply room{near ? ' · near the limit' : ''}</Text>{tps ? <Text color={C.faint}> · {tps.toFixed(1)} tok/s</Text> : null}</Text></Pipe> : null}
        {w.lines ? shown.map((l, i) => <Pipe key={i}><Text wrap="truncate-end"><Text color={C.faint}>{String(first + i).padStart(6)}  </Text><Text color={C.dim}>{l || ' '}</Text></Text></Pipe>) : null}
      </Box>
    );
  }
  return <Node g="▸" c={C.dim}><Text color={C.dim}>Preparing <Text bold>{w.name}</Text>…</Text></Node>;
}
export const doingWords = (live) => {
  const w = writingWhat(live.writing);
  if (w?.file) return `writing ${w.file}`;
  if (live.running) return `running ${live.running.label}`;
  if (live.thinking && !live.text) return 'thinking';
  return '';
};
