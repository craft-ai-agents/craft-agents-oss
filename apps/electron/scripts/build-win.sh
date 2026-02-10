#!/bin/bash
# Cross-compile Windows NSIS installer from macOS
# Usage: bash scripts/build-win.sh [--upload] [--latest] [--clean] [--help]
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$(dirname "$ELECTRON_DIR")")"

# Helper function to check required file/directory exists
require_path() {
    local path="$1"
    local description="$2"
    local hint="$3"

    if [ ! -e "$path" ]; then
        echo "ERROR: $description not found at $path"
        [ -n "$hint" ] && echo "$hint"
        exit 1
    fi
}

# Sync secrets from 1Password if CLI is available
if command -v op &> /dev/null; then
    echo "1Password CLI detected, syncing secrets..."
    cd "$ROOT_DIR"
    if bun run sync-secrets 2>/dev/null; then
        echo "Secrets synced from 1Password"
    else
        echo "Warning: Failed to sync secrets from 1Password (continuing with existing .env if present)"
    fi
fi

# Load environment variables from .env
if [ -f "$ROOT_DIR/.env" ]; then
    set -a
    source "$ROOT_DIR/.env"
    set +a
fi

# Parse arguments
UPLOAD=false
UPLOAD_LATEST=false
CLEAN=false

show_help() {
    cat << EOF
Usage: build-win.sh [--upload] [--latest] [--clean]

Cross-compiles a Windows NSIS installer from macOS using electron-builder.

Arguments:
  --upload     Upload installer after building
  --latest     Also update electron/latest (requires --upload)
  --clean      Full clean rebuild (delete cached Bun binary and SDK)

Environment variables (from .env or environment):
  S3_VERSIONS_BUCKET_*      - S3 credentials (for --upload)

Note: Windows code signing is not supported in cross-compilation mode.
      The installer will be unsigned.
EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --upload)      UPLOAD=true; shift ;;
        --latest)      UPLOAD_LATEST=true; shift ;;
        --clean)       CLEAN=true; shift ;;
        -h|--help)     show_help ;;
        *)
            echo "Unknown option: $1"
            echo "Run with --help for usage"
            exit 1
            ;;
    esac
done

# Configuration
BUN_VERSION="bun-v1.3.5"  # Pinned version for reproducible builds
ARCH="x64"                # Windows ARM not supported

echo "=== Cross-compiling G4 OS Windows Installer (${ARCH}) from macOS ==="
if [ "$UPLOAD" = true ]; then
    echo "Will upload after build"
fi

# 1. Clean previous build artifacts (keep cached vendor/bun and SDK unless --clean)
echo "Cleaning previous builds..."
if [ "$CLEAN" = true ]; then
    echo "Full clean requested (--clean)"
    rm -rf "$ELECTRON_DIR/vendor"
    rm -rf "$ELECTRON_DIR/node_modules/@anthropic-ai"
    rm -rf "$ELECTRON_DIR/packages"
fi
rm -rf "$ELECTRON_DIR/release"

# 2. Install dependencies
echo "Installing dependencies..."
cd "$ROOT_DIR"
bun install

# 3. Download Bun for Windows (skip if already cached)
# Use baseline build — works on all x64 CPUs (no AVX2 requirement)
if [ -f "$ELECTRON_DIR/vendor/bun/bun.exe" ]; then
    echo "Bun Windows binary already cached, skipping download"
else
    echo "Downloading Bun ${BUN_VERSION} for Windows x64 (baseline)..."
    mkdir -p "$ELECTRON_DIR/vendor/bun"

    BUN_DOWNLOAD="bun-windows-x64-baseline"

    # Create temp directory
    TEMP_DIR=$(mktemp -d)
    trap "rm -rf $TEMP_DIR" EXIT

    # Download binary and checksums
    curl -fSL "https://github.com/oven-sh/bun/releases/download/${BUN_VERSION}/${BUN_DOWNLOAD}.zip" -o "$TEMP_DIR/${BUN_DOWNLOAD}.zip"
    curl -fSL "https://github.com/oven-sh/bun/releases/download/${BUN_VERSION}/SHASUMS256.txt" -o "$TEMP_DIR/SHASUMS256.txt"

    # Verify checksum
    echo "Verifying checksum..."
    cd "$TEMP_DIR"
    grep "${BUN_DOWNLOAD}.zip" SHASUMS256.txt | shasum -a 256 -c -
    cd - > /dev/null

    # Extract and install
    unzip -o "$TEMP_DIR/${BUN_DOWNLOAD}.zip" -d "$TEMP_DIR"
    cp "$TEMP_DIR/${BUN_DOWNLOAD}/bun.exe" "$ELECTRON_DIR/vendor/bun/"
fi

# 4. Copy SDK from root node_modules (monorepo hoisting)
SDK_SOURCE="$ROOT_DIR/node_modules/@anthropic-ai/claude-agent-sdk"
require_path "$SDK_SOURCE" "SDK" "Run 'bun install' from the repository root first."
if [ -d "$ELECTRON_DIR/node_modules/@anthropic-ai/claude-agent-sdk" ]; then
    echo "SDK already present, skipping copy"
else
    echo "Copying SDK..."
    mkdir -p "$ELECTRON_DIR/node_modules/@anthropic-ai"
    cp -r "$SDK_SOURCE" "$ELECTRON_DIR/node_modules/@anthropic-ai/"
fi

# 5. Copy interceptor
INTERCEPTOR_SOURCE="$ROOT_DIR/packages/shared/src/network-interceptor.ts"
require_path "$INTERCEPTOR_SOURCE" "Interceptor" "Ensure packages/shared/src/network-interceptor.ts exists."
if [ -f "$ELECTRON_DIR/packages/shared/src/network-interceptor.ts" ]; then
    echo "Interceptor already present, skipping copy"
else
    echo "Copying interceptor..."
    mkdir -p "$ELECTRON_DIR/packages/shared/src"
    cp "$INTERCEPTOR_SOURCE" "$ELECTRON_DIR/packages/shared/src/"
fi

# 6. Build Electron app
echo "Building Electron app..."
cd "$ROOT_DIR"
bun run electron:build

# 7. Package with electron-builder (cross-compile for Windows)
echo "Packaging app with electron-builder (cross-compile)..."
cd "$ELECTRON_DIR"

# Disable macOS code signing auto-discovery (not relevant for Windows target)
export CSC_IDENTITY_AUTO_DISCOVERY=false

npx electron-builder --win --x64

# 8. Verify the installer was built
EXE_NAME="G4OS-${ARCH}.exe"
EXE_PATH="$ELECTRON_DIR/release/$EXE_NAME"

if [ ! -f "$EXE_PATH" ]; then
    echo "ERROR: Expected installer not found at $EXE_PATH"
    echo "Contents of release directory:"
    ls -la "$ELECTRON_DIR/release/"
    exit 1
fi

echo ""
echo "=== Build Complete ==="
echo "Installer: $ELECTRON_DIR/release/${EXE_NAME}"
echo "Size: $(du -h "$ELECTRON_DIR/release/${EXE_NAME}" | cut -f1)"

# 9. Create manifest.json for upload script
ELECTRON_VERSION=$(cat "$ELECTRON_DIR/package.json" | grep '"version"' | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
echo "Creating manifest.json (version: $ELECTRON_VERSION)..."
mkdir -p "$ROOT_DIR/.build/upload"
echo "{\"version\": \"$ELECTRON_VERSION\"}" > "$ROOT_DIR/.build/upload/manifest.json"

# 10. Upload (if --upload flag is set)
if [ "$UPLOAD" = true ]; then
    echo ""
    echo "=== Uploading ==="

    if [ -z "$S3_VERSIONS_BUCKET_ENDPOINT" ] || [ -z "$S3_VERSIONS_BUCKET_ACCESS_KEY_ID" ] || [ -z "$S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY" ]; then
        cat << EOF
ERROR: Missing S3 credentials. Set these environment variables:
  S3_VERSIONS_BUCKET_ENDPOINT
  S3_VERSIONS_BUCKET_ACCESS_KEY_ID
  S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY

You can add them to .env or export them directly.
EOF
        exit 1
    fi

    UPLOAD_FLAGS="--electron"
    [ "$UPLOAD_LATEST" = true ] && UPLOAD_FLAGS="$UPLOAD_FLAGS --latest"

    cd "$ROOT_DIR"
    bun run scripts/upload.ts $UPLOAD_FLAGS

    echo ""
    echo "=== Upload Complete ==="
fi
