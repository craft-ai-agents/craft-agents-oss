#!/bin/bash
set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ALLOW_LIST="$SCRIPT_DIR/oss-allow-list.txt"
DEFAULT_TARGET="git@github.com:lukilabs/craft-agents-oss.git"
TEMP_DIR=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
TARGET_REPO="$DEFAULT_TARGET"
DRY_RUN=false
BRANCH="main"
AUTO_CONFIRM=false
SKIP_CONTRIBUTION_CHECK=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --target)
      TARGET_REPO="$2"
      shift 2
      ;;
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --yes|-y)
      AUTO_CONFIRM=true
      shift
      ;;
    --force)
      SKIP_CONTRIBUTION_CHECK=true
      shift
      ;;
    --help)
      echo "Usage: $0 [--target <repo-url>] [--branch <branch>] [--dry-run] [--yes] [--force]"
      echo ""
      echo "Options:"
      echo "  --target <url>   Target repository URL (default: $DEFAULT_TARGET)"
      echo "  --branch <name>  Target branch (default: main)"
      echo "  --dry-run        Show what would be synced without pushing"
      echo "  --yes, -y        Auto-confirm push (for CI)"
      echo "  --force          Skip unmerged contribution check (use with caution)"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Cleanup function
cleanup() {
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf "$TEMP_DIR"
  fi
}
trap cleanup EXIT

# Check for unmerged OSS contributions
# Returns 0 if no contributions found, 1 if contributions need to be merged
check_oss_contributions() {
  local oss_dir="$1"

  cd "$oss_dir"

  # Find commits that are NOT sync commits (external contributions)
  # Sync commits have "Sync from internal repository" in the message
  local contribution_commits
  contribution_commits=$(git log --oneline --all --invert-grep --grep="Sync from internal repository" --grep="Initial commit" 2>/dev/null | head -20)

  if [[ -n "$contribution_commits" ]]; then
    echo ""
    echo -e "${RED}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${RED}ERROR: Unmerged OSS contributions detected!${NC}"
    echo -e "${RED}════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "The following commits in the OSS repo need to be cherry-picked to internal first:"
    echo ""
    echo "$contribution_commits"
    echo ""
    echo -e "${YELLOW}To merge these contributions:${NC}"
    echo ""
    echo "  1. Add the OSS repo as a remote (one-time setup):"
    echo "     git remote add oss https://github.com/lukilabs/craft-agents-oss.git"
    echo ""
    echo "  2. Fetch the latest from OSS:"
    echo "     git fetch oss"
    echo ""
    echo "  3. Cherry-pick each contribution commit:"
    while IFS= read -r line; do
      local hash="${line%% *}"
      echo "     git cherry-pick $hash"
    done <<< "$contribution_commits"
    echo ""
    echo "  4. Push to internal repo:"
    echo "     git push origin main"
    echo ""
    echo "  5. Re-run the sync workflow"
    echo ""
    echo -e "${RED}════════════════════════════════════════════════════════════════${NC}"
    return 1
  fi

  return 0
}

# Build rsync include/exclude patterns from allow-list
build_rsync_patterns() {
  local patterns=()

  # Always include parent directories for nested paths
  while IFS= read -r line; do
    # Skip comments and empty lines
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// /}" ]] && continue

    local pattern="${line%"${line##*[![:space:]]}"}"  # Trim trailing whitespace

    # Handle ** glob patterns
    if [[ "$pattern" == *"/**/*" ]]; then
      # Convert apps/electron/src/**/* to --include='/apps/electron/src/***'
      local base="${pattern%/**/*}"
      patterns+=("--include=/${base}/***")
    elif [[ "$pattern" == *"/**" ]]; then
      local base="${pattern%/**}"
      patterns+=("--include=/${base}/***")
    else
      # Exact file match
      patterns+=("--include=/${pattern}")
    fi
  done < "$ALLOW_LIST"

  # Exclude everything else
  patterns+=("--exclude=*")

  printf '%s\n' "${patterns[@]}"
}

# Main sync logic
main() {
  echo -e "${GREEN}OSS Sync Script${NC}"
  echo "Source: $REPO_ROOT"
  echo "Target: $TARGET_REPO"
  echo "Branch: $BRANCH"
  echo ""

  cd "$REPO_ROOT"

  # Get all git-tracked files
  local all_files
  all_files=$(git ls-files)

  # Read allow-list patterns (non-comment, non-empty lines)
  local patterns=()
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// /}" ]] && continue
    line="${line%"${line##*[![:space:]]}"}"  # Trim trailing whitespace
    patterns+=("$line")
  done < "$ALLOW_LIST"

  # Filter files by allow-list
  local allowed_files=()
  local excluded_files=()

  while IFS= read -r file; do
    local matched=false
    for pattern in "${patterns[@]}"; do
      # Handle ** glob patterns
      if [[ "$pattern" == *"/**/*" ]]; then
        local base="${pattern%/**/*}"
        if [[ "$file" == "$base/"* ]]; then
          matched=true
          break
        fi
      elif [[ "$pattern" == *"/**" ]]; then
        local base="${pattern%/**}"
        if [[ "$file" == "$base/"* ]]; then
          matched=true
          break
        fi
      elif [[ "$file" == "$pattern" ]]; then
        # Exact match
        matched=true
        break
      fi
    done

    if $matched; then
      allowed_files+=("$file")
    else
      excluded_files+=("$file")
    fi
  done <<< "$all_files"

  echo -e "${GREEN}Files to sync:${NC} ${#allowed_files[@]}"
  echo -e "${YELLOW}Files excluded:${NC} ${#excluded_files[@]}"
  echo ""

  if $DRY_RUN; then
    echo -e "${YELLOW}=== DRY RUN ===${NC}"
    echo ""
    echo "Files that WOULD be synced:"
    printf '  %s\n' "${allowed_files[@]}" | head -50
    [[ ${#allowed_files[@]} -gt 50 ]] && echo "  ... and $((${#allowed_files[@]} - 50)) more"
    echo ""
    echo "Files that are EXCLUDED:"
    printf '  %s\n' "${excluded_files[@]}"
    exit 0
  fi

  # Create temp directory for sync
  TEMP_DIR=$(mktemp -d)
  echo "Working directory: $TEMP_DIR"

  # Clone target repo (full history needed for contribution check)
  echo "Cloning target repository..."
  git clone --branch="$BRANCH" "$TARGET_REPO" "$TEMP_DIR/target" 2>/dev/null || \
    git clone "$TARGET_REPO" "$TEMP_DIR/target"

  # Check for unmerged OSS contributions before proceeding
  if $SKIP_CONTRIBUTION_CHECK; then
    echo -e "${YELLOW}Skipping contribution check (--force)${NC}"
  else
    echo "Checking for unmerged OSS contributions..."
    if ! check_oss_contributions "$TEMP_DIR/target"; then
      exit 1
    fi
    echo -e "${GREEN}No unmerged contributions found.${NC}"
  fi
  cd "$REPO_ROOT"

  # Remove only files that are managed by allow-list (preserves OSS-only files like custom workflows)
  echo "Cleaning managed files in target..."
  for file in "${allowed_files[@]}"; do
    local target_file="$TEMP_DIR/target/$file"
    if [[ -f "$target_file" ]]; then
      rm "$target_file"
    fi
  done

  # Also remove directories that would be fully replaced
  for pattern in "${patterns[@]}"; do
    if [[ "$pattern" == *"/**/*" || "$pattern" == *"/**" ]]; then
      local base="${pattern%/**/*}"
      base="${base%/**}"
      local target_dir="$TEMP_DIR/target/$base"
      if [[ -d "$target_dir" ]]; then
        rm -rf "$target_dir"
      fi
    fi
  done

  # Copy allowed files
  echo "Copying allowed files..."
  for file in "${allowed_files[@]}"; do
    local dest="$TEMP_DIR/target/$file"
    mkdir -p "$(dirname "$dest")"
    cp "$REPO_ROOT/$file" "$dest"
  done

  # Rename README_FOR_OSS.md to README.md
  if [[ -f "$TEMP_DIR/target/README_FOR_OSS.md" ]]; then
    mv "$TEMP_DIR/target/README_FOR_OSS.md" "$TEMP_DIR/target/README.md"
    echo "Renamed README_FOR_OSS.md → README.md"
  fi

  # Show diff
  cd "$TEMP_DIR/target"
  echo ""
  echo -e "${GREEN}=== Changes ===${NC}"
  git status --short

  # Confirm push
  echo ""
  if $AUTO_CONFIRM; then
    REPLY="y"
  else
    read -p "Push these changes to $TARGET_REPO? [y/N] " -n 1 -r
    echo
  fi

  if [[ $REPLY =~ ^[Yy]$ ]]; then
    git add -A
    git commit -m "Sync from internal repository

Synced $(date -u +%Y-%m-%dT%H:%M:%SZ)" || {
      echo -e "${YELLOW}Nothing to commit - already in sync${NC}"
      exit 0
    }
    git push origin "$BRANCH"
    echo -e "${GREEN}Sync complete!${NC}"
  else
    echo "Aborted."
    exit 1
  fi
}

main "$@"
