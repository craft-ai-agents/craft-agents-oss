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

# Check if a commit's changes are already applied in internal repo
# Returns 0 if changes are already in internal, 1 otherwise
check_patch_already_applied() {
  local commit_hash="$1"
  local oss_dir="$2"

  cd "$oss_dir"

  # Try applying the patch in reverse - if it succeeds, changes are already in target
  if git format-patch -1 --stdout "$commit_hash" | git -C "$REPO_ROOT" apply --check --reverse &>/dev/null; then
    return 0  # Changes already applied
  fi

  return 1  # Changes not applied
}

# Check for unmerged OSS contributions with intelligent cherry-pick detection
# Returns 0 if no contributions found, 1 if contributions need to be merged
check_oss_contributions() {
  local oss_dir="$1"

  cd "$oss_dir"

  # Add internal repo as remote if not already added
  if ! git remote | grep -q "^internal$"; then
    git remote add internal "$REPO_ROOT" 2>/dev/null || true
  fi
  git fetch internal &>/dev/null || true

  # Use git's cherry-pick detection to compare OSS main with internal main
  # Format: <mark> <hash> <subject>
  # Markers: > = only in OSS (potential contribution), = = cherry-picked (already synced)
  local cherry_output
  cherry_output=$(git log --cherry-mark --right-only --no-merges --oneline internal/main...main 2>/dev/null || echo "")

  if [[ -z "$cherry_output" ]]; then
    return 0  # No commits unique to OSS
  fi

  # Separate commits by their status
  local needs_sync=()
  local already_synced=()
  local needs_review=()

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue

    local mark="${line:0:1}"
    local rest="${line:2}"  # Skip mark and space
    local hash="${rest%% *}"
    local subject="${rest#* }"

    # Skip sync commits
    if [[ "$subject" == *"Sync from internal repository"* ]] || [[ "$subject" == "Initial commit" ]]; then
      continue
    fi

    if [[ "$mark" == "=" ]]; then
      # Git detected this as cherry-picked
      already_synced+=("$hash $subject (cherry-picked by Git)")
    elif [[ "$mark" == ">" ]]; then
      # Commit only in OSS - check if changes are already applied
      if check_patch_already_applied "$hash" "$oss_dir"; then
        already_synced+=("$hash $subject (changes already applied)")
      else
        # Check if it would apply cleanly or conflict
        if git format-patch -1 --stdout "$hash" | git -C "$REPO_ROOT" apply --check &>/dev/null; then
          needs_sync+=("$hash $subject")
        else
          needs_review+=("$hash $subject (conflicts detected)")
        fi
      fi
    fi
  done <<< "$cherry_output"

  # Display results
  if [[ ${#already_synced[@]} -gt 0 ]]; then
    echo ""
    echo -e "${GREEN}✅ Already Synced (${#already_synced[@]} commits):${NC}"
    for item in "${already_synced[@]}"; do
      echo "  = $item"
    done
  fi

  if [[ ${#needs_sync[@]} -eq 0 && ${#needs_review[@]} -eq 0 ]]; then
    return 0  # Nothing needs syncing
  fi

  # Report commits that need attention
  echo ""
  echo -e "${RED}════════════════════════════════════════════════════════════════${NC}"
  echo -e "${RED}ERROR: Unmerged OSS contributions detected!${NC}"
  echo -e "${RED}════════════════════════════════════════════════════════════════${NC}"

  if [[ ${#needs_sync[@]} -gt 0 ]]; then
    echo ""
    echo -e "${YELLOW}⚠️  Needs Sync (${#needs_sync[@]} commits):${NC}"
    for item in "${needs_sync[@]}"; do
      echo "  > $item"
    done
  fi

  if [[ ${#needs_review[@]} -gt 0 ]]; then
    echo ""
    echo -e "${YELLOW}❓ Needs Review (${#needs_review[@]} commits - conflicts detected):${NC}"
    for item in "${needs_review[@]}"; do
      echo "  > $item"
    done
  fi

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
  for item in "${needs_sync[@]}" "${needs_review[@]}"; do
    local hash="${item%% *}"
    echo "     git cherry-pick $hash"
  done
  echo ""
  echo "  4. Resolve any conflicts for commits marked 'needs review'"
  echo ""
  echo "  5. Push to internal repo:"
  echo "     git push origin main"
  echo ""
  echo "  6. Re-run the sync workflow"
  echo ""
  echo -e "${YELLOW}Summary: ${#needs_sync[@]} ready to sync, ${#needs_review[@]} need review, ${#already_synced[@]} already synced${NC}"
  echo -e "${RED}════════════════════════════════════════════════════════════════${NC}"

  return 1
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
