#!/usr/bin/env bash
# Reject filenames illegal on Windows (and often broken in rsync/zip tools).
set -euo pipefail
cd "$(dirname "$0")/.."

BAD=$(git ls-files -z | tr '\0' '\n' | grep -E '[<>:"|?*]' || true)
if [[ -n "$BAD" ]]; then
  echo "error: files with characters illegal on Windows:" >&2
  echo "$BAD" >&2
  exit 1
fi
echo "illegal-filenames: OK"
