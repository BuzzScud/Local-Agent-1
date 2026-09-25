import { homedir } from 'node:os';
import { resolve, relative, isAbsolute } from 'node:path';

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
  { re: /\b(pg_ctl|pg_ctlcluster)\b[^;&|]*\b(stop|restart|kill)\b|\bpg_(terminate|cancel)_backend\b|\b(mysqladmin|mariadb-admin)\b[^;&|]*\bshutdown\b|\bredis-cli\b[^;&|]*\bshutdown\b|\bmongosh?\b[^;&|]*shutdownServer/i, why: 'stopping a database stops everything using it' },
  { re: at('shutdown|reboot|halt'), why: 'shuts the Mac down' },
  { re: /\bmkfs\b|\bdd\s+if=|\bdiskutil\s+(erase|partition)/, why: 'can wipe a disk' },
  { re: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/, why: 'runs a script straight from the internet' },
];

// Folders a command may name outside the project: the system's own (tools in
// /usr/bin, /dev/null, …). Program folders only: Homebrew's data (databases
// in /opt/homebrew/var) is off limits, like everything else outside the
// project folder, above all your home folder with its other projects.
const SYSTEM_DIRS = ['/dev', '/bin', '/sbin', '/usr/bin', '/usr/sbin', '/usr/lib', '/usr/libexec', '/usr/share', '/usr/include', '/usr/local/bin', '/usr/local/opt', '/usr/local/Cellar', '/opt/homebrew/bin', '/opt/homebrew/sbin', '/opt/homebrew/opt', '/opt/homebrew/Cellar', '/etc', '/private/etc', '/System', '/Library', '/Applications', '/nix'];

// The first path a command names outside the project folder, or null.
// Reads cd (a bare cd goes home), ~, $HOME, absolute paths and ../ escapes.
export function outsidePath(command, cwd) {
  if (!cwd) return null;
  const home = homedir();
  const cmd = String(command ?? '');
  if (/(?:^|[;&|(]\s*)(?:cd|pushd)\s*(?:$|[;&|)])/.test(cmd)) return '~';
  // Words, split on spaces and shell operators; quotes dropped.
  const words = cmd.replace(/\\ /g, '\u0000').split(/[\s;&|()<>=,`]+/).map((w) => w.replace(/\u0000/g, ' ').replace(/["']/g, '')).filter(Boolean);
  for (const w of words) {
    let p = null;
    if (w === '~' || w.startsWith('~/')) p = home + w.slice(1);
    else if (/^~[\w.-]+/.test(w)) return w; // ~user: someone's home folder
    else if (/^\$\{?HOME\}?(\/|$)/.test(w)) p = w.replace(/^\$\{?HOME\}?/, home);
    else if (w.startsWith('/') && !/[\\^]/.test(w)) p = w; // not a regex such as /a\/b/
    else if (/(^|\/)\.\.(\/|$)/.test(w)) p = resolve(cwd, w);
    else continue;
    p = resolve(p);
    const rel = relative(cwd, p);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) continue;
    if (SYSTEM_DIRS.some((d) => p === d || p.startsWith(`${d}/`))) continue;
    return w;
  }
  return null;
}

// Read-only commands that plan mode may still run.
const READ_ONLY = /^\s*(ls|pwd|cat|head|tail|wc|grep|rg|find|tree|file|stat|du|which|echo|git\s+(status|diff|log|show|branch|blame|ls-files|rev-parse))\b[^;&|><`$]*$/;

export function blockedReason(command) {
  for (const b of BLOCKED) if (b.re.test(command)) return b.why;
  return null;
}

// "don't ask again for X": the first two words of a command.
export const commandPrefix = (command) => command.trim().split(/\s+/).slice(0, 2).join(' ');

export function decide(name, args, { mode, allowedPrefixes, inside = true, cwd }) {
  if (name === 'TodoWrite') return { decision: 'allow' };
  if (name === 'Read' || name === 'List' || name === 'Search') return inside ? { decision: 'allow' } : { decision: 'deny', reason: 'that is outside the project folder; only files inside it may be read' };
  if (name === 'Edit' || name === 'Write') {
    if (!inside) return { decision: 'deny', reason: 'that file is outside the project folder' };
    if (mode === 'plan') return { decision: 'deny', reason: 'plan mode is on, so nothing may be changed yet' };
    if (mode === 'edits') return { decision: 'allow' };
    return { decision: 'ask' };
  }
  if (name === 'Bash') {
    const why = blockedReason(args.command ?? '');
    if (why) return { decision: 'deny', reason: `blocked: ${why}` };
    const out = outsidePath(args.command, cwd);
    if (out) return { decision: 'deny', reason: `${out} is outside the project folder; commands stay inside it` };
    if (mode === 'plan') return READ_ONLY.test(args.command) ? { decision: 'allow' } : { decision: 'deny', reason: 'plan mode is on, so only read-only commands may run' };
    if (READ_ONLY.test(args.command)) return { decision: 'allow' };
    if (allowedPrefixes?.has(commandPrefix(args.command))) return { decision: 'allow' };
    return { decision: 'ask' };
  }
  return { decision: 'deny', reason: 'unknown tool' };
}
