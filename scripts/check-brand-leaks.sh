#!/usr/bin/env bash
# =============================================================================
# scripts/check-brand-leaks.sh
#
# CI gate that greps the source tree for lingering old brand strings in
# USER-FACING text (UI labels, docs, messages, install scripts) and exits
# non-zero on any hit.
#
# Internal code identifiers (function names, i18n keys, MCP slugs, npm
# package names) are intentionally excluded — those can't change without
# a protocol-level breaking change and are documented here.
#
# Usage:
#   bash scripts/check-brand-leaks.sh        # check and exit non-zero on hit
#   SKIP_BRAND_LEAK=1 git commit ...        # bypass
# =============================================================================

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# ── Pattern: human-facing brand strings ────────────────────────────────────
# These should never appear in user-facing UI, docs, or messages.
PATTERN='Craft Agents|CraftAgents|craft-ai-agents'

# ── Allowlist: internal code identifiers that can't be renamed ──────────────
# Each pattern has a comment explaining why it's excluded.
ALLOW_PATTERNS=(
  # npm workspace package name (can't rename without monorepo-wide rename)
  'craft-agents-oss'
  # MCP server slug — hardcoded in protocol, tool definitions, and config
  'craft-agents-docs'
  # MCP tool name — SearchCraftAgents is a protocol-level identifier
  'SearchCraftAgents'
  # GitHub issue/PR refs (e.g., craft-agents-oss#782) in comments
  'craft-agents-oss#[0-9]'
  # i18n translation keys (menu.aboutCraftAgents etc.) — the KEY contains
  # the old brand but the VALUE is the translated user-facing string
  'menu\.(about|hide|quit)CraftAgents'
  # Feature flag function names (isCraftAgentsCliEnabled etc.)
  'isCraftAgents[Cc]li'
  # Telegram bot handle — can't rename without re-registering
  '@CraftAgentsBot'
  # package name in node_modules resolution paths
  'packages/craft-agents-commands'
  # Internal variable names in test files
  'mockCraftAgents[Cc]li'
  # deep-link protocol scheme
  'craftagents://'
  # internal config dir
  '\.craft-agent[/"]'
  # CRAFT_* env var names (CRAFT_RPC_HOST etc.)
  'CRAFT_[A-Z_]+'
  # @craft-agent/ npm scope — the workspace scope can't change without
  # renaming every internal package
  '@craft-agent/'
  # Old upstream repo URL used in comments/links (lukilabs/craft-agents-oss)
  'lukilabs/craft-agents-oss'
  # Old upstream CLI URL in docs (anthropics/craft-agents)
  'anthropics/craft-agents'
  # Repo owner org (craft-ai-agents) in issue links
  'craft-ai-agents/craft-agents-oss'
  # Internal function names (parseInternalCraftAgentsDeepLink etc.)
  'parseInternalCraftAgents'
  # craft-ai-agents org in GitHub PR links (release notes, comments)
  'craft-ai-agents/craft-agents'
)

# ── File-level exclusions: docs and tooling that contain old brand ─────────
# These files are historical records or rebranding tools that legitimately
# contain the old brand string. Checked per-file after the initial scan.
#
#   docs/git/rebrand-2026-commit-strategy.md — describes the rebrand itself
#     ("Craft Agents -> ARCHstudio"); rewriting it would misrepresent history.
#   scripts/split-commits\.sh — a fixed manifest of files staged during the
#     8-branch split, captured at the time it ran; some listed paths (e.g.
#     the old CraftAgentsLogo/Symbol icon files) were renamed by that same
#     migration, so the manifest is a historical record, not live code.
#   scripts/check-brand-leaks\.sh / tools/check-branding-leaks\.sh — these
#     files ARE the gate; they must contain the old-brand pattern string and
#     allowlist comments to work at all.
FILE_EXCLUSIONS='release-notes/|docs/brand/|docs/git/|scripts/rebrand\.ts|scripts/split-commits\.sh|scripts/check-brand-leaks\.sh|tools/check-branding-leaks\.sh'

# Build a single grep -E pattern from the allow list
ALLOW_RE=$(IFS='|'; echo "${ALLOW_PATTERNS[*]}")

# ── Scan: single-pass git grep ─────────────────────────────────────────────
HITS=$(git grep -nEI "$PATTERN" -- \
    '*.ts' '*.tsx' '*.js' '*.jsx' '*.json' '*.yml' '*.yaml' \
    '*.toml' '*.sh' '*.md' '*.css' '*.html' '*.vue' '*.svelte' \
    2>/dev/null \
  | grep -vE 'node_modules/|release/|dist/|out-tsc/|\.tmp-tools/|\.freebuff/|\.hermes/|coverage/|bun\.lock' \
  | grep -vE "^[^:]+:[^:]*:.*($ALLOW_RE)" \
  | grep -vE "($FILE_EXCLUSIONS)" \
  || true)

if [ -z "$HITS" ]; then
  echo "✅ No brand leaks detected."
  exit 0
fi

# ── Report ────────────────────────────────────────────────────────────────

COUNT=$(echo "$HITS" | wc -l | tr -d ' ')

echo ""
echo "🚨 Brand leak detected: $COUNT line(s) contain old brand strings in user-facing text."
echo ""
echo "────────────────────────────────────────────────────────────────"
echo "$HITS"
echo "────────────────────────────────────────────────────────────────"
echo ""
echo "Fix: Replace old brand strings with ARCHstudio in the files above."
echo "     Or add an exclusion to this script if the reference is an internal"
echo "     code identifier that cannot be renamed (see script comments)."
echo ""
echo "Bypass (sparingly): SKIP_BRAND_LEAK=1 git commit ..."
exit 1
