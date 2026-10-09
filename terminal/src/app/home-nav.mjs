// The home screen's choices as plain values (home-looks.jsx and start.jsx draw them; the app's keys and
// slash commands use them): the two looks, moving between the page's items, and the conversations it
// lists. No React, no Ink, so the app's logic and its tests load them without the screen.

export const HOME_LOOKS = [
  { id: 'menu', name: 'Menu', note: 'one list: the conversations, then what you can do, each with its key' },
  { id: 'launcher', name: 'Launcher', note: 'the bot, the name in block letters, one column to pick up or start' },
];
// A look by its id, name or number (1 is the Menu); anything else is the Menu.
export function lookOf(v) {
  const w = String(v ?? '').trim().toLowerCase();
  if (/^\d+$/.test(w)) return HOME_LOOKS[Number(w) - 1]?.id ?? 'menu';
  return HOME_LOOKS.find((l) => l.id === w || l.name.toLowerCase() === w)?.id ?? 'menu';
}
export const nextLook = (v) => HOME_LOOKS[(HOME_LOOKS.findIndex((l) => l.id === lookOf(v)) + 1) % HOME_LOOKS.length].id;

// The item a click lands on (row from the page's first, col from 1), or null.
export const itemAt = (items, row, col) => items.find((it) => it.rects.some((r) => r.row === row && col >= r.from && col <= r.to)) ?? null;
// The next item from `key` in a direction (up, down, left, right), by where they sit: the nearest
// one that way, one in the same column or row first; tab and shift+tab (next, back) go in order.
export function homeNav(items, key, dir) {
  if (!items.length) return null;
  const at = items.findIndex((x) => x.key === key);
  if (at < 0) return items[0].key;
  if (dir === 'next' || dir === 'back') return items[(at + (dir === 'next' ? 1 : items.length - 1)) % items.length].key;
  const mid = (it) => ({ y: it.rects.reduce((n, r) => n + r.row, 0) / it.rects.length, x: (it.rects[0].from + it.rects[0].to) / 2, from: it.rects[0].from, to: it.rects[0].to });
  const c = mid(items[at]);
  let best = null, score = Infinity;
  for (const it of items) {
    if (it.key === key) continue;
    const p = mid(it);
    const overlap = p.from <= c.to && p.to >= c.from; // the same column
    let along, across;
    if (dir === 'up' || dir === 'down') {
      along = dir === 'up' ? c.y - p.y : p.y - c.y;
      across = overlap ? 0 : Math.abs(p.x - c.x) / 4;
    } else {
      along = (dir === 'left' ? c.x - p.x : p.x - c.x) / 4;
      across = Math.abs(p.y - c.y);
      if (overlap) continue;
    }
    if (along <= 0.4) continue;
    const sc = along + across * 3;
    if (sc < score) { score = sc; best = it; }
  }
  return best?.key ?? key;
}

// A saved title is the first 80 characters of the prompt: one line, without separator runs, and
// with … where it was cut when saved.
export function titleOf(s) {
  const t = String(s.title ?? '').replace(/[-=_─*#]{3,}/g, ' ').replace(/\s+/g, ' ').trim() || '(untitled)';
  return String(s.title ?? '').length >= 80 ? `${t}…` : t;
}
// The newest conversations, the same prompt run again shown once.
export function recentOf(list, n = 3) {
  const seen = new Set();
  return list.filter((s) => { const k = titleOf(s); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, n);
}
