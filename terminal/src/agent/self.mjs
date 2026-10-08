// Agentic Coder working on itself (the owner's pick, 8 Oct 2026): Bypass permissions on the Claude
// API (permissions.mjs isSelf). Before one of the app's own files changes (~/.agentic-coder/…,
// a project's .agentic/…), the file as it is now is copied here, so a bad settings.json or a
// hooks.json that lost a line can be put back by hand or with /rewind:
//   ~/.agentic-coder/memory-backups/self/<day>/<time>-<name>
// One folder a day, the newest copies last; more than KEEP days of folders go.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { findRepo, isAppCode } from '../app/update.mjs';

export const KEEP_DAYS = 14;
const home = () => process.env.AGENTIC_HOME ?? join(homedir(), '.agentic-coder');
export const selfBackupDir = () => join(home(), 'memory-backups', 'self');

const stamp = (d) => d.toISOString().slice(11, 19).replace(/:/g, '');
const day = (d) => d.toISOString().slice(0, 10);

// The copy made of `abs`, or null when there is nothing to copy (a new file) or the copy failed.
export function keepOwnCopy(abs, { now = new Date() } = {}) {
  try {
    if (!abs || !existsSync(abs) || !statSync(abs).isFile()) return null;
    const dir = join(selfBackupDir(), day(now));
    mkdirSync(dir, { recursive: true });
    const to = join(dir, `${stamp(now)}-${basename(abs)}`);
    copyFileSync(abs, to);
    pruneOwnCopies(now);
    return to;
  } catch {
    return null;
  }
}

// Day folders older than KEEP_DAYS go.
export function pruneOwnCopies(now = new Date()) {
  const root = selfBackupDir();
  if (!existsSync(root)) return;
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  for (const d of readdirSync(root)) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < cutoff) rmSync(join(root, d), { recursive: true, force: true });
}

// Shown under a change to one of the app's own files.
export const copyNote = (to) => (to ? `A copy of the file as it was is at ${to.replace(homedir(), '~')}.` : '');

// The files of a turn (paths relative to cwd) that are the app's own code, as paths in its repo
// (app/update.mjs isAppCode: what a rebuild picks up), so a turn that changed them and whose tests
// passed can start the app again on them (agent-work.mjs). Empty when cwd is not in the repo.
export function appCodeChanged(cwd, files, repo = findRepo()) {
  if (!repo || !cwd) return [];
  const out = [];
  for (const f of files) {
    const rel = relative(repo, resolve(cwd, f));
    if (!rel.startsWith('..') && isAppCode(rel)) out.push(rel);
  }
  return out;
}
