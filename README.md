# Bonsai Code

A Claude Code–style coding agent for your terminal that runs **Bonsai 2 27B**
(PrismML's ternary model, 7.2 GB) on this Mac. Nothing leaves the machine.

```
cd any/project
bonsai                     # start here
bonsai "fix the tests"     # start with a first prompt
bonsai -c                  # continue the last conversation in this folder
bonsai -p "what does x do" # answer once and exit
```

## Screen

Two layouts, switched with **ctrl+l** or `/layout` (your choice is remembered):

- **Classic** — Claude Code as it is: thinking folded to one line, one spinner, a quiet footer.
- **Live thinking** — you watch it work: thinking streams in a 4-line window, tool calls
  show how much is written, and a meter line shows speed, context and memory.

## Keys

| Key | Does |
|---|---|
| enter | send · `\` + enter for a new line |
| esc | stop Bonsai · twice to clear the prompt |
| shift+tab | ask first → accept edits → plan (read-only) |
| ctrl+l | switch layout |
| ctrl+o | show the last thinking or output in full |
| ↑ ↓ | earlier prompts |
| `/` | commands · `@` attach a file · `!` run a shell command yourself · `?` shortcuts |
| ctrl+c twice | quit (the conversation is saved) |

Commands: `/help /clear /compact /layout /think /mode /init /resume /model /stats /doctor /exit`.

## Permissions

It asks before every edit and command (Yes · Yes for this session · No and say what
instead). Always blocked, in every mode: `rm -rf`, `sudo`, `git push`,
`git reset --hard`, `git clean -f`, `kill`/`pkill`/`killall`, stopping services, and
piping the internet into a shell. Files outside the project folder are never changed.

## How it works

- `~/.bonsai-code/bin` — Prism ML's llama.cpp build (`prism-b10735`), needed for the
  ternary weights. `~/.bonsai-code/models` — `Ternary-Bonsai-2-27B-PQ2_0.gguf` (7.21 GB).
  On the M4 it writes about 10 tokens a second and reads about 61.
- The app starts `llama-server` on port 17600 (or the next free one) with a 32k memory
  (8-bit cache; about 9.3 GB in all), dropping to 16k when the Mac is short on memory,
  and stops it on exit. It uses the model file's own chat template. The server's saved
  states are capped (4 checkpoints, no store of old prompts): its defaults grew to 9 GB
  of extra memory within 13 prompts.
- Thinking is off by default; `/think` (or `--think`) turns on PrismML's "medium" effort,
  and the server ends any thinking after 2,048 tokens.
- The agent loop (`src/agent`) sends the conversation, streams the reply, runs one tool
  at a time and feeds the result back. Seven tools: Read, List, Search, Edit, Write,
  Bash, TodoWrite. Built for small local models, from what the practice runs showed:
  - Read returns plain text (numbered lines got copied into edits); small files come back whole.
  - Edits match despite indentation slips and one-character typos (one clear place only,
    and the lines meant to stay are put back exactly); `replace_all` for renames.
  - An edit that would break a file that parsed before is refused (JS, JSON, Python).
  - Write only creates files; existing files change through Edit.
  - Wrong full paths, wrong folders and copied headers are mapped back or removed;
    empty searches list the project's files; `*.js` also finds `.mjs`.
  - Guards: repeated steps, looping output, a tool call written as text or inside the
    thinking, and "announce then stop" (it is told to go ahead); a thinking budget; old
    output trimmed and the conversation summarized when memory fills.
- Focused paths (`src/flows`) handle most requests before the loop: a request is sorted
  (rules, or the model with a forced JSON reply) into question / rename / fix / change.
  - Rename: every whole-word use in every file, one diff, one question; no model.
  - Fix: run the tests, find the file, up to 8 tries in a scratch copy, each told what the
    last one got wrong; the first that passes is shown for your OK.
  - Change: a test first (cross-checked against drafts, then approved by you), then tries.
  - Files over 80 lines: a try rewrites only the one function (the model still reads files
    up to 300 lines whole). If that never passes, it works step by step instead.
  - `--no-flows` always works step by step.
- The screen (`src/app`) is Ink (React for the terminal, the library Claude Code uses),
  in 256 colours for Apple Terminal.

## Develop

```
bun src/cli.jsx            # run from source
bun test                   # 70 tests: tools, permissions, agent, focused paths, and the app driven by keys in a real terminal
node evals/run.mjs         # the practice coding tasks against the real model (thinking off and on)
node scripts/dev/27b-realuse.mjs <port> <pid>   # speed, memory and 4 real checks against a running server
bun run install-cli        # build one file and put it at ~/.local/bin/bonsai
```

`src/demo` + `demo-project/` hold the design-stage previews (`bun run demo 1|2|3`).
