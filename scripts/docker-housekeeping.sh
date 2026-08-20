#!/usr/bin/env bash
# docker-housekeeping — periodic OrbStack/VM + host cache cleanup for this
# workstation. Wipes only what is safely regenerable. MUST NOT be extended
# to touch ACTIVE containers/images (rox sessions build into the same VM).
set -u

log() { printf '[docker-housekeeping] %s\n' "$*"; }

log "docker system df (before):"
docker system df 2>/dev/null | head -6 || true

# 1. Build cache — pure junk, always regenerated.
log "pruning builder cache"
docker builder prune -af >/dev/null 2>&1 || true

# 2. Dangling images (untagged leftovers from builds).
log "pruning dangling images"
docker image prune -f >/dev/null 2>&1 || true

# 3. Anonymous volumes not attached to a running container.
log "pruning unattached volumes"
docker volume prune -f >/dev/null 2>&1 || true

# 4. Host-side regenerable caches.
for d in \
  "$HOME/Library/Caches/dev.kdrag0n.MacVirt" \
  "$HOME/.npm/_cacache" \
  "$HOME/.cache/bun/install/cache" \
  "$HOME/Library/Caches/@craft-agentelectron-updater"; do
  if [ -d "$d" ]; then
    log "removing $d contents"
    rm -rf "${d:?}/"* 2>/dev/null || true
  fi
done

command -v brew >/dev/null 2>&1 && { log "brew cleanup -s"; brew cleanup -s >/dev/null 2>&1 || true; }

log "docker system df (after):"
docker system df 2>/dev/null | head -6 || true
df -h /System/Volumes/Data | tail -1
