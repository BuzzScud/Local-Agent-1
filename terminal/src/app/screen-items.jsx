// The conversation's finished lines (screen.jsx): a tool's call and result, /context, /rules,
// the memory panel, Item, which picks the view for each kind of line, and the frame around it, with
// the steps of a task row. Moved from screen.jsx word for word.
import React from 'react';
import { Box, Text } from 'ink';
import { C, MARK, fmtSecs, fmtTok } from '../ui/theme.mjs';
import { money } from '../agent/spend.mjs';
import { Row, Result, ToolHead, Diff, Todos } from '../ui/parts.jsx';
import { Markdown } from './markdown.jsx';
import { codenameOf } from '../agent/helpers.mjs';
import { Node, Pipe, UserStrip, MachineLine, ThoughtNode, ReplyNode, ToolNode, LooksNode, CheckNode, NoteNode, EndLine, MadeNode } from './rail.jsx';
import { TaskRun, TaskEnd } from './task-rows.jsx';
import { HomePage, lookOf } from './home-looks.jsx';
import { StartLine } from './start-notes.jsx';

export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const diffW = (width) => Math.max(40, Math.min(110, width - 12));

// Long folder paths keep their end, which is the part that says where you are.
export const fitPath = (p, max) => (p.length <= max ? p : `…${p.slice(p.length - max + 1)}`);

// The footer's live memory dot: Activity Monitor's fine / tight / critical, in the app's blue, yellow and red.
export const PRESSURE_COLOR = { fine: C.ok, tight: C.warn, critical: C.bad };

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
      {it.status ? <Box paddingLeft={2}><Text color={it.warn ? C.warn : C.dim}>{it.status.replace(/^Memory · /, '')}</Text></Box> : null}
      {it.sections.map((sec) => (
        <Box key={sec.title} flexDirection="column">
          {head(sec.title, sec.missing ? 'not reachable' : `${sec.facts.length + sec.more} fact${sec.facts.length + sec.more === 1 ? '' : 's'}`, sec.where)}
          {sec.missing ? <Box paddingLeft={4}><Text color={C.warn}>{sec.missing}</Text></Box> : null}
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
    case 'done': return it.rail ? <EndLine it={it} counts={doneCounts(it)} /> : <Text><Text color={C.accent}>{MARK}</Text><Text color={C.dim}> {it.past} for {fmtSecs(it.secs)}{doneCounts(it)} · done {clock(it.at)}{it.usd > 0 ? ` · ${money(it.usd)} for this request${it.cached != null ? ` · ${it.cached}% from the cache` : ''}` : ''}</Text></Text>;
    case 'text': return it.rail ? <ReplyNode text={it.text} /> : <Row><Markdown text={it.text} /></Row>;
    case 'tool': return it.rail ? <ToolNode it={it} cwd={cwd} /> : <ToolView it={it} width={width} />;
    // Reads, lists and searches in a row, as one row (rail.jsx foldSteps).
    case 'looks': return <LooksNode list={it.list} cwd={cwd} />;
    // A task row of the model's lines and their steps, and the end of their box (task-rows.jsx).
    case 'taskrun': return <TaskRun it={it} width={width} drawSteps={(list, w) => stepsDrawn(list, w, { model, cwd, loaded, start })} />;
    case 'taskend': return <TaskEnd it={it} width={width} cwd={cwd} />;
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

export function Marks({ marks, pending = false }) {
  return (
    <Text>
      {marks.map((m, i) => <Text key={i} color={m === '✓' ? C.ok : C.bad}>{m} </Text>)}
      {pending ? <Text color={C.accent}>●</Text> : null}
    </Text>
  );
}

// An item as printed (Tight rail, 8 Oct 2026): a turn's steps sit on consecutive rows; a reply has
// an empty row above and under it; your message has one above and under it (a turn cut off has no
// end line to leave one); the end line and everything outside a turn have one under them.
// Grouped (rail.jsx groupWork): the model's sentences have none (tight).
export const gapOver = (it) => (it.tight ? 0 : (it.rail && it.type === 'text') || (!it.rail && it.type === 'user') ? 1 : 0);
export const gapUnder = (it) => (it.tight ? 0 : it.rail ? (it.type === 'done' || it.type === 'text' ? 1 : 0) : it.type === 'looks' ? 0 : 1);
// Steps drawn as the conversation draws them, at a width: inside an open task row, and in the live area.
export const stepsDrawn = (list, width, { model, cwd, loaded, start }) => list.map((x) => <ItemFrame key={x.key} it={x} width={width} model={model} cwd={cwd} loaded={loaded} start={start} />);
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
