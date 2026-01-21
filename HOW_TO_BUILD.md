# How to Build Craft Agents

This guide covers building the Craft Agents Electron desktop app for macOS, Windows, and Linux.

## Prerequisites (All Platforms)

- [Bun](https://bun.sh) v1.0+
- [Node.js](https://nodejs.org) 18+ (required for electron-builder)
- Git

### Platform-Specific Dependencies

#### Linux

For Claude Max OAuth credential reading, install `libsecret-tools`:

```bash
# Debian/Ubuntu
sudo apt-get install -y libsecret-tools

# Fedora/RHEL
sudo dnf install -y libsecret

# Arch Linux
sudo pacman -S libsecret

# openSUSE
sudo zypper install -y libsecret-tools
```

This provides `secret-tool` which reads credentials from GNOME Keyring or KDE Wallet. If not installed, the app falls back to reading from `~/.claude/.credentials.json`.

### Install Bun

```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

## Clone and Setup

```bash
git clone https://github.com/lukilabs/craft-agents.git
cd craft-agents
bun install
```

---

## macOS

### Build DMG Installer

```bash
# Apple Silicon (arm64)
bun run electron:dist:mac

# Intel (x64)
cd apps/electron
bash scripts/build-dmg.sh x64
```

**Output:** `apps/electron/release/Craft-Agent-arm64.dmg` or `Craft-Agent-x64.dmg`

### Build with Code Signing & Notarization (Optional)

Set environment variables before building:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="your@email.com"
export APPLE_TEAM_ID="YOURTEAMID"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
```

Then run the build script - it will automatically detect and use these credentials.

### Development Mode

```bash
bun run electron:dev
```

This starts Vite dev server with hot reload for the renderer and watches main/preload for changes.

---

## Windows

### Build NSIS Installer

**On Windows (recommended):**

```powershell
cd apps/electron
powershell -ExecutionPolicy Bypass -File scripts/build-win.ps1
```

**Cross-compile from macOS/Linux:**

```bash
# Requires Wine installed
bun run electron:dist:win
```

**Output:** `apps/electron/release/Craft-Agent-x64.exe`

### Development Mode

```powershell
bun run electron:dev:win
```

### Quick Build & Run (No Installer)

```powershell
bun run electron:start:win
```

---

## Linux

### Build AppImage and .deb

```bash
bun run electron:dist:linux
```

**Output:**
- `apps/electron/release/Craft-Agent-x64.AppImage`
- `apps/electron/release/Craft-Agent-arm64.AppImage`
- `apps/electron/release/Craft-Agent-x64.deb`

### Development Mode

```bash
bun run electron:dev
```

---

## Build Commands Reference

| Command | Platform | Description |
|---------|----------|-------------|
| `bun run electron:dev` | macOS/Linux | Dev mode with hot reload |
| `bun run electron:dev:win` | Windows | Dev mode with hot reload |
| `bun run electron:start` | macOS/Linux | Build and run (no packaging) |
| `bun run electron:start:win` | Windows | Build and run (no packaging) |
| `bun run electron:dist:mac` | macOS | Build DMG installer |
| `bun run electron:dist:win` | Any (Wine on non-Windows) | Build Windows NSIS installer |
| `bun run electron:dist:linux` | Linux | Build AppImage and .deb |

---

## Build Pipeline Overview

All platform builds follow the same pipeline:

1. **Download Bun runtime** - Platform-specific Bun binary (v1.3.5) bundled with the app
2. **Copy SDK** - Claude Agent SDK copied to `apps/electron/node_modules/`
3. **Copy interceptor** - Cache TTL interceptor for Craft gateway
4. **Build code**
   - `esbuild`: Main process (`src/main/index.ts` → `dist/main.cjs`)
   - `esbuild`: Preload script (`src/preload/index.ts` → `dist/preload.cjs`)
   - `vite`: Renderer/React UI (`src/renderer/` → `dist/renderer/`)
5. **Package** - electron-builder creates platform-specific installer

---

## Output Locations

All build artifacts are placed in `apps/electron/release/`:

| Platform | File |
|----------|------|
| macOS arm64 | `Craft-Agent-arm64.dmg` |
| macOS x64 | `Craft-Agent-x64.dmg` |
| Windows x64 | `Craft-Agent-x64.exe` |
| Linux x64 | `Craft-Agent-x64.AppImage`, `Craft-Agent-x64.deb` |
| Linux arm64 | `Craft-Agent-arm64.AppImage` |

---

## Troubleshooting

### "SDK not found" error

Run `bun install` from the repository root first. The SDK is hoisted to the root `node_modules/`.

### Windows: "execution of scripts is disabled"

Run PowerShell as Administrator and execute:
```powershell
Set-ExecutionPolicy RemoteSigned
```

### macOS: "app is damaged" when opening DMG

The app isn't signed/notarized. Either:
- Build with signing credentials (see macOS section above)
- Or allow it manually: `xattr -cr /Applications/Craft\ Agent.app`

### Linux: AppImage won't run

Make it executable:
```bash
chmod +x Craft-Agent-x64.AppImage
```
