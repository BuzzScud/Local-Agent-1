// What "looks right" means for one screen, as checks a test can run:
// nothing wider than the window, no leftover copies of the live area, box
// borders whole, the prompt box on the last lines when Bonsai is idle.
const BORDER = /^[\s─│╭╮╰╯┃]*$/;
// anchored: a fresh screen (the start, or just after a resize), where the
// conversation starts on the top line and the prompt box sits on the last
// lines, with blank space in between until the conversation fills it.

export function checkScreen(lines, { cols, rows, anchored = false, scrollback = null, expectBox = true } = {}) {
  const out = [];
  const add = (what, ok, detail = '') => out.push({ what, ok, detail });
  const text = lines.map((l) => l.text);
  const all = scrollback ?? lines;
  const wrapped = all.filter((l) => l.wrapped);
  add('nothing wider than the window', !wrapped.length, wrapped.slice(0, 3).map((l) => l.text.slice(0, 60)).join(' | '));
  const count = (re) => text.filter((l) => re.test(l)).length;
  add('one prompt box', count(/^│ [>!] /) <= 1, `${count(/^│ [>!] /)} seen`);
  add('one footer', count(/(for shortcuts|shell mode:)/) <= 1, `${count(/(for shortcuts|shell mode:)/)} seen`);
  add('one spinner', count(/esc to interrupt\)/) <= 1, `${count(/esc to interrupt\)/)} seen`);
  // A border piece on its own line (─────╮ without its ╭, or a lone │) is a leftover.
  const frags = text.filter((l) => /^\s*─/.test(l) && BORDER.test(l) || /^\s+│\s*$/.test(l));
  add('box borders whole', !frags.length, frags.slice(0, 2).map((l) => l.trim().slice(0, 40)).join(' | '));
  const open = text.filter((l) => /^\s*╭/.test(l)).length;
  const close = text.filter((l) => /^\s*╰/.test(l)).length;
  add('every box closed', Math.abs(open - close) <= 1, `${open} ╭ vs ${close} ╰`);
  if (anchored && expectBox) {
    let last = text.length - 1;
    while (last > 0 && !text[last].trim()) last--;
    const boxEnd = text.map((l, i) => (/^╰/.test(l) ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
    add('prompt box on the last lines', boxEnd >= rows - 4 && last >= rows - 3, `box ends on row ${boxEnd + 1} of ${rows}`);
  }
  return out;
}
