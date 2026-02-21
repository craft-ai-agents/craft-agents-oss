#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="$ROOT_DIR/apps/electron/src/main"
MODEL_FETCHERS_DIR="$TARGET_DIR/model-fetchers"

FORBIDDEN_IMPORTS=(
  "@craft-agent/shared/codex"
  "@craft-agent/shared/agent/claude-agent"
  "@craft-agent/shared/agent/codex-agent"
  "@craft-agent/shared/agent/copilot-agent"
  "@craft-agent/shared/agent/pi-agent"
  "@github/copilot-sdk"
)

has_violation=0

for module in "${FORBIDDEN_IMPORTS[@]}"; do
  if rg -n --fixed-strings "from '$module'" "$TARGET_DIR"; then
    has_violation=1
  fi
  if rg -n --fixed-strings "from \"$module\"" "$TARGET_DIR"; then
    has_violation=1
  fi
  if rg -n --fixed-strings "import('$module')" "$TARGET_DIR"; then
    has_violation=1
  fi
  if rg -n --fixed-strings "import(\"$module\")" "$TARGET_DIR"; then
    has_violation=1
  fi
done

LOGIC_FORBIDDEN_PATTERNS=(
  "@anthropic-ai/claude-agent-sdk"
)

for pattern in "${LOGIC_FORBIDDEN_PATTERNS[@]}"; do
  if rg -n --fixed-strings "$pattern" "$TARGET_DIR"; then
    has_violation=1
  fi
done

MODEL_FETCHER_FORBIDDEN_PATTERNS=(
  "/v1/models"
  "anthropic-version"
  "getPiModelsForAuthProvider"
  "getAllPiModels"
)

for pattern in "${MODEL_FETCHER_FORBIDDEN_PATTERNS[@]}"; do
  if rg -n --fixed-strings "$pattern" "$MODEL_FETCHERS_DIR"; then
    has_violation=1
  fi
done

if [[ "$has_violation" -ne 0 ]]; then
  echo "Backend boundary violations found in apps/electron/src/main."
  exit 1
fi

echo "Backend import boundary check passed."
