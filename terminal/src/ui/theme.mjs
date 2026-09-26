// 256-colour palette: Apple Terminal on macOS 15 has no true colour, so every
// colour here is an exact xterm-256 entry and looks the same everywhere.
export const C = {
  accent: 'ansi256(114)',   // bonsai green  #87d787
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
};

export const SPIN = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
export const spinGlyph = (t) => SPIN[Math.floor(t * 8) % SPIN.length];

export const fmtSecs = (s) => (s < 60 ? `${Math.floor(s)}s` : `${Math.floor(s / 60)}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`);
export const fmtTok = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
