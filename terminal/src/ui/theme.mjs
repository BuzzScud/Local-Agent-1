// 256-colour palette: Apple Terminal on macOS 15 has no true colour, so every
// colour here is an exact xterm-256 entry and looks the same everywhere.
export const C = {
  accent: 'ansi256(114)',   // coding green  #87d787
  accentDim: 'ansi256(71)', // #5faf5f
  dim: 'ansi256(245)',      // #8a8a8a
  faint: 'ansi256(240)',    // #585858
  border: 'ansi256(242)',   // #6c6c6c
  ask: 'ansi256(147)',      // permission prompts #afafff
  edits: 'ansi256(141)',    // accept-edits mode #af87ff
  plan: 'ansi256(73)',      // plan mode #5fafaf
  ok: 'ansi256(114)',
  bad: 'ansi256(203)',
  warn: 'ansi256(215)',
  addBg: 'ansi256(22)',     // #005f00
  delBg: 'ansi256(52)',     // #5f0000
  think: 'ansi256(246)',
  selBg: 'ansi256(24)',     // selected text in the prompt #005f87
  memApps: 'ansi256(67)',   // Mac memory: other apps and the system #5f87af
  memPacked: 'ansi256(179)', // Mac memory: compressed #d7af5f
};

export const SPIN = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
export const spinGlyph = (t) => SPIN[Math.floor(t * 8) % SPIN.length];

// The working icon. orbit (picked 2026-09-26, the default): dots that go round one
// step per token written, drifting slowly and dimmer while nothing is written
// (reading, a tool). BONSAI_SPINNER=classic|bloom shows the other two looks:
// Claude Code's star, or a flower that opens and closes as its green brightens.
export const SPINNERS = {
  classic: { name: 'Now', frames: SPIN, fps: 8 },
  bloom: { name: 'Bloom', frames: ['·', '✿', '❀', '❁', '❀', '✿'], colors: [65, 71, 114, 120, 114, 71], fps: 5 },
  orbit: { name: 'Orbit', frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'], fps: 3, perToken: true, waitColor: 65 },
};
// Orbit at rest, every dot lit: the mark in the welcome box and on the line a
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
