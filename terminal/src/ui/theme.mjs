// 256-colour palette: Apple Terminal on macOS 15 has no true colour, so every
// colour here is an exact xterm-256 entry and looks the same everywhere.
// The app's own hue is Ocean, a sky blue (8 Oct 2026, the owner's pick "1 · Ocean" of four palettes:
// "i want to change the green to something else"; docs/private/design rounds/agentic-coder-palettes-4-2026-10-08.html).
// Its shades by job, for whatever draws by number (the bot, the loop board, the usage card's line); until then
// these were greens: 114, 71, 65, 120, 157, 194, and 22 under added lines.
export const HUE = {
  accent: 75,   // #5fafff  ●, ❯, Made, the wordmark, ✓
  dim: 68,      // #5f87d7  bars, meters, the second tone
  deep: 60,     // #5f5f87  waiting, the bot asleep
  bright: 81,   // #5fd7ff  the bot while it works
  light: 117,   // #87d7ff  the bot's eyes
  lighter: 153, // #afd7ff  a glint
};
export const C = {
  accent: `ansi256(${HUE.accent})`,   // ocean sky blue #5fafff
  accentDim: `ansi256(${HUE.dim})`,   // #5f87d7
  dim: 'ansi256(245)',      // #8a8a8a
  faint: 'ansi256(240)',    // #585858
  border: 'ansi256(242)',   // #6c6c6c
  ask: 'ansi256(147)',      // permission prompts #afafff
  edits: 'ansi256(141)',    // accept-edits mode #af87ff
  plan: 'ansi256(73)',      // plan mode #5fafaf
  auto: 'ansi256(179)',     // auto mode #d7af5f
  bypass: 'ansi256(203)',   // bypass permissions #ff5f5f
  ok: `ansi256(${HUE.accent})`,
  bad: 'ansi256(203)',
  warn: 'ansi256(215)',
  addBg: 'ansi256(24)',     // added lines: deep blue #005f87 (removed lines stay red)
  delBg: 'ansi256(52)',     // #5f0000
  think: 'ansi256(246)',
  selBg: 'ansi256(24)',     // selected text in the prompt #005f87
};

export const SPIN = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
export const spinGlyph = (t) => SPIN[Math.floor(t * 8) % SPIN.length];

// The working icon. orbit (picked 2026-09-26, the default): dots that go round one
// step per token written, drifting slowly and dimmer while nothing is written
// (reading, a tool). AGENTIC_SPINNER=classic|bloom shows the other two looks:
// Claude Code's star, or a flower that opens and closes as its blue brightens.
export const SPINNERS = {
  classic: { name: 'Now', frames: SPIN, fps: 8 },
  bloom: { name: 'Bloom', frames: ['·', '✿', '❀', '❁', '❀', '✿'], colors: [HUE.deep, HUE.dim, HUE.accent, HUE.bright, HUE.accent, HUE.dim], fps: 5 },
  orbit: { name: 'Orbit', frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'], fps: 3, perToken: true, waitColor: HUE.deep },
};
// Orbit at rest, every dot lit: the mark on the line a
// finished turn leaves ("⠿ Baked for 41s · done 12:58 PM").
export const MARK = '⠿';
export const spinStyle = (v) => (Object.hasOwn(SPINNERS, v ?? '') ? v : 'orbit');

// The icon at `secs` into the wait. `tokens` and `sinceToken` (seconds since the
// last token) move and light up orbit; the other looks follow the clock only.
export function spinFrame(style, secs, { tokens = 0, sinceToken = Infinity } = {}) {
  const s = SPINNERS[spinStyle(style)];
  const n = s.frames.length;
  if (s.perToken) {
    const i = (tokens + Math.floor(secs * s.fps)) % n;
    return { glyph: s.frames[i], color: sinceToken < 1 ? C.accent : `ansi256(${s.waitColor})` };
  }
  const i = Math.floor(secs * s.fps) % n;
  return { glyph: s.frames[i], color: s.colors ? `ansi256(${s.colors[i]})` : C.accent };
}

export const fmtSecs = (s) => (s < 60 ? `${Math.floor(s)}s` : `${Math.floor(s / 60)}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`);
export const fmtTok = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
