#!/bin/sh
# The `coding` command. Each start first takes GitHub's main into the repo (pull below:
# a fast-forward only, at most 8 s, never over your own changes), then checks the repo:
# when any of Agentic Coder's code changed since the last build, it rebuilds the one-file
# app first (about 0.2 s), then runs it. A build that fails leaves the last good app in place.
# A rebuilt app also restarts the door (door.mjs runDoor), so one `coding` is the whole update.
# /update in the app ends it with code 75 and the arguments to start again
# with; this script then checks, rebuilds and starts it again, in this window.
#   Installed as ~/.local/bin/coding by `bun run install-cli`.
#   AGENTIC_NO_UPDATE=1 coding   starts without checking (and without the app's
#   "Update available" badge, terminal/src/app/update.mjs, which uses the same file list).
#   AGENTIC_NO_PULL=1 coding     rebuilds from the folder as it is, without asking GitHub.
REPO="${AGENTIC_REPO:-__REPO__}"
APP="$HOME/.agentic-coder/app/agentic-coder"
LOG="$HOME/.agentic-coder/logs/update.log"
BUN="$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")"
RESTART="$HOME/.agentic-coder/restart.$$"

dim() { printf '\033[2m%s\033[0m\n' "$1" >&2; }
warn() { printf '\033[33m%s\033[0m\n' "$1" >&2; }
tilde() { echo "$1" | sed "s|^$HOME|~|"; }

# git with no terminal to ask on (a password or host key prompt fails instead of
# waiting), as update.mjs runs it.
g() {
  GIT_TERMINAL_PROMPT=0 GIT_ASKPASS= SSH_ASKPASS= GCM_INTERACTIVE=never \
    GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes -o ConnectTimeout=5}" \
    git -C "$REPO" -c core.fsmonitor=false "$@"
}

# Takes GitHub's main into the repo when it is ahead: only on main, only from an https,
# ssh or on-this-Mac origin (update.mjs isSafeRemote), only a fast-forward. Git refuses,
# and nothing changes, when a file you changed here is in the way or main has commits
# GitHub does not; no internet, or no answer in 8 s, starts the version already here.
pull() {
  [ "${AGENTIC_NO_UPDATE:-0}" != 1 ] && [ "${AGENTIC_NO_PULL:-0}" != 1 ] && [ -e "$REPO/.git" ] && command -v git >/dev/null || return 0
  [ "$(g symbolic-ref --short -q HEAD)" = main ] || return 0
  url="$(g remote get-url origin 2>/dev/null)"
  case "$url" in
    '' | *[[:space:]]* | *::*) return 0 ;;
    https://?* | ssh://[A-Za-z0-9_]* | /* | file:///*) ;;
    [A-Za-z0-9_]*@*:[!-]*) ;;
    *) return 0 ;;
  esac
  mkdir -p "$(dirname "$LOG")"
  g -c protocol.allow=never -c protocol.https.allow=always -c protocol.ssh.allow=always -c protocol.file.allow=always \
    -c http.sslVerify=true -c fetch.fsckObjects=true -c transfer.fsckObjects=true \
    -c gc.auto=0 -c maintenance.auto=false -c submodule.recurse=false \
    fetch --quiet --no-tags --no-recurse-submodules --no-write-fetch-head --refmap= \
    origin +refs/heads/main:refs/remotes/origin/main >"$LOG.pull" 2>&1 &
  fetch=$!
  # The time limit: stops the fetch if GitHub has not answered (a network that hangs).
  ( sleep "${AGENTIC_PULL_WAIT:-8}"; kill "$fetch" ) >/dev/null 2>&1 &
  watch=$!
  wait "$fetch"
  ok=$?
  # The timer is no longer needed; the shell's "Terminated" notice for it is not news.
  { kill "$watch"; wait "$watch"; } 2>/dev/null
  if [ "$ok" != 0 ]; then
    dim "↻ Could not reach GitHub; starting the version already here."
    return 0
  fi
  old="$(g rev-parse -q --verify refs/heads/main)"
  new="$(g rev-parse -q --verify refs/remotes/origin/main)"
  [ -n "$old" ] && [ -n "$new" ] && [ "$old" != "$new" ] || return 0
  g merge-base --is-ancestor "$new" "$old" && return 0 # GitHub is behind: nothing to take
  if ! g merge-base --is-ancestor "$old" "$new"; then
    warn "! main here and GitHub's main both have new commits: run git pull in $(tilde "$REPO") to join them. Starting the version already here."
    return 0
  fi
  n="$(g rev-list --count "$old..$new")"
  if ! g -c submodule.recurse=false merge --ff-only --quiet --no-edit refs/remotes/origin/main >>"$LOG.pull" 2>&1; then
    warn "! GitHub has an update, but files changed here are in its way (see $(tilde "$LOG.pull")). Starting the version already here."
    return 0
  fi
  if [ "$n" = 1 ]; then dim "↻ Pulled 1 update from GitHub"; else dim "↻ Pulled $n updates from GitHub"; fi
  # Packages: what bun install does after a pull that changed them (a new version, a
  # new patch); rebuild below installs only a package that is missing.
  if [ -n "$(g diff --name-only "$old" "$new" -- package.json bun.lock patches)" ] && [ -x "$BUN" ]; then
    dim "↻ Installing the packages Agentic Coder now needs…"
    (cd "$REPO" && "$BUN" install) >"$LOG.install" 2>&1 || warn "! bun install failed (see $(tilde "$LOG.install"))"
  fi
  # This script itself, when the update changed it (what bun run install-cli does): the
  # new copy is used from the next start. Only the installed launcher for this repo,
  # replaced whole (mv), so this run carries on with the copy it has.
  if ! g diff --quiet "$old" "$new" -- terminal/app/agentic-coder-launcher.sh && [ -f "$0" ] && [ ! -L "$0" ] && [ -O "$0" ] \
    && grep -qF "REPO=\"\${AGENTIC_REPO:-$REPO}\"" "$0"; then
    sed "s|__REPO__|$REPO|" "$REPO/terminal/app/agentic-coder-launcher.sh" > "$0.new" && chmod +x "$0.new" && mv -f "$0.new" "$0"
  fi
}

rebuild() {
  [ "${AGENTIC_NO_UPDATE:-0}" != 1 ] && [ -f "$REPO/terminal/src/cli.jsx" ] && [ -x "$BUN" ] || return 0
  changed=""
  # The Bun it was built with: a newer Bun (bun upgrade) rebuilds it, so the app gets what
  # that Bun adds (background sessions need 1.3.5 or later).
  BUNV="$("$BUN" --version 2>/dev/null)"
  if [ ! -x "$APP" ]; then
    changed="no app yet"
  elif [ "$(cat "$APP.bun" 2>/dev/null)" != "$BUNV" ]; then
    changed="bun $BUNV"
  else
    changed="$(find "$REPO/terminal/src" "$REPO/terminal/rules" "$REPO/models" "$REPO/package.json" \
      -newer "$APP" -type f \( -name '*.mjs' -o -name '*.js' -o -name '*.jsx' -o -name '*.json' -o -name '*.md' -o -name '*.html' \) \
      -not -path '*/node_modules/*' -not -path '*/results/*' \( -not -path '*/evals/*' -o -path '*/models/evals/record.mjs' -o -path '*/models/evals/run-tests.mjs' -o \( -path '*/models/evals/battle/*.mjs' -not -path '*/models/evals/battle/*/*' \) \) -not -path '*/test/*' \
      -not -name 'README.md' -print -quit 2>/dev/null)"
  fi
  [ -n "$changed" ] || return 0
  mkdir -p "$(dirname "$APP")" "$(dirname "$LOG")"
  # A package the code now needs and this Mac does not have yet (one added to
  # package.json, like the Claude API's SDK) is installed first, as the installer does;
  # so is a patch of a package (patchedDependencies: patches/ink@7.1.1.patch) that is not
  # on its installed copy yet (it is there when the patch takes back cleanly).
  if ! (cd "$REPO" && "$BUN" -e 'const fs = require("fs"), { spawnSync } = require("child_process"), p = require("./package.json"); const has = Object.keys(p.dependencies ?? {}).every((d) => fs.existsSync(`node_modules/${d}/package.json`)); const patched = Object.entries(p.patchedDependencies ?? {}).every(([spec, file]) => spawnSync("git", ["apply", "--check", "-R", "--directory", `node_modules/${spec.slice(0, spec.lastIndexOf("@"))}`, file]).status === 0); process.exit(has && patched ? 0 : 1)') >/dev/null 2>&1; then
    printf '\033[2m↻ Installing the packages Agentic Coder now needs…\033[0m\n' >&2
    (cd "$REPO" && "$BUN" install) >"$LOG.install" 2>&1 || printf '\033[33m! bun install failed (see %s)\033[0m\n' "$(echo "$LOG.install" | sed "s|^$HOME|~|")" >&2
  fi
  tmp="$APP.$$"
  if (cd "$REPO" && "$BUN" build --compile --minify terminal/src/cli.jsx --outfile "$tmp") >"$LOG" 2>&1; then
    # bun leaves the file open to every account on the Mac; only you may change the app
    chmod 755 "$tmp"
    mv -f "$tmp" "$APP"
    printf '%s' "$BUNV" > "$APP.bun"
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
pull
while :; do
  rebuild
  rm -f "$RESTART"
  AGENTIC_LAUNCHER="$0" AGENTIC_REPO="$REPO" AGENTIC_RESTART_FILE="$RESTART" "$APP" "$@"
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
