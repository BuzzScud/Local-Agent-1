#!/bin/sh
# The `bonsai` command. Each start checks the repo: when any of Bonsai's code
# changed since the last build, it rebuilds the one-file app first (about
# 0.2 s), then runs it. A build that fails leaves the last good app in place.
#   Installed as ~/.local/bin/bonsai by `bun run install-cli`.
#   BONSAI_NO_UPDATE=1 bonsai   starts without checking.
REPO="${BONSAI_REPO:-__REPO__}"
APP="$HOME/.bonsai-code/app/bonsai"
LOG="$HOME/.bonsai-code/logs/update.log"
BUN="$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")"

if [ "${BONSAI_NO_UPDATE:-0}" != 1 ] && [ -f "$REPO/terminal/src/cli.jsx" ] && [ -x "$BUN" ]; then
  changed=""
  if [ ! -x "$APP" ]; then
    changed="no app yet"
  else
    changed="$(find "$REPO/terminal/src" "$REPO/terminal/rules" "$REPO/models" "$REPO/package.json" \
      -newer "$APP" -type f \( -name '*.mjs' -o -name '*.js' -o -name '*.jsx' -o -name '*.json' -o -name '*.md' \) \
      -not -path '*/node_modules/*' -not -path '*/results/*' -not -path '*/evals/*' -not -path '*/test/*' \
      -not -name 'README.md' -print -quit 2>/dev/null)"
  fi
  if [ -n "$changed" ]; then
    mkdir -p "$(dirname "$APP")" "$(dirname "$LOG")"
    tmp="$APP.$$"
    if (cd "$REPO" && "$BUN" build --compile --minify terminal/src/cli.jsx --outfile "$tmp") >"$LOG" 2>&1; then
      mv -f "$tmp" "$APP"
      printf '\033[2m↻ Bonsai updated from %s\033[0m\n' "$(echo "$REPO" | sed "s|^$HOME|~|")" >&2
    else
      rm -f "$tmp"
      if [ -x "$APP" ]; then
        printf '\033[33m! The update did not build (see %s); starting the last good version.\033[0m\n' "$(echo "$LOG" | sed "s|^$HOME|~|")" >&2
      else
        printf 'The first build failed; see %s\n' "$LOG" >&2
        exit 1
      fi
    fi
  fi
fi
exec "$APP" "$@"
