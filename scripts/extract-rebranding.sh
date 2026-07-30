#!/usr/bin/env bash
# =============================================================================
# scripts/extract-rebranding.sh
#
# Automates the staged-set recipe for rebranding changes. Takes a --since <ref>
# argument, runs git diff --numstat, applies the ≤4-line heuristic + the
# known-mixed allowlist from this session, and stages the result.
#
# Supports three modes:
#   1. Direct staging (default): stages rebranding files automatically
#   2. Patch mode (--patch): writes a .patch file for review via git apply
#   3. Verify mode (--verify): checks an existing patch applies cleanly
#
# Future brand changes become: bash scripts/extract-rebranding.sh --since HEAD~1
# or: bun run rebrand:extract -- --since HEAD~1
#
# Usage:
#   bash scripts/extract-rebranding.sh --since <ref>              # stage directly
#   bash scripts/extract-rebranding.sh --since <ref> --patch      # write patch file
#   bash scripts/extract-rebranding.sh --since <ref> --dry-run    # show classification
#   bash scripts/extract-rebranding.sh --verify <patch-file>      # verify a patch
#
# NOTE: When using bun run, the '--' separator is required before arguments
# because bun's script runner consumes positional args otherwise.
# =============================================================================

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# ── Defaults ──────────────────────────────────────────────────────────────

SINCE=""
DRY_RUN=false
VERBOSE=false
PATCH_MODE=false
VERIFY_MODE=false
VERIFY_FILE=""
PATCH_FILE=""
MAX_CHANGED_LINES=4  # Files with ≤ this many total changed lines are likely pure rebranding

# ── Parse arguments ──────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--help)
      cat << 'EOF'
Usage: extract-rebranding.sh [--since] <ref> [OPTIONS]

Automates extraction of pure-rebranding changes from a git diff.

Options:
  --since <ref>      Git ref to diff against (e.g., HEAD~1, main, v1.0.0)
  --dry-run          Show what would be staged without actually staging
  --patch            Write rebranding changes to a .patch file (not staged)
  --patch-file <path>  Write patch to a specific file (default: .rebranding.patch)
  --verify <file>    Verify an existing patch can be applied cleanly
  --verbose          Print detailed classification for each file
  --max-lines <n>    Files with ≤ n total changed lines are auto-classified
                     as pure rebranding (default: 4)
  -h, --help         Show this help

Examples:
  bash scripts/extract-rebranding.sh HEAD~1                   # stage directly
  bash scripts/extract-rebranding.sh --since HEAD~1 --patch   # write patch file
  bash scripts/extract-rebranding.sh --verify .rebranding.patch  # verify patch
  bun run rebrand:extract -- --since HEAD~1
EOF
      exit 0
      ;;
    --since)       SINCE="$2"; shift 2 ;;
    --dry-run)     DRY_RUN=true; shift ;;
    --patch)       PATCH_MODE=true; shift ;;
    --patch-file)  PATCH_FILE="$2"; shift 2 ;;
    --verify)      VERIFY_MODE=true; VERIFY_FILE="$2"; shift 2 ;;
    --verbose)     VERBOSE=true; shift ;;
    --max-lines)   MAX_CHANGED_LINES="$2"; shift 2 ;;
    -*)            # Unknown flag
      echo "Unknown option: $1"
      echo "Run with --help for usage"
      exit 1
      ;;
    *)             # Bare ref as first positional arg (e.g., HEAD~1)
      if [ -z "$SINCE" ]; then
        SINCE="$1"
        shift
      else
        echo "Unexpected argument: $1"
        echo "Run with --help for usage"
        exit 1
      fi
      ;;
  esac
done

# ── Handle --verify mode (early exit) ───────────────────────────────────

if [ "$VERIFY_MODE" = true ]; then
  if [ -z "$VERIFY_FILE" ]; then
    echo "Error: --verify requires a patch file path"
    echo "Usage: extract-rebranding.sh --verify <patch-file>"
    exit 1
  fi

  if [ ! -f "$VERIFY_FILE" ]; then
    echo "Error: patch file not found: $VERIFY_FILE"
    exit 1
  fi

  echo "🔍 Verifying patch file: $VERIFY_FILE"
  echo ""

  if git apply --check --verbose "$VERIFY_FILE" 2>&1; then
    echo ""
    echo "✅ Patch can be applied cleanly"
    echo ""
    echo "📊 Patch stats:"
    diffstat "$VERIFY_FILE" 2>/dev/null || echo "  (diffstat not available)"
    echo ""
    echo "💡 To apply: git apply $VERIFY_FILE"
    exit 0
  else
    echo ""
    echo "❌ Patch cannot be applied cleanly"
    echo ""
    echo "Possible reasons:"
    echo "  - The working tree has conflicting changes"
    echo "  - The patch was generated against a different base"
    echo "  - The patch file is corrupted"
    echo ""
    echo "💡 To fix:"
    echo "  1. Ensure working tree is clean: git status"
    echo "  2. Re-generate the patch: bash scripts/extract-rebranding.sh --since <ref> --patch"
    exit 1
  fi
fi

# ── Require --since for non-verify mode ──────────────────────────────────

if [ -z "$SINCE" ]; then
  echo "Error: a git ref is required (e.g., HEAD~1, main, v1.0.0)"
  echo "Usage: extract-rebranding.sh [--since] <ref> [OPTIONS]"
  echo "Run with --help for full usage"
  exit 1
fi

# ── Known-mixed files ────────────────────────────────────────────────────
# Files that contain BOTH rebranding AND functional changes.
# These are excluded from auto-staging because they need manual hunk selection.
#
# IMPORTANT: This list is session-specific. When starting a new rebranding
# session, update this list by running:
#   git diff --numstat <ref> | awk '$1 > 4 || $2 > 4 {print $3}' | sort
# and cross-referencing with files that touch both brand strings and logic.
KNOWN_MIXED=(
  # Electron shell (functional rail changes + rebranding)
  "apps/electron/src/renderer/shell/LayoutShell.tsx"
  "apps/electron/src/renderer/shell/LayoutShell.css"
  # IPC channels (snapshot changes + new channels)
  "apps/electron/src/shared/__tests__/ipc-channels.test.ts"
  # Test infra (mock-coverage + rebranding)
  "apps/electron/src/main/__tests__/_mock-coverage.ts"
  # Build scripts (functional changes + rebranding)
  "apps/electron/scripts/build-dmg.sh"
  "apps/electron/scripts/build-linux.sh"
  # Install script (functional changes + rebranding)
  "scripts/install-app.sh"
  # Server core (functional changes + rebranding)
  "packages/server-core/src/sessions/SessionManager.ts"
  "packages/server-core/src/handlers/rpc/sessions.ts"
  # Shared packages (functional changes + rebranding)
  "packages/shared/src/branding.ts"
  "packages/shared/src/feature-flags.ts"
  # Package manifests (dependency changes + rebranding)
  "package.json"
  "apps/electron/package.json"
  # CI workflows (functional changes + rebranding)
  ".github/workflows/validate.yml"
  "Dockerfile.server"
  # Bunfig (functional changes + rebranding)
  "bunfig.toml"
)

# ── Rebrand-only glob patterns (from branch-stack.sh) ────────────────────
# Files matching these patterns are ALWAYS pure rebranding, regardless of
# line count. They contain only display strings, metadata, and documentation.

REBRAND_GLOBS=(
  # Documentation & metadata
  "README.md"
  "CONTRIBUTING.md"
  "SECURITY.md"
  "TRADEMARK.md"
  "CODE_OF_CONDUCT.md"
  "NOTICE"
  "LICENSE"
  ".hermes/plans/*.md"

  # GitHub templates
  ".github/ISSUE_TEMPLATE/*.yml"

  # Electron build config (artifact names, display titles)
  "apps/electron/electron-builder.yml"
  "apps/electron/README.md"
  "apps/electron/resources/release-notes/*.md"
  "apps/electron/resources/docs/*.md"

  # Web UI HTML shells
  "apps/webui/src/index.html"
  "apps/webui/src/login.html"
  "apps/webui/src/public/manifest.json"
  "apps/viewer/index.html"
  "apps/viewer/package.json"

  # Package manifests (description fields only)
  "packages/shared/CLAUDE.md"
  "packages/shared/src/auth/*.ts"

  # CI/Docker
  ".dockerignore"
  ".gitattributes"
  ".gitignore"
)

# ── Helper: check if a file is in the known-mixed list ───────────────────

is_known_mixed() {
  local file="$1"
  for mixed in "${KNOWN_MIXED[@]}"; do
    if [ "$file" = "$mixed" ]; then
      return 0
    fi
  done
  return 1
}

# ── Helper: check if a file matches a rebrand glob ────────────────────────

matches_rebrand_glob() {
  local file="$1"
  for pattern in "${REBRAND_GLOBS[@]}"; do
    # Use bash pattern matching (fnmatch)
    case "$file" in
      $pattern) return 0 ;;
    esac
  done
  return 1
}

# ── Helper: count total changed lines for a file ──────────────────────────

count_changed_lines() {
  local added="$1"
  local deleted="$2"
  # Handle binary files (shown as - in numstat) and submodules
  if [[ ! "$added" =~ ^[0-9]+$ ]] || [[ ! "$deleted" =~ ^[0-9]+$ ]]; then
    echo "999999"  # Binary files / submodules are never pure rebranding
  else
    echo $(( added + deleted ))
  fi
}

# ── Step 1: Get the list of changed files ─────────────────────────────────

echo "🔍 Scanning changes since $SINCE..."

CHANGED_FILES=$(git diff --numstat "$SINCE" --name-only 2>/dev/null || true)

if [ -z "$CHANGED_FILES" ]; then
  echo "✅ No changes found since $SINCE"
  exit 0
fi

TOTAL_FILES=$(echo "$CHANGED_FILES" | wc -l | tr -d ' ')
echo "📊 Found $TOTAL_FILES changed files"

# ── Step 2: Classify each file ────────────────────────────────────────────

REBRAND_FILES=()
MIXED_FILES=()
FUNCTIONAL_FILES=()

while IFS= read -r file; do
  [ -z "$file" ] && continue

  # Get numstat for this file
  NUMSTAT=$(git diff --numstat "$SINCE" -- "$file" 2>/dev/null | head -1)
  ADDED=$(echo "$NUMSTAT" | awk '{print $1}')
  DELETED=$(echo "$NUMSTAT" | awk '{print $2}')

  TOTAL_CHANGED=$(count_changed_lines "$ADDED" "$DELETED")

  # Classification logic:
  # 1. If it's in the known-mixed list → MIXED (needs manual hunk selection)
  # 2. If it matches a rebrand glob → REBRAND (auto-stage)
  # 3. If total changed lines ≤ MAX_CHANGED_LINES → REBRAND (heuristic)
  # 4. Otherwise → FUNCTIONAL (skip)

  if is_known_mixed "$file"; then
    MIXED_FILES+=("$file")
    [ "$VERBOSE" = true ] && echo "  MIXED (known): $file (+$ADDED -$DELETED)"
  elif matches_rebrand_glob "$file"; then
    REBRAND_FILES+=("$file")
    [ "$VERBOSE" = true ] && echo "  REBRAND (glob): $file (+$ADDED -$DELETED)"
  elif [ "$TOTAL_CHANGED" -le "$MAX_CHANGED_LINES" ]; then
    REBRAND_FILES+=("$file")
    [ "$VERBOSE" = true ] && echo "  REBRAND (≤${MAX_CHANGED_LINES} lines): $file (+$ADDED -$DELETED)"
  else
    FUNCTIONAL_FILES+=("$file")
    [ "$VERBOSE" = true ] && echo "  FUNCTIONAL: $file (+$ADDED -$DELETED)"
  fi
done <<< "$CHANGED_FILES"

# ── Step 3: Report ────────────────────────────────────────────────────────

REBRAND_COUNT=${#REBRAND_FILES[@]}
MIXED_COUNT=${#MIXED_FILES[@]}
FUNCTIONAL_COUNT=${#FUNCTIONAL_FILES[@]}

echo ""
echo "📋 Classification summary:"
echo "   🟢 Pure rebranding:  $REBRAND_COUNT files"
echo "   🟡 Mixed (manual):   $MIXED_COUNT files"
echo "   ⚪ Functional:       $FUNCTIONAL_COUNT files"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo "🏜️  Dry run — no files will be staged or patched"
  echo ""
fi

# ── Step 4a: Patch mode — write .patch file ──────────────────────────────

if [ "$PATCH_MODE" = true ]; then
  # Default patch file path
  if [ -z "$PATCH_FILE" ]; then
    PATCH_FILE=".rebranding.patch"
  fi

  if [ "$REBRAND_COUNT" -eq 0 ]; then
    echo "ℹ️  No pure rebranding files found — no patch generated"
    exit 0
  fi

  echo "📝 Generating patch file: $PATCH_FILE"

  # Clear any existing patch file
  > "$PATCH_FILE"

  # Generate unified diff for each rebranding file
  for file in "${REBRAND_FILES[@]}"; do
    [ "$DRY_RUN" = true ] && echo "  [dry-run] Would generate patch for: $file"
    [ "$DRY_RUN" = false ] && git diff "$SINCE" -- "$file" >> "$PATCH_FILE"
  done

  if [ "$DRY_RUN" = false ]; then
    echo "✅ Patch written: $PATCH_FILE ($(wc -l < "$PATCH_FILE") lines)"
    echo ""

    # Verify the patch can be applied
    echo "🔍 Verifying patch applies cleanly..."
    if git apply --check --verbose "$PATCH_FILE" 2>&1; then
      echo ""
      echo "✅ Patch verified — can be applied cleanly"
    else
      echo ""
      echo "⚠️  Warning: patch may not apply cleanly to current working tree"
      echo "   This is expected if working tree has uncommitted changes"
    fi

    echo ""
    echo "📊 Patch stats:"
    diffstat "$PATCH_FILE" 2>/dev/null || echo "  $(grep '^diff --git' "$PATCH_FILE" | wc -l | tr -d ' ') files changed"
    echo ""
    echo "💡 Next steps:"
    echo "   1. Review the patch: cat $PATCH_FILE"
    echo "   2. Apply it: git apply $PATCH_FILE"
    echo "   3. Commit: git commit -m 'chore(rebrand): ARCHstudio branding update'"
    echo ""
    echo "   Or verify later: bash scripts/extract-rebranding.sh --verify $PATCH_FILE"
  fi

  exit 0
fi

# ── Step 4b: Direct staging mode ──────────────────────────────────────────

if [ "$REBRAND_COUNT" -gt 0 ]; then
  echo "📦 Staging $REBRAND_COUNT rebranding files..."

  for file in "${REBRAND_FILES[@]}"; do
    if [ "$DRY_RUN" = true ]; then
      echo "  [dry-run] git add $file"
    else
      git add "$file"
      [ "$VERBOSE" = true ] && echo "  ✅ Staged: $file"
    fi
  done

  echo ""
fi

# ── Step 5: Summary ───────────────────────────────────────────────────────

if [ "$DRY_RUN" = true ]; then
  echo "🏜️  Dry run complete — no files were staged"
  echo ""
  echo "💡 To actually stage these files, run without --dry-run:"
  echo "   bash scripts/extract-rebranding.sh --since $SINCE"
else
  if [ "$REBRAND_COUNT" -gt 0 ]; then
    echo "✅ Staged $REBRAND_COUNT rebranding files"
    echo ""
    echo "📦 Staged files:"
    git diff --cached --name-only | head -20
    if [ "$(git diff --cached --name-only | wc -l | tr -d ' ')" -gt 20 ]; then
      echo "   ... and more"
    fi
  else
    echo "ℹ️  No pure rebranding files found to stage"
  fi
fi

# ── Step 6: Advise on mixed files ─────────────────────────────────────────

if [ "$MIXED_COUNT" -gt 0 ]; then
  echo ""
  echo "⚠️  $MIXED_COUNT mixed files need manual hunk selection:"
  for file in "${MIXED_FILES[@]}"; do
    echo "   - $file"
  done
  echo ""
  echo "💡 Use 'git add -p' to stage only rebranding hunks in these files:"
  for file in "${MIXED_FILES[@]}"; do
    echo "   git add -p $file"
  done
fi

# ── Step 7: Advise on functional files ────────────────────────────────────

if [ "$FUNCTIONAL_COUNT" -gt 0 ]; then
  echo ""
  echo "ℹ️  $FUNCTIONAL_COUNT functional files were not staged (as expected)"
  if [ "$VERBOSE" = true ]; then
    echo "   These files contain non-rebranding changes:"
    for file in "${FUNCTIONAL_FILES[@]}"; do
      echo "   - $file"
    done
  fi
fi

echo ""
echo "🎯 Next steps:"
echo "   1. Review staged changes: git diff --cached --stat"
echo "   2. Commit rebranding: git commit -m 'chore(rebrand): ARCHstudio branding update'"
echo "   3. Stage mixed files manually: git add -p <file>"
echo "   4. Commit functional changes separately"
