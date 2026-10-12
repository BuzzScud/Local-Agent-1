// /btw's side panel (screen.jsx): the answer as rows a panel can scroll, and where the panel
// sits. Moved from screen.jsx word for word.
import React from 'react';
import { Box, Text } from 'ink';
import { C, spinFrame, fmtSecs } from '../ui/theme.mjs';
import { wrap } from '../ui/parts.jsx';

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
export function BtwPanel({ app }) {
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
