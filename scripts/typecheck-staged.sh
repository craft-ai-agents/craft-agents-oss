#!/usr/bin/env bash
# Pre-commit typecheck for staged TypeScript changes.
#
# Auto-discovers workspaces: for every staged file under `apps/<X>/` or
# `packages/<X>/`, if that directory has a `tsconfig.json`, the workspace
# is typechecked. No hardcoded allowlist — new workspaces are picked up
# automatically.
#
# Typecheck command per workspace:
#   - `bun run typecheck` if package.json defines it (respects custom setups)
#   - `bun run tsc --noEmit` otherwise (plain TS workspace)
set -euo pipefail

changed_files="$(git diff --cached --name-only --diff-filter=ACMR)"

if [ -z "$changed_files" ]; then
  echo "No staged files detected. Skipping typecheck."
  exit 0
fi

# Root config / tooling changes can ripple through every workspace, so
# treat them as a full-run trigger.
if echo "$changed_files" | grep -Eq '^(package\.json|bun\.lock|tsconfig(\..+)?\.json)$'; then
  echo "→ Root config changed — running full typecheck"
  bun run typecheck:all
  exit 0
fi

# Collect `apps/<X>` + `packages/<X>` directories touched by staged files.
workspaces="$(echo "$changed_files" \
  | grep -E '^(apps|packages)/[^/]+/' \
  | awk -F/ '{print $1"/"$2}' \
  | sort -u || true)"

if [ -z "$workspaces" ]; then
  echo "No workspace files staged. Skipping typecheck."
  exit 0
fi

ran_any=false
while IFS= read -r ws; do
  [ -z "$ws" ] && continue
  if [ ! -f "$ws/tsconfig.json" ]; then
    continue
  fi

  if [ -f "$ws/package.json" ] && grep -Eq '"typecheck"[[:space:]]*:' "$ws/package.json"; then
    echo "→ Typecheck $ws (npm script)"
    (cd "$ws" && bun run typecheck)
  else
    echo "→ Typecheck $ws (tsc --noEmit)"
    (cd "$ws" && bun run tsc --noEmit)
  fi
  ran_any=true
done <<< "$workspaces"

if [ "$ran_any" = false ]; then
  echo "No staged TypeScript workspaces changed. Skipping typecheck."
fi
