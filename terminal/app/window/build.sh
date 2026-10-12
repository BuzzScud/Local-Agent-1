#!/bin/sh
# Builds Agentic Coder's own window (12 Oct 2026, a Tauri shell: terminal/app/window/) and puts it where `coding`
# finds it: <home>/app/Agentic Coder Window.app (terminal/src/window/server.mjs windowApp). Needs Rust (rustup);
# the first build takes a few minutes, later ones under one. `bun run window` runs this.
set -e
here="$(cd "$(dirname "$0")" && pwd)"
home="${AGENTIC_HOME:-$HOME/.agentic-coder}"
target="$home/build/window-target"
cargo="$(command -v cargo || echo "$HOME/.cargo/bin/cargo")"
if [ ! -x "$cargo" ]; then
  echo "The window needs Rust: install it with rustup (its own page says how), then run this again."
  exit 1
fi
cd "$here"
CARGO_TARGET_DIR="$target" "$cargo" build --release -j "${AGENTIC_WINDOW_JOBS:-4}"
app="$home/app/Agentic Coder Window.app"
new="$app.new"
rm -rf "$new"
mkdir -p "$new/Contents/MacOS" "$new/Contents/Resources"
cp "$target/release/agentic-coder-window" "$new/Contents/MacOS/agentic-coder-window"
cp "$here/icons/icon.icns" "$new/Contents/Resources/icon.icns"
cat > "$new/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>agentic-coder-window</string>
  <key>CFBundleIdentifier</key><string>dev.agentic-coder.window</string>
  <key>CFBundleName</key><string>Agentic Coder</string>
  <key>CFBundleDisplayName</key><string>Agentic Coder</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --deep --sign - "$new" >/dev/null 2>&1 || true
rm -rf "$app"
mv "$new" "$app"
echo "built: $app"
