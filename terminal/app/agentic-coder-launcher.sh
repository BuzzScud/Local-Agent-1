#!/bin/sh
# The `coding` command. Each start checks the repo: when any of Agentic Coder's code
# changed since the last build, it rebuilds the one-file app first (about
# 0.2 s), then runs it. A build that fails leaves the last good app in place.
# /update in the app ends it with code 75 and the arguments to start again
# with; this script then checks, rebuilds and starts it again, in this window.
#   Installed as ~/.local/bin/coding by `bun run install-cli`.
#   AGENTIC_NO_UPDATE=1 coding   starts without checking (and without the app's
#   "Update available" badge, terminal/src/app/update.mjs, which uses the same file list).
REPO="${AGENTIC_REPO:-${BONSAI_REPO:-__REPO__}}"
APP="$HOME/.agentic-coder/app/agentic-coder"
LOG="$HOME/.agentic-coder/logs/update.log"
BUN="$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")"
RESTART="$HOME/.agentic-coder/restart.$$"

rebuild() {
  [ "${AGENTIC_NO_UPDATE:-${BONSAI_NO_UPDATE:-0}}" != 1 ] && [ -f "$REPO/terminal/src/cli.jsx" ] && [ -x "$BUN" ] || return 0
  changed=""
  if [ ! -x "$APP" ]; then
    changed="no app yet"
  else
    changed="$(find "$REPO/terminal/src" "$REPO/terminal/rules" "$REPO/models" "$REPO/package.json" \
      -newer "$APP" -type f \( -name '*.mjs' -o -name '*.js' -o -name '*.jsx' -o -name '*.json' -o -name '*.md' -o -name '*.html' \) \
      -not -path '*/node_modules/*' -not -path '*/results/*' \( -not -path '*/evals/*' -o -path '*/models/evals/record.mjs' -o -path '*/models/evals/run-tests.mjs' \) -not -path '*/test/*' \
      -not -name 'README.md' -print -quit 2>/dev/null)"
  fi
  [ -n "$changed" ] || return 0
  mkdir -p "$(dirname "$APP")" "$(dirname "$LOG")"
  tmp="$APP.$$"
  if (cd "$REPO" && "$BUN" build --compile --minify terminal/src/cli.jsx --outfile "$tmp") >"$LOG" 2>&1; then
    # bun leaves the file open to every account on the Mac; only you may change the app
    chmod 755 "$tmp"
    mv -f "$tmp" "$APP"
    printf '\033[2m↻ Agentic Coder updated from %s\033[0m\n' "$(echo "$REPO" | sed "s|^$HOME|~|")" >&2
  else
    rm -f "$tmp"
    if [ -x "$APP" ]; then
      printf '\033[33m! The update did not build (see %s); starting the last good version.\033[0m\n' "$(echo "$LOG" | sed "s|^$HOME|~|")" >&2
    else
      printf 'The first build failed; see %s\n' "$LOG" >&2
      exit 1
    fi
  fi
}

# The app learns where the repo (and its DOCS folder) is, and where to leave
# the arguments for a restart. This script waits while it runs (it reads no
# keys), so the app has the terminal to itself.
mkdir -p "$(dirname "$RESTART")"
while :; do
  rebuild
  rm -f "$RESTART"
  # Both names: an app built before the rename reads only BONSAI_*.
  AGENTIC_REPO="$REPO" AGENTIC_RESTART_FILE="$RESTART" BONSAI_REPO="$REPO" BONSAI_RESTART_FILE="$RESTART" "$APP" "$@"
  code=$?
  # Only a plain file of yours that the app just wrote (not a link); each line
  # is one argument, never run as shell code.
  if [ "$code" = 75 ] && [ -f "$RESTART" ] && [ ! -L "$RESTART" ] && [ -O "$RESTART" ]; then
    set --
    while IFS= read -r a; do set -- "$@" "$a"; done < "$RESTART"
    rm -f "$RESTART"
    continue
  fi
  rm -f "$RESTART"
  exit "$code"
done
