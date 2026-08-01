# CLAUDE.md — `apps/electron`

## Purpose
Electron desktop app for ARCHstudio: main process, renderer process, native modules, build system, and installer packaging.

## Current scope
- **Main process** — Electron main thread, IPC handlers, app lifecycle, menu, updates, auto-launch
- **Renderer** — React UI, chat display, settings panels, file browser
- **Native modules** — Optional: VC++ detection, platform info
- **Asset bundling** — Bundled docs, themes, config defaults (synced to ~/.archstudio on launch)
- **Build system** — Bun + TypeScript + Vite for development, electron-builder for packaging
- **Auto-updates** — electron-updater for staged rollouts
- **Dev tools** — Redux DevTools, React DevTools support in development

## Commands
From repo root:
```bash
# Development
bun run dev            # Start dev server (main + renderer)
bun run dev:main       # Main process only
bun run dev:renderer   # Renderer only (Vite dev server)

# Type-check
cd apps/electron && bun run tsc --noEmit

# Build
bun run build:electron  # Full Electron build
bun run build:dist      # Create installers/packages

# Tests
bun test apps/electron
```

## Directory structure

```
apps/electron/
├── src/
│   ├── main/
│   │   ├── index.ts              # Main entry, IPC setup, menu
│   │   ├── ipc-channels.ts        # IPC channel definitions
│   │   └── handlers/              # IPC handlers (settings, file ops, etc.)
│   └── renderer/
│       ├── App.tsx                # Root React component
│       ├── pages/                 # Page components (settings, projects, etc.)
│       ├── panels/                # Panel components (chat, sidebar, etc.)
│       ├── components/            # Reusable components
│       ├── context/               # React context (theme, i18n, etc.)
│       └── lib/                   # Utilities (navigate, platform, etc.)
├── resources/
│   ├── config-defaults.json       # Default app configuration
│   ├── docs/                      # Bundled documentation
│   ├── themes/                    # Bundled themes
│   ├── tool-icons/                # Tool icon mappings
│   └── icon.*                     # App icons
├── dist/
│   ├── main.cjs                   # Bundled main process
│   └── renderer/                  # Bundled React app
├── release/
│   ├── win-unpacked/              # Windows installation folder
│   └── *.exe                      # Windows installer
├── package.json                   # Electron + app dependencies
└── tsconfig.json                  # TypeScript config
```

## Hard rules

1. **Main process:** Node.js environment, no React, access to filesystem/OS
2. **Renderer process:** Browser environment (Chromium), has React, IPC to main
3. **IPC is async:** All main ↔ renderer communication is Promise-based
4. **No sensitive data in renderer:** Credentials stay in main process memory
5. **Asset bundling:** Docs/themes sync from `resources/` to `~/.archstudio/` on every launch
6. **No direct fs access in renderer:** Use IPC to ask main process for file operations
7. **Platform-specific:** Use `isMac()`, `isWindows()`, `isLinux()` utilities for platform checks

## IPC Architecture

**Main → Renderer (one-way):**
- `window.webContents.send(channel, data)` — Fire and forget
- Used for events (file selected, update available, session created)

**Renderer → Main (request-response):**
- `window.electronAPI.method(args)` → Promise
- Each method is wrapped via preload script (`src/preload.ts`)
- Handlers registered in `src/main/index.ts` via `ipcMain.handle(channel, handler)`

**IPC Channels** defined in `src/main/ipc-channels.ts`:
```typescript
export const IPC_CHANNELS = {
  // Settings
  'settings:getTheme': Request,
  'settings:setTheme': Request,
  // File operations
  'file:save': FileWriteRequest,
  'file:read': FileReadRequest,
  // ...
}
```

## Development workflow

### Hot reloading
- **Main process:** Restart required on changes (no hot reload)
- **Renderer:** Vite HMR (hot reload on code changes)
- Use `ELECTRON_DEVELOPMENT` env var to skip building before starting

### Debugging
- **Main process:** Use `--inspect` flag, connect debugger to `127.0.0.1:9229`
- **Renderer:** Chrome DevTools (Cmd+Option+I or Ctrl+Shift+I)
- Redux DevTools available in development build

### Testing
- **Unit tests** — Jest in `src/**/__tests__/`
- **Integration tests** — Spectron or custom electron test harness
- **E2E tests** — Currently ad-hoc, consider Playwright for future

## Build system

### Vite (Renderer)
- Entry: `src/renderer/index.tsx`
- Plugins: React, TypeScript, auto-import
- Dev server: `http://localhost:5173` (proxied by Electron)
- Production build: Minified, tree-shaken, chunked

### Bun (Main process)
- No bundler, runs TypeScript directly via `--loader`
- Compile-time: `tsc` for type-checking only
- Runtime: Bun v1.0+

### electron-builder
- Config in `electron-builder.json`
- Targets: Windows (NSIS installer + portable), macOS (.dmg), Linux (.AppImage)
- Auto-update: Staged rollout via electron-updater
- Code signing: Requires certificates (production builds only)

## Asset bundling

**Bundled assets** (synced to `~/.archstudio/` on every app launch):
- `docs/` → `~/.archstudio/docs/`
- `themes/` → `~/.archstudio/themes/`
- `config-defaults.json` → `~/.archstudio/config-defaults.json`
- `permissions/` → `~/.archstudio/permissions/`
- `tool-icons/` → `~/.archstudio/tool-icons/`

**Why re-sync on every launch?**
- Ensures fresh defaults when app updates
- Consistent behavior between debug and release
- User files in `~/.archstudio/` are preserved (only overwrite bundled)

## Platform-specific details

### Windows
- Uses NSIS installer
- Auto-updater checks for `.exe` files in release folder
- VC++ redistributable detection via `vcredist.ts`

### macOS
- Code signing required for release (Apple Developer ID)
- Notarization required for distribution
- `.dmg` installer (drag & drop style)

### Linux
- AppImage + deb package support
- Auto-updater via GitHub releases

## Preload script

`src/preload.ts` is injected into renderer context and exposes:
- `window.electronAPI` — Async methods for IPC
- `window.electronEnv` — Environment info (dev, version, platform)
- No access to Node.js APIs (sandboxed renderer)

## Store/Persistence

App data lives in:
- **User config:** `~/.archstudio/preferences.json`
- **Workspace data:** `~/.archstudio/workspaces/{slug}/`
- **App logs:** `~/.archstudio/logs/main.log`

Never use Electron's `app.getPath('userData')` directly — always go through the standardized paths in `src/shared/paths.ts`.

## Source of truth
- Main process: `src/main/index.ts`
- Renderer: `src/renderer/App.tsx`
- IPC channels: `src/main/ipc-channels.ts`
- Build config: `electron-builder.json`, `vite.config.ts`, `tsconfig.json`
