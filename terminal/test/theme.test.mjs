// The app's hue (8 Oct 2026, the owner's pick "1 · Ocean": "i want to change the green to something else"):
// sky blue in the theme, the bot (and so the hub's icon), the loop board, the spinners and the usage card,
// and no green left anywhere the app draws by number.
import { test, expect } from 'bun:test';
import { C, HUE, SPINNERS } from '../src/ui/theme.mjs';
import { botPixels } from '../src/app/start.jsx';
import { STYLE, BG } from '../src/app/loops-draw.mjs';
import { usageChip, usagePanel } from '../src/app/usage-bar.mjs';

const LV = [0, 95, 135, 175, 215, 255];
// A colour that reads as green: an xterm-256 entry with a hue between 70° and 175° and some colour in it
// (the terminal's own green, 2 and 10, too). Plan mode's teal (73, 180°) is not.
function green(n) {
  if (n === 2 || n === 10) return true;
  if (n < 16 || n >= 232) return false;
  const [r, g, b] = [LV[Math.floor((n - 16) / 36)], LV[Math.floor((n - 16) / 6) % 6], LV[(n - 16) % 6]].map((x) => x / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (d < 0.15) return false;
  const h = ((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
  return h >= 70 && h <= 175;
}
const num = (s) => Number(/^ansi256\((\d+)\)$/.exec(s)?.[1]);

test('Ocean: the theme’s own hue by its numbers, and C built from it', () => {
  expect(HUE).toEqual({ accent: 75, dim: 68, deep: 60, bright: 81, light: 117, lighter: 153 });
  expect(C.accent).toBe('ansi256(75)');
  expect(C.accentDim).toBe('ansi256(68)');
  expect(C.ok).toBe(C.accent);
  expect(C.addBg).toBe('ansi256(24)'); // added lines deep blue; removed lines stay red
  expect(C.delBg).toBe('ansi256(52)');
});

test('no green anywhere the app draws by number: the theme, every pose of the bot, the loop board, the spinners, the usage card', () => {
  const theme = Object.values(C).map(num);
  expect(theme.every(Number.isFinite)).toBe(true);
  expect(theme.filter(green)).toEqual([]);
  const poses = [];
  for (const state of ['off', 'trust', 'loading', 'ready']) for (let k = 0; k < 18; k++) for (const look of [null, 0.1, 0.5, 0.9]) poses.push(botPixels(state, k, look));
  expect([...new Set(poses.flat(2).filter((c) => c != null))].filter(green)).toEqual([]);
  expect(Object.values(STYLE).filter(green)).toEqual([]);
  expect(Object.values(BG).filter(green)).toEqual([]);
  expect([...SPINNERS.bloom.colors, SPINNERS.orbit.waitColor].filter(green)).toEqual([]);
  const now = Date.now();
  const u = { model: 'claude-opus-5-5', modelName: 'Opus 5.5', cap: 500, tier: 'Start', spent: 66.56, left: 433.44, monthName: 'October', days: [9.85, 56.71], last14: [...Array(12).fill(0), 9.85, 56.71], today: { usd: 56.71, windows: 2 }, window: 8.82, pace: { perDay: 33.28, runsOut: now + 13 * 86_400_000, beforeReset: true }, limits: { at: now - 60_000, model: 'claude-opus-5-5', requests: { limit: 1000, remaining: 400, reset: now + 20_000 }, input: { limit: 2e6, remaining: 2e6, reset: now - 1 }, output: { limit: 4e5, remaining: 4e5, reset: now - 1 } }, resetsOn: now + 20 * 86_400_000, capped: null };
  const drawn = [usageChip(u), ...usagePanel(u, 152, { now }), ...usagePanel(u, 152, { now, live: true })].flat();
  expect([...new Set(drawn.flatMap((s) => [s.fg, s.bg]).filter((c) => c != null))].filter(green)).toEqual([]);
  // and the line is blue where the month has plenty left
  expect(usagePanel(u, 152, { now }).flat().some((s) => /━/.test(s.t) && [17, 24, 25, 31, 32, 38, 74, 117].includes(s.fg))).toBe(true);
});
