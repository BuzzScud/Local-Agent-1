#!/bin/sh
# Installs Agentic Coder on a Mac in one go:
#   curl -fsSL https://raw.githubusercontent.com/BuzzScud/Local-Agent-1/main/install.sh | sh
# 1. checks the Mac (macOS, Apple Silicon, memory, Apple's command line tools)
# 2. installs Bun if it is missing (asks first)
# 3. gets the code into ~/agentic-coder (or updates it when it is already there)
# 4. builds the app and puts the `coding` command in ~/.local/bin
# 5. asks, then builds the model server and downloads the models (`coding setup`)
# Safe to run again: finished parts are skipped.
#   AGENTIC_DIR=~/somewhere   where the code goes (default ~/agentic-coder)
#   AGENTIC_YES=1             answer yes to every question (no prompts)
set -e

REPO_URL="${AGENTIC_REPO_URL:-https://github.com/BuzzScud/Local-Agent-1.git}"
DIR="${AGENTIC_DIR:-$HOME/agentic-coder}"
BIN_DIR="$HOME/.local/bin"

bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
# Runs a step with its output in a log; shows the end of the log only if the step fails.
LOG="${TMPDIR:-/tmp}/agentic-coder-install.$$.log"
quiet() { "$@" >"$LOG" 2>&1 || { tail -20 "$LOG" >&2; fail "that step failed (the full log: $LOG)"; }; }

# The script arrives on stdin (curl | sh), so answers are read from the terminal.
# With no terminal to ask, the answer is no, unless AGENTIC_YES=1.
ask() {
  [ "${AGENTIC_YES:-0}" = 1 ] && return 0
  if ! (exec </dev/tty) 2>/dev/null; then warn "no terminal to ask \"$1\": skipped (AGENTIC_YES=1 says yes)"; return 1; fi
  printf '  %s [Y/n] ' "$1"
  read -r answer </dev/tty || return 1
  case "$answer" in [nN]*) return 1 ;; *) return 0 ;; esac
}

printf '\033[1mAgentic Coder installer\033[0m: a coding agent for your terminal, running a model on this Mac.\n'

# ---- 1. the Mac -----------------------------------------------------------------------------
bold "1/5  Checking this Mac"
[ "$(uname -s)" = Darwin ] || fail "Agentic Coder runs on macOS only."
ok "macOS $(sw_vers -productVersion 2>/dev/null)"
if [ "$(uname -m)" = arm64 ]; then ok "Apple Silicon"
else warn "this is not an Apple Silicon Mac: the model will run very slowly, if at all"; fi
mem_gb=$(( $(sysctl -n hw.memsize) / 1073741824 ))
if [ "$mem_gb" -ge 16 ]; then ok "${mem_gb} GB of memory"
else warn "${mem_gb} GB of memory: the model needs about 16 GB and may not start"; fi
if xcode-select -p >/dev/null 2>&1; then ok "Apple's command line tools (git, compilers)"
else
  xcode-select --install >/dev/null 2>&1 || true
  fail "Apple's command line tools are missing. A window to install them just opened: finish it, then run this installer again."
fi

# ---- 2. Bun ---------------------------------------------------------------------------------
bold "2/5  Bun (runs and builds the app)"
BUN="$(command -v bun 2>/dev/null || true)"
[ -z "$BUN" ] && [ -x "$HOME/.bun/bin/bun" ] && BUN="$HOME/.bun/bin/bun"
if [ -n "$BUN" ]; then ok "Bun $("$BUN" --version) is here"
elif ask "Bun is not installed. Install it now (from bun.sh)?"; then
  curl -fsSL https://bun.sh/install | bash >/dev/null
  BUN="$HOME/.bun/bin/bun"
  [ -x "$BUN" ] || fail "Bun did not install. Install it by hand (https://bun.sh), then run this installer again."
  ok "Bun $("$BUN" --version) installed"
else fail "Agentic Coder needs Bun. Install it (https://bun.sh), then run this installer again."; fi

# ---- 3. the code ----------------------------------------------------------------------------
bold "3/5  Getting the code"
if [ -d "$DIR/.git" ]; then
  if git -C "$DIR" pull --ff-only --quiet 2>/dev/null; then ok "updated $DIR"
  else warn "could not update $DIR (local changes?): using it as it is"; fi
elif [ -e "$DIR" ]; then
  fail "$DIR already exists and is not Agentic Coder. Move it, or pick another folder: AGENTIC_DIR=~/somewhere"
else
  quiet git clone "$REPO_URL" "$DIR"
  ok "downloaded to $DIR"
fi

# ---- 4. the app and the `coding` command -----------------------------------------------------
bold "4/5  Building the app"
cd "$DIR"
quiet "$BUN" install
ok "packages installed"
quiet "$BUN" run install-cli
ok "the coding command is at $BIN_DIR/coding (it rebuilds itself when the code changes)"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    case "${SHELL##*/}" in bash) rc="$HOME/.bash_profile" ;; *) rc="$HOME/.zshrc" ;; esac
    if ! grep -qs '\.local/bin' "$rc"; then
      printf '\n# Agentic Coder: the coding command\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$rc"
      ok "added ~/.local/bin to your PATH in $rc"
    fi
    NEW_TERMINAL=1
    ;;
esac

# ---- 5. the model server and the models -------------------------------------------------------
bold "5/5  The model"
echo "  Next: build the model server (llama.cpp, about 3 minutes) and download the models,"
echo "  about 8.2 GB: Qwen3.5 9B (6.9 GB, its speed-up helper built in) and two small models for"
echo "  the memory and the code search. Everything runs on this Mac afterwards."
free_gb=$(( $(df -k "$HOME" | awk 'NR==2 {print $4}') / 1048576 ))
[ "$free_gb" -ge 12 ] || warn "only ${free_gb} GB free on this disk: about 12 GB is needed"
if ask "Build the model server and download the models now?"; then
  if ! command -v cmake >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1 && ask "The build needs cmake. Install it with Homebrew?"; then
      brew install cmake
    else
      fail "The build needs cmake. Install it (brew install cmake), then run: coding setup"
    fi
  fi
  "$BIN_DIR/coding" setup
  MODEL_READY=1
else
  warn "skipped: run  coding setup  when you are ready (needs cmake: brew install cmake)"
fi

# ---- done -------------------------------------------------------------------------------------
bold "Done."
[ "${NEW_TERMINAL:-0}" = 1 ] && echo "  Open a new terminal window first (so it finds the coding command)."
[ "${MODEL_READY:-0}" = 1 ] || echo "  Run  coding setup  to get the model."
echo "  Then go to any project and start:"
echo "    cd ~/your-project"
echo "    coding"
