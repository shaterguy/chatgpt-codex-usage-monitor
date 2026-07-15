#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"
parts=$(find . -maxdepth 1 -type f -name 'codex-usage-bar-v1.2.0.zip.b64.part*' | sort)
count=$(printf '%s\n' "$parts" | sed '/^$/d' | wc -l | tr -d ' ')
[ "$count" = "5" ] || { echo "Expected 5 archive parts, found $count." >&2; exit 1; }

cat $parts | base64 -d > codex-usage-bar-v1.2.0.zip
expected='f4a4cd170999c26c45bd8bd2e8d67d779af676bfee165a0959c4d790f3d85000'
actual=$(sha256sum codex-usage-bar-v1.2.0.zip | awk '{print $1}')
[ "$actual" = "$expected" ] || {
  rm -f codex-usage-bar-v1.2.0.zip
  echo "SHA-256 mismatch. Expected $expected, got $actual." >&2
  exit 1
}

printf 'Created: %s\nSHA-256: %s\n' "$PWD/codex-usage-bar-v1.2.0.zip" "$actual"
