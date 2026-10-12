// The live area under the finished lines (screen.jsx): the spinner, the meters, the memory
// warning and the live rail of the step running now. Moved from screen.jsx word for word.
import React from 'react';
import { Box, Text } from 'ink';
import { C, spinFrame, fmtSecs, fmtTok } from '../ui/theme.mjs';
import { wrap, Row, Result, ToolHead } from '../ui/parts.jsx';
import { Markdown } from './markdown.jsx';
import { meterWords } from './remote-footer.mjs';
import { RAIL, Node, Pipe, MachineLine, ThinkingLive, ReplyNode, ToolNode, LooksNode, RunningNode, WritingNode, doingWords } from './rail.jsx';
import { LiveRun } from './task-rows.jsx';
import { btwLayout } from './screen-btw.jsx';
import { Marks, plural, stepsDrawn } from './screen-items.jsx';

export function bar(frac, cells = 10) {
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
export function MemoryWarning({ app }) {
  const used = app.stats.ctxUsed ?? 0;
  const room = app.stats.replyRoom ?? 0;
  const text = memoryWarning(used, app.ctx, room);
  if (!text) return null;
  return <Box paddingX={2} width={app.width}><Text color={used + room >= app.ctx * 0.85 ? C.warn : C.dim} wrap="truncate-end">{text}</Text></Box>;
}

// The status line under the footer (/meters on): model, speed, memory, effort. On a remote, the
// server's figures in place of this Mac's RAM: speeds, the first token, GPU memory, the cost, the ping
// (remote-footer.mjs meterWords).
export function Meters({ app }) {
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
export function StartIcon({ app }) {
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
  // grouped (/steps): the task row under way and the last two steps of its row (task-rows.jsx LiveRun);
  // words: the last two steps under way
  const ctx = { model: app.modelName, cwd: app.cwdShort, loaded: app.loaded, start: app.start };
  if (held?.type === 'tasklive') blocks.push(<LiveRun key="held" live={held} width={width} drawSteps={(list, w) => stepsDrawn(list, w, ctx)} />);
  else if (Array.isArray(held)) blocks.push(<Box key="held" flexDirection="column">{stepsDrawn(held.slice(-2), width, ctx)}</Box>);
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
