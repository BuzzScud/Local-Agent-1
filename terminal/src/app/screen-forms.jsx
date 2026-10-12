// The forms and model lists (screen.jsx): /remote and /web, /hooks, /mcp, a service's catalog
// and models, /help's popup, /model and the service picker. Moved from screen.jsx word for word.
import React from 'react';
import { Box, Text } from 'ink';
import { C, MARK } from '../ui/theme.mjs';
import { wrap } from '../ui/parts.jsx';
import { rowsOf, showValue, rowNote, rowChanged, modelChoices, formWarning, remoteRowDesc, formReady } from './remote-form.mjs';
import { serviceRows, atRow, rowDetail, groupsOf, sizeWord, ctxWord, gbWord, canWord, isBig, isHelper as isHelperModel } from './remote-models.mjs';
import { triedWord } from './tryouts.mjs';
import { WEB_ROWS, showWebValue, webRowNote, webWarning } from './web-form.mjs';
import { listRows, serverLine, projectLine, formRows, showMcpValue, mcpRowNote, mcpRowChanged, mcpWarning, testLines, toolState, toolWindow, toolNote } from './mcp-form.mjs';
import { hookListRows, hookLine, projectLine as hooksProjectLine, checkOn, rowWindow, hookFormRows, showHookValue, hookRowNote, hookRowChanged, hookWarning } from './hooks-form.mjs';
import { HOOKS as APP_CHECKS } from '../agent/way.mjs';
import { eventOf } from '../agent/user-hooks.mjs';

// /remote: where the model runs, in one form (remote-form.mjs): Run on first,
// then only that service's rows. A choice row shows its value between ◀ ▶; a
// text row its value, or what is being typed with the cursor (the API key as
// dots); • marks a change not saved yet. A Connect that did not work leaves
// its findings under the Connect row. Several models and none named: the list
// (a coder highlighted); enter picks one and Connect checks it.
// /web is the same form with its own rows (web-form.mjs) and a Test row.
export function RemotePicker({ app }) {
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
export function HooksPicker({ app }) {
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

export function McpPicker({ app }) {
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
export function Popup({ app }) {
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
export function ModelPicker({ app }) {
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

export function ServicePicker({ app }) {
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
