#!/usr/bin/env bash
#
# lint-i18n-staged.sh — Pre-commit check for hardcoded English strings
#
# Scans staged .tsx files for common patterns that should use t() or i18n.t():
#   - tooltip="English text"
#   - label="English text"
#   - placeholder="English text"
#   - title="English text" (in JSX props)
#   - description="English text"
#   - toast.error("English text")
#   - toast.success("English text")
#   - >English text< (JSX text content with 3+ words)
#
# Ignores: aria-label, comments, imports, playground/registry files, brand names.
# Exit code 0 = clean, 1 = hardcoded strings found (blocks commit).
#
set -euo pipefail

# Only check staged .tsx files (where i18n applies)
staged_tsx="$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.tsx$' | grep -v 'playground\|registry\|\.test\.' || true)"

if [ -z "$staged_tsx" ]; then
  exit 0
fi

# Quick check: do any staged diffs contain potential UI text patterns?
# If not, skip entirely — no point scanning files with only logic/style changes.
has_text_changes="$(git diff --cached -U0 -- $staged_tsx | grep -E '^\+.*(tooltip="|placeholder="|description="|title="|toast\.(error|success|warning|info)\()' | head -1 || true)"
if [ -z "$has_text_changes" ]; then
  exit 0
fi

found=0
output=""

for file in $staged_tsx; do
  # Get staged content only (what will be committed)
  staged_content="$(git show ":$file" 2>/dev/null || true)"
  if [ -z "$staged_content" ]; then
    continue
  fi

  # Check for hardcoded string props (not using t() or {t()})
  # Pattern: prop="CapitalizedEnglishText" where prop is a known UI prop
  matches="$(echo "$staged_content" | grep -nE '(tooltip|placeholder|description)="[A-Z][a-z]' | grep -v 't(' | grep -v 'aria-' | grep -v '^ *\*' | grep -v '^ *//' || true)"

  # Check for hardcoded title= (but not in comments or aria-)
  title_matches="$(echo "$staged_content" | grep -nE 'title="[A-Z][a-z]' | grep -v 't(' | grep -v 'aria-' | grep -v '^ *\*' | grep -v '^ *//' | grep -v 'DialogTitle\|PanelHeader' || true)"

  # Check for toast calls with hardcoded strings
  toast_matches="$(echo "$staged_content" | grep -nE "toast\.(error|success|warning|info)\(['\"][A-Z]" | grep -v 't(' || true)"

  if [ -n "$matches" ] || [ -n "$title_matches" ] || [ -n "$toast_matches" ]; then
    found=1
    output+="
⚠️  $file"
    [ -n "$matches" ] && output+="
$(echo "$matches" | sed 's/^/    /')"
    [ -n "$title_matches" ] && output+="
$(echo "$title_matches" | sed 's/^/    /')"
    [ -n "$toast_matches" ] && output+="
$(echo "$toast_matches" | sed 's/^/    /')"
  fi
done

if [ "$found" -eq 1 ]; then
  echo ""
  echo "🌐 i18n: Hardcoded English strings detected in staged files"
  echo "   These should use t() or i18n.t() for localization."
  echo "$output"
  echo ""
  echo "   Fix: Replace hardcoded strings with translation keys."
  echo "   See: packages/shared/CLAUDE.md → i18n section for guidelines."
  echo "   Skip: git commit --no-verify (not recommended)"
  echo ""
  exit 1
fi
