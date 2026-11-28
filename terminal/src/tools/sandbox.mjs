// The folder fence for commands, enforced by macOS itself (sandbox-exec):
// however a command is spelled, it cannot read your home folder or write
// outside the project. Checking the words of a command (permissions.mjs)
// catches the plain cases with a clear message; this catches the rest
// ("$HOME"/Desktop, ~user, $(dirname $PWD), a script that lists ~).
//
// Inside the home folder a command may read the project, the tool folders
// (node, bun, git's settings…) and write the project plus the package caches.
// Outside it: the system as usual, temp folders writable, /Volumes closed.
// It may not start apps (open, osascript), which would run outside the fence,
// and it may not touch what already runs on this Mac: no signals to processes
// it did not start, no connections to the services that were listening when
// it started (Postgres, your desks' servers; Bypass reaches them), no reading their data folders.
// Outbound network is closed. `allow default` used to leave it open, so a
// command could still phone home. A server the command starts on this Mac
// can still be reached; the internet cannot.
// ("What went wrong?" about a pasted Postgres log once led the model to find
// the real local database and shut it down.) Servers the command starts
// itself, such as a test's, work as usual.
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { sshHint } from './ssh.mjs';

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

// Read-only in the home folder: where tools and their settings live.
const TOOL_DIRS = ['.nvm', '.bun', '.volta', '.fnm', '.deno', '.cargo', '.rustup', '.pyenv', '.rbenv', '.local', '.sdkman', 'go',
  '.config/git', '.gitconfig', '.gitignore_global', '.npmrc', '.yarnrc', '.zshenv', 'Library/Python', 'Library/pnpm', 'miniconda3', 'anaconda3', 'opt'];
// Writable in the home folder: package caches (npm install, pip, bun).
const CACHE_DIRS = ['.npm', '.bun/install/cache', '.cache', 'Library/Caches', '.yarn', 'Library/pnpm'];
// Programs that start apps or scripts outside the fence.
const APP_LAUNCHERS = ['/usr/bin/open', '/usr/bin/osascript', '/usr/bin/osacompile', '/usr/bin/automator', '/usr/bin/shortcuts', '/bin/launchctl', '/usr/bin/screen', '/usr/bin/tmux', '/opt/homebrew/bin/tmux'];

// What ssh reads in ~/.ssh besides the keys (18 Oct 2026): its settings, the servers it knows and the
// public halves it picks the agent's key by. Without them "Host key verification failed" for every server.
const SSH_PUBLIC = ['config', 'known_hosts', 'known_hosts2'];
const reText = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Service data outside the home folder (Homebrew's Postgres, MySQL, Redis…).
// (Not /var/run or /var/db: DNS and time zones live there.)
const SERVICE_DATA = ['/opt/homebrew/var', '/usr/local/var'];
// Keys and sign-ins in the home folder that stay unreadable even in Bypass, where any folder opens (18 Nov 2026,
// the audit: only a word check kept the door's key out of reach, and "cat ~/.agentic-coder/door.*" got past it;
// ~/.aws/credentials was open). Checked by the sandbox itself, so no spelling of the path reaches them.
const SECRET_FILES = ['.aws', '.netrc', '.npmrc', '.pypirc', '.docker/config.json', '.kube/config', '.gnupg', '.config/gh', '.config/gcloud',
  '.azure', '.git-credentials', 'Library/Keychains', 'Library/Application Support/com.apple.TCC'];
// Where a command may still write outside the project in the normal fence: the temp folders and the devices.
const TEMP_WRITES = ['/dev', '/private/tmp', '/private/var/folders', '/tmp'];
// Their sockets: Postgres (/tmp/.s.PGSQL.5432), MySQL, Docker, Homebrew services.
const SOCKETS = '^/(private/)?tmp/(\\.s\\.|mysql)|^/(private/)?var/run/docker\\.sock|^/(opt/homebrew|usr/local)/var/';

// TCP ports something on this Mac is listening on right now (checked at most
// every 20 s).
let ports = { at: 0, list: [] };
export const forgetPorts = () => { ports = { at: 0, list: [] }; };
export function listeningPorts() {
  if (Date.now() - ports.at < 20_000) return ports.list;
  let list = [];
  try {
    const out = execFileSync('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fn'], { encoding: 'utf8', timeout: 3000 });
    list = [...new Set(out.split('\n').filter((l) => l.startsWith('n')).map((l) => Number(/:(\d+)$/.exec(l)?.[1])).filter(Boolean))].sort((a, b) => a - b);
  } catch { /* lsof missing or slow: no port rules */ }
  ports = { at: Date.now(), list };
  return list;
}

const real = (p) => { try { return realpathSync(p); } catch { return p; } };
const q = (p) => JSON.stringify(p); // SBPL strings use the same escapes as JSON

// The git folder of a worktree lives outside it (.git is a file that points there).
function gitDirs(cwd) {
  const r = spawnSync('git', ['rev-parse', '--absolute-git-dir', '--git-common-dir'], { cwd, encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) return [];
  return r.stdout.split('\n').filter(Boolean).map((d) => real(d.startsWith('/') ? d : join(cwd, d)));
}

// root: the folder a command works in (readable + writable). readOnly: other
// folders it may read, such as the real project behind a scratch copy.
// An MCP server started as a program (tools/mcp.mjs) runs behind the same fence, with what /mcp
// opens for that one server: net (the internet), and local: the ports of services already
// running on this Mac it may reach ([5432] for your Postgres), or 'any'.
// open: Bypass permissions (the owner's pick, 3 Oct 2026): any folder and the internet, but
// still no apps started, no signals to what already runs here, Agentic Coder's own
// folder not written, and ~/.ssh not read (permissions.mjs SECRET_FILES) but for ssh's public
// files (SSH_PUBLIC) and the folder's list of names, so ssh logs in through this Mac's ssh agent with no key file open to it (ssh.mjs).
// Since 25 Nov 2026 (the owner, on hearth's model failing to find why a server was slow: "all permissions") Bypass also
// reaches the servers already running on this Mac, at any port or socket: Ollama's 11434 had read as an empty answer.
// Their data folders (SERVICE_DATA) stay closed, and removing a model asks first (permissions.mjs removesModel).
// self: Bypass with the Claude API (permissions.mjs isSelf): the app works on itself, so its own
// folder is open too; only the door's key and trust list stay closed (SELF_LOCKED).
// own: Bypass on hearth (permissions.mjs isOwnOpen): its own folder is open too, but for the files that could lift the
// limits it keeps there (OWN_SHUT, the same names as permissions.mjs OWN_LOCKED; sandbox.test.mjs holds the two together).
export const SELF_SHUT = ['door.key', 'trust.json'];
export const OWN_SHUT = [...SELF_SHUT, 'hooks.json', 'hooks-state.json', 'permissions.json', 'mcp.json', 'mcp-state.json'];
export function sandboxProfile(root, { home = homedir(), readOnly = [], net = false, local = [], open = false, self = false, own = false } = {}) {
  const h = real(home);
  const project = real(root);
  const inHome = (rel) => join(h, rel);
  const tools = [...TOOL_DIRS.map(inHome).filter(existsSync), ...readOnly.map(real)];
  const caches = CACHE_DIRS.map(inHome);
  const writable = [project, ...gitDirs(project).filter((d) => !d.startsWith(`${project}/`))];
  const paths = (list) => list.map((p) => `(subpath ${q(p)})`).join(' ');
  const ownDirs = [...new Set([inHome('.agentic-coder'), process.env.AGENTIC_HOME].filter(Boolean).map(real))];
  const shut = (names) => ownDirs.flatMap((d) => names.map((f) => `(literal ${q(join(d, f))})`)).join(' ');
  const ownClosed = self ? shut(SELF_SHUT) : own ? shut(OWN_SHUT) : paths(ownDirs);
  // Never read, in any mode: the door's key and the secret files above.
  const keyFiles = ownDirs.map((d) => `(literal ${q(join(d, 'door.key'))})`).join(' ');
  const secretFiles = SECRET_FILES.map((f) => `(subpath ${q(inHome(f))})`).join(' ');
  return [
    '(version 1)',
    '(allow default)',
    // Last matching rule wins. The deny closes the internet; the allows put
    // back this Mac (a test's own server) and ordinary sockets. The denies
    // further down still close what was already listening, and those sockets.
    // sandbox-exec takes only "localhost" or "*" as the host ("127.0.0.1:*"
    // stops every command with exit 65); localhost covers 127.0.0.1 and ::1.
    ...(net || open ? [] : ['(deny network-outbound)', '(allow network-outbound (remote ip "localhost:*"))', '(allow network-outbound (remote unix-socket))']),
    ...(open ? [`(deny file-write* ${ownClosed})`, `(deny file-read-data ${keyFiles} ${secretFiles})`, `(deny file-read-data file-write* (subpath ${q(inHome('.ssh'))}))`,
      `(allow file-read-data (literal ${q(inHome('.ssh'))}) ${SSH_PUBLIC.map((f) => `(literal ${q(inHome(`.ssh/${f}`))})`).join(' ')} (subpath ${q(inHome('.ssh/config.d'))}) (regex #"^${reText(inHome('.ssh'))}/[^/]+\\.pub$"))`] : [
      `(deny file-read-data (subpath ${q(h)}))`,
      // No writes anywhere but the project, the caches and the temp folders (18 Nov 2026, the audit: only the
      // home folder and /Volumes were closed, so a command could put a program in /opt/homebrew/bin or /usr/local).
      '(deny file-write* (subpath "/"))',
      `(allow file-write* ${TEMP_WRITES.map((p) => `(subpath ${q(p)})`).join(' ')})`,
      `(deny file-write* (subpath ${q(h)}) (subpath "/Volumes"))`,
      '(deny file-read-data (subpath "/Volumes"))',
      tools.length ? `(allow file-read-data ${paths(tools)})` : '',
      `(allow file-read-data file-write* ${paths([...writable, ...caches])})`,
      // After the tools' allow, which takes in ~/.npmrc (an npm login token) and a door.key under an AGENTIC_HOME outside home: the
      // secrets Bypass keeps shut stay shut here too. Until 28 Nov 2026 (the tools audit) the stricter mode let a command cat
      // ~/.npmrc while Bypass refused it. npm still runs without reading it (tried).
      `(deny file-read-data ${keyFiles} ${secretFiles})`,
    ]),
    // Starting an app (open, osascript → Terminal) would run outside the fence.
    `(deny process-exec ${APP_LAUNCHERS.map((p) => `(literal ${q(p)})`).join(' ')})`,
    // What already runs here: no signals to it, no connections to it, not its data.
    '(deny signal)', '(allow signal (target same-sandbox))', // its own processes only
    `(deny file-read-data file-write* ${SERVICE_DATA.map((p) => `(subpath ${q(p)})`).join(' ')})`,
    ...(local === 'any' || open ? [] : [`(deny network-outbound (remote unix-socket (path-regex #"${SOCKETS}")))`,
      ...listeningPorts().filter((port) => !local.includes(port)).map((port) => `(deny network-outbound (remote ip "localhost:${port}"))`)]),
  ].filter(Boolean).join('\n');
}

let usable = null;
// sandbox-exec is on every Mac; AGENTIC_SANDBOX=0 turns the fence off (for a
// tool that needs more than it allows).
export function sandboxAvailable() {
  if (process.env.AGENTIC_SANDBOX === '0') return false;
  if (usable === null) usable = process.platform === 'darwin' && existsSync(SANDBOX_EXEC) && spawnSync(SANDBOX_EXEC, ['-p', '(version 1)(allow default)', '/usr/bin/true']).status === 0;
  return usable;
}

// The shell every command runs in: zsh, as on every Mac; where there is none, bash, then sh (21 Nov 2026: on a Linux
// server with no zsh every command failed before it started, "✗ Bash(true)", and a run stopped at five tool errors).
export function shellPath(exists = existsSync) {
  return ['/bin/zsh', '/bin/bash'].find((f) => exists(f)) ?? '/bin/sh';
}
export const SHELL = shellPath();

// [file, args] that run `command` in the shell inside the fence around `root`.
export function sandboxed(command, root, { readOnly, open, self, own } = {}) {
  return [SANDBOX_EXEC, ['-p', sandboxProfile(root, { readOnly, open, self, own }), SHELL, '-c', command]];
}

// What a blocked command prints, turned into a hint for the model. A blocked
// app (zsh: "operation not permitted: open") has its own: with the files
// hint, Qwen took `open ~/page.html` for a file outside the project, and the
// note it came with sent it to answer at once, saying the page was on the
// Desktop when it was not (30 Sep).
const LAUNCHERS = APP_LAUNCHERS.map((p) => p.split('/').pop()).join('|');
// A command that reached for a web address outside Bypass, where the sandbox closes the internet
// (4 Oct 2026): curl and Python's urllib to a page were refused three times, the hint said only
// "stay inside the project", and Qwen3.6 called it a firewall and never used WebFetch, which it had.
// A refused connection, a name that could not be looked up, or nothing at all (curl -s | head).
const NET_FAIL = /Failed to connect|Couldn't connect|Could not resolve host|urlopen error|\[Errno (?:1|8)\]|getaddrinfo|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|Network is unreachable|nodename nor servname|Operation not permitted/i;
const WEB_ADDRESS = /\bhttps?:\/\/[^\s'"`<>|)\\]+/i;
export function netHint(output, command) {
  const url = WEB_ADDRESS.exec(String(command ?? ''))?.[0];
  if (!url || !(NET_FAIL.test(output) || !String(output ?? '').trim())) return '';
  return `\n(Commands cannot reach the internet here: only Bypass permissions opens it to them, and the user turns that on. To read the page, call the WebFetch tool: WebFetch {"url": "${url}"}. Do not try curl, wget or another language again.)`;
}

const LOCAL_SERVER = /\b(?:connect(?:ion)?|socket)\b[^\n]*(?:Operation not permitted|EPERM)|(?:Operation not permitted|EPERM)[^\n]*\bconnect/i;
// ps and top are setuid programs, and macOS never starts one inside a sandbox, whatever its profile (25 Nov 2026: hearth's
// model, asked why a server was slow, got "operation not permitted: ps" and nothing else). The app runs a plain ps or top
// itself (proclook.mjs); one it could not (a variable in its words, `$(ps …)`, /bin/ps by path) lands here.
const SETUID_LOOK = /operation not permitted: (?:\/bin\/|\/usr\/bin\/)?(?:ps|top)\b|execvp\(\) of '\/(?:bin\/ps|usr\/bin\/top)'/i;
export function fenceHint(output, { open = false, self = false, own = false, command = '' } = {}) {
  // ssh says why it failed in its own words; the files hint below sent the model after the wrong cause.
  const ssh = sshHint(output, { open, command });
  if (ssh) return ssh;
  if (new RegExp(`operation not permitted: (?:${LAUNCHERS})\\b`, 'i').test(output)) {
    return '\n(Apps cannot be started from here, so do not try again: say where the file is, with its full path.)';
  }
  if (SETUID_LOOK.test(output)) {
    return '\n(ps and top never start inside the command sandbox, in any mode. Write them by name with plain words (ps aux, ps -axo pid,%cpu,%mem,etime,command, top -l 1 -n 15 -o cpu): the app runs those itself and hands the answer in. Or use pgrep -lf <name>, lsof -nP -iTCP -sTCP:LISTEN, vm_stat, memory_pressure or iostat, which run here.)';
  }
  if (/Cannot run while sandboxed/i.test(output)) {
    return '\n(The system log (log show) cannot be read inside the command sandbox. Read the program\'s own log file instead: Ollama writes ~/.ollama/logs/server.log.)';
  }
  const net = open ? '' : netHint(output, command);
  if (net) return net;
  if (!/Operation not permitted|operation not permitted|EPERM|sandbox/i.test(output)) return '';
  // A server already running here, reached at any address, port or socket: said plainly, so no other way is tried
  // (18 Oct 2026: psql was turned away ten times in one conversation, each time at another host, port or socket).
  // Bypass reaches them since 25 Nov 2026, so this is the other modes' fence.
  if (!open && LOCAL_SERVER.test(output)) {
    return '\n(Commands cannot connect to a server already running on this Mac, such as a database, a dev server or Ollama, at any host, port or socket, so another way fails the same: only Bypass permissions opens them, and the user turns that on. Do not try again: tell the user, and give them the exact command to run in their own terminal.)';
  }
  // In Bypass the folders and this Mac's servers are open: what is still closed is starting apps, signals to what
  // already runs here, the services' data folders and the app's own folder.
  return open && self
    ? '\n(Blocked even when Agentic Coder works on itself: apps cannot be opened, programs already running on this Mac cannot be stopped, and door.key and trust.json cannot be changed.)'
    : open && own
    ? '\n(Blocked even with Agentic Coder\'s own files open to you: apps cannot be opened, programs already running on this Mac cannot be stopped, a key file cannot be read, and its hooks, the permission rules, the MCP servers, door.key and trust.json cannot be changed.)'
    : open
    ? '\n(Blocked even in Bypass: apps cannot be opened, programs already running on this Mac cannot be stopped, a key file cannot be read, and Agentic Coder\'s own folder cannot be changed.)'
    : '\n(Files outside the project folder cannot be read or changed, and apps cannot be opened; stay inside the project.)';
}
