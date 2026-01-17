#!/bin/bash
# Multi-instance detection script for Craft Agent development
#
# Detects instance number from folder name suffix (e.g., craft-tui-agent-1, craft-agent-2)
# and exports environment variables to configure separate instances.
#
# Usage: source scripts/detect-instance.sh
#
# Instance numbering:
#   - Non-numbered folders (craft-tui-agent, craft-agent): Use defaults (port 5173, ~/.craft-agent/)
#   - Numbered folders (-1, -2, etc.): Use instance-specific config (port 1173/2173, ~/.craft-agent-1/)

FOLDER_NAME=$(basename "$PWD")

# Match folder names ending with -N (e.g., craft-tui-agent-1, craft-agent-2)
if [[ "$FOLDER_NAME" =~ -([0-9]+)$ ]]; then
  INSTANCE_NUM="${BASH_REMATCH[1]}"
  export CRAFT_INSTANCE_NUMBER="$INSTANCE_NUM"
  export CRAFT_VITE_PORT="${INSTANCE_NUM}173"
  export CRAFT_APP_ID="com.lukilabs.craft-agent-${INSTANCE_NUM}"
  export CRAFT_APP_NAME="Craft Agents [${INSTANCE_NUM}]"
  export CRAFT_CONFIG_DIR="$HOME/.craft-agent-${INSTANCE_NUM}"
  export CRAFT_DEEPLINK_SCHEME="craftagents${INSTANCE_NUM}"
  echo "Instance ${INSTANCE_NUM} detected: port=${CRAFT_VITE_PORT}, config=${CRAFT_CONFIG_DIR}"
else
  # Default configuration for non-numbered folders
  export CRAFT_INSTANCE_NUMBER=""
  export CRAFT_VITE_PORT="5173"
  export CRAFT_APP_ID="com.lukilabs.craft-agent"
  export CRAFT_APP_NAME="Craft Agents"
  export CRAFT_CONFIG_DIR="$HOME/.craft-agent"
  export CRAFT_DEEPLINK_SCHEME="craftagents"
fi
