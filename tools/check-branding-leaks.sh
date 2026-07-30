#!/usr/bin/env bash
# =============================================================================
# tools/check-branding-leaks.sh
#
# Post-merge CI gate that scans the ENTIRE working tree — including
# untracked (new) files — for lingering old brand strings.
#
# This catches the case where someone introduces a NEW file with the old
# brand by accident (e.g., copying an old template, pasting from docs).
# Unlike scripts/check-brand-leaks.sh which only scans tracked files via
# git grep, this script also scans untracked files via grep.
#
# Usage:
#   bash tools/check-branding-leaks.sh          # scan entire tree
#   bash tools/check-branding-leaks.sh --json   # machine-readable output
#   SKIP_BRAND_LEAK=1 git commit ...           # bypass
#
# CI integration:
#   - Runs as a post-merge gate in validate.yml
#   - Can also run on push to main or as a standalone check
# =============================================================================

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# ── Flags ──────────────────────────────────────────────────────────────────

JSON_MODE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --json)  JSON_MODE=true; shift ;;
    -h|--help)
      cat << 'EOF'
Usage: tools/check-branding-leaks.sh [OPTIONS]

Scans the entire working tree (tracked + untracked) for lingering old
brand strings. Post-merge CI gate.

Options:
  --json     Output machine-readable JSON (for CI consumption)
  -h, --help Show this help

Bypass: SKIP_BRAND_LEAK=1
EOF
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Pattern: old brand strings that should never appear ────────────────────

PATTERN='Craft Agents|CraftAgents|craft-ai-agents'

# ── Allowlist: internal code identifiers that can't be renamed ─────────────
# Line-level matching — if a line matches any of these, it's NOT a leak.

ALLOW=(
  # npm workspace package name
  'craft-agents-oss'
  # MCP server slug — hardcoded in protocol
  'craft-agents-docs'
  # MCP tool name — protocol-level identifier
  'SearchCraftAgents'
  # GitHub issue/PR refs in comments (e.g., craft-agents-oss#782)
  'craft-ai-agents/craft-agents'
  # i18n translation keys (menu.aboutCraftAgents etc.)
  'menu\.(about|hide|quit)CraftAgents'
  # Feature flag function names
  'isCraftAgents[Cc]li'
  # Telegram bot handle
  '@CraftAgentsBot'
  # package name in resolution paths
  'packages/craft-agents-commands'
  # Internal variable names in test files
  'mockCraftAgents[Cc]li'
  # deep-link protocol scheme
  'craftagents://'
  # internal config dir
  '\.craft-agent[/"]'
  # CRAFT_* env var names
  'CRAFT_[A-Z_]+'
  # @craft-agent/ npm scope
  '@craft-agent/'
  # Old upstream repo URL
  'lukilabs/craft-agents-oss'
  # Old upstream CLI URL
  'anthropics/craft-agents'
  # Internal function names
  'parseInternalCraftAgents'
)

# Build single grep -E pattern
ALLOW_RE=$(IFS='|'; echo "${ALLOW[*]}")

# ── File-level exclusions (historical docs, rebranding tools, tooling scripts)
FILE_EXCLUDE='release-notes/|docs/brand/|docs/git/|scripts/rebrand\.ts|scripts/check-brand-leaks\.sh|scripts/split-commits\.sh|scripts/branch-stack\.sh|tools/check-branding-leaks\.sh|bun\.lock|\.gitignore|\.gitattributes|TRADEMARK\.md'

# ── Scan tracked files (via git grep — fast) ──────────────────────────────

echo "🔍 Scanning tracked files..."

TRACKED_HITS=$(git grep -nEI "$PATTERN" -- \
    '*.ts' '*.tsx' '*.js' '*.jsx' '*.json' '*.yml' '*.yaml' \
    '*.toml' '*.sh' '*.md' '*.css' '*.html' '*.vue' '*.svelte' \
    2>/dev/null \
  | grep -vE "^[^:]+:[^:]*:.*($ALLOW_RE)" \
  | grep -vE "($FILE_EXCLUDE)" \
  || true)

# ── Scan untracked files (via find + grep — catches new files) ────────────

echo "🔍 Scanning untracked / new files..."

UNTRACKED_FILES=$(git ls-files --others --exclude-standard 2>/dev/null || true)

UNTRACKED_HITS=""
if [ -n "$UNTRACKED_FILES" ]; then
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    [ ! -f "$file" ] && continue

    # Skip excluded directories and file patterns
    case "$file" in
      node_modules/*|.git/*|release/*|dist/*|out-tsc/*|.tmp-tools/*|.freebuff/*|.hermes/*|coverage/*) continue ;;
    esac
    echo "$file" | grep -qE "($FILE_EXCLUDE)" 2>/dev/null && continue

    # Get the file extension
    ext="${file##*.}"
    case "$ext" in
      ts|tsx|js|jsx|json|yml|yaml|toml|sh|md|css|html|vue|svelte) ;;
      *) continue ;;
    esac

    # Search for old brand strings
    FILE_HITS=$(grep -nEI "$PATTERN" "$file" 2>/dev/null || true)
    [ -z "$FILE_HITS" ] && continue

    while IFS= read -r line; do
      [ -z "$line" ] && continue
      # Apply allowlist
      echo "$line" | grep -qE "($ALLOW_RE)" 2>/dev/null && continue
      UNTRACKED_HITS="${UNTRACKED_HITS}${file}:${line}\n"
    done <<< "$FILE_HITS"
  done <<< "$UNTRACKED_FILES"
fi

# ── Merge results ──────────────────────────────────────────────────────────

ALL_HITS=""
HIT_COUNT=0

if [ -n "$TRACKED_HITS" ]; then
  TRACKED_COUNT=$(echo "$TRACKED_HITS" | grep -c '[^[:space:]]' || echo 0)
  HIT_COUNT=$((HIT_COUNT + TRACKED_COUNT))
  ALL_HITS="${ALL_HITS}${TRACKED_HITS}"
fi

if [ -n "$UNTRACKED_HITS" ]; then
  UNTRACKED_COUNT=$(echo -e "$UNTRACKED_HITS" | grep -c '[^[:space:]]' || echo 0)
  HIT_COUNT=$((HIT_COUNT + UNTRACKED_COUNT))
  ALL_HITS="${ALL_HITS}${UNTRACKED_HITS}"
fi

# ── Output ─────────────────────────────────────────────────────────────────

if [ "$JSON_MODE" = true ]; then
  # Machine-readable JSON output
  echo "{"
  echo "  \"hitCount\": $HIT_COUNT,"
  echo "  \"hits\": ["

  FIRST=true
  if [ -n "$ALL_HITS" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      # Extract file and line number from "file:linenum:content" format
      FILE=$(echo "$line" | cut -d: -f1)
      LINENUM=$(echo "$line" | cut -d: -f2)
      CONTENT=$(echo "$line" | cut -d: -f3- | sed 's/"/\\"/g')

      if [ "$FIRST" = true ]; then
        FIRST=false
      else
        printf ",\n"
      fi
      printf '    {"file": "%s", "line": %s, "content": "%s"}' "$FILE" "$LINENUM" "$CONTENT"
    done <<< "$ALL_HITS"
    echo ""
  fi

  echo "  ],"
  echo "  \"exitCode\": $([ "$HIT_COUNT" -gt 0 ] && echo 1 || echo 0)"
  echo "}"
else
  # Human-readable output
  if [ "$HIT_COUNT" -eq 0 ]; then
    echo ""
    echo "✅ No brand leaks detected (tracked + untracked files)."
    exit 0
  fi

  echo ""
  echo "🚨 Brand leak detected: $HIT_COUNT line(s) contain old brand strings."
  echo ""
  echo "────────────────────────────────────────────────────────────────"
  echo -e "$ALL_HITS"
  echo "────────────────────────────────────────────────────────────────"
  echo ""
  echo "Fix: Replace old brand strings with ARCHstudio in the files above."
  echo "     Or add an exclusion to this script if the reference is an internal"
  echo "     code identifier that cannot be renamed (see script comments)."
  echo ""
  echo "Bypass (sparingly): SKIP_BRAND_LEAK=1 git commit ..."
  exit 1
fi
