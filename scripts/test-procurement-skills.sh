#!/usr/bin/env bash
# Run all procurement skill contract unit tests.
# Stdlib-only tests use python3; openpyxl-backed render tests use uv --with openpyxl.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mapfile -t tests < <(find procurement-skills -type f -name 'test_*.py' | sort)
if [[ ${#tests[@]} -eq 0 ]]; then
  echo "error: no procurement-skills test_*.py found" >&2
  exit 1
fi

stdlib=()
openpyxl=()
for t in "${tests[@]}"; do
  if [[ "$t" == *render_* || "$t" == *openpyxl* || "$t" == *test_render_* || "$t" == *from_form* ]]; then
    openpyxl+=("$t")
  else
    stdlib+=("$t")
  fi
done

echo "Running skill contract tests:"
if [[ ${#stdlib[@]} -gt 0 ]]; then
  printf '  [stdlib] %s\n' "${stdlib[@]}"
  python3 -m unittest -v "${stdlib[@]}"
fi
if [[ ${#openpyxl[@]} -gt 0 ]]; then
  printf '  [openpyxl] %s\n' "${openpyxl[@]}"
  uv run --with openpyxl python3 -m unittest -v "${openpyxl[@]}"
fi
echo "test:skills: OK"
