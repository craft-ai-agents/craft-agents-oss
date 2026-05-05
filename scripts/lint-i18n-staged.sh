#!/usr/bin/env bash
#
# lint-i18n-staged.sh — Pre-commit check for hardcoded English strings
#
# Scans staged .tsx files for common patterns that should use t() or i18n.t():
#   - tooltip="English text"
#   - placeholder="English text"
#   - title="English text" (in JSX props)
#   - description="English text"
#   - aria-label="English text"
#   - toast.error("English text") / success / warning / info
#   - >Multi Word Text</ (JSX text content with 2+ words)
#   - >SingleWord</ for known UI words (from SINGLE_WORD_WATCHLIST)
#
# Ignores: comments, imports, playground/registry files, brand names.
# Exit code 0 = clean, 1 = hardcoded strings found (blocks commit).
#
set -euo pipefail

# ─── Configurable lists ──────────────────────────────────────────────────────
# Add words here as they come up. Single words that appear between JSX tags
# (e.g. <button>Retry</button>) and should always use t().
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

# Only check staged .tsx files (where i18n applies)
staged_tsx="$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.tsx$' | grep -v 'playground\|registry\|\.test\.' || true)"

if [ -z "$staged_tsx" ]; then
  exit 0
fi

# Quick check: do any staged diffs contain potential UI text patterns?
# If not, skip entirely — no point scanning files with only logic/style changes.
has_text_changes="$(git diff --cached -U0 -- $staged_tsx | grep -E '^\+.*(tooltip="|placeholder="|description="|title="|aria-label="|toast\.(error|success|warning|info)\(|DropdownMenuItem|SimpleDropdownItem|<Button)' | head -1 || true)"
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

  # Shared exclusion: already localized, comments
  not_localized='t(\|i18n\.t('
  not_comment='^ *\*\|^ *//'

  # 1. Hardcoded string props: tooltip, placeholder, description
  matches="$(echo "$staged_content" | grep -nE '(tooltip|placeholder|description)="[A-Z][a-z]' | grep -v "$not_localized" | grep -v 'aria-' | grep -v "$not_comment" || true)"

  # 2. Hardcoded title= (excluding component names that accept title as a slot)
  title_matches="$(echo "$staged_content" | grep -nE 'title="[A-Z][a-z]' | grep -v "$not_localized" | grep -v 'aria-' | grep -v "$not_comment" | grep -v 'DialogTitle\|PanelHeader' || true)"

  # 3. Hardcoded aria-label=
  aria_matches="$(echo "$staged_content" | grep -nE 'aria-label="[A-Z][a-z]' | grep -v "$not_localized" | grep -v "$not_comment" || true)"

  # 4. Toast calls with hardcoded strings
  toast_matches="$(echo "$staged_content" | grep -nE "toast\.(error|success|warning|info)\(['\"][A-Z]" | grep -v "$not_localized" || true)"

  # 5. Multi-word JSX text content: >Capitalized Two Words</
  jsx_text_matches="$(echo "$staged_content" | grep -nE '>[  ]*[A-Z][a-z]+( [A-Za-z]+)+[  ]*</' | grep -v '{t(' | grep -v 't(' | grep -v "$not_comment" | grep -vE ">($BRAND_NAMES)<" || true)"

  # 6. Single-word watchlist: known UI labels that should always use t()
  watchlist_pattern="$(IFS='|'; echo "${SINGLE_WORD_WATCHLIST[*]}")"
  single_word_matches="$(echo "$staged_content" | grep -nE ">[  ]*(${watchlist_pattern})[  ]*</" | grep -v '{t(' | grep -v 't(' | grep -v "$not_comment" || true)"

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

# ─── Locale parity check ───────────────────────────────────────────────────
# If en.json is staged, verify all other locale files have the same keys.
# This catches forgotten translations before they reach the repo.

staged_locales="$(git diff --cached --name-only --diff-filter=ACMR | grep 'i18n/locales/.*\.json' || true)"
if [ -n "$staged_locales" ]; then
  if ! sort_result="$(bun run scripts/check-locales-sorted.ts $staged_locales 2>&1)"; then
    echo ""
    echo "🌐 i18n: Locale keys are not sorted alphabetically"
    echo "$sort_result" | sed 's/^/   /'
    echo ""
    echo "   Fix: bun run sort:locales"
    echo "   Skip: git commit --no-verify (not recommended)"
    echo ""
    exit 1
  fi
fi

staged_en="$(git diff --cached --name-only --diff-filter=ACMR | grep 'i18n/locales/en.json' || true)"
if [ -n "$staged_en" ]; then
  parity_result="$(python3 <<'PY'
import glob, json, os, re, sys

ROOT = 'packages/shared/src/i18n/locales'
with open(f'{ROOT}/en.json', 'r', encoding='utf-8') as f:
    en = json.load(f)

plural_pattern = re.compile(r'_(?:zero|one|two|few|many|other)$')

def is_plural_key(key: str) -> bool:
    return bool(plural_pattern.search(key))

def plural_base(key: str) -> str:
    return plural_pattern.sub('', key)

errors = []
for f in sorted(glob.glob(f'{ROOT}/*.json')):
    lang = os.path.basename(f).replace('.json', '')
    if lang == 'en':
        continue

    with open(f, 'r', encoding='utf-8') as locale_file:
        other = json.load(locale_file)

    missing = sorted(set(en.keys()) - set(other.keys()))
    extra = []
    for key in sorted(set(other.keys()) - set(en.keys())):
        if is_plural_key(key):
            base = plural_base(key)
            if f'{base}_one' in en and f'{base}_other' in en:
                continue
        extra.append(key)

    if missing:
        errors.append(f'{lang}.json: {len(missing)} keys missing (e.g. {missing[0]})')
    if extra:
        errors.append(f'{lang}.json: {len(extra)} extra keys (e.g. {extra[0]})')

if errors:
    for error in errors:
        print(error)
    sys.exit(1)
PY
  2>&1)" || {
    echo ""
    echo "🌐 i18n: Locale parity check failed"
    echo "   en.json has keys that are missing from other locale files:"
    echo "$parity_result" | sed 's/^/   /'
    echo ""
    echo "   Fix: Invoke [skill:localize-agents] to translate missing keys."
    echo "   Skip: git commit --no-verify (not recommended)"
    echo ""
    exit 1
  }
fi
