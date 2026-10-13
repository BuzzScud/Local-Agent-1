// What a shell command does, as the permissions read it (permissions.mjs, moved here on 13 Oct 2026 so each file can
// be read whole): the commands blocked in every mode (BLOCKED, blockedReason), the paths a command names outside the
// project (outsidePath), its words as the shell sees them (shellWords), its parts (splitCommand), whether it only
// reads (isReadOnly) or runs tests (runsTests, testRunOf), and the text of it a shell runs (shellText).
// permissions.mjs decides with these and gives every name here on to the files that import it.
import { homedir } from 'node:os';
import { resolve, relative, isAbsolute, dirname, basename, join } from 'node:path';
import { realpathSync } from 'node:fs';

// Commands that are blocked in every mode, because they destroy work or stop
// things running on this Mac.
// "In command position": the start, after ; & | ( or `, or after a wrapper
// such as xargs, nohup, exec, env, time.
export const CMD = '(?:^|[;&|(\\x60]\\s*|\\b(?:xargs|nohup|exec|env|time|command)\\s+(?:-\\S+\\s+)*)';
export const at = (words) => new RegExp(`${CMD}(?:${words})\\b`);

export const BLOCKED = [
  { re: /\brm\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*(?:r[a-zA-Z]*f|f[a-zA-Z]*r)|\brm\s+(?:.*\s)?-r\b.*\s-f\b|\brm\s+(?:.*\s)?-f\b.*\s-r\b|\brm\s+.*--recursive.*--force|\brm\s+.*--force.*--recursive/, why: 'rm -rf deletes files for good' },
  { re: at('sudo|doas'), why: 'sudo runs as administrator' },
  // self: lifted when the app works on itself (SELF below); the rest hold in every mode.
  // A plain git push asks first (runsGitPush below, the owner's pick, 8 Oct 2026); a force push,
  // which can wipe what is already on GitHub, stays blocked.
  { re: /\bgit\s+push\b[^;&|\n]*?\s(?:-f|-[a-zA-Z]*f[a-zA-Z]*|--force(?:-with-lease)?(?:=\S*)?|\+[^\s'"`);]+)(?=[\s'"`);]|$)/, why: 'a force push rewrites what is already on GitHub', self: true },
  { re: /\bgit\s+reset\s+--hard\b/, why: 'git reset --hard throws away uncommitted work' },
  { re: /\bgit\s+clean\s+-[a-zA-Z]*f/, why: 'git clean -f deletes untracked files for good' },
  { re: at('kill|pkill|killall'), why: 'stopping processes could stop your running servers', self: true },
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
export function outsidePaths(command, cwd) {
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
export function shellWords(cmd) {
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
export function readerPart(part) {
  const p = part.trim();
  if (/^sed\s+-n\s+'?\d+(,\d+)?p'?(\s|$)/.test(p) && !/\s-i\b/.test(p)) return true; // sed -n '24p' file
  // A filter in a pipeline reads: sed without -i (-Ei, --in-place), jq, and awk unless its program
  // could write a file (>), run a command (system, a | inside it) or edit in place (gawk -i inplace).
  if (/^sed\b/.test(p) && !/\s-[A-Za-z]*i\b|--in-place/.test(p)) return true;
  if (/^jq\b/.test(p)) return true;
  if (/^g?awk\b/.test(p) && !/[>|]|system|\s-i\b|--in-?place/.test(p)) return true;
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

// self: the app works on itself (SELF): git push and stopping its own processes run (the sandbox
// still refuses a signal to anything it did not start, sandbox.mjs).
export function blockedReason(command, { self = false } = {}) {
  const run = shellText(command);
  for (const b of BLOCKED) if (!(self && b.self) && b.re.test(run)) return b.why;
  return null;
}

// What the shell runs, without the text that is only data: the quoted words of a program that
// searches or prints (grep 'rm -rf' logs, echo "git push"), and the body of a script handed to
// python, node and the like (python3 - <<'EOF' … EOF), but a body's line that calls the shell
// (os.system, subprocess, execSync, `…`, $(…)) stays. On 8 Oct 2026 two Python scripts that only
// edited text naming "rm -rf" and "git push" were blocked, and so was a grep of the logs for them.
// Text that goes on to a shell (| sh, eval, xargs, source) is all kept, and so is "$(…)" in quotes.
const TEXT_ONLY = /^(?:grep|egrep|fgrep|rg|ag|ack|echo|printf|jq)$/;
const SCRIPT_RUNNER = /^(?:python[\d.]*|node|bun|deno|ruby|perl|php|cat|tee)$/;
const CALLS_SHELL = /\b(?:system|subprocess|popen|exec\w*|spawn\w*|run)\s*\(|\bsubprocess\b/;
// `…` and $(…) run a command when the shell expands the body (<<EOF, not <<'EOF'), and `…` in Ruby,
// Perl and PHP; in a quoted Python or Node body they are text (Markdown's `code`, a template string).
const EXPANDS = /[`]|\$\(/;
const FEEDS_SHELL = /\|\s*(?:\S*\/)?(?:ba|z|da|k)?sh\b|\b(?:eval|xargs|source)\b|\b(?:ba|z)?sh\s+-c\b/;
export function shellText(command) {
  const cmd = String(command ?? '');
  if (FEEDS_SHELL.test(cmd)) return cmd;
  const bodies = cmd.replace(/(^|[;&|(\n])([^;&|(\n]*?)<<-?[ \t]*(['"]?)([A-Za-z_][\w.-]*)\3([^\n]*\n)([\s\S]*?)(\n\t*\4(?=\n|$)|$)/g, (all, sep, head, q, end, rest, body, close) => {
    const program = basename(head.trim().split(/\s+/)[0] ?? '');
    if (!SCRIPT_RUNNER.test(program)) return all;
    const expands = !q || /^(?:ruby|perl|php)$/.test(program);
    const keep = (l) => CALLS_SHELL.test(l) || (expands && EXPANDS.test(l));
    return `${sep}${head}<<${q}${end}${q}${rest}${body.split('\n').filter(keep).join('\n')}${close}`;
  });
  let out = '';
  let first = null; // the first word of the command part we are in
  let word = '';
  for (let i = 0; i < bodies.length; i++) {
    const c = bodies[i];
    if (c === "'" || c === '"') {
      const j = bodies.indexOf(c, i + 1);
      const end = j < 0 ? bodies.length : j;
      const inside = bodies.slice(i + 1, end);
      const data = TEXT_ONLY.test(first ?? word) && !(c === '"' && /\$\(|`/.test(inside));
      out += data ? `${c}${c}` : bodies.slice(i, end + 1);
      word += 'x';
      i = end;
      continue;
    }
    out += c;
    if (/[;&|(\n`]/.test(c)) { first = null; word = ''; continue; }
    if (/\s/.test(c)) { if (word && first === null) first = basename(word); word = ''; continue; }
    word += c;
  }
  return out;
}
