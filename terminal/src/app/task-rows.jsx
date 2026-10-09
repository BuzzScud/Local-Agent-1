// Task rows (9 Oct 2026 afternoon, the owner on two screenshots of many small boxes: "can we categorize /
// group the boxes together a bit more?"; their pick of three live designs, "3 · Task rows", the model's line
// cut to one row, in place of a box for each stretch). The model's short line and the steps after it are one
// row; neighbouring rows of one kind of work are one task row, its title and colour from that work (rail.jsx
// groupTask); the task rows of one answer share a box, whose bottom edge holds the answer's totals. A task
// row opens to its rows, a row to its steps (App.jsx openGroups). Their 9 Oct "split the big files"
// conversation: 307 rows in 65 boxes → 90 rows in 3.
//
// Printed rows never change, so nothing is printed until it is settled: a task row once a row of another
// kind has finished (or the box ends), the box's bottom edge once what follows the box is printed. The
// task row under way, the line the model just said and the steps after it stay in the live area (LiveRun).
import React from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { C } from '../ui/theme.mjs';
import { TASKS, groupFacts, isWork, idOf, fileWords, plural, PATH, WHITE, BOX_ASK, BOX_EDIT, FailRow, Pieces, fitPieces } from './rail.jsx';

const EDGE = 'ansi256(239)'; // the box: quiet grey, the task titles carry the colour
const TAG = 11; // COMMITTING and a space
const work = (it) => it.type === 'group' || isWork(it);
const listOf = (it) => (it.type === 'group' ? it.list : [it]);
const flatOf = (list) => list.flatMap((it) => (it.type === 'looks' ? it.list : [it]));
// A line the model says between steps ("Now the fast tests."): short, one paragraph. A longer answer (an
// analysis, a plan, a list, a table) is never folded: it stays in the open and the box ends above it.
export const said = (it) => Boolean(it?.rail) && it.type === 'text' && String(it.text).trim().length <= 300 && !/\n/.test(String(it.text).trim());
// a stretch that did something (a step, or an answer of yours); a turn's notes after its answer did not
const did = (it) => work(it) && flatOf(listOf(it)).some((x) => x.type === 'tool' || (x.type === 'user' && x.rail));
const oneLine = (s) => String(s ?? '').replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();
// Looking (a read, a search, a thought) belongs to what it was for: the next row that acts.
const SUPPORT = new Set(['exploring', 'thinking']);

// What a row says when the model said nothing before it: its first step, in a few words.
const VERB = { bash: 'Ran', job: 'Ran', diff: 'Changed', read: 'Read', same: 'Read', list: 'Listed', search: 'Searched', websearch: 'Searched the web', fetched: 'Fetched', answer: 'Asked' };
function firstStep(list) {
  const flat = flatOf(list);
  const t = flat.find((it) => it.type === 'tool');
  if (t) return `${VERB[t.view?.kind] ?? t.label} ${oneLine(t.arg)}`;
  if (flat.some((it) => it.type === 'thinking')) return 'Thought it over';
  return flat[0]?.text ? oneLine(flat[0].text) : 'Steps';
}
function rowOf(line, stretch, seen) {
  const list = stretch ? listOf(stretch) : [];
  const first = line ?? (list[0].type === 'looks' ? list[0].list[0] : list[0]);
  const f = list.length ? groupFacts(list) : null;
  return { id: idOf(first, seen), text: line ? oneLine(line.text) : null, full: line?.text ?? null, guess: line ? null : firstStep(list), list, facts: f, task: f?.task ?? null };
}
const runOf = (rows, task) => ({ id: `u${rows[0].id}`, task, rows });

// The printed list (rail.jsx groupWork's, with the stretch under way as held) as task rows. Returns what is
// printed, in order, and what the live area shows (held: { type: 'tasklive', … } or null).
//   { type: 'taskrun', id, run, first, open, openRows }   a task row; first: the box's top edge above it
//   { type: 'taskend', rows }                           the box's bottom edge, its newest failure over it
export function taskRows(printed, { held = null, working = false, open = null } = {}) {
  const out = [];
  const seen = new Map();
  const isOpen = (id) => Boolean(open?.has(id));
  let live = null;
  let seg = [];
  const flush = (atEnd) => {
    const going = atEnd && working;
    // the rows: a line and the stretch after it, a stretch with no line before it, a line with no stretch after
    // it (another line came). Not going: what follows the last stretch that did something is the turn's answer.
    let end = -1;
    seg.forEach((x, i) => { if (did(x)) end = i; });
    let lineNow = null;
    if (going) { end = seg.length - 1; if (said(seg[end])) { lineNow = seg[end]; end -= 1; } }
    const rows = [];
    for (let i = 0; i <= end; i++) {
      const x = seg[i];
      if (said(x) && i + 1 <= end && work(seg[i + 1])) { rows.push(rowOf(x, seg[i + 1], seen)); i++; }
      else rows.push(said(x) ? rowOf(x, null, seen) : rowOf(null, x, seen));
    }
    // task rows: a row that acts has its own kind; looking before it takes that kind
    const lastAct = rows.findLastIndex((r) => r.task && !SUPPORT.has(r.task));
    const runs = [];
    let next = null;
    const kind = rows.map((r) => r.task);
    for (let i = lastAct; i >= 0; i--) { if (kind[i] && !SUPPORT.has(kind[i])) next = kind[i]; else kind[i] = next; }
    rows.slice(0, lastAct + 1).forEach((r, i) => { const last = runs.at(-1); if (last?.task === kind[i]) last.rows.push(r); else runs.push(runOf([r], kind[i])); });
    // looking after the last row that acts: with the task row before it, or a task row of its own
    const after = rows.slice(lastAct + 1);
    let now = null;
    if (going) {
      now = runs.pop() ?? null;
      // only looking so far: it takes the kind of the row under way, once that acts (LiveRun)
      if (after.length) now = now ? { ...now, rows: [...now.rows, ...after] } : { ...runOf(after, after.find((r) => r.task)?.task ?? 'thinking'), looking: true };
    } else if (after.length) {
      if (runs.length) runs.at(-1).rows.push(...after);
      else runs.push(runOf(after, after.find((r) => r.task)?.task ?? 'thinking'));
    }
    runs.forEach((run, i) => {
      const openRows = run.rows.filter((r) => isOpen(r.id)).map((r) => r.id);
      const on = isOpen(run.id);
      out.push({ type: 'taskrun', rail: true, id: run.id, key: `${run.id}${i ? '' : ':1'}${on ? `:o${openRows.join('.')}` : ''}`, run, first: i === 0, open: on, openRows: new Set(openRows) });
    });
    if (going) {
      const list = held ?? [];
      if (now || lineNow || list.length) live = { type: 'tasklive', run: now, line: lineNow ? oneLine(lineNow.text) : null, list, first: !runs.length };
    } else if (runs.length) out.push({ type: 'taskend', rail: true, key: `${runs[0].id}:end`, rows: runs.flatMap((r) => r.rows) });
    if (!going) for (const x of seg.slice(end + 1)) out.push(...(x.type === 'group' ? x.list : [x]));
    seg = [];
  };
  for (const it of printed) {
    if (said(it) || work(it)) { seg.push(it); continue; }
    flush(false);
    out.push(it);
  }
  flush(true);
  return { printed: out, held: live };
}

const allOf = (rows) => groupFacts(rows.flatMap((r) => r.list));
// How much a row or task row did, at its right end: answers, the last test run, failures, files, its rows
// (a task row), its steps. The steps end every row in one column.
function endPieces(f, { parts = 0 } = {}) {
  if (!f) return [{ t: 'said', c: C.faint }];
  const out = [];
  const add = (t, c) => { if (out.length) out.push({ t: '  ', c: C.dim }); out.push({ t, c }); };
  if (f.answers.length) add(`? ${plural(f.answers.length, 'answer')}`, BOX_ASK);
  if (f.test) add(f.test.words, f.test.bad ? C.bad : C.ok);
  if (f.failures.length) add(`✗ ${f.failures.length}`, C.bad);
  if (f.files.length) add(`✎ ${f.files.length === 1 ? fileWords(f.files)[0] : `${f.files.length} files`}`, BOX_EDIT);
  if (parts) add(plural(parts, 'part'), C.dim);
  const size = f.steps ? plural(f.steps, 'step') : f.thoughts ? plural(f.thoughts, 'thought') : f.answers.length ? 'answered' : 'note';
  add(size.padStart(parts ? 8 : 10), C.dim);
  return out;
}
const widthOf = (pieces) => pieces.reduce((n, p) => n + stringWidth(p.t), 0);
// One row inside the box: what leads it, its words (cut with …), its end at the right edge.
function Line({ lead, words, wordsColor = WHITE, end, width }) {
  const ends = fitPieces(end, Math.max(10, Math.floor(width * 0.45)));
  const room = width - widthOf(lead) - ends.used - 2;
  const text = fitPieces([{ t: words, c: wordsColor }], Math.max(4, room));
  const gap = Math.max(2, width - widthOf(lead) - text.used - ends.used);
  return <Text wrap="truncate-end"><Pieces pieces={lead} /><Pieces pieces={text.pieces} /><Text>{' '.repeat(gap)}</Text><Pieces pieces={ends.pieces} /></Text>;
}
// The box's top edge (plain) and bottom edge (the answer's totals in it), drawn by hand.
function Edge({ top, words = [], width }) {
  if (top) return <Text color={EDGE}>╭{'─'.repeat(width - 2)}╮</Text>;
  const room = width - 5;
  const { pieces, used } = fitPieces(words, room);
  return <Text><Text color={EDGE}>╰─ </Text><Pieces pieces={pieces} /><Text color={EDGE}> {'─'.repeat(Math.max(0, room - used))}╯</Text></Text>;
}
const Sides = ({ width, children }) => (
  <Box marginLeft={2} width={width} borderStyle="round" borderTop={false} borderBottom={false} borderColor={EDGE} paddingX={1} flexDirection="column">{children}</Box>
);
// The questions you answered, kept in sight under their row.
function Answers({ f, pad }) {
  if (!f?.answers.length) return null;
  return f.answers.map((it) => {
    const q = it.type === 'user' ? null : oneLine(it.view?.question ?? it.arg);
    const a = it.type === 'user' ? it.text : it.view?.text;
    return <Box key={`a${it.key}`} paddingLeft={pad}><Text wrap="truncate-end"><Text color={BOX_ASK}>? </Text>{q ? <Text color={C.dim}>{q} → </Text> : <Text color={C.dim}>You: </Text>}<Text color={WHITE}>{oneLine(a)}</Text></Text></Box>;
  });
}
const boxWidth = (width) => Math.max(30, width - 4);
const runLead = (run, open) => [{ t: open ? '▾ ' : '▸ ', c: C.accent }, { t: TASKS[run.task].label.padEnd(TAG), c: TASKS[run.task].title, b: true }];
const lastLine = (run) => [...run.rows].reverse().find((r) => r.text);

// A row inside an open task row: its line and how much it did; open, the whole line and its steps.
// drawSteps(list, width): the conversation's own drawing of those steps (screen.jsx).
export function RowView({ r, open, width, drawSteps }) {
  const inner = boxWidth(width) - 4;
  const words = r.text ?? r.guess;
  const steps = open && r.list.length ? <Box paddingLeft={6} flexDirection="column">{drawSteps(r.list, inner - 6)}</Box> : null;
  const whole = open && r.full && stringWidth(r.text) > inner - 40 ? <Box paddingLeft={6}><Text color={WHITE} wrap="wrap">{oneLine(r.full)}</Text></Box> : null;
  return (
    <Sides width={boxWidth(width)}>
      <Line lead={[{ t: '    ' }, { t: open ? '▾ ' : '▸ ', c: C.accent }]} words={words} wordsColor={r.text ? WHITE : C.dim} end={endPieces(r.facts)} width={inner} />
      {open ? null : <Answers f={r.facts} pad={6} />}
      {whole}{steps}
    </Sides>
  );
}
// A task row: the box's top edge over the first; ▸ its title, the last line the model said in it, its
// counts; closed, your answers under it; open, its rows.
export function TaskRun({ it, width, drawSteps }) {
  const { run, open } = it;
  const inner = boxWidth(width) - 4;
  const f = allOf(run.rows);
  const last = lastLine(run);
  return (
    <Box flexDirection="column">
      {it.first ? <Box marginLeft={2}><Edge top width={boxWidth(width)} /></Box> : null}
      <Sides width={boxWidth(width)}>
        <Line lead={runLead(run, open)} words={last ? last.text : run.rows[0].guess} wordsColor={last ? PATH : C.dim} end={endPieces(f, { parts: run.rows.length })} width={inner} />
        {open ? null : <Answers f={f} pad={2} />}
      </Sides>
      {open ? run.rows.map((r) => <RowView key={r.id} r={r} open={it.openRows.has(r.id)} width={width} drawSteps={drawSteps} />) : null}
    </Box>
  );
}
// The box's end: what failed last (and how many others did), then the totals on its bottom edge.
export function TaskEnd({ it, width, cwd }) {
  const f = allOf(it.rows);
  const last = f.failures.at(-1);
  const bits = [plural(f.steps, 'step'), f.reads ? `read ${f.reads}` : '', f.files.length ? `changed ${plural(f.files.length, 'file')}` : '', f.commands ? `ran ${plural(f.commands, 'command')}` : '', f.thoughts ? plural(f.thoughts, 'thought') : ''].filter(Boolean);
  const words = [{ t: bits.join(' · '), c: C.dim }];
  if (f.test) words.push({ t: ` · ${f.test.words}`, c: f.test.bad ? C.bad : C.ok });
  return (
    <Box flexDirection="column">
      {last ? <Sides width={boxWidth(width)}><FailRow it={last} cwd={cwd} more={f.failures.length - 1} /></Sides> : null}
      <Box marginLeft={2}><Edge top={false} words={words} width={boxWidth(width)} /></Box>
    </Box>
  );
}
// The live area while a turn works: the task row so far (its last line, its rows and steps) and, under it,
// the row under way (the line the model just said, "Working", its steps so far and the last two of them). A
// row under way of another kind is a task row of its own under the one before; looking so far takes its kind.
export function LiveRun({ live, width, drawSteps }) {
  const inner = boxWidth(width) - 4;
  const { line, list } = live;
  const f = list.length ? groupFacts(list) : null;
  const acts = f && !SUPPORT.has(f.task);
  let run = live.run && live.run.looking && acts ? { ...live.run, task: f.task } : live.run;
  const apart = Boolean(run && acts && f.task !== run.task);
  // apart: the looking at the end of the task row so far goes with the row under way (it was for that)
  if (apart) { const i = run.rows.findLastIndex((r) => r.task && !SUPPORT.has(r.task)); if (i >= 0) run = { ...run, rows: run.rows.slice(0, i + 1) }; }
  const words = line ?? (list.length ? firstStep(list) : 'Working');
  const end = [{ t: 'Working', c: C.accent, b: true }, { t: `  ${plural(f?.steps ?? 0, 'step').padStart(10)}`, c: C.dim }];
  const rf = run ? allOf(run.rows) : null;
  const last = run ? lastLine(run) : null;
  const task = apart || !run ? f?.task ?? 'thinking' : run.task;
  return (
    <Box flexDirection="column">
      {live.first ? <Box marginLeft={2}><Edge top width={boxWidth(width)} /></Box> : null}
      <Sides width={boxWidth(width)}>
        {run ? <Line lead={runLead(run, !apart)} words={last ? last.text : run.rows[0].guess} wordsColor={last ? PATH : C.dim} end={endPieces(rf, { parts: run.rows.length })} width={inner} /> : null}
        <Line lead={apart || !run ? runLead({ task }, true) : [{ t: '    ' }, { t: '▾ ', c: C.accent }]} words={words} wordsColor={line ? WHITE : C.dim} end={end} width={inner} />
        {list.length ? <Box paddingLeft={6} flexDirection="column">{drawSteps(list.slice(-2), inner - 6)}</Box> : null}
      </Sides>
    </Box>
  );
}
// A task row in words, for ctrl+o's list; and a row of it, under it when it is open.
export const runWords = (run) => { const f = allOf(run.rows); const last = lastLine(run); return `${TASKS[run.task].label} · ${plural(run.rows.length, 'part')} · ${plural(f.steps, 'step')}${last ? ` · ${last.text}` : ''}`; };
export const rowWords = (r) => `    ${r.text ?? r.guess}`;
