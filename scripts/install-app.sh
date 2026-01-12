#!/bin/bash

set -e

VERSIONS_URL="https://agents.craft.do/electron"
DOWNLOAD_DIR="$HOME/.craft-agent/downloads"
APP_NAME="Craft Agent.app"
INSTALL_DIR="/Applications"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

info() { printf "%b\n" "${BLUE}>${NC} $1"; }
success() { printf "%b\n" "${GREEN}>${NC} $1"; }
warn() { printf "%b\n" "${YELLOW}!${NC} $1"; }
error() { printf "%b\n" "${RED}x${NC} $1"; exit 1; }

# Check for macOS
if [ "$(uname -s)" != "Darwin" ]; then
    error "This installer is for macOS only. For Linux, use the TUI version: curl -fsSL https://agents.craft.do/install.sh | bash"
fi

# Check for required dependencies
DOWNLOADER=""
if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
else
    error "Either curl or wget is required but neither is installed"
fi

# Check if jq is available (optional)
HAS_JQ=false
if command -v jq >/dev/null 2>&1; then
    HAS_JQ=true
fi

# Download function that works with both curl and wget
# Usage: download_file <url> [output_file] [show_progress]
download_file() {
    local url="$1"
    local output="$2"
    local show_progress="${3:-false}"

    if [ "$DOWNLOADER" = "curl" ]; then
        if [ -n "$output" ]; then
            if [ "$show_progress" = "true" ]; then
                curl -fL --progress-bar -o "$output" "$url"
            else
                curl -fsSL -o "$output" "$url"
            fi
        else
            curl -fsSL "$url"
        fi
    elif [ "$DOWNLOADER" = "wget" ]; then
        if [ -n "$output" ]; then
            if [ "$show_progress" = "true" ]; then
                wget --show-progress -q -O "$output" "$url"
            else
                wget -q -O "$output" "$url"
            fi
        else
            wget -q -O - "$url"
        fi
    else
        return 1
    fi
}

# Simple JSON parser for extracting values when jq is not available
get_json_value() {
    local json="$1"
    local key="$2"

    # Normalize JSON to single line
    json=$(echo "$json" | tr -d '\n\r\t' | sed 's/ \+/ /g')

    # Extract value using bash regex
    if [[ $json =~ \"$key\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
        echo "${BASH_REMATCH[1]}"
        return 0
    fi

    return 1
}

# Extract checksum from manifest for a specific platform
get_checksum_from_manifest() {
    local json="$1"
    local platform="$2"

    # Normalize JSON to single line
    json=$(echo "$json" | tr -d '\n\r\t' | sed 's/ \+/ /g')

    # Extract checksum for platform using bash regex
    if [[ $json =~ \"$platform\"[^}]*\"sha256\"[[:space:]]*:[[:space:]]*\"([a-f0-9]{64})\" ]]; then
        echo "${BASH_REMATCH[1]}"
        return 0
    fi

    return 1
}

# Detect architecture
case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) error "Unsupported architecture: $(uname -m)" ;;
esac

platform="darwin-${arch}"
echo ""
info "Detected platform: $platform"

mkdir -p "$DOWNLOAD_DIR"

# Get latest version
info "Fetching latest version..."
latest_json=$(download_file "$VERSIONS_URL/latest")

if [ "$HAS_JQ" = true ]; then
    version=$(echo "$latest_json" | jq -r '.version // empty')
else
    version=$(get_json_value "$latest_json" "version")
fi

if [ -z "$version" ]; then
    error "Failed to get latest version"
fi

info "Latest version: $version"

# Download manifest and extract checksum
info "Fetching manifest..."
manifest_json=$(download_file "$VERSIONS_URL/$version/manifest.json")

if [ "$HAS_JQ" = true ]; then
    checksum=$(echo "$manifest_json" | jq -r ".binaries[\"$platform\"].sha256 // empty")
    filename=$(echo "$manifest_json" | jq -r ".binaries[\"$platform\"].filename // empty")
else
    checksum=$(get_checksum_from_manifest "$manifest_json" "$platform")
    # Fallback filename if not using jq
    filename="Craft-Agent-${arch}.dmg"
fi

# Validate checksum format (SHA256 = 64 hex characters)
if [ -z "$checksum" ] || [[ ! "$checksum" =~ ^[a-f0-9]{64}$ ]]; then
    error "Platform $platform not found in manifest"
fi

# Use default filename if not in manifest
if [ -z "$filename" ]; then
    filename="Craft-Agent-${arch}.dmg"
fi

info "Expected checksum: ${checksum:0:16}..."

# Download DMG
dmg_url="$VERSIONS_URL/$version/$filename"
dmg_path="$DOWNLOAD_DIR/$filename"

info "Downloading $filename..."
echo ""
if ! download_file "$dmg_url" "$dmg_path" true; then
    rm -f "$dmg_path"
    error "Download failed"
fi
echo ""

# Verify checksum
info "Verifying checksum..."
actual=$(shasum -a 256 "$dmg_path" | cut -d' ' -f1)

if [ "$actual" != "$checksum" ]; then
    rm -f "$dmg_path"
    error "Checksum verification failed\n  Expected: $checksum\n  Actual:   $actual"
fi

success "Checksum verified!"

# Quit the app if it's running
if pgrep -x "Craft Agent" >/dev/null 2>&1; then
    info "Quitting Craft Agent..."
    osascript -e 'quit app "Craft Agent"' 2>/dev/null || true
    # Wait for app to quit (max 5 seconds)
    for i in {1..10}; do
        if ! pgrep -x "Craft Agent" >/dev/null 2>&1; then
            break
        fi
        sleep 0.5
    done
    # Force kill if still running
    if pgrep -x "Craft Agent" >/dev/null 2>&1; then
        warn "Force quitting Craft Agent..."
        pkill -9 -x "Craft Agent" 2>/dev/null || true
        sleep 1
    fi
fi

# Remove existing installation if present
if [ -d "$INSTALL_DIR/$APP_NAME" ]; then
    info "Removing previous installation..."
    rm -rf "$INSTALL_DIR/$APP_NAME" 2>/dev/null || {
        warn "Could not remove existing app, trying with sudo..."
        sudo rm -rf "$INSTALL_DIR/$APP_NAME"
    }
fi

# Mount DMG
info "Mounting disk image..."
mount_point=$(hdiutil attach "$dmg_path" -nobrowse -mountrandom /tmp 2>/dev/null | tail -1 | awk '{print $NF}')

if [ -z "$mount_point" ] || [ ! -d "$mount_point" ]; then
    rm -f "$dmg_path"
    error "Failed to mount DMG"
fi

# Find the .app in the mounted volume
app_source=$(find "$mount_point" -maxdepth 1 -name "*.app" -type d | head -1)

if [ -z "$app_source" ]; then
    hdiutil detach "$mount_point" -quiet 2>/dev/null || true
    rm -f "$dmg_path"
    error "No .app found in DMG"
fi

# Copy app to /Applications using ditto (handles macOS bundles better than cp)
info "Installing to $INSTALL_DIR..."
if ! ditto "$app_source" "$INSTALL_DIR/$APP_NAME" 2>/dev/null; then
    warn "Install failed, trying with sudo..."
    sudo ditto "$app_source" "$INSTALL_DIR/$APP_NAME"
fi

# Unmount DMG
info "Cleaning up..."
hdiutil detach "$mount_point" -quiet 2>/dev/null || true
rm -f "$dmg_path"

# Remove quarantine attribute if present
xattr -rd com.apple.quarantine "$INSTALL_DIR/$APP_NAME" 2>/dev/null || true

echo ""
echo "─────────────────────────────────────────────────────────────────────────"
echo ""
success "Installation complete!"
echo ""
printf "%b\n" "  Craft Agent has been installed to ${BOLD}$INSTALL_DIR/$APP_NAME${NC}"
echo ""
printf "%b\n" "  You can launch it from ${BOLD}Applications${NC} or by running:"
printf "%b\n" "    ${BOLD}open -a 'Craft Agent'${NC}"
echo ""
