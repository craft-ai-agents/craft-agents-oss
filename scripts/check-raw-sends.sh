#!/usr/bin/env bash
# Lint guard: detect raw webContents.send() outside typed wrappers.
#
# All renderer-bound messages should go through WindowManager's typed broadcast
# methods (broadcastToAll / broadcastToWorkspace / sendToWindow), which are
# checked against BroadcastEventMap. A raw webContents.send() bypasses that
# type checking and silently drifts from the channel contract.
#
# Approved locations:
#   - window-manager.ts:       pushToWindow's pre-handshake fallback — this IS
#                              the typed wrapper, so it is allowed to do the
#                              raw send it wraps.
#   - browser-pane-manager.ts: toolbar BrowserView sends. The toolbar runs in a
#                              separate preload context outside the RPC
#                              transport, so its channels are not in
#                              BroadcastEventMap and cannot use WindowManager.
#
# NOTE: menu.ts and ipc/workspace.ts were previously excluded. menu.ts no longer
# contains any raw sends, and ipc/workspace.ts no longer exists. Both exclusions
# were removed so those paths are covered again — a stale exclusion glob is a
# silent blind spot, not a harmless leftover.

set -euo pipefail

cd "$(dirname "$0")/.."

# Pick a search tool. If neither exists we must FAIL, not silently report clean:
# an empty result from a missing binary is indistinguishable from "no
# violations", which is exactly how a lint guard rots into a no-op.
if command -v rg >/dev/null 2>&1; then
  VIOLATIONS=$(rg 'webContents\.send\(' apps/electron/src/main/ \
    --glob '!**/window-manager.ts' \
    --glob '!**/browser-pane-manager.ts' \
    -l || true)
elif command -v grep >/dev/null 2>&1; then
  VIOLATIONS=$(grep -R -l -E 'webContents\.send\(' apps/electron/src/main/ \
    --include='*.ts' \
    --include='*.tsx' \
    --exclude='window-manager.ts' \
    --exclude='browser-pane-manager.ts' || true)
else
  echo "ERROR: neither rg nor grep is available — cannot run the raw-send guard." >&2
  echo "Refusing to report success without actually checking." >&2
  exit 2
fi

if [ -n "${VIOLATIONS:-}" ]; then
  echo "ERROR: Raw webContents.send() found outside approved wrappers:"
  echo "$VIOLATIONS"
  echo ""
  echo "Use windowManager.broadcastToAll/broadcastToWorkspace/sendToWindow instead."
  echo "See apps/electron/src/main/window-manager.ts for typed broadcast methods."
  exit 1
fi

echo "OK: No raw webContents.send() outside approved wrappers."
