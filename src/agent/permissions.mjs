// Which tool calls run straight away, which ask you first, and which are
// never allowed. Modes: ask (default), edits (file changes go through), plan
// (read-only: it may look but not change anything).

// Commands that are blocked in every mode, because they destroy work or stop
// things running on this Mac.
// "In command position": the start, after ; & | ( or `, or after a wrapper
// such as xargs, nohup, exec, env, time.
const CMD = '(?:^|[;&|(\\x60]\\s*|\\b(?:xargs|nohup|exec|env|time|command)\\s+(?:-\\S+\\s+)*)';
const at = (words) => new RegExp(`${CMD}(?:${words})\\b`);

export const BLOCKED = [
  { re: /\brm\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*(?:r[a-zA-Z]*f|f[a-zA-Z]*r)|\brm\s+(?:.*\s)?-r\b.*\s-f\b|\brm\s+(?:.*\s)?-f\b.*\s-r\b|\brm\s+.*--recursive.*--force|\brm\s+.*--force.*--recursive/, why: 'rm -rf deletes files for good' },
  { re: at('sudo|doas'), why: 'sudo runs as administrator' },
  { re: /\bgit\s+push\b/, why: 'git push sends your code off this Mac' },
  { re: /\bgit\s+reset\s+--hard\b/, why: 'git reset --hard throws away uncommitted work' },
  { re: /\bgit\s+clean\s+-[a-zA-Z]*f/, why: 'git clean -f deletes untracked files for good' },
  { re: at('kill|pkill|killall'), why: 'stopping processes could stop your running servers' },
  { re: /\blaunchctl\s+(stop|unload|bootout|kill|remove|disable)\b/, why: 'stopping services could stop your running servers' },
  { re: /\bbrew\s+services\s+(stop|restart|kill)\b/, why: 'stopping services could stop your running servers' },
  { re: /\bpm2\s+(stop|delete|kill|restart)\b/, why: 'stopping services could stop your running servers' },
  { re: /\bdocker\s+(stop|kill|rm|rmi|system\s+prune)\b/, why: 'stopping or deleting containers' },
  { re: at('shutdown|reboot|halt'), why: 'shuts the Mac down' },
  { re: /\bmkfs\b|\bdd\s+if=|\bdiskutil\s+(erase|partition)/, why: 'can wipe a disk' },
  { re: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/, why: 'runs a script straight from the internet' },
];

// Read-only commands that plan mode may still run.
const READ_ONLY = /^\s*(ls|pwd|cat|head|tail|wc|grep|rg|find|tree|file|stat|du|which|echo|git\s+(status|diff|log|show|branch|blame|ls-files|rev-parse))\b[^;&|><`$]*$/;

export function blockedReason(command) {
  for (const b of BLOCKED) if (b.re.test(command)) return b.why;
  return null;
}

// "don't ask again for X": the first two words of a command.
export const commandPrefix = (command) => command.trim().split(/\s+/).slice(0, 2).join(' ');

export function decide(name, args, { mode, allowedPrefixes, inside = true }) {
  if (name === 'Read' || name === 'List' || name === 'Search' || name === 'TodoWrite') return { decision: 'allow' };
  if (name === 'Edit' || name === 'Write') {
    if (!inside) return { decision: 'deny', reason: 'that file is outside the project folder' };
    if (mode === 'plan') return { decision: 'deny', reason: 'plan mode is on, so nothing may be changed yet' };
    if (mode === 'edits') return { decision: 'allow' };
    return { decision: 'ask' };
  }
  if (name === 'Bash') {
    const why = blockedReason(args.command ?? '');
    if (why) return { decision: 'deny', reason: `blocked: ${why}` };
    if (mode === 'plan') return READ_ONLY.test(args.command) ? { decision: 'allow' } : { decision: 'deny', reason: 'plan mode is on, so only read-only commands may run' };
    if (READ_ONLY.test(args.command)) return { decision: 'allow' };
    if (allowedPrefixes?.has(commandPrefix(args.command))) return { decision: 'allow' };
    return { decision: 'ask' };
  }
  return { decision: 'deny', reason: 'unknown tool' };
}
