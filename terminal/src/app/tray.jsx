// The tray over the prompt box (attach.mjs): a card for each picture or PDF the box holds, its
// small picture on the left, its chip, name, size and how to open it on the right. A small window
// gets one line instead. Where each card goes is worked out once (trayLayout), for this drawing and
// for a click on one.
import React from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { C } from '../ui/theme.mjs';
import { cardLines, compactText, openHint, thumbRows, TRAY_INDENT } from './attach.mjs';

const hex = (c) => (c ? `#${c}` : undefined);
const fit = (s, w) => { let out = ''; for (const ch of s) { if (stringWidth(out + ch) > w) return `${out.slice(0, -1)}…`; out += ch; } return out; };

function Thumb({ t }) {
  return (
    <Box flexDirection="column" width={t.w} marginRight={2}>
      {thumbRows(t).map((runs, i) => (
        <Text key={i}>{runs.map((r, j) => <Text key={j} color={hex(r.fg)} backgroundColor={hex(r.bg)}>{r.text}</Text>)}</Text>
      ))}
    </Box>
  );
}

export function AttachTray({ items, layout, width, mouse }) {
  if (!layout?.cards.length) return null;
  const byN = new Map(items.map((it) => [it.n, it]));
  const more = layout.more ? `+${layout.more} more` : '';
  if (layout.compact) {
    const tail = [more, openHint(mouse)].filter(Boolean).join(' · ');
    const used = layout.cards.at(-1).x + layout.cards.at(-1).w;
    return (
      <Box width={width} paddingLeft={TRAY_INDENT}>
        <Text wrap="truncate-end">
          {layout.cards.map((c, i) => <Text key={c.n}>{i ? '   ' : ''}<Text color={C.accent}>{compactText(byN.get(c.n))}</Text></Text>)}
          {used + 3 + stringWidth(tail) <= width ? <Text color={C.dim}>{`   ${tail}`}</Text> : null}
        </Text>
      </Box>
    );
  }
  return (
    <Box width={width} height={layout.height} paddingLeft={TRAY_INDENT} flexDirection="row">
      {layout.cards.map((c) => {
        const it = byN.get(c.n);
        const [chip, name, size, hint] = cardLines(it, { mouse });
        return (
          <Box key={c.n} flexDirection="row" marginRight={3} flexShrink={0}>
            {it.thumb?.w ? <Thumb t={it.thumb} /> : null}
            <Box flexDirection="column" width={c.textW}>
              <Text color={C.accent} bold>{fit(chip, c.textW)}</Text>
              <Text>{fit(name, c.textW)}</Text>
              <Text color={C.dim}>{fit(size, c.textW)}</Text>
              <Text color={C.faint}>{fit(hint, c.textW)}</Text>
            </Box>
          </Box>
        );
      })}
      {more ? <Text color={C.dim}>{more}</Text> : null}
    </Box>
  );
}
