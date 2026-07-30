#!/usr/bin/env bash
# =============================================================================
# scripts/check-rebrand-commit.sh
#
# Pre-commit gate that enforces the two-commit discipline for rebranding:
# pure rebranding commits and functional commits must never be mixed.
#
# How it works:
#   1. Reads the commit message trailer (Rebrand-Only: true/false)
#   2. Classifies each staged file as REBRAND or FUNCTIONAL
#   3. Enforces discipline based on the trailer:
#      - If trailer IS present: only rebranding files allowed (functional → refuse)
#      - If trailer is NOT present: mixed staging → refuse
#
# The classification uses:
#   - REBRAND_GLOBS: files that are ALWAYS pure rebranding (docs, config, templates)
#   - ≤4-line heuristic: files with ≤4 total changed lines are likely pure rebranding
#   - KNOWN_FUNCTIONAL: files that are always classified as functional
#
# Commit trailer convention:
#   Add 'Rebrand-Only: true' to the commit message footer to signal a
#   pure rebranding commit. The hook enforces that ONLY rebranding files
#   are staged when this trailer is present.
#
# Example:
#   chore(rebrand): ARCHstudio branding update
#
#   Rebrand-Only: true
#
# Escape hatch: SKIP_REBRAND_CHECK=1|true|yes|on git commit ...
# =============================================================================
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# ── Rebrand-only glob patterns ────────────────────────────────────────────
# Files matching these patterns are ALWAYS classified as pure rebranding.
REBRAND_GLOBS=(
  'README.md'
  'CONTRIBUTING.md'
  'SECURITY.md'
  'TRADEMARK.md'
  'CODE_OF_CONDUCT.md'
  'NOTICE'
  'LICENSE'
  '.hermes/plans/*.md'
  '.github/ISSUE_TEMPLATE/*.yml'
  'apps/electron/electron-builder.yml'
  'apps/electron/README.md'
  'apps/electron/resources/release-notes/*.md'
  'apps/electron/resources/docs/*.md'
  'apps/webui/src/index.html'
  'apps/webui/src/login.html'
  'apps/webui/src/public/manifest.json'
  'apps/viewer/index.html'
  'apps/viewer/package.json'
  'packages/shared/CLAUDE.md'
  'packages/shared/src/auth/*.ts'
)

# ── Files that are ALWAYS functional (even if small) ──────────────────────
# These files typically contain both rebranding AND functional changes
# that cannot be cleanly separated into separate commits.
#
# Classification rationale (audited against actual git diffs):
#   Dockerfile.server — ~80% functional (multi-stage build refactor)
#     with ~20% rebranding embedded inside functional hunks (user names,
#     labels, comments). The rebranding is inside COPY/from directives
#     and RUN commands that are inherently functional.
#   LayoutShell.tsx/css — functional rail/UI changes + rebranding
#   branding.ts — central source of truth (functional by definition)
#   package.json — dependency changes + description rebranding
#   install-app.sh — pgrep/pkill logic + brand name strings
#
# NOTE: When starting a new rebranding session, update this list by
# running: git diff --numstat <ref> | awk '$1 > 4 || $2 > 4 {print $3}'
# and cross-referencing with files that touch both brand strings and logic.
KNOWN_FUNCTIONAL=(
  'apps/electron/src/renderer/shell/LayoutShell.tsx'
  'apps/electron/src/renderer/shell/LayoutShell.css'
  'apps/electron/src/shared/__tests__/ipc-channels.test.ts'
  'apps/electron/src/main/__tests__/_mock-coverage.ts'
  'apps/electron/scripts/build-dmg.sh'
  'apps/electron/scripts/build-linux.sh'
  'scripts/install-app.sh'
  'packages/server-core/src/sessions/SessionManager.ts'
  'packages/server-core/src/handlers/rpc/sessions.ts'
  'packages/shared/src/branding.ts'
  'packages/shared/src/feature-flags.ts'
  'package.json'
  'apps/electron/package.json'
  '.github/workflows/validate.yml'
  'Dockerfile.server'
  'bunfig.toml'
)

MAX_CHANGED_LINES=4

# ── Helpers ────────────────────────────────────────────────────────────────

is_known_functional() {
  local file="$1"
  for f in "${KNOWN_FUNCTIONAL[@]}"; do
    [ "$file" = "$f" ] && return 0
  done
  return 1
}

matches_rebrand_glob() {
  local file="$1"
  for pattern in "${REBRAND_GLOBS[@]}"; do
    case "$file" in $pattern) return 0 ;; esac
  done
  return 1
}

count_changed_lines() {
  local added="$1"
  local deleted="$2"
  if [[ ! "$added" =~ ^[0-9]+$ ]] || [[ ! "$deleted" =~ ^[0-9]+$ ]]; then
    echo "999999"
  else
    echo $(( added + deleted ))
  fi
}

# ── Get staged files ──────────────────────────────────────────────────────

STAGED_FILES=$(git diff --cached --name-only 2>/dev/null || true)

if [ -z "$STAGED_FILES" ]; then
  echo "✅ No staged files — skipping rebrand-commit check."
  exit 0
fi

TOTAL_STAGED=$(echo "$STAGED_FILES" | wc -l | tr -d ' ')

# ── Classify each staged file ─────────────────────────────────────────────

REBRAND_FILES=()
FUNCTIONAL_FILES=()

while IFS= read -r file; do
  [ -z "$file" ] && continue

  # Get numstat for this file
  NUMSTAT=$(git diff --cached --numstat -- "$file" 2>/dev/null | head -1)
  ADDED=$(echo "$NUMSTAT" | awk '{print $1}')
  DELETED=$(echo "$NUMSTAT" | awk '{print $2}')

  TOTAL_CHANGED=$(count_changed_lines "$ADDED" "$DELETED")

  if is_known_functional "$file"; then
    FUNCTIONAL_FILES+=("$file")
  elif matches_rebrand_glob "$file"; then
    REBRAND_FILES+=("$file")
  elif [ "$TOTAL_CHANGED" -le "$MAX_CHANGED_LINES" ]; then
    REBRAND_FILES+=("$file")
  else
    FUNCTIONAL_FILES+=("$file")
  fi
done <<< "$STAGED_FILES"

REBRAND_COUNT=${#REBRAND_FILES[@]}
FUNCTIONAL_COUNT=${#FUNCTIONAL_FILES[@]}

# ── Read commit message trailer ────────────────────────────────────────────
# Check for 'Rebrand-Only: true' in the commit message. This trailer
# signals that the commit is a pure rebranding commit, and only
# rebranding files should be staged.

COMMIT_MSG=""
if [ -f ".git/COMMIT_EDITMSG" ]; then
  COMMIT_MSG=$(cat ".git/COMMIT_EDITMSG" 2>/dev/null || true)
fi

HAS_REBRAND_TRAILER=false
if echo "$COMMIT_MSG" | grep -qE '^Rebrand-Only:\s*(true|yes|1)' 2>/dev/null; then
  HAS_REBRAND_TRAILER=true
fi

# ── Decision ──────────────────────────────────────────────────────────────

if [ "$REBRAND_COUNT" -gt 0 ] && [ "$FUNCTIONAL_COUNT" -gt 0 ]; then
  if [ "$HAS_REBRAND_TRAILER" = true ]; then
    # Trailer says rebrand-only, but functional files are staged — refuse
    echo ""
    echo "🚫 REBRAND COMMIT DISCIPLINE VIOLATION"
    echo "────────────────────────────────────────────────────────────────"
    echo ""
    echo "Your commit message has 'Rebrand-Only: true', but you also have"
    echo "functional files staged. A rebrand-only commit must contain ONLY"
    echo "rebranding changes — no functional code, tests, or scripts."
    echo ""
    echo "📋 Staged rebranding files ($REBRAND_COUNT):"
    for f in "${REBRAND_FILES[@]}"; do
      echo "   🟢 $f"
    done
    echo ""
    echo "📋 Staged functional files ($FUNCTIONAL_COUNT):"
    for f in "${FUNCTIONAL_FILES[@]}"; do
      echo "   ⚪ $f"
    done
    echo ""
    echo "────────────────────────────────────────────────────────────────"
    echo ""
    echo "💡 To fix this:"
    echo ""
    echo "   Option A: Separate into two commits"
    echo "     1. Unstage everything: git reset HEAD"
    echo "     2. Stage rebranding only: git add <rebranding files>"
    echo "     3. Commit rebranding: git commit -m 'chore(rebrand): ...\n\nRebrand-Only: true'"
    echo "     4. Stage functional: git add <functional files>"
    echo "     5. Commit functional: git commit -m '<feat|fix|chore>(scope): description>'"
    echo ""
    echo "   Option B: Use the automated extraction tool"
    echo "     bun run rebrand:extract -- --since HEAD~1"
    echo "     git commit -m 'chore(rebrand): ...\n\nRebrand-Only: true'"
    echo "     git add -p <mixed files>  # stage only functional hunks"
    echo "     git commit -m '<type>(scope): description>'"
    echo ""
    echo "   Option C: Bypass (sparingly)"
    echo "     SKIP_REBRAND_CHECK=1 git commit ..."
    echo ""
    exit 1
  else
    # No trailer — mixed staging refused
    echo ""
    echo "🚫 REBRAND COMMIT DISCIPLINE VIOLATION"
    echo "────────────────────────────────────────────────────────────────"
    echo ""
    echo "You have BOTH rebranding AND functional changes staged in the same commit."
    echo "These must be committed separately to maintain clean git history."
    echo ""
    echo "📋 Staged rebranding files ($REBRAND_COUNT):"
    for f in "${REBRAND_FILES[@]}"; do
      echo "   🟢 $f"
    done
    echo ""
    echo "📋 Staged functional files ($FUNCTIONAL_COUNT):"
    for f in "${FUNCTIONAL_FILES[@]}"; do
      echo "   ⚪ $f"
    done
    echo ""
    echo "────────────────────────────────────────────────────────────────"
    echo ""
    echo "💡 To fix this:"
    echo ""
    echo "   Option A: Separate into two commits"
    echo "     1. Unstage everything: git reset HEAD"
    echo "     2. Stage rebranding only: git add <rebranding files>"
    echo "     3. Commit rebranding: git commit -m 'chore(rebrand): ...\n\nRebrand-Only: true'"
    echo "     4. Stage functional: git add <functional files>"
    echo "     5. Commit functional: git commit -m '<feat|fix|chore>(scope): description>'"
    echo ""
    echo "   Option B: Use the automated extraction tool"
    echo "     bun run rebrand:extract -- --since HEAD~1"
    echo "     git commit -m 'chore(rebrand): ...\n\nRebrand-Only: true'"
    echo "     git add -p <mixed files>  # stage only functional hunks"
    echo "     git commit -m '<type>(scope): description>'"
    echo ""
    echo "   Option C: Bypass (sparingly)"
    echo "     SKIP_REBRAND_CHECK=1 git commit ..."
    echo ""
    exit 1
  fi
fi

if [ "$HAS_REBRAND_TRAILER" = true ]; then
  # Trailer present — must have rebranding files
  if [ "$REBRAND_COUNT" -eq 0 ]; then
    echo ""
    echo "🚫 REBRAND COMMIT DISCIPLINE VIOLATION"
    echo "────────────────────────────────────────────────────────────────"
    echo ""
    echo "Your commit message has 'Rebrand-Only: true', but no rebranding"
    echo "files are staged. A rebrand-only commit must contain at least one"
    echo "rebranding file."
    echo ""
    echo "💡 To fix this:"
    echo ""
    echo "   Option A: Add rebranding files"
    echo "     git add <rebranding files>"
    echo ""
    echo "   Option B: Remove 'Rebrand-Only: true' from the commit message"
    echo "     (if this is actually a functional commit)"
    echo ""
    echo "   Option C: Bypass (sparingly)"
    echo "     SKIP_REBRAND_CHECK=1 git commit ..."
    echo ""
    exit 1
  else
    echo "✅ Pure rebranding commit detected ($REBRAND_COUNT files, trailer present). OK to commit."
  fi
else
  # No trailer — allow pure rebranding or pure functional
  if [ "$REBRAND_COUNT" -gt 0 ]; then
    echo "✅ Pure rebranding commit detected ($REBRAND_COUNT files). OK to commit."
  elif [ "$FUNCTIONAL_COUNT" -gt 0 ]; then
    echo "✅ Functional commit detected ($FUNCTIONAL_COUNT files). OK to commit."
  else
    echo "✅ No files to classify. OK to commit."
  fi
fi

exit 0
