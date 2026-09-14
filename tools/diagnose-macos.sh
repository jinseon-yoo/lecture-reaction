#!/bin/bash
# Explains why "Lecture React.app" will not open on this Mac.
# Usage:  bash tools/diagnose-macos.sh "/path/to/Lecture React.app"
APP="${1:-/Applications/Lecture React.app}"
echo "Checking: $APP"
echo
[ -d "$APP" ] || { echo "NOT FOUND. Unzip the download first, then pass the .app path."; exit 1; }

THIS=$(uname -m)
APP_ARCH=$(lipo -archs "$APP/Contents/MacOS/lecture-react" 2>/dev/null)
echo "This Mac:      $THIS"
echo "App built for: ${APP_ARCH:-unreadable}"
case "$THIS:$APP_ARCH" in
  arm64:x86_64) echo ">> WRONG DOWNLOAD. This is the Intel build on an Apple silicon Mac."
                echo "   Download Lecture-React-macOS-AppleSilicon.zip instead." ;;
  x86_64:arm64) echo ">> WRONG DOWNLOAD. This is the Apple silicon build on an Intel Mac."
                echo "   Download Lecture-React-macOS-Intel.zip instead." ;;
esac
echo

echo "Version:   $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null)"
SIDE=$(lipo -archs "$APP/Contents/MacOS/lr-server" 2>/dev/null)
echo "Server:    ${SIDE:-MISSING}"
[ "$SIDE" = "x86_64 arm64" ] && echo ">> OLD UNIVERSAL BUILD (v1.0.0/v1.0.1). This one hangs on launch. Get v1.0.2 or later."
echo

Q=$(xattr -p com.apple.quarantine "$APP" 2>/dev/null)
if [ -n "$Q" ]; then
  echo ">> QUARANTINED — macOS will refuse to launch it. Fix with:"
  echo "     xattr -dr com.apple.quarantine \"$APP\""
else
  echo "Quarantine: clear (good)"
fi
codesign --verify --deep --strict "$APP" 2>&1 | head -3 || true
echo "Gatekeeper: $(spctl -a -vv "$APP" 2>&1 | head -1)"
echo
echo "Trying to launch it now..."
open "$APP" 2>&1
sleep 12
if pgrep -f "$APP/Contents/MacOS/lecture-react" >/dev/null; then
  W=$(osascript -e 'tell application "System Events" to tell (first process whose bundle identifier is "com.lecturereact.overlay") to return (count of windows)' 2>/dev/null)
  H=$(curl -s -o /dev/null -m 3 -w "%{http_code}" http://127.0.0.1:8787/health)
  echo "Running. windows=$W  server=$H"
  [ "$W" = "0" ] && echo ">> Running but no window: that is the universal-sidecar hang. Get v1.0.2 or later."
  [ "$W" = "1" ] && [ "$H" = "200" ] && echo ">> WORKING."
else
  echo ">> It did not start. If it is not quarantined and the arch matches, send this whole output."
fi
