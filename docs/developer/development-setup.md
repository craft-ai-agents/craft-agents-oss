# Development Setup Guide

This guide covers everything you need to set up a local Vesper development environment.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Development Workflow](#development-workflow)
- [Environment Configuration](#environment-configuration)
- [Common Issues](#common-issues)
- [Platform-Specific Notes](#platform-specific-notes)

## Prerequisites

### Required Software

1. **Bun** (v1.0.0 or higher)
   ```bash
   # Install Bun
   curl -fsSL https://bun.sh/install | bash

   # Verify installation
   bun --version
   ```

2. **Node.js** (v18 or higher)
   ```bash
   # macOS (using Homebrew)
   brew install node@18

   # Linux (using nvm)
   nvm install 18
   nvm use 18

   # Windows (using nvm-windows)
   nvm install 18
   nvm use 18
   ```

3. **Git**
   ```bash
   # macOS
   brew install git

   # Linux (Debian/Ubuntu)
   sudo apt-get install git

   # Windows
   # Download from https://git-scm.com/download/win
   ```

4. **VS Code** (recommended)
   - Download from [code.visualstudio.com](https://code.visualstudio.com/)
   - Recommended extensions:
     - TypeScript and JavaScript Language Features (built-in)
     - ESLint
     - Tailwind CSS IntelliSense

### Recommended Tools

- **GitHub CLI** (`gh`) - For PR management and GitHub operations
- **iTerm2** (macOS) - Better terminal experience
- **Windows Terminal** (Windows) - Modern terminal for Windows

## Initial Setup

### 1. Clone Repository

```bash
git clone https://github.com/atherslabs/vesper.git
cd vesper
```

### 2. Install Dependencies

```bash
bun install
```

This will install all dependencies for the monorepo workspace (apps and packages).

### 3. Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# OAuth Credentials (optional for development)
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-google-client-secret
SLACK_OAUTH_CLIENT_ID=your-slack-client-id
SLACK_OAUTH_CLIENT_SECRET=your-slack-client-secret
MICROSOFT_OAUTH_CLIENT_ID=your-microsoft-client-id
MICROSOFT_OAUTH_CLIENT_SECRET=your-microsoft-client-secret
```

### 4. Verify Setup

Run type checking to ensure everything is set up correctly:

```bash
bun run typecheck:all
```

## Development Workflow

### Starting Development Mode

The development server provides hot reload for both main and renderer processes:

```bash
bun run electron:dev
```

This command:
1. Cleans Vite cache
2. Builds resources
3. Starts 4 concurrent processes:
   - Vite dev server (renderer hot reload)
   - Main process build watcher
   - Preload script build watcher
   - Electron app

**Output:**
```
[0] vite v6.2.4 dev server running at:
[0]   ➜  Local:   http://localhost:5173/
[1] watching apps/electron/src/main/index.ts...
[2] watching apps/electron/src/preload/index.ts...
[3] Electron app started
```

### Development Scripts

```bash
# Full development mode (hot reload)
bun run electron:dev

# Build and run (no hot reload)
bun run electron:start

# Build individual parts
bun run electron:build:main      # Main process
bun run electron:build:preload   # Preload script
bun run electron:build:renderer  # Renderer (Vite)
bun run electron:build:resources # Static resources

# Clean build artifacts
bun run electron:clean           # Remove dist and release
bun run electron:clean:vite      # Remove Vite cache

# Type checking
bun run typecheck                # Check shared package only
bun run typecheck:all            # Check all packages

# Testing
bun test                         # Run all unit tests
bun run test:e2e                 # Run all E2E tests
bun run test:e2e:skills          # Test skills marketplace
bun run test:e2e:terminal        # Test terminal resume
```

### File Organization

Understanding where code lives helps navigation:

```
vesper/
├── apps/
│   └── electron/
│       ├── src/
│       │   ├── main/                  # Main process code
│       │   │   ├── index.ts          # Entry point
│       │   │   ├── ipc.ts            # IPC handlers
│       │   │   ├── sessions.ts       # Session management
│       │   │   ├── scheduler.ts      # Cron scheduler
│       │   │   └── __tests__/        # Main process tests
│       │   │
│       │   ├── preload/              # Preload script
│       │   │   └── index.ts          # Context bridge
│       │   │
│       │   ├── renderer/             # Renderer process
│       │   │   ├── atoms/            # Jotai atoms
│       │   │   ├── components/       # React components
│       │   │   ├── pages/            # Page components
│       │   │   ├── hooks/            # Custom hooks
│       │   │   ├── contexts/         # Context providers
│       │   │   └── event-processor/  # Event handling
│       │   │
│       │   └── shared/               # Shared types
│       │
│       ├── vite.config.ts            # Vite configuration
│       └── package.json
│
└── packages/
    ├── core/                         # Shared types
    │   └── src/
    │       └── types/
    │
    ├── shared/                       # Business logic
    │   └── src/
    │       ├── agent/                # VesperAgent
    │       ├── auth/                 # OAuth & tokens
    │       ├── config/               # Configuration
    │       ├── credentials/          # Encrypted storage
    │       ├── mcp/                  # MCP client
    │       ├── sessions/             # Session persistence
    │       ├── sources/              # Data sources
    │       ├── task-lists/           # Task management
    │       └── __tests__/            # Unit tests
    │
    └── ui/                           # Shared UI components
        └── src/
            └── components/
```

### Making Changes

#### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
```

Branch naming conventions:
- `feature/` - New features
- `fix/` - Bug fixes
- `refactor/` - Code refactoring
- `docs/` - Documentation updates
- `test/` - Test additions/updates

#### 2. Development Cycle

```
Edit Code
  │
  ├─► Renderer Code (React)
  │   └─► Hot reload (instant)
  │
  ├─► Main/Preload Code (Node.js)
  │   ├─► Auto rebuild (watch mode)
  │   └─► Manual restart (Cmd+R in app)
  │
  └─► Shared Package Code
      ├─► Auto rebuild (watch mode)
      └─► Manual restart (Cmd+R in app)
```

**Tips:**
- Renderer changes reload instantly
- Main/preload changes require app restart (Cmd+R)
- Check terminal for build errors
- Use Chrome DevTools for renderer debugging (Cmd+Option+I)

#### 3. Testing Your Changes

```bash
# Run type checking
bun run typecheck:all

# Run relevant tests
bun test                              # All tests
bun test packages/shared/src/agent/   # Specific directory
bun test session                      # Pattern matching

# Run E2E tests (if applicable)
bun run test:e2e:terminal
```

#### 4. Commit Your Changes

```bash
git add .
git commit -m "feat: add new feature"
```

Commit message format:
- `feat:` - New feature
- `fix:` - Bug fix
- `refactor:` - Code refactoring
- `docs:` - Documentation changes
- `test:` - Test changes
- `chore:` - Build/tooling changes

## Environment Configuration

### Development Config Directory

By default, Vesper uses `~/.vesper/` for configuration. During development, you may want to use a separate directory:

```bash
export VESPER_CONFIG_DIR=~/.vesper-dev
```

Add to your shell profile (`.bashrc`, `.zshrc`, etc.) for persistence.

### Development Logging

Logs are written to platform-specific locations:

**macOS:**
```
~/Library/Logs/Vesper/
├── main.log         # Main process logs
└── renderer.log     # Renderer process logs
```

**Linux:**
```
~/.config/Vesper/logs/
├── main.log
└── renderer.log
```

**Windows:**
```
%APPDATA%\Vesper\logs\
├── main.log
└── renderer.log
```

**Tail logs in development:**
```bash
# macOS/Linux
tail -f ~/Library/Logs/Vesper/main.log

# Windows (PowerShell)
Get-Content "$env:APPDATA\Vesper\logs\main.log" -Wait
```

### Debugging

#### Renderer Process (Chrome DevTools)

```bash
# Open DevTools in app
Cmd+Option+I (macOS)
Ctrl+Shift+I (Windows/Linux)
```

Or programmatically in code:
```typescript
if (import.meta.env.DEV) {
  window.electron.openDevTools();
}
```

#### Main Process (Node.js Debugger)

Add `--inspect` flag to Electron launch:

```bash
electron --inspect=9229 apps/electron
```

Then attach VS Code debugger:

**.vscode/launch.json:**
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Attach to Main Process",
      "type": "node",
      "request": "attach",
      "port": 9229,
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
```

#### Debug Logging

Enable verbose logging:

```typescript
import { debug } from '@vesper/shared/utils';

debug('My debug message', { data: 'value' });
```

Set `VESPER_DEBUG=1` environment variable to enable:

```bash
VESPER_DEBUG=1 bun run electron:dev
```

## Common Issues

### Issue: "Bun not found"

**Solution:**
```bash
# Ensure Bun is in PATH
export PATH="$HOME/.bun/bin:$PATH"

# Or reinstall Bun
curl -fsSL https://bun.sh/install | bash
```

### Issue: "Module not found" errors

**Solution:**
```bash
# Clean install
rm -rf node_modules
rm bun.lockb
bun install
```

### Issue: Vite port already in use

**Solution:**
```bash
# Kill process on port 5173
lsof -ti:5173 | xargs kill -9

# Or use different port
VESPER_VITE_PORT=5174 bun run electron:dev
```

### Issue: Electron app won't start

**Solution:**
```bash
# Clean build artifacts
bun run electron:clean

# Rebuild
bun run electron:build

# Try starting again
bun run electron:start
```

### Issue: Type errors in editor but not in terminal

**Solution:**
```bash
# Restart TypeScript server in VS Code
Cmd+Shift+P → "TypeScript: Restart TS Server"

# Or reload VS Code
Cmd+Shift+P → "Developer: Reload Window"
```

### Issue: Hot reload not working

**Solution:**
1. Check terminal for Vite errors
2. Ensure you're editing renderer code (not main/preload)
3. Restart dev server: Ctrl+C, then `bun run electron:dev`

## Platform-Specific Notes

### macOS

**Code Signing (for distribution):**
```bash
# Install Xcode Command Line Tools
xcode-select --install

# Sign for distribution
bun run electron:dist:mac
```

**Permissions:**
- Grant Terminal full disk access for file operations
- Grant Electron camera/microphone permissions if needed

### Linux

**Dependencies:**
```bash
# Debian/Ubuntu
sudo apt-get install libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0 libuuid1 libsecret-1-0

# Fedora
sudo dnf install gtk3 libnotify nss libXScrnSaver libXtst xdg-utils at-spi2-core libuuid libsecret
```

**Sandboxing:**
If you see "The SUID sandbox helper binary was found, but is not configured correctly":
```bash
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

### Windows

**Build Tools:**
```powershell
# Install Windows Build Tools (run as Administrator)
npm install --global windows-build-tools
```

**PowerShell Scripts:**
Enable script execution:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**Use PowerShell-specific commands:**
```powershell
# Development mode
bun run electron:dev:win

# Build
bun run electron:build:win

# Clean
bun run electron:clean:win
```

## Next Steps

Once your development environment is set up:

1. Read [Architecture Overview](architecture.md) to understand the codebase
2. Review [Testing Guide](testing-guide.md) for testing best practices
3. Check [IPC Patterns](ipc-patterns.md) for communication between processes
4. Explore [Code Organization](code-organization.md) for coding conventions

## Getting Help

- **Issues**: Check [GitHub Issues](https://github.com/atherslabs/vesper/issues)
- **Discussions**: Join [GitHub Discussions](https://github.com/atherslabs/vesper/discussions)
- **Documentation**: See [docs/](../) directory

---

*Last Updated: 2026-01-26*
