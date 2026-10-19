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
#   AGENTIC_PULLED_AT            when this start asked GitHub (seconds; set by fetch_main for what it starts): a
#                                launcher run again within AGENTIC_PULL_FRESH seconds (30) does not ask again.
#   AGENTIC_BUILD_ONLY=1 coding  builds and installs as a start does, then ends (bun run install-cli).
#   AGENTIC_ON_OPEN=1 coding     what a Terminal opening runs (the lines on_open_hook puts in ~/.zshrc): asks GitHub and
#                                builds as a start does, at most once every 10 minutes, without starting the app.
REPO="${AGENTIC_REPO:-__REPO__}"
APP="$HOME/.agentic-coder/app/agentic-coder"
SRC="$HOME/.agentic-coder/build/main"
LOG="$HOME/.agentic-coder/logs/update.log"
BUN="$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")"
RESTART="$HOME/.agentic-coder/restart.$$"
# The window (terminal/src/window/server.mjs windowApp): where `bun run window` puts it.
WHOME="${AGENTIC_HOME:-$HOME/.agentic-coder}"
WIN="$WHOME/app/Agentic Coder Window.app"

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
  # The window's app and a session's keeper run through this script again a second after it has asked GitHub
  # (window/server.mjs and sessions.mjs appCommand): that run does not ask again (19 Oct 2026: about 0.5 s a start).
  case "${AGENTIC_PULLED_AT:-}" in
    '' | *[!0-9]*) ;;
    *) since=$(($(date +%s) - $AGENTIC_PULLED_AT)); [ "$since" -ge 0 ] && [ "$since" -lt "${AGENTIC_PULL_FRESH:-30}" ] && return 0 ;;
  esac
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
  # Asked, answered or not: what the app runs this script with again goes by it (above).
  AGENTIC_PULLED_AT="$(date +%s)"
  export AGENTIC_PULLED_AT
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

# Agentic Coder's own window (terminal/app/window, a Tauri shell) is built from the same copy of main by itself: the
# first time on a Mac that has Rust's cargo (18 Oct 2026, the owner: "make coding build the window by itself"), and
# again whenever main changes its code. In the background, so no start waits: until it is in place, the window you
# have (or the terminal) is used. Not off a Mac, nor where the window is turned off (AGENTIC_WINDOW=off, as in the
# tests: what windowWanted in terminal/src/window/server.mjs skips), and once a start: by the coding you typed, not
# again by the session or the window it opens, which run the app through this script too. The stamp beside the window
# is git's id for main's terminal/app/window it was built from; a build that failed is tried again only when main
# changes that code.
window_shell() {
  [ "${AGENTIC_NO_UPDATE:-0}" != 1 ] && [ -d "$SRC/terminal/app/window" ] && [ "$(uname -s)" = Darwin ] || return 0
  [ -z "${AGENTIC_IN_HOST:-}" ] && [ -z "${AGENTIC_WINDOW_CHILD:-}" ] || return 0
  case "$(printf '%s' "${AGENTIC_WINDOW:-}" | tr '[:upper:]' '[:lower:]')" in off | 0 | no | false | terminal) return 0 ;; esac
  tree="$(g rev-parse -q --verify "$(cat "$APP.commit" 2>/dev/null):terminal/app/window" 2>/dev/null)" && [ -n "$tree" ] || return 0
  [ -d "$WIN" ] && [ "$(cat "$WIN.tree" 2>/dev/null)" = "$tree" ] && return 0
  lock="$WHOME/build/window.lock"
  wlog="$WHOME/logs/window-build.log"
  failed="$WHOME/build/window.failed"
  if [ -d "$lock" ]; then
    if kill -0 "$(cat "$lock/pid" 2>/dev/null)" 2>/dev/null; then
      [ -d "$WIN" ] || dim "↻ The window is still being built (see $(tilde "$wlog")); a start after that opens it."
      return 0
    fi
    rm -rf "$lock"
  fi
  if [ "$(cat "$failed" 2>/dev/null)" = "$tree" ]; then
    [ -d "$WIN" ] || warn "! The window did not build (see $(tilde "$wlog"); bun run window in $(tilde "$REPO") shows why). coding tries again when main changes it."
    return 0
  fi
  if ! command -v cargo >/dev/null && [ ! -x "$HOME/.cargo/bin/cargo" ]; then
    if [ -d "$WIN" ]; then warn "! The window has an update on GitHub's main, and building it needs Rust (rustup.rs). The window you have is used until then."
    else dim "Agentic Coder opens in its own window once Rust is installed (rustup.rs): the next coding builds it."; fi
    return 0
  fi
  mkdir -p "$WHOME/build" "$WHOME/logs" && mkdir "$lock" 2>/dev/null || return 0
  # Its own copy: a later start may copy main out again while this builds.
  ws="$WHOME/build/window-src"
  if ! { rm -rf "$ws" && cp -R "$SRC/terminal/app/window" "$ws"; }; then rm -rf "$lock" "$ws"; return 0; fi
  if [ -d "$WIN" ]; then dim "↻ The window is being built from GitHub's main in the background (see $(tilde "$wlog")); the next start uses it."
  else dim "↻ Building Agentic Coder's window for the first time, in the background (a few minutes; see $(tilde "$wlog")); a start after that opens it."; fi
  # nohup: it carries on when this Terminal closes. The stamp is written only when the build put the window in
  # place; a failure is written down instead, so the next starts do not run the same failing build again.
  nohup sh -c 'echo $$ > "$1/pid"; if sh "$2/build.sh"; then printf "%s" "$3" > "$4.tree"; rm -f "$5"; else printf "%s" "$3" > "$5"; fi; rm -rf "$2" "$1"' \
    window-build "$lock" "$ws" "$tree" "$WIN" "$failed" >"$wlog" 2>&1 </dev/null &
}

# A Terminal that opens updates Agentic Coder (18 Oct 2026, the owner: "update it so if a terminal opens, it updates
# from git"; their picks: in the background, on every Mac with coding). ~/.zshrc starts `AGENTIC_ON_OPEN=1 coding`
# behind the prompt; on_open asks GitHub, pulls and builds as a start does, and ends without starting the app: at most
# once every 10 minutes (AGENTIC_ON_OPEN_EVERY, minutes) and one at a time. A new version is said once, dim, at the
# next prompt (the lines' precmd reads logs/on-open.said).
on_open() {
  stamp="$WHOME/logs/on-open.at"
  lock="$WHOME/build/on-open.lock"
  mkdir -p "$WHOME/logs" "$WHOME/build" || return 0
  now_s="$(date +%s)"
  last_s="$(cat "$stamp" 2>/dev/null)"
  case "$last_s" in '' | *[!0-9]*) ;; *) [ $((now_s - last_s)) -lt $((${AGENTIC_ON_OPEN_EVERY:-10} * 60)) ] && return 0 ;; esac
  if ! mkdir "$lock" 2>/dev/null; then
    kill -0 "$(cat "$lock/pid" 2>/dev/null)" 2>/dev/null && return 0
    rm -rf "$lock" && mkdir "$lock" 2>/dev/null || return 0
  fi
  echo $$ > "$lock/pid"
  echo "$now_s" > "$stamp"
  was="$(cat "$APP.commit" 2>/dev/null)"
  fetch_main
  pull
  # What earlier test runs left running (a run cut off, one inside Agentic Coder's sandbox, which cannot stop
  # another's): stopped by the tests' own sweep, from the folder (the build copy has no tests). Outside any sandbox.
  if [ -f "$REPO/terminal/test/test-tmp.mjs" ] && [ -x "$BUN" ]; then
    "$BUN" "$REPO/terminal/test/test-tmp.mjs" --sweep >"$WHOME/logs/on-open.sweep" 2>&1
  fi
  rebuild
  window_shell
  now="$(cat "$APP.commit" 2>/dev/null)"
  if [ -n "$now" ] && [ "$now" != "$was" ]; then
    printf "↻ Agentic Coder updated to GitHub's main (%s)\n" "$(printf '%s' "$now" | cut -c1-7)" > "$WHOME/logs/on-open.said"
  fi
  rm -rf "$lock"
}
# The lines in ~/.zshrc that start it, put there once by a start or bun run install-cli (the note on-open.hook says they
# were, so lines you take out stay out). Only for zsh, the Mac's own shell; never with AGENTIC_ON_OPEN_HOOK=off (the
# tests). A launchd service has no SHELL: the account's own shell is asked then.
on_open_hook() {
  [ "${AGENTIC_ON_OPEN_HOOK:-on}" = off ] && return 0
  [ -e "$WHOME/on-open.hook" ] && return 0
  sh_="${SHELL:-$(dscl . -read "/Users/$(id -un)" UserShell 2>/dev/null | awk '{print $2}')}"
  case "$sh_" in *zsh) ;; *) return 0 ;; esac
  rc="${ZDOTDIR:-$HOME}/.zshrc"
  if ! grep -qF '>>> Agentic Coder: update when a Terminal opens' "$rc" 2>/dev/null; then
    cat >> "$rc" <<'ZSHRC' || return 0

# >>> Agentic Coder: update when a Terminal opens (coding put these lines here; delete them to stop it) >>>
if [ -x "$HOME/.local/bin/coding" ]; then
  ( AGENTIC_ON_OPEN=1 nohup "$HOME/.local/bin/coding" >/dev/null 2>&1 </dev/null & )
  _agentic_said() { local f="$HOME/.agentic-coder/logs/on-open.said"; [ -s "$f" ] && printf '\033[2m%s\033[0m\n' "$(cat "$f")" && rm -f "$f"; return 0; }
  autoload -Uz add-zsh-hook && add-zsh-hook precmd _agentic_said
fi
# <<< Agentic Coder <<<
ZSHRC
    dim "Agentic Coder now updates itself from GitHub when a Terminal opens (lines added to $(tilde "$rc"); delete them to stop it)."
  fi
  mkdir -p "$WHOME" && date > "$WHOME/on-open.hook"
}

# The app learns where the repo (and its DOCS folder) is, and where to leave
# the arguments for a restart. This script waits while it runs (it reads no
# keys), so the app has the terminal to itself.
mkdir -p "$(dirname "$RESTART")"
if [ "${AGENTIC_ON_OPEN:-0}" = 1 ]; then on_open; exit 0; fi
fetch_main
pull
on_open_hook
if [ "${AGENTIC_BUILD_ONLY:-0}" = 1 ]; then rebuild; exit 0; fi
while :; do
  rebuild
  window_shell
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
