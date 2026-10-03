// The window for /agents (2 Oct 2026, the owner's picks): it grows to 112 × 59 while /agents runs,
// keeping a side that is already bigger (150 × 55 grows to 150 × 59), and goes back to its size when
// the run ends; on a screen too small Terminal stops at the most it fits, and the tree lays itself
// out for that. It asks the terminal with the xterm resize code, which Terminal and iTerm2 follow;
// tmux, VS Code, an SSH session or AGENTIC_AGENTS_RESIZE=off leave the window as it is.
export const AGENTS_SIZE = [112, 59];
export const resizeSeq = (cols, rows) => `\x1b[8;${rows};${cols}t`;
export function canResize(env = process.env, out = process.stdout) {
  if (!out?.isTTY || env.AGENTIC_AGENTS_RESIZE === 'off') return false;
  if (env.TMUX || env.SSH_CONNECTION || env.SSH_TTY) return false;
  return env.TERM_PROGRAM === 'Apple_Terminal' || env.TERM_PROGRAM === 'iTerm.app';
}
// [cols, rows] to grow to, or null when the window is already that big on both sides.
export function growTo(cur, target = AGENTS_SIZE) {
  const c = Math.max(cur?.columns ?? 0, target[0]), r = Math.max(cur?.rows ?? 0, target[1]);
  return c === cur?.columns && r === cur?.rows ? null : [c, r];
}
