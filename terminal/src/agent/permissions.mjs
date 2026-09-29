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

// A command cut into its parts at unquoted | ; && || and NEW LINES (a new
// line starts another command, so "ls⏎rm notes.txt" is two), with what makes
// its words unsafe to judge: another command inside it ($(…), `…`), a file
// written by > or >> (not to /dev/null), a job left running with &, a quote
// left open. Quoted text is text: newlines and ; inside quotes do not cut.
export function splitCommand(command) {
  const cmd = String(command ?? '').trim();
  const out = { parts: [], nested: /`|\$\(|<\(|>\(/.test(cmd), writes: false, background: false, open: false };
  let cur = '';
  let q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { if (c === '\\' && q === '"' && i + 1 < cmd.length) { cur += c + cmd[++i]; continue; } if (c === q) q = null; cur += c; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '\\' && i + 1 < cmd.length) { cur += c + cmd[++i]; continue; }
    if (c === '|' || c === ';' || c === '\n' || (c === '&' && cmd[i + 1] === '&')) { out.parts.push(cur); cur = ''; if (cmd[i + 1] === c) i++; continue; }
    if (c === '>') {
      const m = /^>{1,2}\s*\/dev\/null\b|^>&[12]\b/.exec(cmd.slice(i));
      if (m) { i += m[0].length - 1; cur = cur.replace(/\d$/, ''); continue; }
      out.writes = true; // writes a file
    } else if (c === '&') out.background = true; // runs something in the background
    cur += c;
  }
  out.open = q !== null;
  out.parts.push(cur);
  return out;
}

// One part that only reads.
function readerPart(part) {
  const p = part.trim();
  if (/^sed\s+-n\s+'?\d+(,\d+)?p'?(\s|$)/.test(p) && !/\s-i\b/.test(p)) return true; // sed -n '24p' file
  if (!READERS.test(p)) return false;
  return !(/^find\b/.test(p) && /\s-(exec|execdir|ok|okdir|delete|fprint|fprintf|fls)\b/.test(p));
}

export function isReadOnly(command) {
  const cmd = String(command ?? '').trim();
  if (!cmd) return false;
  const s = splitCommand(cmd);
  if (s.nested || s.writes || s.background || s.open) return false;
  return s.parts.every((p) => !p.trim() || readerPart(p));
}

export function blockedReason(command) {
  for (const b of BLOCKED) if (b.re.test(command)) return b.why;
  return null;
}

// A commit always asks first, every time (the user's pick, 29 Sep 2026):
// "don't ask again" for a command's first two words, or a commit chained
// after an allowed one ("npm test && git commit -am …"), never lets one
// through. Quotes count as a start too (sh -c "git commit …"): asking once
// too often is cheap, a commit made without asking is not.
const GIT_COMMIT = new RegExp(`(?:${CMD}|["'])\\s*git(?:\\s+(?:-[cC]\\s+\\S+|--?[\\w-]+(?:=\\S+)?))*\\s+commit\\b`);
export const runsGitCommit = (command) => GIT_COMMIT.test(String(command ?? ''));

// ---- What you save with /permissions: commands that run without asking,
// commands that never run, and files that always ask. Rules are plain words.

const words = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean);
const STAR = /\s*\*\s*$/;
// npm run, bun run …: the script after them is what a rule names.
const RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'deno']);
const RUN_WORDS = new Set(['run', 'exec', 'x', 'dlx', 'task']);
// A rule that names a whole program ("make", "bun run"): it still covers only
// that command and its options; /permissions says "make *" covers the rest.
export const isBroad = (w) => w.length === 1 || (w.length === 2 && RUNNERS.has(w[0]) && RUN_WORDS.has(w[1]));

// Does a rule cover one command (one part of a longer one)? The command must
// start with the rule's words, whole words, and whatever follows must be
// options (words that start with -): "npm test" covers "npm test --watch",
// not "npm testing", not "npm run test", and "rm notes.txt" never covers
// "rm notes.txt other.txt". For npm, bun and the like, what follows -- goes
// to the script you allowed ("npm test -- foo"). A rule ending with * covers
// anything after its words ("git add *").
export function ruleCovers(rule, part) {
  const r = words(String(rule ?? '').replace(STAR, ''));
  const w = words(part);
  if (!r.length || r.length > w.length || !r.every((x, i) => x === w[i])) return false;
  if (STAR.test(String(rule))) return true;
  const toScript = RUNNERS.has(r[0]);
  for (let i = r.length; i < w.length; i++) {
    if (toScript && w[i] === '--') return true;
    if (!w[i].startsWith('-')) return false;
  }
  return true;
}

// The rule "always allow" saves for a command: what it runs ("npm test",
// "bun run test", "git add", "node --test"), or the whole command when
// that would not cover it ("git add ." → "git add ."; "rm notes.txt").
export function ruleFor(part) {
  const w = words(part);
  if (!w.length) return null;
  const n = RUNNERS.has(w[0]) && RUN_WORDS.has(w[1] ?? '') && w[2] && !w[2].startsWith('-') ? 3 : 2;
  const head = w.slice(0, n).join(' ');
  return ruleCovers(head, part) ? head : w.join(' ');
}

// Every part of a command against the rules: which part only reads, which
// a saved rule or this session's "don't ask again" covers, which nothing does.
// Allowed only when every part is covered and its words can be trusted (no
// $(…), no file written by >, no job left running).
export function coverage(command, { saved = [], session = [] } = {}) {
  const s = splitCommand(command);
  const plain = !(s.nested || s.writes || s.background || s.open);
  const sessionRules = [...(session ?? [])];
  const parts = s.parts.map((p) => p.trim()).filter(Boolean).map((part) => {
    if (readerPart(part)) return { part, by: 'reads' };
    if (/^cd\s+\S/.test(part)) return { part, by: 'cd' }; // the fence already keeps cd inside the project
    const rule = (saved ?? []).find((r) => ruleCovers(r, part));
    if (rule) return { part, by: 'saved', rule };
    const now = sessionRules.find((r) => ruleCovers(r, part));
    if (now) return { part, by: 'session', rule: now };
    return { part, by: null };
  });
  return { plain, parts, allowed: plain && parts.length > 0 && parts.every((p) => p.by) };
}

// What "always allow" would save for this command: the rule for its first
// part nothing covers yet. Nothing to offer when its words cannot be trusted
// ($(…), a file written by >, a job left running) or every part is covered.
export function offerFor(command, rules = {}) {
  const c = coverage(command, rules);
  if (!c.plain) return null;
  const next = c.parts.find((p) => !p.by);
  const rule = next ? ruleFor(next.part) : null;
  // A rule longer than a typed one may be (checkRule) is not offered: the question asks each time.
  return rule && rule.length <= 120 ? { rule, part: next.part } : null;
}

// The rule of yours (never) whose words appear one after another as whole
// words anywhere in a command, quoted or chained: sh -c "npm publish" too.
const escapeText = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function neverRule(command, never = []) {
  const text = String(command ?? '');
  for (const rule of never ?? []) {
    const w = words(String(rule).replace(STAR, ''));
    if (!w.length) continue;
    const re = new RegExp(`(?:^|[\\s;&|(\\x60"'])${w.map(escapeText).join('\\s+')}(?=$|[\\s;&|)\\x60"'])`);
    if (re.test(text)) return rule;
  }
  return null;
}

// Files that always ask before a change, even in Auto-edit: secrets, git's
// own folder, and this app's settings (a model that could write "mode":
// "edits" there would turn Auto-edit on for itself; started in the home
// folder, .agentic-coder/ with the saved rules is inside the project). Yours
// come on top. Names match whatever their case: on a Mac .ENV is .env.
export const PROTECTED = ['.env', '.env.*', '*.pem', '*.key', 'id_rsa*', 'id_ed25519*', '.git', '.git/**', '.agentic/settings.json', '.bonsai/settings.json', '.agentic-coder/**'];
// * is any run of characters within one name, ** any run across folders, ? one character.
const globText = (g) => g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '[^/]');
const globRe = (g) => new RegExp(`(?:^|/)${globText(g)}$`, 'i');
// rel: a path from the project folder, or several (a link and where it points).
export function protectedBy(rel, extra = []) {
  for (const one of [].concat(rel ?? [])) {
    if (!one) continue;
    const p = String(one).replace(/\\/g, '/').replace(/^\.\//, '');
    for (const g of [...PROTECTED, ...(extra ?? [])]) if (globRe(String(g).replace(/^\.\//, '')).test(p)) return g;
  }
  return null;
}

// What a typed rule may be, for /permissions allow | never | protect:
// { rule, note? } to save, or { error } to say why not.
export function checkRule(kind, text) {
  const t = String(text ?? '').trim().replace(/^(["'`])(.*)\1$/s, '$2').replace(/\s+/g, ' ').trim();
  if (!t) return { error: kind === 'protect' ? 'Say which file, like /permissions protect config/prod.*' : `Say which command, like /permissions ${kind} npm test` };
  if (t.length > 120) return { error: 'That is too long for a rule (120 characters at most).' };
  if (kind === 'protect') {
    if (/^[/~]|(^|\/)\.\.(\/|$)/.test(t)) return { error: 'A protected file is named from the project folder: config/prod.*, not a full path or ../ .' };
    if (!/[^*?/]/.test(t)) return { error: 'That would match every file. Name the file: .env.local, config/prod.*' };
    return { rule: t };
  }
  const bare = t.replace(STAR, '');
  if (/[;&|<>\x60$()]/.test(bare)) return { error: 'A rule is one command, without ; & | > or $( ). Save each part as its own rule.' };
  const why = blockedReason(bare);
  if (kind === 'allow') {
    if (why) return { error: `That is never allowed (${why}), so no rule can allow it.` };
    if (runsGitCommit(bare) || /^git\s+commit\b/.test(bare)) return { error: 'A commit always asks first, so no rule can allow it.' };
    if (isReadOnly(bare)) return { error: `"${bare}" only reads, so it already runs without asking.` };
    const w = words(bare);
    if (isBroad(w) && !STAR.test(t)) return { rule: t, note: `"${bare} *" would cover anything after it.` };
    return { rule: t };
  }
  if (why) return { error: `That is already never allowed (${why}).` };
  return { rule: t };
}

// The decision for one tool call, with the reason (the /permissions test
// panel prints it). decide() below is the same without the reason.
//   rules: { allow, never, protect } from /permissions; rel: the path from the project folder.
export function judge(name, args, { mode, allowedPrefixes, inside = true, cwd, rules, rel } = {}) {
  if (name === 'TodoWrite' || name === 'Ask') return { decision: 'allow', why: 'it changes nothing' };
  if (name === 'Read' || name === 'List' || name === 'Search') return inside ? { decision: 'allow', why: 'reading inside the project never asks' } : { decision: 'deny', reason: 'that is outside the project folder; only files inside it may be read' };
  if (name === 'Edit' || name === 'Write') {
    if (!inside) return { decision: 'deny', reason: 'that file is outside the project folder' };
    if (mode === 'plan') return { decision: 'deny', reason: 'plan mode is on, so nothing may be changed yet' };
    // A protected file always asks, even in Auto-edit, and has no "allow all edits" choice (once).
    const guard = protectedBy(rel ?? args?.path, rules?.protect);
    if (guard) return { decision: 'ask', once: true, protectedBy: guard, why: `it is a protected file (${guard}); protected files always ask` };
    if (mode === 'edits') return { decision: 'allow', why: 'Auto-edit is on' };
    return { decision: 'ask', why: 'Ask first is on' };
  }
  if (name === 'Bash') {
    const command = args?.command ?? '';
    const why = blockedReason(command);
    if (why) return { decision: 'deny', reason: `blocked: ${why}` };
    const out = outsidePath(command, cwd);
    if (out) return { decision: 'deny', reason: `${out} is outside the project folder; commands stay inside it` };
    // Your own never-list holds in every mode.
    const mine = neverRule(command, rules?.never);
    if (mine) return { decision: 'deny', reason: `blocked by your rule "${mine}" (/permissions)` };
    if (mode === 'plan') return isReadOnly(command) ? { decision: 'allow', why: 'it only reads' } : { decision: 'deny', reason: 'plan mode is on, so only read-only commands may run' };
    // once: no "don't ask again" for it.
    if (runsGitCommit(command)) return { decision: 'ask', once: true, why: 'a commit always asks' };
    if (isReadOnly(command)) return { decision: 'allow', why: 'it only reads' };
    const c = coverage(command, { saved: rules?.allow, session: allowedPrefixes });
    if (c.allowed) {
      const used = [...new Set(c.parts.filter((p) => p.rule).map((p) => `"${p.rule}" (${p.by === 'saved' ? 'saved' : 'this session'})`))];
      return { decision: 'allow', why: `every part is covered: ${used.join(', ')}${c.parts.some((p) => p.by === 'reads') ? ', the rest only reads' : ''}` };
    }
    const open = c.parts.find((p) => !p.by);
    return { decision: 'ask', why: !c.plain ? 'its words cannot be trusted for a rule ($(…), a file written with >, or a job left running), so it asks' : c.parts.length > 1 ? `"${open.part}" is not covered by any rule` : 'it can change things and no rule covers it' };
  }
  return { decision: 'deny', reason: 'unknown tool' };
}

export function decide(name, args, ctx) {
  const { why, ...d } = judge(name, args, ctx);
  return d;
}
