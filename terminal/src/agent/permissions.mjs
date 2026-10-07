import { homedir } from 'node:os';
import { resolve, relative, isAbsolute, dirname, basename, join } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';
import { isMcpCall, mcpRule, parseMcpRule } from './mcp.mjs';

// Which tool calls run straight away, which ask you first, and which are
// never allowed. Modes, as /mode lists them (Claude Code's five):
//   auto    the rules decide the clear cases; the model checks the rest
//           (agent/auto-check.mjs): fits the request and can be undone → runs, else asks
//   ask     Manual: asks before every change (the default)
//   edits   Accept edits: file changes go through; commands still ask
//   plan    read-only: it may look but not change anything
//   bypass  never asks; the blocked commands, your never-list and the app's own
//           settings still hold. The folder fence and the sandbox's internet block
//           are lifted (the owner's pick, 3 Oct 2026); what already runs on this
//           Mac stays out of reach (sandbox.mjs)
export const MODES = ['auto', 'ask', 'edits', 'plan', 'bypass'];
// shift+tab walks these. Bypass is picked on purpose (/mode 5, /mode bypass, --mode
// bypass), never by cycling into it; from Bypass, shift+tab goes back to Manual.
export const CYCLE = ['ask', 'edits', 'plan', 'auto'];
export const nextMode = (mode) => CYCLE[(CYCLE.indexOf(mode) + 1) % CYCLE.length];
// The words a mode is typed as: Claude Code's names, and the ones this app used before.
const MODE_ALIASES = { manual: 'ask', default: 'ask', accept: 'edits', 'accept-edits': 'edits', acceptedits: 'edits', 'auto-edit': 'edits', bypasspermissions: 'bypass', 'bypass-permissions': 'bypass' };
export const modeOf = (word) => { const w = String(word ?? '').trim().toLowerCase(); return MODES.includes(w) ? w : MODE_ALIASES[w] ?? null; };

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
export const outsidePath = (command, cwd) => outsidePaths(command, cwd)[0] ?? null;
// Every one of them, in order (Bypass looks for a secret among them).
function outsidePaths(command, cwd) {
  if (!cwd) return [];
  const home = homedir();
  const cmd = String(command ?? '');
  const out = [];
  const within = (rel) => rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  let realCwd = null;
  if (/(?:^|[;&|(]\s*)(?:cd|pushd)\s*(?:$|[;&|)])/.test(cmd)) out.push('~');
  for (const w of pathCandidates(cmd)) {
    let p = null;
    if (w === '~' || w.startsWith('~/')) p = home + w.slice(1);
    else if (/^~[\w.-]+/.test(w)) { out.push(w); continue; } // ~user: someone's home folder
    else if (/^\$\{?HOME\}?(\/|$)/.test(w)) p = w.replace(/^\$\{?HOME\}?/, home);
    else if (w.startsWith('/') && !/[\\^]/.test(w)) p = w; // not a regex such as /a\/b/
    else if (/(^|\/)\.\.(\/|$)/.test(w)) p = resolve(cwd, w);
    else continue;
    p = resolve(p);
    if (within(relative(cwd, p))) continue;
    if (SYSTEM_DIRS.some((d) => p === d || p.startsWith(`${d}/`))) continue;
    // The project under another name for the same place: on a Mac /var is /private/var, and node's
    // process.cwd() gives the second. Twice in the shootout of 4-5 Oct 2026 a model's command on its own
    // project ("cd /private/var/folders/…/project && node -e …") was turned away as outside it.
    realCwd ??= realOf(cwd);
    if (within(relative(realCwd, realOf(p)))) continue;
    out.push(w);
  }
  return out;
}

// Where a path really is, through links, for the part of it that exists.
function realOf(p) {
  const rest = [];
  for (let head = p; ; head = dirname(head)) {
    try { return join(realpathSync(head), ...rest.reverse()); } catch {}
    if (dirname(head) === head) return p;
    rest.push(basename(head));
  }
}

// The words of a command as the shell sees them: quoted text stays one word
// ("=== byte count / line count ===" is text, not the folder /), unquoted
// text splits on spaces and shell operators, and Desktop/"a b.txt" is one word.
// A heredoc's body (python3 << 'EOF' … EOF) is one quoted word too: it is the
// program's text, not the shell's. Split into words, the division in a Python
// script (model_mape / naive_mape) was the folder / and the script was turned
// away as outside the project, in the home folder itself (3 Oct 2026).
function shellWords(cmd) {
  const words = [];
  let cur = '';
  let has = false;
  let quoted = false;
  const heredocs = []; // the ones opened on this line: their bodies start after it
  const push = () => { if (has) words.push(Object.assign(new String(cur), { quoted })); cur = ''; has = false; quoted = false; };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    // << WORD, <<-WORD, << 'WORD', << "WORD" (not <<<, and not a shift such as $(( a << 2 ))).
    if (c === '<' && cmd[i + 1] === '<' && cmd[i + 2] !== '<') {
      const m = /^<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|([A-Za-z_][\w.-]*))/.exec(cmd.slice(i));
      if (m) { push(); heredocs.push({ end: m[2] ?? m[3] ?? m[4], tabs: m[1] === '-' }); i += m[0].length - 1; continue; }
    }
    if (c === '\n' && heredocs.length) {
      push();
      for (const h of heredocs.splice(0)) {
        const lines = [];
        let at = i + 1;
        while (at < cmd.length) {
          const nl = cmd.indexOf('\n', at);
          const line = cmd.slice(at, nl < 0 ? cmd.length : nl);
          at = nl < 0 ? cmd.length : nl + 1;
          if ((h.tabs ? line.replace(/^\t+/, '') : line) === h.end) break;
          lines.push(line);
        }
        if (lines.length) words.push(Object.assign(new String(lines.join('\n')), { quoted: true }));
        i = at - 1;
      }
      continue;
    }
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
    const regexes = regexSpans(text);
    for (const m of text.matchAll(/[^\s;&|()<>=,`'"]+/g)) {
      const piece = m[0];
      if (regexes.some(([a, b]) => m.index >= a && m.index < b)) continue;
      if (piece.length > 1 && piece !== text && !codeNotPath(text, piece, m.index)) out.push(piece);
    }
  }
  return out;
}

// The regular expressions written in quoted code (JavaScript's /…/), as [start, end) places in it: their
// words are not paths. Five of the commands turned away in the shootout of 4-5 Oct 2026 were regexes in
// node -e code: /x|y|z/.test(…) gave "/x", code.match(/export function plainRead\(…/) gave "/export".
// One counts only where an expression starts (after ( , = : [ ! & | ? { } ;), on one line, and only when
// it reads as one: a sign only a regex has (\ | ^ $ * + ? [ ( {), flags, .test( or .exec( after it, or
// match(, replace(, split( or search( before it. A path such as /Users/x/a never ends its first name with a
// slash followed by those, so "cat </Users/x/a" and "DIR=/Users/; ls" are still paths.
function regexSpans(text) {
  const spans = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '/' || text[i + 1] === '/' || text[i + 1] === '*') continue;
    const before = text.slice(Math.max(0, text.lastIndexOf('\n', i - 1) + 1), i).trimEnd();
    if (!/[(,=:[!&|?{};]$/.test(before)) continue;
    let j = i + 1;
    let inClass = false;
    for (; j < text.length && text[j] !== '\n'; j++) {
      if (text[j] === '\\') { j++; continue; }
      if (text[j] === '[') inClass = true;
      else if (text[j] === ']') inClass = false;
      else if (text[j] === '/' && !inClass) break;
    }
    if (j >= text.length || text[j] !== '/' || j === i + 1) continue;
    const flags = /^[dgimsuyv]*/.exec(text.slice(j + 1))[0];
    const next = text.slice(j + 1 + flags.length);
    if (!/^\s*(?:[.),;\]}:?&|]|$)/.test(next)) continue;
    const body = text.slice(i + 1, j);
    const reads = /[\\|^$*+?[({]/.test(body) || flags || /^\.(?:test|exec)\(/.test(next) || /\b(?:match|matchAll|replace|replaceAll|split|search)\(\s*$/.test(before);
    if (!reads) continue;
    spans.push([i, j + 1 + flags.length]);
    i = j + flags.length;
  }
  return spans;
}

// Pieces of quoted code that only look like a path; each was a command turned away on 1 Oct
// 2026 ("… is outside the project folder"): a comment's // (node -e "// Simulate…"), a method
// on a regex (/<meta charset=/.test(txt) gives /.test), and an HTML closing tag in a string
// ('<button …>Download</button>' gives /button). A tag is one name between < and >, so
// "cat </Users/x/a" in an sh -c string is still read as the path it is.
function codeNotPath(text, piece, at) {
  const after = text[at + piece.length];
  if (/^\/+$/.test(piece)) return true;
  // A division by a number (6 Oct 2026: Math.round(x*100)/100 in node -e code, and '/100→' in its text,
  // refused four times in one task): a slash, a number and nothing after but signs. /100/notes.txt and
  // /2024-report.pdf go on past the number and are still paths.
  if (/^\/\d+(?:\.\d+)?[^\w/]*$/.test(piece)) return true;
  if (/^\/\.[A-Za-z_$][\w$]*$/.test(piece) && after === '(') return true;
  return /^\/[A-Za-z][\w-]*$/.test(piece) && text[at - 1] === '<' && after === '>';
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
// seps: what cut each part from the next (| || ; && or a new line).
export function splitCommand(command) {
  const cmd = String(command ?? '').trim();
  const out = { parts: [], seps: [], nested: /`|\$\(|<\(|>\(/.test(cmd), writes: false, background: false, open: false };
  let cur = '';
  let q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { if (c === '\\' && q === '"' && i + 1 < cmd.length) { cur += c + cmd[++i]; continue; } if (c === q) q = null; cur += c; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '\\' && i + 1 < cmd.length) { cur += c + cmd[++i]; continue; }
    if (c === '|' || c === ';' || c === '\n' || (c === '&' && cmd[i + 1] === '&')) { out.parts.push(cur); cur = ''; out.seps.push(cmd[i + 1] === c ? c + c : c); if (cmd[i + 1] === c) i++; continue; }
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

// Commands that run tests: the project's test command, the check named for this message, or a
// known test runner, at the start of one of its parts (after "cd x &&", "CI=1", "timeout 60").
// Reading, searching or listing a test file is not running it (3 Oct 2026: any command with the
// word "test" in it counted, so a grep of the test file that found nothing put a passing change
// back, and a cat of it after failing tests kept a broken one).
const TEST_RUNNERS = new RegExp(`^(?:${[
  String.raw`(?:npm|pnpm|yarn|bun)\s+(?:run(?:-script)?\s+)?test(?::[\w:.-]+)?\b(?!\.)`, String.raw`npm\s+t\b`, String.raw`bun\s+test\b`,
  String.raw`(?:npx|bunx|pnpm\s+(?:exec|dlx)|yarn\s+(?:exec|dlx))\s+(?:-\S+\s+)*(?:jest|vitest|mocha|ava|tap|playwright\s+test|cypress\s+run)\b`,
  String.raw`(?:\.\/node_modules\/\.bin\/)?(?:jest|vitest|mocha|ava)\b(?!\.)`,
  String.raw`node\s+(?:-\S+\s+)*--test\b`, String.raw`deno\s+test\b`,
  String.raw`(?:python3?|py)\s+(?:-\S+\s+)*-m\s+(?:pytest|unittest)\b`, String.raw`(?:pytest|py\.test|tox|nox)\b(?!\.)`,
  String.raw`cargo\s+(?:test|nextest)\b`, String.raw`go\s+test\b`, String.raw`swift\s+test\b`, String.raw`dotnet\s+test\b`, String.raw`zig\s+build\s+test\b`,
  String.raw`mvn\s+(?:\S+\s+)*test\b`, String.raw`(?:\.\/)?gradlew?\s+(?:\S+\s+)*test\b`,
  String.raw`(?:bundle\s+exec\s+)?(?:rspec|rake\s+test)\b`, String.raw`(?:(?:\.\/)?vendor\/bin\/)?phpunit\b`, String.raw`mix\s+test\b`, String.raw`ctest\b`, String.raw`make\s+(?:-\S+\s+)*(?:test|check)\b`,
].join('|')})`);
// A test file run by itself: node export.test.mjs, bun ./a.spec.ts, python tests/test_calc.py.
const TEST_FILE_RUN = /^(?:node|bun(?:\s+run)?|deno\s+run|tsx|ts-node|python3?)\s+(?:-\S+\s+)*\S*?(?:[./_-](?:test|spec)\.[cm]?[jt]sx?|_test\.py|\btest_\w*\.py)(?=\s|\)|$)/;
// What may come before the command itself: a subshell's (, NAME=value, env, time, timeout 60.
const WRAPPERS = /^(?:\(\s*|(?:[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S*)|env|time|command|nice|timeout(?:\s+-\S+)*\s+\d+[smh]?)\s+)+/;
export function runsTests(command, own = {}) { return testRunOf(command, own) !== null; }
// The same, with how: { piped } when the run's output goes on into another command (… | tail -20),
// whose exit code then stands for the whole line and says nothing about the tests. null: no test run.
export function testRunOf(command, { testCmd = null, check = null } = {}) {
  const own = [testCmd, check].map((c) => String(c ?? '').trim().replace(/\s+/g, ' ')).filter(Boolean);
  const s = splitCommand(command);
  let found = null;
  s.parts.forEach((raw, i) => {
    const p = raw.trim().replace(WRAPPERS, '').replace(/\s+/g, ' ');
    if (!p || !(own.some((c) => p === c || p.startsWith(`${c} `) || p.startsWith(`${c})`)) || TEST_RUNNERS.test(p) || TEST_FILE_RUN.test(p))) return;
    found = { piped: s.seps[i] === '|' };
  });
  return found;
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
const isBroad = (w) => w.length === 1 || (w.length === 2 && RUNNERS.has(w[0]) && RUN_WORDS.has(w[1]));

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

// The protected file a command names, if any ("cp .env.example .env" → ".env"):
// a word of it, or a piece after = (--out=.env). Reading one is fine; this is
// for a part that can change things.
function namesProtected(part, protect = []) {
  for (const w of shellWords(String(part ?? ''))) { const g = protectedBy(String(w), protect); if (g) return g; }
  return null;
}

// Every part of a command against the rules: which part only reads, which
// a saved rule or this session's "don't ask again" covers, which nothing does.
// Allowed only when every part is covered and its words can be trusted (no
// $(…), no file written by >, no job left running). A part that names a
// protected file is never covered, whatever the rules say: it asks.
export function coverage(command, { saved = [], session = [], protect = [] } = {}) {
  const s = splitCommand(command);
  const plain = !(s.nested || s.writes || s.background || s.open);
  const sessionRules = [...(session ?? [])];
  const parts = s.parts.map((p) => p.trim()).filter(Boolean).map((part) => {
    if (readerPart(part)) return { part, by: 'reads' };
    if (/^cd\s+\S/.test(part)) return { part, by: 'cd' }; // the fence already keeps cd inside the project
    const guard = namesProtected(part, protect);
    if (guard) return { part, by: null, protectedBy: guard };
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
  if (next?.protectedBy) return null; // no rule could let it through
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
export const PROTECTED = ['.env', '.env.*', '*.pem', '*.key', 'id_rsa*', 'id_ed25519*', '.git', '.git/**', '.agentic/settings.json', '.agentic/mcp.json', '.agentic/hooks.json', '.agentic-coder/**'];
// The app's own settings and rules: in Bypass, where nothing asks, a change to one is
// refused instead (a model that could write them could change its own mode or rules).
// .agentic/mcp.json names programs that start with the next window (a project's MCP servers): a model
// that could write it could give itself a command to run, and so could one writing .agentic/hooks.json
// (a project's own hooks, user-hooks.mjs).
export const OWN = ['.agentic/settings.json', '.agentic/mcp.json', '.agentic/hooks.json', '.agentic-coder/**'];
// * is any run of characters within one name, ** any run across folders, ? one character.
const globText = (g) => g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '[^/]');
const globRe = (g) => new RegExp(`(?:^|/)${globText(g)}$`, 'i');
// rel: a path from the project folder, or several (a link and where it points).
export function protectedBy(rel, extra = [], list = PROTECTED) {
  for (const one of [].concat(rel ?? [])) {
    if (!one) continue;
    const p = String(one).replace(/\\/g, '/').replace(/^\.\//, '');
    for (const g of [...list, ...(extra ?? [])]) if (globRe(String(g).replace(/^\.\//, '')).test(p)) return g;
  }
  return null;
}
// One of the app's own files (OWN), by path or named in a command's words.
export const ownBy = (rel) => protectedBy(rel, [], OWN);
// Secrets outside the project stay out of reach even in Bypass, which lifts the folder fence:
// an SSH key or another project's .env would go to a model on another machine.
export const SECRET_FILES = ['.ssh', '.ssh/**', '.env', '.env.*', '*.pem', '*.key', 'id_rsa*', 'id_ed25519*'];
const secretBy = (paths) => protectedBy(paths, [], SECRET_FILES);
const namesOwn = (command) => { for (const w of shellWords(String(command ?? ''))) { const g = ownBy(String(w)); if (g) return g; } return null; };

// The files a part writes with > or >> (not /dev/null, not >&2), as typed.
function writeTargets(part) {
  const s = String(part ?? '');
  const out = [];
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '\\') { i++; continue; }
    if (c !== '>') continue;
    let j = i + 1;
    if (s[j] === '>' || s[j] === '|') j++;
    if (s[j] === '&') { i = j; continue; }
    while (s[j] === ' ' || s[j] === '\t') j++;
    const m = /^(?:"([^"]*)"|'([^']*)'|([^\s;|&<>()]+))/.exec(s.slice(j));
    if (!m) continue;
    const target = m[1] ?? m[2] ?? m[3];
    if (target !== '/dev/null') out.push(target);
    i = j + m[0].length - 1;
  }
  return out;
}

// The app's own settings and rules a command may change (Bypass refuses it): one named by a part
// that does more than read, or written with >; after a cd, the names are taken from that folder too.
// A part that only reads may name them: 7 Oct 2026, a grep of the test record (~/.agentic-coder/tests)
// piped on into another command was refused as if it changed the app's own settings.
function ownChanged(command) {
  const s = splitCommand(command);
  if (s.nested || s.open || s.background) return namesOwn(command);
  let dir = '';
  for (const raw of s.parts) {
    const part = raw.trim();
    const words = shellWords(part).map(String);
    const own = (list) => { for (const w of list) { const g = ownBy(w) ?? (dir ? ownBy(join(dir, w)) : null); if (g) return g; } return null; };
    if (words[0] === 'cd' || words[0] === 'pushd') { const to = words[1] ?? '~'; dir = !dir || to.startsWith('/') || to.startsWith('~') ? to : join(dir, to); continue; }
    const hit = readerPart(part) ? own(writeTargets(part)) : own(words);
    if (hit) return hit;
  }
  return null;
}

// What a typed rule may be, for /permissions allow | never | protect:
// { rule, note? } to save, or { error } to say why not.
export function checkRule(kind, text, { protect = [] } = {}) {
  const t = String(text ?? '').trim().replace(/^(["'`])(.*)\1$/s, '$2').replace(/\s+/g, ' ').trim();
  if (!t) return { error: kind === 'protect' ? 'Say which file, like /permissions protect config/prod.*' : `Say which command, like /permissions ${kind} npm test` };
  if (t.length > 120) return { error: 'That is too long for a rule (120 characters at most).' };
  if (kind === 'protect') {
    if (/^[/~]|(^|\/)\.\.(\/|$)/.test(t)) return { error: 'A protected file is named from the project folder: config/prod.*, not a full path or ../ .' };
    if (!/[^*?/]/.test(t)) return { error: 'That would match every file. Name the file: .env.local, config/prod.*' };
    return { rule: t };
  }
  // A screen rule: Screen(TextEdit), or Screen(whole screen).
  const scr = SCREEN_RULE.exec(t);
  if (scr) return { rule: `Screen(${scr[1].trim()})` };
  // An MCP rule: Mcp(server:tool) for one tool; Mcp(server:*) for a whole server, on the never-list only
  // (to let a server's tools run unasked, mark them as reading in /mcp, one by one).
  if (/^mcp\(/i.test(t)) {
    const m = parseMcpRule(t);
    if (!m) return { error: 'An MCP rule names one tool of one server: Mcp(github:create_issue).' };
    if (m.tool === '*' && kind === 'allow') return { error: `Allow one tool at a time: Mcp(${m.server}:its_tool). A whole server (Mcp(${m.server}:*)) can only go on the never-list.` };
    return { rule: m.rule };
  }
  // A web rule: WebSearch, or WebFetch(site).
  const web = WEB_RULE.exec(t);
  if (web) return { rule: web[2] ? `WebFetch(${web[2].toLowerCase()})` : 'WebSearch' };
  const bare = t.replace(STAR, '');
  if (/[;&|<>\x60$()]/.test(bare)) return { error: 'A rule is one command, without ; & | > or $( ). Save each part as its own rule.' };
  const why = blockedReason(bare);
  if (kind === 'allow') {
    if (why) return { error: `That is never allowed (${why}), so no rule can allow it.` };
    if (runsGitCommit(bare) || /^git\s+commit\b/.test(bare)) return { error: 'A commit always asks first, so no rule can allow it.' };
    if (isReadOnly(bare)) return { error: `"${bare}" only reads, so it already runs without asking.` };
    const guard = namesProtected(bare, protect);
    if (guard) return { error: `That names a protected file (${guard}): a command that changes one always asks, so no rule can allow it.` };
    const w = words(bare);
    if (isBroad(w) && !STAR.test(t)) return { rule: t, note: `"${bare} *" would cover anything after it.` };
    return { rule: t };
  }
  if (why) return { error: `That is already never allowed (${why}).` };
  return { rule: t };
}

// The web tools' rules, as /permissions keeps them: "WebSearch", and "WebFetch(site)"
// for one site (its host, without www.). siteOf answers null for what is not a web address.
export const siteOf = (url) => {
  const t = String(url ?? '').trim();
  const scheme = /^[a-z][a-z\d+.-]*:\/\//i.test(t) || /^(mailto|data|javascript|about|tel|file):/i.test(t);
  try { const u = new URL(scheme ? t : `https://${t}`); return /^https?:$/.test(u.protocol) && u.hostname ? u.hostname.replace(/^www\./, '').toLowerCase() : null; } catch { return null; }
};
const webRule = (name, args) => (name === 'WebSearch' ? 'WebSearch' : siteOf(args?.url) ? `WebFetch(${siteOf(args.url)})` : null);
const WEB_RULE = /^(WebSearch|WebFetch\((?:www\.)?([a-z0-9.-]+\.[a-z0-9-]+)\))$/i;

// The screen (the Screen tool, tools/screen.mjs): what the model may look at, by app,
// as /permissions keeps it: "Screen(TextEdit)", or "Screen(whole screen)" for all of it.
// It only looks (a picture), so it is asked once per app in every mode but Bypass.
const screenTarget = (args) => String(args?.app ?? '').trim().replace(/\s+/g, ' ').slice(0, 60) || 'whole screen';
const screenRule = (args) => `Screen(${screenTarget(args)})`;
const SCREEN_RULE = /^Screen\(([^()]{1,60})\)$/i;
const hasRule = (list, rule) => [...(list ?? [])].some((r) => String(r).toLowerCase() === rule.toLowerCase());

// The decision for one tool call, with the reason (the /permissions test
// panel prints it). decide() below is the same without the reason.
//   rules: { allow, never, protect } from /permissions; rel: the path from the project folder.
//   mcp: for a tool of an MCP server, what the app knows of it: { server, tool, reads, changed }.
export function judge(name, args, { mode, allowedPrefixes, inside = true, cwd, rules, rel, mcp } = {}) {
  const bypass = mode === 'bypass';
  // A tool of an MCP server (agent/mcp.mjs): a program or a service of the user's, which can do
  // whatever its server lets it. Each tool asks before its first use, in every mode but Bypass,
  // until a rule allows it. reads: the user marked it in /mcp as one that only reads (the server's
  // own label is never taken for that); such a tool is let through where reading is (plan mode,
  // Auto). changed: its description or arguments are not what they were when it was allowed or
  // marked, so the old yes does not count.
  if (isMcpCall(name)) {
    if (!mcp?.server) return { decision: 'deny', reason: 'that is not one of this conversation\'s MCP tools' };
    const rule = mcpRule(mcp.server, mcp.tool);
    const blocked = [rule, mcpRule(mcp.server, '*')].find((r) => hasRule(rules?.never, r));
    if (blocked) return { decision: 'deny', reason: `blocked by your rule "${blocked}" (/permissions)` };
    if (mode === 'plan' && !mcp.reads) return { decision: 'deny', reason: 'plan mode is on, and this MCP tool is not one you marked as only reading (/mcp)' };
    const saved = hasRule(rules?.allow, rule);
    if ((saved || hasRule(allowedPrefixes, rule)) && !mcp.changed) return { decision: 'allow', why: `"${rule}" is allowed (${saved ? 'saved' : 'this session'})` };
    if (bypass) return { decision: 'allow', why: `Bypass permissions is on${mcp.changed ? ' (the tool changed since you allowed it)' : ''}` };
    if (mode === 'auto' && mcp.reads) return { decision: 'allow', why: 'Auto: you marked this tool as one that only reads' };
    return { decision: 'ask', rule, ...(mcp.changed ? { changed: true } : {}), why: mcp.changed ? 'the tool changed since you allowed it' : mode === 'auto' ? 'Auto cannot tell what an MCP tool changes, so it asks' : `no rule allows ${mcp.server}'s ${mcp.tool} yet` };
  }
  if (name === 'TodoWrite' || name === 'Ask') return { decision: 'allow', why: 'it changes nothing' };
  // A background command's output, or a stop of it: the command itself was asked about when it started.
  if (name === 'Jobs') return { decision: 'allow', why: 'it reads or stops a command you already let run' };
  // The model's own tools when it decides (agent/way.mjs): two read, one writes to the memory,
  // and two run a focused path, whose every change asks as your mode says (so plan mode refuses them).
  if (name === 'Map' || name === 'CodeSearch') return { decision: 'allow', why: 'it only reads' };
  // A helper: the call itself changes nothing; each thing it does is asked about as your mode says.
  if (name === 'Agent') return { decision: 'allow', why: args?.kind === 'general' ? 'each change the helper makes asks as your mode says' : 'the helper only reads' };
  if (name === 'Remember') return { decision: 'allow', why: 'it writes to the memory, not to the project' };
  if (name === 'Rename' || name === 'TestFirst') return mode === 'plan' ? { decision: 'deny', reason: 'plan mode is on, so nothing may be changed yet' } : { decision: 'allow', why: 'each change it makes asks as your mode says' };
  // The screen: a picture of one app's window, or of all of it. It changes nothing, but it can
  // show anything that is open, so each app asks once (this time, this session, always, no),
  // in every mode but Bypass; your never-list holds even there.
  if (name === 'Screen') {
    const rule = screenRule(args);
    if (hasRule(rules?.never, rule)) return { decision: 'deny', reason: `blocked by your rule "${rule}" (/permissions)` };
    const saved = hasRule(rules?.allow, rule);
    if (saved || hasRule(allowedPrefixes, rule)) return { decision: 'allow', why: `"${rule}" is allowed (${saved ? 'saved' : 'this session'})` };
    if (bypass) return { decision: 'allow', why: 'Bypass permissions is on' };
    return { decision: 'ask', rule, why: `the model has not been allowed to look at ${screenTarget(args) === 'whole screen' ? 'the whole screen' : screenTarget(args)} yet` };
  }
  // The web: a search sends its words to the search service, a page is read from a site. Each asks
  // first (it changes nothing here, so plan mode asks too), until a rule allows it: "don't ask
  // again" for this session, or one saved with /permissions. Auto: the model checks it first.
  if (name === 'WebSearch' || name === 'WebFetch') {
    const rule = webRule(name, args);
    if (!rule) return { decision: 'deny', reason: 'that is not a web address (http or https)' };
    if ((rules?.never ?? []).includes(rule)) return { decision: 'deny', reason: `blocked by your rule "${rule}" (/permissions)` };
    const saved = (rules?.allow ?? []).includes(rule);
    if (saved || [...(allowedPrefixes ?? [])].includes(rule)) return { decision: 'allow', why: `"${rule}" is allowed (${saved ? 'saved' : 'this session'})` };
    if (bypass) return { decision: 'allow', why: 'Bypass permissions is on' };
    if (mode === 'auto') return { decision: 'check', rule, why: 'Auto: the model checks that it fits your request' };
    return { decision: 'ask', rule, why: name === 'WebSearch' ? 'a search sends its words to the search service' : `no rule allows reading ${siteOf(args.url)} yet` };
  }
  // Outside the project, Bypass lets a step through unless it names a secret (SECRET_FILES).
  const away = [].concat(rel ?? [], args?.path ?? []);
  if (name === 'Read' || name === 'List' || name === 'Search') {
    if (inside) return { decision: 'allow', why: 'reading inside the project never asks' };
    if (bypass && !secretBy(away)) return { decision: 'allow', why: 'Bypass permissions is on: any folder may be read' };
    return { decision: 'deny', reason: bypass ? 'that is a secret outside the project folder (a key, .ssh or .env), which even Bypass does not reach' : 'that is outside the project folder; only files inside it may be read' };
  }
  if (name === 'Edit' || name === 'Write') {
    if (!inside && (!bypass || secretBy(away))) return { decision: 'deny', reason: bypass ? 'that is a secret outside the project folder (a key, .ssh or .env), which even Bypass does not reach' : 'that file is outside the project folder' };
    if (mode === 'plan') return { decision: 'deny', reason: 'plan mode is on, so nothing may be changed yet' };
    // A protected file always asks, even in Accept edits and Auto, and has no "allow all edits"
    // choice (once). In Bypass nothing asks: it goes through, but the app's own settings never do.
    const guard = protectedBy(rel ?? args?.path, rules?.protect);
    if (bypass) {
      const own = ownBy(rel ?? args?.path);
      return own ? { decision: 'deny', reason: `${own} holds Agentic Coder's own settings and rules, which the model never changes, even in Bypass permissions` } : { decision: 'allow', why: 'Bypass permissions is on' };
    }
    if (guard) return { decision: 'ask', once: true, protectedBy: guard, why: `it is a protected file (${guard}); protected files always ask` };
    if (mode === 'edits') return { decision: 'allow', why: 'Accept edits is on' };
    if (mode === 'auto') return { decision: 'allow', why: 'Auto: edits inside the project go through' };
    return { decision: 'ask', why: 'Manual is on' };
  }
  if (name === 'Bash') {
    const command = args?.command ?? '';
    const why = blockedReason(command);
    if (why) return { decision: 'deny', reason: `blocked: ${why}` };
    // Bypass lifts the fence: a command may name any folder, but not a secret outside the
    // project (SECRET_FILES), and not the app's own settings (below).
    const outs = outsidePaths(command, cwd);
    const secret = bypass ? outs.find((w) => secretBy(w)) : null;
    if (secret) return { decision: 'deny', reason: `${secret} is a secret outside the project folder (a key, .ssh or .env), which even Bypass does not reach` };
    // A path that is not there (a made-up value in code, a file to make in /tmp): say what to use instead.
    const gone = outs[0] && outs[0] !== '~' && !outs[0].startsWith('~') && !existsSync(resolve(cwd ?? '.', outs[0]));
    if (outs.length && !bypass) return { decision: 'deny', reason: `${outs[0]} is outside the project folder; commands stay inside it${gone ? `. Nothing is there now: for a file of your own, or a made-up path in code, use a name inside the project, such as ${JSON.stringify(basename(outs[0]) || 'tmp')}` : ''}` };
    // Your own never-list holds in every mode.
    const mine = neverRule(command, rules?.never);
    if (mine) return { decision: 'deny', reason: `blocked by your rule "${mine}" (/permissions)` };
    if (mode === 'plan') return isReadOnly(command) ? { decision: 'allow', why: 'it only reads' } : { decision: 'deny', reason: 'plan mode is on, so only read-only commands may run' };
    if (bypass) {
      const own = ownChanged(command);
      return own ? { decision: 'deny', reason: `it names ${own}, Agentic Coder's own settings and rules, which the model never changes, even in Bypass permissions` } : { decision: 'allow', why: 'Bypass permissions is on (any folder and the internet; what already runs on this Mac stays out of reach)' };
    }
    // once: no "don't ask again" for it.
    if (runsGitCommit(command)) return { decision: 'ask', once: true, why: 'a commit always asks' };
    if (isReadOnly(command)) return { decision: 'allow', why: 'it only reads' };
    const c = coverage(command, { saved: rules?.allow, session: allowedPrefixes, protect: rules?.protect });
    if (c.allowed) {
      const used = [...new Set(c.parts.filter((p) => p.rule).map((p) => `"${p.rule}" (${p.by === 'saved' ? 'saved' : 'this session'})`))];
      return { decision: 'allow', why: `every part is covered: ${used.join(', ')}${c.parts.some((p) => p.by === 'reads') ? ', the rest only reads' : ''}` };
    }
    const open = c.parts.find((p) => !p.by);
    // A command that names a protected file: asked every time, with no "don't ask again".
    const guarded = c.parts.find((p) => p.protectedBy);
    if (guarded) return { decision: 'ask', once: true, protectedBy: guarded.protectedBy, why: `"${guarded.part}" names a protected file (${guarded.protectedBy}), so it asks` };
    // Auto: what no rule covers, the model checks against your request (agent/auto-check.mjs);
    // runs when it fits and can be undone, else it asks you as Manual would.
    if (mode === 'auto') return { decision: 'check', why: 'Auto: no rule covers it, so the model checks it first' };
    return { decision: 'ask', why: !c.plain ? 'its words cannot be trusted for a rule ($(…), a file written with >, or a job left running), so it asks' : c.parts.length > 1 ? `"${open.part}" is not covered by any rule` : 'it can change things and no rule covers it' };
  }
  return { decision: 'deny', reason: 'unknown tool' };
}

export function decide(name, args, ctx) {
  const { why, ...d } = judge(name, args, ctx);
  return d;
}

// ---- the remote set's PERMISSIONS guide (prompt-files.mjs) -------------------------------------

const MODE_NAMES = { auto: 'Auto', ask: 'Manual', edits: 'Accept edits', plan: 'Plan', bypass: 'Bypass permissions' };
// What each kind of step does in a mode, as judge() decides it.
const STEPS = {
  edit: { ask: 'asks first', edits: 'runs', auto: 'runs', plan: 'refused', bypass: 'runs' },
  protect: { ask: 'always asks', edits: 'always asks', auto: 'always asks', plan: 'refused', bypass: 'runs' },
  readCmd: { ask: 'runs', edits: 'runs', auto: 'runs', plan: 'runs', bypass: 'runs' },
  cmd: { ask: 'asks first', edits: 'asks first', auto: 'the app checks it against the request: runs, or asks', plan: 'refused', bypass: 'runs' },
  commit: { ask: 'always asks', edits: 'always asks', auto: 'always asks', plan: 'refused', bypass: 'runs' },
  web: { ask: 'asks first', edits: 'asks first', auto: 'the app checks it against the request: runs, or asks', plan: 'asks first', bypass: 'runs' },
  mcp: { ask: 'asks first', edits: 'asks first', auto: 'asks first, unless the user marked the tool as only reading', plan: 'refused, unless the user marked the tool as only reading', bypass: 'runs' },
};
// "Right now": a table of what runs, asks or is refused in this mode, with the user's own rules,
// added to PERMISSIONS.md when the model reads it, so the guide never disagrees with the app.
export function permissionsTable({ mode = 'ask', rules = null, session = [] } = {}) {
  const m = MODES.includes(mode) ? mode : 'ask';
  const blocked = [...new Set(BLOCKED.map((b) => b.why))];
  const list = (xs) => (xs?.length ? xs.map((x) => `"${x}"`).join(', ') : 'none');
  const rows = [
    ['Read, List and Search inside the project', 'runs'],
    ['Edit or Write a file in the project', STEPS.edit[m]],
    [`A protected file (${[...PROTECTED.slice(0, 5), ...(rules?.protect ?? [])].join(', ')}…)`, STEPS.protect[m]],
    ['A command that only reads (ls, cat, git status, git diff…)', STEPS.readCmd[m]],
    ['Any other command', `${STEPS.cmd[m]}${m === 'ask' || m === 'edits' || m === 'auto' ? ', unless a rule below allows it' : ''}`],
    ['git commit', STEPS.commit[m]],
    ['WebSearch and WebFetch (when offered)', `${STEPS.web[m]}${m !== 'bypass' ? ', unless a rule allows the site' : ''}`],
    ['A tool of the user\'s MCP servers (mcp__server__tool, when offered)', `${STEPS.mcp[m]}${m === 'ask' || m === 'edits' || m === 'auto' ? ', or a rule allows it' : ''}`],
    ['A new file on the Desktop the user asked for there (Write ~/Desktop/<name>)', STEPS.edit[m]],
    ['Other files or commands outside the project, the internet from a command', m === 'bypass' ? 'runs (Bypass lifts the fence), except secrets outside the project (keys, .ssh, .env); what already runs on this Mac stays out of reach' : 'refused (the sandbox)'],
    ['Agentic Coder\'s own settings and rules', 'refused'],
  ];
  return `## Right now (from the app, as you read this)

Mode: ${MODE_NAMES[m]}.

| Step | Here |
|---|---|
${rows.map(([a, b]) => `| ${a} | ${b} |`).join('\n')}

Always refused, in every mode (what each would do): ${blocked.join('; ')}.

The user's rules (/permissions): allowed without asking: ${list(rules?.allow)}; never: ${list(rules?.never)}; protected: ${list(rules?.protect)}.
Allowed for this session: ${list([...(session ?? [])])}.`;
}
