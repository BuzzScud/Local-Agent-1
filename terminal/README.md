# Part 1 · The terminal

The coding agent you talk to. It gets its model from the models part through
one file, `../models/index.mjs`, and never reads a model's settings directly.

## Screen

Laid out like Claude Code, one layout: while it thinks, a folded `∴ Thinking…` line above
the spinner (`⠹ Baking… (4s · ↓ 120 tokens · esc to interrupt)`: Orbit, dots that move one step per token
written, fast and bright while it writes, slow and dim while it reads or a tool runs); tool lines with their
results folded (`⏺ Read(file)` / `⎿ Read 28 lines (ctrl+o to expand)`); and when a turn
ends, the time it took: `⠿ Worked for 41s · done 12:58 PM`. Nothing sits under the prompt
but the footer; from 70% memory a line says what happens next, `/stats` has every number,
and `/meters on` adds the old status bar (model, speed, memory, effort) for those who want it.
When a commit that changes Bonsai's code lands on main while it runs, the lower right says
`↻ Update available · /update to use it`; pushed to GitHub's main from a worktree but not in this
folder yet, `↻ Update on GitHub · /update to get it` (`src/app/update.mjs`, checked every 20 s;
`BONSAI_NO_UPDATE=1` turns it off). `/update` restarts Bonsai in the same window on the new code,
the conversation picked back up and the model kept loaded: the app exits with code 75 and the
`bonsai` launcher, which waits on it, rebuilds and starts it again (an update only on GitHub is
fast-forwarded into this folder's main first, when git can do that without touching anything
uncommitted).

## Keys

| Key | Does |
|---|---|
| enter | send · `\` + enter for a new line |
| esc | interrupt Bonsai · twice to clear the prompt |
| shift+tab | ask first → accept edits → plan (read-only) |
| ctrl+o | show the last thinking or output in full |
| ↑ ↓ | earlier prompts |
| `/` | commands · `@` attach a file · `!` run a shell command yourself · `?` shortcuts |
| ctrl+c twice | quit (the conversation is saved) |

Commands: `/help /clear /compact /effort /mode /init /resume /model /stats /meters /doctor /exit` — and typing `exit` quits too.

**Effort** is how much the model thinks before it acts: Off (the default), Medium or High,
set with `/effort`, in `/model`, or `--effort` at start. `/think` and `--think` still work.

## Permissions

It asks before every edit and command (Yes · Yes for this session · No and say what
instead). Always blocked, in every mode: `rm -rf`, `sudo`, `git push`,
`git reset --hard`, `git clean -f`, `kill`/`pkill`/`killall`, stopping services, and
piping the internet into a shell. Files and commands outside the project folder are
refused, and macOS's own sandbox fences what a command can reach.

## How it works

- **The loop** (`src/agent`) sends the conversation, streams the reply, runs one tool
  at a time and feeds the result back. Eight tools: Read, List, Search, Edit, Write,
  Bash, TodoWrite and Ask. Built for small local models, from what the practice runs showed:
  - Read returns plain text (numbered lines got copied into edits); small files come
    back whole, long ones as an outline first.
  - Edits match despite indentation slips and one-character typos (one clear place only);
    `replace_all` for renames. An edit that would break a file that parsed before is refused.
  - Write only creates files; existing files change through Edit.
  - Guards: repeated steps, looping output, a tool call written as text or inside the
    thinking, and "announce then stop"; old output trimmed and the conversation
    summarized when memory fills.
- **Asking** (`src/flows/clarify.mjs` and the Ask tool): a bare "fix the bug" when nothing
  fails, or a lone word such as "api", gets a question before anything runs; the model
  can ask again mid-task as often as it needs. You answer by number or type a line.
- **Focused paths** (`src/flows`) handle most requests before the loop: a request is sorted
  (rules, or the model with a forced JSON reply) into question / rename / fix / change.
  - Rename: every whole-word use in code, one diff, one question; no model.
  - Fix: run the tests, find the file, tries in a scratch copy, each told what the last
    one got wrong. Three tries on one function, then three wider tries as edit blocks.
  - Change: a test first (cross-checked against drafts, then approved by you), then
    tries. Two tests and two drafts; more only when they disagree.
  - Several files: the files are planned from the project map, one test, then edit
    blocks across all of them (`src/flows/multi.mjs`), with guards: only the planned
    files change and nothing is quietly removed.
  - Anything a focused path cannot finish goes step by step. `--no-flows` always does.
- **The project map** (`src/tools/repomap.mjs`, cached under `~/.bonsai-code/maps`) is
  what files are chosen from and the first thing the loop sees in a bigger project.
- **A check before "done"**: when the loop changed files, one forced-JSON check compares
  the diff with the request and sends it back once if a part is missing.
- **The screen** (`src/app`) is Ink (React for the terminal, the library Claude Code uses),
  in 256 colours for Apple Terminal, redrawn cleanly on every resize.

## Develop

```
bun terminal/src/cli.jsx               # run from source
bun run test:terminal                   # its tests, including the app driven by keys in a real terminal
node terminal/scripts/ui-walk.mjs       # every screen at one window size, with resizes, checked
node terminal/scripts/capture-ui.mjs    # the real app with the real model, screens saved as HTML
```

`scripts/demo` + `demo-project/` hold the design-stage previews (`bun run demo 1|2|3`); `scripts/shims` is the react-devtools stand-in the single-file build needs. Report pages are written to `~/Desktop/bonsai-code DOCS` and mirrored into the repo's `docs/`.
`app/make-app.sh` builds `Bonsai Code.app` beside the repo's README.
