// What the start says (9 Oct 2026, the owner's picks from four designs drawn by the real app,
// docs/private/design rounds/agentic-coder-start-notes-4-designs-2026-10-09.html): the mode the last
// window left, where the model runs, where the helpers run. Before, three notes under the start page,
// each a paragraph (8 to 10 rows); their pick "2 · In the page": while the page is up they are one
// item (App.jsx sayStart), which the Menu shows in its own rows (home-looks.jsx) and the Launcher as
// one line under it (StartLine). A /remote after the page has gone says it in one note (remoteNote).
import React from 'react';
import { Box, Text } from 'ink';
import { C } from '../ui/theme.mjs';
import { MODE_SHORT } from '../ui/parts.jsx';

const cells = (t) => [...t].length;
// Where the helpers on another server than the conversation are (profiles.mjs helpersAway, one a
// profile): "on the service", or "elsewhere" when they are on more than one.
const helpersWhere = (list) => (list.every((h) => h.where === list[0].where) ? `on the ${list[0].where}` : 'elsewhere');
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
// "5 models on the service": the Menu's Helpers row.
export const helpersWords = (list) => (list?.length ? `${plural(list.length, 'model')} ${helpersWhere(list)}` : '');
// The remote in a few words: "claude-opus-5-5 on the Claude API", "coder:30b on 127.0.0.1:8080".
const remoteWords = (r) => `${r.model} on ${r.claude ? 'the Claude API' : r.label}`;

// The Launcher's line: the mode in its colour, then the remote, then the helpers, centred; a
// narrower window loses words from the right ("kept from" → "from" → the time → the helpers).
export function startLine(said, width) {
  const tries = [
    { kept: ', kept from the last window', ms: true, helpers: true },
    { kept: ', from the last window', ms: true, helpers: true },
    { kept: '', ms: true, helpers: true },
    { kept: '', ms: false, helpers: true },
    { kept: '', ms: false, helpers: false },
  ];
  const partsOf = (t) => {
    const out = [];
    const m = said.mode, r = said.remote, h = r?.helpers ?? [];
    if (m) out.push([{ t: MODE_SHORT[m.mode] ?? m.word, c: C[m.mode] ?? C.warn }, { t: t.kept, c: C.dim }]);
    if (r) out.push([{ t: `${remoteWords(r)}${t.ms && r.ms != null ? `, ${r.ms} ms` : ''}`, c: C.dim }]);
    if (h.length && t.helpers) out.push([{ t: `${plural(h.length, 'helper model')} ${helpersWhere(h)}`, c: C.dim }]);
    return out;
  };
  const len = (ps) => ps.reduce((n, p) => n + p.reduce((k, x) => k + cells(x.t), 0), 0) + Math.max(0, ps.length - 1) * 5;
  return tries.map(partsOf).find((ps) => len(ps) <= width - 4) ?? partsOf(tries.at(-1));
}
export function StartLine({ said, width }) {
  const ps = startLine(said, width);
  if (!ps.length) return null;
  return (
    <Box width={width} justifyContent="center">
      <Text wrap="truncate-end">{ps.map((p, i) => (
        <Text key={i}>{i ? <Text color={C.faint}>  ·  </Text> : null}{p.map((x, j) => <Text key={j} color={x.c}>{x.t}</Text>)}</Text>
      ))}</Text>
    </Box>
  );
}

// A /remote once the page has gone (the owner's pick: one line, where there were two notes).
export function remoteNote(r) {
  const h = r.helpers ?? [];
  return `On the remote: ${r.name} · ${r.where} · answered in ${r.ms ?? '?'} ms${h.length ? ` · ${plural(h.length, 'helper')} stay ${helpersWhere(h)}` : ''}`;
}
