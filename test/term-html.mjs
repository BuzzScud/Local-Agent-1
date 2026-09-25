// Turns a headless-terminal screen into HTML with the exact cell colours, so
// a report can show what the app really drew (Apple Terminal "Basic" dark).
const BASE = ['#000000', '#990000', '#00a600', '#999900', '#0000b2', '#b200b2', '#00a6b2', '#bfbfbf', '#666666', '#e50000', '#00d900', '#e5e500', '#0000ff', '#e500e5', '#00e5e5', '#e5e5e5'];
const hex = (n) => n.toString(16).padStart(2, '0');
const PAL = BASE.slice();
const lv = [0, 95, 135, 175, 215, 255];
for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) PAL.push(`#${hex(lv[r])}${hex(lv[g])}${hex(lv[b])}`);
for (let i = 0; i < 24; i++) { const v = 8 + i * 10; PAL.push(`#${hex(v)}${hex(v)}${hex(v)}`); }
const FG = '#ffffff';
const BG = '#171717';
const mix = (a, b, k) => { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const x = p(a); const y = p(b); return `#${x.map((v, i) => hex(Math.round(v * k + y[i] * (1 - k)))).join('')}`; };
const esc = (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c);

function color(cell, fg) {
  if (fg ? cell.isFgDefault() : cell.isBgDefault()) return null;
  const v = fg ? cell.getFgColor() : cell.getBgColor();
  if (fg ? cell.isFgPalette() : cell.isBgPalette()) return PAL[v];
  return `#${(v >>> 0).toString(16).padStart(6, '0')}`;
}

// Lines [from, to) of the whole buffer (scrollback included) as HTML rows.
export function termToHtml(term, { from = 0, to } = {}) {
  const b = term.buffer.active;
  const end = Math.min(to ?? b.length, b.length);
  const cell = b.getNullCell();
  const rows = [];
  for (let y = from; y < end; y++) {
    const line = b.getLine(y);
    if (!line) { rows.push('<div> </div>'); continue; }
    let html = '';
    let cur = null;
    let buf = '';
    const flush = () => { if (buf) html += cur ? `<span style="${cur}">${buf}</span>` : buf; buf = ''; };
    for (let x = 0; x < term.cols; x++) {
      line.getCell(x, cell);
      const ch = cell.getChars() || ' ';
      if (cell.getWidth() === 0) continue;
      let fg = color(cell, true) ?? FG;
      let bg = color(cell, false);
      if (cell.isInverse()) { const f = fg; fg = bg ?? BG; bg = f; }
      if (cell.isDim()) fg = mix(fg, bg ?? BG, 0.55);
      const css = [fg !== FG && `color:${fg}`, bg && `background:${bg}`, cell.isBold() && 'font-weight:700', cell.isItalic() && 'font-style:italic', cell.isStrikethrough() && 'text-decoration:line-through'].filter(Boolean).join(';') || null;
      if (css !== cur) { flush(); cur = css; }
      const cp = ch.codePointAt(0);
      buf += cp > 0x7e && !(cp >= 0x2500 && cp <= 0x257f) ? `<b class="g">${esc(ch)}</b>` : esc(ch);
    }
    flush();
    rows.push(`<div>${html.replace(/(\s|&nbsp;)+$/, '') || ' '}</div>`);
  }
  return rows.join('');
}

// The last `rows` non-empty-ended lines: what the window showed.
export function visibleRange(term, rows) {
  const b = term.buffer.active;
  let last = b.length - 1;
  while (last > 0 && !b.getLine(last)?.translateToString(true).trim()) last--;
  return { from: Math.max(0, last + 1 - rows), to: last + 1 };
}
