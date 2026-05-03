#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="${TMPDIR:-/tmp}"
TMP_ROOT="${TMP_ROOT%/}"
MANIFEST_PATH="$TMP_ROOT/background-computer-use/runtime-manifest.json"

rm -f "$MANIFEST_PATH"
"$ROOT_DIR/script/build_and_run.sh" run

for _ in $(seq 1 80); do
  if [ -f "$MANIFEST_PATH" ]; then
    BASE_URL="$(python3 - "$MANIFEST_PATH" <<'PY'
import json, sys
try:
    print(json.load(open(sys.argv[1]))["baseURL"])
except Exception:
    sys.exit(1)
PY
)"
    if [ -n "$BASE_URL" ] && curl -fsS "$BASE_URL/health" >/dev/null 2>&1; then
      break
    fi
  fi
  sleep 0.25
done

if [ ! -f "$MANIFEST_PATH" ]; then
  echo "Runtime manifest was not created at $MANIFEST_PATH" >&2
  exit 1
fi

BASE_URL="$(python3 - "$MANIFEST_PATH" <<'PY'
import json, sys
print(json.load(open(sys.argv[1]))["baseURL"])
PY
)"

echo "BackgroundComputerUse running at $BASE_URL"
echo "Runtime manifest: $MANIFEST_PATH"
echo
echo "Bootstrap:"
curl -fsS "$BASE_URL/v1/bootstrap" | python3 -m json.tool
