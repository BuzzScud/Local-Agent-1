// The conversation as a rail (design 2 of 29 Sep 2026, the user's pick), tightened (design 1 · Tight
// rail of 8 Oct 2026, the user's pick): your message on a grey row, then every step of the turn
// on its own row beside one thin line, each with a mark for its kind, and the turn closed with ╰─
// and how it ended.
//   ◇ a thought  ● a reply   ✎ a file made or changed   ○ a read, a list, a search
//   ❯ a command  ◎ the layout check   ⊘ not allowed / you said no   ✗ an error   · a note
// Steps sit on consecutive rows: no empty rail row between two steps (8 Oct 2026: 322 of the 1,129
// rows of a conversation were those). A run of reads, lists and searches is one row (foldSteps);
// a reply has an empty row above and under it; the end line is two rows, how it went and its counts.
// No step says "(ctrl+o …)": ctrl+o still opens them all.
import React from 'react';
import { homedir } from 'node:os';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { C, MARK, fmtSecs } from '../ui/theme.mjs';
import { wrap } from '../ui/parts.jsx';
import { Markdown } from './markdown.jsx';
import { money } from '../agent/spend.mjs';
import { readResults } from '../flows/results.mjs';

export const RAIL = 'ansi256(243)'; // #767676: C.faint (#585858) all but vanishes as a thin line on a dark window
const STRIP = 'ansi256(236)'; // #303030, the grey row under your message
const PATH = 'ansi256(250)';
const CODE = 'ansi256(252)';
const OUT = 'ansi256(247)'; // a command's output, a step down from the words of the steps
const WHITE = 'ansi256(255)';
// "match" → "matches" (4 Oct 2026: the Search line said "0 matchs").
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : /(?:s|x|z|ch|sh)$/.test(w) ? 'es' : 's'}`;
const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' '); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const base = (p) => String(p ?? '').split('/').filter(Boolean).pop() ?? String(p ?? '');

// A step: its mark in the rail's column, its words beside it.
export const Node = ({ g, c, children }) => (
  <Box flexDirection="row">
    <Box width={4} flexShrink={0}><Text color={c}>{'  '}{g}</Text></Box>
    <Box flexDirection="column" flexGrow={1} flexShrink={1}>{children}</Box>
  </Box>
);
// The rail going on beside a step's lines (its output, its changed lines). It is the left border
// of their box, so a line that wraps keeps the rail beside every row.
export const Pipe = ({ children }) => (
  <Box flexDirection="row">
    <Box width={2} flexShrink={0} />
    <Box borderStyle="single" borderTop={false} borderRight={false} borderBottom={false} borderColor={RAIL} paddingLeft={1} flexDirection="column" flexGrow={1} flexShrink={1}>{children ?? <Text> </Text>}</Box>
  </Box>
);
const Head = ({ verb, c, what, detail }) => (
  <Text wrap="truncate-end"><Text color={c} bold>{verb}</Text>{what ? <Text color={PATH}>  {what}</Text> : null}{detail ? <Text color={C.dim}> · {detail}</Text> : null}</Text>
);
// A step's row whose end stays whole (an exit code, a count, a seconds) after words that may be
// cut: a command is one row, cut with …, never wrapped onto rows without the rail.
const HeadEnd = ({ verb, c, what, end, endColor = C.dim }) => (
  <Box flexDirection="row">
    <Box flexShrink={1}><Text wrap="truncate-end"><Text color={c} bold>{verb}</Text><Text color={PATH}>  {what}</Text></Text></Box>
    {end ? <Box flexShrink={0}><Text color={endColor}> · {cut(end, 48)}</Text></Box> : null}
  </Box>
);
const More = ({ n }) => <Pipe><Text color={C.faint}>… {n} more {n === 1 ? 'line' : 'lines'}</Text></Pipe>;

// Your message: a grey row across the window, one for each of its lines (8 Oct 2026: before, a
// grey row of padding above and under it too).
// cards: the files dropped or pasted with it ([File #2] …), one line, each as the tray's card said
// it (attach.mjs compactText: "▣ [File #2] budget.xlsx · Excel · 3 sheets · 48 KB"); kept with the
// conversation, so /resume shows it again.
// Text cut to `w` columns, with … where it was cut.
const fitTo = (s, w) => { if (stringWidth(s) <= w) return s; let out = ''; for (const ch of s) { if (stringWidth(`${out}${ch}…`) > w) break; out += ch; } return `${out}…`; };
export function UserStrip({ text, attached, cards, width }) {
  const inner = Math.max(10, width - 4);
  const lines = String(text).split('\n').flatMap((l) => (l.trim() ? wrap(l, inner) : ['']));
  const row = (content, key) => <Text key={key} backgroundColor={STRIP}>{content}</Text>;
  const cardLine = cards?.length ? fitTo(cards.map((c) => c.text).join('   '), inner) : '';
  return (
    <Box flexDirection="column" width={width}>
      {lines.map((l, i) => row(<>{' '}<Text color={C.accent}>{i === 0 ? '›' : ' '}</Text>{' '}<Text color={WHITE}>{l.padEnd(inner)}</Text>{' '}</>, i))}
      {cardLine ? row(<>{'   '}<Text color={C.dim}>{cardLine}{' '.repeat(Math.max(0, inner - stringWidth(cardLine)))}</Text>{' '}</>, 'cards') : null}
      {attached?.length ? row(<>{'   '}<Text color={C.dim}>{`Attached ${attached.map((a) => `${a.path} (${a.label ?? plural(a.lines, 'line')})`).join(', ')}`.slice(0, inner).padEnd(inner)}</Text>{' '}</>, 'att') : null}
    </Box>
  );
}

// What came along with the request, in one dim line under it: the notes, the design cards, how it
// was sorted. ctrl+o lists the notes.
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
  <Node g="┊" c={RAIL}><Text color={C.faint} wrap="truncate-end">{machineWords(it)}</Text></Node>
);

// A meter of `cells` blocks; `frac` 0–1.
export const meter = (frac, cells = 8) => {
  const n = Math.min(cells, Math.max(frac > 0 ? 1 : 0, Math.round(frac * cells)));
  return '▰'.repeat(n) + '▱'.repeat(cells - n);
};
export const kTok = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
// At this share of a limit a meter turns orange: the cut is near.
export const NEAR = 0.85;

// The gist of a thought, for its row once done: its first sentence that says something (small
// models open with "Let me check the details." and the step-down closes with "I have thought
// enough. Now I act on it."). A new sentence starts with a capital, so a ? or ! inside quotes
// ("? for shortcuts") no longer ends one (8 Oct 2026: the row read 'wait for the "').
const FILLER = /^(i need to look into this|let me (check|look|think)( at)? (the|this|it)|i have thought enough|now i act on it|okay|ok|hmm+|alright|so|wait)\b/i;
export function gist(text, max = 200) {
  const s = String(text ?? '').split(/\n+|(?<=[.!?])\s+(?=[A-Z(`"'])/).map((x) => x.replace(/\s+/g, ' ').trim()).find((x) => x.length >= 12 && !FILLER.test(x));
  if (!s) return '';
  const t = s.replace(/[.!?]$/, '');
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
// A thought, done: one dim row, its first sentence cut to the row, the seconds kept at the end.
export const ThoughtNode = ({ it }) => {
  const g = gist(it.text);
  return (
    <Node g="◇" c={C.think}>
      <Box flexDirection="row">
        <Box flexShrink={1}><Text color={C.dim} italic wrap="truncate-end">{g || `thought${it.tokens ? ` · ${plural(it.tokens, 'token')}` : ''}`}</Text></Box>
        <Box flexShrink={0}><Text color={C.faint}>  {fmtSecs(Math.max(1, it.secs))}</Text></Box>
      </Box>
    </Node>
  );
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

export const ReplyNode = ({ text }) => <Node g="●" c={WHITE}><Markdown text={text} /></Node>;

// A tool's step, by what it did.
const kb = (b) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`);
// A path as short as it reads the same (7 Oct 2026): inside the project, from the project; anywhere
// else in your home folder, from ~.
const HOME_DIR = homedir();
export function shortPath(p, cwd) {
  const s = String(p ?? '');
  if (cwd && cwd !== HOME_DIR && s.startsWith(`${cwd}/`)) return s.slice(cwd.length + 1);
  return HOME_DIR && (s === HOME_DIR || s.startsWith(`${HOME_DIR}/`)) ? `~${s.slice(HOME_DIR.length)}` : s;
}
// Where a step's file is. A Write outside the project kept a path relative to it
// (../../../../tmp/x.mjs, 8 Oct 2026): the path the model gave reads better.
const where = (it, cwd) => {
  const p = it.view?.path ?? it.arg;
  return shortPath(/^(\.\.\/)+/.test(String(p)) && it.arg ? it.arg : p, cwd);
};
// A command as short as it reads the same: a cd into the project in front of it dropped, the home
// folder written ~ (cd ~/Desktop/agentic-coder && git log …).
export function shortCommand(cmd, cwd) {
  let s = String(cmd ?? '');
  if (cwd && cwd !== HOME_DIR) for (const c of [cwd, shortPath(cwd)]) if (s.startsWith(`cd ${c} && `) || s.startsWith(`cd ${c}/ && `)) s = s.slice(s.indexOf('&& ') + 3);
  return HOME_DIR ? s.split(`${HOME_DIR}/`).join('~/').split(HOME_DIR).join('~') : s;
}
// A command as its step's head shows it: a script typed in (a heredoc) by its first line, how many
// more, and the file it was saved as (4 Oct 2026: a 196-line heredoc filled the window at every step;
// ctrl+o still shows it whole).
export function cmdShown(arg, saved) {
  const s = String(arg ?? '');
  if (!s.includes('\n')) return s;
  const lines = s.split('\n');
  return `${lines[0]} … +${lines.length - 1} lines${saved ? ` · ${saved}` : ''}`;
}
// What a command's row says at its end (the owner's pick, 8 Oct 2026): a test run's counts, else
// how it ended or how many lines it wrote. The output keeps its first and last lines with a line
// "… N lines cut …" between (tools/run.mjs), which counts as the lines it stands for.
export function outcome(arg, v) {
  const lines = (v.lines ?? []).filter((l) => l.trim());
  const n = lines.reduce((s, l) => s + (Number(/^… (\d+) lines cut …$/.exec(l)?.[1]) || 1), 0);
  if (v.timedOut) return { end: `stopped after ${v.after ?? '2 minutes'}`, color: C.warn };
  const out = lines.join('\n');
  let r = readResults(out, v.code ?? 0);
  // bun test's own summary (" 13 pass" / " 0 fail"), which readResults does not read.
  if (r.passed == null) { const p = /^\s*(\d+) pass$/m.exec(out); const f = /^\s*(\d+) fail$/m.exec(out); if (p && f) r = { passed: +p[1], failed: +f[1] }; }
  if (r.passed != null && /\btest\b|pytest|jest|vitest|mocha|unittest/.test(String(arg))) return { end: `${r.passed} pass · ${r.failed} fail${v.code ? ` · exit ${v.code}` : ''}`, color: r.failed || v.code ? C.bad : C.ok };
  if (v.code) return { end: `exit ${v.code}`, color: C.bad };
  return { end: n ? plural(n, 'line') : 'no output', color: C.dim };
}

// Reads, lists and searches in a row are one row (8 Oct 2026: 49 of them took 49 rows and as many
// empty ones). Finished rows are printed once and never change, so a run still open at the end of a
// turn under way is held in the live area (screen.jsx) until the next step closes it.
const LOOKS = new Set(['read', 'list', 'search', 'same', 'screen', 'toolsearch', 'websearch', 'fetched']);
const looks = (it) => it.rail && it.type === 'tool' && !it.error && LOOKS.has(it.view?.kind);
const group = (run) => (run.length === 1 ? run[0] : { type: 'looks', rail: true, key: `g${run[0].key}`, list: run });
export function foldSteps(items, open = false) {
  const printed = [];
  let run = [];
  for (const it of items) {
    if (looks(it)) { run.push(it); continue; }
    if (run.length) printed.push(group(run));
    run = [];
    printed.push(it);
  }
  if (run.length && open) return { printed, held: group(run) };
  if (run.length) printed.push(group(run));
  return { printed, held: null };
}
// What one look says in a folded row: a file by its name (its path when two have that name), a
// search by its words and matches, a list by its folder and paths.
function lookPiece(it, cwd, names) {
  const v = it.view ?? {};
  switch (v.kind) {
    case 'read': case 'same': { const p = where(it, cwd); return { verb: 'Read', what: names.get(base(p)) > 1 ? p : base(p) }; }
    case 'search': return { verb: 'Searched', what: `“${it.arg}” ${v.count}` };
    case 'list': return { verb: 'Listed', what: `${shortPath(it.arg, cwd) || '.'} ${v.count}` };
    case 'websearch': return { verb: 'Searched the web', what: `“${it.arg}” ${v.count}` };
    case 'fetched': return { verb: 'Fetched', what: String(it.arg) };
    case 'toolsearch': return { verb: 'Searched the tools', what: it.arg };
    default: return { verb: 'Looked at', what: v.what ?? it.arg };
  }
}
function lookRuns(list, cwd) {
  const names = new Map();
  for (const it of list) if (it.view?.kind === 'read') { const b = base(where(it, cwd)); names.set(b, (names.get(b) ?? 0) + 1); }
  // Pieces in a row with the same verb share it ("Read a.mjs, b.mjs · Searched “x” 4"); the same
  // file twice reads "×2".
  const runs = [];
  for (const it of list) {
    const p = lookPiece(it, cwd, names);
    const last = runs.at(-1);
    if (last?.verb === p.verb) { const i = last.what.indexOf(p.what); if (i < 0) { last.what.push(p.what); last.n.push(1); } else last.n[i]++; }
    else runs.push({ verb: p.verb, what: [p.what], n: [1] });
  }
  return runs.map((r) => ({ verb: r.verb, what: r.what.map((w, i) => (r.n[i] > 1 ? `${w} ×${r.n[i]}` : w)) }));
}
export function LooksNode({ list, cwd }) {
  const runs = lookRuns(list, cwd);
  return (
    <Node g="○" c={C.dim}>
      <Text wrap="truncate-end">{runs.map((r, i) => <Text key={i}>{i ? <Text color={C.faint}>  ·  </Text> : null}<Text color={PATH} bold>{r.verb}</Text><Text color={PATH}>  {r.what.join(', ')}</Text></Text>)}</Text>
    </Node>
  );
}

export function ToolNode({ it, cwd }) {
  const v = it.view ?? {};
  const what = where(it, cwd);
  switch (v.kind) {
    case 'diff': {
      if (v.created) {
        const bytes = v.hunk.reduce((n, l) => n + Buffer.byteLength(l.text ?? '') + 1, 0);
        const shown = v.hunk.slice(0, 4);
        return (
          <Box flexDirection="column">
            <Node g="✎" c={C.edits}><HeadEnd verb="Created" c={C.edits} what={what} end={`${plural(v.additions ?? v.hunk.length, 'line')} · ${kb(bytes)}`} /></Node>
            {shown.map((l, i) => <Pipe key={i}><Text wrap="truncate-end"><Text color={C.faint}>{String(l.newNo ?? '').padStart(4)}  </Text><Text color={CODE}>{l.text || ' '}</Text></Text></Pipe>)}
            {v.hunk.length > 4 ? <More n={v.hunk.length - 4} /> : null}
          </Box>
        );
      }
      const changed = v.hunk.filter((l) => l.type !== ' ');
      const shown = changed.slice(0, 6);
      const a = v.additions ?? 0, r = v.removals ?? 0;
      const detail = a && a === r ? plural(a, 'line') : a && !r ? `+${plural(a, 'line')}` : r && !a ? `−${plural(r, 'line')}` : a ? `+${a} −${r}` : 'no change';
      return (
        <Box flexDirection="column">
          <Node g="✎" c={C.edits}><HeadEnd verb="Changed" c={C.edits} what={what} end={detail} /></Node>
          {shown.map((l, i) => <Pipe key={i}><Text wrap="truncate-end"><Text color={C.faint}>{String((l.type === '-' ? l.oldNo : l.newNo) ?? '').padStart(4)}  </Text><Text color={l.type === '+' ? C.ok : C.bad}>{l.type} {l.text}</Text></Text></Pipe>)}
          {changed.length > 6 ? <More n={changed.length - 6} /> : null}
        </Box>
      );
    }
    case 'read': return <Node g="○" c={C.dim}><Head verb={v.outline ? 'Outline' : 'Read'} c={PATH} what={what} detail={v.outline ? `${v.parts > 0 ? plural(v.parts, 'part') : 'no parts'} of ${plural(v.total, 'line')}` : `${plural(v.lines, 'line')}${v.total > v.lines ? ` of ${v.total}` : ''}`} /></Node>;
    case 'screen': return <Node g="○" c={C.dim}><Head verb="Looked at" c={PATH} what={v.what} detail={`${v.size} · a picture, nothing clicked`} /></Node>;
    case 'same': return <Node g="○" c={C.dim}><Head verb="Read" c={PATH} what={what} detail="already read above, unchanged" /></Node>;
    case 'list': return <Node g="○" c={C.dim}><Head verb="Listed" c={PATH} what={shortPath(it.arg, cwd)} detail={plural(v.count, 'path')} /></Node>;
    case 'search': return <Node g="○" c={C.dim}><Head verb="Searched" c={PATH} what={it.arg} detail={plural(v.count, 'match')} /></Node>;
    case 'agent': return <Node g="◆" c={it.error ? C.bad : C.accent}><Head verb={it.label} c={it.error ? C.bad : C.accent} what={it.arg} detail={`${plural(v.steps ?? 0, 'step')} · ${fmtSecs(v.secs ?? 0)}${v.reason && !['done', 'answered'].includes(v.reason) ? ` · ${v.reason}` : ''}`} /></Node>;
    case 'websearch': return <Node g="○" c={C.dim}><Head verb="Searched the web" c={PATH} what={it.arg} detail={`${plural(v.count, 'result')}${v.service ? ` · ${v.service}` : ''}`} /></Node>;
    case 'fetched': return v.moved
      ? <Node g="○" c={C.warn}><Head verb="Fetched" c={C.warn} what={it.arg} detail={`moves to ${v.moved}, not followed`} /></Node>
      : <Node g="○" c={C.dim}><Head verb="Fetched" c={PATH} what={it.arg} detail={[kb(v.bytes ?? 0), v.lines ? `${plural(v.lines, 'line')}${v.total > v.lines ? ` of ${v.total}` : ''}` : ''].filter(Boolean).join(' · ')} /></Node>;
    // A command: one row, what it came to at its end, then two lines of its output (the last two
    // when it failed, where the error is).
    case 'bash': {
      const lines = (v.lines ?? []).filter((l) => l.trim());
      const o = outcome(it.arg, v);
      const shown = v.code || v.timedOut ? lines.slice(-2) : lines.slice(0, 2);
      return (
        <Box flexDirection="column">
          <Node g="❯" c={C.edits}><HeadEnd verb="Ran" c={C.edits} what={shortCommand(cmdShown(it.arg, v.saved), cwd)} end={o.end} endColor={o.color} /></Node>
          {shown.map((l, i) => <Pipe key={i}><Text color={OUT} wrap="truncate-end">{l}</Text></Pipe>)}
        </Box>
      );
    }
    // A background command (tools/jobs.mjs): started, looked at, or stopped, and its newest lines.
    case 'job': {
      const shown = (v.lines ?? []).filter((l) => l.trim()).slice(-2);
      // Its words without the job's name again ("job2 · running 1 min 56 s" under "Jobs  job2").
      const said = String(v.what ?? '');
      const end = said.startsWith(`${it.arg} · `) ? said.slice(String(it.arg).length + 3) : said;
      return (
        <Box flexDirection="column">
          <Node g="❯" c={C.edits}><HeadEnd verb={it.label === 'Jobs' ? 'Jobs' : 'Started'} c={C.edits} what={shortCommand(cmdShown(it.arg), cwd)} end={shortCommand(end, cwd)} /></Node>
          {shown.map((l, i) => <Pipe key={i}><Text color={OUT} wrap="truncate-end">{l}</Text></Pipe>)}
        </Box>
      );
    }
    // What the app read for the model before its first step: one row (ctrl+o shows the command and the rest).
    case 'opening': return <Node g="○" c={C.dim}><Head verb={v.title} c={PATH} detail={(v.lines ?? []).join(' · ')} /></Node>;
    case 'todos': return (
      <Box flexDirection="column">
        <Node g="☐" c={C.ok}><Text bold>{it.label === 'Plan' ? 'Plan' : 'Update Todos'}<Text color={C.dim} bold={false}> · {v.items.filter((t) => t.status === 'done').length} of {v.items.length} done</Text></Text></Node>
        {v.items.map((t, i) => <Pipe key={i}><Text color={t.status === 'done' ? C.dim : undefined} strikethrough={t.status === 'done'} bold={t.status === 'in_progress'} wrap="truncate-end">{t.status === 'done' ? '☒' : '☐'} {t.text}</Text></Pipe>)}
      </Box>
    );
    // A tool of an MCP server: its server and name, its arguments in a few words, then the first lines it answered.
    case 'mcp': {
      const lines = String(v.content ?? '').split('\n').filter((l) => l.trim());
      const shown = v.looked ? [] : lines.slice(0, 2);
      const c = it.error ? C.bad : C.accent;
      return (
        <Box flexDirection="column">
          <Node g="◈" c={c}><Head verb={it.label} c={c} what={it.arg} detail={v.looked ? 'its arguments, nothing ran' : [it.error ? 'the tool reported an error' : null, v.pictures ? `${plural(v.pictures, 'picture')}${v.shown ? '' : ' not shown'}` : null, v.ms >= 1000 ? fmtSecs(v.ms / 1000) : null, lines.length > shown.length ? plural(lines.length, 'line') : null].filter(Boolean).join(' · ') || 'MCP'} /></Node>
          {shown.map((l, i) => <Pipe key={i}><Text color={it.error ? C.bad : OUT} wrap="truncate-end">{l}</Text></Pipe>)}
        </Box>
      );
    }
    case 'toolsearch': return <Node g="○" c={C.dim}><Head verb="Searched the tools" c={PATH} what={it.arg} detail={v.tools?.length ? `loaded ${v.tools.join(', ')}` : 'nothing found'} /></Node>;
    case 'denied': return <Node g="⊘" c={C.warn}><HeadEnd verb="Not allowed" c={C.warn} what={`${it.label}(${shortCommand(cmdShown(it.arg), cwd)})`} end={v.message} endColor={C.warn} /></Node>;
    case 'declined': return <Node g="⊘" c={C.dim}><HeadEnd verb="You said no" c={C.dim} what={`${it.label}(${shortCommand(cmdShown(it.arg), cwd)})`} end={v.feedback || ''} /></Node>;
    case 'answer': return <Node g="›" c={C.accent}><Head verb={it.label} c={C.accent} what={it.arg} /><Text wrap="truncate-end"><Text color={C.dim}>You: </Text>{v.text}</Text></Node>;
    case 'error': return <Node g="✗" c={C.bad}><HeadEnd verb={it.label} c={C.bad} what={what} end={`Error: ${v.message}`} endColor={C.bad} /></Node>;
    // Remember and the rest: the words wrap under their head (a fact saved is worth reading whole).
    default: return <Node g="●" c={it.error ? C.bad : C.ok}><Text><Text color={it.error ? C.bad : C.ok} bold>{it.label}</Text>{it.arg ? <Text color={PATH}>  {it.arg}</Text> : null}</Text></Node>;
  }
}

// A check of the app's own, as a step: the layout check (flows/layoutcheck.mjs), and since 4 Oct 2026 the
// page check (page-read.mjs) and the second look (second-look.mjs), which were loose notes before.
// title, ok (the words for nothing wrong) and where (how it looked) default to the layout check's.
export function CheckNode({ check }) {
  const n = check.problems.length;
  const title = check.title ?? 'Layout check';
  const at = check.where ?? `1440 px, phone, dark · ${check.secs.toFixed(1)} s`;
  if (!n) return <Node g="◎" c={C.ok}><Text><Text color={C.ok} bold>{title}</Text>{check.page ? <Text color={PATH}>  {check.page}</Text> : null}<Text color={C.ok}>  ✓ {check.ok ?? 'nothing broken'}</Text><Text color={C.dim}> · {at}</Text></Text></Node>;
  return (
    <Box flexDirection="column">
      <Node g="◎" c={C.warn}><Text><Text color={C.warn} bold>{title}</Text>{check.page ? <Text color={PATH}>  {check.page}</Text> : null}<Text color={C.warn}>  ✗ {check.bad ?? `${plural(n, 'problem')}${check.again ? ' left' : ''}`}</Text><Text color={C.dim}> · {at}{(check.sent ?? !check.again) ? ' · sent back to fix' : ''}</Text></Text></Node>
      {check.problems.slice(0, 6).map((p, i) => <Pipe key={i}><Text color={PATH}>{p}</Text></Pipe>)}
      {n > 6 ? <Pipe><Text color={C.dim}>… {n - 6} more</Text></Pipe> : null}
    </Box>
  );
}

// What the message made or changed, under its answer (4 Oct 2026: the answers named files and sizes in
// their own words, and one called an empty page done): one row of the files by name; a page whose
// check found it empty gets a row of its own.
export function MadeNode({ files }) {
  const made = files.filter((f) => f.created).length;
  return (
    <Box flexDirection="column">
      <Node g="▣" c={C.ok}>
        <Box flexDirection="row">
          <Box flexShrink={0}><Text><Text color={C.ok} bold>Made</Text><Text color={C.dim}>  {[made && `${made} new`, files.length - made && `${files.length - made} changed`].filter(Boolean).join(', ')} · </Text></Text></Box>
          <Box flexShrink={1}><Text color={PATH} wrap="truncate-end">{files.map((f) => base(f.path)).join(', ')}</Text></Box>
        </Box>
      </Node>
      {files.filter((f) => f.empty && f.page).map((f, i) => <Pipe key={i}><Text color={C.warn}>{base(f.path)}: {f.page}</Text></Pipe>)}
    </Box>
  );
}

// A note that came during the turn.
export const NoteNode = ({ it }) => {
  const color = it.tone === 'error' ? C.bad : it.tone === 'warn' ? C.warn : it.tone === 'ok' ? C.ok : C.dim;
  return <Node g={it.tone === 'error' ? '✗' : '·'} c={color}><Text color={color}>{it.text}</Text></Node>;
};

// The turn's end: how it went in one row (its time, when it was done, what it cost), its counts in
// a dim row under it. counts: screen.jsx doneCounts, " · 5 steps · 3 reads …".
const clock = (t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
export function EndLine({ it, counts = '' }) {
  const more = String(counts).replace(/^ · /, '');
  return (
    <Box flexDirection="column">
      <Box flexDirection="row"><Box width={5} flexShrink={0}><Text color={RAIL}>{'  ╰─ '}</Text></Box><Box flexGrow={1} flexShrink={1}><EndWords it={it} /></Box></Box>
      {more ? <Box paddingLeft={5}><Text color={C.faint}>{more}</Text></Box> : null}
    </Box>
  );
}
function EndWords({ it }) {
  // What the request cost on a paid service (/remote, spend.mjs).
  const cost = it.usd > 0 ? <Text color={C.dim}> · {money(it.usd)} for this request</Text> : null;
  if (it.reason === 'interrupted') return <Text><Text color={C.warn}>■ {it.text ?? 'Interrupted · What should Agentic Coder do instead?'}</Text>{cost}</Text>;
  if (it.reason && it.reason !== 'done') return <Text><Text color={it.left ? C.warn : C.dim}>{it.text ?? `Stopped (${it.reason})`}{it.left ? ` · ${plural(it.left, 'layout problem')} left` : ''}</Text><Text color={C.dim}>{it.secs >= 1 ? ` · ${fmtSecs(it.secs)}` : ''} · {clock(it.at)}</Text>{cost}</Text>;
  const left = it.left ? <Text color={C.warn}>✗ Ended with {plural(it.left, 'layout problem')} left · </Text> : null;
  return <Text>{left}<Text color={it.left ? C.warn : C.accent}>{it.left ? '' : `${MARK} `}</Text>{it.secs >= 1 ? <Text color={WHITE}>{it.past} for {fmtSecs(it.secs)}</Text> : null}<Text color={C.dim}>{it.secs >= 1 ? ' · ' : ''}done {clock(it.at)}</Text>{cost}</Text>;
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
// A tool running: one row, its seconds counting at the end.
export function RunningNode({ running, secs, cwd }) {
  return <Node g="▸" c={C.edits}><HeadEnd verb={running.label === 'Bash' ? 'Running' : running.label} c={C.edits} what={shortCommand(cmdShown(running.arg), cwd)} end={fmtSecs(secs)} endColor={C.accent} /></Node>;
}
export const doingWords = (live) => {
  const w = writingWhat(live.writing);
  if (w?.file) return `writing ${w.file}`;
  if (live.running) return `running ${live.running.label}`;
  if (live.thinking && !live.text) return 'thinking';
  return '';
};
