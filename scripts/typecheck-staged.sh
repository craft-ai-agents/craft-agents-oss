#!/usr/bin/env bash
set -euo pipefail

changed_files="$(git diff --cached --name-only --diff-filter=ACMR)"

if [ -z "$changed_files" ]; then
  echo "No staged files detected. Skipping typecheck."
  exit 0
fi

has_changed_in() {
  local pattern="$1"
  echo "$changed_files" | grep -Eq "$pattern"
}

run_step() {
  local label="$1"
  local cmd="$2"
  echo "→ $label"
  eval "$cmd"
}

run_full=false

# Config/tooling changes can affect multiple workspaces.
if has_changed_in '^(package\.json|bun\.lock|tsconfig(\..+)?\.json|apps/electron/tsconfig\.json|packages/.+/tsconfig\.json)$'; then
  run_full=true
fi

if [ "$run_full" = true ]; then
  run_step "Typecheck all" "bun run typecheck:all"
  exit 0
fi

ran_any=false

if has_changed_in '^apps/electron/'; then
  run_step "Typecheck Electron" "bun run typecheck:electron"
  ran_any=true
fi

if has_changed_in '^apps/viewer/'; then
  run_step "Typecheck Viewer" "bun run viewer:typecheck"
  ran_any=true
fi

if has_changed_in '^packages/shared/'; then
  run_step "Typecheck Shared" "bun run typecheck:shared"
  ran_any=true
fi

if has_changed_in '^packages/core/'; then
  run_step "Typecheck Core" "cd packages/core && bun run tsc --noEmit"
  ran_any=true
fi

if has_changed_in '^packages/server-core/'; then
  run_step "Typecheck Server Core" "cd packages/server-core && bun run tsc --noEmit"
  ran_any=true
fi

if has_changed_in '^packages/server/'; then
  run_step "Typecheck Server" "cd packages/server && bun run tsc --noEmit"
  ran_any=true
fi

if has_changed_in '^packages/session-tools-core/'; then
  run_step "Typecheck Session Tools" "cd packages/session-tools-core && bun run tsc --noEmit"
  ran_any=true
fi

if has_changed_in '^packages/ui/'; then
  run_step "Typecheck UI" "cd packages/ui && bun run tsc --noEmit"
  ran_any=true
fi

if [ "$ran_any" = false ]; then
  echo "No staged TypeScript workspaces changed. Skipping typecheck."
fi
