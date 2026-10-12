// What asks you something (screen.jsx): the permission prompt, the model's question box with
// its tabs, and the / menu. Moved from screen.jsx word for word.
import React from 'react';
import { Box, Text } from 'ink';
import { askState, typeLabel } from './app-ask.mjs';
import { C } from '../ui/theme.mjs';
import { wrap, Diff, diffParts } from '../ui/parts.jsx';
import { MENU_ROWS } from './screen-footer.jsx';
import { diffW, fitPath } from './screen-items.jsx';

const PERM_TITLE = { Edit: 'Edit file', Write: 'Create file', Bash: 'Bash command', Rename: 'Rename', Test: 'Approve this test', Ask: 'Agentic Coder asks', WebSearch: 'Web search', WebFetch: 'Read a web page', Screen: 'Look at the screen', Mcp: 'MCP tool', McpProject: 'A project brings its own MCP servers', HooksProject: 'A project brings its own hooks' };

// What each permission question offers: permission-options.mjs (plain, so the app's logic needs no screen).

// What a Screen question shows: the app's window, or all of it.
const screenWhat = (args) => (String(args?.app ?? '').trim() ? `${String(args.app).trim()}'s front window` : 'the whole screen: every window that is open on it');

export function PermissionPrompt({ app }) {
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
export const NamedRule = ({ name, more = '', width }) => <Text color={C.faint} wrap="truncate-end">── <Text color={C.dim}>{name}</Text>{more ? <Text color={C.faint}> · {more}</Text> : null} {'─'.repeat(Math.max(2, width - 5 - name.length - (more ? more.length + 3 : 0)))}</Text>;
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
export function Menu({ app }) {
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
