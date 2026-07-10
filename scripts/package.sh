#!/usr/bin/env bash
#
# Package the extension for Chrome Web Store upload.
#
# Zips the contents of extension/ into a versioned zip at the repo root,
# e.g. save-image-n-context-v0.5.zip
#
# Usage:  ./scripts/package.sh
#
set -euo pipefail

# Resolve repo root regardless of where the script is called from.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$REPO_ROOT/extension"
MANIFEST="$EXT_DIR/manifest.json"

if [[ ! -f "$MANIFEST" ]]; then
  echo "Error: $MANIFEST not found." >&2
  exit 1
fi

# Read the version from manifest.json (uses jq if available, else sed).
if command -v jq > /dev/null 2>&1; then
  VERSION="$(jq -r .version "$MANIFEST")"
else
  VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST" | head -n 1)"
fi

if [[ -z "$VERSION" ]]; then
  echo "Error: could not read version from manifest.json." >&2
  exit 1
fi

# Sanity check: warn if the 128px icon (required by the Web Store) is missing.
if [[ ! -f "$EXT_DIR/icons/icon128.png" ]]; then
  echo "Warning: icons/icon128.png is missing — the Web Store requires a 128x128 icon." >&2
fi

OUT_ZIP="$REPO_ROOT/save-image-n-context-v$VERSION.zip"

if [[ -f "$OUT_ZIP" ]]; then
  echo "Error: $OUT_ZIP already exists." >&2
  echo "Store versions cannot be reused — bump the version in manifest.json," >&2
  echo "or delete the old zip if you have not uploaded it yet." >&2
  exit 1
fi

# Zip the *contents* of extension/ so manifest.json sits at the zip root,
# excluding hidden files.
(
  cd "$EXT_DIR"
  zip -r "$OUT_ZIP" . -x ".*" -x "*/.*"
)

echo ""
echo "Created: $OUT_ZIP"
echo "Upload this file at https://chrome.google.com/webstore/devconsole"
echo "After the store accepts it, tag the release:  git tag v$VERSION && git push --tags"
