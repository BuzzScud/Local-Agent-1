// What the terminal shows, laid out like Claude Code: thinking folded to one
// line, one spinner with the time and tokens, a line with the time left behind
// when a turn ends, nothing under the prompt but the footer (/meters on adds
// the status bar).
// Finished lines go in <Static> (printed once, so the terminal's own
// scrollback keeps working); the live area below them is redrawn.
import React, { useRef, useLayoutEffect } from 'react';
import { Box, Text, Static, renderToString, measureElement } from 'ink';
import { promptTextWidth } from './edit-input.mjs';
import { C, fmtSecs } from '../ui/theme.mjs';
import { MIN_COLS, MIN_ROWS } from './window.mjs';
import { AgentsView, AgentsLine } from './agents-view.jsx';
import { LoopsView, LoopsLine } from './loops-view.jsx';
import { HelpersPanel } from './helpers-panel.jsx';
import { foldSteps, groupWork } from './rail.jsx';
import { taskRows, RowView } from './task-rows.jsx';
import { HomePage, lookOf } from './home-looks.jsx';
import { useBot, BotLayer, KEEP_ROWS, KEEP_FROM } from './bot-layer.jsx';
import { AttachTray } from './tray.jsx';
import { ProfileStep, ProfilesPanel } from './profiles-view.jsx';
import { Menu, PermissionPrompt } from './screen-ask.jsx';
import { BtwPanel } from './screen-btw.jsx';
import { Footer, PromptBox, UsagePanel } from './screen-footer.jsx';
import { HooksPicker, McpPicker, ModelPicker, Popup, RemotePicker, ServicePicker } from './screen-forms.jsx';
import { ItemFrame, stepsDrawn } from './screen-items.jsx';
import { LiveArea, MemoryWarning, Meters, StartIcon } from './screen-live.jsx';
import { ChoicePicker, JumpPicker, LimitsPicker, RewindPicker, START_PHASE, SettingsPicker } from './screen-pickers.jsx';
import { permissionOptions } from './permission-options.mjs';
export { menuHeight } from './screen-ask.jsx';
export { answerRows, btwLayout } from './screen-btw.jsx';
export { footerParts, MENU_ROWS, modelLabels, shortcutRows, shortcutsOf } from './screen-footer.jsx';
export { contextHead, doneCounts, gapOver, gapUnder, Item, ItemFrame } from './screen-items.jsx';
export { memoryWarning, Spinner, tailToFit } from './screen-live.jsx';
export { permissionOptions };

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
// What the conversation prints: its items with each run of reads folded into one (rail.jsx
// foldSteps); while a turn works, a run still open at the end is held for the live area. view (/steps,
// App.jsx): grouped, the model's lines and their steps as task rows (task-rows.jsx; open: the ones you
// opened; the task row under way held); words, only what the model says; open (or none), every step as before.
export function printedOf(items, working = false, view = null) {
  if (!view || view.steps === 'open') return foldSteps(items, working);
  const g = groupWork(foldSteps(items).printed, { working });
  if (view.steps === 'words') return { printed: g.printed.filter((it) => it.type !== 'group'), held: g.held };
  return taskRows(g.printed, { held: g.held, working, open: view.open });
}
// The task rows printed, in order (ctrl+o's list, app-keys.mjs).
export const stepRuns = (items, view) => printedOf(items, false, view).printed.filter((it) => it.type === 'taskrun');
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
// What a click on a row of a task row opens or closes: the task row (its top edge or its own row), one of
// its rows (that row's own line, when it is open), else nothing (your answers, a row's steps: text).
const partRows = new Map();
export function pieceAt(it, row, ctx) {
  if (it?.type !== 'taskrun') return null;
  let r = row - (it.first ? 1 : 0);
  if (r <= 0) return it.id;
  if (!it.open) return null;
  r -= 1;
  for (const p of it.run.rows) {
    const on = it.openRows.has(p.id);
    const k = `${p.id}\0${on}\0${ctx.width}`;
    if (!partRows.has(k)) {
      if (partRows.size > 2000) partRows.clear();
      const out = renderToString(<RowView r={p} open={on} width={ctx.width} drawSteps={(list, w) => stepsDrawn(list, w, { model: ctx.modelName, cwd: ctx.cwdShort, loaded: ctx.loaded, start: ctx.start })} />, { columns: ctx.width });
      partRows.set(k, out ? out.split('\n').length : 1);
    }
    if (r === 0) return p.id;
    if (r < partRows.get(k)) return null;
    r -= partRows.get(k);
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
export const holdRoom = (items, ctx, rows) => rows - (itemHeights.get(rowsKey(items[0], ctx)) ?? 18) - 6;
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

// The panel in the prompt box's place: a picker, a permission question, /btw (null: the prompt box shows). Its own
// component so the window (terminal/src/window/bridge.mjs) can draw the same panel alone.
export const panelOpen = (app) => Boolean(app.picker || app.perm || app.btw);
export function PanelArea({ app }) {
  return (
    app.picker?.kind === 'model' ? (
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
      <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
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
    ) : null
  );
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
      {panelOpen(app) ? <PanelArea app={app} /> : (
        <Box flexDirection="column">
          {app.agentsLine ? <AgentsLine segs={app.agentsLine} /> : null}
          {app.loopsLine ? <LoopsLine segs={app.loopsLine} /> : null}
          {app.live?.helpers?.length ? <HelpersPanel helpers={app.live.helpers} loaded={app.live.helpersLoaded} width={width} /> : null}
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
