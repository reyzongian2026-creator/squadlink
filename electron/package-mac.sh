#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
[[ "$(uname -sm)" == "Darwin arm64" ]] || { echo 'Se requiere un Mac con Apple Silicon.'; exit 1; }
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
bundle="$out/Squadlink Moderno.app"
runtime="$(node -p "require('electron')" | tail -n 1)"
ditto "$(dirname "$(dirname "$(dirname "$runtime")")")" "$bundle"
resources="$bundle/Contents/Resources"
ditto stage "$resources/app"
icons="$out/Squadlink.iconset"
mkdir -p "$icons" ../artifacts/macos
for size in 16 32 128 256 512; do
  sips -s format png -z "$size" "$size" ../public/icon-512.png --out "$icons/icon_${size}x${size}.png" >/dev/null
  double=$((size*2))
  sips -s format png -z "$double" "$double" ../public/icon-512.png --out "$icons/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$icons" -o "$resources/Squadlink.icns"
python3 - "$bundle/Contents/Info.plist" <<'PY'
import plistlib,sys
p=sys.argv[1]
with open(p,'rb') as f: info=plistlib.load(f)
info.update(CFBundleName='Squadlink Moderno', CFBundleDisplayName='Squadlink Moderno',
            CFBundleIdentifier='com.squadlink.moderno.preview', CFBundleIconFile='Squadlink.icns',
            CFBundleShortVersionString='0.5.0', CFBundleVersion='21',
            NSMicrophoneUsageDescription='Squadlink usa el micrófono cuando lo activas para hablar en una sala o probar tu audio.')
with open(p,'wb') as f: plistlib.dump(info,f)
PY
/usr/bin/clang -Os -Wall -Wextra -o "$resources/app/update-mac-helper" update-mac-helper.c
codesign --force --sign - "$resources/app/update-mac-helper"
codesign --force --deep --sign - "$bundle"
codesign --verify --deep --strict "$bundle"
ditto -c -k --keepParent "$bundle" ../artifacts/macos/Squadlink-Moderno-macOS-arm64.zip
(cd ../artifacts/macos && shasum -a 256 Squadlink-Moderno-macOS-arm64.zip > SHA256.txt)
