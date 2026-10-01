// What the terminal shows, laid out like Claude Code: thinking folded to one
// line, one spinner with the time and tokens, a line with the time left behind
// when a turn ends, nothing under the prompt but the footer (/meters on adds
// the status bar).
// Finished lines go in <Static> (printed once, so the terminal's own
// scrollback keeps working); the live area below them is redrawn.
import React, { useRef, useLayoutEffect, useState } from 'react';
import { Box, Text, Static, renderToString, measureElement, useCursor } from 'ink';
import { cursorCell, rowText, selection, promptTextWidth } from './edit-input.mjs';
import { C, MARK, spinFrame, fmtSecs, fmtTok } from '../ui/theme.mjs';
import { wrap, Row, Result, ToolHead, Diff, Todos, InputBox, modeLabel, MODE_TEXT, CYCLE_HINT } from '../ui/parts.jsx';
import { Markdown } from './markdown.jsx';
import { MIN_COLS, MIN_ROWS } from './window.mjs';
import { pressureWord, footerLabel } from './mac-memory.mjs';
import { LIMITS, showLimit, limitNote, isDefault, effortNote, defaultLevelId } from './limits.mjs';
import { rowsOf, showValue, rowNote, rowChanged, modelChoices, formWarning, remoteRowDesc } from './remote-form.mjs';
import { WEB_ROWS, showWebValue, webRowNote, webWarning } from './web-form.mjs';
import { codenameOf } from '../agent/helpers.mjs';
import { RAIL, Node, Pipe, UserStrip, MachineLine, ThoughtNode, ThinkingLive, ReplyNode, ToolNode, CheckNode, NoteNode, EndLine, WritingNode, doingWords } from './rail.jsx';
import { StartPage } from './start.jsx';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const diffW = (width) => Math.max(40, Math.min(110, width - 12));

// Long folder paths keep their end, which is the part that says where you are.
const fitPath = (p, max) => (p.length <= max ? p : `…${p.slice(p.length - max + 1)}`);

// The footer's live memory dot: Activity Monitor's green / yellow / red.
const PRESSURE_COLOR = { fine: C.ok, tight: C.warn, critical: C.bad };

const webSize = (b) => (b == null ? '' : b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

function ToolView({ it, width }) {
  const v = it.view ?? {};
  const bullet = it.error ? C.bad : C.ok;
  const head = <ToolHead tool={it.label} arg={it.arg} color={bullet} />;
  let body = null;
  switch (v.kind) {
    case 'read': body = v.outline ? <Text>Outline: <Text bold>{v.parts}</Text> parts of {v.total} lines <Text color={C.dim}>(ctrl+o to expand)</Text></Text> : <Text>Read <Text bold>{v.lines}</Text> {v.lines === 1 ? 'line' : 'lines'}{v.total > v.lines ? ` of ${v.total}` : ''} <Text color={C.dim}>(ctrl+o to expand)</Text></Text>; break;
    case 'list': body = <Text>Listed <Text bold>{v.count}</Text> {v.count === 1 ? 'path' : 'paths'} <Text color={C.dim}>(ctrl+o to expand)</Text></Text>; break;
    case 'search': body = <Text>Found <Text bold>{v.count}</Text> {v.count === 1 ? 'match' : 'matches'} <Text color={C.dim}>(ctrl+o to expand)</Text></Text>; break;
    case 'agent': body = <Text>{v.steps ?? 0} step{v.steps === 1 ? '' : 's'} · {Math.round(v.secs ?? 0)} s{v.reason && !['done', 'answered'].includes(v.reason) ? ` · ${v.reason}` : ''} <Text color={C.dim}>(ctrl+o for its steps and report)</Text></Text>; break;
    case 'websearch': body = <Text>Found <Text bold>{v.count}</Text> {v.count === 1 ? 'result' : 'results'}{v.service ? ` · ${v.service}` : ''}{v.content ? <Text color={C.dim}> (ctrl+o to expand)</Text> : null}</Text>; break;
    case 'fetched': body = v.moved ? <Text color={C.warn}>Moves to another site: {v.moved} (not followed)</Text> : <Text>Received <Text bold>{webSize(v.bytes)}</Text>{v.status ? ` (${v.status})` : ''}{v.lines ? `, ${v.lines} of ${v.total} lines` : ''}{v.content ? <Text color={C.dim}> (ctrl+o to expand)</Text> : null}</Text>; break;
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

// What came along with a request (agent.remember), and what the context
// helpers brought (agent.bringHelpers, titled "Helpers"): one folded line,
// like a tool's result; ctrl+o prints the list, each item with its fit and size
// and, on the Helpers line, the codename of the helper that brought it.
// The folded line's words after its title. it.chosen: /effort's Search rows
// changed how the pieces were chosen ("by meaning + words, reranked").
export function contextHead(it) {
  const sent = it.items.filter((x) => !x.skipped);
  const skipped = it.items.length - sent.length;
  const secs = it.ms >= 100 ? ` · ${(it.ms / 1000).toFixed(1)} s` : '';
  return `· ${sent.length} brought along${it.chosen ? ` · ${it.chosen}` : ''}${skipped ? ` · ${skipped} skipped` : ''}${it.tokens ? ` · +${it.tokens} tokens` : ''}${secs}`;
}
function Context({ it, width }) {
  const head = contextHead(it);
  const textW = Math.max(20, Math.min(width, 110) - 40);
  return (
    <Box flexDirection="column">
      <Row mark="⏺" markColor={C.accent}><Text><Text bold>{it.title ?? 'Context'}</Text> <Text color={C.dim}>{head}</Text>{it.open ? null : <Text color={C.faint}>  (ctrl+o to expand)</Text>}</Text></Row>
      {it.open ? (
        <Result>
          {it.items.map((x, i) => (
            <Box key={i}>
              <Box width={9} flexShrink={0}><Text color={C.accentDim}>{it.title === 'Helpers' ? codenameOf(x.from) : x.from}</Text></Box>
              <Box width={textW} flexShrink={1}><Text wrap="truncate-end">{x.text}</Text></Box>
              <Box flexShrink={0} paddingLeft={2}>{x.skipped ? <Text color={C.warn}>⚠ {x.skipped}</Text> : <Text color={C.dim}>{x.close != null && it.how === 'meaning' ? `fit ${Number(x.close).toFixed(2)} · ` : ''}{x.tokens} tokens</Text>}</Box>
            </Box>
          ))}
        </Result>
      ) : null}
    </Box>
  );
}

// /rules (app/rules.mjs): what the model reads at every start, numbered, so
// "/rules off 16" names a line you can see. Long rules wrap under their words.
function RuleLines({ list, width, event }) {
  return list.map((f) => (
    <Box key={f.n} paddingLeft={2} width={Math.min(width, 104)}>
      <Box width={4} flexShrink={0}><Text color={C.dim}>{String(f.n).padStart(3)}</Text></Box>
      <Box flexGrow={1} flexShrink={1} paddingLeft={1}><Text>{f.text}</Text></Box>
      {event && f.event ? <Box flexShrink={0} paddingLeft={2}><Text color={C.warn}>⚠ an event, not a rule</Text></Box> : null}
    </Box>
  ));
}
function Rules({ it, width, model }) {
  const line = '─'.repeat(Math.max(20, Math.min(width, 104) - 4));
  const head = (title, note, right) => (
    <Box flexDirection="column" marginTop={1}>
      <Box paddingLeft={2} justifyContent="space-between" width={Math.min(width, 104)}>
        <Text><Text bold>{title}</Text>  <Text color={C.dim}>{note}</Text></Text>
        {right ? <Text color={C.faint}>{right}</Text> : null}
      </Box>
      <Box paddingLeft={2}><Text color={C.faint}>{line}</Text></Box>
    </Box>
  );
  const name = String(model ?? 'the model').split(' ')[0];
  return (
    <Box flexDirection="column">
      <Row mark="⏺" markColor={C.accent}><Text><Text bold>Rules</Text><Text color={C.dim}> · what {name} reads at the start of every conversation</Text></Text></Row>
      {head('Always', `${it.always.length} of ${it.max} · about ${it.tokens} tokens`, it.where)}
      {it.always.length ? <RuleLines list={it.always} width={width} /> : <Box paddingLeft={2}><Text color={C.dim}>  none yet: /rules add &lt;text&gt; adds one</Text></Box>}
      {it.other.length ? <>{head('Other notes', `${it.other.length} · one line at the start, the whole note only when a request fits`)}<RuleLines list={it.other} width={width} event /></> : null}
      {it.off.length ? <>{head('Off', `${it.off.length} · not read · /rules on <number> brings one back`)}<RuleLines list={it.off} width={width} /></> : null}
      <Box paddingLeft={2} marginTop={1}><Text color={C.dim}>/rules add &lt;text&gt; · /rules off &lt;n&gt; · /rules on &lt;n&gt; · /rules remove &lt;n&gt; · /rules always &lt;n&gt; · /rules open</Text></Box>
    </Box>
  );
}

// /memory: what the memory keeps, laid out like /rules. One line per fact,
// cut at the window's edge; its kind on the left, its trust and use on the
// right; each memory under its own heading with its folder; then how the
// memory did in the last 7 days. (Before 30 Sep 2026 it was a two-column
// panel whose long lines wrapped under the labels.)
const MEM_KIND = { always: C.accent, you: C.accentDim, project: C.dim, worked: C.ok, failed: C.warn, mistake: C.bad, recipe: C.plan };
function MemoryPanel({ it, width }) {
  const W = Math.max(60, Math.min(width, 104));
  const line = '─'.repeat(W - 4);
  const head = (title, note, right) => (
    <Box flexDirection="column" marginTop={1}>
      <Box paddingLeft={2} width={W}>
        <Box flexShrink={0}><Text><Text bold>{title}</Text>{note ? <Text color={C.dim}>  {note}</Text> : null}</Text></Box>
        {right ? <Box flexGrow={1} justifyContent="flex-end" paddingLeft={2} minWidth={0}><Text color={C.faint} wrap="truncate-start">{right}</Text></Box> : null}
      </Box>
      <Box paddingLeft={2}><Text color={C.faint}>{line}</Text></Box>
    </Box>
  );
  // Signed and padded, so every row's trust starts and ends in the same place.
  const trustText = (f) => `trust ${(f.trust > 0 ? `+${f.trust}` : String(f.trust)).padStart(2)} · used ${f.used}`;
  const trustColor = (f) => (f.trust > 0 ? C.ok : f.trust < 0 ? C.warn : C.dim);
  // Numbers stand out in a line of words.
  const counted = (text) => String(text).split(/(\d+)/).map((x, i) => (i % 2 ? <Text key={i} bold>{x}</Text> : x));
  return (
    <Box flexDirection="column">
      <Row mark="⏺" markColor={C.accent}><Text><Text bold>Memory</Text><Text color={C.dim}> · {it.how === 'meaning' ? 'facts are found by meaning' : 'facts are found by their words (coding setup adds the small model)'}</Text></Text></Row>
      {it.sections.map((sec) => (
        <Box key={sec.title} flexDirection="column">
          {head(sec.title, `${sec.facts.length + sec.more} fact${sec.facts.length + sec.more === 1 ? '' : 's'}`, sec.where)}
          {sec.facts.map((f) => (
            <Box key={f.id} paddingLeft={4} width={W}>
              <Box width={9} flexShrink={0}><Text color={MEM_KIND[f.always ? 'always' : f.kind] ?? C.dim}>{f.always ? 'always' : f.kind}</Text></Box>
              <Box flexGrow={1} flexShrink={1} minWidth={0}><Text wrap="truncate-end">{f.text}{f.pinned ? <Text color={C.dim}>  · pinned</Text> : null}</Text></Box>
              {f.always ? null : <Box width={20} flexShrink={0} justifyContent="flex-end"><Text color={trustColor(f)}>{trustText(f)}</Text></Box>}
            </Box>
          ))}
          {sec.more ? <Box paddingLeft={4}><Text color={C.dim}>and {sec.more} more · /memory open shows them all</Text></Box> : null}
        </Box>
      ))}
      {it.claude ? (
        <>
          {head("Claude's notes", `${it.claude.used} · read only`, it.claude.where)}
          <Box paddingLeft={4} width={W}><Text color={C.dim} wrap="truncate-end">{it.claude.leftOut} about sign-ins, servers or secrets are left out</Text></Box>
        </>
      ) : null}
      {it.health ? (
        <>
          {head('Last 7 days', null, it.last ? `last change ${it.last}` : null)}
          <Box paddingLeft={4} width={W}><Text>{counted(it.health)}</Text></Box>
        </>
      ) : null}
      <Box paddingLeft={2} marginTop={1} width={W}><Text color={C.dim}>/memory undo takes the last save back · /memory open shows every fact in the browser</Text></Box>
    </Box>
  );
}

// The counts on the done line: " · 9 steps · 4 reads · ~1,820 thinking tokens"
// (a count of 0 is left out; old saved sessions have none).
export function doneCounts(it) {
  const n = (x, one, many) => (x ? ` · ${x.toLocaleString('en-US')} ${x === 1 ? one : many}` : '');
  return `${n(it.steps, 'step', 'steps')}${n(it.reads, 'read', 'reads')}${it.thinkTokens ? ` · ~${it.thinkTokens.toLocaleString('en-US')} thinking tokens` : ''}`;
}

export function Item({ it, width, model, cwd, loaded, start }) {
  switch (it.type) {
    case 'welcome': return <StartPage start={start} width={width} />;
    // Your message on its grey strip; an answer you typed to its question mid-turn is a step of the turn.
    case 'user': return it.rail
      ? <Node g="›" c={C.accent}><Text><Text color={C.dim}>You: </Text>{it.text}</Text></Node>
      : <UserStrip text={it.text} attached={it.attached} width={width} />;
    case 'machine': return <MachineLine it={it} />;
    case 'thinking': return it.rail ? <ThoughtNode it={it} /> : <Text color={C.think} italic>∴ Thought for {fmtSecs(Math.max(1, it.secs))} <Text color={C.faint}>(ctrl+o to show thinking)</Text></Text>;
    // The line a finished turn leaves behind: "⠿ Worked for 41s · done 12:58 PM".
    case 'done': return it.rail ? <EndLine it={it} counts={doneCounts(it)} /> : <Text><Text color={C.accent}>{MARK}</Text><Text color={C.dim}> {it.past} for {fmtSecs(it.secs)}{doneCounts(it)} · done {clock(it.at)}</Text></Text>;
    case 'text': return it.rail ? <ReplyNode text={it.text} /> : <Row><Markdown text={it.text} /></Row>;
    case 'tool': return it.rail ? <ToolNode it={it} /> : <ToolView it={it} width={width} />;
    case 'sorted': return <Result><Text color={C.dim}>{it.text}</Text></Result>;
    case 'note': {
      if (it.rail) return it.check ? <CheckNode check={it.check} /> : <NoteNode it={it} />;
      const color = it.tone === 'error' ? C.bad : it.tone === 'warn' ? C.warn : it.tone === 'ok' ? C.ok : C.dim;
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
    case 'rules': return <Rules it={it} width={width} model={model} />;
    case 'memory': return <MemoryPanel it={it} width={width} />;
    case 'context': return <Context it={it} width={width} />;
    case 'panel': return (
      <Box flexDirection="column">
        {it.title ? <Text bold>{it.title}</Text> : null}
        {it.rows.map((r, i) => (
          <Text key={i}>
            {r[1] === undefined ? <Text color={C.dim}>{r[0]}</Text> : <><Cell v={r[0]} pad={it.pad ?? 18} /><Text>{r[1]}</Text></>}
          </Text>
        ))}
      </Box>
    );
    case 'tries': return it.rail ? (
      <Box flexDirection="column">
        <Node g="◆" c={it.failed ? C.warn : C.ok}><Text bold>{it.label}</Text></Node>
        <Pipe><Text><Marks marks={it.marks} />  <Text color={C.dim}>{it.summary}{it.secs >= 1 ? ` · ${fmtSecs(it.secs)}` : ''}</Text></Text></Pipe>
      </Box>
    ) : (
      <Box flexDirection="column">
        <Row markColor={it.failed ? C.warn : C.ok}><Text bold>{it.label}</Text></Row>
        <Result><Text><Marks marks={it.marks} />  <Text color={C.dim}>{it.summary}{it.secs >= 1 ? ` · ${fmtSecs(it.secs)}` : ''}</Text></Text></Result>
      </Box>
    );
    case 'divider': return <Text color={C.faint}>{`── ${it.text} `.padEnd(Math.min(width, 80), '─')}</Text>;
    default: return null;
  }
}

// A panel row's left cell: a string, or parts ([text, bold]) as /helpers
// gives them so a codename stands out; padded to the panel's column either way.
function Cell({ v, pad }) {
  const parts = Array.isArray(v) ? v : [[String(v)]];
  const len = parts.reduce((s, [t]) => s + t.length, 0);
  return <Text color={C.accent}>{parts.map(([t, bold], j) => <Text key={j} bold={!!bold}>{t}</Text>)}{' '.repeat(Math.max(0, pad - len))}</Text>;
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
// room: what is kept free for the next reply (thinking and all). It counts towards "full":
// at 16k with a 4,096 thinking cap the notes step came at 58% used, with no line to say why.
export function memoryWarning(used, ctx, room = 0) {
  const pct = ctx ? Math.round((used / ctx) * 100) : 0;
  const kept = ctx ? Math.round((room / ctx) * 100) : 0;
  if (pct + kept < 70) return null;
  if (kept) return `Memory ${pct}% used + ${kept}% kept for the next reply: ${pct + kept >= 85 ? 'notes or a summary at the next step' : 'old tool output is trimmed soon'}`;
  return pct >= 85 ? `Memory ${pct}% full: the conversation is summarized at the next step` : `Memory ${pct}% full: old tool output is trimmed soon, the conversation summarized when full`;
}
function MemoryWarning({ app }) {
  const used = app.stats.ctxUsed ?? 0;
  const room = app.stats.replyRoom ?? 0;
  const text = memoryWarning(used, app.ctx, room);
  if (!text) return null;
  return <Box paddingX={2} width={app.width}><Text color={used + room >= app.ctx * 0.85 ? C.warn : C.dim} wrap="truncate-end">{text}</Text></Box>;
}

// The status line under the footer (/meters on): model, speed, memory, effort.
function Meters({ app }) {
  const { stats, modelName, ctx, ramGb } = app;
  const speed = speedOf(app);
  const used = stats.ctxUsed ?? 0;
  return (
    <Box paddingX={2} width={app.width}>
      <Text color={C.dim} wrap="truncate-end">
        {modelName}{app.modelOff ? ' (off · ctrl+t)' : ''}  {speed}  ctx <Text color={C.accentDim}>{bar(used / ctx)}</Text> {Math.max(1, Math.round((used / ctx) * 100))}% of {Math.round(ctx / 1024)}k{ramGb ? `  RAM ${ramGb.toFixed(1)} GB` : ''}  effort {app.thinkingLabel ?? (app.thinking ? 'on' : 'low')}
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
  // On the rail the step above already says what it does (writing a file, thinking): the
  // line says this step's time and speed instead; between replies, what the app does itself.
  const step = live.rail && live.stepStart ? Math.max(0, (now - live.stepStart) / 1000) : null;
  const pace = !live.rail ? '' : live.task ? ` · ${live.task}` : live.waiting ? ' · reading' : live.liveTps ? ` · ↓ ${live.liveTps.toFixed(1)} tok/s` : '';
  const doing = live.rail ? '' : doingWords(live);
  const note = `${step !== null ? ` · this step ${fmtSecs(step)}` : ` · ↓ ${fmtTok(live.tokens)} tokens`}${pace}${doing ? ` · ${doing}` : ''}${live.flowStep ? ` · step ${live.flowStep.index + 1} of ${live.flowStep.count}: ${live.flowStep.text}` : ''}`;
  const icon = spinFrame(app.spinner, secs, { tokens: live.tokens, sinceToken: live.lastTokenAt ? (now - live.lastTokenAt) / 1000 : Infinity });
  return (
    <Box marginBottom={1} width={app.width}>
      <Text wrap="truncate-end">
        {live.rail ? <Text color={RAIL}>{'  ╰─ '}</Text> : null}<Text color={icon.color}>{icon.glyph}</Text><Text color={C.accent}> {live.verb}…</Text>
        <Text color={C.dim}> ({fmtSecs(secs)}{note} · esc to interrupt)</Text>
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
  // An open /btw panel is taller than the prompt box it replaces: the reply shows less.
  const maxLines = app.btw ? Math.max(2, rows - 16 - (btwLayout(app).panelRows - 4)) : Math.max(6, rows - 16);
  if (live.rail) return <LiveRail app={app} maxLines={maxLines} />;
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

// A turn under way, on the rail: what came along (until the first step prints it), the thinking
// (its latest two lines, live), the reply as it is written, the file being written, a tool
// running, and the working line at the rail's end.
function LiveRail({ app, maxLines }) {
  const { live, width } = app;
  const blocks = [];
  if (live.pre) blocks.push(<MachineLine key="pre" it={live.pre} />);
  if (live.thinking && !live.text && !live.writing) blocks.push(<Box key="think" flexDirection="column"><Pipe /><ThinkingLive thinking={live.thinking} now={app.now} width={width} cap={live.thinkCap} /></Box>);
  if (live.text) {
    const shown = tailToFit(live.text, maxLines, width - 6);
    blocks.push(
      <Box key="text" flexDirection="column"><Pipe />
        <Box maxHeight={maxLines} overflow="hidden" flexDirection="column" justifyContent="flex-end">
          <Box flexDirection="column" flexShrink={0}><ReplyNode text={shown} /></Box>
        </Box>
      </Box>,
    );
  }
  if (live.writing) blocks.push(<Box key="writing" flexDirection="column"><Pipe /><WritingNode writing={live.writing} room={live.room} used={live.streamTokens} tps={live.liveTps} /></Box>);
  if (live.tries) {
    const t = live.tries;
    blocks.push(
      <Box key="tries" flexDirection="column"><Pipe />
        <Node g="◆" c={C.dim}><Text><Text bold>{t.label}</Text><Text color={C.dim}> ({Math.min(t.n, t.max)} of up to {t.max})</Text></Text></Node>
        <Pipe><Text><Marks marks={t.marks} pending />{t.tokens ? <Text color={C.dim}>  writing… {plural(t.tokens, 'token')}</Text> : <Text color={C.dim}>  checking…</Text>}</Text></Pipe>
      </Box>,
    );
  }
  if (live.running) blocks.push(<Box key="running" flexDirection="column"><Pipe /><Node g="▸" c={C.dim}><Text color={C.dim}><Text bold>{live.running.label}</Text>  {live.running.arg}</Text><Text color={C.dim}>Running…</Text></Node></Box>);
  if (!app.perm) blocks.push(<Box key="spin" flexDirection="column"><Pipe /><Spinner app={app} /></Box>);
  return <Box flexDirection="column">{blocks}</Box>;
}

const PERM_TITLE = { Edit: 'Edit file', Write: 'Create file', Bash: 'Bash command', Rename: 'Rename', Test: 'Approve this test', Ask: 'Agentic Coder asks', WebSearch: 'Web search', WebFetch: 'Read a web page' };

// prefix: the rule "don't ask again" would remember (null: none can, the
// command's words cannot be trusted); saveRule: what "always allow" would save
// for this folder (/permissions), when the app can save one.
export function permissionOptions(req, prefix, saveRule = null) {
  const yes = { label: 'Yes', choice: 'yes' };
  const no = { label: 'No, and tell Agentic Coder what to do differently (esc)', choice: 'no' };
  if (req.name === 'Ask') return [...(req.args.options ?? []).map((o) => ({ label: o, choice: 'answer', text: o })), { label: 'Type an answer', choice: 'type' }, { label: 'Stop here (esc)', choice: 'no' }];
  // A git commit asks every time (permissions.mjs), so it has no "don't ask again".
  if (req.name === 'Bash') return req.once || !prefix ? [yes, no] : [yes, { label: `Yes, and don't ask again for ${prefix} this session`, choice: 'always' }, ...(saveRule ? [{ label: `Yes, and always allow ${saveRule} in this folder`, choice: 'save' }] : []), no];
  if (req.name === 'Test') return [{ label: 'Yes, use this test', choice: 'yes' }, { label: 'No, and tell Agentic Coder what the test should check (esc)', choice: 'no' }];
  // The web: "don't ask again" for this site (or for searches) this session; "always" saves the rule for this folder.
  if (req.name === 'WebSearch' || req.name === 'WebFetch') {
    const what = req.name === 'WebSearch' ? 'web searches' : String(req.rule ?? '').replace(/^WebFetch\((.*)\)$/, '$1');
    return req.rule ? [yes, { label: `Yes, and don't ask again for ${what} this session`, choice: 'always' }, { label: `Yes, and always allow ${what} in this folder`, choice: 'save' }, no] : [yes, no];
  }
  // A protected file asks every time (permissions.mjs), so it has no "allow all edits".
  if (req.once) return [yes, no];
  if (req.name === 'Rename') return [yes, { label: 'Yes, and allow all edits this session (shift+tab)', choice: 'always' }, no];
  return [yes, { label: 'Yes, allow all edits this session (shift+tab)', choice: 'always' }, no];
}

function PermissionPrompt({ app }) {
  const { perm, width } = app;
  const req = perm.req;
  const title = req.name === 'Write' && !req.prepared?.created ? 'Overwrite file' : PERM_TITLE[req.name] ?? req.name;
  const hunk = req.prepared?.hunk ?? [];
  // The whole prompt fits the window with a line to spare: a live area as
  // tall as the window makes Ink clear and redraw the screen on every frame.
  const fixed = 2 + 1 + 1 + perm.options.length + 1 + 1 + (req.protectedBy ? 1 : 0); // …, the status line, a spare line, the protected-file line
  const room = Math.max(3, app.rows - fixed);
  const cap = Math.max(2, room - 4); // the diff box: its border, file name and "more lines"
  const files = req.prepared?.files ?? [];
  const nFiles = Math.max(1, Math.min(6, files.length, Math.floor((room - 1) / 5)));
  // Two lines more slack than the sum suggests: at 22 of 24 rows Ink still cleared the whole screen.
  const perFile = Math.max(1, Math.floor((room - 3 - 3 * nFiles) / nFiles));
  const cmdLines = String(req.args?.command ?? '').split('\n');
  return (
    <Box borderStyle="round" borderColor={C.ask} flexDirection="column" paddingX={1} width={width}>
      <Text bold color={C.ask}>{title}{req.helper ? <Text color={C.dim}>  · asked by the {req.helper} helper</Text> : null}</Text>
      {req.name === 'Ask' ? (
        <Box flexDirection="column" paddingX={2} marginY={1}>
          <Text>{req.args.question}</Text>
        </Box>
      ) : req.name === 'Bash' ? (
        <Box flexDirection="column" paddingX={2} marginY={1}>
          <Text>{cmdLines.length > room - 3 ? `${cmdLines.slice(0, room - 4).join('\n')}\n… +${cmdLines.length - (room - 4)} lines` : req.args.command}</Text>
          <Text color={C.dim} wrap="truncate-end">{req.args.description ? `${req.args.description} · ` : ''}in {fitPath(app.cwdShort, Math.max(20, width - 12 - (req.args.description ? req.args.description.length + 3 : 0)))}</Text>
        </Box>
      ) : req.name === 'WebSearch' || req.name === 'WebFetch' ? (
        <Box flexDirection="column" paddingX={2} marginY={1}>
          <Text wrap="truncate-end">{req.name === 'WebSearch' ? `“${req.args.query}”` : req.args.url}</Text>
          <Text color={C.dim} wrap="truncate-end">{req.name === 'WebSearch' ? `goes to ${req.service ?? 'the search service'}` : 'read as text; nothing is sent but the address'}</Text>
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
      {req.protectedBy ? <Text color={C.warn}>Protected: {req.protectedBy} always asks before a change, even in Auto-edit.</Text> : null}
      {req.name === 'Ask' ? null
        : req.name === 'Bash' ? <Text>Do you want to proceed?</Text>
        : req.name === 'WebSearch' ? <Text>Search the web for this?</Text>
        : req.name === 'WebFetch' ? <Text>Read this page from <Text bold>{String(req.rule ?? '').replace(/^WebFetch\((.*)\)$/, '$1')}</Text>?</Text>
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
  const SHOW = MENU_ROWS;
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

// The / menu's rows at most (the whole menu; the rest is in /settings): 18 still fits an 80 × 24 window.
export const MENU_ROWS = 18;
const SHORTCUTS = [
  ['/ for commands', 'shift+tab to switch mode'],
  ['@ to attach a file', 'ctrl+o to expand the last output'],
  ['! to run a shell command', 'esc to interrupt Agentic Coder'],
  ['\\ + enter for a new line', 'ctrl+c twice to quit'],
  ['↑ ↓ for earlier prompts', 'shift+arrows to select and copy'],
  ['⌥+click to move the cursor', 'ctrl+z to undo · ctrl+y to redo'],
  ['ctrl+t to start or stop the model', '/mouse on: click its label too'],
];
// Rows the shortcuts take under the footer (? opens them).
export const SHORTCUT_ROWS = SHORTCUTS.length + 1;

// The footer's right side is the mode, as in Claude Code; a narrow window
// drops the "(shift+tab to cycle)" hint so it never runs into "? for shortcuts".
export function footerRight(mode, room) {
  const m = MODE_TEXT[mode] ?? '';
  return { cycle: !m || m.length + CYCLE_HINT.length <= room };
}

// The model's label on the footer's right, longest first (a narrow window takes a shorter one).
// modelState: { state: off · loading · on, name, gb }; null for a server given with --url or a
// remote, where nothing of the Mac's is loaded. ctrl+t switches it, and so does a click on it (/mouse on).
export function modelLabels(ms) {
  if (!ms) return [];
  if (ms.state === 'off') return ['○ model off · ctrl+t start', '○ model off · ctrl+t', '○ off'];
  if (ms.state === 'loading') return [`◐ ${ms.name} loading · ctrl+t stop`, '◐ loading · ctrl+t stop', '◐ loading'];
  const gb = ms.gb ? ` · ${ms.gb.toFixed(1)} GB` : '';
  return [`● ${ms.name}${gb} · ctrl+t stop`, `● ${ms.name} · ctrl+t stop`, '● on · ctrl+t stop', '● on'];
}

// The footer's pieces, worked out once for the drawing and for a click on the model's label
// (App.jsx). The right side ends two cells from the window's edge; a narrow window drops the
// "(shift+tab to cycle)" hint first, then the label's detail, then the Mac's memory.
// labelAt: the label's first and last cell on the footer's row, counted from 1.
export function footerParts(app) {
  const { mode, notice, width } = app;
  // Until your first message a tip sits here (start.jsx); the start page's steps say what the
  // start waits for.
  const tip = app.tip ?? null;
  const left = notice ?? (app.inputMode === 'bash' ? '! shell mode: runs the command yourself' : tip ? `※ Tip: ${tip}` : '? for shortcuts');
  // The update and weights badges share the lower right with the mode label.
  const badges = [app.updateBadge, app.weightsBadge].filter(Boolean).join('  ');
  // The Mac's memory, live, after the model's label.
  const mac = app.mac ? footerLabel(app.mac) : '';
  const modeText = MODE_TEXT[mode] ?? '';
  const room = width - 4 - Math.min(left.length, 15) - 2;
  const labels = modelLabels(app.modelState);
  const ls = labels.length ? labels : [''];
  const tries = [
    { label: ls[0], mac, cycle: true },
    ...ls.map((label) => ({ label, mac, cycle: false })),
    ...ls.map((label) => ({ label, mac: '', cycle: false })),
  ];
  const textOf = (t) => [t.label, t.mac && `● ${t.mac}`, badges, modeText && `${modeText}${t.cycle ? CYCLE_HINT : ''}`].filter(Boolean).join(' · ');
  const pick = tries.find((t) => textOf(t).length <= room) ?? tries.at(-1);
  const from = width - 2 - textOf(pick).length + 1;
  return { left, label: pick.label, mac: pick.mac, badges, cycle: pick.cycle, labelAt: pick.label ? { from, to: from + pick.label.length - 1 } : null };
}

function Footer({ app }) {
  const { mode, notice, width } = app;
  // An open menu takes the footer's place, as in Claude Code.
  if (app.menu?.items?.length) return null;
  const p = footerParts(app);
  const on = app.modelState?.state === 'on';
  const pieces = [
    p.label ? <Text color={C.dim}><Text color={on ? C.accent : C.dim}>{p.label[0]}</Text>{p.label.slice(1)}</Text> : null,
    p.mac ? <Text color={C.dim}><Text color={PRESSURE_COLOR[pressureWord(app.mac)]}>●</Text> {p.mac}</Text> : null,
    p.badges ? <Text color={C.accent}>{p.badges}</Text> : null,
    modeLabel(mode, { cycle: p.cycle }),
  ].filter(Boolean);
  return (
    <Box flexDirection="column">
      {/* One blank row above the footer: Ink keeps the last row of the window for the cursor, so the
          footer always has one empty row under it; the same row above keeps it from hugging the box. */}
      <Box height={1} />
      <Box width={width} justifyContent="space-between" paddingX={2} height={1} overflow="hidden">
        {/* A long left side (a tip) is cut to what is left; the right side stays whole, two spaces clear of it. */}
        <Box flexShrink={1} marginRight={2}><Text color={notice ? C.warn : C.dim} wrap="truncate-end">{p.left}</Text></Box>
        <Box flexShrink={0}><Text wrap="truncate-start">{pieces.map((el, i) => <React.Fragment key={i}>{i ? <Text color={C.dim}> · </Text> : null}{el}</React.Fragment>)}</Text></Box>
      </Box>
      {app.showShortcuts ? (
        <Box flexDirection="column" paddingX={2} marginTop={1}>
          {SHORTCUTS.map(([a, b], i) => <Text key={i} color={C.dim}>{a.padEnd(36)}{b}</Text>)}
        </Box>
      ) : null}
    </Box>
  );
}

// One row of the prompt with part of it selected: the selected characters on
// a blue background, the rest plain. A selected line break (brk, where the
// line ends) shows as one highlighted space.
function selectedRow(text, start, sel, brk) {
  const out = [];
  let run = '', on = null, at = start;
  const flush = () => { if (run) out.push(on ? <Text key={out.length} backgroundColor={C.selBg} color="white">{run}</Text> : <Text key={out.length}>{run}</Text>); run = ''; };
  const add = (ch, s) => { if (on !== null && s !== on) flush(); on = s; run += ch; };
  for (const ch of text) { add(ch, at >= sel[0] && at < sel[1]); at += ch.length; }
  if (brk != null && brk >= sel[0] && brk < sel[1]) add(' ', true);
  flush();
  return out;
}

// Where a box is drawn in the live area, from the layout of it and its parents.
const offsetOf = (el) => {
  let x = 0, y = 0;
  for (let n = el; n; n = n.parentNode) { const l = n.yogaNode?.getComputedLayout(); if (l) { x += l.left; y += l.top; } }
  return { x, y };
};

// The prompt, in rows it wraps itself (the same rows ↑ ↓ move through). The
// terminal's own cursor is put where you type: ⌥-click in Terminal counts
// the arrow keys it sends from it, and an input method opens its box there.
function PromptBox({ app }) {
  const { input, width, inputMode } = app;
  const border = inputMode === 'bash' ? C.edits : C.border;
  const prefix = inputMode === 'bash' ? '!' : '>';
  const opts = { width: promptTextWidth(width), skip: inputMode === 'bash' ? 1 : 0 };
  const { row: curRow, x: curX, rows } = cursorCell(input, opts);
  const sel = selection(input);
  const ref = useRef(null);
  const [at, setAt] = useState(null);
  useLayoutEffect(() => { const o = offsetOf(ref.current); if (o.x !== at?.x || o.y !== at?.y) setAt(o); });
  const { setCursorPosition } = useCursor();
  setCursorPosition(at && !app.leaving ? { x: at.x + 4 + curX, y: at.y + 1 + curRow } : undefined);
  const v = input.value;
  return (
    <Box ref={ref} borderStyle="round" borderColor={border} paddingX={1} width={width} flexDirection="column">
      {rows.map((r, i) => {
        const lead = i === 0 ? <Text color={inputMode === 'bash' ? C.edits : undefined}>{prefix} </Text> : <Text>  </Text>;
        if (i === 0 && !v.slice(opts.skip)) return <Text key={i}>{lead}<Text color={C.dim}>{app.placeholder}</Text></Text>;
        const t = rowText(v, r, opts);
        if (sel && sel[0] <= r.end && sel[1] > r.start) return <Text key={i}>{lead}{selectedRow(t, r.start, sel, r.last && r.end < v.length ? r.end : null)}</Text>;
        // "/btw " typed: its argument's hint after the cursor
        if (app.argHint && i === curRow && r.last && input.cursor === r.end) return <Text key={i} wrap="truncate-end">{lead}{t} <Text color={C.dim}>{app.argHint}</Text></Text>;
        return <Text key={i}>{lead}{t}</Text>;
      })}
    </Box>
  );
}

// What "Starting" is waiting for.
const START_PHASE = {
  loading: 'loading the model ',
  reading: 'reading its instructions, about 30 s the first time ',
  restoring: 'restoring its instructions from last time ',
  waiting: 'waiting for memory ',
  connecting: 'connecting to it ',
};

// /mode and /meters alone: their choices as a menu, like Claude Code's.
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

// /rewind: your messages, newest first (a window of them when there are
// many), then what to put back to before the one picked and what that does.
function RewindPicker({ app }) {
  const pk = app.picker;
  const cut = (t, w) => { const one = t.split('\n')[0]; return one.length > w || t.includes('\n') ? `${one.slice(0, Math.max(1, w - 1))}…` : one; };
  if (pk.stage === 'choose') {
    const m = pk.items[pk.index];
    const w = Math.max(...pk.options.map((o) => o.label.length)) + 2;
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
        <Text bold wrap="truncate-end">Rewind to before "{cut(m.text, app.width - 30)}"</Text>
        <Text> </Text>
        {pk.options.map((o, i) => {
          const on = i === pk.choice;
          return (
            <Text key={o.id}>
              <Text color={on ? C.accent : undefined} bold={on}>{on ? '❯' : ' '} {i + 1}. {o.label.padEnd(w)}</Text>
              <Text color={C.dim}>{o.note}</Text>
            </Text>
          );
        })}
        <Text> </Text>
        {pk.lines.map((l, i) => <Text key={i} color={l.tone === 'warn' ? C.warn : l.tone === 'dim' ? C.dim : undefined} wrap="wrap">{l.text}</Text>)}
        <Text> </Text>
        <Text color={C.dim}>↑↓ to choose · enter to select · esc to go back</Text>
      </Box>
    );
  }
  const view = Math.max(3, Math.min(pk.items.length, app.rows - 14));
  const top = Math.max(0, Math.min(pk.index - Math.floor(view / 2), pk.items.length - view));
  const noteW = Math.max(...pk.items.map((m) => m.note.length));
  const longest = Math.max(...pk.items.map((m) => m.text.split('\n')[0].length + (m.text.includes('\n') ? 1 : 0)));
  const textW = Math.max(12, Math.min(longest, 70, app.width - noteW - 12));
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      <Text bold>Rewind</Text>
      <Text color={C.dim}>Put the files the model changed, and the conversation, back to before one of your messages.</Text>
      <Text> </Text>
      {top > 0 ? <Text color={C.dim}>  ↑ {top} newer</Text> : null}
      {pk.items.slice(top, top + view).map((m, i) => {
        const on = top + i === pk.index;
        return (
          <Text key={m.n} wrap="truncate-end">
            <Text color={on ? C.accent : undefined} bold={on}>{on ? '❯' : ' '} {cut(m.text, textW).padEnd(textW)}</Text>
            <Text color={C.dim}>  {m.note}</Text>
          </Text>
        );
      })}
      {top + view < pk.items.length ? <Text color={C.dim}>  ↓ {pk.items.length - top - view} older</Text> : null}
      <Text> </Text>
      <Text color={C.dim}>↑↓ to choose · enter to see what goes back · esc to close</Text>
    </Box>
  );
}

// /settings: the commands kept out of the / menu, under their groups, each
// with what it holds now. ↑↓ to choose, enter opens it, esc goes back.
function SettingsPicker({ app }) {
  const pk = app.picker;
  const lw = Math.max(...pk.rows.map((r) => r.label.length)) + 2;
  const vw = Math.max(...pk.rows.map((r) => r.value.length)) + 3;
  // 29 lines with the gaps; a short window (24 rows at the least) drops them,
  // and the line under the title too, then the title's own line (it joins the first group's:
  // "Settings · Setup"), and then the key hint, when the status bar or the memory note takes
  // a line under the menu: the whole menu always shows, top edge to last row.
  const tight = app.rows < 30;
  const under = app.meters || memoryWarning(app.stats.ctxUsed ?? 0, app.ctx, app.stats.replyRoom ?? 0) ? 1 : 0;
  const need = (lines) => tight && pk.rows.length + pk.groups.length + lines + under + 1 > app.rows;
  const noBlurb = need(5);
  const noTitle = need(4);
  // Still one line short (18 rows at 24): the key hint at the bottom goes too; and with the
  // status bar as well, the last group's heading ("Tools": its rows follow the ones above).
  const noFoot = need(3);
  const noLastHead = need(2);
  let at = 0;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      {noTitle ? null : <Text bold>{pk.title ?? 'Settings'}</Text>}
      {noBlurb ? null : <Text color={C.dim}>{pk.blurb ?? 'Everything not in the / menu. Each still works typed in full, like /doctor.'}</Text>}
      {pk.groups.map((g, gi) => (
        <Box key={g.group} flexDirection="column" marginTop={tight ? 0 : 1}>
          {noLastHead && gi === pk.groups.length - 1 ? null : <Text bold>{noTitle && gi === 0 ? `${pk.title ?? 'Settings'} · ${g.group}` : g.group}</Text>}
          {g.rows.map((r) => {
            const on = at++ === pk.index;
            return (
              <Text key={r.name} wrap="truncate-end">
                <Text color={on ? C.accent : undefined} bold={on}>{on ? '❯' : ' '} {r.label.padEnd(lw)}</Text>
                <Text color={on ? C.accent : undefined}>{r.value.padEnd(vw)}</Text>
                <Text color={C.dim}>{r.note}</Text>
              </Text>
            );
          })}
        </Box>
      ))}
      {tight ? null : <Text> </Text>}
      {noFoot ? null : <Text color={C.dim}>↑↓ to choose · enter to open · esc to go back</Text>}
    </Box>
  );
}

// /effort, one panel: the Effort row, then the search's rows (Embedder,
// Retriever, Reranker) and every limit that can move, each under its heading,
// each value between ◀ ▶ with what it costs. ↻ marks the two that restart
// the model; • a value not saved yet. Thinking cap is dimmed while Effort is Low.
// Eleven limits (Look first last) keep the panel within 22 lines because the keys' hint sits on the
// Reset all line, not a line of its own: it fits a 24-row window (app-effort.test.mjs).
function LimitsPicker({ app }) {
  const pk = app.picker;
  const levels = pk.model.thinkingLevels ?? [];
  const lv = levels[pk.level];
  const off = lv ? 1 : 0; // the Effort row, when the model has levels
  const effortOn = lv ? !!lv.effort : undefined;
  const lw = Math.max(...LIMITS.map((l) => l.label.length), off ? 'Effort'.length : 0) + 2;
  // Wide enough for every name a search row can show, so the notes do not move.
  const vw = Math.max(...LIMITS.flatMap((l) => (l.choice ? l.steps(pk.model).map((s) => showLimit(l.id, s).length) : [showLimit(l.id, pk.values[l.id]).length])), ...levels.map((l) => l.label.length)) + 1;
  const heading = (name) => <Text key={`h-${name}`} color={C.faint}>{`── ${name} `}{'─'.repeat(Math.max(0, app.width - 8 - name.length))}</Text>;
  const env = { ...pk.env, values: pk.values, effortOn, effortLevel: lv?.effort ?? null };
  const reset = pk.index === off + LIMITS.length;
  const onEffort = off && pk.index === 0;
  const effortUnsaved = pk.level !== pk.savedLevel;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      {/* The hint sits on the title's line: the panel stays within 22 lines with Who decides in it. */}
      <Text wrap="truncate-end"><Text bold>Effort and limits</Text><Text color={C.dim}>{'   '}←→ moves a row; its cost is on the right. Kept for next time.</Text></Text>
      {lv ? (
        <>
          <Text wrap="truncate-end">
            <Text color={onEffort ? C.accent : undefined} bold={onEffort}>{onEffort ? '❯' : ' '} {'Effort'.padEnd(lw)}</Text>
            <Text color={onEffort && pk.level > 0 ? C.accent : C.faint}>◀ </Text>
            <Text color={effortUnsaved ? C.accent : undefined} bold={effortUnsaved}>{lv.label.padEnd(vw)}</Text>
            <Text color={onEffort && pk.level < levels.length - 1 ? C.accent : C.faint}>▶ </Text>
            <Text color={effortUnsaved ? C.accent : C.faint}>{effortUnsaved ? '•' : ' '}</Text>
            <Text color={C.dim}>{'  '}{lv.id === defaultLevelId(pk.model) ? 'default · ' : ''}{effortNote(lv, pk.values.thinking)}</Text>
          </Text>
        </>
      ) : null}
      {LIMITS.map((l, i) => {
        // A heading where a group starts: "Search" over the search's rows, "Limits" over the rest.
        // Who decides (group 'Effort') sits under the Effort row with no heading of its own.
        const group = l.group ?? 'Limits';
        const head = group !== 'Effort' && (i === 0 || (LIMITS[i - 1].group ?? 'Limits') !== group) ? heading(group) : null;
        const on = off + i === pk.index;
        const v = pk.values[l.id];
        const steps = l.steps(pk.model);
        const unsaved = v !== pk.saved[l.id];
        const note = limitNote(l.id, env);
        const idle = l.id === 'thinking' && effortOn === false; // not used while Effort is Low
        return (
          <React.Fragment key={l.id}>
          {head}
          <Text wrap="truncate-end">
            <Text color={on ? C.accent : idle ? C.dim : undefined} bold={on}>{on ? '❯' : ' '} {l.label.padEnd(lw)}</Text>
            <Text color={on && v !== steps[0] ? C.accent : C.faint}>◀ </Text>
            <Text color={unsaved ? C.accent : idle ? C.dim : undefined} bold={unsaved}>{showLimit(l.id, v).padEnd(vw)}</Text>
            <Text color={on && v !== steps.at(-1) ? C.accent : C.faint}>▶ </Text>
            <Text color={unsaved ? C.accent : C.faint}>{unsaved ? '•' : ' '}</Text>
            <Text color={C.dim}>{l.restart ? '↻ ' : '  '}</Text>
            <Text color={note.startsWith('⚠') ? C.warn : C.dim}>{isDefault(l.id, pk.values, pk.model) ? 'default · ' : ''}{note}</Text>
          </Text>
          </React.Fragment>
        );
      })}
      <Text wrap="truncate-end">
        <Text color={reset ? C.accent : undefined} bold={reset}>{reset ? '❯' : ' '} {'Reset all'.padEnd(lw)}</Text>
        <Text color={C.dim}>{'  '}↑↓ choose · ←→ change · enter saves · esc cancels · ↻ restarts model</Text>
      </Text>
    </Box>
  );
}

// /remote: where the model runs, in one form (remote-form.mjs): Run on first,
// then only that service's rows. A choice row shows its value between ◀ ▶; a
// text row its value, or what is being typed with the cursor (the API key as
// dots); • marks a change not saved yet. A Connect that did not work leaves
// its findings under the Connect row. Several models and none named: the list
// (a coder highlighted); enter picks one and Connect checks it.
// /web is the same form with its own rows (web-form.mjs) and a Test row.
function RemotePicker({ app }) {
  const pk = app.picker;
  const web = pk.kind === 'web';
  if (!web && pk.pick) return <RemoteModelPick app={app} />;
  const ROWS = web ? WEB_ROWS : rowsOf(pk);
  const showValueOf = web ? showWebValue : showValue;
  const noteOf = web ? webRowNote : rowNote;
  // The label column fits every row either form can show, so it does not move when Run on or More changes the rows.
  const lw = web ? Math.max(...ROWS.map((r) => r.label.length)) + 2 : 11;
  const vw = 22;
  const warn = (web ? webWarning : formWarning)(pk);
  // The row that checks: Test on /web, Connect on /remote; what it found goes on lines of its own (they can be long).
  const checkRow = web ? 'test' : 'go';
  const typing = (e) => {
    const shown = e.id === 'key' ? '•'.repeat(e.value.length) : e.value;
    const room = Math.max(8, app.width - lw - 12);
    const from = Math.max(0, e.cursor - room + 1);
    const before = shown.slice(from, e.cursor), at = shown[e.cursor] ?? ' ', after = shown.slice(e.cursor + 1, from + room);
    return <><Text>{from ? '…' : ''}{before}</Text><Text inverse>{at}</Text><Text>{after}</Text>{e.id === 'key' ? <Text color={C.dim}>  {e.value.length} characters</Text> : null}</>;
  };
  const changed = (id) => (web ? (id === 'key' ? pk.key !== null : id in pk.values && pk.values[id] !== pk.saved[id]) : rowChanged(pk, id));
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      <Text bold>{web ? 'Web' : 'Remote model'}</Text>
      <Text color={C.dim} wrap="truncate-end">{web ? 'What the model may do on the web. Test checks the key before anything is saved. Kept for every folder.' : 'Pick where it runs, fill in its rows, then Connect. Nothing changes unless it works.'}</Text>
      {ROWS.map((r, i) => {
        const on = i === pk.index;
        const e = pk.editing?.id === r.id ? pk.editing : null;
        const choice = r.type === 'choice' || (!web && r.id === 'model' && modelChoices(pk).length > 1);
        const unsaved = changed(r.id);
        const v = showValueOf(pk, r.id);
        const note = noteOf(pk, r.id);
        const done = r.id === checkRow && pk.test && !pk.test.running;
        const tone = done ? (pk.test.ok ? C.ok : pk.test.needModel ? C.warn : C.bad) : undefined;
        return (
          <React.Fragment key={r.id}>
            {r.id === checkRow ? <Text> </Text> : null}
            <Text wrap="truncate-end">
              <Text color={on ? C.accent : undefined} bold={on}>{on ? '❯' : ' '} {r.label.padEnd(lw)}</Text>
              {e ? typing(e) : (
                <>
                  <Text color={choice ? (on ? C.accent : C.faint) : undefined}>{choice ? '◀ ' : '  '}</Text>
                  <Text color={tone ?? (unsaved ? C.accent : r.type === 'action' || r.type === 'toggle' ? C.dim : undefined)} bold={unsaved}>{v.padEnd(vw)}</Text>
                  <Text color={choice ? (on ? C.accent : C.faint) : undefined}>{choice ? '▶ ' : '  '}</Text>
                  <Text color={unsaved ? C.accent : C.faint}>{unsaved ? '•' : ' '}</Text>
                  <Text color={tone ?? C.dim}>{'  '}{done ? '' : note}</Text>
                </>
              )}
            </Text>
            {done ? <Box paddingLeft={lw + 4}><Text color={tone}>{note}</Text></Box> : null}
          </React.Fragment>
        );
      })}
      {warn ? <Text color={warn.tone === 'error' ? C.bad : C.warn} wrap="wrap">{warn.text}</Text> : null}
      {pk.error ? <Text color={C.bad} wrap="truncate-end">{pk.error}</Text> : null}
      <Text color={C.dim} wrap="truncate-end">{pk.editing ? 'enter keeps it · esc puts it back · paste works · ctrl+u clears' : web ? '↑↓ choose · ←→ change · enter edits a row, runs Test, or saves · esc cancels · the web' : modelChoices(pk).length > 1 ? '↑↓ choose · ←→ change · enter on Model opens the list · esc cancels' : '↑↓ choose · ←→ change · enter edits a row or runs it · esc cancels'}</Text>
    </Box>
  );
}

// The names an OpenAI-compatible server listed, after Connect (or enter on the
// Model row). A coder is marked suggested when none was named yet.
function RemoteModelPick({ app }) {
  const pk = app.picker;
  const ids = pk.pick.models;
  const view = Math.max(3, Math.min(ids.length, Math.max(8, (app.rows ?? 24) - 16)));
  const top = Math.max(0, Math.min(pk.pick.index - Math.floor(view / 2), Math.max(0, ids.length - view)));
  const addr = showValue(pk, 'address');
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      <Text bold>Remote model</Text>
      <Text color={C.dim} wrap="truncate-end">{addr} has {ids.length} models. Pick one; Connect then checks it.</Text>
      <Text> </Text>
      {top > 0 ? <Text color={C.dim}>  ↑ {top} more</Text> : null}
      {ids.slice(top, top + view).map((id, i) => {
        const on = top + i === pk.pick.index;
        return (
          <Text key={`${top + i}:${id}`} wrap="truncate-end">
            <Text color={on ? C.accent : undefined} bold={on}>{on ? '❯' : ' '} {id}</Text>
            {id === pk.pick.suggested ? <Text color={C.dim}>  suggested</Text> : null}
          </Text>
        );
      })}
      {top + view < ids.length ? <Text color={C.dim}>  ↓ {ids.length - top - view} more</Text> : null}
      <Text> </Text>
      <Text color={C.dim}>↑↓ choose · enter picks it and connects · 1–9 picks that row · esc back to the form</Text>
    </Box>
  );
}

// A box in the middle of the window (/help): a title, a line or two, and the
// address it opened. Any key closes it.
function Popup({ app }) {
  const pp = app.popup;
  const boxW = Math.min(app.width - 4, 60);
  return (
    <Box width={app.width} justifyContent="center" flexShrink={0}>
      <Box flexDirection="column" alignItems="center" borderStyle="round" borderColor={C.accent} paddingX={2} paddingY={1} width={boxW}>
        <Text><Text color={C.accent}>{MARK}</Text> <Text bold>{pp.title}</Text></Text>
        <Text> </Text>
        {wrap(pp.text, boxW - 6).map((l, i) => <Text key={i}>{l}</Text>)}
        {pp.url ? <><Text> </Text><Text color={C.accent} wrap="truncate-middle">{pp.url}</Text></> : null}
        <Text> </Text>
        <Text color={C.dim}>esc or enter to close</Text>
      </Box>
    </Box>
  );
}

// /model: the model list and the effort level in one picker.
function ModelPicker({ app }) {
  const pk = app.picker;
  // The highlighted model's own levels, and the one it shows (App.jsx pickLevels: the level you chose, or its nearest).
  const levels = app.pickLevels ?? app.thinkingLevels;
  const at = Math.max(0, levels.findIndex((l) => l.id === app.pickLevelId));
  const lv = levels[at];
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      <Text bold>Model</Text>
      <Text color={C.dim}>Pick the model and its effort: how much it thinks before it acts. Kept for next time.</Text>
      <Text> </Text>
      {pk.models.map((m, i) => {
        const on = i === pk.index;
        // the names in one column, however long the longest is (an edited copy's is its model's plus " · edited"; a remote's carries its address)
        const nameW = Math.max(16, ...pk.models.map((x) => x.name.length + 2));
        const descOf = (x) => (x.remoteRow ? remoteRowDesc(x) : x.edited
          ? `${(x.bytes / 1e9).toFixed(1)} GB · ${x.edited.edits.length} edit${x.edited.edits.length === 1 ? '' : 's'} · saved ${new Date(x.edited.saved).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
          : `${(x.bytes / 1e9).toFixed(1)} GB · on this Mac`);
        const desc = descOf(m); const descW = Math.max(24, ...pk.models.map((x) => descOf(x).length + 2));
        const inUse = m.remoteRow ? app.remoteSource === m.source : !app.remoteSource && m.name === app.modelName;
        return (
          <Text key={m.id} wrap="truncate-end">
            <Text color={on ? C.accent : undefined} bold={on}>{on ? '❯' : ' '} {m.name.padEnd(nameW)}</Text>
            <Text color={C.dim}>{desc.padEnd(descW)}</Text>
            {inUse ? <Text color={C.ok}>✔ in use</Text> : null}
          </Text>
        );
      })}
      <Text> </Text>
      <Text>
        <Text bold>{'Effort     '}</Text>
        <Text color={at > 0 ? C.accent : C.faint}>◀  </Text>
        {levels.map((l, i) => (
          <Text key={l.id}>
            {i ? <Text color={C.dim}>  ·  </Text> : null}
            <Text color={i === at ? C.accent : C.dim} bold={i === at} underline={i === at}>{l.label}</Text>
          </Text>
        ))}
        <Text color={at < levels.length - 1 ? C.accent : C.faint}>  ▶</Text>
      </Text>
      <Text color={C.dim}>{'           '}{lv ? `${lv.label}: ${lv.note}` : ''}</Text>
      <Text> </Text>
      <Text color={C.dim}>↑↓ model · ←→ effort · enter to save · esc to cancel</Text>
    </Box>
  );
}

// /btw: the answer as rows at a width, each a list of styled pieces (bold,
// italic, code), so the panel can scroll it a row at a time. Lists keep a
// hanging indent; code lines are cut at the width, not wrapped.
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)/g;
function inlinePieces(text, style = null) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push({ t: text.slice(last, m.index), s: style });
    out.push(m[1] ? { t: m[1].slice(1, -1), s: 'code' } : m[2] ? { t: m[2].slice(2, -2), s: 'bold' } : { t: m[3].slice(1, -1), s: style ?? 'italic' });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), s: style });
  return out;
}
export function answerRows(text, width) {
  const w = Math.max(10, width);
  const rows = [];
  let code = false;
  for (const line of text.replace(/\s+$/, '').split('\n')) {
    if (/^\s*```/.test(line)) { code = !code; continue; }
    if (code) { rows.push([{ t: `  ${line}`.slice(0, w), s: 'code' }]); continue; }
    if (!line.trim()) { if (rows.length && rows.at(-1).length) rows.push([]); continue; }
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    const lead = li ? `${li[1]}${/\d/.test(li[2]) ? li[2] : '•'} `.slice(-Math.floor(w / 2)) : '';
    const words = [];
    for (const p of inlinePieces(h ? h[1] : li ? li[3] : line.trim(), h ? 'bold' : null)) for (const t of p.t.split(/(\s+)/)) if (t) words.push({ t, s: p.s });
    let row = lead ? [{ t: lead, s: null }] : [];
    let len = lead.length;
    let space = false;
    const start = () => { rows.push(row); row = lead ? [{ t: ' '.repeat(lead.length), s: null }] : []; len = lead.length; space = false; };
    for (const wd of words) {
      if (/^\s+$/.test(wd.t)) { space = len > lead.length; continue; }
      let t = wd.t;
      if (len > lead.length && len + (space ? 1 : 0) + t.length > w) start();
      // A word longer than the row is cut into row-long pieces.
      while (lead.length + t.length > w) { row.push({ t: t.slice(0, w - len), s: wd.s }); t = t.slice(w - len); start(); }
      if (space && len > lead.length) { row.push({ t: ' ', s: null }); len++; }
      row.push({ t, s: wd.s }); len += t.length; space = false;
    }
    rows.push(row);
  }
  return rows;
}

// The panel's parts: the question's lines, the answer's rows, how many show
// at once and from which one. The App scrolls with the same numbers.
export function btwLayout(app) {
  const b = app.btw;
  const q = wrap(`/btw ${b.question}`, Math.max(20, app.width - 4));
  const question = q.length > 3 ? [...q.slice(0, 2), `${q[2].slice(0, Math.max(1, app.width - 6))}…`] : q;
  // The answer's box is padded 4 on each side. While it writes, a ** or `
  // already opened on the last line is closed, so it shows styled, not raw.
  let text = b.text;
  if (b.phase === 'writing') { const last = text.slice(text.lastIndexOf('\n') + 1); if ((last.match(/\*\*/g) ?? []).length % 2) text += '**'; if ((last.match(/`/g) ?? []).length % 2) text += '`'; }
  const rows = b.phase === 'answering' ? [] : answerRows(text, app.width - 8);
  const view = b.phase === 'answering' ? 1 : Math.max(3, Math.min(Math.max(1, rows.length), app.rows - 12 - question.length));
  const maxOffset = Math.max(0, rows.length - view);
  // While it writes, the end shows; once done, the top, as you read it.
  const offset = b.scroll == null ? (b.phase === 'writing' ? maxOffset : 0) : Math.min(maxOffset, Math.max(0, b.scroll));
  return { question, rows, view, offset, maxOffset, panelRows: 1 + 1 + question.length + 1 + view + 1 + 1 };
}

const PIECE = { bold: { bold: true }, italic: { italic: true }, code: { color: 'ansi256(152)' } };
function BtwPanel({ app }) {
  const b = app.btw;
  const L = btwLayout(app);
  const secs = Math.max(0, (app.now - b.startedAt) / 1000);
  const icon = spinFrame(app.spinner, secs);
  const tone = b.phase === 'noroom' ? C.warn : b.phase === 'error' ? C.bad : undefined;
  const keys = b.phase === 'done'
    ? [L.maxOffset > 0 ? '↑/↓ to scroll' : null, 'c to copy', 'f to send to main', 'Esc to close'].filter(Boolean).join(' · ')
    : b.phase === 'writing' ? 'Esc to stop and close' : 'Esc to close';
  return (
    <Box flexDirection="column" width={app.width} flexShrink={0}>
      <Text color={C.border}>{'─'.repeat(app.width)}</Text>
      <Text> </Text>
      {L.question.map((l, i) => (
        <Box key={i} paddingX={2}><Text>{i === 0 ? <><Text color={C.accent} bold>/btw</Text>{l.slice(4)}</> : l}</Text></Box>
      ))}
      <Text> </Text>
      {b.phase === 'answering' ? (
        <Box paddingX={4}><Text><Text color={icon.color}>{icon.glyph}</Text><Text color={C.accent}> Answering…</Text><Text color={C.dim}> ({fmtSecs(secs)})</Text></Text></Box>
      ) : (
        <Box paddingX={4} flexDirection="column" height={L.view} overflow="hidden">
          {L.rows.slice(L.offset, L.offset + L.view).map((r, i) => (
            <Text key={L.offset + i} color={tone} wrap="truncate-end">{r.length ? r.map((p, j) => <Text key={j} {...(PIECE[p.s] ?? {})}>{p.t}</Text>) : ' '}</Text>
          ))}
        </Box>
      )}
      <Text> </Text>
      {/* the footer is hidden under the panel, so its notes ("copied …") show here */}
      <Box paddingX={2}><Text color={app.notice ? C.warn : C.dim} wrap="truncate-end">{app.notice ?? keys}</Text></Box>
    </Box>
  );
}

// Shown instead of the screen when the window is smaller than it is laid out for.
function TooSmall({ app }) {
  return (
    <Box flexDirection="column">
      <Text color={C.warn} wrap="wrap">Make the window at least {MIN_COLS}×{MIN_ROWS} to see Agentic Coder</Text>
      <Text color={C.dim} wrap="wrap">It is {app.columns}×{app.rows} now. {app.perm ? 'Agentic Coder is waiting for your answer.' : app.live.phase === 'working' ? 'Agentic Coder keeps working meanwhile.' : ''}</Text>
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
// An item as printed: a turn's step brings the rail line linking it to the step before and has no
// blank line under it; the turn's end line, and everything outside a turn, has one. Your message's
// strip has its own padding.
export const gapUnder = (it) => (it.rail ? (it.type === 'done' ? 1 : 0) : it.type === 'user' ? 0 : 1);
export function ItemFrame({ it, width, model, cwd, loaded, start }) {
  return (
    <Box flexDirection="column" marginBottom={gapUnder(it)} width={width}>
      {it.rail && it.type !== 'machine' ? <Pipe /> : null}
      <Item it={it} width={width} model={model} cwd={cwd} loaded={loaded} start={start} />
    </Box>
  );
}
export function primeRows(items, ctx) {
  let added = false;
  for (const it of items) {
    const k = rowsKey(it, ctx);
    if (itemHeights.has(k)) continue;
    if (itemHeights.size > 5000) itemHeights.clear();
    const out = renderToString(<ItemFrame it={it} width={ctx.width} model={ctx.modelName} cwd={ctx.cwdShort} loaded={ctx.loaded} start={ctx.start} />, { columns: ctx.width });
    itemHeights.set(k, out.split('\n').length); // the margin under it (gapUnder) is its last line
    added = true;
  }
  return added;
}
const heightOf = (it, app) => itemHeights.get(rowsKey(it, app));
// The start page stays live until your first message (the bot and the model line follow the
// model: off, loading after /start, ready), then prints once, with whatever came meanwhile printed
// under it in order. What came meanwhile shows under the live page; when that would not fit in the
// window beside it the page is let go (printed as it is) and the Starting line takes over.
export const heldRows = (items, ctx) => items.slice(1).reduce((n, it) => n + (itemHeights.get(rowsKey(it, ctx)) ?? Infinity), 0);
// Rows the held page leaves under it: the window less the page (18 until it is measured), the
// prompt box, the blank row above the footer, the footer and the cursor's line.
export const holdRoom = (items, ctx, rows) => rows - (itemHeights.get(rowsKey(items[0], ctx)) ?? 18) - 6;
// Rows the conversation fills from the top of the window (at most the
// window). An item not measured yet counts as a full window: no space, never
// a prompt box pushed below the window.
export function usedRows(app) {
  let n = 0;
  for (const it of app.hold ? [] : app.items) {
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
    drawn.current = { redraw: app.redraw, height: measureElement(liveRef.current).height, count: app.hold ? 0 : app.items.length };
  });
  // An empty <Static> of its own resets what Ink keeps to print again on a
  // full clear, so the old (wider) conversation is not printed into the small window.
  if (app.tooSmall) return <Box flexDirection="column"><Static key={`small${app.redraw}`} items={[]}>{() => null}</Static><TooSmall app={app} /></Box>;
  // The conversation is printed from the top of the window (at the start and
  // again after a resize); the prompt box, footer and status line sit on the
  // last lines, with blank space in between until the conversation fills it.
  // The last line stays free for the cursor, so nothing scrolls.
  const items = app.items;
  const printed = app.hold ? [] : items;
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
      <Static key={app.redraw} items={printed}>
        {(it) => (
          // Static lines are laid out on their own, so they need the width
          // too; without it long lines are wrapped by the terminal mid-word.
          <ItemFrame key={it.key} it={it} width={width} model={modelName} cwd={app.cwdShort} loaded={app.loaded} start={app.start} />
        )}
      </Static>
      <Box ref={liveRef} flexDirection="column" minHeight={fill} maxHeight={Math.max(fill, app.rows - 1)} overflow="hidden" justifyContent="flex-end">
      <Box flexDirection="column" flexShrink={0}>
      {app.hold ? (
        <Box flexDirection="column">
          <Box marginBottom={1}><StartPage start={app.start} width={width} loading={app.starting || app.battle || app.waiting ? { phase: app.battle || app.waiting ? 'waiting' : app.startPhase, secs: Math.max(0, (app.now - app.startedAt) / 1000), left: app.startLeft } : null} typing={app.input?.value && !app.menu ? (4 + (app.input.cursor % promptTextWidth(width))) / width : null} /></Box>
          {items.slice(1).map((it) => <ItemFrame key={it.key} it={it} width={width} model={modelName} cwd={app.cwdShort} loaded={app.loaded} start={app.start} />)}
          {app.battle ? <Box marginBottom={1}><Text color={C.warn}>⏸ Waiting for {/^a test/.test(app.battle) ? 'a test run' : 'a battle'}: {app.battle}. Only one model fits, so {modelName} loads by itself when it is over; a message you send now waits for it.</Text></Box> : null}
          {app.waiting ? <Box marginBottom={1}><Text color={C.warn}>{app.waiting} has {modelName} loaded, and two copies do not fit. It starts by itself when that is done · <Text bold>esc</Text> starts anyway</Text></Box> : null}
        </Box>
      ) : app.battle ? (
        <Box marginBottom={1}><Text color={C.warn}>⏸ Waiting for {/^a test/.test(app.battle) ? 'a test run' : 'a battle'}: {app.battle}. Only one model fits, so {modelName} loads by itself when it is over; a message you send now waits for it.</Text></Box>
      ) : app.starting ? (
        <Box marginBottom={1} flexDirection="column"><Text><StartIcon app={app} /><Text color={C.accent}> Starting {modelName}…</Text><Text color={C.dim}> {START_PHASE[app.startPhase] ?? ''}({fmtSecs(Math.max(0, (app.now - app.startedAt) / 1000))})</Text></Text>
          {app.waiting ? <Text color={C.warn}>  {app.waiting} has {modelName} loaded, and two copies do not fit. It starts by itself when that is done · <Text bold>esc</Text> starts anyway</Text> : null}</Box>
      ) : null}
      <LiveArea app={app} />
      {app.btwWaiting ? <Box marginBottom={1}><Text color={C.dim}>⏵ Your /btw answer is kept: it shows again once you have answered</Text></Box> : null}
      {app.queued ? <Box marginBottom={1}><Text color={C.dim}>⏵ Queued: {app.queued.length > 80 ? `${app.queued.slice(0, 79)}…` : app.queued}{app.starting ? '  · sends as soon as the model is ready' : app.modelOff ? '  · sends once /start has loaded the model' : ''}</Text></Box> : null}
      </Box>
      <Box flexGrow={1} />
      {app.popup ? <><Popup app={app} /><Box flexGrow={1} /></> : null}
      <Box flexDirection="column" flexShrink={0}>
      {app.picker?.kind === 'model' ? (
        <ModelPicker app={app} />
      ) : app.picker?.kind === 'choice' ? (
        <ChoicePicker app={app} />
      ) : app.picker?.kind === 'limits' ? (
        <LimitsPicker app={app} />
      ) : app.picker?.kind === 'remote' || app.picker?.kind === 'web' ? (
        <RemotePicker app={app} />
      ) : app.picker?.kind === 'settings' ? (
        <SettingsPicker app={app} />
      ) : app.picker?.kind === 'rewind' ? (
        <RewindPicker app={app} />
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
      ) : app.btw ? (
        <BtwPanel app={app} />
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
