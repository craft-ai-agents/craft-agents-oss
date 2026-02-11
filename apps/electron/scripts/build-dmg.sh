#!/bin/bash
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
ARCH="arm64"
UPLOAD=false
UPLOAD_LATEST=false
UPLOAD_SCRIPT=false
CLEAN=false

show_help() {
    cat << EOF
Usage: build-dmg.sh [arm64|x64] [--upload] [--latest] [--script] [--clean]

Arguments:
  arm64|x64    Target architecture (default: arm64)
  --upload     Upload DMG to S3 after building
  --latest     Also update electron/latest (requires --upload)
  --script     Also upload install-app.sh (requires --upload)
  --clean      Full clean rebuild (delete cached Bun binary and SDK)

Environment variables (from .env or environment):
  APPLE_SIGNING_IDENTITY    - Code signing identity
  APPLE_ID                  - Apple ID for notarization
  APPLE_TEAM_ID             - Apple Team ID
  APPLE_APP_SPECIFIC_PASSWORD - App-specific password
  S3_VERSIONS_BUCKET_*      - S3 credentials (for --upload)
EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case $1 in
        arm64|x64)     ARCH="$1"; shift ;;
        --upload)      UPLOAD=true; shift ;;
        --latest)      UPLOAD_LATEST=true; shift ;;
        --script)      UPLOAD_SCRIPT=true; shift ;;
        --clean)       CLEAN=true; shift ;;
        -h|--help)     show_help ;;
        *)
            echo "Unknown option: $1"
            echo "Run with --help for usage"
            exit 1
            ;;
    esac
done

# Configuration — pinned versions for reproducible builds
BUN_VERSION="bun-v1.3.5"
DUGITE_TAG="v2.47.3-1"                                   # Git portable (dugite-native release tag)
DUGITE_PREFIX="dugite-native-v2.47.3-b6d6cfa"            # Filename prefix (includes commit hash)
NODE_VERSION="v22.11.0"
UV_VERSION="0.5.14"

echo "=== Building G4 OS DMG (${ARCH}) using electron-builder ==="
if [ "$UPLOAD" = true ]; then
    echo "Will upload to S3 after build"
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

# 3. Download Bun binary (skip if already cached and matches target arch)
# Check if cached bun matches target architecture
if [ -x "$ELECTRON_DIR/vendor/bun/bun" ]; then
    CACHED_ARCH=$(file "$ELECTRON_DIR/vendor/bun/bun" | grep -o 'arm64\|x86_64')
    TARGET_CHECK=$([ "$ARCH" = "arm64" ] && echo "arm64" || echo "x86_64")
    if [ "$CACHED_ARCH" != "$TARGET_CHECK" ]; then
        echo "Cached Bun is $CACHED_ARCH but target is $ARCH, re-downloading..."
        rm -f "$ELECTRON_DIR/vendor/bun/bun"
    fi
fi

if [ -x "$ELECTRON_DIR/vendor/bun/bun" ]; then
    echo "Bun binary already cached, skipping download"
else
    echo "Downloading Bun ${BUN_VERSION} for darwin-${ARCH}..."
    mkdir -p "$ELECTRON_DIR/vendor/bun"
    BUN_DOWNLOAD="bun-darwin-$([ "$ARCH" = "arm64" ] && echo "aarch64" || echo "x64")"

    # Create temp directory to avoid race conditions
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
    cp "$TEMP_DIR/${BUN_DOWNLOAD}/bun" "$ELECTRON_DIR/vendor/bun/"
    chmod +x "$ELECTRON_DIR/vendor/bun/bun"
fi

# 4. Download portable Git (dugite-native) — skip if already cached and matches arch
if [ -x "$ELECTRON_DIR/vendor/git/bin/git" ]; then
    CACHED_GIT_ARCH=$(file "$ELECTRON_DIR/vendor/git/bin/git" | grep -o 'arm64\|x86_64')
    TARGET_GIT_CHECK=$([ "$ARCH" = "arm64" ] && echo "arm64" || echo "x86_64")
    if [ "$CACHED_GIT_ARCH" != "$TARGET_GIT_CHECK" ]; then
        echo "Cached Git is $CACHED_GIT_ARCH but target is $ARCH, re-downloading..."
        rm -rf "$ELECTRON_DIR/vendor/git"
    fi
fi

if [ -x "$ELECTRON_DIR/vendor/git/bin/git" ]; then
    echo "Git binary already cached, skipping download"
else
    GIT_ARCH=$([[ "$ARCH" == "arm64" ]] && echo "arm64" || echo "x64")
    GIT_DOWNLOAD="${DUGITE_PREFIX}-macOS-${GIT_ARCH}.tar.gz"
    GIT_URL="https://github.com/desktop/dugite-native/releases/download/${DUGITE_TAG}/${GIT_DOWNLOAD}"
    echo "Downloading portable Git (${DUGITE_TAG}) for macOS-${GIT_ARCH}..."
    mkdir -p "$ELECTRON_DIR/vendor/git"

    GIT_TEMP=$(mktemp -d)
    curl -fSL "$GIT_URL" -o "$GIT_TEMP/${GIT_DOWNLOAD}"
    tar -xzf "$GIT_TEMP/${GIT_DOWNLOAD}" -C "$ELECTRON_DIR/vendor/git"
    chmod +x "$ELECTRON_DIR/vendor/git/bin/git"

    # Replace symlinks in libexec/git-core with copies of the main git binary.
    # dugite-native uses relative symlinks (e.g., git-fetch → git) which break
    # when electron-builder copies files into the .app bundle.
    GIT_CORE_DIR="$ELECTRON_DIR/vendor/git/libexec/git-core"
    if [ -d "$GIT_CORE_DIR" ]; then
        GIT_MAIN="$GIT_CORE_DIR/git"
        # If the main git binary is also a symlink, resolve it first
        if [ -L "$GIT_MAIN" ]; then
            REAL_GIT="$ELECTRON_DIR/vendor/git/bin/git"
            cp "$REAL_GIT" "$GIT_MAIN.tmp" && mv "$GIT_MAIN.tmp" "$GIT_MAIN"
        fi
        # Replace all remaining symlinks with hard links to the main binary
        find "$GIT_CORE_DIR" -type l | while read link; do
            rm "$link"
            ln "$GIT_MAIN" "$link"
        done
    fi

    rm -rf "$GIT_TEMP"
    echo "Git extracted to vendor/git/"
fi

# 5. Download portable Node.js — skip if already cached and matches arch
if [ -x "$ELECTRON_DIR/vendor/node/bin/node" ]; then
    CACHED_NODE_ARCH=$(file "$ELECTRON_DIR/vendor/node/bin/node" | grep -o 'arm64\|x86_64')
    TARGET_NODE_CHECK=$([ "$ARCH" = "arm64" ] && echo "arm64" || echo "x86_64")
    if [ "$CACHED_NODE_ARCH" != "$TARGET_NODE_CHECK" ]; then
        echo "Cached Node.js is $CACHED_NODE_ARCH but target is $ARCH, re-downloading..."
        rm -rf "$ELECTRON_DIR/vendor/node"
    fi
fi

if [ -x "$ELECTRON_DIR/vendor/node/bin/node" ]; then
    echo "Node.js binary already cached, skipping download"
else
    NODE_ARCH=$([[ "$ARCH" == "arm64" ]] && echo "arm64" || echo "x64")
    NODE_DOWNLOAD="node-${NODE_VERSION}-darwin-${NODE_ARCH}"
    NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_DOWNLOAD}.tar.gz"
    echo "Downloading Node.js ${NODE_VERSION} for darwin-${NODE_ARCH}..."
    mkdir -p "$ELECTRON_DIR/vendor/node"

    NODE_TEMP=$(mktemp -d)
    curl -fSL "$NODE_URL" -o "$NODE_TEMP/${NODE_DOWNLOAD}.tar.gz"

    # Verify checksum
    curl -fSL "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt" -o "$NODE_TEMP/SHASUMS256.txt"
    echo "Verifying Node.js checksum..."
    cd "$NODE_TEMP"
    grep "${NODE_DOWNLOAD}.tar.gz" SHASUMS256.txt | shasum -a 256 -c -
    cd - > /dev/null

    tar -xzf "$NODE_TEMP/${NODE_DOWNLOAD}.tar.gz" -C "$NODE_TEMP"
    # Copy bin/node and lib/ (includes npm)
    cp -r "$NODE_TEMP/${NODE_DOWNLOAD}/bin" "$ELECTRON_DIR/vendor/node/"
    cp -r "$NODE_TEMP/${NODE_DOWNLOAD}/lib" "$ELECTRON_DIR/vendor/node/"
    chmod +x "$ELECTRON_DIR/vendor/node/bin/node"
    rm -rf "$NODE_TEMP"
    echo "Node.js extracted to vendor/node/"
fi

# 6. Download uv — skip if already cached and matches arch
if [ -x "$ELECTRON_DIR/vendor/uv/uv" ]; then
    CACHED_UV_ARCH=$(file "$ELECTRON_DIR/vendor/uv/uv" | grep -o 'arm64\|x86_64')
    TARGET_UV_CHECK=$([ "$ARCH" = "arm64" ] && echo "arm64" || echo "x86_64")
    if [ "$CACHED_UV_ARCH" != "$TARGET_UV_CHECK" ]; then
        echo "Cached uv is $CACHED_UV_ARCH but target is $ARCH, re-downloading..."
        rm -rf "$ELECTRON_DIR/vendor/uv"
    fi
fi

if [ -x "$ELECTRON_DIR/vendor/uv/uv" ]; then
    echo "uv binary already cached, skipping download"
else
    UV_ARCH=$([[ "$ARCH" == "arm64" ]] && echo "aarch64" || echo "x86_64")
    UV_DOWNLOAD="uv-${UV_ARCH}-apple-darwin.tar.gz"
    UV_URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${UV_DOWNLOAD}"
    echo "Downloading uv ${UV_VERSION} for ${UV_ARCH}-apple-darwin..."
    mkdir -p "$ELECTRON_DIR/vendor/uv"

    UV_TEMP=$(mktemp -d)
    curl -fSL "$UV_URL" -o "$UV_TEMP/${UV_DOWNLOAD}"

    # Verify checksum (sha256 file already contains "hash  filename" format)
    curl -fSL "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${UV_DOWNLOAD}.sha256" -o "$UV_TEMP/uv.sha256"
    echo "Verifying uv checksum..."
    cd "$UV_TEMP"
    shasum -a 256 -c uv.sha256
    cd - > /dev/null

    tar -xzf "$UV_TEMP/${UV_DOWNLOAD}" -C "$UV_TEMP"
    # uv tarball extracts to a subdirectory with same name (minus .tar.gz)
    UV_EXTRACTED="uv-${UV_ARCH}-apple-darwin"
    cp "$UV_TEMP/${UV_EXTRACTED}/uv" "$ELECTRON_DIR/vendor/uv/"
    chmod +x "$ELECTRON_DIR/vendor/uv/uv"
    rm -rf "$UV_TEMP"
    echo "uv extracted to vendor/uv/"
fi

# 7. Copy SDK from root node_modules (monorepo hoisting)
# Note: The SDK is hoisted to root node_modules by the package manager.
# We copy it here because electron-builder only sees apps/electron/.
SDK_SOURCE="$ROOT_DIR/node_modules/@anthropic-ai/claude-agent-sdk"
require_path "$SDK_SOURCE" "SDK" "Run 'bun install' from the repository root first."
if [ -d "$ELECTRON_DIR/node_modules/@anthropic-ai/claude-agent-sdk" ]; then
    echo "SDK already present, skipping copy"
else
    echo "Copying SDK..."
    mkdir -p "$ELECTRON_DIR/node_modules/@anthropic-ai"
    cp -r "$SDK_SOURCE" "$ELECTRON_DIR/node_modules/@anthropic-ai/"
fi

# 8. Copy interceptor
INTERCEPTOR_SOURCE="$ROOT_DIR/packages/shared/src/network-interceptor.ts"
require_path "$INTERCEPTOR_SOURCE" "Interceptor" "Ensure packages/shared/src/network-interceptor.ts exists."
if [ -f "$ELECTRON_DIR/packages/shared/src/network-interceptor.ts" ]; then
    echo "Interceptor already present, skipping copy"
else
    echo "Copying interceptor..."
    mkdir -p "$ELECTRON_DIR/packages/shared/src"
    cp "$INTERCEPTOR_SOURCE" "$ELECTRON_DIR/packages/shared/src/"
fi

# 9. Build Electron app
echo "Building Electron app..."
cd "$ROOT_DIR"
bun run electron:build

# 10. Package with electron-builder
echo "Packaging app with electron-builder..."
cd "$ELECTRON_DIR"

# Set up environment for electron-builder
export CSC_IDENTITY_AUTO_DISCOVERY=true

# Build electron-builder arguments
BUILDER_ARGS="--mac --${ARCH}"

# Add code signing if identity is available
if [ -n "$APPLE_SIGNING_IDENTITY" ]; then
    # Strip "Developer ID Application: " prefix if present (electron-builder adds it automatically)
    CSC_NAME_CLEAN="${APPLE_SIGNING_IDENTITY#Developer ID Application: }"
    echo "Using signing identity: $CSC_NAME_CLEAN"
    export CSC_NAME="$CSC_NAME_CLEAN"
fi

# Add notarization if all credentials are available
if [ -n "$APPLE_ID" ] && [ -n "$APPLE_TEAM_ID" ] && [ -n "$APPLE_APP_SPECIFIC_PASSWORD" ]; then
    echo "Notarization enabled"
    export APPLE_ID="$APPLE_ID"
    export APPLE_TEAM_ID="$APPLE_TEAM_ID"
    export APPLE_APP_SPECIFIC_PASSWORD="$APPLE_APP_SPECIFIC_PASSWORD"

    # Enable notarization in electron-builder by setting env vars
    # The electron-builder.yml has notarize section commented out,
    # but we can enable it via environment
    export NOTARIZE=true
fi

# Run electron-builder
npx electron-builder $BUILDER_ARGS

# 11. Verify the DMG was built
# electron-builder.yml uses artifactName to output: G4OS-${arch}.dmg
DMG_NAME="G4OS-${ARCH}.dmg"
DMG_PATH="$ELECTRON_DIR/release/$DMG_NAME"

if [ ! -f "$DMG_PATH" ]; then
    echo "ERROR: Expected DMG not found at $DMG_PATH"
    echo "Contents of release directory:"
    ls -la "$ELECTRON_DIR/release/"
    exit 1
fi

echo ""
echo "=== Build Complete ==="
echo "DMG: $ELECTRON_DIR/release/${DMG_NAME}"
echo "Size: $(du -h "$ELECTRON_DIR/release/${DMG_NAME}" | cut -f1)"

# 12. Create manifest.json for upload script
# Read version from package.json
ELECTRON_VERSION=$(cat "$ELECTRON_DIR/package.json" | grep '"version"' | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
echo "Creating manifest.json (version: $ELECTRON_VERSION)..."
mkdir -p "$ROOT_DIR/.build/upload"
echo "{\"version\": \"$ELECTRON_VERSION\"}" > "$ROOT_DIR/.build/upload/manifest.json"

# 13. Upload to S3 (if --upload flag is set)
if [ "$UPLOAD" = true ]; then
    echo ""
    echo "=== Uploading to S3 ==="

    # Check for S3 credentials
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

    # Build upload flags
    UPLOAD_FLAGS="--electron"
    [ "$UPLOAD_LATEST" = true ] && UPLOAD_FLAGS="$UPLOAD_FLAGS --latest"
    [ "$UPLOAD_SCRIPT" = true ] && UPLOAD_FLAGS="$UPLOAD_FLAGS --script"

    cd "$ROOT_DIR"
    bun run scripts/upload.ts $UPLOAD_FLAGS

    echo ""
    echo "=== Upload Complete ==="
fi
