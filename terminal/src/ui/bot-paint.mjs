// The Visor bot put on the screen: a pose (bot-rig.mjs) at a place (bot-brain.mjs) becomes the cells it
// covers, and only those, so whatever is under it shows around it. at.x: the screen column of the bot's
// middle (the left of its middle pair); at.y: the screen's pixel row (two to a line) its feet stand on.
// bgAt(row, col): the colour behind a cell (xterm-256, or null for the window's own), which fills the
// half of a cell the bot leaves open. shadow: { x, y, w }, a soft shadow w pixels wide on pixel row y
// (darker in its middle), under the bot where the bot is not. clip: no pixel below this pixel row (the bot
// going into the prompt box, or coming out of it). A pose of null (the bot hidden) covers nothing.
import { rigPixels, botGlyph, GROUND } from './bot-rig.mjs';

export function botCellsAt(pose, at, { cols = Infinity, rows = Infinity, bgAt = () => null, shadow = null, clip = null } = {}) {
  if (!pose) return [];
  const px = rigPixels(pose);
  const lit = new Map();
  const key = (c, y) => c * 4096 + y + 2048;
  for (let cy = 0; cy < px.length; cy++) for (let cx = 0; cx < px[cy].length; cx++) {
    const c = px[cy][cx];
    if (c == null) continue;
    const sc = at.x + (cx - 15), sy = at.y + (cy - GROUND);
    if (sc < 0 || sc >= cols || sy < 0 || sy >= rows * 2 || (clip != null && sy > clip)) continue;
    lit.set(key(sc, sy), c);
  }
  if (shadow && shadow.w > 0) {
    const x0 = shadow.x - Math.floor(shadow.w / 2) + 1;
    for (let i = 0; i < shadow.w; i++) {
      const sc = x0 + i;
      if (sc < 0 || sc >= cols || shadow.y < 0 || shadow.y >= rows * 2 || lit.has(key(sc, shadow.y))) continue;
      lit.set(key(sc, shadow.y), i === 0 || i === shadow.w - 1 ? 234 : i === 1 || i === shadow.w - 2 ? 233 : 232);
    }
  }
  const seen = new Set(), out = [];
  for (const k of lit.keys()) {
    const sc = Math.floor(k / 4096), sy = (k % 4096) - 2048, r = sy >> 1;
    const id = sc * 4096 + r;
    if (seen.has(id)) continue;
    seen.add(id);
    const bg = bgAt(r, sc) ?? null;
    const at2 = (y) => lit.get(key(sc, y)) ?? bg;
    const g = botGlyph(at2(2 * r - 1), at2(2 * r), at2(2 * r + 1), at2(2 * r + 2));
    out.push({ row: r, col: sc, ch: g.ch, fg: g.fg ?? null, bg: g.bg ?? null, inverse: Boolean(g.inverse) });
  }
  return out.sort((a, b) => a.row - b.row || a.col - b.col);
}
