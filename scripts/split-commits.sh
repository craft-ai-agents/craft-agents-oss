#!/usr/bin/env bash
# =============================================================================
# scripts/split-commits.sh
#
# Stages and commits the 8-branch stack one commit at a time, pausing after
# each for manual verification.  Aborts immediately if any unstaged delta
# remains after staging — this catches files that landed in the wrong commit.
#
# Commit order follows the dependency chain (see docs/git/rebrand-2026-reordered-commits.md):
#   1. protocol-channels  — IPC channel definitions (no deps)
#   2. git-status-backend — server handler (no deps)
#   3. recent-changes-rail — UI calls IPC from #1
#   4. renderer-test-infra — bun:test setup (no deps)
#   5. iconography-and-dockerfile — tests depend on #4
#   6. electron-deps-scripts — package.json + build scripts (no deps)
#   7. owner-features — depends on #4 + #6
#   8. electron-main-fixes — depends on #7
#
# Usage:
#   scripts/split-commits.sh [--base <ref>] [--dry-run] [--yes]
#
# Options:
#   --base <ref>    Starting ref (default: redesign/owner-agent)
#   --dry-run       Print commands without executing
#   --yes           Skip confirmation prompts (for CI / non-TTY)
# =============================================================================

set -euo pipefail

BASE_REF="redesign/owner-agent"
DRY_RUN=false
AUTO_YES=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)    BASE_REF="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --yes)     AUTO_YES=true; shift ;;
    *)         echo "Unknown: $1"; exit 1 ;;
  esac
done

log()  { printf '[split] %s\n' "$*"; }
warn() { printf '[split] WARNING: %s\n' "$*" >&2; }
die()  { printf '[split] ERROR: %s\n' "$*" >&2; exit 1; }

# ── Cleanup on failure ────────────────────────────────────────────────────

WORK_BRANCH=""
cleanup() {
  if [[ -n "$WORK_BRANCH" ]] && git rev-parse --verify "$WORK_BRANCH" >/dev/null 2>&1; then
    warn "Cleaning up temporary branch: $WORK_BRANCH"
    git checkout - --quiet 2>/dev/null || true
    git branch -D "$WORK_BRANCH" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cd "$(git rev-parse --show-toplevel)"

# Verify base exists
git rev-parse --verify "$BASE_REF" >/dev/null 2>&1 || die "Base ref '$BASE_REF' not found."

# ── Commit definitions ────────────────────────────────────────────────────
# Format: BRANCH_NAME|COMMIT_MSG|FILE_LIST
# Files are newline-separated.  Prefix with '-' for deletions (git rm).
# The file list is the output of: git diff --name-only <branch>~1 <branch>

COMMITS=(
  "pr/protocol-channels|feat(protocol): bucket field on GitStatusFileEntry + new git-status IPC channels|apps/electron/src/shared/__tests__/ipc-channels.test.ts
apps/electron/src/shared/types.ts
packages/shared/src/protocol/channels.ts
packages/shared/src/protocol/dto.ts
packages/shared/src/protocol/events.ts
packages/shared/src/protocol/routing.ts
packages/shared/src/protocol/types.ts"

  "pr/git-status-backend|feat(server-core): git status porcelain-XY parser with dual bucket emission|packages/server-core/src/handlers/rpc/system.open-url.test.ts
packages/server-core/src/handlers/rpc/system.ts
packages/server-core/src/handlers/rpc/transfer.test.ts"

  "pr/recent-changes-rail|feat(shell): bucket-split Recent Changes rail|apps/electron/src/renderer/shell/LayoutShell.css
apps/electron/src/renderer/shell/LayoutShell.tsx
apps/electron/src/renderer/shell/__tests__/LayoutShell.changes-rail.test.tsx"

  "pr/renderer-test-infra|test(shell): renderer test infra for bun:test|bunfig.toml
scripts/test-setup.ts"

  "pr/iconography-and-dockerfile|chore(tests): add UserMessageBubble thumbnail rendering tests|packages/ui/src/components/chat/__tests__/user-message-bubble-attachments.test.tsx"

  "pr/electron-deps-scripts|chore(deps): add react-window + happy-dom + icon generator scripts|apps/electron/package.json
apps/electron/resources/icon.svg
scripts/browser-tool.ts
scripts/build/darwin.ts
scripts/electron-dev.ts"

  "pr/owner-features|feat(shell,server,shared,ui): settings/memory/providers rewrites + onboarding mural + chrome refresh|.gitignore
README.md
SECURITY.md
apps/electron/resources/release-notes/0.7.0.md
apps/electron/src/main/handlers/__tests__/context-file-watcher.test.ts
apps/electron/src/main/handlers/inference.ts
apps/electron/src/main/handlers/prompts.ts
apps/electron/src/renderer/App.tsx
apps/electron/src/renderer/actions/definitions.ts
apps/electron/src/renderer/atoms/browser-pane.ts
apps/electron/src/renderer/components/SplashScreen.tsx
apps/electron/src/renderer/components/apisetup/ApiKeyInput.tsx
apps/electron/src/renderer/components/app-menu/DesktopAppMenu.tsx
apps/electron/src/renderer/components/app-menu/MobileAppMenu.tsx
apps/electron/src/renderer/components/app-shell/input/InputContainer.tsx
apps/electron/src/renderer/components/app-shell/input/__tests__/model-picker-helpers.test.ts
apps/electron/src/renderer/components/icons/CraftAgentsLogo.tsx
apps/electron/src/renderer/components/icons/CraftAgentsSymbol.tsx
apps/electron/src/renderer/components/onboarding/CompletionScene.tsx
apps/electron/src/renderer/components/onboarding/CompletionStep.tsx
apps/electron/src/renderer/components/onboarding/LocalModelStep.tsx
apps/electron/src/renderer/components/onboarding/OnboardingMural.css
apps/electron/src/renderer/components/onboarding/OnboardingMural.tsx
apps/electron/src/renderer/components/onboarding/OnboardingWizard.tsx
apps/electron/src/renderer/components/onboarding/ProviderCatalogPicker.tsx
apps/electron/src/renderer/components/onboarding/ProviderSelectStep.tsx
apps/electron/src/renderer/components/onboarding/ReauthScreen.tsx
apps/electron/src/renderer/components/onboarding/WelcomeStep.tsx
apps/electron/src/renderer/components/onboarding/__tests__/provider-catalog.test.ts
apps/electron/src/renderer/components/onboarding/index.ts
apps/electron/src/renderer/components/onboarding/provider-catalog.ts
apps/electron/src/renderer/design-system/brand.css
apps/electron/src/renderer/design-system/index.ts
apps/electron/src/renderer/home/HomeHero.tsx
apps/electron/src/renderer/hooks/useOnboarding.ts
apps/electron/src/renderer/index.css
apps/electron/src/renderer/lib/provider-icons.ts
apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx
apps/electron/src/renderer/panels/PromptStudio.html
apps/electron/src/renderer/panels/ProvidersPanel.css
apps/electron/src/renderer/panels/ProvidersPanel.tsx
apps/electron/src/renderer/panels/command/CommandPanel.tsx
apps/electron/src/renderer/panels/integrations/IntegrationsPanel.tsx
apps/electron/src/renderer/panels/media-lab/__tests__/MediaLabPanel.test.tsx
apps/electron/src/renderer/panels/memory/MemoryPanel.tsx
apps/electron/src/renderer/panels/prompts/PromptStudioPanel.css
apps/electron/src/renderer/panels/prompts/PromptStudioPanel.tsx
apps/electron/src/renderer/panels/prompts/__tests__/PromptStudioPanel.test.tsx
apps/electron/src/renderer/panels/prompts/diffUtils.ts
apps/electron/src/renderer/panels/prompts/index.ts
apps/electron/src/renderer/panels/settings/SettingsPanel.tsx
apps/electron/src/renderer/playground.html
apps/electron/src/renderer/playground.tsx
apps/electron/src/renderer/playground/PlaygroundApp.tsx
apps/electron/src/renderer/playground/demos/messaging/AllowListPreview.tsx
apps/electron/src/renderer/playground/demos/messaging/MessagingTelegramReworkedPreview.tsx
apps/electron/src/renderer/playground/registry/browser-ui.tsx
apps/electron/src/renderer/playground/registry/icons.tsx
apps/electron/src/renderer/shell/__tests__/LayoutShell.context-rail.test.tsx
apps/electron/tsconfig.json
apps/viewer/public/sample-session.json
bun.lock
docs/brand/trademark-audit.md
packages/pi-agent-server/tsconfig.typecheck.json
packages/server-core/src/domain/connection-setup-logic.test.ts
packages/server-core/src/domain/connection-setup-logic.ts
packages/server-core/src/handlers/rpc/files.ts
packages/server-core/src/handlers/rpc/index.ts
packages/server-core/src/handlers/rpc/inference.ts
packages/server-core/src/handlers/rpc/llm-connections.ts
packages/server-core/src/handlers/rpc/media.ts
packages/server-core/src/handlers/rpc/sessions.ts
packages/server-core/src/sessions/SessionManager.ts
packages/server-core/src/transport/client.ts
packages/server-core/src/transport/codec.ts
packages/server-core/src/transport/server.ts
packages/server-core/src/transport/types.ts
packages/session-mcp-server/src/index.ts
packages/session-tools-core/package.json
packages/session-tools-core/src/context.ts
packages/session-tools-core/src/handlers/create-task.ts
packages/session-tools-core/src/handlers/index.ts
packages/session-tools-core/src/handlers/memory-archive.ts
packages/session-tools-core/src/handlers/memory-create.ts
packages/session-tools-core/src/handlers/memory-recall.ts
packages/session-tools-core/src/handlers/memory-schemas.ts
packages/session-tools-core/src/handlers/memory-search.ts
packages/session-tools-core/src/handlers/memory-tools.test.ts
packages/session-tools-core/src/handlers/memory-update.ts
packages/session-tools-core/src/response.ts
packages/session-tools-core/src/tool-defs.ts
packages/session-tools-core/tsconfig.json
packages/shared/src/agent/__tests__/claude-agent-spawn-cwd.test.ts
packages/shared/src/agent/__tests__/spawn-session-tilde-expansion.test.ts
packages/shared/src/agent/backend/__tests__/read-patterns.test.ts
packages/shared/src/agent/backend/types.ts
packages/shared/src/agent/claude-context.ts
packages/shared/src/agent/core/__tests__/inference-store.test.ts
packages/shared/src/agent/core/__tests__/permission-manager.test.ts
packages/shared/src/agent/core/__tests__/permissions-compiler-integration.test.ts
packages/shared/src/agent/core/index.ts
packages/shared/src/agent/core/permission-manager.ts
packages/shared/src/agent/core/types.ts
packages/shared/src/agent/diagnostics.ts
packages/shared/src/agent/errors.ts
packages/shared/src/agent/permissions-config.ts
packages/shared/src/agent/session-scoped-tool-callback-registry.ts
packages/shared/src/agent/session-scoped-tools.ts
packages/shared/src/agent/spawn-helpers.ts
packages/shared/src/config/__tests__/storage-startup-migration.test.ts
packages/shared/src/config/index.ts
packages/shared/src/config/models-pi.ts
packages/shared/src/config/paths.ts
packages/shared/src/config/storage.ts
packages/shared/src/config/theme.ts
packages/shared/src/docs/index.ts
packages/shared/src/labels/storage.ts
packages/shared/src/memory/__tests__/import-edge-cases.test.ts
packages/shared/src/memory/__tests__/import.test.ts
packages/shared/src/memory/__tests__/integration.test.ts
packages/shared/src/memory/__tests__/search.test.ts
packages/shared/src/memory/database.ts
packages/shared/src/memory/obsidian-sync.ts
packages/shared/src/memory/repository.ts
packages/shared/src/prompts/__tests__/system.test.ts
packages/shared/src/prompts/index.ts
packages/shared/src/prompts/owner/__tests__/__snapshots__/compiler.golden-snap.snap
packages/shared/src/prompts/owner/__tests__/compiler.behavior.test.ts
packages/shared/src/prompts/owner/__tests__/compiler.end-to-end.test.ts
packages/shared/src/prompts/owner/__tests__/compiler.golden-snap.test.ts
packages/shared/src/prompts/owner/__tests__/compiler.mock-llm.test.ts
packages/shared/src/prompts/owner/__tests__/compiler.structural.test.ts
packages/shared/src/prompts/owner/__tests__/compiler.test.ts
packages/shared/src/prompts/owner/compiler.ts
packages/shared/src/prompts/owner/defaults.ts
packages/shared/src/prompts/owner/index.ts
packages/shared/src/prompts/owner/types.ts
packages/shared/src/prompts/owner/validator.ts
packages/shared/src/prompts/system.ts
packages/shared/src/sources/builtin-sources.ts
packages/shared/src/sources/paths.ts
packages/shared/src/sources/storage.ts
packages/shared/src/statuses/storage.ts
packages/shared/src/unified-network-interceptor.ts
packages/shared/src/utils/files.ts
packages/shared/src/utils/icon.ts
packages/shared/src/utils/paths.ts
packages/shared/src/workspaces/storage.ts
packages/shared/tsconfig.json
packages/ui/package.json
packages/ui/tsconfig.json
tsconfig.json"

  "pr/iconography-and-dockerfile|chore(tests): add UserMessageBubble thumbnail rendering tests|packages/ui/src/components/chat/__tests__/user-message-bubble-attachments.test.tsx"
)

# ── Start ─────────────────────────────────────────────────────────────────

log "Base ref: $BASE_REF"
log "Commits to create: ${#COMMITS[@]}"
log ""

# Create a working branch from the base
WORK_BRANCH="split-work-$$"
log "Creating working branch: $WORK_BRANCH from $BASE_REF"
if ! $DRY_RUN; then
  git checkout -b "$WORK_BRANCH" "$BASE_REF" --quiet 2>/dev/null
fi

CREATED_BRANCHES=()

for i in "${!COMMITS[@]}"; do
  IFS='|' read -r BRANCH MSG FILES_RAW <<< "${COMMITS[$i]}"
  COMMIT_NUM=$((i + 1))
  TOTAL=${#COMMITS[@]}

  log ""
  log "═══════════════════════════════════════════════════════════════════"
  log " Commit $COMMIT_NUM/$TOTAL: $BRANCH"
  log " $MSG"
  log "═══════════════════════════════════════════════════════════════════"

  # Stage each file individually so we catch missing paths early
  STAGED=0
  MISSING=0
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if $DRY_RUN; then
      printf '+ git add %s\n' "$file"
      STAGED=$((STAGED + 1))
    elif git add "$file" 2>/dev/null; then
      STAGED=$((STAGED + 1))
    else
      warn "Could not stage: $file"
      MISSING=$((MISSING + 1))
    fi
  done <<< "$FILES_RAW"

  if [[ $MISSING -gt 0 ]]; then
    die "$MISSING file(s) could not be staged. Fix paths and re-run."
  fi

  # Also catch deleted files (git add won't stage deletions)
  if ! $DRY_RUN; then
    DELETED=$(git diff --name-only --diff-filter=D 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$DELETED" -gt 0 ]]; then
      log "Found $DELETED deleted file(s) — staging via git add -u"
      git add -u 2>/dev/null || true
    fi
  fi

  log "Staged $STAGED file(s)."

  # Show what's staged
  log ""
  log "Staged changes:"
  if ! $DRY_RUN; then
    git diff --cached --stat
  fi

  # Abort if there are unstaged changes in the working tree
  UNSTAGED=0
  if ! $DRY_RUN; then
    UNSTAGED=$(git diff --name-only 2>/dev/null | wc -l | tr -d ' ')
  fi
  if [[ "$UNSTAGED" -gt 0 ]]; then
    log ""
    warn "UNSTAGED DELTA DETECTED ($UNSTAGED file(s)):"
    git diff --name-only
    die "Aborting — unstaged changes mean a file landed in the wrong commit."
  fi

  # Pause for confirmation (skip in --yes mode or non-TTY)
  if [[ "$AUTO_YES" != "true" ]] && [[ -t 0 ]]; then
    log ""
    printf '[split] Press Enter to commit, or Ctrl+C to abort... '
    read -r _
  fi

  # Commit
  if ! $DRY_RUN; then
    git commit --quiet -m "$MSG"
  fi
  COMMIT_SHA=$($DRY_RUN && echo "dry-run" || git rev-parse --short HEAD)
  log "Committed: $COMMIT_SHA"

  # Create the named branch pointing at this commit
  if ! $DRY_RUN; then
    git branch "$BRANCH" 2>/dev/null || true
  fi
  CREATED_BRANCHES+=("$BRANCH")
  log "Branch: $BRANCH"

  # Reset the index for the next commit (explicit safety step)
  if ! $DRY_RUN; then
    git reset HEAD --quiet 2>/dev/null || true
  fi

  # Verify clean working tree after commit
  DIRTY=0
  if ! $DRY_RUN; then
    DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  fi
  if [[ "$DIRTY" -gt 0 ]]; then
    die "Working tree dirty after commit — $DIRTY uncommitted file(s)."
  fi
done

# ── Summary ───────────────────────────────────────────────────────────────

log ""
log "═══════════════════════════════════════════════════════════════════"
log " Stack created successfully!"
log "═══════════════════════════════════════════════════════════════════"
log ""

for b in "${CREATED_BRANCHES[@]}"; do
  if $DRY_RUN; then
    log "  $b (dry-run)"
  elif git rev-parse --verify "$b" >/dev/null 2>&1; then
    MSG=$(git log --oneline -1 "$b")
    log "  $MSG"
  fi
done

log ""
log "Full graph:"
log ""
if ! $DRY_RUN; then
  git log --oneline --graph "${CREATED_BRANCHES[@]}" 2>/dev/null | head -20
fi

log ""
log "To push:  git push origin ${CREATED_BRANCHES[*]}"
log "To reset: git branch -D ${CREATED_BRANCHES[*]} && git checkout $BASE_REF"
