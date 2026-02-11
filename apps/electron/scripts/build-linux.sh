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

# Load environment variables from .env
if [ -f "$ROOT_DIR/.env" ]; then
    set -a
    source "$ROOT_DIR/.env"
    set +a
fi

# Parse arguments
ARCH="x64"
UPLOAD=false
UPLOAD_LATEST=false
UPLOAD_SCRIPT=false

show_help() {
    cat << EOF
Usage: build-linux.sh [x64|arm64] [--upload] [--latest] [--script]

Arguments:
  x64|arm64    Target architecture (default: x64)
  --upload     Upload AppImage to S3 after building
  --latest     Also update electron/latest (requires --upload)
  --script     Also upload install-app.sh (requires --upload)

Environment variables (from .env or environment):
  S3_VERSIONS_BUCKET_*      - S3 credentials (for --upload)
EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case $1 in
        x64|arm64)     ARCH="$1"; shift ;;
        --upload)      UPLOAD=true; shift ;;
        --latest)      UPLOAD_LATEST=true; shift ;;
        --script)      UPLOAD_SCRIPT=true; shift ;;
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

echo "=== Building G4 OS AppImage (${ARCH}) using electron-builder ==="
if [ "$UPLOAD" = true ]; then
    echo "Will upload to S3 after build"
fi

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
echo "Downloading Bun ${BUN_VERSION} for linux-${ARCH}..."
mkdir -p "$ELECTRON_DIR/vendor/bun"

# Map architecture names (electron uses x64/arm64, bun uses x64/aarch64)
if [ "$ARCH" = "arm64" ]; then
    BUN_DOWNLOAD="bun-linux-aarch64"
else
    BUN_DOWNLOAD="bun-linux-x64"
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
# Use sha256sum on Linux (not shasum)
grep "${BUN_DOWNLOAD}.zip" SHASUMS256.txt | sha256sum -c -
cd - > /dev/null

# Extract and install
unzip -o "$TEMP_DIR/${BUN_DOWNLOAD}.zip" -d "$TEMP_DIR"
cp "$TEMP_DIR/${BUN_DOWNLOAD}/bun" "$ELECTRON_DIR/vendor/bun/"
chmod +x "$ELECTRON_DIR/vendor/bun/bun"

# 4. Download portable Git (dugite-native) for Linux
GIT_ARCH=$([[ "$ARCH" == "arm64" ]] && echo "arm64" || echo "x64")
GIT_DOWNLOAD="${DUGITE_PREFIX}-ubuntu-${GIT_ARCH}.tar.gz"
GIT_URL="https://github.com/desktop/dugite-native/releases/download/${DUGITE_TAG}/${GIT_DOWNLOAD}"
echo "Downloading portable Git (${DUGITE_TAG}) for linux-${GIT_ARCH}..."
mkdir -p "$ELECTRON_DIR/vendor/git"

GIT_TEMP=$(mktemp -d)
curl -fSL "$GIT_URL" -o "$GIT_TEMP/${GIT_DOWNLOAD}"
tar -xzf "$GIT_TEMP/${GIT_DOWNLOAD}" -C "$ELECTRON_DIR/vendor/git"
chmod +x "$ELECTRON_DIR/vendor/git/bin/git"

# Replace symlinks in libexec/git-core with hard links to the main git binary.
# dugite-native uses relative symlinks (e.g., git-fetch → git) which break
# when electron-builder copies files into the AppImage.
GIT_CORE_DIR="$ELECTRON_DIR/vendor/git/libexec/git-core"
if [ -d "$GIT_CORE_DIR" ]; then
    GIT_MAIN="$GIT_CORE_DIR/git"
    if [ -L "$GIT_MAIN" ]; then
        REAL_GIT="$ELECTRON_DIR/vendor/git/bin/git"
        cp "$REAL_GIT" "$GIT_MAIN.tmp" && mv "$GIT_MAIN.tmp" "$GIT_MAIN"
    fi
    find "$GIT_CORE_DIR" -type l | while read link; do
        rm "$link"
        ln "$GIT_MAIN" "$link"
    done
fi

rm -rf "$GIT_TEMP"
echo "Git extracted to vendor/git/"

# 5. Download portable Node.js for Linux
NODE_ARCH=$([[ "$ARCH" == "arm64" ]] && echo "arm64" || echo "x64")
NODE_DOWNLOAD="node-${NODE_VERSION}-linux-${NODE_ARCH}"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_DOWNLOAD}.tar.xz"
echo "Downloading Node.js ${NODE_VERSION} for linux-${NODE_ARCH}..."
mkdir -p "$ELECTRON_DIR/vendor/node"

NODE_TEMP=$(mktemp -d)
curl -fSL "$NODE_URL" -o "$NODE_TEMP/${NODE_DOWNLOAD}.tar.xz"

# Verify checksum
curl -fSL "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt" -o "$NODE_TEMP/SHASUMS256.txt"
echo "Verifying Node.js checksum..."
cd "$NODE_TEMP"
grep "${NODE_DOWNLOAD}.tar.xz" SHASUMS256.txt | sha256sum -c -
cd - > /dev/null

tar -xJf "$NODE_TEMP/${NODE_DOWNLOAD}.tar.xz" -C "$NODE_TEMP"
cp -r "$NODE_TEMP/${NODE_DOWNLOAD}/bin" "$ELECTRON_DIR/vendor/node/"
cp -r "$NODE_TEMP/${NODE_DOWNLOAD}/lib" "$ELECTRON_DIR/vendor/node/"
chmod +x "$ELECTRON_DIR/vendor/node/bin/node"
rm -rf "$NODE_TEMP"
echo "Node.js extracted to vendor/node/"

# 6. Download uv for Linux
UV_ARCH=$([[ "$ARCH" == "arm64" ]] && echo "aarch64" || echo "x86_64")
UV_DOWNLOAD="uv-${UV_ARCH}-unknown-linux-gnu.tar.gz"
UV_URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${UV_DOWNLOAD}"
echo "Downloading uv ${UV_VERSION} for ${UV_ARCH}-linux..."
mkdir -p "$ELECTRON_DIR/vendor/uv"

UV_TEMP=$(mktemp -d)
curl -fSL "$UV_URL" -o "$UV_TEMP/${UV_DOWNLOAD}"

# Verify checksum (sha256 file already contains "hash  filename" format)
curl -fSL "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${UV_DOWNLOAD}.sha256" -o "$UV_TEMP/uv.sha256"
echo "Verifying uv checksum..."
cd "$UV_TEMP"
sha256sum -c uv.sha256
cd - > /dev/null

tar -xzf "$UV_TEMP/${UV_DOWNLOAD}" -C "$UV_TEMP"
UV_EXTRACTED="uv-${UV_ARCH}-unknown-linux-gnu"
cp "$UV_TEMP/${UV_EXTRACTED}/uv" "$ELECTRON_DIR/vendor/uv/"
chmod +x "$ELECTRON_DIR/vendor/uv/uv"
rm -rf "$UV_TEMP"
echo "uv extracted to vendor/uv/"

# 7. Copy SDK from root node_modules (monorepo hoisting)
# Note: The SDK is hoisted to root node_modules by the package manager.
# We copy it here because electron-builder only sees apps/electron/.
SDK_SOURCE="$ROOT_DIR/node_modules/@anthropic-ai/claude-agent-sdk"
require_path "$SDK_SOURCE" "SDK" "Run 'bun install' from the repository root first."
echo "Copying SDK..."
mkdir -p "$ELECTRON_DIR/node_modules/@anthropic-ai"
cp -r "$SDK_SOURCE" "$ELECTRON_DIR/node_modules/@anthropic-ai/"

# 8. Copy interceptor
INTERCEPTOR_SOURCE="$ROOT_DIR/packages/shared/src/network-interceptor.ts"
require_path "$INTERCEPTOR_SOURCE" "Interceptor" "Ensure packages/shared/src/network-interceptor.ts exists."
echo "Copying interceptor..."
mkdir -p "$ELECTRON_DIR/packages/shared/src"
cp "$INTERCEPTOR_SOURCE" "$ELECTRON_DIR/packages/shared/src/"

# 9. Build Electron app
echo "Building Electron app..."
cd "$ROOT_DIR"
bun run electron:build

# 10. Package with electron-builder
echo "Packaging app with electron-builder..."
cd "$ELECTRON_DIR"

# Run electron-builder
# Note: electron-builder may build both archs due to config, but we only use the requested one
npx electron-builder --linux --${ARCH}

# 11. Verify the AppImage was built
# electron-builder uses Linux-style arch names: x86_64 for x64, aarch64 for arm64
if [ "$ARCH" = "x64" ]; then
    LINUX_ARCH="x86_64"
else
    LINUX_ARCH="aarch64"
fi

# electron-builder outputs: G4OS-x86_64.AppImage or G4OS-aarch64.AppImage
BUILT_APPIMAGE_NAME="G4OS-${LINUX_ARCH}.AppImage"
BUILT_APPIMAGE_PATH="$ELECTRON_DIR/release/$BUILT_APPIMAGE_NAME"

if [ ! -f "$BUILT_APPIMAGE_PATH" ]; then
    echo "ERROR: Expected AppImage not found at $BUILT_APPIMAGE_PATH"
    echo "Contents of release directory:"
    ls -la "$ELECTRON_DIR/release/"
    exit 1
fi

# Rename to our standard naming convention: G4OS-x64.AppImage, G4OS-arm64.AppImage
APPIMAGE_NAME="G4OS-${ARCH}.AppImage"
APPIMAGE_PATH="$ELECTRON_DIR/release/$APPIMAGE_NAME"
mv "$BUILT_APPIMAGE_PATH" "$APPIMAGE_PATH"
echo "Renamed $BUILT_APPIMAGE_NAME -> $APPIMAGE_NAME"

echo ""
echo "=== Build Complete ==="
echo "AppImage: $ELECTRON_DIR/release/${APPIMAGE_NAME}"
echo "Size: $(du -h "$ELECTRON_DIR/release/${APPIMAGE_NAME}" | cut -f1)"

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
