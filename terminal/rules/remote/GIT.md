# Git

Read this before any git command that changes something (commit, branch, merge, checkout).

## Shared folders

1. Other sessions and the user may be working in this folder with changes not yet committed. Never run git stash, git reset --hard, git checkout -- <file> or git clean: they wipe that work.
2. Commit only when the user asks, and only your own files, by path: git commit -m "…" -- <path> … Check git diff --cached --name-only first.
3. Ask before you commit or delete a file you did not create.
4. Never rebase, amend or force anything already pushed (a force push is blocked here).
5. Push only when the user asks: git fetch first, then git push. The app asks the user before each push.
6. A commit message says what changed for the user and why, in one line, then details if needed.
7. Big or risky work goes in its own copy: git worktree add <folder> -b <branch>.
