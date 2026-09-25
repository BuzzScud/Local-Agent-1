// What the terminal shows, in either layout:
//   classic — Claude Code as it is: thinking folded to one line, one spinner.
//   live    — you watch it work: thinking streams in a 4-line window, tool
//             calls show how much is written, a meter line shows speed,
//             context and memory.
// Finished lines go in <Static> (printed once, so the terminal's own
// scrollback keeps working); the live area below them is redrawn.
import React from 'react';
import { Box, Text, Static } from 'ink';
import { C, spinGlyph, fmtSecs, fmtTok } from '../ui/theme.mjs';
import { wrap, Row, Result, ToolHead, Diff, Todos, InputBox, modeLabel } from '../ui/parts.jsx';
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

export function Welcome({ model, cwd, width }) {
  const boxW = Math.min(width, 70);
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={C.accent} paddingX={1} width={boxW} flexDirection="column">
        <Text><Text color={C.accent}>✻</Text> Welcome to <Text bold>Bonsai Code</Text><Text color={C.dim}>  ·  {model}, on this Mac</Text></Text>
        <Text> </Text>
        <Text color={C.dim}>  /help for help · /layout or ctrl+l to switch layouts</Text>
        <Text> </Text>
        <Text color={C.dim}>  cwd: {fitPath(cwd, boxW - 11)}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text color={C.dim}> Tips for getting started:</Text>
        <Tip n={1}>Run /init to write an AGENTS.md with notes about this project</Tip>
        <Tip n={2}>Ask for a change: Bonsai reads, edits and tests, and asks before it touches anything</Tip>
        <Tip n={3}>Everything runs on this Mac; nothing is sent anywhere</Tip>
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
    case 'error': body = <Text color={C.bad}>Error: {v.message}</Text>; break;
    default: body = null;
  }
  return <Box flexDirection="column">{head}{body ? <Result>{body}</Result> : null}</Box>;
}

export function Item({ it, layout, width, model, cwd }) {
  switch (it.type) {
    case 'welcome': return <Welcome model={model} cwd={cwd} width={width} />;
    case 'user': return (
      <Box flexDirection="column">
        <Row mark=">" markColor={C.dim}><Text color={C.dim}>{it.text}</Text></Row>
        {it.attached?.length ? <Result><Text color={C.dim}>Attached {it.attached.map((a) => `${a.path} (${plural(a.lines, 'line')})`).join(', ')}</Text></Result> : null}
      </Box>
    );
    case 'thinking':
      if (layout === 'live') {
        const first = wrap(it.text, Math.max(30, Math.min(100, width - 8)))[0] ?? '';
        return (
          <Box flexDirection="column">
            <Text color={C.think} italic>∴ Thought for {fmtSecs(Math.max(1, it.secs))} · {plural(it.tokens, 'token')} <Text color={C.faint}>(ctrl+o to show)</Text></Text>
            <Text color={C.faint} italic>  {first}{it.text.length > first.length ? ' …' : ''}</Text>
          </Box>
        );
      }
      return <Text color={C.think} italic>∴ Thought for {fmtSecs(Math.max(1, it.secs))} <Text color={C.faint}>(ctrl+o to show thinking)</Text></Text>;
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

function Meters({ app }) {
  const { live, stats, modelName, ctx, ramGb, layout } = app;
  if (layout !== 'live') return null;
  let speed = <Text color={C.dim}>idle</Text>;
  if (live.phase === 'working') {
    if (live.running) speed = <Text color={C.dim}>running {live.running.label}</Text>;
    else if (live.firstTokenAt && !live.waiting) speed = <Text color={C.accent}>↓ {live.liveTps ? live.liveTps.toFixed(1) : '…'} tok/s writing</Text>;
    else speed = <Text color={C.accent}>↑ {stats.pps ? Math.round(stats.pps) : '…'} tok/s reading</Text>;
  } else if (app.waitingForYou) speed = <Text color={C.ask}>waiting for you</Text>;
  const used = stats.ctxUsed ?? 0;
  return (
    <Box paddingX={2} width={app.width}>
      <Text color={C.dim} wrap="truncate-end">
        {modelName}  {speed}  ctx <Text color={C.accentDim}>{bar(used / ctx)}</Text> {Math.max(1, Math.round((used / ctx) * 100))}% of {Math.round(ctx / 1024)}k{ramGb ? `  RAM ${ramGb.toFixed(1)} GB` : ''}  thinking {app.thinkingLabel ?? (app.thinking ? 'on' : 'off')}
      </Text>
    </Box>
  );
}

function Spinner({ app }) {
  const { live, now } = app;
  const secs = Math.max(0, (now - live.turnStart) / 1000);
  const note = live.flowStep ? ` · step ${live.flowStep.index + 1} of ${live.flowStep.count}: ${live.flowStep.text}` : live.thinking && !live.text && !live.writing ? ' · thinking' : '';
  return (
    <Box marginBottom={1} width={app.width}>
      <Text wrap="truncate-end">
        <Text color={C.accent}>{spinGlyph(secs)} {live.verb}…</Text>
        <Text color={C.dim}> ({fmtSecs(secs)} · ↓ {fmtTok(live.tokens)} tokens{note} · esc to stop)</Text>
      </Text>
    </Box>
  );
}

const WRITING = { Edit: 'the edit', Write: 'the file', Bash: 'the command', Read: 'the request', List: 'the request', Search: 'the search', TodoWrite: 'the plan' };
const LABEL = { Edit: 'Update', Write: 'Write', Bash: 'Bash', Read: 'Read', List: 'List', Search: 'Search', TodoWrite: 'Update Todos' };

// The part of a half-written tool call worth showing: its file or command.
function partialArg(name, args) {
  const m = /"(?:path|file_path|command|pattern)"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(args ?? '');
  return m ? m[1].replace(/\\"/g, '"') : '';
}

function LiveArea({ app }) {
  const { live, layout, width, rows } = app;
  if (live.phase !== 'working') return null;
  const maxLines = Math.max(6, rows - 16);
  const blocks = [];
  if (layout === 'live' && live.thinking && !live.text && !live.writing) {
    const lines = wrap(live.thinking.text, Math.max(30, Math.min(100, width - 6)));
    const tail = lines.slice(-4);
    blocks.push(
      <Box key="think" flexDirection="column" marginBottom={1}>
        <Text color={C.think} italic>∴ Thinking… {fmtSecs(Math.max(0, (app.now - live.thinking.startedAt) / 1000))} · {live.thinking.tokens} tokens</Text>
        {tail.map((l, i) => <Text key={i}><Text color={C.accentDim}>┃ </Text><Text color={C.think} italic>{l}</Text></Text>)}
        {Array.from({ length: 4 - tail.length }, (_, i) => <Text key={`p${i}`} color={C.accentDim}>┃</Text>)}
      </Box>,
    );
  }
  if (live.text) {
    const lines = live.text.split('\n');
    const shown = lines.length > maxLines ? lines.slice(-maxLines).join('\n') : live.text;
    blocks.push(<Box key="text" marginBottom={1}><Row><Markdown text={shown} /></Row></Box>);
  }
  if (layout === 'live' && live.writing && live.writing.name) {
    const w = live.writing;
    blocks.push(
      <Box key="writing" flexDirection="column" marginBottom={1}>
        <ToolHead tool={LABEL[w.name] ?? w.name} arg={partialArg(w.name, w.args)} color={C.dim} dim />
        <Result><Text color={C.dim}>writing {WRITING[w.name] ?? 'the call'}… {plural(w.tokens, 'token')}</Text></Result>
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

const PERM_TITLE = { Edit: 'Edit file', Write: 'Create file', Bash: 'Bash command', Rename: 'Rename', Test: 'Approve this test' };

export function permissionOptions(req, prefix) {
  const no = { label: 'No, and tell Bonsai what to do differently (esc)', choice: 'no' };
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
  const fixed = 2 + 1 + 1 + perm.options.length + (app.layout === 'live' ? 1 : 0) + 1;
  const room = Math.max(3, app.rows - fixed);
  const cap = Math.max(2, room - 4); // the diff box: its border, file name and "more lines"
  const files = req.prepared?.files ?? [];
  const nFiles = Math.max(1, Math.min(6, files.length, Math.floor((room - 1) / 5)));
  const perFile = Math.max(1, Math.floor((room - 1 - 3 * nFiles) / nFiles));
  const cmdLines = String(req.args?.command ?? '').split('\n');
  return (
    <Box borderStyle="round" borderColor={C.ask} flexDirection="column" paddingX={1} width={width}>
      <Text bold color={C.ask}>{title}</Text>
      {req.name === 'Bash' ? (
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
      {req.name === 'Bash' ? <Text>Do you want to proceed?</Text>
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
  ['@ to attach a file', 'ctrl+l to switch layout'],
  ['! to run a shell command', 'ctrl+o to expand the last output'],
  ['\\ + enter for a new line', 'esc to stop Bonsai'],
  ['↑ ↓ for earlier prompts', 'ctrl+c twice to quit'],
];

function Footer({ app }) {
  const { mode, layout, notice, width } = app;
  // An open menu takes the footer's place, as in Claude Code.
  if (app.menu?.items?.length) return null;
  const layoutName = layout === 'live' ? 'Live thinking' : 'Classic';
  return (
    <Box flexDirection="column">
      <Box width={width} justifyContent="space-between" paddingX={2} height={1} overflow="hidden">
        <Text color={notice ? C.warn : C.dim} wrap="truncate-end">{notice ?? (app.inputMode === 'bash' ? '! shell mode: runs the command yourself' : '? for shortcuts')}</Text>
        <Text wrap="truncate-start">
          {modeLabel(mode)}{mode !== 'ask' ? <Text color={C.dim}>  ·  </Text> : null}<Text color={C.dim}>ctrl+l  layout: {layoutName}</Text>
        </Text>
      </Box>
      {app.showShortcuts ? (
        <Box flexDirection="column" paddingX={2} marginTop={1}>
          {SHORTCUTS.map(([a, b], i) => <Text key={i} color={C.dim}>{a.padEnd(36)}{b}</Text>)}
        </Box>
      ) : null}
    </Box>
  );
}

function PromptBox({ app }) {
  const { input, width, inputMode } = app;
  const border = inputMode === 'bash' ? C.edits : C.border;
  const prefix = inputMode === 'bash' ? '!' : '>';
  const value = inputMode === 'bash' ? input.value.slice(1) : input.value;
  const cursor = inputMode === 'bash' ? Math.max(0, input.cursor - 1) : input.cursor;
  const placeholder = app.placeholder;
  const lines = value.split('\n');
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

// /model: the model list and the thinking level in one picker.
function ModelPicker({ app }) {
  const pk = app.picker;
  const levels = app.thinkingLevels;
  const lv = levels[pk.level];
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      <Text bold>Model</Text>
      <Text color={C.dim}>Pick the model and how much it thinks first. Kept for next time.</Text>
      <Text> </Text>
      {pk.models.map((m, i) => {
        const on = i === pk.index;
        return (
          <Text key={m.id}>
            <Text color={on ? C.accent : undefined} bold={on}>{on ? '❯' : ' '} {m.name.padEnd(16)}</Text>
            <Text color={C.dim}>{`${(m.bytes / 1e9).toFixed(1)} GB · on this Mac`.padEnd(24)}</Text>
            {m.name === app.modelName ? <Text color={C.ok}>✔ in use</Text> : null}
          </Text>
        );
      })}
      <Text> </Text>
      <Text>
        <Text bold>{'Thinking   '}</Text>
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
      <Text color={C.dim}>↑↓ model · ←→ thinking · enter to save · esc to cancel</Text>
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

export function Screen({ app }) {
  const { layout, width, modelName, cwd } = app;
  // An empty <Static> of its own resets what Ink keeps to print again on a
  // full clear, so the old (wider) conversation is not printed into the small window.
  if (app.tooSmall) return <Box flexDirection="column"><Static key={`small${app.redraw}`} items={[]}>{() => null}</Static><TooSmall app={app} /></Box>;
  // After a resize the conversation is printed again from the top of a clear
  // window, after enough blank lines that it ends at the bottom.
  const items = app.redraw ? [{ key: `pad${app.redraw}`, type: 'pad', rows: app.rows }, ...app.items] : app.items;
  return (
    <Box flexDirection="column" width={width}>
      <Static key={app.redraw} items={items}>
        {(it) => it.type === 'pad' ? <Text key={it.key}>{'\n'.repeat(Math.max(0, it.rows - 2))}</Text> : (
          // Static lines are laid out on their own, so they need the width
          // too; without it long lines are wrapped by the terminal mid-word.
          <Box key={it.key} flexDirection="column" marginBottom={1} width={width}>
            <Item it={it} layout={layout} width={width} model={modelName} cwd={app.cwdShort} />
          </Box>
        )}
      </Static>
      {app.starting ? (
        <Box marginBottom={1}><Text><Text color={C.accent}>{spinGlyph((app.now - app.startedAt) / 1000)} Starting {modelName}…</Text><Text color={C.dim}> {START_PHASE[app.startPhase] ?? ''}({fmtSecs(Math.max(0, (app.now - app.startedAt) / 1000))})</Text></Text></Box>
      ) : null}
      <LiveArea app={app} />
      {app.queued ? <Box marginBottom={1}><Text color={C.dim}>⏵ Queued: {app.queued.length > 80 ? `${app.queued.slice(0, 79)}…` : app.queued}{app.starting ? '  · sends as soon as the model is ready' : ''}</Text></Box> : null}
      {app.picker?.kind === 'model' ? (
        <ModelPicker app={app} />
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
      <Meters app={app} />
    </Box>
  );
}
