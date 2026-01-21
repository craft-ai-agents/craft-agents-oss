#!/bin/bash

# Self-update script for Craft Agentss Electron app (Linux AppImage)
# This script is spawned by the app before quitting to install updates
#
# Usage: self-update-linux.sh <new_appimage_path> <current_appimage_path>
# Environment variables:
#   CRAFT_UPDATE_APPIMAGE   - Path to the downloaded AppImage
#   CRAFT_CURRENT_APPIMAGE  - Path to the currently running AppImage
#
# Safety features:
#   - Atomic swap: old AppImage moved to backup before new one is moved in
#   - Rollback: if installation fails, old AppImage is restored
#   - New AppImage kept until successful launch verified

set -e

# Get paths from arguments or environment
NEW_APPIMAGE="${1:-$CRAFT_UPDATE_APPIMAGE}"
CURRENT_APPIMAGE="${2:-$CRAFT_CURRENT_APPIMAGE}"

# Logging
LOG_FILE="/tmp/craft-agent-update.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
}

show_notification() {
    # Try notify-send first (most common on Linux)
    if command -v notify-send &> /dev/null; then
        notify-send "Craft Agents" "$1" 2>/dev/null || true
    fi
}

clear_stale_cache() {
    local cache_dir="$HOME/.config/@craft-agent/electron"
    if [ -d "$cache_dir" ]; then
        log "Clearing Electron cache to prevent stale mount issues..."
        rm -rf "$cache_dir"
    fi
}

error_with_rollback() {
    log "ERROR: $1"

    # Attempt rollback if we have a backup
    if [ -f "$BACKUP_PATH" ]; then
        log "Attempting rollback from backup..."
        if mv "$BACKUP_PATH" "$CURRENT_APPIMAGE" 2>/dev/null; then
            log "Rollback successful - old version restored"
            chmod +x "$CURRENT_APPIMAGE" 2>/dev/null || true
            # Try to launch the restored app via wrapper if available
            if [ -x "$HOME/.local/bin/craft-agents" ]; then
                nohup "$HOME/.local/bin/craft-agents" > /dev/null 2>&1 &
            else
                nohup "$CURRENT_APPIMAGE" --no-sandbox > /dev/null 2>&1 &
            fi
        else
            log "Rollback failed - manual intervention required"
            log "Backup at: $BACKUP_PATH"
        fi
    fi

    show_notification "Update failed. Your previous version has been restored."
    exit 1
}

log "Starting Linux AppImage self-update"
log "New AppImage: $NEW_APPIMAGE"
log "Current AppImage: $CURRENT_APPIMAGE"

# Validate paths
if [ -z "$NEW_APPIMAGE" ]; then
    log "ERROR: New AppImage path is empty"
    show_notification "Update failed: installer not found."
    exit 1
fi

if [ ! -f "$NEW_APPIMAGE" ]; then
    log "ERROR: New AppImage not found: $NEW_APPIMAGE"
    show_notification "Update failed: installer not found."
    exit 1
fi

if [ -z "$CURRENT_APPIMAGE" ]; then
    log "ERROR: Current AppImage path is empty"
    show_notification "Update failed: could not determine current installation."
    exit 1
fi

# Validate path doesn't contain dangerous characters (prevent injection)
if ! echo "$NEW_APPIMAGE" | grep -qE '^[a-zA-Z0-9/._ -]+$'; then
    log "ERROR: New AppImage path contains invalid characters: $NEW_APPIMAGE"
    show_notification "Update failed: invalid installer path."
    exit 1
fi

# Validate path is absolute
if [ "${NEW_APPIMAGE:0:1}" != "/" ]; then
    log "ERROR: New AppImage path must be absolute: $NEW_APPIMAGE"
    show_notification "Update failed: invalid installer path."
    exit 1
fi

# Show progress notification
show_notification "Installing update, please wait..."

# Wait for app to quit (max 10 seconds)
log "Waiting for app to quit..."
sleep 2  # Give the app time to quit

# Define backup path
BACKUP_PATH="${CURRENT_APPIMAGE}.backup"

# Make new AppImage executable
log "Making new AppImage executable..."
if ! chmod +x "$NEW_APPIMAGE"; then
    log "ERROR: Could not make new AppImage executable"
    show_notification "Update failed: permission error."
    exit 1
fi

# Backup current AppImage (if exists)
if [ -f "$CURRENT_APPIMAGE" ]; then
    log "Backing up current AppImage to $BACKUP_PATH..."
    if ! mv "$CURRENT_APPIMAGE" "$BACKUP_PATH"; then
        log "ERROR: Could not create backup"
        show_notification "Update failed: could not backup existing app."
        exit 1
    fi
    log "Backup created successfully"
fi

# Move new AppImage to current location
log "Installing new AppImage..."
if ! mv "$NEW_APPIMAGE" "$CURRENT_APPIMAGE"; then
    log "ERROR: Could not install new AppImage"
    error_with_rollback "Failed to move new AppImage to install location"
fi

# Ensure executable
chmod +x "$CURRENT_APPIMAGE" 2>/dev/null || true

log "Installation complete. Launching app..."

# Clear Electron cache to prevent stale mount path references
clear_stale_cache

# Wait a moment
sleep 1

# Launch via wrapper if available, otherwise direct with --no-sandbox
if [ -x "$HOME/.local/bin/craft-agents" ]; then
    log "Using wrapper script for launch"
    nohup "$HOME/.local/bin/craft-agents" > /dev/null 2>&1 &
else
    log "Launching AppImage directly with --no-sandbox"
    export APPIMAGE="$CURRENT_APPIMAGE"
    nohup "$CURRENT_APPIMAGE" --no-sandbox > /dev/null 2>&1 &
fi
APP_PID=$!
log "Launched with PID: $APP_PID"

# Wait briefly to see if the app launches
sleep 3

# Check if the specific PID is still running
# This is more reliable than pgrep which could match other processes
if kill -0 "$APP_PID" 2>/dev/null; then
    log "New version launched successfully (PID $APP_PID is running)"
    # Clean up backup
    rm -f "$BACKUP_PATH" 2>/dev/null || true
    log "Cleanup complete"
else
    # PID not running - check if any Craft Agents process is running with the exact path
    # Use exact path match to avoid false positives from other AppImages
    if pgrep -f "^$CURRENT_APPIMAGE" > /dev/null 2>&1; then
        log "App is running (found process matching exact path)"
        rm -f "$BACKUP_PATH" 2>/dev/null || true
        log "Cleanup complete"
    else
        log "WARNING: Could not verify new app launch (PID $APP_PID not running)"
        # Keep backup for manual recovery
        log "Backup kept at: $BACKUP_PATH"
    fi
fi

log "Update complete!"
