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
  for (const w of pathCandidates(cmd)) {
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

// The words of a command as the shell sees them: quoted text stays one word
// ("=== byte count / line count ===" is text, not the folder /), unquoted
// text splits on spaces and shell operators, and Desktop/"a b.txt" is one word.
export function shellWords(cmd) {
  const words = [];
  let cur = '';
  let has = false;
  let quoted = false;
  const push = () => { if (has) words.push(Object.assign(new String(cur), { quoted })); cur = ''; has = false; quoted = false; };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === "'") { const j = cmd.indexOf("'", i + 1); const end = j < 0 ? cmd.length : j; cur += cmd.slice(i + 1, end); has = true; quoted = true; i = end; continue; }
    if (c === '"') {
      quoted = true;
      let j = i + 1;
      // In double quotes a backslash only escapes $ ` " \ (as in the shell): /a\/b/ keeps it.
      for (; j < cmd.length && cmd[j] !== '"'; j++) { if (cmd[j] === '\\' && j + 1 < cmd.length && '$`"\\'.includes(cmd[j + 1])) { cur += cmd[j + 1]; j++; } else cur += cmd[j]; }
      has = true; i = j; continue;
    }
    if (c === '\\' && i + 1 < cmd.length) { cur += cmd[i + 1]; has = true; i++; continue; }
    if (/[\s;&|()<>=,`]/.test(c)) { push(); continue; }
    cur += c; has = true;
  }
  push();
  return words;
}

// What to check for a path outside the folder: each word, and inside quoted
// text ("…readFileSync('/Users/x/a')") each piece that looks like a path. A
// lone "/" in quoted text is prose ("byte count / line count"), not the disk.
function pathCandidates(cmd) {
  const out = [];
  for (const w of shellWords(cmd)) {
    const text = String(w);
    out.push(text);
    if (!w.quoted) continue;
    for (const piece of text.split(/[\s;&|()<>=,`'"]+/)) if (piece.length > 1 && piece !== text) out.push(piece);
  }
  return out;
}

// Commands that only read: they run without asking (inside the fence), and
// they are all plan mode allows. A pipeline or a list of them counts too
// (tail -c 60 file | od -c; wc -l file), as long as nothing writes a file
// (> or >>, except to /dev/null) and no command runs another ($(…), `…`).
const READERS = /^(?:ls|pwd|cat|head|tail|wc|grep|egrep|fgrep|rg|find|tree|file|stat|du|which|echo|printf|od|xxd|hexdump|sort|uniq|cut|tr|nl|cmp|diff|basename|dirname|realpath|date|column|fold|true|git\s+(?:status|diff|log|show|branch|blame|ls-files|rev-parse))\b/;
export function isReadOnly(command) {
  const cmd = String(command ?? '').trim();
  if (!cmd || /`|\$\(|<\(|>\(/.test(cmd)) return false;
  // Split into commands at unquoted | ; && || and find unquoted > (writing a file).
  const parts = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { if (c === '\\' && q === '"' && i + 1 < cmd.length) { cur += c + cmd[++i]; continue; } if (c === q) q = null; cur += c; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '\\' && i + 1 < cmd.length) { cur += c + cmd[++i]; continue; }
    if (c === '|' || c === ';' || (c === '&' && cmd[i + 1] === '&')) { parts.push(cur); cur = ''; if (cmd[i + 1] === c) i++; continue; }
    if (c === '>') {
      const tail = cmd.slice(i);
      const m = /^>{1,2}\s*\/dev\/null\b|^>&[12]\b/.exec(tail);
      if (!m) return false; // writes a file
      i += m[0].length - 1;
      cur = cur.replace(/\d$/, '');
      continue;
    }
    if (c === '&') return false; // runs something in the background
    cur += c;
  }
  if (q) return false;
  parts.push(cur);
  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;
    if (/^sed\s+-n\s+'?\d+(,\d+)?p'?(\s|$)/.test(p) && !/\s-i\b/.test(p)) continue; // sed -n '24p' file
    if (!READERS.test(p)) return false;
    if (/^find\b/.test(p) && /\s-(exec|execdir|ok|okdir|delete|fprint|fprintf|fls)\b/.test(p)) return false;
  }
  return true;
}

export function blockedReason(command) {
  for (const b of BLOCKED) if (b.re.test(command)) return b.why;
  return null;
}

// "don't ask again for X": the first two words of a command.
export const commandPrefix = (command) => command.trim().split(/\s+/).slice(0, 2).join(' ');

export function decide(name, args, { mode, allowedPrefixes, inside = true, cwd }) {
  if (name === 'TodoWrite' || name === 'Ask') return { decision: 'allow' };
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
    if (mode === 'plan') return isReadOnly(args.command) ? { decision: 'allow' } : { decision: 'deny', reason: 'plan mode is on, so only read-only commands may run' };
    if (isReadOnly(args.command)) return { decision: 'allow' };
    if (allowedPrefixes?.has(commandPrefix(args.command))) return { decision: 'allow' };
    return { decision: 'ask' };
  }
  return { decision: 'deny', reason: 'unknown tool' };
}
