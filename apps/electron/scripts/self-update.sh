#!/bin/bash

# Self-update script for Craft Agent Electron app
# This script is spawned by the app before quitting to install updates
#
# Usage: self-update.sh <dmg_path> <app_path>
# Environment variables:
#   CRAFT_UPDATE_DMG - Path to the downloaded DMG file
#   CRAFT_APP_PATH   - Path to the currently running app executable
#
# Safety features:
#   - Atomic swap: old app moved to backup before new app is moved in
#   - Rollback: if installation fails, old app is restored
#   - DMG kept until successful launch verified

set -e

APP_NAME="Craft Agent.app"
INSTALL_DIR="/Applications"
APP_BUNDLE_ID="com.lukilabs.craft-agent"
BACKUP_DIR="/tmp/craft-agent-backup-$$"

# Get DMG path from argument or environment
DMG_PATH="${1:-$CRAFT_UPDATE_DMG}"
APP_PATH="${2:-$CRAFT_APP_PATH}"

# Logging to temp file for debugging
LOG_FILE="/tmp/craft-agent-update.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
}

error_with_rollback() {
    log "ERROR: $1"

    # Attempt rollback if we have a backup
    if [ -d "$BACKUP_DIR/$APP_NAME" ]; then
        log "Attempting rollback from backup..."
        if [ -d "$INSTALL_DIR/$APP_NAME" ]; then
            rm -rf "$INSTALL_DIR/$APP_NAME" 2>/dev/null || true
        fi
        if mv "$BACKUP_DIR/$APP_NAME" "$INSTALL_DIR/$APP_NAME" 2>/dev/null; then
            log "Rollback successful - old version restored"
            # Try to launch the restored app
            open -a "Craft Agent" 2>/dev/null || true
        else
            log "Rollback failed - manual intervention required"
        fi
    fi

    # Show notification on failure (keep DMG for manual retry)
    osascript -e 'display notification "Update failed. Your previous version has been restored." with title "Craft Agent"' 2>/dev/null || true
    exit 1
}

log "Starting self-update"
log "DMG path: $DMG_PATH"
log "App path: $APP_PATH"

# Show notification to indicate update is in progress
# Using notification instead of dialog because:
# 1. Dialog owned by System Events can't be closed programmatically
# 2. Notification is non-blocking and auto-dismisses
# 3. No orphan windows if update completes quickly
osascript -e 'display notification "Installing update, please wait..." with title "Craft Agent" subtitle "The app will restart automatically"' 2>/dev/null || true
log "Showed update notification"

# Validate DMG path - must be non-empty, exist, and be a safe path
# Security: prevent command injection via malicious environment variables
if [ -z "$DMG_PATH" ]; then
    log "ERROR: DMG path is empty"
    osascript -e 'display notification "Update failed: installer not found." with title "Craft Agent"' 2>/dev/null || true
    exit 1
fi

# Validate path doesn't contain dangerous characters (prevent injection)
# Allow only alphanumeric, slash, dot, dash, underscore, and space
if ! echo "$DMG_PATH" | grep -qE '^[a-zA-Z0-9/._ -]+$'; then
    log "ERROR: DMG path contains invalid characters: $DMG_PATH"
    osascript -e 'display notification "Update failed: invalid installer path." with title "Craft Agent"' 2>/dev/null || true
    exit 1
fi

# Validate path is absolute
if [ "${DMG_PATH:0:1}" != "/" ]; then
    log "ERROR: DMG path must be absolute: $DMG_PATH"
    osascript -e 'display notification "Update failed: invalid installer path." with title "Craft Agent"' 2>/dev/null || true
    exit 1
fi

if [ ! -f "$DMG_PATH" ]; then
    log "ERROR: DMG file not found: $DMG_PATH"
    osascript -e 'display notification "Update failed: installer not found." with title "Craft Agent"' 2>/dev/null || true
    exit 1
fi

# Wait for app to quit completely (max 10 seconds)
# Use bundle ID via lsappinfo which is the most reliable method on macOS
log "Waiting for app to quit..."
for i in $(seq 1 20); do
    # Check by bundle ID using lsappinfo (most reliable on macOS)
    if ! lsappinfo info -only pid -app "$APP_BUNDLE_ID" 2>/dev/null | grep -q "pid"; then
        log "App has quit after $((i / 2)) seconds"
        break
    fi
    sleep 0.5
done

# Force kill if still running
if lsappinfo info -only pid -app "$APP_BUNDLE_ID" 2>/dev/null | grep -q "pid"; then
    log "Force killing app..."
    osascript -e "tell application id \"$APP_BUNDLE_ID\" to quit" 2>/dev/null || true
    sleep 1
fi

# Brief wait for file handles to be released
sleep 0.5

# Mount DMG first to validate it before touching the installed app
log "Mounting DMG..."
mount_output=$(hdiutil attach "$DMG_PATH" -nobrowse -mountrandom /tmp 2>&1)
mount_exit_code=$?

if [ $mount_exit_code -ne 0 ]; then
    log "Failed to mount DMG: $mount_output"
    osascript -e 'display notification "Update failed: could not open installer." with title "Craft Agent"' 2>/dev/null || true
    exit 1
fi

mount_point=$(echo "$mount_output" | tail -1 | awk '{print $NF}')

if [ -z "$mount_point" ] || [ ! -d "$mount_point" ]; then
    log "Failed to find mount point in output: $mount_output"
    osascript -e 'display notification "Update failed: could not mount installer." with title "Craft Agent"' 2>/dev/null || true
    exit 1
fi

log "Mounted at: $mount_point"

# Find the .app in the mounted volume
app_source=$(find "$mount_point" -maxdepth 1 -name "*.app" -type d | head -1)

if [ -z "$app_source" ]; then
    hdiutil detach "$mount_point" -quiet 2>/dev/null || true
    log "No .app found in DMG"
    osascript -e 'display notification "Update failed: invalid installer package." with title "Craft Agent"' 2>/dev/null || true
    exit 1
fi

log "Found app: $app_source"

# Verify code signature of the new app before installation
# This prevents MITM attacks where a malicious DMG could be served
log "Verifying code signature..."

# Expected Team ID for Craft Agent (Luki Labs)
EXPECTED_TEAM_ID="LVV532B7S8"

# Check if app is signed and get signing info
codesign_output=$(codesign -dv --verbose=2 "$app_source" 2>&1)
codesign_exit=$?

if [ $codesign_exit -eq 0 ]; then
    # App is signed - verify it's valid and from our team
    log "App is signed, verifying signature..."

    # Verify signature integrity
    if ! codesign --verify --deep --strict "$app_source" 2>/dev/null; then
        hdiutil detach "$mount_point" -quiet 2>/dev/null || true
        log "ERROR: Code signature verification failed - signature is invalid or tampered"
        osascript -e 'display notification "Update failed: app signature is invalid." with title "Craft Agent"' 2>/dev/null || true
        exit 1
    fi

    # Extract and verify Team ID
    team_id=$(echo "$codesign_output" | grep "TeamIdentifier=" | cut -d'=' -f2)
    if [ -n "$team_id" ] && [ "$team_id" != "not set" ]; then
        if [ "$team_id" != "$EXPECTED_TEAM_ID" ]; then
            hdiutil detach "$mount_point" -quiet 2>/dev/null || true
            log "ERROR: Code signature Team ID mismatch - expected $EXPECTED_TEAM_ID, got $team_id"
            osascript -e 'display notification "Update failed: app signed by unknown developer." with title "Craft Agent"' 2>/dev/null || true
            exit 1
        fi
        log "Code signature verified: Team ID $team_id"
    else
        log "WARNING: App is signed but Team ID not found"
    fi
else
    # App is not signed
    # Check if we're updating from a signed app (production) or unsigned (development)
    if [ -d "$INSTALL_DIR/$APP_NAME" ]; then
        existing_signed=$(codesign -dv "$INSTALL_DIR/$APP_NAME" 2>&1)
        if echo "$existing_signed" | grep -q "TeamIdentifier=$EXPECTED_TEAM_ID"; then
            # Current app is signed by us - don't allow unsigned update (security risk)
            hdiutil detach "$mount_point" -quiet 2>/dev/null || true
            log "ERROR: Cannot update signed app with unsigned version"
            osascript -e 'display notification "Update failed: new version is not properly signed." with title "Craft Agent"' 2>/dev/null || true
            exit 1
        fi
    fi
    log "WARNING: App is not signed (development build)"
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

# ATOMIC SWAP STEP 1: Move old app to backup (if exists)
if [ -d "$INSTALL_DIR/$APP_NAME" ]; then
    log "Backing up existing installation to $BACKUP_DIR..."
    if ! mv "$INSTALL_DIR/$APP_NAME" "$BACKUP_DIR/$APP_NAME"; then
        hdiutil detach "$mount_point" -quiet 2>/dev/null || true
        log "Failed to create backup"
        osascript -e 'display notification "Update failed: could not backup existing app." with title "Craft Agent"' 2>/dev/null || true
        exit 1
    fi
    log "Backup created successfully"
fi

# ATOMIC SWAP STEP 2: Copy new app to temp location in /Applications
TEMP_APP="$INSTALL_DIR/.Craft-Agent-new-$$.app"
log "Copying new app to temp location..."
if ! cp -R "$app_source" "$TEMP_APP"; then
    hdiutil detach "$mount_point" -quiet 2>/dev/null || true
    error_with_rollback "Failed to copy new app"
fi

# ATOMIC SWAP STEP 3: Atomically move new app to final location
log "Moving new app to final location..."
if ! mv "$TEMP_APP" "$INSTALL_DIR/$APP_NAME"; then
    rm -rf "$TEMP_APP" 2>/dev/null || true
    hdiutil detach "$mount_point" -quiet 2>/dev/null || true
    error_with_rollback "Failed to install new app"
fi

# Unmount DMG
log "Unmounting DMG..."
hdiutil detach "$mount_point" -quiet 2>/dev/null || true

# Remove quarantine attribute if present
xattr -rd com.apple.quarantine "$INSTALL_DIR/$APP_NAME" 2>/dev/null || true

log "Installation complete. Launching app..."

# Wait a bit to ensure clean startup
sleep 1

# Clear potentially problematic environment variables before launching
unset ELECTRON_RUN_AS_NODE
unset NODE_OPTIONS
unset VITE_DEV_SERVER_URL

# Launch with minimal clean environment
env -i HOME="$HOME" USER="$USER" PATH="/usr/bin:/bin:/usr/sbin:/sbin" open -n -a "Craft Agent"

# Wait briefly to see if the app launches successfully
sleep 3

# Verify the new app launched (check if running)
if lsappinfo info -only pid -app "$APP_BUNDLE_ID" 2>/dev/null | grep -q "pid"; then
    log "New version launched successfully"
    # Clean up backup and DMG only after successful launch
    rm -rf "$BACKUP_DIR" 2>/dev/null || true
    rm -f "$DMG_PATH" 2>/dev/null || true
    log "Cleanup complete"
else
    log "WARNING: Could not verify new app launch"
    # Keep backup and DMG for manual recovery
    log "Backup kept at: $BACKUP_DIR"
    log "DMG kept at: $DMG_PATH"
fi

log "Update complete!"
