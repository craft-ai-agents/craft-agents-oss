# Craft Agents - QA Checklist

## Phase 1: Build & Type Safety
- [ ] **Typecheck**: Run `bun run typecheck:all` (Checks Core + Shared).
- [ ] **Lint**: Run `bun run lint:electron` (or root `lint`).
- [ ] **Build**: Run `bun run electron:build` to verify build pipeline (Main + Preload + Renderer).

## Phase 2: Core Functionality
- [ ] **Session Creation**: Verify new session creates unique ID and persists to disk.
- [ ] **Permission Modes**: Test `safe`, `ask`, and `allow-all` modes (Shift+Tab).
  - [ ] `safe`: Should block writes.
  - [ ] `ask`: Should prompt dialog.
- [ ] **MCP Integration**: Verify local MCP server startup (check logs for env filtering).

## Phase 3: Desktop Specific
- [ ] **Window Management**: Test New Chat (`Cmd+N`).
- [ ] **Deep Links**: Test `craftagents://` protocol handling.
- [ ] **Native Menus**: Check Application Menu integration.

## Phase 4: Release
- [ ] **Clean Build**: `bun run electron:clean` before building.
- [ ] **Packaging**: `bun run electron:dist` (creates DMG/Exe).
