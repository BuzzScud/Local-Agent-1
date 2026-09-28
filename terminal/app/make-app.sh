#!/bin/zsh
# Builds "Agentic Coder.app" in the repo folder: a click-to-start launcher
# (like XMR Miner.app) from terminal/app/agentic-coder.applescript, with its icon.icns.
# To change the icon: edit terminal/app/icon.svg, then run node terminal/app/render-icon.mjs
# (needs Playwright) before this script.
set -euo pipefail
here=${0:A:h}
root=${here:h:h} # the repo: the app lands beside README.md, as before
APP="$root/Agentic Coder.app"
rm -rf -- "$APP"
osacompile -o "$APP" "$here/agentic-coder.applescript"
# The script takes dropped folders, so macOS builds a "droplet": put the icon
# wherever Info.plist says the icon lives (droplet.icns), not only applet.icns.
iconName=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIconFile" "$APP/Contents/Info.plist")
rm -f "$APP"/Contents/Resources/{applet,droplet}.icns
cp "$here/icon.icns" "$APP/Contents/Resources/${iconName%.icns}.icns"
/usr/libexec/PlistBuddy -c "Set :CFBundleName Agentic Coder" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.agenticcoder.launcher" "$APP/Contents/Info.plist" 2>/dev/null || true
# Folders (and files) can be dropped on the icon.
/usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes array" -c "Add :CFBundleDocumentTypes:0 dict" \
  -c "Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Viewer" \
  -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes array" \
  -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string public.folder" \
  -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:1 string public.item" "$APP/Contents/Info.plist" 2>/dev/null || true
codesign --force --deep --sign - "$APP" >/dev/null 2>&1
touch "$APP"
echo "built: $APP"
