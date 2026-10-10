#!/usr/bin/env bash
# Builds dist/markette-extension-<version>.zip for the Chrome Web Store (or "Load unpacked" from src/).
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./src/manifest.json').version")
mkdir -p dist
out="dist/markette-extension-${version}.zip"
rm -f "$out"
(cd src && zip -qr -X "../$out" . -x '.*')
echo "$out"
