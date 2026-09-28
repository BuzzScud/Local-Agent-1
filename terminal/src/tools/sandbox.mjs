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
// it started (Postgres, your desks' servers), no reading their data folders.
// ("What went wrong?" about a pasted Postgres log once led the model to find
// the real local database and shut it down.) Servers the command starts
// itself, such as a test's, work as usual.
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

// Read-only in the home folder: where tools and their settings live.
const TOOL_DIRS = ['.nvm', '.bun', '.volta', '.fnm', '.deno', '.cargo', '.rustup', '.pyenv', '.rbenv', '.local', '.sdkman', 'go',
  '.config/git', '.gitconfig', '.gitignore_global', '.npmrc', '.yarnrc', '.zshenv', 'Library/Python', 'Library/pnpm', 'miniconda3', 'anaconda3', 'opt'];
// Writable in the home folder: package caches (npm install, pip, bun).
const CACHE_DIRS = ['.npm', '.bun/install/cache', '.cache', 'Library/Caches', '.yarn', 'Library/pnpm'];
// Programs that start apps or scripts outside the fence.
const APP_LAUNCHERS = ['/usr/bin/open', '/usr/bin/osascript', '/usr/bin/osacompile', '/usr/bin/automator', '/usr/bin/shortcuts', '/bin/launchctl', '/usr/bin/screen', '/usr/bin/tmux', '/opt/homebrew/bin/tmux'];

// Service data outside the home folder (Homebrew's Postgres, MySQL, Redis…).
// (Not /var/run or /var/db: DNS and time zones live there.)
const SERVICE_DATA = ['/opt/homebrew/var', '/usr/local/var'];
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
export function sandboxProfile(root, { home = homedir(), readOnly = [] } = {}) {
  const h = real(home);
  const project = real(root);
  const inHome = (rel) => join(h, rel);
  const tools = [...TOOL_DIRS.map(inHome).filter(existsSync), ...readOnly.map(real)];
  const caches = CACHE_DIRS.map(inHome);
  const writable = [project, ...gitDirs(project).filter((d) => !d.startsWith(`${project}/`))];
  const paths = (list) => list.map((p) => `(subpath ${q(p)})`).join(' ');
  return [
    '(version 1)',
    '(allow default)',
    `(deny file-read-data (subpath ${q(h)}))`,
    `(deny file-write* (subpath ${q(h)}) (subpath "/Volumes"))`,
    '(deny file-read-data (subpath "/Volumes"))',
    tools.length ? `(allow file-read-data ${paths(tools)})` : '',
    `(allow file-read-data file-write* ${paths([...writable, ...caches])})`,
    // Starting an app (open, osascript → Terminal) would run outside the fence.
    `(deny process-exec ${APP_LAUNCHERS.map((p) => `(literal ${q(p)})`).join(' ')})`,
    // What already runs here: no signals to it, no connections to it, not its data.
    '(deny signal)', '(allow signal (target same-sandbox))', // its own processes only
    `(deny file-read-data file-write* ${SERVICE_DATA.map((p) => `(subpath ${q(p)})`).join(' ')})`,
    `(deny network-outbound (remote unix-socket (path-regex #"${SOCKETS}")))`,
    ...listeningPorts().map((port) => `(deny network-outbound (remote ip "localhost:${port}"))`),
  ].filter(Boolean).join('\n');
}

let usable = null;
// sandbox-exec is on every Mac; AGENTIC_SANDBOX=0 turns the fence off (for a
// tool that needs more than it allows).
export function sandboxAvailable() {
  if ((process.env.AGENTIC_SANDBOX ?? process.env.BONSAI_SANDBOX) === '0') return false;
  if (usable === null) usable = process.platform === 'darwin' && existsSync(SANDBOX_EXEC) && spawnSync(SANDBOX_EXEC, ['-p', '(version 1)(allow default)', '/usr/bin/true']).status === 0;
  return usable;
}

// [file, args] that run `command` in zsh inside the fence around `root`.
export function sandboxed(command, root, { readOnly } = {}) {
  return [SANDBOX_EXEC, ['-p', sandboxProfile(root, { readOnly }), '/bin/zsh', '-c', command]];
}

// What a blocked command prints, turned into a hint for the model.
export function fenceHint(output) {
  return /Operation not permitted|operation not permitted|EPERM|sandbox/i.test(output)
    ? '\n(Files outside the project folder cannot be read or changed, and apps cannot be opened; stay inside the project.)'
    : '';
}
