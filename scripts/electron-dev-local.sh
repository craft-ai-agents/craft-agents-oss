#!/bin/bash
# Launch script for running the dev Electron app alongside the production Craft Agents app.
# Strips inherited CRAFT_* env vars from the production app and uses a separate config dir
# to avoid server lock conflicts.

set -e

cd /Volumes/PortableSSD/Development/craft-agents-oss

# Unset all CRAFT_ env vars inherited from the production app
unset $(env | grep "^CRAFT_" | sed 's/=.*//') 2>/dev/null || true
unset __CFBundleIdentifier 2>/dev/null || true

# Use a separate config directory for the dev instance
export CRAFT_CONFIG_DIR="$HOME/.craft-agent-dev"
export CRAFT_APP_NAME="Craft Agents (Dev)"

# Ensure the dev config dir exists
mkdir -p "$CRAFT_CONFIG_DIR"

echo "🚀 Launching Craft Agents dev..."
echo "   Config dir: $CRAFT_CONFIG_DIR"
echo ""

# Run the standard dev script
exec bun run electron:dev
