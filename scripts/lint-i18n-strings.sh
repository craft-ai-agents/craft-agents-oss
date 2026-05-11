#!/usr/bin/env bash
#
# lint-i18n-strings.sh — Hardcoded English string scan
#
# Scans .tsx files for common patterns that should use t() or i18n.t():
#   - tooltip="English text"
#   - placeholder="English text"
#   - title="English text" (in JSX props)
#   - description="English text"
#   - aria-label="English text"
#   - toast.error("English text") / success / warning / info
#   - >Multi Word Text</ (JSX text content with 2+ words)
#   - >SingleWord</ for known UI words (from SINGLE_WORD_WATCHLIST)
#
# Modes:
#   default    — scan working-tree content of all checked-in .tsx files
#   --staged   — scan staged content of .tsx files in the index (pre-commit)
#
# Ignores: comments, imports, playground/registry files, brand names.
# Exit code 0 = clean, 1 = hardcoded strings found.
#
set -euo pipefail

mode="working-tree"
if [ "${1:-}" = "--staged" ]; then
  mode="staged"
fi

# ─── Configurable lists ──────────────────────────────────────────────────────
# Single words that appear between JSX tags (e.g. <button>Retry</button>)
# and should always use t().
SINGLE_WORD_WATCHLIST=(
  Retry
  Cancel
  Save
  Delete
  Edit
  Close
  Submit
  Loading
  Preview
  Terminal
  Search
  Reset
  Remove
  Done
  Confirm
  Continue
  Rename
  Disable
  Enable
  Duplicate
  Archive
  Unarchive
)

# Brand names and technical terms that should NOT be flagged.
BRAND_NAMES="Craft|Claude|Anthropic|OpenAI|MCP|Mermaid|LaTeX|Markdown|GitHub|WebSocket|Ollama|Codex"

# Path exclusions for files that are not part of the i18n system:
# - playground/registry/.test.* — internal scaffolding, not user-facing
# - apps/marketing, apps/online-docs — English-only public sites
EXCLUDE_PATHS='playground\|registry\|\.test\.\|apps/marketing/\|apps/online-docs/'

# ─── File list ───────────────────────────────────────────────────────────────
if [ "$mode" = "staged" ]; then
  files="$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.tsx$' | grep -v "$EXCLUDE_PATHS" || true)"
  if [ -z "$files" ]; then
    exit 0
  fi

  # Quick check: do any staged diffs contain potential UI text patterns?
  # If not, skip entirely — no point scanning files with only logic/style changes.
  has_text_changes="$(git diff --cached -U0 -- $files | grep -E '^\+.*(tooltip="|placeholder="|description="|title="|aria-label="|toast\.(error|success|warning|info)\(|DropdownMenuItem|SimpleDropdownItem|<Button)' | head -1 || true)"
  if [ -z "$has_text_changes" ]; then
    exit 0
  fi
else
  # Working-tree scan — every checked-in .tsx file under source dirs.
  files="$(git ls-files '*.tsx' | grep -v "$EXCLUDE_PATHS" || true)"
  if [ -z "$files" ]; then
    exit 0
  fi
fi

# ─── Per-file scan ───────────────────────────────────────────────────────────
found=0
output=""

for file in $files; do
  if [ "$mode" = "staged" ]; then
    content="$(git show ":$file" 2>/dev/null || true)"
  else
    content="$(cat "$file" 2>/dev/null || true)"
  fi
  if [ -z "$content" ]; then
    continue
  fi

  # Shared exclusion: already localized, comments.
  #
  # `grep -n` prefixes each match with `LINENO:` — the comment regex must skip
  # past that prefix before checking for `*` or `//` (otherwise JSDoc example
  # blocks leak through, e.g. ` *   title="Foo"`).
  not_localized='t(\|i18n\.t('
  not_comment='^[0-9][0-9]*:[ \t]*\*\|^[0-9][0-9]*:[ \t]*//'

  # 1. Hardcoded string props: tooltip, placeholder, description
  matches="$(echo "$content" | grep -nE '(tooltip|placeholder|description)="[A-Z][a-z]' | grep -v "$not_localized" | grep -v 'aria-' | grep -v "$not_comment" || true)"

  # 2. Hardcoded title= (excluding component names that accept title as a slot,
  #    and brand-name page titles like title="Craft Agent")
  title_matches="$(echo "$content" | grep -nE 'title="[A-Z][a-z]' | grep -v "$not_localized" | grep -v 'aria-' | grep -v "$not_comment" | grep -v 'DialogTitle\|PanelHeader' | grep -vE "title=\"($BRAND_NAMES)( |\")" || true)"

  # 3. Hardcoded aria-label=
  aria_matches="$(echo "$content" | grep -nE 'aria-label="[A-Z][a-z]' | grep -v "$not_localized" | grep -v "$not_comment" || true)"

  # 4. Toast calls with hardcoded strings
  toast_matches="$(echo "$content" | grep -nE "toast\.(error|success|warning|info)\(['\"][A-Z]" | grep -v "$not_localized" || true)"

  # 5. Multi-word JSX text content: >Capitalized Two Words</
  jsx_text_matches="$(echo "$content" | grep -nE '>[  ]*[A-Z][a-z]+( [A-Za-z]+)+[  ]*</' | grep -v '{t(' | grep -v 't(' | grep -v "$not_comment" | grep -vE ">($BRAND_NAMES)<" || true)"

  # 6. Single-word watchlist: known UI labels that should always use t()
  watchlist_pattern="$(IFS='|'; echo "${SINGLE_WORD_WATCHLIST[*]}")"
  single_word_matches="$(echo "$content" | grep -nE ">[  ]*(${watchlist_pattern})[  ]*</" | grep -v '{t(' | grep -v 't(' | grep -v "$not_comment" || true)"

  all_matches=""
  [ -n "$matches" ] && all_matches+="$matches"$'\n'
  [ -n "$title_matches" ] && all_matches+="$title_matches"$'\n'
  [ -n "$aria_matches" ] && all_matches+="$aria_matches"$'\n'
  [ -n "$toast_matches" ] && all_matches+="$toast_matches"$'\n'
  [ -n "$jsx_text_matches" ] && all_matches+="$jsx_text_matches"$'\n'
  [ -n "$single_word_matches" ] && all_matches+="$single_word_matches"$'\n'

  if [ -n "$all_matches" ]; then
    found=1
    output+="
⚠️  $file
$(echo "$all_matches" | sed '/^$/d' | sed 's/^/    /')"
  fi
done

if [ "$found" -eq 1 ]; then
  echo ""
  if [ "$mode" = "staged" ]; then
    echo "🌐 i18n: Hardcoded English strings detected in staged files"
  else
    echo "🌐 i18n: Hardcoded English strings detected in working tree"
  fi
  echo "   These should use t() or i18n.t() for localization."
  echo "$output"
  echo ""
  echo "   Fix: Replace hardcoded strings with translation keys."
  echo "   See: packages/shared/CLAUDE.md → i18n section for guidelines."
  if [ "$mode" = "staged" ]; then
    echo "   Skip: git commit --no-verify (not recommended)"
  fi
  echo ""
  exit 1
fi
