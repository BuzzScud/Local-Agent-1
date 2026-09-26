// What the terminal shows, laid out like Claude Code: thinking folded to one
// line, one spinner with the time and tokens, a line with the time left behind
// when a turn ends, nothing under the prompt but the footer (/meters on adds
// the status bar).
// Finished lines go in <Static> (printed once, so the terminal's own
// scrollback keeps working); the live area below them is redrawn.
import React, { useRef, useLayoutEffect } from 'react';
import { Box, Text, Static, renderToString, measureElement } from 'ink';
import { C, MARK, spinFrame, fmtSecs, fmtTok } from '../ui/theme.mjs';
import { wrap, Row, Result, ToolHead, Diff, Todos, InputBox, modeLabel, MODE_TEXT, CYCLE_HINT } from '../ui/parts.jsx';
import { Markdown } from './markdown.jsx';
import { MIN_COLS, MIN_ROWS } from './window.mjs';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const diffW = (width) => Math.max(40, Math.min(110, width - 12));

// Long folder paths keep their end, which is the part that says where you are.
const fitPath = (p, max) => (p.length <= max ? p : `…${p.slice(p.length - max + 1)}`);

// A numbered tip whose second line lines up under the first.
const Tip = ({ n, children }) => (
  <Box paddingLeft={2}>
    <Box width={3} flexShrink={0}><Text color={C.dim}>{n}.</Text></Box>
    <Text color={C.dim}>{children}</Text>
  </Box>
);

const TIPS = [
  'Run /init to write an AGENTS.md with notes about this project',
  'Ask for a change: Bonsai reads, edits and tests, and asks before it touches anything',
  'Everything runs on this Mac; nothing is sent anywhere',
];

// Like Claude Code: a welcome box as wide as its words, then the tips.
export function Welcome({ model, cwd, width, loaded }) {
  const lines = [`  /help for help · /stats for your current setup`, `  ${model}, on this Mac`, `  cwd: ${cwd}`, ...(loaded ? [`  loaded: ${loaded}`] : [])];
  const boxW = Math.min(width, 76, Math.max(34, ...lines.map((l) => l.length + 4), 'Welcome to Bonsai Code!'.length + 6));
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={C.accent} paddingX={1} width={boxW} flexDirection="column">
        <Text><Text color={C.accent}>{MARK}</Text> Welcome to <Text bold>Bonsai Code</Text>!</Text>
        <Text> </Text>
        <Text color={C.dim}>  /help for help · /stats for your current setup</Text>
        <Text> </Text>
        <Text color={C.dim}>  {model}, on this Mac</Text>
        <Text color={C.dim}>  cwd: {fitPath(cwd, boxW - 11)}</Text>
        {loaded ? <Text color={C.dim} wrap="truncate-end">  loaded: {loaded}</Text> : null}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text color={C.dim}> Tips for getting started:</Text>
        {TIPS.map((t, i) => <Tip key={i} n={i + 1}>{t}</Tip>)}
      </Box>
    </Box>
  );
}

function ToolView({ it, width }) {
  const v = it.view ?? {};
  const bullet = it.error ? C.bad : C.ok;
  const head = <ToolHead tool={it.label} arg={it.arg} color={bullet} />;
  let body = null;
  switch (v.kind) {
    case 'read': body = v.outline ? <Text>Outline: <Text bold>{v.parts}</Text> parts of {v.total} lines <Text color={C.dim}>(ctrl+o to expand)</Text></Text> : <Text>Read <Text bold>{v.lines}</Text> {v.lines === 1 ? 'line' : 'lines'}{v.total > v.lines ? ` of ${v.total}` : ''} <Text color={C.dim}>(ctrl+o to expand)</Text></Text>; break;
    case 'list': body = <Text>Listed <Text bold>{v.count}</Text> {v.count === 1 ? 'path' : 'paths'} <Text color={C.dim}>(ctrl+o to expand)</Text></Text>; break;
    case 'search': body = <Text>Found <Text bold>{v.count}</Text> {v.count === 1 ? 'match' : 'matches'} <Text color={C.dim}>(ctrl+o to expand)</Text></Text>; break;
    case 'diff': {
      const parts = [v.additions && plural(v.additions, 'addition'), v.removals && plural(v.removals, 'removal')].filter(Boolean).join(' and ') || 'no changes';
      const hunk = v.hunk.length > 40 ? [...v.hunk.slice(0, 40)] : v.hunk;
      body = (
        <Box flexDirection="column">
          <Text>{v.created ? <>Wrote <Text bold>{v.lines}</Text> lines to <Text bold>{v.path}</Text></> : <>Updated <Text bold>{v.path}</Text> with {parts}</>}</Text>
          <Diff hunk={hunk} width={diffW(width)} />
          {v.hunk.length > 40 ? <Text color={C.dim}>… +{v.hunk.length - 40} more lines</Text> : null}
        </Box>
      );
      break;
    }
    case 'bash': {
      const shown = v.lines.filter((l, i) => i < 4 || false);
      const more = v.lines.length - shown.length;
      body = (
        <Box flexDirection="column">
          {shown.map((l, i) => <Text key={i} wrap="truncate-end">{l || ' '}</Text>)}
          {more > 0 ? <Text color={C.dim}>… +{more} lines (ctrl+o to expand)</Text> : null}
          {v.timedOut ? <Text color={C.warn}>Stopped after 2 minutes</Text> : v.code ? <Text color={C.bad}>Exit code {v.code}</Text> : null}
        </Box>
      );
      break;
    }
    case 'todos': return <Todos title={it.label === 'Plan' ? 'Plan' : 'Update Todos'} items={v.items.map((t) => ({ text: t.text, done: t.status === 'done', active: t.status === 'in_progress' }))} />;
    case 'denied': body = <Text color={C.warn}>Not allowed: {v.message}</Text>; break;
    case 'declined': body = <Text color={C.dim}>You said no{v.feedback ? `: ${v.feedback}` : ''}</Text>; break;
    case 'answer': body = <Text><Text color={C.dim}>You: </Text>{v.text}</Text>; break;
    case 'error': body = <Text color={C.bad}>Error: {v.message}</Text>; break;
    case 'same': body = <Text color={C.dim}>Already read above, unchanged; not read again</Text>; break;
    default: body = null;
  }
  return <Box flexDirection="column">{head}{body ? <Result>{body}</Result> : null}</Box>;
}

// The clock time a turn ended, as Claude Code writes it: "12:58 PM".
const clock = (t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function Item({ it, width, model, cwd, loaded }) {
  switch (it.type) {
    case 'welcome': return <Welcome model={model} cwd={cwd} width={width} loaded={loaded} />;
    case 'user': return (
      <Box flexDirection="column">
        <Row mark=">" markColor={C.dim}><Text color={C.dim}>{it.text}</Text></Row>
        {it.attached?.length ? <Result><Text color={C.dim}>Attached {it.attached.map((a) => `${a.path} (${plural(a.lines, 'line')})`).join(', ')}</Text></Result> : null}
      </Box>
    );
    case 'thinking': return <Text color={C.think} italic>∴ Thought for {fmtSecs(Math.max(1, it.secs))} <Text color={C.faint}>(ctrl+o to show thinking)</Text></Text>;
    // The line a finished turn leaves behind: "⠿ Worked for 41s · done 12:58 PM".
    case 'done': return <Text><Text color={C.accent}>{MARK}</Text><Text color={C.dim}> {it.past} for {fmtSecs(it.secs)} · done {clock(it.at)}</Text></Text>;
    case 'text': return <Row><Markdown text={it.text} /></Row>;
    case 'tool': return <ToolView it={it} width={width} />;
    case 'note': {
      const color = it.tone === 'error' ? C.bad : it.tone === 'warn' ? C.warn : C.dim;
      return <Row mark={it.tone === 'error' ? '✗' : '·'} markColor={color}><Text color={color}>{it.text}</Text></Row>;
    }
    case 'bash': return (
      <Box flexDirection="column">
        <Row mark="!" markColor={C.edits}><Text color={C.edits}>{it.command}</Text></Row>
        <Result>
          {it.lines.slice(0, 20).map((l, i) => <Text key={i} wrap="truncate-end">{l || ' '}</Text>)}
          {it.lines.length > 20 ? <Text color={C.dim}>… +{it.lines.length - 20} lines</Text> : null}
          {it.code ? <Text color={C.bad}>Exit code {it.code}</Text> : null}
        </Result>
      </Box>
    );
    case 'expand': return (
      <Box flexDirection="column" borderStyle="round" borderColor={C.faint} paddingX={1}>
        <Text color={C.dim} bold>{it.title}</Text>
        {it.text.split('\n').slice(0, 300).map((l, i) => <Text key={i} color={C.think} wrap="wrap">{l || ' '}</Text>)}
        {it.text.split('\n').length > 300 ? <Text color={C.dim}>… cut at 300 lines</Text> : null}
      </Box>
    );
    case 'panel': return (
      <Box flexDirection="column">
        {it.title ? <Text bold>{it.title}</Text> : null}
        {it.rows.map((r, i) => (
          <Text key={i}>
            {r[1] === undefined ? <Text color={C.dim}>{r[0]}</Text> : <><Text color={C.accent}>{String(r[0]).padEnd(it.pad ?? 18)}</Text><Text>{r[1]}</Text></>}
          </Text>
        ))}
      </Box>
    );
    case 'tries': return (
      <Box flexDirection="column">
        <Row markColor={it.failed ? C.warn : C.ok}><Text bold>{it.label}</Text></Row>
        <Result><Text><Marks marks={it.marks} />  <Text color={C.dim}>{it.summary}{it.secs >= 1 ? ` · ${fmtSecs(it.secs)}` : ''}</Text></Text></Result>
      </Box>
    );
    case 'divider': return <Text color={C.faint}>{`── ${it.text} `.padEnd(Math.min(width, 80), '─')}</Text>;
    default: return null;
  }
}

function Marks({ marks, pending = false }) {
  return (
    <Text>
      {marks.map((m, i) => <Text key={i} color={m === '✓' ? C.ok : C.bad}>{m} </Text>)}
      {pending ? <Text color={C.accent}>●</Text> : null}
    </Text>
  );
}

function bar(frac, cells = 10) {
  const n = Math.min(cells, Math.max(frac > 0 ? 1 : 0, Math.round(frac * cells)));
  return '▰'.repeat(n) + '▱'.repeat(cells - n);
}

// What the status line says now: idle, reading, writing, running, waiting.
function speedOf(app) {
  const { live, stats } = app;
  let speed = <Text color={C.dim}>idle</Text>;
  if (app.waitingForYou) return <Text color={C.ask}>waiting for you</Text>;
  if (live.phase === 'working') {
    if (live.running) speed = <Text color={C.dim}>running {live.running.label}</Text>;
    else if (live.firstTokenAt && !live.waiting) speed = <Text color={C.accent}>↓ {live.liveTps ? live.liveTps.toFixed(1) : '…'} tok/s writing</Text>;
    else speed = <Text color={C.accent}>↑ {stats.pps ? Math.round(stats.pps) : '…'} tok/s reading</Text>;
  } else if (app.waitingForYou) speed = <Text color={C.ask}>waiting for you</Text>;
  return speed;
}

// Like Claude Code, the memory is invisible until it matters: from 70% full a
// dim line says what happens next (old output trimmed at 78%, the talk
// summarized near 85%); /stats has the numbers; /meters brings the old bar back.
export function memoryWarning(used, ctx) {
  const pct = ctx ? Math.round((used / ctx) * 100) : 0;
  if (pct < 70) return null;
  return pct >= 85 ? `Memory ${pct}% full: the conversation is summarized at the next step` : `Memory ${pct}% full: old tool output is trimmed soon, the conversation summarized when full`;
}
function MemoryWarning({ app }) {
  const text = memoryWarning(app.stats.ctxUsed ?? 0, app.ctx);
  if (!text) return null;
  return <Box paddingX={2} width={app.width}><Text color={C.warn} wrap="truncate-end">{text}</Text></Box>;
}

// The status line under the footer (/meters on): model, speed, memory, effort.
function Meters({ app }) {
  const { stats, modelName, ctx, ramGb } = app;
  const speed = speedOf(app);
  const used = stats.ctxUsed ?? 0;
  return (
    <Box paddingX={2} width={app.width}>
      <Text color={C.dim} wrap="truncate-end">
        {modelName}  {speed}  ctx <Text color={C.accentDim}>{bar(used / ctx)}</Text> {Math.max(1, Math.round((used / ctx) * 100))}% of {Math.round(ctx / 1024)}k{ramGb ? `  RAM ${ramGb.toFixed(1)} GB` : ''}  effort {app.thinkingLabel ?? (app.thinking ? 'on' : 'low')}
      </Text>
    </Box>
  );
}

// The icon on the "Starting …" line: no tokens yet, so orbit drifts dim.
function StartIcon({ app }) {
  const icon = spinFrame(app.spinner, Math.max(0, (app.now - app.startedAt) / 1000));
  return <Text color={icon.color}>{icon.glyph}</Text>;
}

export function Spinner({ app }) {
  const { live, now } = app;
  const secs = Math.max(0, (now - live.turnStart) / 1000);
  const note = live.flowStep ? ` · step ${live.flowStep.index + 1} of ${live.flowStep.count}: ${live.flowStep.text}` : '';
  const icon = spinFrame(app.spinner, secs, { tokens: live.tokens, sinceToken: live.lastTokenAt ? (now - live.lastTokenAt) / 1000 : Infinity });
  return (
    <Box marginBottom={1} width={app.width}>
      <Text wrap="truncate-end">
        <Text color={icon.color}>{icon.glyph}</Text><Text color={C.accent}> {live.verb}…</Text>
        <Text color={C.dim}> ({fmtSecs(secs)} · ↓ {fmtTok(live.tokens)} tokens{note} · esc to interrupt)</Text>
      </Text>
    </Box>
  );
}

// The end of a reply still being written, cut to at most `maxLines` lines
// AS SHOWN (long lines wrap at `width`): counting source lines let a few long
// ones fill a small window, and a live area taller than the window makes Ink
// clear and redraw the whole screen on every frame.
export function tailToFit(text, maxLines, width) {
  const w = Math.max(10, width);
  const src = text.split('\n');
  const out = [];
  let used = 0;
  for (let i = src.length - 1; i >= 0; i--) {
    const n = Math.max(1, wrap(src[i], w).length, Math.ceil(src[i].length / w));
    if (used + n > maxLines) {
      // Not even this line fits whole: keep its last part.
      if (!out.length) out.unshift(`…${src[i].slice(-(maxLines * w - 1))}`);
      break;
    }
    out.unshift(src[i]);
    used += n;
  }
  return out.join('\n');
}

export function LiveArea({ app }) {
  const { live, width, rows } = app;
  if (live.phase !== 'working') return null;
  const maxLines = Math.max(6, rows - 16);
  const blocks = [];
  // While it thinks: one folded line above the spinner, as in Claude Code
  // (ctrl+o shows the thinking once the turn is over).
  if (live.thinking && !live.text && !live.writing) blocks.push(<Box key="think" marginBottom={1}><Text color={C.think} italic>∴ Thinking…</Text></Box>);
  if (live.text) {
    const shown = tailToFit(live.text, maxLines, width - 3);
    // Clipped to maxLines rows, keeping the end: however the text renders
    // (lists and paragraphs add lines), it cannot be taller than the window.
    // Taller once spilled its first line into the scrollback 249 times.
    blocks.push(
      <Box key="text" marginBottom={1} maxHeight={maxLines} overflow="hidden" flexDirection="column" justifyContent="flex-end">
        <Box flexDirection="column" flexShrink={0}><Row><Markdown text={shown} /></Row></Box>
      </Box>,
    );
  }
  if (live.tries) {
    const t = live.tries;
    blocks.push(
      <Box key="tries" flexDirection="column" marginBottom={1}>
        <Row markColor={C.dim}><Text bold>{t.label}</Text><Text color={C.dim}> ({Math.min(t.n, t.max)} of up to {t.max})</Text></Row>
        <Result><Text><Marks marks={t.marks} pending />{t.tokens ? <Text color={C.dim}>  writing… {plural(t.tokens, 'token')}</Text> : <Text color={C.dim}>  checking…</Text>}</Text></Result>
      </Box>,
    );
  }
  if (live.running) {
    blocks.push(
      <Box key="running" flexDirection="column" marginBottom={1}>
        <ToolHead tool={live.running.label} arg={live.running.arg} color={C.dim} />
        <Result><Text color={C.dim}>Running…</Text></Result>
      </Box>,
    );
  }
  if (!app.perm) blocks.push(<Spinner key="spin" app={app} />);
  return <Box flexDirection="column">{blocks}</Box>;
}

const PERM_TITLE = { Edit: 'Edit file', Write: 'Create file', Bash: 'Bash command', Rename: 'Rename', Test: 'Approve this test', Ask: 'Bonsai asks' };

export function permissionOptions(req, prefix) {
  const no = { label: 'No, and tell Bonsai what to do differently (esc)', choice: 'no' };
  if (req.name === 'Ask') return [...(req.args.options ?? []).map((o) => ({ label: o, choice: 'answer', text: o })), { label: 'Type an answer', choice: 'type' }, { label: 'Stop here (esc)', choice: 'no' }];
  if (req.name === 'Bash') return [{ label: 'Yes', choice: 'yes' }, { label: `Yes, and don't ask again for ${prefix} this session`, choice: 'always' }, no];
  if (req.name === 'Test') return [{ label: 'Yes, use this test', choice: 'yes' }, { label: 'No, and tell Bonsai what the test should check (esc)', choice: 'no' }];
  if (req.name === 'Rename') return [{ label: 'Yes', choice: 'yes' }, { label: 'Yes, and allow all edits this session (shift+tab)', choice: 'always' }, no];
  return [{ label: 'Yes', choice: 'yes' }, { label: 'Yes, allow all edits this session (shift+tab)', choice: 'always' }, no];
}

function PermissionPrompt({ app }) {
  const { perm, width } = app;
  const req = perm.req;
  const title = req.name === 'Write' && !req.prepared?.created ? 'Overwrite file' : PERM_TITLE[req.name] ?? req.name;
  const hunk = req.prepared?.hunk ?? [];
  // The whole prompt fits the window with a line to spare: a live area as
  // tall as the window makes Ink clear and redraw the screen on every frame.
  const fixed = 2 + 1 + 1 + perm.options.length + 1 + 1; // …, the status line, a spare line
  const room = Math.max(3, app.rows - fixed);
  const cap = Math.max(2, room - 4); // the diff box: its border, file name and "more lines"
  const files = req.prepared?.files ?? [];
  const nFiles = Math.max(1, Math.min(6, files.length, Math.floor((room - 1) / 5)));
  // Two lines more slack than the sum suggests: at 22 of 24 rows Ink still cleared the whole screen.
  const perFile = Math.max(1, Math.floor((room - 3 - 3 * nFiles) / nFiles));
  const cmdLines = String(req.args?.command ?? '').split('\n');
  return (
    <Box borderStyle="round" borderColor={C.ask} flexDirection="column" paddingX={1} width={width}>
      <Text bold color={C.ask}>{title}</Text>
      {req.name === 'Ask' ? (
        <Box flexDirection="column" paddingX={2} marginY={1}>
          <Text>{req.args.question}</Text>
        </Box>
      ) : req.name === 'Bash' ? (
        <Box flexDirection="column" paddingX={2} marginY={1}>
          <Text>{cmdLines.length > room - 3 ? `${cmdLines.slice(0, room - 4).join('\n')}\n… +${cmdLines.length - (room - 4)} lines` : req.args.command}</Text>
          <Text color={C.dim} wrap="truncate-end">{req.args.description ? `${req.args.description} · ` : ''}in {fitPath(app.cwdShort, Math.max(20, width - 12 - (req.args.description ? req.args.description.length + 3 : 0)))}</Text>
        </Box>
      ) : req.name === 'Rename' ? (
        <Box flexDirection="column">
          {files.slice(0, nFiles).map((f) => (
            <Box key={f.rel} borderStyle="round" borderColor={C.faint} flexDirection="column" paddingX={1}>
              <Text bold>{f.rel} <Text color={C.dim}>({f.count} use{f.count === 1 ? '' : 's'})</Text></Text>
              <Diff hunk={f.hunk.filter((l) => !l.gap).slice(0, perFile)} width={diffW(width) - 4} />
            </Box>
          ))}
          {files.length > nFiles ? <Text color={C.dim}>… and {files.length - nFiles} more file{files.length - nFiles === 1 ? '' : 's'}</Text> : null}
        </Box>
      ) : (
        <Box borderStyle="round" borderColor={C.faint} flexDirection="column" paddingX={1}>
          <Text bold>{req.prepared.rel}</Text>
          <Diff hunk={hunk.slice(0, cap)} width={diffW(width) - 4} />
          {hunk.length > cap ? <Text color={C.dim}>… +{hunk.length - cap} more lines</Text> : null}
        </Box>
      )}
      {req.name === 'Ask' ? null
        : req.name === 'Bash' ? <Text>Do you want to proceed?</Text>
        : req.name === 'Rename' ? <Text>Rename <Text bold>{req.args.from}</Text> to <Text bold>{req.args.to}</Text>: {req.prepared.total} use{req.prepared.total === 1 ? '' : 's'} in {req.prepared.files.length} file{req.prepared.files.length === 1 ? '' : 's'}?</Text>
        : req.name === 'Test' ? <Text>Use this test to decide when the change is done? <Text color={C.dim}>(it fails today, as it should)</Text></Text>
        : <Text>Do you want to {req.name === 'Write' && req.prepared.created ? 'create' : 'make this edit to'} <Text bold>{req.prepared.rel}</Text>?</Text>}
      {perm.options.map((o, i) => (
        <Text key={i} color={i === perm.selected ? C.ask : undefined}>{i === perm.selected ? '❯' : ' '} {i + 1}. {o.label ?? o}</Text>
      ))}
    </Box>
  );
}

function Menu({ app }) {
  const { menu } = app;
  if (!menu || !menu.items.length) return null;
  const SHOW = 10;
  const start = Math.max(0, Math.min(menu.index - 5, menu.items.length - SHOW));
  const shown = menu.items.slice(start, start + SHOW);
  return (
    <Box flexDirection="column" paddingX={2}>
      {shown.map((m, i) => {
        const on = start + i === menu.index;
        // The selected row is highlighted whole (name and description), as in Claude Code.
        return (
          <Text key={m.key ?? m.label} color={on ? C.accent : undefined} wrap="truncate-end">
            <Text bold={on}>{m.label.padEnd(menu.pad ?? 16)}</Text>
            <Text color={on ? C.accent : C.dim}>{m.desc ?? ''}</Text>
          </Text>
        );
      })}
    </Box>
  );
}

const SHORTCUTS = [
  ['/ for commands', 'shift+tab to switch mode'],
  ['@ to attach a file', 'ctrl+o to expand the last output'],
  ['! to run a shell command', 'esc to interrupt Bonsai'],
  ['\\ + enter for a new line', 'ctrl+c twice to quit'],
  ['↑ ↓ for earlier prompts', 'shift+arrows to select and copy'],
];

// The footer's right side is the mode, as in Claude Code; a narrow window
// drops the "(shift+tab to cycle)" hint so it never runs into "? for shortcuts".
export function footerRight(mode, room) {
  const m = MODE_TEXT[mode] ?? '';
  return { cycle: !m || m.length + CYCLE_HINT.length <= room };
}

function Footer({ app }) {
  const { mode, notice, width } = app;
  // An open menu takes the footer's place, as in Claude Code.
  if (app.menu?.items?.length) return null;
  const left = notice ?? (app.inputMode === 'bash' ? '! shell mode: runs the command yourself' : '? for shortcuts');
  const pick = footerRight(mode, width - 4 - Math.min(left.length, 15) - 2);
  // The weights badge shares the lower right with the mode label.
  const ml = modeLabel(mode, { cycle: pick.cycle });
  const badge = app.weightsBadge ? <Text color={C.accent}>{app.weightsBadge}</Text> : null;
  return (
    <Box flexDirection="column">
      <Box width={width} justifyContent="space-between" paddingX={2} height={1} overflow="hidden">
        <Text color={notice ? C.warn : C.dim} wrap="truncate-end">{left}</Text>
        <Text wrap="truncate-start">{badge}{badge && ml ? <Text color={C.dim}> · </Text> : null}{ml}</Text>
      </Box>
      {app.showShortcuts ? (
        <Box flexDirection="column" paddingX={2} marginTop={1}>
          {SHORTCUTS.map(([a, b], i) => <Text key={i} color={C.dim}>{a.padEnd(36)}{b}</Text>)}
        </Box>
      ) : null}
    </Box>
  );
}

// One line of the prompt with part of it selected: the selected characters on
// a blue background, the cursor inverse, the rest plain. A selected line
// break shows as one highlighted space.
function selectedLine(line, start, sel, col) {
  const chars = [...(line || ' ')].map((ch, i) => ({ ch, sel: start + i >= sel[0] && start + i < sel[1] && (line || start + i < sel[1]), cur: i === col }));
  if (col === line.length && line.length) chars.push({ ch: ' ', sel: false, cur: true });
  if (line.length && start + line.length >= sel[0] && start + line.length < sel[1] && col !== line.length) chars.push({ ch: ' ', sel: true, cur: false });
  const out = []; let run = '', style = null;
  const flush = (k) => { if (!run) return; out.push(style.cur ? <Text key={k} inverse>{run}</Text> : style.sel ? <Text key={k} backgroundColor={C.selBg} color="white">{run}</Text> : <Text key={k}>{run}</Text>); run = ''; };
  chars.forEach((c, i) => { const st = { sel: c.sel && !c.cur, cur: c.cur }; if (style && (st.sel !== style.sel || st.cur !== style.cur)) flush(i); style = st; run += c.ch; });
  flush('end');
  return out;
}

function PromptBox({ app }) {
  const { input, width, inputMode } = app;
  const border = inputMode === 'bash' ? C.edits : C.border;
  const prefix = inputMode === 'bash' ? '!' : '>';
  const value = inputMode === 'bash' ? input.value.slice(1) : input.value;
  const cursor = inputMode === 'bash' ? Math.max(0, input.cursor - 1) : input.cursor;
  const placeholder = app.placeholder;
  const lines = value.split('\n');
  // the selection, in this box's own positions (the ! of shell mode is not drawn)
  const shift = inputMode === 'bash' ? 1 : 0;
  const sel = input.anchor != null && input.anchor !== input.cursor ? [Math.min(input.anchor, input.cursor) - shift, Math.max(input.anchor, input.cursor) - shift] : null;
  let pos = 0;
  return (
    <Box borderStyle="round" borderColor={border} paddingX={1} width={width} flexDirection="column">
      {lines.map((line, li) => {
        const start = pos;
        pos += line.length + 1;
        const here = cursor >= start && cursor <= start + line.length;
        const col = cursor - start;
        const lead = li === 0 ? <Text color={inputMode === 'bash' ? C.edits : undefined}>{prefix} </Text> : <Text>  </Text>;
        if (!value && li === 0) {
          return <Text key={li}>{lead}<Text inverse>{placeholder[0]}</Text><Text color={C.dim}>{placeholder.slice(1)}</Text></Text>;
        }
        if (sel && sel[0] <= start + line.length && sel[1] > start) return <Text key={li}>{lead}{selectedLine(line, start, sel, here ? col : -1)}</Text>;
        if (!here) return <Text key={li}>{lead}{line || ' '}</Text>;
        return <Text key={li}>{lead}{line.slice(0, col)}<Text inverse>{line[col] ?? ' '}</Text>{line.slice(col + 1)}</Text>;
      })}
    </Box>
  );
}

// What "Starting" is waiting for.
const START_PHASE = {
  loading: 'loading the model ',
  reading: 'reading its instructions, about 30 s the first time ',
  restoring: 'restoring its instructions from last time ',
};

// /effort, /mode, /meters alone: their choices as a menu, like Claude Code's.
// The ❯ starts on the one in use; ↑↓ or a number, enter picks, esc goes back.
function ChoicePicker({ app }) {
  const pk = app.picker;
  const w = Math.max(...pk.options.map((o) => o.label.length)) + 2;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      <Text bold>{pk.title}</Text>
      <Text color={C.dim}>{pk.blurb}</Text>
      <Text> </Text>
      {pk.options.map((o, i) => {
        const on = i === pk.index;
        return (
          <Text key={o.id}>
            <Text color={on ? C.accent : undefined} bold={on}>{on ? '❯' : ' '} {i + 1}. {o.label.padEnd(w)}</Text>
            <Text color={C.dim}>{o.note}</Text>
            {o.id === pk.current ? <Text color={C.ok}>  ✔ in use</Text> : null}
          </Text>
        );
      })}
      <Text> </Text>
      <Text color={C.dim}>↑↓ to choose · enter to select · esc to go back</Text>
    </Box>
  );
}

// /model: the model list and the effort level in one picker.
function ModelPicker({ app }) {
  const pk = app.picker;
  const levels = app.thinkingLevels;
  const lv = levels[pk.level];
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      <Text bold>Model</Text>
      <Text color={C.dim}>Pick the model and its effort: how much it thinks before it acts. Kept for next time.</Text>
      <Text> </Text>
      {pk.models.map((m, i) => {
        const on = i === pk.index;
        const desc = m.edited
          ? `${(m.bytes / 1e9).toFixed(1)} GB · ${m.edited.edits.length} edit${m.edited.edits.length === 1 ? '' : 's'} · saved ${new Date(m.edited.saved).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
          : `${(m.bytes / 1e9).toFixed(1)} GB · on this Mac`;
        return (
          <Text key={m.id}>
            <Text color={on ? C.accent : undefined} bold={on}>{on ? '❯' : ' '} {m.name.padEnd(16)}</Text>
            <Text color={C.dim}>{desc.padEnd(24)}</Text>
            {m.name === app.modelName ? <Text color={C.ok}>✔ in use</Text> : null}
          </Text>
        );
      })}
      <Text> </Text>
      <Text>
        <Text bold>{'Effort     '}</Text>
        <Text color={pk.level > 0 ? C.accent : C.faint}>◀  </Text>
        {levels.map((l, i) => (
          <Text key={l.id}>
            {i ? <Text color={C.dim}>  ·  </Text> : null}
            <Text color={i === pk.level ? C.accent : C.dim} bold={i === pk.level} underline={i === pk.level}>{l.label}</Text>
          </Text>
        ))}
        <Text color={pk.level < levels.length - 1 ? C.accent : C.faint}>  ▶</Text>
      </Text>
      <Text color={C.dim}>{'           '}{lv ? `${lv.label}: ${lv.note}` : ''}</Text>
      <Text> </Text>
      <Text color={C.dim}>↑↓ model · ←→ effort · enter to save · esc to cancel</Text>
    </Box>
  );
}

// Shown instead of the screen when the window is smaller than it is laid out for.
function TooSmall({ app }) {
  return (
    <Box flexDirection="column">
      <Text color={C.warn} wrap="wrap">Make the window at least {MIN_COLS}×{MIN_ROWS} to see Bonsai</Text>
      <Text color={C.dim} wrap="wrap">It is {app.columns}×{app.rows} now. {app.perm ? 'Bonsai is waiting for your answer.' : app.live.phase === 'working' ? 'Bonsai keeps working meanwhile.' : ''}</Text>
    </Box>
  );
}

// Rows each printed item takes at a width (a printed item never changes),
// so the space between the conversation and the prompt box can be worked
// out. Measured OUTSIDE rendering (when an item is added, after a resize,
// before the first frame): measuring inside a render makes React print a
// warning into the terminal.
const itemHeights = new Map();
const rowsKey = (it, ctx) => `${it.key}\0${ctx.width}`;
export function primeRows(items, ctx) {
  let added = false;
  for (const it of items) {
    const k = rowsKey(it, ctx);
    if (itemHeights.has(k)) continue;
    if (itemHeights.size > 5000) itemHeights.clear();
    const out = renderToString(
      <Box flexDirection="column" marginBottom={1} width={ctx.width}>
        <Item it={it} width={ctx.width} model={ctx.modelName} cwd={ctx.cwdShort} loaded={ctx.loaded} />
      </Box>, { columns: ctx.width });
    itemHeights.set(k, out.split('\n').length); // the margin under it is the last line
    added = true;
  }
  return added;
}
const heightOf = (it, app) => itemHeights.get(rowsKey(it, app));
// Rows the conversation fills from the top of the window (at most the
// window). An item not measured yet counts as a full window: no space, never
// a prompt box pushed below the window.
export function usedRows(app) {
  let n = 0;
  for (const it of app.items) {
    const h = heightOf(it, app);
    if (h === undefined) return app.rows;
    n += h;
    if (n >= app.rows) break;
  }
  return Math.min(n, app.rows);
}

export function Screen({ app }) {
  const { width, modelName, cwd } = app;
  // The live part's height as last drawn, and how many items were printed then.
  const liveRef = useRef(null);
  const drawn = useRef({ redraw: null, height: 0, count: 0 });
  useLayoutEffect(() => {
    if (!liveRef.current) return;
    drawn.current = { redraw: app.redraw, height: measureElement(liveRef.current).height, count: app.items.length };
  });
  // An empty <Static> of its own resets what Ink keeps to print again on a
  // full clear, so the old (wider) conversation is not printed into the small window.
  if (app.tooSmall) return <Box flexDirection="column"><Static key={`small${app.redraw}`} items={[]}>{() => null}</Static><TooSmall app={app} /></Box>;
  // The conversation is printed from the top of the window (at the start and
  // again after a resize); the prompt box, footer and status line sit on the
  // last lines, with blank space in between until the conversation fills it.
  // The last line stays free for the cursor, so nothing scrolls.
  const items = app.items;
  let fill = Math.max(0, app.rows - 1 - usedRows(app));
  // Once the window has scrolled (a long reply), keep the live part as tall as
  // it was, less the lines printed above it now: shrinking it would leave
  // blank lines under the prompt box instead of above it.
  const d = drawn.current;
  if (d.redraw === app.redraw && d.height) {
    let added = 0;
    for (const it of items.slice(d.count)) added += heightOf(it, app) ?? app.rows;
    fill = Math.max(fill, Math.min(app.rows - 1, d.height - added));
  }
  return (
    <Box flexDirection="column" width={width}>
      <Static key={app.redraw} items={items}>
        {(it) => (
          // Static lines are laid out on their own, so they need the width
          // too; without it long lines are wrapped by the terminal mid-word.
          <Box key={it.key} flexDirection="column" marginBottom={1} width={width}>
            <Item it={it} width={width} model={modelName} cwd={app.cwdShort} loaded={app.loaded} />
          </Box>
        )}
      </Static>
      <Box ref={liveRef} flexDirection="column" minHeight={fill} maxHeight={Math.max(fill, app.rows - 1)} overflow="hidden" justifyContent="flex-end">
      <Box flexDirection="column" flexShrink={0}>
      {app.starting ? (
        <Box marginBottom={1}><Text><StartIcon app={app} /><Text color={C.accent}> Starting {modelName}…</Text><Text color={C.dim}> {START_PHASE[app.startPhase] ?? ''}({fmtSecs(Math.max(0, (app.now - app.startedAt) / 1000))})</Text></Text></Box>
      ) : null}
      <LiveArea app={app} />
      {app.queued ? <Box marginBottom={1}><Text color={C.dim}>⏵ Queued: {app.queued.length > 80 ? `${app.queued.slice(0, 79)}…` : app.queued}{app.starting ? '  · sends as soon as the model is ready' : ''}</Text></Box> : null}
      </Box>
      <Box flexGrow={1} />
      <Box flexDirection="column" flexShrink={0}>
      {app.picker?.kind === 'model' ? (
        <ModelPicker app={app} />
      ) : app.picker?.kind === 'choice' ? (
        <ChoicePicker app={app} />
      ) : app.picker ? (
        <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={width}>
          <Text bold>{app.picker.title}</Text>
          {app.picker.items.slice(0, 12).map((p, i) => (
            <Text key={p.key}><Text color={i === app.picker.index ? C.accent : undefined}>{i === app.picker.index ? '❯' : ' '} {p.label}</Text><Text color={C.dim}>  {p.desc}</Text></Text>
          ))}
          <Text color={C.dim}>↑↓ to choose · enter to open · esc to cancel</Text>
        </Box>
      ) : app.perm ? (
        <PermissionPrompt app={app} />
      ) : (
        <Box flexDirection="column">
          <PromptBox app={app} />
          <Menu app={app} />
          <Footer app={app} />
        </Box>
      )}
      {app.meters ? <Meters app={app} /> : <MemoryWarning app={app} />}
      </Box>
      </Box>
    </Box>
  );
}
