#!/bin/sh
# The `coding` command. GitHub's main is the original (18 Oct 2026, the owner's pick, "main, always"): each start
# asks GitHub for its main (at most 8 s), builds the one-file app from a clean copy of it when its code changed
# (~/.agentic-coder/build/main, about 3 s), and runs that. Changes made in the folder and not pushed are never in
# the app: run them with `bun run start`. The folder itself is fast-forwarded to GitHub's main for that work, only
# on main and never over your own changes. A build that fails leaves the last good app in place. A rebuilt app also
# restarts the door (door.mjs runDoor), so one `coding` is the whole update.
# /update in the app ends it with code 75 and the arguments to start again with; this script then builds GitHub's
# main and starts it again, in this window.
#   Installed as ~/.local/bin/coding by `bun run install-cli`; after that it installs itself from GitHub's main.
#   AGENTIC_NO_UPDATE=1 coding   starts the app as it is, without asking GitHub or building.
#   AGENTIC_NO_PULL=1 coding     does not ask GitHub: builds the main this Mac last saw.
#   AGENTIC_BUILD_ONLY=1 coding  builds and installs as a start does, then ends (bun run install-cli).
REPO="${AGENTIC_REPO:-__REPO__}"
APP="$HOME/.agentic-coder/app/agentic-coder"
SRC="$HOME/.agentic-coder/build/main"
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

# Asks GitHub for its main (refs/remotes/origin/main), whatever branch the folder is on: only from an https, ssh
# or on-this-Mac origin (update.mjs isSafeRemote). No internet, or no answer in 8 s: the main this Mac last saw.
fetched=0
fetch_main() {
  [ "${AGENTIC_NO_UPDATE:-0}" != 1 ] && [ "${AGENTIC_NO_PULL:-0}" != 1 ] && [ -e "$REPO/.git" ] && command -v git >/dev/null || return 0
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
    dim "↻ Could not reach GitHub; building the main this Mac last saw."
    return 0
  fi
  fetched=1
}

# The folder, for your own work in it (bun run start): fast-forwarded to GitHub's main, only on main, only a
# fast-forward. Git refuses, and nothing changes, when a file you changed is in the way or the folder's main has
# commits GitHub does not; the app runs GitHub's main either way.
pull() {
  [ "$fetched" = 1 ] || return 0
  [ "$(g symbolic-ref --short -q HEAD)" = main ] || return 0
  old="$(g rev-parse -q --verify refs/heads/main)"
  new="$(g rev-parse -q --verify refs/remotes/origin/main)"
  [ -n "$old" ] && [ -n "$new" ] && [ "$old" != "$new" ] || return 0
  g merge-base --is-ancestor "$new" "$old" && return 0 # GitHub is behind: nothing to take
  if ! g merge-base --is-ancestor "$old" "$new"; then
    warn "! The folder's main and GitHub's main both have new commits: run git pull in $(tilde "$REPO") to join them. The app runs GitHub's main."
    return 0
  fi
  n="$(g rev-list --count "$old..$new")"
  if ! g -c submodule.recurse=false merge --ff-only --quiet --no-edit refs/remotes/origin/main >>"$LOG.pull" 2>&1; then
    warn "! Files changed in $(tilde "$REPO") are in the way of GitHub's main (see $(tilde "$LOG.pull")), so the folder stays as it is. The app runs GitHub's main."
    return 0
  fi
  if [ "$n" = 1 ]; then dim "↻ Pulled 1 update from GitHub"; else dim "↻ Pulled $n updates from GitHub"; fi
  # Packages for the folder's own runs (bun run start), as bun install does after a pull that changed them.
  if [ -n "$(g diff --name-only "$old" "$new" -- package.json bun.lock patches)" ] && [ -x "$BUN" ]; then
    dim "↻ Installing the packages Agentic Coder now needs…"
    (cd "$REPO" && "$BUN" install) >"$LOG.install" 2>&1 || warn "! bun install failed (see $(tilde "$LOG.install"))"
  fi
}

# What the app is built from: GitHub's main as last fetched; a repo with no GitHub (a copy of its own) builds its main.
main_ref() {
  for r in refs/remotes/origin/main refs/heads/main; do
    c="$(g rev-parse -q --verify "$r^{commit}" 2>/dev/null)" && [ -n "$c" ] && { echo "$c"; return 0; }
  done
  return 1
}
# The first file of the app's code that differs between two commits, if any: what update.mjs isAppCode counts (the
# package files, the app's own files under evals/, and the code and text files under terminal/src, terminal/rules
# and models; no tests, results or READMEs).
app_code_between() {
  g diff --name-only "$1" "$2" -- terminal/src terminal/rules models package.json bun.lock bunfig.toml patches | awk '
    /^(package\.json|bun\.lock|bunfig\.toml)$/ || /^patches\// || /^models\/evals\/(record|run-tests|prompts)\.mjs$/ || /^models\/evals\/battle\/[^\/]+\.mjs$/ { print; exit }
    !/^(terminal\/src|terminal\/rules|models)\// { next }
    /(^|\/)(node_modules|results|evals|test)\// || /(^|\/)README\.md$/ { next }
    /\.(mjs|js|jsx|json|md|html|txt|swift|py)$/ { print; exit }'
}
# The packages a build needs are the same in two folders: package.json and patches/, and bun.lock when main has one
# (this repo keeps its lockfile out of git, so a folder's own lockfile is not a difference).
same_packages() {
  cmp -s "$1/package.json" "$2/package.json" || return 1
  if [ -e "$1/bun.lock" ]; then cmp -s "$1/bun.lock" "$2/bun.lock" || return 1; fi
  if [ -d "$1/patches" ] || [ -d "$2/patches" ]; then diff -rq "$1/patches" "$2/patches" >/dev/null 2>&1 || return 1; fi
  return 0
}
# Every package in main's package.json ($1) is in a node_modules folder ($2), with its patch on (patchedDependencies:
# patches/ink@7.1.1.patch is on when it takes back cleanly): not when main added a package the folder never installed.
# Looked at where that folder really is, since git apply does not look past a link.
packages_ready() {
  mods="$(cd -P "$2" 2>/dev/null && pwd)" || return 1
  (cd "$(dirname "$mods")" && PKG="$1" MODS="$(basename "$mods")" "$BUN" -e 'const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process"), { PKG, MODS } = process.env, p = require(path.join(PKG, "package.json")); const has = Object.keys(p.dependencies ?? {}).every((d) => fs.existsSync(`${MODS}/${d}/package.json`)); const patched = Object.entries(p.patchedDependencies ?? {}).every(([spec, file]) => spawnSync("git", ["apply", "--check", "-R", "--directory", `${MODS}/${spec.slice(0, spec.lastIndexOf("@"))}`, path.join(PKG, file)]).status === 0); process.exit(has && patched ? 0 : 1)') >/dev/null 2>&1
}
install_packages() {
  dim "↻ Installing the packages Agentic Coder now needs…"
  (cd "$1" && "$BUN" install) >"$LOG.install" 2>&1 || warn "! bun install failed (see $(tilde "$LOG.install"))"
}

# $SRC is always a clean copy of the commit in $APP.commit: when main moves it is copied out again (about 0.3 s),
# and the app is built from it only when the app's code moved too (about 3 s), not for pages or tests.
rebuild() {
  [ "${AGENTIC_NO_UPDATE:-0}" != 1 ] && [ -x "$BUN" ] && [ -e "$REPO/.git" ] && command -v git >/dev/null || return 0
  want="$(main_ref)" || { [ -x "$APP" ] && return 0; printf 'There is no main to build in %s\n' "$(tilde "$REPO")" >&2; exit 1; }
  # The Bun it was built with: a newer Bun (bun upgrade) rebuilds it, so the app gets what
  # that Bun adds (background sessions need 1.3.5 or later).
  BUNV="$("$BUN" --version 2>/dev/null)"
  built="$(cat "$APP.commit" 2>/dev/null)"
  build=1
  if [ -x "$APP" ] && [ "$(cat "$APP.bun" 2>/dev/null)" = "$BUNV" ] && [ -d "$SRC" ] && [ -n "$built" ] && g cat-file -e "$built^{commit}" 2>/dev/null; then
    [ "$built" = "$want" ] && return 0
    [ -n "$(app_code_between "$built" "$want")" ] || build=0
  fi
  mkdir -p "$(dirname "$SRC")" "$(dirname "$APP")" "$(dirname "$LOG")"
  # The copy: exactly what git holds for that commit, nothing of the folder's.
  new="$SRC.new.$$"
  rm -rf "$new" "$new.tar" && mkdir -p "$new"
  paths=""
  for p in terminal/src terminal/rules terminal/app models package.json bun.lock bunfig.toml patches; do
    g cat-file -e "$want:$p" 2>/dev/null && paths="$paths $p"
  done
  # shellcheck disable=SC2086 # git's own names, no spaces
  if ! { g archive --format=tar -o "$new.tar" "$want" $paths && tar -xf "$new.tar" -C "$new"; } >"$LOG" 2>&1; then
    rm -rf "$new" "$new.tar"
    if [ -x "$APP" ]; then warn "! GitHub's main could not be copied out (see $(tilde "$LOG")); starting the last good version."; return 0; fi
    printf 'The first build failed; see %s\n' "$LOG" >&2
    exit 1
  fi
  rm -f "$new.tar"
  if [ "$build" = 0 ]; then
    # Same packages (they count as the app's code): the last copy's, as they are.
    if [ -e "$SRC/node_modules" ] || [ -L "$SRC/node_modules" ]; then mv "$SRC/node_modules" "$new/node_modules"; fi
  else
    # Its packages: the folder's when main's package files are the folder's and all of them are there, else the
    # last copy's when they have not changed, else installed for it (never through a link to another folder's).
    if [ -d "$REPO/node_modules" ] && same_packages "$new" "$REPO" && packages_ready "$new" "$REPO/node_modules"; then
      ln -s "$REPO/node_modules" "$new/node_modules"
    elif [ -d "$SRC/node_modules" ] && [ ! -L "$SRC/node_modules" ] && same_packages "$new" "$SRC"; then
      mv "$SRC/node_modules" "$new/node_modules"
    else
      install_packages "$new"
    fi
    tmp="$APP.$$"
    # Built without NODE_ENV: bun build writes the NODE_ENV it runs with into the app, and an app built
    # with the tests' (NODE_ENV=test) made a throwaway home at every start, so it never found your
    # settings or its window and opened in the terminal (18 Oct 2026).
    if ! (cd "$new" && env -u NODE_ENV "$BUN" build --compile --minify terminal/src/cli.jsx --outfile "$tmp") >"$LOG" 2>&1; then
      # The last copy keeps its packages back.
      if [ -d "$new/node_modules" ] && [ ! -L "$new/node_modules" ] && [ -d "$SRC" ] && [ ! -e "$SRC/node_modules" ]; then mv "$new/node_modules" "$SRC/node_modules"; fi
      rm -rf "$new" "$tmp"
      if [ -x "$APP" ]; then
        warn "! GitHub's main did not build (see $(tilde "$LOG")); starting the last good version."
        return 0
      fi
      printf 'The first build failed; see %s\n' "$LOG" >&2
      exit 1
    fi
  fi
  old="$SRC.old.$$"
  rm -rf "$old"
  if [ -d "$SRC" ]; then mv "$SRC" "$old"; fi
  mv "$new" "$SRC"
  rm -rf "$old"
  if [ "$build" = 1 ]; then
    # bun leaves the file open to every account on the Mac; only you may change the app
    chmod 755 "$tmp"
    mv -f "$tmp" "$APP"
    printf '%s' "$BUNV" > "$APP.bun"
  fi
  printf '%s' "$want" > "$APP.commit"
  [ "$build" = 1 ] && dim "↻ Agentic Coder updated to main ($(printf '%s' "$want" | cut -c1-7))"
  # This script too, from the same commit (what bun run install-cli does): used from the next start. Only the
  # installed launcher for this repo, a plain file of yours, replaced whole (mv), so this run carries on with it.
  # The folder goes in place of the first mark only (update.mjs refreshLauncher), word for word; the mark is
  # spelt in two parts here, so the one in REPO= above stays the only one in this file.
  lsrc="$SRC/terminal/app/agentic-coder-launcher.sh"
  if [ -f "$lsrc" ] && [ -f "$0" ] && [ ! -L "$0" ] && [ -O "$0" ] && grep -qF "REPO=\"\${AGENTIC_REPO:-$REPO}\"" "$0"; then
    awk -v repo="$REPO" -v mark="__RE""PO__" '!done && (i = index($0, mark)) { $0 = substr($0, 1, i - 1) repo substr($0, i + length(mark)); done = 1 } { print }' "$lsrc" > "$0.new" \
      && { cmp -s "$0.new" "$0" && rm -f "$0.new" || { chmod +x "$0.new" && mv -f "$0.new" "$0"; }; }
  fi
  return 0
}

# The app learns where the repo (and its DOCS folder) is, and where to leave
# the arguments for a restart. This script waits while it runs (it reads no
# keys), so the app has the terminal to itself.
mkdir -p "$(dirname "$RESTART")"
fetch_main
pull
if [ "${AGENTIC_BUILD_ONLY:-0}" = 1 ]; then rebuild; exit 0; fi
while :; do
  rebuild
  rm -f "$RESTART"
  # AGENTIC_BUILD: the clean copy of main the app was built from (its rules and packages are read from there);
  # AGENTIC_BUILT_COMMIT: that commit (the "Update available" badge counts from it, update.mjs checkUpdate).
  AGENTIC_LAUNCHER="$0" AGENTIC_REPO="$REPO" AGENTIC_BUILD="$SRC" AGENTIC_BUILT_COMMIT="$(cat "$APP.commit" 2>/dev/null)" \
    AGENTIC_RESTART_FILE="$RESTART" "$APP" "$@"
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
