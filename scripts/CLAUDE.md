# CLAUDE.md - Scripts

Build and development scripts for the G4 OS monorepo.

## Key Scripts

| Script | Purpose |
|--------|---------|
| `electron-dev.ts` | Main dev script — hot reload with esbuild watch + Vite dev server |
| `electron-build-main.ts` | Build main process (esbuild, injects OAuth defines from .env) |
| `electron-build-preload.ts` | Build preload script (esbuild) |
| `electron-build-renderer.ts` | Build renderer (Vite) |
| `electron-build-resources.ts` | Copy static assets (themes, icons, docs, permissions) |
| `electron-clean.ts` | Clean dist directory |
| `install-app.sh` | macOS/Linux installer (curl one-liner) |
| `install-app.ps1` | Windows installer (PowerShell) |

## Dev Script Flow (`electron-dev.ts`)

```
1. Load .env file
2. Clean Vite cache
3. Copy resources to dist/
4. Build MCP servers (skipped if sources missing — OSS)
5. Build main.cjs + preload.cjs (esbuild one-shot)
6. Verify build output exists and has content
7. Start Vite dev server (port 5173)
8. Start esbuild watch for main + preload
9. Launch Electron
10. Wait for Electron exit, cleanup
```

## Build Pipeline

All builds use esbuild with:
- `platform: "node"`, `format: "cjs"` (Electron requirement)
- `packages: "external"` (node_modules not bundled)
- OAuth secrets injected via `define` (build-time constants)

The renderer uses Vite (see `apps/electron/vite.config.ts`).

## OSS Notes

- MCP server builds (`session-mcp-server`, `bridge-mcp-server`) are skipped when source files don't exist
- The `.env` file is not committed — copy from `.env.example`
