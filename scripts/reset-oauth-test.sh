#!/bin/bash
# Script to reset OAuth credentials for testing the migration flow
# This simulates the scenario where an old token exists in CLI keychain

CONFIG_DIR="${CRAFT_CONFIG_DIR:-$HOME/.craft-agent}"
CREDENTIALS_FILE="$CONFIG_DIR/credentials.enc"
CONFIG_FILE="$CONFIG_DIR/config.json"

echo "Resetting OAuth test state..."
echo "Config directory: $CONFIG_DIR"

# 1. Delete app's saved credentials (forces import from CLI)
if [ -f "$CREDENTIALS_FILE" ]; then
  echo "Deleting credentials file: $CREDENTIALS_FILE"
  rm "$CREDENTIALS_FILE"
else
  echo "No credentials file found (already cleared)"
fi

# 2. Clear skipCliImportUntil flag from config
if [ -f "$CONFIG_FILE" ]; then
  echo "Clearing skipCliImportUntil flag from config..."
  # Use a simple approach: remove the skipCliImportUntil field using jq if available, or sed
  if command -v jq &> /dev/null; then
    jq 'del(.skipCliImportUntil)' "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
    echo "Config updated using jq"
  else
    echo "Warning: jq not found. Please manually edit $CONFIG_FILE and remove the 'skipCliImportUntil' field"
    echo "Or install jq: brew install jq"
  fi
else
  echo "No config file found"
fi

echo ""
echo "Reset complete!"
echo ""
echo "Current state:"
echo "  - App credentials: CLEARED (will import from CLI)"
echo "  - skipCliImportUntil flag: CLEARED"
echo "  - CLI keychain: UNCHANGED (should have old token from console.anthropic.com)"
echo ""
echo "When you run 'bun run electron:dev', it should:"
echo "  1. Import old token from CLI"
echo "  2. Try to refresh → fail (400 error)"
echo "  3. Clear credentials and set skipCliImportUntil flag"
echo "  4. Prompt you to re-authenticate"
echo ""
