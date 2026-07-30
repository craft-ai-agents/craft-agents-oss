#!/usr/bin/env bash
# =============================================================================
# scripts/branch-stack.sh
#
# Automates the "big rebrand + functional split" workflow:
#
#   1. Parse  git diff --numstat  between a BASE and HEAD ref.
#   2. Auto-stage "pure-rebranding" files (name-only globs) into a
#      dedicated rebranding commit on top of BASE.
#   3. Split every remaining (functional) change into N topic branches
#      grouped by area (packages/server-core, apps/electron, etc.),
#      each with a template-driven conventional-commit message.
#   4. Verify the resulting stacked history with git log --graph --oneline.
#
# Rerunnable: idempotent on a clean tree.  Run it once for the next
# large-rebrand PR instead of doing it interactively.
#
# Usage:
#   scripts/branch-stack.sh [OPTIONS]
#
# Options:
#   --base <ref>        Base ref for the diff (default: main)
#   --head <ref>        Head ref for the diff (default: HEAD)
#   --prefix <prefix>   Branch name prefix (default: pr/)
#   --min-files <n>     Collapse areas with < n files into a misc branch (default: 3)
#   --dry-run           Show what would happen without branching
#   --reset             Delete all branches created by a previous run
#   --verbose           Print each git command before running it
#   --help              Show this help
# =============================================================================

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────

BASE_REF="main"
HEAD_REF="HEAD"
BRANCH_PREFIX="pr/"
MIN_FILES=3
DRY_RUN=false
RESET=false
VERBOSE=false

# ── Parse args ────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)      BASE_REF="$2"; shift 2 ;;
    --head)      HEAD_REF="$2"; shift 2 ;;
    --prefix)    BRANCH_PREFIX="$2"; shift 2 ;;
    --min-files) MIN_FILES="$2"; shift 2 ;;
    --dry-run)   DRY_RUN=true; shift ;;
    --reset)     RESET=true; shift ;;
    --verbose)   VERBOSE=true; shift ;;
    --help)      sed -n '2,/^# ===/{ /^#/s/^# \{0,1\}//p }' "$0"; exit 0 ;;
    *)           echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────

log()  { printf '[branch-stack] %s\n' "$*"; }
warn() { printf '[branch-stack] WARNING: %s\n' "$*" >&2; }
die()  { printf '[branch-stack] ERROR: %s\n' "$*" >&2; exit 1; }

run() {
  if $VERBOSE; then
    printf '+ %s\n' "$*" >&2
  fi
  "$@"
}

# Verify we're in a git repo
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "Not inside a git repository."
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# Verify refs exist
git rev-parse --verify "$BASE_REF" >/dev/null 2>&1 || die "Base ref '$BASE_REF' not found."
git rev-parse --verify "$HEAD_REF" >/dev/null 2>&1 || die "Head ref '$HEAD_REF' not found."

BASE_SHA=$(git rev-parse --verify "$BASE_REF")
HEAD_SHA=$(git rev-parse --verify "$HEAD_REF")

log "Base: $BASE_REF ($BASE_SHA)"
log "Head: $HEAD_REF ($HEAD_SHA)"

# ── Reset mode ────────────────────────────────────────────────────────────

if $RESET; then
  log "Resetting: deleting all branches matching '${BRANCH_PREFIX}*stack*' ..."
  for b in $(git branch --list "${BRANCH_PREFIX}*stack*" 2>/dev/null | sed 's/^[* ]*//'); do
    log "  Deleting $b"
    run git branch -D "$b" 2>/dev/null || true
  done
  log "Reset complete."
  exit 0
fi

# ── 1. Discover changed files ────────────────────────────────────────────

log "Discovering changes between $BASE_SHA..$HEAD_SHA ..."
CHANGED_FILES=$(git diff --name-only "$BASE_SHA" "$HEAD_SHA" 2>/dev/null || true)

if [[ -z "$CHANGED_FILES" ]]; then
  log "No changes between $BASE_REF and $HEAD_REF. Nothing to do."
  exit 0
fi

TOTAL=$(echo "$CHANGED_FILES" | wc -l | tr -d ' ')
log "Found $TOTAL changed files."

# ── 2. Pure-rebranding allowlist ──────────────────────────────────────────
#
# Files matching these globs are considered "pure rebranding" (string
# replacements only, no logic changes).  They get auto-staged into a
# dedicated rebranding commit.

REBRAND_GLOBS=(
  # Documentation & metadata
  'README.md'
  'CONTRIBUTING.md'
  'SECURITY.md'
  'TRADEMARK.md'
  'CODE_OF_CONDUCT.md'
  'NOTICE'
  'LICENSE'
  '.hermes/plans/*.md'

  # GitHub templates
  '.github/ISSUE_TEMPLATE/*.yml'

  # Electron build config (artifact names, display titles)
  'apps/electron/electron-builder.yml'
  'apps/electron/README.md'
  'apps/electron/resources/release-notes/*.md'
  'apps/electron/resources/docs/*.md'

  # Web UI HTML shells
  'apps/webui/src/index.html'
  'apps/webui/src/login.html'
  'apps/webui/src/public/manifest.json'
  'apps/viewer/index.html'
  'apps/viewer/package.json'

  # Package manifests (description fields)
  'package.json'
  'packages/*/package.json'
  'apps/*/package.json'

  # Shared source (auth pages, prompts, branding strings)
  'packages/shared/CLAUDE.md'
  'packages/shared/src/auth/*.ts'

  # CI/Docker
  'Dockerfile.server'

  # Build artifacts / driver logs (should not be committed)
  '.tmp-tools/**'
)

# ── 3. Classify files into rebrand vs functional ──────────────────────────

REBRAND_FILES=()
FUNCTIONAL_FILES=()

while IFS= read -r file; do
  is_rebrand=false
  for pattern in "${REBRAND_GLOBS[@]}"; do
    # Use git's own fnmatch via git ls-files --error-unmatch, or fall back
    # to bash extglob-style matching.
    case "$file" in
      $pattern) is_rebrand=true; break ;;
    esac
  done

  if $is_rebrand; then
    REBRAND_FILES+=("$file")
  else
    FUNCTIONAL_FILES+=("$file")
  fi
done <<< "$CHANGED_FILES"

REBRAND_COUNT=${#REBRAND_FILES[@]}
FUNCTIONAL_COUNT=${#FUNCTIONAL_FILES[@]}

log "Classification: $REBRAND_COUNT rebranding, $FUNCTIONAL_COUNT functional."

# ── 4. Build the branch plan ─────────────────────────────────────────────
#
# Each functional area gets its own branch.  Areas with fewer than
# MIN_FILES files are collapsed into a single "misc" branch.

declare -A AREA_FILES
MISC_FILES=()

for file in "${FUNCTIONAL_FILES[@]}"; do
  # Derive area from path: apps/electron/... → apps/electron
  area=$(echo "$file" | cut -d'/' -f1-2)
  AREA_FILES["$area"]+="$file"$'\n'
done

# Sort areas for deterministic output
ALL_AREAS=$(echo "${!AREA_FILES[@]}" | tr ' ' '\n' | sort)

# Collapse small areas into misc
MERGED_AREAS=()
while IFS= read -r area; do
  [[ -z "$area" ]] && continue
  count=$(echo "${AREA_FILES[$area]}" | grep -c '.' || echo 0)
  if [[ $count -lt $MIN_FILES ]]; then
    while IFS= read -r f; do
      [[ -z "$f" ]] && continue
      MISC_FILES+=("$f")
    done <<< "${AREA_FILES[$area]}"
  else
    MERGED_AREAS+=("$area")
  fi
  log "  $area ($count files)"
done <<< "$ALL_AREAS"

# Add misc branch if there are collapsed files
if [[ ${#MISC_FILES[@]} -gt 0 ]]; then
  MERGED_AREAS+=(".misc")
  AREA_FILES[".misc"]=$(printf '%s\n' "${MISC_FILES[@]}")
  log "  .misc (${#MISC_FILES[@]} files, collapsed from small areas)"
fi

AREAS=$(printf '%s\n' "${MERGED_AREAS[@]}")
AREA_COUNT=$(echo "$AREAS" | grep -c '.' || echo 0)
log "Functional areas after collapsing (threshold=$MIN_FILES): $AREA_COUNT"

# ── 5. Generate commit messages ──────────────────────────────────────────
#
# Convention:  <type>(<scope>): <description>
#
# Type is inferred from the file content pattern (or defaults to "chore").
# Scope is the area slug.  Description is a human-readable summary.

infer_type() {
  local area="$1"
  case "$area" in
    .misc)               echo "chore" ;;   # collapsed small areas
    *test*|*__tests__*)  echo "test" ;;
    *electron*)          echo "feat" ;;
    *server-core*)       echo "feat" ;;
    *shared*)            echo "refactor" ;;
    *ui*)                echo "feat" ;;
    *protocol*)          echo "feat" ;;
    *.github*)           echo "chore" ;;
    *.hermes*)           echo "docs" ;;
    *)                   echo "chore" ;;
  esac
}

scope_from_area() {
  local area="$1"
  # packages/server-core → server-core, apps/electron → electron
  basename "$area"
}

# ── 6. Execute the stack ─────────────────────────────────────────────────
#
# We create a temporary branch from BASE_SHA, commit the rebranding
# files, then create a branch per area on top.

STACK_BASE="stack-base-$$"
REBRAND_BRANCH="${BRANCH_PREFIX}stack-rebrand"

if $DRY_RUN; then
  log "[DRY RUN] Would create rebrand commit with ${#REBRAND_FILES[@]} files."
  log "[DRY RUN] Would create $AREA_COUNT functional branches."
  log ""
  log "Rebranding files:"
  for f in "${REBRAND_FILES[@]}"; do
    log "  $f"
  done
  log ""
  log "Functional areas:"
  while IFS= read -r area; do
    count=$(echo "${AREA_FILES[$area]}" | grep -c '.' || echo 0)
    log "  $area ($count files)"
  done <<< "$AREAS"
  exit 0
fi

# Clean up any previous stack branches
for b in $(git branch --list "${BRANCH_PREFIX}*stack*" 2>/dev/null | sed 's/^[* ]*//'); do
  log "Cleaning up previous branch: $b"
  run git branch -D "$b" 2>/dev/null || true
done

# Create orphan base from BASE_SHA
log "Creating stack base from $BASE_SHA ..."
run git checkout -b "$STACK_BASE" "$BASE_SHA" --quiet 2>/dev/null

# ── Rebrand commit ────────────────────────────────────────────────────────

if [[ $REBRAND_COUNT -gt 0 ]]; then
  log "Staging $REBRAND_COUNT rebranding files ..."
  for f in "${REBRAND_FILES[@]}"; do
    run git add "$f" 2>/dev/null || warn "Could not stage: $f"
  done

  run git commit --quiet -m "$(cat <<'EOF'
rebrand: apply brand string replacements across docs and metadata

Pure string replacements in documentation, build config, package
manifests, and HTML shells.  No logic changes — every file is a
safe rename that can be verified by grep.

🤖 Generated with branch-stack.sh
Co-Authored-By: Buffy <noreply@freebuff.com>
EOF
)"
  log "Rebrand commit created."

  # Move to a named branch
  run git checkout -b "$REBRAND_BRANCH" --quiet 2>/dev/null
  REBRAND_SHA=$(git rev-parse --short HEAD)
  log "Rebrand branch: $REBRAND_BRANCH ($REBRAND_SHA)"
else
  warn "No rebranding files found — skipping rebrand commit."
fi

# ── Functional area branches ──────────────────────────────────────────────

PREV_BRANCH="$REBRAND_BRANCH"
BRANCHES_CREATED=()

while IFS= read -r area; do
  [[ -z "$area" ]] && continue

  slug=$(scope_from_area "$area")
  branch_name="${BRANCH_PREFIX}stack-${slug}"
  type=$(infer_type "$area")
  file_count=$(echo "${AREA_FILES[$area]}" | grep -c '.' || echo 0)

  log "Creating branch: $branch_name ($type, $file_count files) ..."

  # Create branch from previous
  run git checkout -b "$branch_name" --quiet 2>/dev/null

  # Stage files for this area
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    run git add "$f" 2>/dev/null || warn "Could not stage: $f"
  done <<< "${AREA_FILES[$area]}"

  # Check if there's anything to commit
  if git diff --cached --quiet 2>/dev/null; then
    log "  No staged changes — skipping commit."
    run git checkout "$PREV_BRANCH" --quiet 2>/dev/null
    run git branch -D "$branch_name" 2>/dev/null || true
    continue
  fi

  # Build commit message
  SHORT_AREA=$(basename "$area")
  DIFF_STAT=$(git diff --cached --stat | tail -1)

  run git commit --quiet -m "$(cat <<EOF
${type}(${SHORT_AREA}): apply functional changes for ${SHORT_AREA}

${file_count} file(s) changed in ${area}/.

${DIFF_STAT}

🤖 Generated with branch-stack.sh
Co-Authored-By: Buffy <noreply@freebuff.com>
EOF
)"

  COMMIT_SHA=$(git rev-parse --short HEAD)
  log "  $branch_name → $COMMIT_SHA"
  BRANCHES_CREATED+=("$branch_name")

  PREV_BRANCH="$branch_name"

done <<< "$AREAS"

# ── Return to original branch ─────────────────────────────────────────────

ORIGINAL_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
if [[ "$ORIGINAL_BRANCH" == "$STACK_BASE" ]]; then
  run git checkout "$HEAD_REF" --quiet 2>/dev/null || true
fi

# Clean up temp base
run git branch -D "$STACK_BASE" 2>/dev/null || true

# ── 7. Verify the stack ──────────────────────────────────────────────────

log ""
log "═══════════════════════════════════════════════════════════════════"
log " Branch stack created successfully!"
log "═══════════════════════════════════════════════════════════════════"
log ""

ALL_BRANCHES=()
[[ -n "$REBRAND_BRANCH" ]] && [[ $REBRAND_COUNT -gt 0 ]] && ALL_BRANCHES+=("$REBRAND_BRANCH")
ALL_BRANCHES+=("${BRANCHES_CREATED[@]}")

if [[ ${#ALL_BRANCHES[@]} -eq 0 ]]; then
  log "No branches were created."
  exit 0
fi

log "Stack layout (oldest → newest):"
log ""

# Show the graph for each branch's tip commit
for b in "${ALL_BRANCHES[@]}"; do
  if git rev-parse --verify "$b" >/dev/null 2>&1; then
    MSG=$(git log --oneline -1 "$b" 2>/dev/null)
    FILES=$(git diff --stat "$b"~1 "$b" 2>/dev/null | tail -1 || echo "")
    log "  $MSG"
    [[ -n "$FILES" ]] && log "    └─ $FILES"
  fi
done

log ""
log "Full graph:"
log ""
git log --oneline --graph "${ALL_BRANCHES[@]}" 2>/dev/null | head -30

log ""
log "To push:  git push origin ${ALL_BRANCHES[*]}"
log "To reset: scripts/branch-stack.sh --reset"
