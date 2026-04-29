#!/bin/bash

set -e

VERSIONS_URL="https://agents.craft.do/cli"
DOWNLOAD_DIR="$HOME/.craft-agent/downloads"
INSTALL_DIR="$HOME/.local/bin"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

info() { printf "%b\n" "${BLUE}→${NC} $1"; }
success() { printf "%b\n" "${GREEN}✓${NC} $1"; }
warn() { printf "%b\n" "${YELLOW}!${NC} $1"; }
error() { printf "%b\n" "${RED}✗${NC} $1"; exit 1; }

# Check for required dependencies
DOWNLOADER=""
if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
else
    echo "Either curl or wget is required but neither is installed" >&2
    exit 1
fi

# Check if jq is available (optional)
HAS_JQ=false
if command -v jq >/dev/null 2>&1; then
    HAS_JQ=true
fi

# Download function that works with both curl and wget
download_file() {
    local url="$1"
    local output="$2"
    
    if [ "$DOWNLOADER" = "curl" ]; then
        if [ -n "$output" ]; then
            curl -fsSL -o "$output" "$url"
        else
            curl -fsSL "$url"
        fi
    elif [ "$DOWNLOADER" = "wget" ]; then
        if [ -n "$output" ]; then
            wget -q -O "$output" "$url"
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

# Detect platform
case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *) echo "Unsupported OS: $(uname -s). Only macOS and Linux are supported." >&2; exit 1 ;;
esac

case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

platform="${os}-${arch}"
echo "Detected platform: $platform"

mkdir -p "$DOWNLOAD_DIR"

# Get latest version
echo "Fetching latest version..."
latest_json=$(download_file "$VERSIONS_URL/latest")

if [ "$HAS_JQ" = true ]; then
    version=$(echo "$latest_json" | jq -r '.version // empty')
else
    version=$(get_json_value "$latest_json" "version")
fi

if [ -z "$version" ]; then
    echo "Failed to get latest version" >&2
    exit 1
fi

echo "Latest version: $version"

# Download manifest and extract checksum
echo "Fetching manifest..."
manifest_json=$(download_file "$VERSIONS_URL/$version/manifest.json")

if [ "$HAS_JQ" = true ]; then
    checksum=$(echo "$manifest_json" | jq -r ".binaries[\"$platform\"].sha256 // empty")
else
    checksum=$(get_checksum_from_manifest "$manifest_json" "$platform")
fi

# Validate checksum format (SHA256 = 64 hex characters)
if [ -z "$checksum" ] || [[ ! "$checksum" =~ ^[a-f0-9]{64}$ ]]; then
    echo "Platform $platform not found in manifest" >&2
    exit 1
fi

echo "Expected checksum: $checksum"

# Download tarball
tarball_url="$VERSIONS_URL/$version/$platform.tar.gz"
tarball_path="$DOWNLOAD_DIR/craft-$version-$platform.tar.gz"

echo "Downloading $tarball_url..."
if ! download_file "$tarball_url" "$tarball_path"; then
    echo "Download failed" >&2
    rm -f "$tarball_path"
    exit 1
fi

# Verify checksum
echo "Verifying checksum..."
if [ "$os" = "darwin" ]; then
    actual=$(shasum -a 256 "$tarball_path" | cut -d' ' -f1)
else
    actual=$(sha256sum "$tarball_path" | cut -d' ' -f1)
fi

if [ "$actual" != "$checksum" ]; then
    echo "Checksum verification failed" >&2
    echo "  Expected: $checksum" >&2
    echo "  Actual:   $actual" >&2
    rm -f "$tarball_path"
    exit 1
fi

echo "Checksum verified!"

# Extract to temporary directory
extract_dir="$DOWNLOAD_DIR/extract-$version"
rm -rf "$extract_dir"
mkdir -p "$extract_dir"

echo "Extracting archive..."
tar -xzf "$tarball_path" -C "$extract_dir"

binary_path="$extract_dir/craft"
chmod +x "$binary_path"

# Move binary to final location
echo ""
info "Installing binary..."
mkdir -p "$INSTALL_DIR"
mv "$binary_path" "$INSTALL_DIR/craft"
chmod +x "$INSTALL_DIR/craft"

success "Binary installed to $INSTALL_DIR/craft"

# Install SDK and support files to versioned directory
# The compiled binary expects these at ~/.local/share/craft/versions/{version}/
VERSION_DIR="$HOME/.local/share/craft/versions/$version"
info "Installing SDK files to $VERSION_DIR..."
rm -rf "$VERSION_DIR"
mkdir -p "$VERSION_DIR"

# Copy claude-agent-sdk folder. Since SDK 0.2.113 this directory contains
# the native `claude` (or `claude.exe`) binary instead of `cli.js` — the Craft
# CLI subprocess-spawns it directly.
if [ -d "$extract_dir/claude-agent-sdk" ]; then
    cp -r "$extract_dir/claude-agent-sdk" "$VERSION_DIR/"
    # Ensure the native binary is executable on Unix.
    if [ -f "$VERSION_DIR/claude-agent-sdk/claude" ]; then
        chmod +x "$VERSION_DIR/claude-agent-sdk/claude"
    fi
    success "Installed claude-agent-sdk"
else
    warn "claude-agent-sdk not found in archive"
fi

# Clean up
rm -rf "$tarball_path" "$extract_dir"

# ─────────────────────────────────────────────────────────────────────────────
# PATH Configuration
# ─────────────────────────────────────────────────────────────────────────────

# Detect shell and config file
detect_shell_config() {
    local shell_name
    shell_name=$(basename "$SHELL")

    case "$shell_name" in
        zsh)
            # zsh: prefer .zshrc, fall back to .zprofile
            if [ -f "$HOME/.zshrc" ]; then
                echo "$HOME/.zshrc"
            else
                echo "$HOME/.zprofile"
            fi
            ;;
        bash)
            # bash: prefer .bashrc for interactive, .bash_profile for login
            if [ -f "$HOME/.bashrc" ]; then
                echo "$HOME/.bashrc"
            elif [ -f "$HOME/.bash_profile" ]; then
                echo "$HOME/.bash_profile"
            else
                echo "$HOME/.bashrc"
            fi
            ;;
        fish)
            echo "$HOME/.config/fish/config.fish"
            ;;
        *)
            # Default to .profile for unknown shells
            echo "$HOME/.profile"
            ;;
    esac
}

# Check if PATH is already configured
is_path_configured() {
    case "$PATH" in
        *"$INSTALL_DIR"*) return 0 ;;
        *) return 1 ;;
    esac
}

# Check if config file already has the PATH export
config_has_path() {
    local config_file="$1"
    if [ -f "$config_file" ]; then
        grep -q "\.local/bin" "$config_file" 2>/dev/null && return 0
    fi
    return 1
}

# Add PATH to shell config
add_path_to_config() {
    local config_file="$1"
    local shell_name
    shell_name=$(basename "$SHELL")

    # Create parent directory if needed (for fish)
    mkdir -p "$(dirname "$config_file")"

    # Add newline if file doesn't end with one
    if [ -f "$config_file" ] && [ -s "$config_file" ]; then
        if [ "$(tail -c 1 "$config_file" | wc -l)" -eq 0 ]; then
            echo "" >> "$config_file"
        fi
    fi

    # Add the PATH export
    echo "" >> "$config_file"
    echo "# Added by Craft Agent installer" >> "$config_file"

    if [ "$shell_name" = "fish" ]; then
        echo "fish_add_path $INSTALL_DIR" >> "$config_file"
    else
        echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$config_file"
    fi

    return 0
}

echo ""
echo "─────────────────────────────────────────────────────────────────────────"
echo ""

# Check PATH status
if is_path_configured; then
    success "PATH is already configured!"
    echo ""
else
    config_file=$(detect_shell_config)
    shell_name=$(basename "$SHELL")
    config_filename=$(basename "$config_file")

    # Check if already in config file (but not in current PATH)
    if config_has_path "$config_file"; then
        warn "PATH is configured in $config_filename but not active in this terminal."
        echo ""
        printf "%b\n" "  This usually means you ran ${BOLD}export PATH=...${NC} directly instead of"
        printf "%b\n" "  adding it to your shell config file."
        echo ""
        printf "%b\n" "  To fix this, either:"
        printf "%b\n" "    1. Open a ${BOLD}new terminal window${NC}"
        printf "%b\n" "    2. Run: ${BOLD}source $config_file${NC}"
        echo ""
    else
        # Automatically add PATH - no need to ask
        if add_path_to_config "$config_file"; then
            success "Added PATH to $config_filename"
        else
            # Fallback gracefully - binary is already installed!
            warn "Could not update $config_filename automatically."
            echo ""
            printf "%b\n" "  Add this line manually to your ${BOLD}$config_filename${NC}:"
            echo ""
            if [ "$shell_name" = "fish" ]; then
                printf "%b\n" "    ${BOLD}fish_add_path $INSTALL_DIR${NC}"
            else
                printf "%b\n" "    ${BOLD}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
            fi
        fi
    fi
fi

echo "─────────────────────────────────────────────────────────────────────────"
echo ""
success "Installation complete!"
echo ""

# Simple instruction - new terminal will have PATH configured
printf "%b\n" "  Open a ${BOLD}new terminal${NC} and run ${BOLD}craft${NC} to get started."
echo ""

