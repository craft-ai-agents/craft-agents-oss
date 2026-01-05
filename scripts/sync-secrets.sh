#!/bin/bash
# Sync development secrets from 1Password to .env
# Run once after cloning, or when secrets change
#
# Usage: bun run sync-secrets
#
# Prerequisites:
# 1. Install 1Password CLI: brew install 1password-cli
# 2. Enable CLI integration in 1Password app: Settings > Developer > CLI Integration
# 3. Have access to the Dev_Craft_Agents vault

set -e

ENV_FILE=".env"
OP_ENV_FILE=".env.1password"

# Check if 1Password CLI is installed
if ! command -v op &> /dev/null; then
    echo "Error: 1Password CLI (op) is not installed"
    echo "Install with: brew install 1password-cli"
    exit 1
fi

# Check if .env.1password exists
if [ ! -f "$OP_ENV_FILE" ]; then
    echo "Error: $OP_ENV_FILE not found"
    exit 1
fi

echo "Syncing secrets from 1Password to $ENV_FILE..."

# Use op inject to resolve references and create .env
op inject -i "$OP_ENV_FILE" -o "$ENV_FILE"

echo "Done! Secrets synced to $ENV_FILE"
echo ""
echo "You can now run:"
echo "  bun run electron:dev"
echo "  bun run electron:start"
