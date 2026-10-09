// What the terminal shows, laid out like Claude Code: thinking folded to one
// line, one spinner with the time and tokens, a line with the time left behind
// when a turn ends, nothing under the prompt but the footer (/meters on adds
// the status bar).
// Finished lines go in <Static> (printed once, so the terminal's own
// scrollback keeps working); the live area below them is redrawn.
import React, { useRef, useLayoutEffect, useState } from 'react';
import { Box, Text, Static, renderToString, measureElement, useCursor } from 'ink';
import { cursorCell, rowText, selection, promptTextWidth } from './edit-input.mjs';
import { askOptions, askState, typeLabel } from './app-ask.mjs';
import { C, MARK, spinFrame, fmtSecs, fmtTok } from '../ui/theme.mjs';
import { money } from '../agent/spend.mjs';
import { wrap, Row, Result, ToolHead, Diff, diffParts, Todos, modeLabel, MODE_SHORT } from '../ui/parts.jsx';
import { Markdown } from './markdown.jsx';
import { MIN_COLS, MIN_ROWS } from './window.mjs';
import { AgentsView, AgentsLine } from './agents-view.jsx';
import { LoopsView, LoopsLine } from './loops-view.jsx';
import { pressureWord, footerLabel } from './mac-memory.mjs';
import { gaugesOf, gaugeLine, fitRemote, meterWords } from './remote-footer.mjs';
import { usageRow, usagePanel } from './usage-bar.mjs';
import { showLimit, limitNote, isDefault, effortNote, defaultLevelId, shownLimits } from './limits.mjs';
import { jumpRows, rowStatus, jumpInfo } from './jump-box.mjs';
import { DETACH_LABEL } from './sessions.mjs';
import { rowsOf, showValue, rowNote, rowChanged, modelChoices, formWarning, remoteRowDesc, formReady } from './remote-form.mjs';
import { serviceRows, atRow, rowDetail, groupsOf, sizeWord, ctxWord, gbWord, canWord, isBig, isHelper as isHelperModel } from './remote-models.mjs';
import { triedWord } from './tryouts.mjs';
import { WEB_ROWS, showWebValue, webRowNote, webWarning } from './web-form.mjs';
import { listRows, serverLine, projectLine, formRows, showMcpValue, mcpRowNote, mcpRowChanged, mcpWarning, testLines, toolState, toolWindow, toolNote } from './mcp-form.mjs';
import { hookListRows, hookLine, projectLine as hooksProjectLine, checkOn, rowWindow, hookFormRows, showHookValue, hookRowNote, hookRowChanged, hookWarning } from './hooks-form.mjs';
import { HOOKS as APP_CHECKS } from '../agent/way.mjs';
import { eventOf } from '../agent/user-hooks.mjs';
import { codenameOf } from '../agent/helpers.mjs';
import { RAIL, Node, Pipe, UserStrip, MachineLine, ThoughtNode, ThinkingLive, ReplyNode, ToolNode, LooksNode, RunningNode, CheckNode, NoteNode, EndLine, WritingNode, MadeNode, doingWords, foldSteps, groupFacts, GroupHead, GroupBox, groupWork } from './rail.jsx';
import { HomePage, lookOf } from './home-looks.jsx';
import { StartLine } from './start-notes.jsx';
import { useBot, BotLayer, KEEP_ROWS, KEEP_FROM } from './bot-layer.jsx';
import { AttachTray } from './tray.jsx';
import { ProfileStep, ProfilesPanel } from './profiles-view.jsx';
import { spillWord } from './profiles.mjs';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const diffW = (width) => Math.max(40, Math.min(110, width - 12));

// Long folder paths keep their end, which is the part that says where you are.
const fitPath = (p, max) => (p.length <= max ? p : `…${p.slice(p.length - max + 1)}`);

// The footer's live memory dot: Activity Monitor's fine / tight / critical, in the app's blue, yellow and red.
const PRESSURE_COLOR = { fine: C.ok, tight: C.warn, critical: C.bad };

const webSize = (b) => (b == null ? '' : b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

function ToolView({ it, width }) {
  const v = it.view ?? {};
  const bullet = it.error ? C.bad : C.ok;
  const head = <ToolHead tool={it.label} arg={it.arg} color={bullet} />;
  let body = null;
  switch (v.kind) {
    case 'read': body = v.outline ? <Text>Outline: {v.parts > 0 ? <><Text bold>{v.parts}</Text> {v.parts === 1 ? 'part' : 'parts'}</> : 'no parts'} of {v.total} lines <Text color={C.dim}>(ctrl+o to expand)</Text></Text> : <Text>Read <Text bold>{v.lines}</Text> {v.lines === 1 ? 'line' : 'lines'}{v.total > v.lines ? ` of ${v.total}` : ''} <Text color={C.dim}>(ctrl+o to expand)</Text></Text>; break;
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
          {v.timedOut ? <Text color={C.warn}>Stopped after {v.after ?? '2 minutes'}</Text> : v.code ? <Text color={C.bad}>Exit code {v.code}</Text> : null}
        </Box>
      );
      break;
    }
    // A background command (tools/jobs.mjs): started, looked at, or stopped, and its newest lines.
    // The App tool (the app driven by the model, agent/tools.mjs appTool) is drawn the same way.
    case 'app':
    case 'job': {
      const shown = v.lines.slice(-4);
      body = (
        <Box flexDirection="column">
          <Text color={C.dim} wrap="truncate-end">{v.what}</Text>
          {shown.map((l, i) => <Text key={i} wrap="truncate-end">{l || ' '}</Text>)}
          {v.lines.length > shown.length ? <Text color={C.dim}>… +{v.lines.length - shown.length} lines (ctrl+o to expand)</Text> : null}
        </Box>
      );
      break;
    }
    case 'todos': return <Todos title={it.label === 'Plan' ? 'Plan' : 'Update Todos'} items={v.items.map((t) => ({ text: t.text, done: t.status === 'done', active: t.status === 'in_progress' }))} />;
    // The opening read on a remote (agent/opening.mjs), as Claude Code shows its own: the title, the command, what came.
    case 'opening': return (
      <Box flexDirection="column">
        <Row markColor={bullet}><Text bold>{v.title}</Text></Row>
        <Result>
          <Text color={C.dim} wrap="truncate-end">$ {v.command}</Text>
          {v.lines.map((l, i) => <Text key={i} wrap="truncate-end">{l}</Text>)}
          <Text color={C.dim}>(ctrl+o to expand)</Text>
        </Result>
      </Box>
    );
    // A tool of an MCP server (agent.mjs runMcp): the first lines of what it answered.
    case 'mcp': {
      const lines = String(v.content ?? '').split('\n').filter((l) => l.trim());
      const shown = v.looked ? [] : lines.slice(0, 3);
      body = (
        <Box flexDirection="column">
          {v.looked ? <Text>Its arguments; nothing ran <Text color={C.dim}>(ctrl+o to expand)</Text></Text> : null}
          {shown.map((l, i) => <Text key={i} color={it.error ? C.bad : undefined} wrap="truncate-end">{l}</Text>)}
          {!v.looked && !lines.length ? <Text color={C.dim}>(it returned nothing)</Text> : null}
          {lines.length > shown.length && !v.looked ? <Text color={C.dim}>… +{lines.length - shown.length} lines (ctrl+o to expand)</Text> : null}
          {v.pictures ? <Text color={C.dim}>{v.pictures} picture{v.pictures === 1 ? '' : 's'}{v.shown ? '' : ', not shown to this model'}</Text> : null}
        </Box>
      );
      break;
    }
    case 'toolsearch': body = <Text>{v.tools?.length ? <>Loaded <Text bold>{v.tools.length}</Text> tool{v.tools.length === 1 ? '' : 's'}: {v.tools.join(', ')}</> : 'Nothing found'}</Text>; break;
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

// "3 Oct, 5:42 PM": when the pack of Claude's notes was built.
const packDay = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '?' : `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`; };

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
          {it.claude.pack ? <Box paddingLeft={4} width={W}><Text color={C.dim} wrap="truncate-end">the pack: {it.claude.pack.notes} notes in {it.claude.pack.topics} topics, built {packDay(it.claude.pack.built)}</Text></Box> : null}
          {it.claude.pack?.newer ? <Box paddingLeft={4} width={W}><Text color={C.warn} wrap="truncate-end">{it.claude.pack.newer} of Claude's notes changed since: bun run pack makes it current</Text></Box> : null}
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

// The counts on the done line: " · 9 steps · 4 reads · ~1,820 thinking tokens · ↓ 31.2k tokens this session"
// (a count of 0 is left out; old saved sessions have none).
export function doneCounts(it) {
  const n = (x, one, many) => (x ? ` · ${x.toLocaleString('en-US')} ${x === 1 ? one : many}` : '');
  return `${n(it.steps, 'step', 'steps')}${n(it.reads, 'read', 'reads')}${it.thinkTokens ? ` · ~${it.thinkTokens.toLocaleString('en-US')} thinking tokens` : ''}${it.session ? ` · ↓ ${fmtTok(it.session)} tokens this session` : ''}`;
}

export function Item({ it, width, model, cwd, loaded, start }) {
  switch (it.type) {
    case 'welcome': return <HomePage start={start} width={width} />;
    // What the start said (start-notes.jsx): the Launcher's one line; the Menu has it in its rows (ItemFrame).
    case 'startnotes': return <StartLine said={it.said} width={width} />;
    // Your message on its grey strip; an answer you typed to its question mid-turn is a step of the turn.
    case 'user': return it.rail
      ? <Node g="›" c={C.accent}><Text><Text color={C.dim}>You: </Text>{it.text}</Text></Node>
      : <UserStrip text={it.text} attached={it.attached} cards={it.cards} width={width} />;
    case 'machine': return <MachineLine it={it} />;
    case 'thinking': return it.rail ? <ThoughtNode it={it} /> : <Text color={C.think} italic>∴ Thought for {fmtSecs(Math.max(1, it.secs))} <Text color={C.faint}>(ctrl+o to show thinking)</Text></Text>;
    // The line a finished turn leaves behind: "⠿ Worked for 41s · done 12:58 PM".
    case 'done': return it.rail ? <EndLine it={it} counts={doneCounts(it)} /> : <Text><Text color={C.accent}>{MARK}</Text><Text color={C.dim}> {it.past} for {fmtSecs(it.secs)}{doneCounts(it)} · done {clock(it.at)}{it.usd > 0 ? ` · ${money(it.usd)} for this request` : ''}</Text></Text>;
    case 'text': return it.rail ? <ReplyNode text={it.text} /> : <Row><Markdown text={it.text} /></Row>;
    case 'tool': return it.rail ? <ToolNode it={it} cwd={cwd} /> : <ToolView it={it} width={width} />;
    // Reads, lists and searches in a row, as one row (rail.jsx foldSteps).
    case 'looks': return <LooksNode list={it.list} cwd={cwd} />;
    // A stretch of steps between two things the model says, closed or open (rail.jsx groupWork).
    case 'group': return <GroupView it={it} width={width} model={model} cwd={cwd} loaded={loaded} start={start} />;
    case 'sorted': return <Result><Text color={C.dim}>{it.text}</Text></Result>;
    case 'made': return <MadeNode files={it.files} />;
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

// The status line under the footer (/meters on): model, speed, memory, effort. On a remote, the
// server's figures in place of this Mac's RAM: speeds, the first token, GPU memory, the cost, the ping
// (remote-footer.mjs meterWords).
function Meters({ app }) {
  const { stats, modelName, ctx, ramGb } = app;
  const speed = speedOf(app);
  const used = stats.ctxUsed ?? 0;
  const remote = Boolean(app.modelState?.remote);
  const far = remote ? meterWords({ g: app.gauges, pps: app.gauges ? stats.pps : null, server: app.server, spend: app.spend }) : [];
  return (
    <Box paddingX={2} width={app.width}>
      <Text color={C.dim} wrap="truncate-end">
        {modelName}{app.modelOff ? ' (off · ctrl+t)' : ''}  {speed}  ctx <Text color={C.accentDim}>{bar(used / ctx)}</Text> {Math.max(1, Math.round((used / ctx) * 100))}% of {Math.round(ctx / 1024)}k{ramGb && !remote ? `  RAM ${ramGb.toFixed(1)} GB` : ''}{far.map((w) => `  ${w}`).join('')}  effort {app.thinkingLabel ?? (app.thinking ? 'on' : 'low')}
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
  // A busy service (busy.mjs): the seconds to its next try.
  const busy = live.busyUntil > now ? ` · waiting for the service, trying again in ${Math.ceil((live.busyUntil - now) / 1000)} s` : '';
  // On an Ollama service a tool call comes whole once written: words stop while a long one is
  // written, and the line says so instead of a speed that stood still (4 Oct 2026: 4 minutes at "34.5 tok/s").
  const quiet = live.whole && live.lastTokenAt && !live.waiting ? (now - live.lastTokenAt) / 1000 : 0;
  const pace = busy ? busy : !live.rail ? '' : live.task ? ` · ${live.task}` : live.waiting ? ' · reading' : quiet >= 15 ? ` · writing its next step, sent whole when done (${fmtSecs(quiet)})` : live.liveTps ? ` · ↓ ${live.liveTps.toFixed(1)} tok/s` : '';
  const doing = live.rail ? '' : doingWords(live);
  // The tokens: every one written since the window opened, this request's as they stream. In a
  // narrow window " this session" goes first, then the count, so "esc to interrupt" stays whole.
  const rest = `${step !== null ? ` · this step ${fmtSecs(step)}` : ''}${pace}${doing ? ` · ${doing}` : ''}${live.flowStep ? ` · step ${live.flowStep.index + 1} of ${live.flowStep.count}: ${live.flowStep.text}` : ''}`;
  const count = ` · ↓ ${fmtTok((app.sessionTokens ?? 0) + (live.tokens ?? 0))} tokens`;
  // "  ╰─ " on the rail, the glyph and a space, "Verb… (", the seconds, the note, " · esc to interrupt)".
  const long = (n) => (live.rail ? 5 : 0) + 2 + String(live.verb ?? '').length + 3 + fmtSecs(secs).length + n.length + 20;
  const note = [`${count} this session${rest}`, `${count}${rest}`].find((n) => long(n) <= (app.width ?? 80)) ?? rest;
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

export function LiveArea({ app, held }) {
  const { live, width, rows } = app;
  if (live.phase !== 'working') return null;
  // An open /btw panel is taller than the prompt box it replaces: the reply shows less.
  const maxLines = app.btw ? Math.max(2, rows - 16 - (btwLayout(app).panelRows - 4)) : Math.max(6, rows - 16);
  if (live.rail) return <LiveRail app={app} maxLines={maxLines} held={held} />;
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

// A turn under way, on the rail: what came along (until the first step prints it), a run of reads
// not closed yet (held: Screen's foldSteps), the thinking (its latest lines, live), the reply as it
// is written (an empty row above it, as once printed), the file being written, a tool running with
// its seconds, and the working line at the rail's end. No empty rail rows between them.
function LiveRail({ app, maxLines, held }) {
  const { live, width } = app;
  const blocks = [];
  if (live.pre) blocks.push(<MachineLine key="pre" it={live.pre} />);
  // grouped (/steps): the stretch under way, its row counting and its last two steps (rail.jsx groupWork)
  if (Array.isArray(held)) blocks.push(<LiveGroup key="held" list={held} width={width} model={app.modelName} cwd={app.cwdShort} loaded={app.loaded} start={app.start} />);
  else if (held) blocks.push(held.type === 'looks' ? <LooksNode key="held" list={held.list} cwd={app.cwdShort} /> : <ToolNode key="held" it={held} cwd={app.cwdShort} />);
  if (live.thinking && !live.text && !live.writing) blocks.push(<ThinkingLive key="think" thinking={live.thinking} now={app.now} width={width} cap={live.thinkCap} />);
  if (live.text) {
    const shown = tailToFit(live.text, maxLines, width - 6);
    blocks.push(
      <Box key="text" flexDirection="column" marginY={1} maxHeight={maxLines + 2} overflow="hidden" justifyContent="flex-end">
        <Box flexDirection="column" flexShrink={0}><ReplyNode text={shown} /></Box>
      </Box>,
    );
  }
  if (live.writing) blocks.push(<WritingNode key="writing" writing={live.writing} room={live.room} used={live.streamTokens} tps={live.liveTps} />);
  if (live.tries) {
    const t = live.tries;
    blocks.push(
      <Box key="tries" flexDirection="column">
        <Node g="◆" c={C.dim}><Text><Text bold>{t.label}</Text><Text color={C.dim}> ({Math.min(t.n, t.max)} of up to {t.max})</Text></Text></Node>
        <Pipe><Text><Marks marks={t.marks} pending />{t.tokens ? <Text color={C.dim}>  writing… {plural(t.tokens, 'token')}</Text> : <Text color={C.dim}>  checking…</Text>}</Text></Pipe>
      </Box>,
    );
  }
  if (live.running) blocks.push(<RunningNode key="running" running={live.running} secs={live.stepStart ? Math.max(0, (app.now - live.stepStart) / 1000) : 0} cwd={app.cwdShort} />);
  if (!app.perm) blocks.push(<Spinner key="spin" app={app} />);
  return <Box flexDirection="column">{blocks}</Box>;
}

const PERM_TITLE = { Edit: 'Edit file', Write: 'Create file', Bash: 'Bash command', Rename: 'Rename', Test: 'Approve this test', Ask: 'Agentic Coder asks', WebSearch: 'Web search', WebFetch: 'Read a web page', Screen: 'Look at the screen', Mcp: 'MCP tool', McpProject: 'A project brings its own MCP servers', HooksProject: 'A project brings its own hooks' };

// prefix: the rule "don't ask again" would remember (null: none can, the
// command's words cannot be trusted); saveRule: what "always allow" would save
// for this folder (/permissions), when the app can save one.
export function permissionOptions(req, prefix, saveRule = null) {
  const yes = { label: 'Yes', choice: 'yes' };
  const no = { label: 'No, and tell Agentic Coder what to do differently (esc)', choice: 'no' };
  // A question: its choices, each with what it means (about), then the row you type into (app-ask.mjs);
  // esc stops (the hint line says so). The model's questions after the first are the box's tabs.
  if (req.name === 'Ask') return askOptions(req.args);
  // A git commit asks every time (permissions.mjs), so it has no "don't ask again".
  if (req.name === 'Bash') return req.once || !prefix ? [yes, no] : [yes, { label: `Yes, and don't ask again for ${prefix} this session`, choice: 'always' }, ...(saveRule ? [{ label: `Yes, and always allow ${saveRule} in this folder`, choice: 'save' }] : []), no];
  if (req.name === 'Test') return [{ label: 'Yes, use this test', choice: 'yes' }, { label: 'No, and tell Agentic Coder what the test should check (esc)', choice: 'no' }];
  // The web: "don't ask again" for this site (or for searches) this session; "always" saves the rule for this folder.
  if (req.name === 'WebSearch' || req.name === 'WebFetch') {
    const what = req.name === 'WebSearch' ? 'web searches' : String(req.rule ?? '').replace(/^WebFetch\((.*)\)$/, '$1');
    return req.rule ? [yes, { label: `Yes, and don't ask again for ${what} this session`, choice: 'always' }, { label: `Yes, and always allow ${what} in this folder`, choice: 'save' }, no] : [yes, no];
  }
  // A tool of an MCP server: this once, this session, or saved for this folder (with the tool's fingerprint).
  if (req.name === 'Mcp') {
    const what = `${req.mcp?.server}:${req.mcp?.tool}`;
    return req.rule ? [yes, { label: `Yes, and don't ask again for ${what} this session`, choice: 'always' }, ...(saveRule ? [{ label: `Yes, and always allow ${what} in this folder`, choice: 'save' }] : []), no] : [yes, no];
  }
  // A project's own MCP servers (.agentic/mcp.json): before they may start.
  if (req.name === 'McpProject') return [{ label: `Yes, start ${req.servers.length === 1 ? req.servers[0].name : 'them'} (asked again if .agentic/mcp.json changes)`, choice: 'yes' }, { label: 'Not now (this session)', choice: 'no' }, { label: 'Never for this project', choice: 'never' }];
  // A project's own hooks (.agentic/hooks.json, user-hooks.mjs): before they run, and to stop them.
  if (req.name === 'HooksProject') return req.running
    ? [{ label: 'Stop running them (asked again next time)', choice: 'stop' }, { label: 'Keep them running (esc)', choice: 'no' }]
    : [{ label: 'Yes, run them (asked again if .agentic/hooks.json changes)', choice: 'yes' }, { label: 'Not now (this session)', choice: 'no' }, { label: 'Never for this project', choice: 'never' }];
  // The screen: once per app (the user's pick, 1 Oct 2026): this time, this session, or saved.
  if (req.name === 'Screen') return [{ label: 'This time', choice: 'yes' }, { label: 'For this session', choice: 'always' }, { label: 'Always (saved for this folder)', choice: 'save' }, { label: 'No (esc)', choice: 'no' }];
  // A protected file asks every time (permissions.mjs), so it has no "allow all edits".
  if (req.once) return [yes, no];
  if (req.name === 'Rename') return [yes, { label: 'Yes, and allow all edits this session (shift+tab)', choice: 'always' }, no];
  return [yes, { label: 'Yes, allow all edits this session (shift+tab)', choice: 'always' }, no];
}

// What a Screen question shows: the app's window, or all of it.
const screenWhat = (args) => (String(args?.app ?? '').trim() ? `${String(args.app).trim()}'s front window` : 'the whole screen: every window that is open on it');

function PermissionPrompt({ app }) {
  const { perm, width } = app;
  const req = perm.req;
  // A question of an MCP server's own (agent.mjs mcpAsked) is headed as the server's, not the app's.
  const title = req.kind === 'mcp' ? `${req.asker} asks` : req.name === 'Mcp' ? `MCP tool · ${req.mcp?.server}` : req.name === 'Write' && !req.prepared?.created ? 'Overwrite file' : PERM_TITLE[req.name] ?? req.name;
  const argLines = req.name === 'Mcp' ? Object.entries(req.args ?? {}).map(([k, v]) => { const t = typeof v === 'string' ? v : JSON.stringify(v); const n = t.split('\n').length; return `${k}: ${n > 1 ? `${n} lines` : t.length > Math.max(20, width - k.length - 12) ? `${t.slice(0, Math.max(19, width - k.length - 13))}…` : t}`; }) : [];
  const hunk = req.prepared?.hunk ?? [];
  // The whole prompt fits the window with a line to spare: a live area as
  // tall as the window makes Ink clear and redraw the screen on every frame.
  const fixed = 2 + 1 + 1 + perm.options.length + 1 + 1 + (req.protectedBy ? 1 : 0) + (req.autoReason ? 1 : 0) + (req.mcp?.changed ? 1 : 0) + (req.mcp?.note ? 1 : 0); // …, the status line, a spare line, the protected-file, Auto and MCP lines
  const room = Math.max(3, app.rows - fixed);
  const cap = Math.max(2, room - 4); // the diff box: its border, file name and "more lines"
  const files = req.prepared?.files ?? [];
  const nFiles = Math.max(1, Math.min(6, files.length, Math.floor((room - 1) / 5)));
  // Two lines more slack than the sum suggests: at 22 of 24 rows Ink still cleared the whole screen.
  const perFile = Math.max(1, Math.floor((room - 3 - 3 * nFiles) / nFiles));
  const cmdLines = String(req.args?.command ?? '').split('\n');
  // A change's lines, as many as fit the room (a long line takes a row per wrap).
  const fit = (lines, w, n) => { let used = 0, i = 0; for (; i < lines.length; i++) { used += diffParts(lines[i].text, w).length; if (used > n) break; } return lines.slice(0, Math.max(1, i)); };
  const side = width >= 120 && Boolean(req.prepared?.hunk) && !['Mcp', 'Rename', 'Ask'].includes(req.name);
  const leftW = Math.floor((width - 4) * 0.62);
  const shownHunk = fit(hunk, side ? leftW - 4 : diffW(width) - 4, cap);
  const what = (
      req.name === 'Mcp' ? (
        <Box flexDirection="column" paddingX={2} marginY={1}>
          <Text bold wrap="truncate-end">{req.mcp.tool}</Text>
          {argLines.slice(0, Math.max(1, room - 6)).map((l, i) => <Text key={i} wrap="truncate-end">{l}</Text>)}
          {argLines.length > Math.max(1, room - 6) ? <Text color={C.dim}>… +{argLines.length - Math.max(1, room - 6)} more</Text> : null}
          {!argLines.length ? <Text color={C.dim}>(no arguments)</Text> : null}
          <Text color={C.dim} wrap="truncate-end">{req.mcp.runs === 'address' ? `a service at ${String(req.mcp.where ?? '').split(' · ')[0]}` : `a program on this Mac (${req.mcp.where ?? 'its server'})`}{req.mcp.says ? <Text color={C.faint}> · the server says: {req.mcp.says}</Text> : null}</Text>
        </Box>
      ) : req.name === 'McpProject' ? (
        <Box flexDirection="column" paddingX={2} marginY={1}>
          <Text wrap="truncate-end">.agentic/mcp.json in {app.cwdShort}{req.changed ? <Text color={C.warn}> · changed since you allowed it</Text> : null}</Text>
          {req.servers.slice(0, Math.max(1, Math.floor((room - 5) / 2))).map((s) => (
            <React.Fragment key={s.name}>
              <Text wrap="truncate-end"><Text bold>{s.name.padEnd(12)}</Text>{s.line}</Text>
              <Text color={C.dim} wrap="truncate-end">{' '.repeat(12)}{s.where}</Text>
            </React.Fragment>
          ))}
          <Text color={C.dim} wrap="truncate-end">A server is a program: it runs on this Mac with what its sandbox allows.</Text>
        </Box>
      ) : req.name === 'HooksProject' ? (
        <Box flexDirection="column" paddingX={2} marginY={1}>
          <Text wrap="truncate-end">.agentic/hooks.json in {app.cwdShort}{req.changed ? <Text color={C.warn}> · changed since you said yes</Text> : null}</Text>
          {req.hooks.slice(0, Math.max(1, room - 5)).map((h, i) => (
            <Text key={i} wrap="truncate-end"><Text bold>{`${h.when}${h.for ? ` · ${h.for}` : ''}`.padEnd(30)}</Text>{h.command}</Text>
          ))}
          {req.hooks.length > Math.max(1, room - 5) ? <Text color={C.dim}>… +{req.hooks.length - Math.max(1, room - 5)} more</Text> : null}
          <Text color={C.dim} wrap="truncate-end">A hook is a command: it runs as you, with no sandbox, at the moment it names.</Text>
        </Box>
      ) : req.name === 'Ask' ? (
        <AskBox app={app} />
      ) : req.name === 'Bash' ? (
        <Box flexDirection="column" paddingX={2} marginY={1}>
          <Text>{cmdLines.length > room - 3 ? `${cmdLines.slice(0, room - 4).join('\n')}\n… +${cmdLines.length - (room - 4)} lines` : req.args.command}</Text>
          <Text color={C.dim} wrap="truncate-end">{req.args.description ? `${req.args.description} · ` : ''}in {fitPath(app.cwdShort, Math.max(20, width - 12 - (req.args.description ? req.args.description.length + 3 : 0)))}</Text>
        </Box>
      ) : req.name === 'Screen' ? (
        <Box flexDirection="column" paddingX={2} marginY={1}>
          <Text wrap="truncate-end">{screenWhat(req.args)}</Text>
          <Text color={C.dim} wrap="truncate-end">a picture, sent to {app.modelState?.remote ? `${app.modelState.name} on ${app.modelState.where}` : 'the model on this Mac'} · it only looks: nothing is clicked or typed</Text>
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
          <Diff hunk={shownHunk} width={side ? leftW - 4 : diffW(width) - 4} />
          {hunk.length > shownHunk.length ? <Text color={C.dim}>… +{hunk.length - shownHunk.length} more lines</Text> : null}
        </Box>
      )
  );
  const choices = req.name === 'Ask' ? null : perm.options.map((o, i) => (
    <Text key={i} color={i === perm.selected ? C.ask : undefined}>{i === perm.selected ? '❯' : ' '} {i + 1}. {o.label ?? o}</Text>
  ));
  const notes = (
    <>
      {req.protectedBy ? <Text color={C.warn}>Protected: {req.protectedBy} always asks before a change, even in Accept edits and Auto.</Text> : null}
      {req.autoReason ? <Text color={C.auto} wrap="truncate-end">Auto asks you: {req.autoReason}</Text> : null}
      {req.mcp?.changed ? <Text color={C.warn} wrap="truncate-end">This tool changed since you allowed it: its description or its arguments are not what they were.</Text> : null}
      {req.mcp?.note ? <Text color={C.warn} wrap="truncate-end">{req.mcp.note}</Text> : null}
    </>
  );
  const ask = (
    <>
      {req.name === 'Ask' ? null
        : req.name === 'Bash' ? <Text>Do you want to proceed?</Text>
        : req.name === 'WebSearch' ? <Text>Search the web for this?</Text>
        : req.name === 'WebFetch' ? <Text>Read this page from <Text bold>{String(req.rule ?? '').replace(/^WebFetch\((.*)\)$/, '$1')}</Text>?</Text>
        : req.name === 'Screen' ? <Text>Let the model look at <Text bold>{String(req.args?.app ?? '').trim() || 'the whole screen'}</Text>?</Text>
        : req.name === 'Mcp' ? <Text>Let <Text bold>{req.mcp.server}</Text> run <Text bold>{req.mcp.tool}</Text>?</Text>
        : req.name === 'McpProject' ? <Text>Start this project’s server{req.servers.length === 1 ? '' : 's'}?</Text>
        : req.name === 'HooksProject' ? <Text>{req.running ? 'Stop this project’s hooks?' : 'Run this project’s hooks?'}</Text>
        : req.name === 'Rename' ? <Text>Rename <Text bold>{req.args.from}</Text> to <Text bold>{req.args.to}</Text>: {req.prepared.total} use{req.prepared.total === 1 ? '' : 's'} in {req.prepared.files.length} file{req.prepared.files.length === 1 ? '' : 's'}?</Text>
        : req.name === 'Test' ? <Text>Use this test to decide when the change is done? <Text color={C.dim}>(it fails today, as it should)</Text></Text>
        : <Text>Do you want to {req.name === 'Write' && req.prepared.created ? 'create' : 'make this edit to'} <Text bold>{req.prepared.rel}</Text>?</Text>}
    </>
  );
  return (
    <Box borderStyle="round" borderColor={C.ask} flexDirection="column" paddingX={1} width={width}>
      <Text bold color={C.ask}>{title}{req.helper ? <Text color={C.dim}>  · asked by the {req.helper} helper</Text> : null}{req.kind === 'mcp' ? <Text color={C.dim}>  · while {req.tool} runs · your answer goes to that server</Text> : null}</Text>
      {side ? (
        // a wide window (7 Oct 2026, "3 · Launcher"): the change on the left, the question beside it
        <Box>
          <Box width={leftW} flexShrink={0} flexDirection="column">{what}</Box>
          <Box flexDirection="column" paddingLeft={2} marginTop={1} flexGrow={1}>{ask}<Text> </Text>{choices}</Box>
        </Box>
      ) : null}
      {side ? notes : <>{what}{notes}{ask}{choices}</>}
    </Box>
  );
}

// The question box (9 Oct 2026, the owner's pick "2 · Claude Code box"; its keys: app-ask.mjs).
// The model's questions as tabs (← ☐ Git guide ☐ Who gets it ✔ Submit →), the question, then each
// choice with what it means under it, "(recommended)" beside one, [ ] boxes where several may be
// ticked, and the row you type into, on one line that scrolls with the cursor. Every page is as tall
// as the tallest, so the box never moves as you go; a window too short for every about line gets the
// compact look (3 Oct 2026): one line a choice and the one you are on said under the list.
function AskBox({ app }) {
  const { perm, width } = app;
  const box = perm.ask ?? askState(perm.req);
  const n = box.tabs.length;
  const multi = n > 1;
  const inner = Math.max(20, width - 4);
  const step = !multi && perm.req.args?.step;
  const qLines = (t) => wrap(`${t.q.question ?? ''}${step ? `   (${step.at} of ${step.of})` : ''}`, inner);
  const lead = (t) => 5 + (t.ticks ? 4 : 0); // "❯ 1. " and "[ ] "
  const abouts = (t, o) => (o.about ? wrap(o.about, Math.max(10, inner - lead(t))) : []);
  const pageFull = (t) => qLines(t).length + 1 + t.options.reduce((sum, o) => sum + 1 + abouts(t, o).length, 0);
  const aboutTall = (t) => Math.max(1, ...t.options.map((o) => (o.about ? wrap(`ⓘ ${o.about}`, inner - 2).length : 0)));
  const pageCompact = (t) => qLines(t).length + 1 + t.options.length + 1 + aboutTall(t);
  const said = (t) => (t.answer == null ? [] : wrap(`→ ${t.answer}`, inner - 2).slice(0, 2));
  const pageSubmit = 2 + box.tabs.reduce((sum, t) => sum + 1 + Math.max(1, said(t).length), 0) + 2 + (box.tabs.some((t) => t.answer == null) ? 1 : 0);
  const tallest = (page) => Math.max(...box.tabs.map(page), multi ? pageSubmit : 0);
  // The title, the tabs, a blank row, the page, a blank row, the hint and the border.
  const compact = 2 + 1 + (multi ? 1 : 0) + 1 + tallest(pageFull) + 2 > app.rows - 4;
  const height = tallest(compact ? pageCompact : pageFull);
  const t = box.tabs[box.at];
  const onType = t && t.options[t.selected]?.choice === 'type';
  const hint = !t ? 'Enter send · ← back to the questions · Esc stop'
    : onType ? `Type your answer · Enter ${multi ? 'next' : 'done'} · ↑/↓ move · ${multi ? 'Tab question · ' : ''}Esc stop`
    : t.ticks ? `Space tick · Enter ${multi ? 'next' : 'done'} · ${multi ? '←/→ question' : '↑/↓ move'} · Esc stop`
    : 'Enter pick · ↑/↓ move · Esc stop';
  const lines = [];
  if (!t) {
    lines.push(<Text key="r" bold>Review your answers</Text>, <Text key="r0"> </Text>);
    box.tabs.forEach((x, i) => {
      lines.push(<Text key={`q${i}`} color={C.dim} wrap="truncate-end">● {x.q.question}</Text>);
      if (x.answer == null) lines.push(<Text key={`a${i}`} color={C.warn} wrap="truncate-end">  → not answered yet</Text>);
      else said(x).forEach((l, k) => lines.push(<Text key={`a${i}-${k}`} wrap="truncate-end">  {l}</Text>));
    });
    lines.push(<Text key="s0"> </Text>, <Text key="s" color={C.ask}>❯ Submit answers</Text>);
    const left = box.tabs.filter((x) => x.answer == null).length;
    if (left) lines.push(<Text key="w" color={C.dim} wrap="truncate-end">{left} not answered: {left === 1 ? 'it goes' : 'they go'} as skipped</Text>);
  } else {
    qLines(t).forEach((l, k) => lines.push(<Text key={`q${k}`} bold wrap="truncate-end">{l}</Text>));
    lines.push(<Text key="q-"> </Text>);
    t.options.forEach((o, i) => {
      const on = i === t.selected;
      const typed = t.typed.value;
      const tick = t.ticks ? ((o.choice === 'type' ? typed.trim() : t.ticked.includes(i)) ? '[✔] ' : '[ ] ') : '';
      const head = `${on ? '❯' : ' '} ${i + 1}. ${tick}`;
      if (o.choice === 'type' && (on || typed)) {
        const label = `${typeLabel(o)}: `;
        const f = fieldView(typed, t.typed.cursor, Math.max(4, inner - head.length - label.length));
        lines.push(<Text key={`o${i}`} color={on ? C.ask : undefined} wrap="truncate-end">{head}{label}<Text color={on ? undefined : C.dim}>{f.before}</Text>{on ? <Text inverse>{f.at}</Text> : <Text color={C.dim}>{f.at}</Text>}<Text color={on ? undefined : C.dim}>{f.after}</Text></Text>);
      } else {
        lines.push(<Text key={`o${i}`} color={on ? C.ask : undefined} wrap="truncate-end">{head}{o.label}{o.recommended ? <Text color={C.dim}>  (recommended)</Text> : null}</Text>);
      }
      if (!compact) abouts(t, o).forEach((l, k) => lines.push(<Text key={`o${i}-${k}`} color={C.dim} wrap="truncate-end">{' '.repeat(lead(t))}{l}</Text>));
    });
    if (compact) {
      const about = t.options[t.selected]?.about;
      lines.push(<Text key="i-"> </Text>);
      const info = about ? wrap(`ⓘ ${about}`, inner - 2) : [];
      for (let k = 0; k < aboutTall(t); k++) lines.push(<Text key={`i${k}`} color={C.dim} wrap="truncate-end">  {info[k] ?? ''}</Text>);
    }
  }
  while (lines.length < height) lines.push(<Text key={`pad${lines.length}`}> </Text>);
  return (
    <Box flexDirection="column" marginTop={multi ? 0 : 1}>
      {multi ? <AskTabs box={box} inner={inner} /> : null}
      {multi ? <Text> </Text> : null}
      {lines}
      <Text> </Text>
      <Text color={C.dim} wrap="truncate-end">{hint}</Text>
    </Box>
  );
}

// The tabs: ☐ a question not answered, ✔ one answered, the one you are on lit; too wide for the
// window, "← Question 2 of 4 · 1 answered →".
function AskTabs({ box, inner }) {
  const n = box.tabs.length;
  const done = box.tabs.filter((t) => t.answer != null).length;
  const wide = 4 + box.tabs.reduce((sum, t) => sum + t.header.length + 4, 0) + 10;
  if (wide > inner) {
    return <Text wrap="truncate-end"><Text color={C.dim}>← </Text><Text bold>{box.at === n ? 'Submit' : `Question ${box.at + 1} of ${n}`}</Text><Text color={C.dim}> · {done} answered →</Text></Text>;
  }
  return (
    <Text wrap="truncate-end">
      <Text color={C.dim}>← </Text>
      {box.tabs.map((t, i) => (
        <Text key={i} inverse={i === box.at}> {t.answer != null ? <Text color={i === box.at ? undefined : C.ok}>✔</Text> : '☐'} {t.header} </Text>
      ))}
      <Text inverse={box.at === n}> ✔ Submit </Text>
      <Text color={C.dim}> →</Text>
    </Text>
  );
}

// What the row you type into shows of your answer: all of it, or as much as fits around the cursor
// (an … where some is cut off), and the letter under the cursor.
function fieldView(value, cursor, room) {
  const s = `${value} `;
  const start = s.length <= room ? 0 : Math.min(Math.max(0, cursor - room + 2), s.length - room);
  let shown = s.slice(start, start + room);
  if (start > 0) shown = `…${shown.slice(1)}`;
  if (start + room < s.length && cursor - start < room - 1) shown = `${shown.slice(0, -1)}…`;
  const at = cursor - start;
  return { before: shown.slice(0, at), at: shown[at] ?? ' ', after: shown.slice(at + 1) };
}

// A thin rule with a name in it: ── Commands · 22 · type to filter ──────
const NamedRule = ({ name, more = '', width }) => <Text color={C.faint} wrap="truncate-end">── <Text color={C.dim}>{name}</Text>{more ? <Text color={C.faint}> · {more}</Text> : null} {'─'.repeat(Math.max(2, width - 5 - name.length - (more ? more.length + 3 : 0)))}</Text>;
// The / menu as a list and a card (7 Oct 2026, the owner's pick "3 · Launcher"): the names on the
// left, the command you are on in full on the right, with what enter does.
// The card of the command you are on: its name, what it does, what enter does.
function menuCard(menu, width) {
  const on = menu.items[menu.index] ?? menu.items[0];
  const leftW = Math.max(16, (menu.pad ?? 14) + 3);
  const rightW = Math.max(20, width - 4 - leftW);
  const how = on?.picker ? 'enter opens its menu' : on?.takesArg ? 'enter, then type what it needs' : 'enter runs it';
  return { on, leftW, rightW, lines: [['label', on?.label], ['gap'], ...wrap(on?.desc ?? '', rightW - 3).map((l) => ['desc', l]), ['gap'], ['how', `${how} · tab fills it in`]] };
}
// Its rows (App counts them for the page above it): the list or the card, whichever is taller,
// within the rows the menu has.
export function menuHeight(menu, width) {
  const most = menu.rows ?? MENU_ROWS;
  if (menu.kind !== 'slash') return Math.min(most, menu.items.length);
  return Math.min(most, Math.max(menu.items.length, menuCard(menu, width).lines.length));
}
function MenuSplit({ app }) {
  const { menu, width } = app;
  const tall = menuHeight(menu, width);
  const start = Math.max(0, Math.min(menu.index - 5, menu.items.length - tall));
  const shown = menu.items.slice(start, start + tall);
  const { on, leftW, rightW, lines } = menuCard(menu, width);
  // short of rows, the card keeps the name and the description; the gaps and "enter …" go first
  const fit = lines.length <= tall ? lines : lines.filter(([k]) => k === 'label' || k === 'desc').slice(0, tall);
  const card = fit.map(([k, t]) => (k === 'label' ? <Text bold color={C.accent}>{t}</Text> : k === 'how' ? <Text color={C.dim}>{t}</Text> : <Text>{t ?? ' '}</Text>));
  return (
    <Box flexDirection="column" paddingX={2}>
      <Box>
        <Box flexDirection="column" width={leftW} flexShrink={0}>
          {shown.map((m, i) => { const sel = start + i === menu.index; return <Text key={m.label} color={sel ? C.accent : undefined} bold={sel} wrap="truncate-end">{sel ? '❯ ' : '  '}{m.label}</Text>; })}
        </Box>
        <Box flexDirection="column" borderStyle="single" borderTop={false} borderRight={false} borderBottom={false} borderColor={C.faint} paddingLeft={2} width={rightW} height={tall}>
          {card.map((el, i) => React.cloneElement(el, { key: i, wrap: 'truncate-end' }))}
        </Box>
      </Box>
    </Box>
  );
}
function Menu({ app }) {
  const { menu } = app;
  if (!menu || !menu.items.length) return null;
  if (menu.kind === 'slash') return <MenuSplit app={app} />;
  const SHOW = menu.rows ?? MENU_ROWS; // a taller window holds more (App.jsx)
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
  ['↑ ↓ for earlier prompts', '⌥a to select all · delete clears it'],
  ['click or drag to move or select', 'ctrl+z to undo · ctrl+y to redo'],
  ['ctrl+t to start or stop the model', 'or click its label'],
];
// On a remote nothing loads on this Mac: ctrl+t opens the model list, and the keys for big
// models join it (remote-footer.mjs, 2 Oct 2026).
const REMOTE_SHORTCUTS = [
  ...SHORTCUTS.slice(0, -1),
  ['ctrl+t to switch the model', 'ctrl+r for a second opinion now'],
  ['ctrl+p to compact now', '/meters for the whole server line'],
];
export const shortcutsOf = (remote) => (remote ? REMOTE_SHORTCUTS : SHORTCUTS);
// Rows the shortcuts take under the footer (? opens them).
export const shortcutRows = (remote) => shortcutsOf(remote).length + 1;

// The model's label on the footer's right, longest first (a narrow window takes a shorter one).
// modelState: { state: off · loading · on, name, gb }; null for a server given with --url.
// ctrl+t switches it, and so does a click on it (/mouse on).
// A remote (remote: true): the model and where it runs, as it connects, loads there,
// reconnects or stops answering; a click on it opens /model.
export function modelLabels(ms) {
  if (!ms) return [];
  if (ms.remote) {
    const { name, where } = ms;
    if (ms.state === 'connecting') return [`◐ connecting to ${where}…`, '◐ connecting…', '◐'];
    if (ms.state === 'reconnecting') return [`◐ reconnecting to ${where}…`, '◐ reconnecting…', '◐'];
    if (ms.state === 'down') return [`✗ ${where} is not answering`, '✗ not answering', '✗'];
    if (ms.state === 'loading') return [`◐ ${name} loading on the service${ms.gb ? ` · ${ms.gb.toFixed(1)} GB` : ''}`, `◐ ${name} loading`, '◐ loading'];
    // The profile the conversation is on (App.jsx profileTag), when profiles route it.
    const p = ms.profile ? `${ms.profile} · ` : '';
    return [`● ${p}${name} on ${where}`, `● ${p}${name}`, '● remote'];
  }
  if (ms.state === 'off') return ['○ model off · ctrl+t start', '○ model off · ctrl+t', '○ off'];
  if (ms.state === 'loading') return [`◐ ${ms.name} loading · ctrl+t stop`, '◐ loading · ctrl+t stop', '◐ loading'];
  const gb = ms.gb ? ` · ${ms.gb.toFixed(1)} GB` : '';
  return [`● ${ms.name}${gb} · ctrl+t stop`, `● ${ms.name} · ctrl+t stop`, '● on · ctrl+t stop', '● on'];
}

// The footer's pieces, worked out once for the drawing and for a click on the model's label
// (App.jsx). The right side ends two cells from the window's edge; a narrow window drops the
// label's detail first, then the Mac's memory. The mode is its short name (MODE_SHORT), with no
// "(shift+tab to cycle)": the owner's pick "1 · Tidy", 9 Oct 2026. On a remote it is remoteParts
// below: gauges, no Mac.
// labelAt: the label's first and last cell on the footer's row, counted from 1.
export function footerParts(app) {
  const { mode, notice, width } = app;
  // Until your first message a tip sits here (start.jsx); the start page's steps say what the
  // start waits for.
  const tip = app.tip ?? null;
  const left = notice ?? (app.inputMode === 'bash' ? '! shell mode: runs the command yourself' : tip ? `※ Tip: ${tip}` : '? for shortcuts');
  // The update and weights badges share the lower right with the mode label; so does "⇄ on <this
  // Mac>" while another Mac has a window on this session (App.jsx).
  // (Loops made in this window come first: "↻ 2 loops · 1 needs you", App.jsx.)
  const badges = [app.loopsBadge, app.shareBadge, app.updateBadge, app.weightsBadge].filter(Boolean).join('  ');
  if (app.modelState?.remote) return remoteParts(app, left, badges);
  // The Mac's memory, live, after the model's label.
  const mac = app.mac ? footerLabel(app.mac) : '';
  const modeText = MODE_SHORT[mode] ?? '';
  const room = width - 4 - Math.min(left.length, 15) - 2;
  const labels = modelLabels(app.modelState);
  const ls = labels.length ? labels : [''];
  const tries = [
    ...ls.map((label) => ({ label, mac })),
    ...ls.map((label) => ({ label, mac: '' })),
  ];
  // The cost meter (/remote, spend.mjs) leads the right side while it fits, and goes first when it does not.
  const spend = app.spend ?? '';
  const all = spend ? [...tries.map((t) => ({ ...t, spend })), ...tries] : tries;
  const textOf = (t) => [t.spend, t.label, t.mac && `● ${t.mac}`, badges, modeText].filter(Boolean).join(' · ');
  const pick = all.find((t) => textOf(t).length <= room) ?? all.at(-1);
  const from = width - 2 - textOf(pick).length + 1;
  const lead = pick.spend ? pick.spend.length + 3 : 0; // the label starts after the cost meter and its " · "
  return { left: wholeTip(app, left, textOf(pick)), spend: pick.spend ?? '', label: pick.label, mac: pick.mac, badges, labelAt: pick.label ? { from: from + lead, to: from + lead + pick.label.length - 1 } : null };
}

// A tip shows whole or not at all: one that does not fit beside the right side gives its place to
// "? for shortcuts" (a cut tip read "ctrl+b sends this windo…").
function wholeTip(app, left, right) {
  if (!app.tip || app.notice || app.inputMode === 'bash') return left;
  return left.length + 2 + right.length <= app.width - 4 ? left : '? for shortcuts';
}

// On a remote (remote-footer.mjs): no Mac's memory, which holds no model then, and no cost meter
// (/meters has it). Once the first answer has a speed, gauges take the left side, unless a note,
// a tip or shell mode is there; the right is the model, where it runs and the mode. On the Claude
// API with its usage line, the model's name goes alone: the line under it is the Claude API's.
function remoteParts(app, left, badges) {
  const { width, mode } = app;
  const ms = app.modelState;
  const modeText = MODE_SHORT[mode] ?? '';
  const labels = modelLabels(ms);
  const near = app.usage && ms.state === 'on' ? labels[1] : labels[0];
  const rightOf = (label) => [label, badges, modeText].filter(Boolean).join(' · ');
  const list = gaugesOf(app.gaugeList);
  const quiet = !app.notice && app.inputMode !== 'bash' && !app.tip;
  const g = ms.state === 'on' && quiet && app.gauges && gaugeLine(app.gauges, list).length ? app.gauges : null;
  let label, gauges = null;
  if (g) {
    const f = fitRemote({ avail: width - 4, g, list, right: ({ where, bare }) => rightOf(bare ? labels[2] : where ? near : labels[1]) });
    label = f.bare ? labels[2] : f.where ? near : labels[1];
    gauges = f.gauges.length ? f.gauges : null;
  } else {
    const room = width - 4 - Math.min(left.length, 15) - 2;
    const tries = [near, ...labels.slice(1)];
    label = tries.find((l) => rightOf(l).length <= room) ?? tries.at(-1);
  }
  const from = width - 2 - rightOf(label).length + 1;
  return { left: wholeTip(app, left, rightOf(label)), gauges, spend: '', label, mac: '', badges, labelAt: { from, to: from + label.length - 1 } };
}

const WHITE = 'ansi256(255)'; // the start page's white (start.jsx)
// A row of usage-bar.mjs's pieces ({ t, fg, bg, b }, colours as xterm-256 numbers), one cell each.
function Segs({ segs }) {
  return <Text wrap="truncate-end">{segs.map((s, i) => <Text key={i} color={`ansi256(${s.fg})`} backgroundColor={s.bg == null ? undefined : `ansi256(${s.bg})`} bold={s.b}>{s.t}</Text>)}</Text>;
}
// /usage (app-slash.mjs): the card over the prompt, live while it is open; esc closes it.
function UsagePanel({ app }) {
  if (!app.usage) return null;
  return <Box flexDirection="column" width={app.width}>{usagePanel(app.usage, app.width, { now: app.now, live: app.usageLive, asking: app.picker?.asking }).map((r, i) => <Segs key={i} segs={r} />)}</Box>;
}
// The gauges' tones (remote-footer.mjs) as colours.
const TONE = { dim: C.dim, value: WHITE, live: C.accent, bar: C.accentDim, warn: C.warn, bad: C.bad };

// The footer's rows, inside the prompt box under its dotted rule (the owner's pick "Panel", 8 Oct
// 2026: "more uniform … even spacing between edges and borders"): the prompt, the footer and the Claude
// API's usage line share one frame, each row one cell in from its border, so every row starts and
// ends in the same columns. Tidied on 9 Oct 2026 (the owner's pick "1 · Tidy"): each row is words on
// the left and words on the right, ending on the same column, with the usage line's line between its
// words; the box's bottom edge is the window's last row (patches/ink@7.1.1.patch). An open menu takes
// the footer's place, as in Claude Code: the box closes under the prompt and the menu sits under it.
const footInBox = (app) => !app.menu?.items?.length;
function FooterRows({ app, border }) {
  const { mode, notice, width } = app;
  const p = footerParts(app);
  const ms = app.modelState;
  const on = ms?.state === 'on';
  // A remote's dot: blue (the app's own) when on, orange while it connects or loads, red when it does not answer;
  // the model's name stands out from where it runs.
  const dot = on ? C.accent : !ms?.remote ? C.dim : ms.state === 'down' ? C.bad : C.warn;
  const named = ms?.remote && on && p.label.startsWith(`● ${ms.name}`);
  // A remote that does not answer says so in red, not only its dot.
  const down = ms?.remote && ms.state === 'down';
  const pieces = [
    p.spend ? <Text color={C.dim}>{p.spend}</Text> : null,
    p.label ? <Text color={down ? C.bad : C.dim}><Text color={dot}>{p.label[0]}</Text>{named ? <><Text> </Text><Text color={WHITE}>{ms.name}</Text>{p.label.slice(2 + ms.name.length)}</> : p.label.slice(1)}</Text> : null,
    p.mac ? <Text color={C.dim}><Text color={PRESSURE_COLOR[pressureWord(app.mac)]}>●</Text> {p.mac}</Text> : null,
    p.badges ? <Text color={C.accent}>{p.badges}</Text> : null,
    modeLabel(mode, { short: true }),
  ].filter(Boolean);
  const inner = width - 4;
  return (
    <Box flexDirection="column">
      {/* The rule across the box, from border to border (├╌╌┤): drawn over the box's sides. */}
      <Box marginLeft={-2} width={width} height={1}><Text color={border}>{`├${'╌'.repeat(Math.max(0, width - 2))}┤`}</Text></Box>
      <Box width={inner} justifyContent="space-between" height={1} overflow="hidden">
        {/* A long left side (a tip) is cut to what is left; the right side stays whole, two spaces clear of it. */}
        <Box flexShrink={1} marginRight={2}>
          {p.gauges
            ? <Text wrap="truncate-end">{p.gauges.map((s, i) => <Text key={i} color={TONE[s.tone]}>{s.text}</Text>)}</Text>
            : <Text color={notice ? C.warn : C.dim} wrap="truncate-end">{p.left}</Text>}
        </Box>
        <Box flexShrink={0}><Text wrap="truncate-start">{pieces.map((el, i) => <React.Fragment key={i}>{i ? <Text color={C.dim}> · </Text> : null}{el}</React.Fragment>)}</Text></Box>
      </Box>
      {/* On the Claude API, what is left of the month under the footer: the same ends as the footer's row (usage-bar.mjs). */}
      {app.usage ? <Box width={inner} height={1} overflow="hidden"><Segs segs={usageRow(app.usage, inner, { now: app.now, live: app.usageLive })} /></Box> : null}
    </Box>
  );
}
// Under the box: the shortcuts, while ? shows them.
function Footer({ app }) {
  if (!footInBox(app) || !app.showShortcuts) return null;
  return (
    <Box flexDirection="column">
      {app.showShortcuts ? (
        <Box flexDirection="column" paddingX={2} marginTop={1}>
          {shortcutsOf(app.modelState?.remote).map(([a, b], i) => <Text key={i} color={C.dim}>{a.padEnd(36)}{b}</Text>)}
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
      {footInBox(app) ? <FooterRows app={app} border={border} /> : null}
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

// /mode (and /permissions' start-up mode): the five modes as Claude Code's menu draws
// them: the name (Auto with its Recommended tag) over what it does, the number on the
// right, ✓ by the one in use. Bypass is red: nothing asks in it.
function ModePicker({ app }) {
  const pk = app.picker;
  const inner = app.width - 4; // the border and one space each side
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      <Text bold>{pk.title}</Text>
      <Text color={C.dim} wrap="truncate-end">{pk.blurb}</Text>
      <Text> </Text>
      {pk.options.map((o, i) => {
        const on = i === pk.index;
        const cur = o.id === pk.current;
        return (
          <Box key={o.id} flexDirection="column">
            <Box width={inner} justifyContent="space-between">
              <Text>
                <Text color={on ? C.accent : undefined} bold={on}>{on ? '❯' : ' '} </Text>
                <Text color={o.id === 'bypass' ? C.bypass : on ? C.accent : undefined} bold={on}>{o.label}</Text>
                {o.recommended ? <Text>  <Text backgroundColor="ansi256(238)" color="ansi256(252)"> Recommended </Text></Text> : null}
              </Text>
              <Text>{cur ? <Text color={C.ok}>✓ </Text> : null}<Text color={C.dim}>{i + 1}</Text></Text>
            </Box>
            <Text color={C.dim} wrap="truncate-end">  {o.note}</Text>
          </Box>
        );
      })}
      <Text> </Text>
      <Text color={C.dim}>↑↓ to choose · a number or enter to select · esc to go back</Text>
    </Box>
  );
}

// /mode and /meters alone: their choices as a menu, like Claude Code's.
// The ❯ starts on the one in use; ↑↓ or a number, enter picks, esc goes back.
function ChoicePicker({ app }) {
  const pk = app.picker;
  if (pk.id === 'mode' || pk.id === 'startmode') return <ModePicker app={app} />;
  // A question the app asks for itself (ask: true), drawn as the model's questions are (AskChoices):
  // one line a choice, "(recommended)" beside one, what the highlighted one means under the list.
  if (pk.ask) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={C.ask} paddingX={1} width={app.width}>
        <Text>{pk.title}</Text>
        {pk.options.map((o, i) => {
          const on = i === pk.index;
          return <Text key={o.id} color={on ? C.ask : undefined}>{on ? '❯' : ' '} {i + 1}. {o.label}{o.recommended ? <Text color={C.dim}>  (recommended)</Text> : null}</Text>;
        })}
        <Box marginTop={1} paddingX={2}><Text color={C.dim}>{pk.options[pk.index]?.note ? `ⓘ ${pk.options[pk.index].note}` : ''}</Text></Box>
        <Box marginTop={1}><Text color={C.dim}>Enter pick · ↑/↓ move · Esc {pk.escWord ?? 'go back'}</Text></Box>
      </Box>
    );
  }
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

// /jumptomac alone: "Jump to a Mac" (jump-box.mjs; Design 2 of the 3 Oct round): the saved Macs, the ones only
// Tailscale knows, "+ Add a Mac", each with what Tailscale says, and the line under them.
function JumpPicker({ app }) {
  const pk = app.picker;
  const rows = jumpRows(pk);
  const at = Math.min(pk.index, rows.length - 1);
  const info = jumpInfo(pk);
  const tone = { on: C.accent, off: C.dim, dim: C.dim };
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      <Box justifyContent="space-between">
        <Text bold>Jump to a Mac</Text>
        <Text color={C.dim} wrap="truncate-start">{pk.here ? `from ${pk.here}` : ''}</Text>
      </Box>
      <Text color={C.dim} wrap="truncate-end">Its sessions open in this window; this one keeps running, and {DETACH_LABEL} there comes back.</Text>
      <Text> </Text>
      {rows.map((r, i) => {
        const on = i === at;
        const typing = r.add && pk.adding !== null;
        return (
          <Text key={r.name} wrap="truncate-end">
            <Text color={on ? C.accent : undefined} bold={on}>{on ? '❯' : ' '} {r.name.padEnd(19)}</Text>
            {typing ? <><Text>{pk.adding}</Text><Text inverse> </Text><Text>{'   '}</Text></> : null}
            {rowStatus(pk, r).map((x, j) => <Text key={j} color={tone[x.tone]}>{x.text}</Text>)}
          </Text>
        );
      })}
      <Text> </Text>
      <Box paddingX={2}><Text color={info.tone === 'warn' ? C.warn : C.dim} wrap="truncate-end">ⓘ  {info.text}</Text></Box>
      <Text color={C.dim} wrap="truncate-end">{pk.adding !== null ? 'type the Mac’s Tailscale name · enter tries it · esc stops' : 'enter jumps · ↑↓ choose · ⌫ forgets a saved Mac · esc cancels'}</Text>
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
  const all = pk.groups.flatMap((g) => g.rows);
  const on = all[pk.index];
  const lw = Math.max(...all.map((r) => r.label.length)) + 2;
  const vw = Math.min(26, Math.max(...all.map((r) => r.value.length)) + 2);
  const leftW = 2 + lw + vw;
  const rightW = Math.max(20, app.width - 4 - leftW);
  // 22 rows: the rule, then each group's heading and rows; a short window (24 rows, with the status
  // bar or the memory note under it) drops the last group's heading (its rows follow the ones above)
  const under = app.meters || memoryWarning(app.stats.ctxUsed ?? 0, app.ctx, app.stats.replyRoom ?? 0) ? 1 : 0;
  const noLastHead = all.length + pk.groups.length + 1 + under + 1 > app.rows;
  const blurb = all.length + pk.groups.length + 2 + under + 1 <= app.rows;
  return (
    <Box flexDirection="column" paddingX={2}>
      <NamedRule name={pk.title ?? 'Settings'} more="↑↓ choose · enter open · esc back" width={app.width - 4} />
      {blurb ? <Text color={C.dim} wrap="truncate-end">{pk.blurb ?? 'Everything not in the / menu. Each still works typed in full, like /doctor.'}</Text> : null}
      <Box>
        <Box flexDirection="column" width={leftW} flexShrink={0}>
          {pk.groups.flatMap((g, gi) => [
            ...(noLastHead && gi === pk.groups.length - 1 ? [] : [<Text key={g.group} bold color={C.dim}>{g.group.split(' · ')[0]}</Text>]),
            ...g.rows.map((r) => {
              const sel = r === on;
              return <Text key={r.name} wrap="truncate-end"><Text color={sel ? C.accent : undefined} bold={sel}>{sel ? '❯ ' : '  '}{r.label.padEnd(lw)}</Text><Text color={sel ? C.accent : C.dim}>{r.value.length > vw - 1 ? `${r.value.slice(0, vw - 2)}…` : r.value}</Text></Text>;
            }),
          ])}
        </Box>
        <Box flexDirection="column" borderStyle="single" borderTop={false} borderRight={false} borderBottom={false} borderColor={C.faint} paddingLeft={2} width={rightW}>
          <Text bold color={C.accent}>{on?.label}</Text>
          <Text color="ansi256(255)">{on?.value}</Text>
          <Text> </Text>
          {wrap(on?.note ?? '', rightW - 3).map((l, i) => <Text key={i}>{l}</Text>)}
          <Text> </Text>
          <Text color={C.dim}>enter opens it</Text>
        </Box>
      </Box>
    </Box>
  );
}
// /effort, one panel: the Effort row, then the search's rows (Embedder,
// Retriever, Reranker) and every limit that can move, each under its heading,
// each value between ◀ ▶ with what it costs. ↻ marks the two that restart
// the model; • a value not saved yet. Thinking cap is dimmed while Effort is Low.
// Eleven limits (Look first last) keep the panel within 22 lines because the keys' hint sits on the
// Reset all line, not a line of its own: it fits a 24-row window (app-effort.test.mjs).
// On an Ollama service the Effort row is Thinking (the model's own choices: Off · On, Off · Max…),
// the Thinking cap is a line saying why it is not there, and the ranks page's values are suggested
// beside the rows (remote-suggested.mjs). /model's menu for one model (pk.own, 2 Oct 2026) is this
// panel with only the rows each model keeps for itself, and a line on why those values are suggested.
function LimitsPicker({ app }) {
  const pk = app.picker;
  const own = pk.own ?? null;
  const svc = Boolean(own || pk.model.remote?.ollama);
  const shown = shownLimits(pk.model, { own: Boolean(own) });
  const sg = pk.suggested ?? null;
  const levels = pk.model.thinkingLevels ?? [];
  const lv = levels[pk.level];
  const off = lv ? 1 : 0; // the Effort row, when the model has levels
  const effortOn = lv ? !!lv.effort : undefined;
  const effortWord = svc ? 'Thinking' : 'Effort';
  const lw = Math.max(...shown.map((l) => l.label.length), off ? effortWord.length : 0, svc ? 'Thinking cap'.length : 0) + 2;
  // Wide enough for every name a search row can show, so the notes do not move.
  const vw = Math.max(...shown.flatMap((l) => (l.choice ? l.steps(pk.model).map((s) => showLimit(l.id, s).length) : [showLimit(l.id, pk.values[l.id]).length])), ...levels.map((l) => l.label.length)) + 1;
  const heading = (name) => <Text key={`h-${name}`} color={C.faint}>{`── ${name} `}{'─'.repeat(Math.max(0, app.width - 8 - name.length))}</Text>;
  const env = { ...pk.env, values: pk.values, effortOn, effortLevel: lv?.effort ?? null, effortWord };
  const pr = own?.profile ?? null; // /model's step 3: a profile's settings (app-profiles.mjs)
  const reset = pk.index === off + shown.length + (pr ? 2 : 0);
  // Its two rows fit 80 × 24 by leaving out three lines there: the Suggested line, the Thinking cap line and the Profile heading.
  const roomy = !pr || (app.rows ?? 24) >= 30;
  const onEffort = off && pk.index === 0;
  const effortUnsaved = pk.level !== pk.savedLevel;
  // What the ranks page suggests for a row: ✓ when it already has it.
  const suggests = (v, want, show) => (want === undefined || want === null ? '' : v === want ? '✓ suggested · ' : `suggested ${show(want)} · `);
  const where = pr ? `${own.id} · enter saves ${pr.name}; the next request that uses it goes there` : own ? (own.inUse ? 'in use · enter saves, from its next step' : 'nothing loads until you press enter') : '←→ moves a row; its cost is on the right. Kept for next time.';
  const keys = pr ? `↑↓ choose · ←→ change${sg ? ' · s suggested' : ''} · enter saves ${pr.name} · esc back` : own ? `↑↓ choose · ←→ change${sg ? ' · s suggested' : ''} · enter ${own.inUse ? 'saves' : 'switches to it'} · esc ${own.back ? 'back to the list' : 'cancels'}`
    : `↑↓ choose · ←→ change${sg ? ' · s suggested' : ''} · enter saves · esc cancels${svc ? '' : ' · ↻ restarts model'}`;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      {/* The hint sits on the title's line: the panel stays within 22 lines with Who decides in it. */}
      <Text wrap="truncate-end"><Text bold>{pr ? `/model · 3 of 3: ${pr.name}’s settings` : own ? `${own.id} · its own settings` : svc ? `Effort and limits · ${pk.model.remote.model}` : 'Effort and limits'}</Text><Text color={C.dim}>{'   '}{where}</Text></Text>
      {own && roomy ? (
        <Text color={C.dim} wrap="truncate-end">{sg ? `Suggested: ${sg.why} · ${sg.source}` : 'Nothing suggested for it on the ranks page: each row starts from the shared settings.'}</Text>
      ) : null}
      {lv ? (
        <>
          <Text wrap="truncate-end">
            <Text color={onEffort ? C.accent : undefined} bold={onEffort}>{onEffort ? '❯' : ' '} {effortWord.padEnd(lw)}</Text>
            <Text color={onEffort && pk.level > 0 ? C.accent : C.faint}>◀ </Text>
            <Text color={effortUnsaved ? C.accent : undefined} bold={effortUnsaved}>{lv.label.padEnd(vw)}</Text>
            <Text color={onEffort && pk.level < levels.length - 1 ? C.accent : C.faint}>▶ </Text>
            <Text color={effortUnsaved ? C.accent : C.faint}>{effortUnsaved ? '•' : ' '}</Text>
            <Text color={C.dim}>{'  '}{suggests(lv.id, sg?.level, (id) => levels.find((l) => l.id === id)?.label ?? id)}{lv.id === defaultLevelId(pk.model) && !svc ? 'default · ' : ''}{effortNote(lv, pk.values.thinking)}</Text>
          </Text>
        </>
      ) : null}
      {shown.map((l, i) => {
        // A heading where a group starts: "Search" over the search's rows, "Limits" over the rest.
        // Who decides (group 'Effort') sits under the Effort row with no heading of its own.
        // On a service /effort says which rows the model keeps for itself.
        const group = l.group ?? 'Limits';
        const title = svc && !own ? 'Limits · this model’s own' : group;
        const head = group !== 'Effort' && (i === 0 || (shown[i - 1].group ?? 'Limits') !== group) ? heading(title) : null;
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
            <Text color={C.dim}>{l.restart && !svc ? '↻ ' : '  '}</Text>
            <Text color={note.startsWith('⚠') ? C.warn : C.dim}>{suggests(v, sg?.limits?.[l.id], (x) => showLimit(l.id, x))}{isDefault(l.id, pk.values, pk.model) ? 'default · ' : ''}{note}</Text>
          </Text>
          {/* Their place on a service: why there is no Thinking cap there (and, in /effort, where the search went). One line, so the panel keeps its 22. */}
          {svc && l.id === 'context' && roomy ? (own
            ? <Text color={C.dim} wrap="truncate-end">{'  '}{'Thinking cap'.padEnd(lw)}{'  '}not on a service: Ollama has no thinking limit, so Reply length holds the thinking and the answer</Text>
            : <Text color={C.dim} wrap="truncate-end">{'  '}{'Not here'.padEnd(lw)}{'  '}Thinking cap: Ollama has none, Reply length holds it all · Search: the service’s own, /profiles gives it a model</Text>) : null}
          </React.Fragment>
        );
      })}
      {pr ? (() => {
        const base = off + shown.length;
        const bk = pr.backups[pr.backup];
        const sp = pr.spills[pr.spill];
        const line = (k, label, value, first, last, note, idle) => {
          const on = pk.index === base + k;
          return (
            <Text key={label} wrap="truncate-end">
              <Text color={on ? C.accent : idle ? C.dim : undefined} bold={on}>{on ? '❯' : ' '} {label.padEnd(lw)}</Text>
              <Text color={on && !first ? C.accent : C.faint}>◀ </Text>
              <Text color={idle ? C.dim : undefined}>{value.padEnd(vw)}</Text>
              <Text color={on && !last ? C.accent : C.faint}>▶ </Text>
              <Text color={C.dim}>{'   '}{note}</Text>
            </Text>
          );
        };
        return (
          <>
            {roomy ? heading(`Profile · ${pr.name}${pr.isNew ? ' (new)' : ''}`) : null}
            {line(0, 'Backup', bk ?? 'none', pr.backup === 0, pr.backup === pr.backups.length - 1, bk ? `when this server is busy or slow, the request goes to ${bk}` : 'no backup: a busy server is waited for, as today')}
            {line(1, 'Spill after', bk ? spillWord(sp) : '—', pr.spill === 0, pr.spill === pr.spills.length - 1, bk ? (sp ? `no first word in ${sp} s → ${bk}; a "busy" answer goes at once` : `only when the server answers "busy"`) : 'needs a backup', !bk)}
          </>
        );
      })() : null}
      <Text wrap="truncate-end">
        <Text color={reset ? C.accent : undefined} bold={reset}>{reset ? '❯' : ' '} {(svc ? 'Use shared' : 'Reset all').padEnd(lw)}</Text>
        <Text color={C.dim}>{'  '}{reset && svc ? `enter: ${own?.id ?? pk.model.remote?.model ?? 'it'} back to the shared settings${own && !own.inUse ? ', then it switches' : ''}` : keys}</Text>
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
  // enter connects from any row once the service has what Connect needs (formReady); the line under
  // the title and the keys' line say so.
  const ready = !web && formReady(pk);
  const save = !web && pk.source !== 'here' && pk.action === 'save';
  // Connect · Save only on one row: the one enter runs is filled in while the row is picked.
  const buttons = (on, tone) => {
    const btn = (t, picked) => <Text color={picked ? (on ? 'ansi256(233)' : tone ?? C.accent) : on ? undefined : C.dim} backgroundColor={picked && on ? tone ?? C.accent : undefined} bold={picked}>{` ${t} `}</Text>;
    return <>{btn('Connect', !save)}<Text>{'  '}</Text>{btn('Save only', save)}<Text>{' '.repeat(Math.max(1, lw + vw - 22))}</Text></>;
  };
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      {web ? <Text bold>Web</Text> : (
        <Box justifyContent="space-between">
          <Text bold>Remote model</Text>
          <Text color={C.dim} wrap="truncate-start">{app.remoteWhere ?? ''}</Text>
        </Box>
      )}
      <Text color={C.dim} wrap="truncate-end">{web ? 'What the model may do on the web. Test checks the key before anything is saved. Kept for every folder.' : pk.source === 'here' ? 'Pick where it runs, fill in its rows, then Connect. Nothing changes unless it works.' : ready ? 'Enter connects from any row. Typing changes the row you are on. Nothing changes unless it works.' : 'Fill in its rows, then Connect. Nothing changes unless it works.'}</Text>
      {ROWS.map((r, i) => {
        const on = i === pk.index;
        const e = pk.editing?.id === r.id ? pk.editing : null;
        const choice = r.type === 'choice' || (!web && r.id === 'model' && modelChoices(pk).length > 1);
        const unsaved = changed(r.id);
        const v = showValueOf(pk, r.id);
        const note = noteOf(pk, r.id);
        const done = r.id === checkRow && pk.test && !pk.test.running && !save;
        const tone = done ? (pk.test.ok ? C.ok : pk.test.needModel ? C.warn : C.bad) : undefined;
        // The last row of a service: the two buttons, then what enter does there (or what Connect found).
        if (!web && r.id === 'go' && pk.source !== 'here') {
          const status = pk.test?.running || done ? v : '';
          return (
            <React.Fragment key={r.id}>
              <Text> </Text>
              <Text wrap="truncate-end">
                <Text color={on ? C.accent : undefined} bold={on}>{on ? '❯' : ' '} </Text>
                {buttons(on, tone)}
                <Text color={tone ?? (pk.test?.running ? C.accent : C.dim)}>{status ? `${status}  ` : ''}{done ? '' : note}</Text>
              </Text>
              {done ? <Box paddingLeft={4}><Text color={tone}>{note}</Text></Box> : null}
            </React.Fragment>
          );
        }
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
      <Text color={C.dim} wrap="truncate-end">{pk.editing ? 'enter keeps it · esc puts it back · paste works · ctrl+u clears' : web ? '↑↓ choose · ←→ change · enter edits a row, runs Test, or saves · esc cancels · the web' : ready && pk.source !== 'here' ? 'enter connects · ↑↓ rows · ←→ change · type to edit a row · esc closes' : !web && pk.source === 'here' ? '↑↓ choose · ←→ change where it runs · enter switches · esc cancels' : modelChoices(pk).length > 1 ? '↑↓ choose · ←→ change · enter on Model opens the list · esc cancels' : '↑↓ choose · ←→ change · enter edits a row or runs it · esc cancels'}</Text>
    </Box>
  );
}

// /mcp (mcp-form.mjs): your MCP servers. The list (each server: connected or not, where it runs,
// its tools), the form for one (as /web's: a choice between ◀ ▶, a text row edited in place, Test
// and Save), and one server's tools with your marks: on or off, and "reads".
// /hooks (hooks-form.mjs): your own hooks above the app's checks, and the form for one of yours.
function HooksPicker({ app }) {
  const pk = app.picker;
  const W = app.width - 4;
  const cut = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, Math.max(0, n - 1))}…` : t; };
  if (pk.view === 'form') {
    const ROWS = hookFormRows(pk);
    const lw = 14, vw = 22;
    const warn = hookWarning(pk);
    const at = ROWS[Math.min(pk.formIndex, ROWS.length - 1)];
    const typing = (e) => {
      const room = Math.max(8, app.width - lw - 12);
      const from = Math.max(0, e.cursor - room + 1);
      return <><Text>{from ? '…' : ''}{e.value.slice(from, e.cursor)}</Text><Text inverse>{e.value[e.cursor] ?? ' '}</Text><Text>{e.value.slice(e.cursor + 1, from + room)}</Text></>;
    };
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
        <Text bold>{pk.at === null ? 'Add a hook' : 'Your hook'}</Text>
        <Text color={C.dim} wrap="truncate-end">A command of yours, run at the moment you pick, as Claude Code's hooks are. Nothing is kept until Save.</Text>
        {ROWS.map((r, i) => {
          const on = i === Math.min(pk.formIndex, ROWS.length - 1);
          const e = pk.editing?.id === r.id ? pk.editing : null;
          const choice = r.type === 'choice';
          const unsaved = r.type !== 'action' && hookRowChanged(pk, r.id);
          const v = showHookValue(pk, r.id);
          const wide = r.type === 'text';
          const done = r.id === 'test' && pk.test && !pk.test.running;
          const tone = done ? (pk.test.ok ? C.ok : C.bad) : undefined;
          return (
            <React.Fragment key={r.id}>
              {r.id === 'test' ? <Text> </Text> : null}
              <Text wrap="truncate-end">
                <Text color={on ? C.accent : undefined} bold={on}>{on ? '❯' : ' '} {r.label.padEnd(lw)}</Text>
                {e ? typing(e) : (
                  <>
                    <Text color={choice ? (on ? C.accent : C.faint) : undefined}>{choice ? '◀ ' : '  '}</Text>
                    <Text color={tone ?? (unsaved ? C.accent : r.type === 'action' ? C.dim : undefined)} bold={unsaved}>{wide ? v : v.padEnd(vw)}</Text>
                    {wide ? null : <Text color={choice ? (on ? C.accent : C.faint) : undefined}>{choice ? '▶ ' : '  '}</Text>}
                    <Text color={unsaved ? C.accent : C.faint}>{unsaved ? ' •' : '  '}</Text>
                    {wide ? null : <Text color={C.dim}> {hookRowNote(pk, r.id)}</Text>}
                  </>
                )}
              </Text>
              {done ? pk.test.lines.map((l, k) => <Box key={k} paddingLeft={lw + 4}><Text color={k === 0 ? tone : C.dim} wrap="truncate-end">{l}</Text></Box>) : null}
            </React.Fragment>
          );
        })}
        <Text> </Text>
        {at?.type === 'text' ? <Text color={C.dim} wrap="wrap">{at.label}: {hookRowNote(pk, at.id)}</Text> : null}
        {warn && (pk.error || at?.id === 'save') ? <Text color={warn.tone === 'error' ? C.bad : C.warn} wrap="wrap">{pk.error ?? warn.text}</Text> : null}
        <Text color={C.dim} wrap="truncate-end">{pk.editing ? 'enter keeps it · esc puts it back · paste works · ctrl+u clears' : '↑↓ choose · ←→ change · enter edits a row, runs Test, or saves · esc back to the list'}</Text>
      </Box>
    );
  }
  const rows = hookListRows(pk);
  const room = Math.max(6, (app.rows ?? 24) - 10);
  const win = rowWindow(rows, Math.min(pk.index, rows.length - 1), room);
  const at = rows[Math.min(pk.index, rows.length - 1)];
  const n = pk.lean ? 'all off: the lean harness (/hooks full brings them back)' : pk.way === 'app' ? 'all on: Who decides is App' : `${pk.checks.size} of ${APP_CHECKS.length} on while the model decides`;
  const mine = pk.yours.length;
  const whenW = 30;
  const hint = at?.check ? 'space on/off · ↑↓ move · esc close'
    : at?.hook && !at.theirs ? 'enter edit · space on/off · t test · d remove · a add · esc close'
      : at?.id === 'project' ? 'enter to look, and say yes or no · esc close' : 'enter adds a hook · ↑↓ move · esc close';
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      <Text bold wrap="truncate-end">Hooks · {n}<Text color={C.dim} bold={false}> · {mine} of yours{pk.envSet !== undefined ? ` · AGENTIC_HOOKS=${pk.envSet} decides the app's checks` : ''}</Text></Text>
      {win.above ? <Text color={C.dim}>   … {win.above} more above (↑)</Text> : null}
      {win.shown.map((r, k) => {
        const i = win.start + k;
        const on = i === Math.min(pk.index, rows.length - 1);
        const mark = <Text color={C.accent} bold>{on ? '❯ ' : '  '}</Text>;
        const head = i === 0 ? <Text color={C.dim} wrap="truncate-end">Your hooks · ~/.agentic-coder/hooks.json, in Claude Code's layout{pk.off ? ' · off in this window (AGENTIC_USER_HOOKS=off)' : ''}</Text>
          : r.check && r.n === 1 ? <><Text> </Text><Text color={C.dim} wrap="truncate-end">The app's checks · on Model the ones on run; on App all of them but Stays on task</Text></> : null;
        let line;
        if (r.id === 'add') line = <Text>{mark}<Text color={on ? C.accent : C.dim} bold={on}>+ Add a hook</Text></Text>;
        else if (r.id === 'project') line = <Text wrap="truncate-end">{mark}<Text color={on ? C.accent : C.warn} bold={on}>{hooksProjectLine(pk.project)}</Text></Text>;
        else if (r.hook) {
          const l = hookLine(r.hook);
          const live = !r.hook.off;
          line = (
            <Text wrap="truncate-end">
              {mark}
              <Text color={live ? C.accent : C.faint}>{live ? '● on   ' : '○ off  '}</Text>
              <Text bold={on} color={live ? undefined : C.dim}>{cut(`${l.when}${l.for ? ` · ${l.for}` : ''}`, whenW - 1).padEnd(whenW)}</Text>
              <Text color={C.dim}>{cut(l.command, Math.max(10, W - whenW - 20))}{r.theirs ? '  · this project’s' : ''}</Text>
            </Text>
          );
        } else {
          const c = r.check;
          const yes = checkOn(pk, c);
          line = <Text wrap="truncate-end">{mark}<Text color={C.dim}>{String(r.n).padStart(2)}  </Text><Text color={yes ? C.accent : C.faint}>{yes ? 'on ' : 'off'}</Text><Text>  </Text><Text bold={on}>{c.label.padEnd(30)}</Text><Text color={C.dim}>{c.what}</Text></Text>;
        }
        return <React.Fragment key={r.id}>{head}{line}</React.Fragment>;
      })}
      {win.below ? <Text color={C.dim}>   … {win.below} more (↓)</Text> : null}
      <Text> </Text>
      {pk.confirm ? <Text color={C.warn} wrap="truncate-end">Press d again to remove it; any other key keeps it.</Text>
        : pk.note ? <Text color={pk.note.tone === 'warn' ? C.warn : C.dim} wrap="wrap">{pk.note.text}</Text>
          : pk.error ? <Text color={C.warn} wrap="wrap">{pk.error}</Text>
            : at?.hook ? <Text color={C.dim} wrap="truncate-end">{hookLine(at.hook).when}: {eventLine(at.hook)}</Text> : null}
      <Text color={C.dim} wrap="truncate-end">{hint}</Text>
    </Box>
  );
}
const eventLine = (h) => eventOf(h.event)?.what ?? '';

function McpPicker({ app }) {
  const pk = app.picker;
  const W = app.width - 4;
  const cut = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, Math.max(0, n - 1))}…` : t; };
  if (pk.view === 'tools') {
    // The whole picker fits the window: its frame, title, header, the two lines under the list and the keys.
    const win = toolWindow(pk, Math.max(3, (app.rows ?? 24) - 12));
    const nameW = Math.min(28, Math.max(12, ...pk.tools.map((t) => t.name.length)) + 1);
    const descW = Math.max(10, W - nameW - 30);
    const at = pk.tools[pk.toolIndex];
    const s = pk.status.find((x) => x.name === pk.server.name);
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
        <Text wrap="truncate-end"><Text bold>{pk.server.name} · its tools</Text><Text color={C.dim}>   {pk.tools.length} tool{pk.tools.length === 1 ? '' : 's'} · {pk.tools.length - pk.marks.off.filter((n) => pk.tools.some((t) => t.name === n)).length} on{s?.version ? ` · speaks ${s.version}` : ''}</Text></Text>
        <Text color={C.dim} wrap="truncate-end">{'   on  yours  '}{'tool'.padEnd(nameW)}{'what it says about itself'.padEnd(descW + 2)}its own label</Text>
        {win.above ? <Text color={C.dim}>   … {win.above} more above (↑)</Text> : null}
        {win.shown.map((t, i) => {
          const on = win.start + i === pk.toolIndex;
          const st = toolState(pk, t);
          return (
            <Text key={t.name} wrap="truncate-end">
              <Text color={C.accent} bold>{on ? '❯  ' : '   '}</Text>
              <Text color={st.on ? C.accent : C.faint}>{st.on ? '●   ' : '○   '}</Text>
              <Text color={st.reads ? C.plan : C.faint}>{st.reads ? 'reads  ' : '—      '}</Text>
              <Text bold={on} color={st.on ? undefined : C.dim}>{cut(t.name, nameW - 1).padEnd(nameW)}</Text>
              <Text color={C.dim}>{cut(String(t.description).replace(/\s+/g, ' '), descW).padEnd(descW + 2)}</Text>
              <Text color={st.changed ? C.warn : C.faint}>{st.changed ? '⚠ changed' : t.says ?? '—'}</Text>
            </Text>
          );
        })}
        {win.below ? <Text color={C.dim}>   … {win.below} more (↓)</Text> : null}
        {!pk.tools.length ? <Text color={C.dim}>   This server lists no tools{s && s.state !== 'connected' ? `: it is ${s.state === 'off' ? 'switched off' : 'not running'}` : ''}.</Text> : null}
        <Text> </Text>
        {pk.open && at ? <Text wrap="wrap">{String(at.description || '(it has no description)').slice(0, Math.max(200, W * 4))}</Text> : <Text wrap="truncate-end">{at ? <><Text bold>{at.name}: </Text><Text color={toolState(pk, at).changed ? C.warn : C.dim}>{toolNote(pk, at)}</Text></> : ' '}</Text>}
        {pk.error ? <Text color={C.bad} wrap="truncate-end">{pk.error}</Text> : null}
        <Text color={C.dim} wrap="truncate-end">space on/off · r mark reads · enter its whole description · esc back</Text>
      </Box>
    );
  }
  if (pk.view === 'form') {
    const ROWS = formRows(pk);
    const lw = 16, vw = 26;
    const warn = mcpWarning(pk);
    const lines = testLines(pk.test);
    const typing = (e) => {
      const shown = e.id === 'key' ? '•'.repeat(e.value.length) : e.value;
      const room = Math.max(8, app.width - lw - 12);
      const from = Math.max(0, e.cursor - room + 1);
      const before = shown.slice(from, e.cursor), at = shown[e.cursor] ?? ' ', after = shown.slice(e.cursor + 1, from + room);
      return <><Text>{from ? '…' : ''}{before}</Text><Text inverse>{at}</Text><Text>{after}</Text>{e.id === 'key' ? <Text color={C.dim}>  {e.value.length} characters</Text> : null}</>;
    };
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
        <Text bold>{pk.was ? `MCP server · ${pk.was}` : 'Add an MCP server'}</Text>
        <Text color={C.dim} wrap="truncate-end">A program on this Mac or an address. Test lists its tools; nothing is kept until Save.</Text>
        {ROWS.map((r, i) => {
          const on = i === pk.index;
          const e = pk.editing?.id === r.id ? pk.editing : null;
          const off = (r.id === 'net' || r.id === 'local') && !pk.values.sandbox;
          const choice = r.type === 'choice' && !off;
          const unsaved = r.type !== 'action' && mcpRowChanged(pk, r.id);
          const v = showMcpValue(pk, r.id);
          const wide = r.id === 'command' || r.id === 'url';
          const done = r.id === 'test' && pk.test && !pk.test.running;
          const tone = done ? (pk.test.ok ? C.ok : C.bad) : undefined;
          return (
            <React.Fragment key={r.id}>
              {r.id === 'test' ? <Text> </Text> : null}
              <Text wrap="truncate-end">
                <Text color={on ? C.accent : undefined} bold={on}>{on ? '❯' : ' '} {r.label.padEnd(lw)}</Text>
                {e ? typing(e) : (
                  <>
                    <Text color={choice ? (on ? C.accent : C.faint) : undefined}>{choice ? '◀ ' : '  '}</Text>
                    <Text color={tone ?? (unsaved ? C.accent : r.type === 'action' ? C.dim : undefined)} bold={unsaved}>{wide ? v : v.padEnd(vw)}</Text>
                    {wide ? null : <Text color={choice ? (on ? C.accent : C.faint) : undefined}>{choice ? '▶ ' : '  '}</Text>}
                    <Text color={unsaved ? C.accent : C.faint}>{unsaved ? ' •' : '  '}</Text>
                    <Text color={C.dim}>{' '}{wide && v !== '—' ? '' : mcpRowNote(pk, r.id)}</Text>
                  </>
                )}
              </Text>
              {done ? lines.map((l, k) => (
                <Box key={k} paddingLeft={lw + 4}>
                  {l.tool ? <Text wrap="truncate-end"><Text>{cut(l.tool.name, 20).padEnd(21)}</Text><Text color={C.dim}>{cut(String(l.tool.description).replace(/\s+/g, ' '), Math.max(10, W - lw - 50)).padEnd(Math.max(10, W - lw - 50) + 2)}</Text><Text color={C.faint}>{l.tool.says ? `says: ${l.tool.says}` : ''}</Text></Text>
                    : l.more ? <Text color={C.dim}>… and {l.more} more</Text>
                    : l.note ? <Text color={C.dim} wrap="truncate-end">{l.note}</Text>
                    : <Text color={l.ok ? C.ok : C.bad} wrap="wrap">{l.ok ? '✔' : '✗'} {l.text}</Text>}
                </Box>
              )) : null}
            </React.Fragment>
          );
        })}
        {pk.values.runs === 'command' && !pk.values.sandbox ? <Text color={C.warn} wrap="truncate-end">Without its sandbox it runs with all your permissions: your files, your keys, the internet.</Text> : null}
        {warn ? <Text color={warn.tone === 'error' ? C.bad : C.warn} wrap="wrap">{warn.text}</Text> : null}
        {pk.error ? <Text color={C.bad} wrap="truncate-end">{pk.error}</Text> : null}
        <Text color={C.dim} wrap="truncate-end">{pk.editing ? 'enter keeps it · esc puts it back · paste works · ctrl+u clears' : '↑↓ choose · ←→ change · enter edits a row, runs Test, or saves · esc back to the list'}</Text>
      </Box>
    );
  }
  const rows = listRows(pk);
  const nameW = Math.min(20, Math.max(8, ...pk.status.map((s) => s.name.length)) + 2);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      <Text bold>MCP servers</Text>
      <Text color={C.dim} wrap="truncate-end">Tools from programs on this Mac and services on the internet. Each tool asks before its first use.</Text>
      <Text> </Text>
      {rows.map((r, i) => {
        const on = i === pk.index;
        if (r.id === 'add') return <Text key="add"><Text color={C.accent} bold>{on ? '❯ ' : '  '}</Text><Text color={on ? C.accent : C.dim} bold={on}>+ Add a server</Text></Text>;
        if (r.id === 'project') return <Text key="project" wrap="truncate-end"><Text color={C.accent} bold>{on ? '❯ ' : '  '}</Text><Text color={on ? C.accent : C.warn} bold={on}>{projectLine(pk.project)}</Text></Text>;
        const l = serverLine(r.server);
        const live = r.server.state === 'connected';
        return (
          <Text key={r.id} wrap="truncate-end">
            <Text color={C.accent} bold>{on ? '❯ ' : '  '}</Text>
            <Text color={on ? C.accent : undefined} bold={on}>{cut(r.server.name, nameW - 1).padEnd(nameW)}</Text>
            <Text color={live ? C.accent : r.server.state === 'starting' ? C.warn : C.faint}>{l.dot} </Text>
            <Text color={live ? undefined : r.server.state === 'off' ? C.dim : C.warn}>{l.state.padEnd(15)}</Text>
            <Text color={C.dim}>{cut(l.where, 38).padEnd(40)}</Text>
            <Text color={live ? undefined : C.dim}>{l.tools}</Text>
          </Text>
        );
      })}
      {!pk.status.length ? <Text color={C.dim}>  None yet. A server gives the model tools the app does not have: GitHub, a database, your own scripts.</Text> : null}
      <Text> </Text>
      {pk.confirm ? <Text color={C.warn} wrap="truncate-end">Remove {pk.confirm}? d again removes it (its key too); any other key keeps it.</Text> : pk.note ? <Text color={pk.note.tone === 'warn' ? C.warn : C.dim} wrap="truncate-end">{pk.note.text}</Text> : null}
      <Text color={C.dim} wrap="truncate-end">{pk.signing ? 'esc stops the sign-in' : `↑↓ choose · enter its tools · e edit · space on/off · r start again${pk.status.some((s) => s.runs === 'address') ? ' · s sign in' : ''} · d remove · esc closes`}</Text>
    </Box>
  );
}

// The list Connect opens on an Ollama service (remote-form.mjs openModelPick):
// /model's groups, each model with its size, what it can do, its weight and its
// try-out; the copies of one model on one row (←→ picks the copy). 2 Oct 2026.
function RemoteCatalogPick({ app }) {
  const p = app.picker.pick;
  const W = app.width - 4;
  const rows = [];
  p.groups.forEach((g, gi) => {
    if (gi) rows.push({ kind: 'blank' });
    rows.push({ kind: 'head', g });
    for (const id of g.ids) rows.push({ kind: 'model', id, i: p.models.indexOf(id), m: p.entries[id] });
  });
  const at = rows.findIndex((r) => r.i === p.index);
  const view = Math.max(8, (app.rows ?? 24) - 15);
  const top = Math.max(0, Math.min(at - Math.floor(view / 2), rows.length - view));
  const shown = rows.slice(top, top + view);
  const above = rows.slice(0, top).filter((r) => r.kind === 'model').length;
  const below = rows.slice(top + view).filter((r) => r.kind === 'model').length;
  const nameW = Math.min(32, Math.max(18, ...p.models.map((id) => id.length + (p.entries[id]?.copies?.length ? 5 : 2))));
  const cols = [['size', 11], ['can', 26], ['gb', 9], ['tried', 16]];
  const fit = cols.filter((_, i) => 2 + nameW + 11 + cols.slice(0, i + 1).reduce((n, [, w]) => n + w, 0) <= W);
  const cell = (m, k, w) => {
    if (k === 'size') return (m.params ? sizeWord(m) : '?').padEnd(w);
    if (k === 'can') return (!m.known ? 'not said' : m.embedding ? 'search' : !m.tools ? (m.vision ? 'images · no tools' : '— chat only') : canWord(m)).padEnd(w);
    if (k === 'gb') return (gbWord(m.bytes) || '?').padStart(w - 2).padEnd(w);
    return (m.tools && !isHelperModel(m) ? triedWord(p.tried?.[m.id]) : '').padEnd(w);
  };
  const cur = rows[at];
  const copyOf = (r) => p.copy?.[r.id] ?? r.id;
  const detail = !cur?.m ? null
    : cur.m.copies?.length ? `${cur.m.copies.length + 1} copies of one model: ←→ picks one (${[cur.id, ...cur.m.copies].map((x) => x.split(':')[1] ?? x).join(' · ')}).`
    : !cur.m.known ? 'The service does not say what this one can do: a try-out the first time you pick it will.'
    : cur.m.embedding ? 'It compares meanings (code search). /profiles can give it that job; it cannot be the main model.'
    : !cur.m.tools ? 'No tools: it can only answer in words. As the main model it reads, edits and runs nothing.'
    : isBig(cur.m) ? 'Big model: it reads 400 lines at a time, up to 80 steps.' : null;
  const row = (r, k) => {
    if (r.kind === 'blank') return <Text key={k}> </Text>;
    if (r.kind === 'head') return <Text key={k} wrap="truncate-end"><Text bold>{r.g.text}</Text><Text color={C.dim}>  {r.g.note}</Text></Text>;
    const on = r.i === p.index;
    const m = r.m;
    const main = m.tools && !m.embedding;
    const name = copyOf(r) + (m.copies?.length ? ` +${m.copies.length}` : '');
    const t = p.tried?.[m.id];
    return (
      <Text key={k} wrap="truncate-end">
        <Text color={C.accent}>{on ? '❯ ' : '  '}</Text>
        <Text color={on ? C.accent : main ? undefined : C.dim} bold={on}>{name.padEnd(nameW)}</Text>
        {fit.map(([c, w]) => <Text key={c} color={c === 'tried' && t ? (t.ok ? C.ok : C.warn) : C.dim}>{cell(m, c, w)}</Text>)}
        {r.id === p.suggested ? <Text color={C.ok}> suggested</Text> : null}
      </Text>
    );
  };
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      <Text bold>Remote model</Text>
      <Text color={C.dim} wrap="truncate-end">{showValue(app.picker, 'address')} has {p.total} models; {p.groups.filter((g) => g.text !== 'Chat only' && g.text !== 'Helpers').reduce((n, g) => n + g.ids.length, 0)} can run the agent. Pick one; Connect then checks it.</Text>
      <Text> </Text>
      {above ? <Text color={C.dim}>  ↑ {above} more</Text> : null}
      {shown.map((r, k) => row(r, top + k))}
      {below ? <Text color={C.dim}>  ↓ {below} more</Text> : null}
      <Text> </Text>
      <Text color={C.dim} wrap="truncate-end">{detail ? `  ${detail}` : ' '}</Text>
      <Text color={C.dim}>↑↓ choose · ←→ the copy · enter picks it and connects · esc back to the form</Text>
    </Box>
  );
}

// The names an OpenAI-compatible server listed, after Connect (or enter on the
// Model row). A coder is marked suggested when none was named yet.
function RemoteModelPick({ app }) {
  const pk = app.picker;
  if (pk.pick.groups) return <RemoteCatalogPick app={app} />;
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
      <EffortRows levels={levels} at={at} />
      <Text> </Text>
      <Text color={C.dim}>↑↓ model · ←→ effort · enter to save · esc to cancel</Text>
    </Box>
  );
}

// /model's Effort row and the note under it: the highlighted model's levels, the one shown at `at`.
function EffortRows({ levels, at }) {
  const lv = levels[at];
  return (
    <>
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
      <Text color={C.dim} wrap="truncate-end">{'           '}{lv ? `${lv.label}: ${lv.note}` : ''}</Text>
    </>
  );
}

// /model on an Ollama service (remote-models.mjs lays the rows out): the service's
// models in columns (name, size, quantization, context, what it can do, on disk),
// a window of rows around the cursor, the line about the highlighted model, Effort.
// A narrow window drops the quantization, then the size, then the GB.
const SVC_COLS = [['size', 11], ['quant', 8], ['ctx', 8], ['can', 25], ['gb', 8], ['tried', 15]];

function ServicePicker({ app }) {
  const pk = app.picker;
  const sv = app.service;
  const rows = serviceRows(pk, sv);
  const cur = atRow(pk, rows);
  const W = app.width - 4;
  const models = rows.filter((r) => r.kind === 'model');
  const nameW = Math.min(32, Math.max(16, ...models.map((r) => r.m.id.length + 2)));
  const status = 11; // "   ✔ in use", or "   big" (big-model mode)
  const drop = ['quant', 'tried', 'size', 'gb'];
  let cols = SVC_COLS;
  while (2 + nameW + cols.reduce((n, [, w]) => n + w, 0) + status > W && drop.length) { const d = drop.shift(); cols = cols.filter(([k]) => k !== d); }
  const cell = (m, k, w) => {
    if (k === 'size') return sizeWord(m).padEnd(w);
    if (k === 'quant') return m.quant.padEnd(w);
    if (k === 'ctx') return `${ctxWord(m.loadedCtx || m.ctx).padStart(5)}   `;
    if (k === 'can') return (m.tools ? canWord(m) : '— chat only').padEnd(w);
    if (k === 'tried') return `  ${m.tools && !isHelperModel(m) ? triedWord(sv.tried?.[m.id]) : ''}`.padEnd(w);
    return gbWord(m.bytes).padStart(w);
  };
  // The rows that fit, the cursor's always among them.
  const view = Math.max(6, (app.rows ?? 24) - 14);
  const i = Math.max(0, rows.indexOf(cur));
  const top = Math.max(0, Math.min(i - Math.floor(view / 2), rows.length - view));
  const shown = rows.slice(top, top + view);
  const above = rows.slice(0, top).filter((r) => r.id).length;
  const below = rows.slice(top + view).filter((r) => r.id).length;
  const detail = rowDetail(cur, { inUse: sv.inUse, used: sv.used });
  const g = sv.catalog ? groupsOf(sv.catalog.models) : null;
  const total = g ? g.loaded.length + g.agent.length + g.chatOnly.length : 0;
  const row = (r, k) => {
    const on = r === cur;
    const mark = <Text color={C.accent}>{on ? '❯ ' : '  '}</Text>;
    if (r.kind === 'blank') return <Text key={k}> </Text>;
    if (r.kind === 'note') return <Text key={k} color={C.dim} wrap="truncate-end">  {r.text}</Text>;
    if (r.kind === 'head') return <Text key={k} wrap="truncate-end"><Text bold>{r.text}</Text><Text color={C.dim}>  {r.note}</Text></Text>;
    if (r.kind === 'fold') return <Text key={k} wrap="truncate-end">{mark}<Text color={C.dim}>{r.open ? '▾ ' : '▸ '}</Text><Text bold color={on ? C.accent : undefined}>{r.text}</Text><Text color={C.dim}>  {r.note}</Text></Text>;
    if (r.kind === 'local') return <Text key={k} wrap="truncate-end">{mark}<Text color={on ? C.accent : undefined} bold={on}>{r.m.name.padEnd(nameW)}</Text><Text color={C.dim}>{(r.m.bytes / 1e9).toFixed(1)} GB · on this Mac</Text></Text>;
    if (r.kind === 'service') return <Text key={k} wrap="truncate-end">{mark}<Text color={on ? C.accent : undefined} bold={on}>{r.s.name.padEnd(nameW)}</Text><Text color={C.dim}>{remoteRowDesc(r.s)}</Text></Text>;
    const m = r.m;
    return (
      <Text key={k} wrap="truncate-end">
        {mark}
        <Text color={on ? C.accent : m.tools ? undefined : C.dim} bold={on}>{m.id.padEnd(nameW)}</Text>
        {cols.map(([c, w]) => <Text key={c} color={(c === 'can' && !m.tools) || (c === 'tried' && sv.tried?.[m.id]?.ok === false) ? C.warn : c === 'tried' && sv.tried?.[m.id]?.ok ? C.ok : C.dim}>{cell(m, c, w)}</Text>)}
        {m.id === sv.inUse ? <Text color={C.ok}>   ✔ in use</Text> : isBig(m) ? <Text color={C.dim}>   big</Text> : null}
      </Text>
    );
  };
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      <Box justifyContent="space-between">
        <Text bold wrap="truncate-end">/model · 1 of 3: model<Text color={C.dim}>{`  · ${sv.title}`}</Text></Text>
        <Text color={C.dim} wrap="truncate-start">{`  ${sv.where}${sv.version ? ` · Ollama ${sv.version}` : ''}${sv.ms != null ? ` · ${sv.ms} ms` : ''}`}</Text>
      </Box>
      {pk.filter
        ? <Box justifyContent="space-between"><Text><Text bold>Filter  </Text>{pk.filter}<Text color={C.accent}>█</Text></Text><Text color={C.dim}>{`${models.length} of ${total} · esc clears the filter`}</Text></Box>
        : <Text color={C.dim} wrap="truncate-end">Pick a model. Next: which profile uses it, then its settings. Nothing changes until enter on the last step; the chat stays.</Text>}
      <Text> </Text>
      {above ? <Text color={C.dim}>  ↑ {above} more</Text> : null}
      {shown.map((r, k) => row(r, top + k))}
      {below ? <Text color={C.dim}>  ↓ {below} more</Text> : null}
      <Text> </Text>
      <Text color={detail?.tone === 'warn' ? C.warn : C.dim} wrap="truncate-end">{detail ? `  ${detail.text}` : ' '}</Text>
      <Text> </Text>
      <Text color={C.dim} wrap="truncate-end">↑↓ model · type to filter · enter: which profile uses it · esc cancels</Text>
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
    ? [b.who ? `answered by ${b.who}` : null, L.maxOffset > 0 ? '↑/↓ to scroll' : null, 'c to copy', 'f to send to main', 'Esc to close'].filter(Boolean).join(' · ')
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
        <Box paddingX={4}><Text wrap="truncate-end"><Text color={icon.color}>{icon.glyph}</Text><Text color={C.accent}> {b.wait ?? 'Answering…'}</Text><Text color={C.dim}> ({fmtSecs(secs)})</Text></Text></Box>
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
// The start page's height follows its room (start.jsx StartPage, start.room) and what it lists: the
// conversations (more after /clear), the tip (gone at your first message), the sessions in the background.
const pageKey = (s) => [s?.room, s?.recent?.length, s?.tip ? 1 : 0, s?.running?.length, s?.look].join(':');
const rowsKey = (it, ctx) => `${it.key}\0${ctx.width}${it.type === 'welcome' ? `\0${pageKey(ctx.start)}` : it.type === 'startnotes' ? `\0${lookOf(ctx.start?.look)}` : ''}`;
// An item as printed (Tight rail, 8 Oct 2026): a turn's steps sit on consecutive rows; a reply has
// an empty row above and under it; your message has one above and under it (a turn cut off has no
// end line to leave one); the end line and everything outside a turn have one under them.
// Grouped (rail.jsx groupWork): the model's sentences have none (tight).
export const gapOver = (it) => (it.tight ? 0 : (it.rail && it.type === 'text') || (!it.rail && it.type === 'user') ? 1 : 0);
export const gapUnder = (it) => (it.tight ? 0 : it.rail ? (it.type === 'done' || it.type === 'text' ? 1 : 0) : it.type === 'looks' ? 0 : 1);
// A group (rail.jsx groupWork): its box, closed (what stays in sight) or open (its steps inside, narrower by
// the box's borders and padding).
function GroupView({ it, width, model, cwd, loaded, start }) {
  const steps = it.open ? it.list.map((x) => <ItemFrame key={x.key} it={x} width={width - 8} model={model} cwd={cwd} loaded={loaded} start={start} />) : null;
  return <GroupBox facts={groupFacts(it.list)} open={it.open} width={width} cwd={cwd}>{steps}</GroupBox>;
}
// The stretch still under way, in the live area: its row counting as it goes, and its last two steps.
function LiveGroup({ list, width, model, cwd, loaded, start }) {
  return (
    <Box flexDirection="column">
      <GroupHead facts={groupFacts(list)} live />
      {list.slice(-2).map((x) => <ItemFrame key={x.key} it={x} width={width} model={model} cwd={cwd} loaded={loaded} start={start} />)}
    </Box>
  );
}
// The start's notes take no rows under the Menu, which shows them in its own (start-notes.jsx).
const inPage = (it, start) => it.type === 'startnotes' && lookOf(start?.look) !== 'launcher';
export function ItemFrame({ it, width, model, cwd, loaded, start }) {
  if (inPage(it, start)) return null;
  return (
    <Box flexDirection="column" marginTop={gapOver(it)} marginBottom={gapUnder(it)} width={width}>
      <Item it={it} width={width} model={model} cwd={cwd} loaded={loaded} start={start} />
    </Box>
  );
}
// What the conversation prints: its items with each run of reads folded into one (rail.jsx
// foldSteps); while a turn works, a run still open at the end is held for the live area. view (/steps,
// App.jsx): grouped, each stretch of steps between the model's words one box (rail.jsx groupWork; open:
// the ones you opened; the stretch under way held whole); words, the same without the boxes; open (or
// none), every step as before.
function printedOf(items, working = false, view = null) {
  if (!view || view.steps === 'open') return foldSteps(items, working);
  const g = groupWork(foldSteps(items).printed, { working, open: view.open });
  return view.steps === 'words' ? { printed: g.printed.filter((it) => it.type !== 'group'), held: g.held } : g;
}
// The groups printed, in order (ctrl+o's list, app-keys.mjs).
export const stepGroups = (items, view) => printedOf(items, false, view).printed.filter((it) => it.type === 'group');
// The printed item on a row of the window: up, rows over the live part (1: the one right over it); the
// row it is counted from the item's top. null when it is not measured or not there (a click, app-keys.mjs).
export function printedAt(items, ctx, working, up) {
  const { printed } = printedOf(items, working, ctx.view);
  let n = 0;
  for (let i = printed.length - 1; i >= 0; i--) {
    const h = itemHeights.get(rowsKey(printed[i], ctx));
    if (h == null) return null;
    if (up <= n + h) return { it: printed[i], row: h - (up - n) };
    n += h;
  }
  return null;
}
export function primeRows(items, ctx) {
  let added = false;
  for (const it of printedOf(items, false, ctx.view).printed) {
    const k = rowsKey(it, ctx);
    if (itemHeights.has(k)) continue;
    if (itemHeights.size > 5000) itemHeights.clear();
    const out = renderToString(<ItemFrame it={it} width={ctx.width} model={ctx.modelName} cwd={ctx.cwdShort} loaded={ctx.loaded} start={ctx.start} />, { columns: ctx.width });
    itemHeights.set(k, out ? out.split('\n').length : 0); // the margin under it (gapUnder) is its last line; nothing drawn, no rows
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
export const holdRoom = (items, ctx, rows) => rows - (itemHeights.get(rowsKey(items[0], ctx)) ?? 18) - 6 - (ctx?.foot ?? 0);
// Rows the conversation fills from the top of the window (at most the
// window). An item not measured yet counts as a full window: no space, never
// a prompt box pushed below the window.
function usedRows(app, list) {
  let n = 0;
  for (const it of app.hold ? [] : list) {
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
  const ownLive = useRef(null);
  const liveRef = app.liveBoxRef ?? ownLive; // App reads its height for a click on a group (app-keys.mjs)
  // the bot over the live part (bot-layer.jsx): where the prompt box is, and its cells as last worked out
  const boxRef = useRef(null);
  const bot = useBot(app, liveRef, boxRef);
  const drawn = useRef({ redraw: null, height: 0, count: 0 });
  const working = app.live?.phase === 'working';
  const folded = printedOf(app.items, working, app.stepsView);
  useLayoutEffect(() => {
    if (!liveRef.current) return;
    drawn.current = { redraw: app.redraw, height: measureElement(liveRef.current).height, count: app.hold ? 0 : folded.printed.length };
  });
  // An empty <Static> of its own resets what Ink keeps to print again on a
  // full clear, so the old (wider) conversation is not printed into the small window.
  if (app.tooSmall) return <Box flexDirection="column"><Static key={`small${app.redraw}`} items={[]}>{() => null}</Static><TooSmall app={app} /></Box>;
  // /agents' tree has the whole window (agents-view.jsx); the conversation is printed again when it closes.
  if (app.agentsTree) return <Box flexDirection="column"><Static key={`agents${app.redraw}`} items={[]}>{() => null}</Static><AgentsView state={app.agentsTree} columns={app.columns} rows={app.rows} now={app.agentsNow} /></Box>;
  // /loops' board has the whole window too (loops-view.jsx); the conversation is printed again when it closes.
  if (app.loopsFrame) return <Box flexDirection="column"><Static key={`loops${app.redraw}`} items={[]}>{() => null}</Static><LoopsView frame={app.loopsFrame} columns={app.columns} /></Box>;
  // The conversation is printed from the top of the window (at the start and
  // again after a resize); the prompt box, footer and status line sit on the
  // last lines, with blank space in between until the conversation fills it.
  // The box's bottom edge is the window's last line (Ink draws no line break
  // under it: patches/ink@7.1.1.patch). The live part alone stays a line short
  // of the window: one as tall as the window would make Ink wipe the window and
  // print everything again when it shrinks. With nothing printed above it (the
  // start page held live), the app starts on the second line (cli.jsx), so it
  // still ends on the last.
  const items = folded.printed;
  const printed = app.hold ? [] : items;
  let fill = Math.max(0, Math.min(app.rows - 1, app.rows - usedRows(app, items)));
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
          <Box ref={app.pageRef} marginBottom={1}><HomePage start={app.start} width={width} loading={app.starting || app.battle || app.waiting ? { phase: app.battle || app.waiting ? 'waiting' : app.startPhase, secs: Math.max(0, (app.now - app.startedAt) / 1000), left: app.startLeft } : null} typing={app.input?.value && !app.menu ? (4 + (app.input.cursor % promptTextWidth(width))) / width : null} walk={app.walk} focus={app.homeFocus} /></Box>
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
      <LiveArea app={app} held={folded.held} />
      {app.btwWaiting ? <Box marginBottom={1}><Text color={C.dim}>⏵ Your /btw answer is kept: it shows again once you have answered</Text></Box> : null}
      {app.queued ? <Box marginBottom={1}><Text color={C.dim}>⏵ Queued: {app.queued.length > 80 ? `${app.queued.slice(0, 79)}…` : app.queued}{app.starting ? '  · sends as soon as the model is ready' : app.modelState?.remote && app.modelState.state === 'loading' ? '  · sends once the model has loaded on the service' : app.modelOff ? '  · sends once /start has loaded the model' : ''}</Text></Box> : null}
      </Box>
      <Box flexGrow={1} />
      {app.popup ? <><Popup app={app} /><Box flexGrow={1} /></> : null}
      <Box flexDirection="column" flexShrink={0}>
      {app.picker?.kind === 'model' ? (
        <ModelPicker app={app} />
      ) : app.picker?.kind === 'usage' ? (
        <UsagePanel app={app} />
      ) : app.picker?.kind === 'service' ? (
        <ServicePicker app={app} />
      ) : app.picker?.kind === 'profile-step' ? (
        <ProfileStep app={app} />
      ) : app.picker?.kind === 'profiles' ? (
        <ProfilesPanel app={app} />
      ) : app.picker?.kind === 'jump' ? (
        <JumpPicker app={app} />
      ) : app.picker?.kind === 'choice' ? (
        <ChoicePicker app={app} />
      ) : app.picker?.kind === 'limits' ? (
        <LimitsPicker app={app} />
      ) : app.picker?.kind === 'remote' || app.picker?.kind === 'web' ? (
        <RemotePicker app={app} />
      ) : app.picker?.kind === 'mcp' ? (
        <McpPicker app={app} />
      ) : app.picker?.kind === 'hooks' ? (
        <HooksPicker app={app} />
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
          {app.agentsLine ? <AgentsLine segs={app.agentsLine} /> : null}
          {app.loopsLine ? <LoopsLine segs={app.loopsLine} /> : null}
          {app.trayLayout ? <AttachTray items={app.tray} layout={app.trayLayout} width={width} mouse={app.mouse} /> : null}
          {app.botAllowed && !app.hold && !bot.hidden && app.rows >= KEEP_FROM ? <Box height={KEEP_ROWS} /> : null}
          <Box ref={boxRef} flexDirection="column"><PromptBox app={app} /></Box>
          <Menu app={app} />
          <Footer app={app} />
        </Box>
      )}
      {app.meters ? <Meters app={app} /> : <MemoryWarning app={app} />}
      </Box>
      {bot.cells.length ? <BotLayer cells={bot.cells} /> : null}
      </Box>
    </Box>
  );
}
