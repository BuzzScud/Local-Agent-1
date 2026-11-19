// A helper agent with "Isolation: worktree" (19 Nov 2026, as Claude Code's subagents): it works in its own
// copy of the repository, a git worktree of the last commit, so its edits and commands never touch your
// folder (your changes not yet committed are not in it either). When it ends, a copy it changed nothing in
// is taken away again; one it changed is kept, and its report says where and shows the diff, for you or the
// main agent to take over (git -C <copy> diff HEAD | git apply).
//   ~/.agentic-worktrees/<repo>-<helper>-<when>/   the copies (AGENTIC_WORKTREES names another folder). Not in
//                                                  the app's own folder, which a command may not write to.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { homedir } from 'node:os';

const worktreesDir = () => process.env.AGENTIC_WORKTREES ?? join(homedir(), '.agentic-worktrees');
// The diff a report carries at most, in characters; the rest is said to be in the copy.
const DIFF_MAX = 12_000;

const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
const why = (e) => String(e.stderr ?? e.message ?? e).trim().split('\n').at(-1);

// { dir, cwd, top } (cwd: where the helper starts, the same place in the copy as the conversation's
// folder in the repo), or { error } when the folder is not in a git repository with a commit.
export function openWorktree(cwd, kind, { now = Date.now() } = {}) {
  let top;
  try { top = git(cwd, ['rev-parse', '--show-toplevel']); } catch { return { error: 'this folder is not in a git repository, so there is nothing to copy' }; }
  try { git(top, ['rev-parse', '--verify', '--quiet', 'HEAD']); } catch { return { error: 'the repository has no commit yet, so there is nothing to copy' }; }
  const name = `${basename(top)}-${String(kind).replace(/[^a-z0-9-]+/gi, '-')}-${now.toString(36)}`.slice(0, 80);
  const dir = join(worktreesDir(), name);
  try { mkdirSync(worktreesDir(), { recursive: true }); git(top, ['worktree', 'add', '--detach', '--quiet', dir, 'HEAD']); } catch (e) { return { error: `git could not make the copy: ${why(e)}` }; }
  return { dir, cwd: join(dir, relative(top, cwd)), top };
}

// When the helper is done: { kept: false } (it changed nothing; the copy is gone), or { kept: true, dir,
// stat, diff, cut } with what it changed against the commit it started from, new files included.
export function closeWorktree(wt) {
  let changed = '';
  try { changed = git(wt.dir, ['status', '--porcelain']); } catch { /* read as changed: kept, to be safe */ changed = '?'; }
  if (!changed) {
    try { git(wt.top, ['worktree', 'remove', '--force', wt.dir]); } catch { /* left in place: harmless */ }
    return { kept: false };
  }
  let stat = '';
  let diff = '';
  try {
    // New files count: marked as intended (not staged), so diff shows them.
    git(wt.dir, ['add', '--intent-to-add', '--all']);
    stat = git(wt.dir, ['diff', 'HEAD', '--stat']);
    diff = git(wt.dir, ['diff', 'HEAD']);
  } catch (e) { stat = `(its diff could not be read: ${why(e)})`; }
  return { kept: true, dir: wt.dir, stat, diff: diff.slice(0, DIFF_MAX), cut: diff.length > DIFF_MAX };
}

// The lines that go under the helper's report.
export function worktreeNote(closed, tilde = (p) => p) {
  if (!closed?.kept) return 'It worked in its own copy of the repository and changed nothing there; the copy is gone.';
  return [
    `Its changes are NOT in your folder: they are in its own copy of the repository, ${tilde(closed.dir)} (git worktree).`,
    `To take them: git -C ${tilde(closed.dir)} diff HEAD | git apply   (then git worktree remove ${tilde(closed.dir)})`,
    closed.stat ? `\n${closed.stat}` : '',
    closed.diff ? `\n${closed.diff}${closed.cut ? '\n[… the rest of the diff is in the copy]' : ''}` : '',
  ].filter(Boolean).join('\n');
}
