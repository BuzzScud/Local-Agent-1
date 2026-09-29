# Part 1 · The terminal

The coding agent you talk to. It gets its model from the models part through
one file, `../models/index.mjs`, and never reads a model's settings directly.
The other way round the same: the bench and the probes of the models part get
the agent through one file, `index.mjs` here.

## Screen

Laid out like Claude Code, one layout: while it thinks, a folded `∴ Thinking…` line above
the spinner (`⠹ Baking… (4s · ↓ 120 tokens · esc to interrupt)`: Orbit, dots that move one step per token
written, fast and bright while it writes, slow and dim while it reads or a tool runs); tool lines with their
results folded (`⏺ Read(file)` / `⎿ Read 28 lines (ctrl+o to expand)`); and when a turn
ends, the time it took: `⠿ Worked for 41s · done 12:58 PM`. Nothing sits under the prompt
but the footer; from 70% memory a line says what happens next, `/stats` has every number,
and `/meters on` adds the old status bar (model, speed, memory, effort) for those who want it.
When a commit that changes Agentic Coder's code lands on main while it runs, the lower right says
`↻ Update available · /update to use it`; pushed to GitHub's main from a worktree but not in this
folder yet, `↻ Update on GitHub · /update to get it` (`src/app/update.mjs`, checked every 20 s;
`AGENTIC_NO_UPDATE=1` turns it off). GitHub itself is asked too, with `git fetch` 30 s after the
start, every 5 minutes and at each `/update` (`AGENTIC_FETCH_EVERY=<ms>`, `0` never), so a push
from another machine shows as well. That fetch only reads: it moves one ref
(`refs/remotes/origin/main`), never your branches, tags, submodules or files; only from an https,
ssh or on-this-Mac origin (never `http://`, `git://` or `ext::`); with TLS checks on, objects
checked as they arrive, and git run with no terminal, so a password or host-key prompt fails
instead of taking over the screen. Your folder changes only when you type `/update`, and then
only by a fast-forward. `/update` restarts Agentic Coder in the same window on the new code,
the conversation picked back up and the model kept loaded: the app exits with code 75 and the
`coding` launcher, which waits on it, rebuilds and starts it again (an update only on GitHub is
fast-forwarded into this folder's main first, when git can do that without touching anything
uncommitted).

## Keys

| Key | Does |
|---|---|
| enter | send · `\` + enter for a new line |
| esc | interrupt Agentic Coder · twice to clear the prompt |
| shift+tab | ask first → accept edits → plan (read-only) |
| ctrl+o | show the last thinking, output or Context line in full; again for the one before |
| ↑ ↓ | earlier prompts |
| `/` | commands · `@` attach a file · `!` run a shell command yourself · `?` shortcuts |
| ctrl+c twice | quit (the conversation is saved) |

Commands: `/help /clear /compact /effort /mode /init /resume /model /stats /meters /doctor /exit` — and typing `exit` quits too.

**Effort** is how much the model thinks before it acts: Off (the default), Medium or High,
set with `/effort`, in `/model`, or `--effort` at start. `/think` and `--think` still work.

`/effort` alone shows Effort on top, then the **Search** rows, then every limit that can move: context,
thinking cap, tries, steps, command output, timeout, and the trim and summarize points, each with what a value costs.
The Search rows choose how the helpers find what goes along with a request (the code search,
Read first's files, the saved facts, Claude's notes): **Embedder** BGE-M3 or Off (words only; the code
search pauses), **Retriever** Meaning or Hybrid (meaning + a word search, merged by rank fusion), and
**Reranker** Off or Qwen3 0.6B (reads your request with the best 15 pieces: ~2 s for each search that
brings something, ~7 s on a whole request in the 29 Sep check with its first start, and ~1.1 GB; downloaded by
`coding setup`). How many pieces come along is still each search's own rule; the Retriever and the
Reranker only choose which. They apply from the next message with no restart, and `coding -p` follows
them. Measured on 29 Sep, Hybrid changed nothing and the reranker helped only the code search, so both
start off (`models/qwen3-reranker-0.6b/README.md`).
←→ moves a row, one enter saves all of it (a new context or thinking cap restarts the model once, so it waits while a reply is running or the model is still starting, and then changes nothing), esc keeps everything as it was.

## Memory

Agentic Coder remembers on its own. The model itself does not change; what it knows about you
and the project does.

| | |
|---|---|
| Where | `~/.agentic/memory` about you (it follows you into every project) and `<project>/.agentic/memory` about a project (kept out of git; a project that already has a `.bonsai/notes.md` keeps its memory in `.bonsai/memory`). One small file per fact in `facts/`, a short `index.md`, a `retired/` folder, and `log.jsonl`. |
| Saving | A little after a task ends (in the background, on the side slot; it stops the moment you send a message) and when you quit (a small process finishes it after the window closed). At most 5 facts a save. A turn that went well on what the memory already held starts no save. "remember that …" saves at once. |
| What | How you like to work · facts about the project · what worked and what failed, from a check · Agentic Coder's own mistakes · the steps of a job done twice (a recipe). A fact the turns do not bear out is refused, as is one naming a file that is not there, and anything that looks like a key or a password. |
| Bringing back | The rules marked "always" and one short line per fact are read at every start. A fact comes back in full with a request it fits: by meaning, with the small model BGE-M3 (`models/bge-m3`), or by shared words when that model is not there. It is written into the request itself, so nothing already read is read again, and the focused paths (fix, change, several files) get it in their own prompts. |
| Trust | +1 when the task passed its check after the fact was used, -1 when it failed or Agentic Coder got stuck, -2 when you corrected or stopped Agentic Coder. At -3 the fact is taken out of use, unless you pinned it. |
| Keeping clean | Once a day: repeats merge, a fact about a file that is gone and one not used in 30 days are taken out of use. Nothing is deleted: `retired/` keeps it. |
| Seeing it | `/memory` (both memories), `/memory undo` (takes the last save back), `/memory open` or `coding memory` (the hub's Memory tab: edit, pin, take out, bring back). |
| At night | `coding memory-review` reads the day's conversations again and tidies. `--install` schedules it (1 to 6 in the morning, on power, the Mac idle for 30 minutes, no Agentic Coder window open); nothing is scheduled unless you run that. |
| Claude's notes | What Claude Code has written down about your work (its memory folder, hundreds of notes) is a second place the memory looks. It is read where it is, every time, and never changed; Agentic Coder's own numbers for the notes are kept in `~/.agentic-coder/claude-notes`. The one or two notes that fit a request go along with it, cut to the part that fits (about 1,100 characters each), found by meaning and by the words they share. A note about sign-ins, servers or secrets is left out whole; in a note that is kept, a line that holds one is left out. Fifteen lines on how you like things done, boiled down from those notes, are read at every start (`src/agent/claude-rules.mjs`). `"claudeNotes": false` in `settings.json` leaves them out; a path names another folder (`AGENTIC_CLAUDE_NOTES` does the same). |
| Off | `"memory": false` in `settings.json` (yours or a folder's). `AGENTIC_MEMORY_SAVE=off` keeps the memory but stops saving on its own. |

The older names still work: a `BONSAI_*` switch is read when its `AGENTIC_*` twin is not set, `.bonsai/` project folders are still read, and `~/.bonsai-code` is used only until `~/.agentic-coder` exists.

Code: `src/agent/facts.mjs` (the store), `recall.mjs` (bringing back), `lessons.mjs` (saving),
`src/app/autosave.mjs` (when), `review.mjs` (at night), `memory-hub.mjs` + `memory.html` (the hub's tab),
`src/agent/claude-notes.mjs` (Claude's notes).
How well it finds the right fact is measured by `bun run eval:recall` (see `models/bge-m3/README.md`);
the right one of Claude's notes by `bun run eval:notes` (its 50 requests name your own notes, so they
stay on the Mac, in the results folder).

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
    back whole, long ones as an outline first, with the lines that match the request and
    this message's searches. `find` shows the lines around a word or name, so a long file
    is never walked part by part. A part asked for twice is pointed back to; a third time
    it is given again.
  - Edits match despite indentation slips and one-character typos (one clear place only);
    `replace_all` for renames. An edit that would break a file that parsed before is refused.
  - Write only creates files; existing files change through Edit.
  - Guards: repeated steps, looping output, a tool call written as text or inside the
    thinking, and "announce then stop".
  - When memory fills, the model writes its notes in the conversation it already holds
    and carries on from the request and the notes (plus Agentic Coder's own list of what was read
    and changed). Emptying old output, the way before, made it read everything after it
    again: three to four minutes each time. That way is still the fallback, and
    `AGENTIC_WHEN_FULL=trim` brings it back.
  - A question changes nothing: Edit and Write are turned away, and a command that is not
    plain reading runs in a throwaway copy of the project.
  - A question starts with the code it is about already read (`src/flows/explain.mjs`):
    the files it names, the definitions of the names it uses ("the test command" finds
    `testCommand`), or all of a very small project. No model call, no search.
- **Asking** (`src/flows/clarify.mjs` and the Ask tool): a bare "fix the bug" when nothing
  fails, or a lone word such as "api", gets a question before anything runs; the model
  can ask again mid-task as often as it needs. The model's question comes with two or
  three answers to pick from (different kinds of work: explain, fix, add); you answer by
  number or type a line. A short request the rules already understand ("rename test to
  check", "explain the tests") starts without being asked about.
- **Sorting** (`src/flows/words.mjs`, `index.mjs`; `sort.mjs` puts it in order): thanks,
  praise and "I need help with something" get a short reply with no tools; a short line
  that continues the last turn ("can you add it to my desktop?", "why") carries on with
  the conversation, with no question and no focused path; plain commands ("run the
  tests", "commit and push") and a page or file with no code named go step by step.
  Under the request a dim line says where it went: `Sorted as: change · shortcut`.
  `test/sort-lines.mjs` holds 101 requests (81 real, 20 traps) with the path each must
  take; a rule change that moves one fails `test/sort.test.mjs`.
- **Focused paths** (`src/flows`) handle most requests before the loop: a request is sorted
  (rules first; the model with a forced JSON reply only when no rule fits) into
  question / rename / fix / change / other.
  - Rename: every whole-word use in code, one diff, one question; no model.
  - Fix: run the tests, find the file, tries in a scratch copy, each told what the last
    one got wrong. Three tries on one function, then three wider tries as edit blocks.
  - Fix, check first (`src/flows/pagecheck.mjs`): a bug the tests cannot see on a page
    (something covered) gets a check made before any fix. Agentic Coder opens the page in the
    browser the project already has (Playwright), the way the project's own page checks
    do; the model picks the steps from what is on the page; the browser finds what covers
    what, and why (the two layers that are compared, and the lines that set them). The
    check must fail today, you approve it, the tries are scored by it, and it stays in
    the project. A fix that hides the covering thing does not pass. With no browser, or
    no passing try, the work goes step by step, with the check and the findings in hand.
    `AGENTIC_CHECK_FIRST=off` turns it off; a `page` entry in `.agentic/settings.json` (or the older `.bonsai/`)
    (`serve`, `in`, `port`, `url`) says how to open a page when Agentic Coder cannot tell.
  - Change: a test first (cross-checked against drafts, then approved by you), then
    tries. Two tests and two drafts; more only when they disagree.
  - Several files: the files are planned from the project map, one test, then edit
    blocks across all of them (`src/flows/multi.mjs`), with guards: only the planned
    files change and nothing is quietly removed. A draft that also touches the tests
    keeps its changes to the source; the test comes from its own step.
  - Anything a focused path cannot finish goes step by step. `--no-flows` always does.
- **The project map** (`src/tools/repomap.mjs`, cached under `~/.agentic-coder/maps`) is
  what files are chosen from and the first thing the loop sees in a bigger project.
- **A check before "done"**: when the loop changed files, one forced-JSON check compares
  the diff with the request and sends it back once if a part is missing.
- **The morning brief** (`src/morning`, `/morning` or `coding morning`): every repo under
  the home folder read (the day's commits, what is not live, CI, the test record, old
  uncommitted work), what earns a line picked by rules, the words written by the model in
  one forced-JSON call and checked against the facts (a time or number it made up is
  swapped for plain wording), and one page with a calendar of every earlier morning
  (`~/.repo-morning/history`). Your name, emails and deploy check live in
  `~/.repo-morning/config.json`; Claude's /repo-morning uses the same code through `cli.mjs`.
- **The screen** (`src/app`) is Ink (React for the terminal, the library Claude Code uses),
  in 256 colours for Apple Terminal, redrawn cleanly on every resize.

## Develop

```
bun terminal/src/cli.jsx               # run from source
bun run test:terminal                   # its tests, including the app driven by keys in a real terminal
node terminal/scripts/ui-walk.mjs       # every screen at one window size, with resizes, checked
node terminal/scripts/capture-ui.mjs    # the real app with the real model, screens saved as HTML
bun terminal/scripts/flow-page.mjs       # redraw the hub's Flow tab (src/app/flow.html); add a file name to write a dated copy for agentic-coder DOCS/
```

`scripts/demo` + `demo-project/` hold the design-stage previews (`bun run demo 1|2|3`); `scripts/shims` is the react-devtools stand-in the single-file build needs. Report pages are written to `agentic-coder DOCS/` at the top of the repo and mirrored into the repo's `docs/`.
`app/make-app.sh` builds `Agentic Coder.app` beside the repo's README.
