#!/usr/bin/env bash
#
# lint-i18n-staged.sh — Pre-commit i18n gates
#
# Composes the staged-content checks into one fail-fast pipeline:
#   1. Hardcoded-string scan (delegated to lint-i18n-strings.sh --staged)
#   2. Locale alphabetical-sort check (only if a locale file is staged)
#   3. en.json ↔ other-locales parity (only if en.json is staged)
#   4. Code-key coverage check (only if any source/locale file is staged)
#
# The scans here all read STAGED content via `git show :$file` so they reflect
# what will be committed, not what's in the working tree.
#
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"

# ─── 1. Hardcoded English strings ────────────────────────────────────────────
bash "$SCRIPT_DIR/lint-i18n-strings.sh" --staged

# ─── 2. Locale parity check ──────────────────────────────────────────────────
# If any locale file is staged, verify all locale files are sorted.
staged_locales="$(git diff --cached --name-only --diff-filter=ACMR | grep 'i18n/locales/.*\.json' || true)"
if [ -n "$staged_locales" ]; then
  if ! sort_result="$(bun run lint:i18n:sorted 2>&1)"; then
    echo ""
    echo "🌐 i18n: Locale keys are not sorted alphabetically"
    echo "$sort_result" | sed 's/^/   /'
    echo ""
    echo "   Fix: bun run sort-locales"
    echo "   Skip: git commit --no-verify (not recommended)"
    echo ""
    exit 1
  fi
fi

# ─── 3. en.json ↔ other-locales parity ────────────────────────────────────────
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

# ─── 4. Code-key coverage check ───────────────────────────────────────────────
# Catches:
#  - new t('...') references to keys that don't exist in en.json
#  - locale edits that drop keys still referenced from source code (this is
#    the failure mode the parity check above cannot detect — when all locales
#    lose the same keys symmetrically, parity passes but the UI breaks).
staged_for_coverage="$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(ts|tsx)$|i18n/locales/.*\.json' || true)"
if [ -n "$staged_for_coverage" ]; then
  if ! coverage_result="$(bun run lint:i18n:coverage 2>&1)"; then
    echo ""
    echo "🌐 i18n: Code-key coverage check failed"
    echo "$coverage_result" | sed 's/^/   /'
    echo ""
    echo "   Skip: git commit --no-verify (not recommended)"
    echo ""
    exit 1
  fi
fi
