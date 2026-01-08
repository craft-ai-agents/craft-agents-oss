#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$(dirname "$ELECTRON_DIR")")"

# Configuration
ARCH="${1:-arm64}"  # arm64 or x64
BUN_VERSION="bun-v1.3.5"  # Pinned version for reproducible builds

echo "=== Building Craft Agent DMG (${ARCH}) ==="

# 1. Clean previous build artifacts
echo "Cleaning previous builds..."
rm -rf "$ELECTRON_DIR/vendor"
rm -rf "$ELECTRON_DIR/node_modules/@anthropic-ai"
rm -rf "$ELECTRON_DIR/packages"
rm -rf "$ELECTRON_DIR/release"

# 2. Install dependencies
echo "Installing dependencies..."
cd "$ROOT_DIR"
bun install

# 3. Download Bun binary with checksum verification
echo "Downloading Bun ${BUN_VERSION} for darwin-${ARCH}..."
mkdir -p "$ELECTRON_DIR/vendor/bun"
if [ "$ARCH" = "arm64" ]; then
    BUN_DOWNLOAD="bun-darwin-aarch64"
else
    BUN_DOWNLOAD="bun-darwin-x64"
fi

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

# 4. Copy SDK from root node_modules (monorepo hoisting)
# Note: The SDK is hoisted to root node_modules by the package manager.
# We copy it here because electron-packager only sees apps/electron/.
SDK_SOURCE="$ROOT_DIR/node_modules/@anthropic-ai/claude-agent-sdk"
if [ ! -d "$SDK_SOURCE" ]; then
    echo "ERROR: SDK not found at $SDK_SOURCE"
    echo "Run 'bun install' from the repository root first."
    exit 1
fi
echo "Copying SDK..."
mkdir -p "$ELECTRON_DIR/node_modules/@anthropic-ai"
cp -r "$SDK_SOURCE" "$ELECTRON_DIR/node_modules/@anthropic-ai/"

# 5. Copy interceptor
INTERCEPTOR_SOURCE="$ROOT_DIR/packages/shared/src/cache-ttl-interceptor.ts"
if [ ! -f "$INTERCEPTOR_SOURCE" ]; then
    echo "ERROR: Interceptor not found at $INTERCEPTOR_SOURCE"
    echo "Ensure packages/shared/src/cache-ttl-interceptor.ts exists."
    exit 1
fi
echo "Copying interceptor..."
mkdir -p "$ELECTRON_DIR/packages/shared/src"
cp "$INTERCEPTOR_SOURCE" "$ELECTRON_DIR/packages/shared/src/"

# 6. Build Electron app
echo "Building Electron app..."
cd "$ROOT_DIR"
bun run electron:build

# 7. Package with electron-packager (no ASAR for subprocess compatibility)
echo "Packaging app..."
cd "$ELECTRON_DIR"
npx electron-packager . "Craft Agent" \
    --platform=darwin \
    --arch="$ARCH" \
    --out=release \
    --overwrite \
    --icon=resources/icon.icns \
    --app-bundle-id=com.lukilabs.craft-agent \
    --no-prune \
    --ignore="node_modules/@types" \
    --ignore="node_modules/typescript" \
    --ignore="node_modules/eslint" \
    --ignore="node_modules/@eslint" \
    --ignore="node_modules/prettier" \
    --ignore="node_modules/@typescript-eslint" \
    --ignore="node_modules/vite" \
    --ignore="node_modules/@vitejs" \
    --ignore="node_modules/esbuild" \
    --ignore="node_modules/tailwindcss" \
    --ignore="node_modules/postcss" \
    --ignore="node_modules/autoprefixer" \
    --ignore="\.map$" \
    --ignore="node_modules/.*\.ts$" \
    --ignore="node_modules/.*\.tsx$" \
    --ignore="\.md$" \
    --ignore="LICENSE" \
    --ignore="CHANGELOG" \
    --ignore="README" \
    --ignore="__tests__" \
    --ignore="test" \
    --ignore="tests" \
    --ignore="\.test\." \
    --ignore="\.spec\." \
    --no-asar

# 8. Create DMG
echo "Creating DMG..."
DMG_NAME="Craft-Agent-${ARCH}.dmg"
hdiutil create \
    -volname "Craft Agent" \
    -srcfolder "release/Craft Agent-darwin-${ARCH}/Craft Agent.app" \
    -ov \
    -format UDZO \
    "release/${DMG_NAME}"

echo ""
echo "=== Build Complete ==="
echo "DMG: $ELECTRON_DIR/release/${DMG_NAME}"
echo "Size: $(du -h "$ELECTRON_DIR/release/${DMG_NAME}" | cut -f1)"
