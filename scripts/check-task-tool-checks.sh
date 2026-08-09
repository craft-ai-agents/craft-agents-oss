#!/bin/bash
# Lint guard: detect hard-coded `toolName === 'Task'` / `=== 'Agent'` checks.
#
# Background: Claude Agent SDK v0.2.72 renamed the subagent launcher tool
# from 'Task' to 'Agent'. The shared helper isParentTaskTool() in
# packages/shared/src/utils/toolNames.ts handles both names. Hard-coding
# either literal causes the UI to silently lose subagent grouping/collapsing
# whenever the other name is in use.
#
# Always use `isParentTaskTool(toolName)` instead.
#
# Approved exceptions:
#   - packages/shared/src/utils/toolNames.ts: defines the canonical set
#   - **/__tests__/**: fixtures and regression tests may reference either name

set -euo pipefail

PATTERN="toolName === ['\"](Task|Agent)['\"]"

if command -v rg >/dev/null 2>&1; then
  VIOLATIONS=$(rg "$PATTERN" apps/ packages/ \
    --glob '!**/__tests__/**' \
    --glob '!**/toolNames.ts' \
    -l 2>/dev/null || true)
else
  VIOLATIONS=$(grep -R -l -E "$PATTERN" apps/ packages/ \
    --include='*.ts' \
    --include='*.tsx' \
    --exclude-dir='__tests__' \
    --exclude='toolNames.ts' 2>/dev/null || true)
fi

if [ -n "${VIOLATIONS:-}" ]; then
  echo "ERROR: Hard-coded toolName === 'Task' / 'Agent' check found:"
  echo "$VIOLATIONS"
  echo ""
  echo "Use isParentTaskTool(toolName) from @craft-agent/shared/utils/toolNames"
  echo "so both names (SDK renamed Task -> Agent in v0.2.72) are recognised."
  exit 1
fi

echo "OK: No hard-coded toolName === 'Task' / 'Agent' checks."
