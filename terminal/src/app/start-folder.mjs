// Where to start (2 Oct 2026, the owner's ask). `coding` typed in the home folder, where a new
// Terminal window opens, first asks which folder to work in: the home folder or Agentic
// Coder's own (the repo the launcher passes). From the home folder a run once guessed a
// notes.txt, and Read found one seven folders down in a test project. Typed anywhere else,
// or with -c, --resume or --folder, nothing is asked. The safety check then asks about the
// folder picked (cli.jsx), and a restart after /update comes back to it (--folder).
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { findRepo } from './update.mjs';
import { listSessions } from './store.mjs';
import { isTrusted } from './trust.mjs';

const real = (p) => { try { return realpathSync(p); } catch { return p; } };
const short = (p, home) => (p === home ? '~' : p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p);

// The folders to offer, [{ path, shown, what, good }], or null when nothing is asked. Compared with
// links resolved (a Terminal's folder is the real path); offered as spelled, so the start page
// still shows them under ~.
export function startFolders(opts, { home = homedir(), repo = findRepo() } = {}) {
  if (opts.continueLast || opts.resumeId || opts.folder) return null;
  if (!repo || real(opts.cwd) !== real(home) || real(repo) === real(home)) return null;
  return [
    { path: home, shown: '~', what: 'your home folder', good: 'general questions, Desktop files' },
    { path: repo, shown: short(repo, home), what: 'Agentic Coder', good: 'its code, tests and docs' },
  ];
}

// What the app already knows of a folder, for its door (folder-page.jsx): the conversations had there,
// when the last one was, the newest few (their titles), and whether a yes covers it (then no safety check
// follows). All from the app's own records: nothing in the folder is read before the safety check.
export function folderFacts(f, { sessions = listSessions, trusted = isTrusted } = {}) {
  const list = sessions(f.path);
  return { ...f, convs: list.length, last: list[0]?.updated ?? null, recent: list.slice(0, 12), trusted: trusted(f.path) };
}

// A row of the menu: the folder as you would type it, then what it is.
export const folderOption = (f) => `${f.shown} · ${f.what}`;
