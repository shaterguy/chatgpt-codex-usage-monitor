#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUTPUT="$SCRIPT_DIR/codex-usage-bar-v1.2.1.zip"
EXPECTED="bdcdebcc6786642438cedb24f657d03ca3a9fdda38b041769231e8df18dceaca"

set -- "$SCRIPT_DIR"/codex-usage-bar-v1.2.1.zip.b64.part*
if [ "$#" -ne 6 ] || [ ! -f "$1" ]; then
  echo "Expected 6 archive parts." >&2
  exit 1
fi

cat "$@" | base64 -d > "$OUTPUT"
ACTUAL=$(sha256sum "$OUTPUT" | awk '{print $1}')
if [ "$ACTUAL" != "$EXPECTED" ]; then
  rm -f "$OUTPUT"
  echo "SHA-256 mismatch. Expected $EXPECTED, got $ACTUAL." >&2
  exit 1
fi

echo "Created: $OUTPUT"
echo "SHA-256: $ACTUAL"
