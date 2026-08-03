# Rebrand 2026: Reordered Commit Messages (Strict-Stack)

> **Order:** 1 → 2 → 3 → 4 → 8 → 5 → 7 → 6
> **Dependency chain:** protocol → backend → rail; test-infra → main-fixes → owner-features
> **Date:** 2026-07-29

---

## Commit 1/8 — `pr/protocol-channels`
**Subject:** `feat(protocol): bucket field on GitStatusFileEntry + new git-status IPC channels`

```
feat(protocol): bucket field on GitStatusFileEntry + new git-status IPC channels

Add a `bucket` discriminant field to `GitStatusFileEntry` in the protocol
layer so the UI can distinguish staged vs unstaged vs untracked entries.
Register the new `git:status` and `git:fileDiff` IPC channels in the
channel manifest and update the type-safe event map.  Includes the
IPC channel snapshot test for wire-format stability.

Diff snapshot (7 files, +392 −2):

  apps/electron/src/shared/__tests__/ipc-channels.test.ts |  18 +++
  apps/electron/src/shared/types.ts                      | 118 +++++++++-
  packages/shared/src/protocol/channels.ts               |  67 +++++
  packages/shared/src/protocol/dto.ts                    | 158 +++++++++++++
  packages/shared/src/protocol/events.ts                 |   3 +
  packages/shared/src/protocol/routing.ts                |  21 +++
  packages/shared/src/protocol/types.ts                  |   7 +

Depends on: nothing (protocol layer, no runtime dependency).
```

---

## Commit 2/8 — `pr/git-status-backend`
**Subject:** `feat(server-core): git status porcelain-XY parser with dual bucket emission`

```
feat(server-core): git status porcelain-XY parser with dual bucket emission

Implement a porcelain-format git status parser in server-core that reads
`git status --porcelain` output, classifies each file into staged
(index) or unstaged (working tree) buckets using the two-character XY
status code, and emits results via the git-status IPC channel.  Includes
tests for the open-url and transfer handler fixes.

Diff snapshot (3 files, +294):

  packages/server-core/src/handlers/rpc/system.open-url.test.ts  |   3 +
  packages/server-core/src/handlers/rpc/system.ts                | 290 +++++++++++++++
  packages/server-core/src/handlers/rpc/transfer.test.ts         |   3 +

Depends on: pr/protocol-channels (uses git:status channel and GitStatusFileEntry type).
```

---

## Commit 3/8 — `pr/recent-changes-rail`
**Subject:** `feat(shell): bucket-split Recent Changes rail`

```
feat(shell): bucket-split Recent Changes rail

Wire the Recent Changes rail in LayoutShell to show staged/unstaged file
changes from the git-status backend.  The rail reads initialGitStatus
via IPC, renders bucketed file lists (staged/unstaged/untracked), and
includes unit tests using renderToStaticMarkup for deterministic SSR.

Diff snapshot (3 files, +1718 −16):

  apps/electron/src/renderer/shell/LayoutShell.css              | 603 +++++++++
  apps/electron/src/renderer/shell/LayoutShell.tsx              | 858 ++++++++++-
  apps/electron/src/renderer/shell/__tests__/LayoutShell.changes-rail.test.tsx | 257 ++++

Depends on: pr/protocol-channels (calls electronAPI.getGitStatus()),
             pr/git-status-backend (server-side handler for the IPC channel).
```

---

## Commit 4/8 — `pr/renderer-test-infra`
**Subject:** `test(shell): renderer test infra for bun:test`

```
test(shell): renderer test infra for bun:test

Add the bun:test renderer infrastructure: configure bunfig.toml with
pathIgnorePatterns for release/ artifacts, add a test-setup.ts preload
that stubs Vite-only imports (?url, .css, import.meta.glob) and mocks
pdfjs-dist, react-pdf, and other renderer-heavy dependencies so
component tests can run outside Electron.

Diff snapshot (2 files, +111):

  bunfig.toml           |   5 +
  scripts/test-setup.ts | 106 +++++++++++++++++++++++++++++++++++++++++++++++

Depends on: nothing (test infrastructure, no production code).
```

---

## Commit 5/8 — `pr/iconography-and-dockerfile`
**Subject:** `chore(tests): add UserMessageBubble thumbnail rendering tests`

```
chore(tests): add UserMessageBubble thumbnail rendering tests

Add a test file that exercises the UserMessageBubble component's
thumbnail rendering path for image attachments, including hover-zoom
popover behavior and thumbnail fallback when base64 data is absent.
Uses the renderer test infrastructure from the test-infra commit.

Diff snapshot (1 file, +164):

  packages/ui/src/components/chat/__tests__/user-message-bubble-attachments.test.tsx | 164 +++++

Depends on: pr/renderer-test-infra (needs test-setup.ts mocks).
```

---

## Commit 6/8 — `pr/electron-deps-scripts`
**Subject:** `chore(deps): add react-window + happy-dom + icon generator scripts`

```
chore(deps): add react-window + happy-dom + icon generator scripts

Add react-window for virtualized list rendering in the Working Directory
tree, happy-dom as a DOM implementation for renderer tests, and icon
generator scripts for generating the multi-resolution icon set.  Minor
fixes to browser-tool.ts, build/darwin.ts, and electron-dev.ts.

Diff snapshot (5 files, +74 −18):

  apps/electron/package.json       |  8 +++-
  apps/electron/resources/icon.svg | 72 ++++++++++++++++++++++++++-
  scripts/browser-tool.ts          |  4 +-
  scripts/build/darwin.ts          |  2 +-
  scripts/electron-dev.ts          |  6 ++-

Depends on: nothing (deps + scripts, no code dependency).
```

---

## Commit 7/8 — `pr/owner-features`
**Subject:** `feat(shell,server,shared,ui): settings/memory/providers rewrites + onboarding mural + chrome refresh`

```
feat(shell,server,shared,ui): settings/memory/providers rewrites + onboarding mural + chrome refresh

Large feature branch spanning settings panel rewrites, memory panel
wiring to real SQLite backend + Obsidian vault sync, providers panel
with inference store and health polling, onboarding mural replacement
for the wizard cards, and chrome refresh across the shell.  Includes
the PromptCompiler owner prompt system, transport layer updates,
session-scoped tool registry, and design token improvements.

Diff snapshot (152 files, +19788 −865):

  Key areas touched:
    apps/electron/src/renderer/components/onboarding/  (12 files, mural rewrite)
    apps/electron/src/renderer/panels/                 (8 panels wired to real RPCs)
    apps/electron/src/main/handlers/                   (inference, prompts, memory)
    packages/shared/src/agent/                         (backend types, session tools)
    packages/shared/src/config/                        (storage, theme, models-pi)
    packages/shared/src/prompts/owner/                 (compiler, types, defaults)
    packages/shared/src/memory/                        (repository, obsidian-sync)
    packages/server-core/src/transport/                (client, codec, server)
    packages/session-tools-core/                       (memory handlers, context)
    packages/ui/                                       (components, styles)

Depends on: pr/renderer-test-infra (test mocks), pr/electron-deps-scripts (react-window).
```

---

## Commit 8/8 — `pr/electron-main-fixes`
**Subject:** `fix(electron): unblock renderer load (SQLite + TDZ + BrowserPaneManager mocks)`

```
fix(electron): unblock renderer load (SQLite + TDZ + BrowserPaneManager mocks)

Fix critical renderer startup issues: resolve bun:sqlite module loading
error in Electron, fix TDZ (temporal dead zone) crashes in the renderer,
and complete BrowserPaneManager mock coverage for all 8 main-process
test files.  Adds the channel-map parity test and updates the transport
routed-client for the new IPC channels.

Diff snapshot (16 files, +316 −63):

  apps/electron/src/main/__tests__/browser-pane-manager.test.ts    |  73 +++++-
  apps/electron/src/main/browser-pane-manager.ts                  |   6 +-
  apps/electron/src/main/handlers/__tests__/browser-broadcast.test.ts |  4 +-
  apps/electron/src/main/handlers/__tests__/registration-profiles.test.ts | 14 +-
  apps/electron/src/main/handlers/__tests__/session-watcher.test.ts |  4 +-
  apps/electron/src/main/handlers/browser.ts                      |   2 +-
  apps/electron/src/main/handlers/index.ts                        |   4 +
  apps/electron/src/main/handlers/memory.ts                       | 110 ++++++++++-
  apps/electron/src/main/menu.ts                                  |   4 +-
  apps/electron/src/main/onboarding.ts                            |  14 +-
  apps/electron/src/main/window-manager.ts                        |  34 +++-
  apps/electron/src/preload/bootstrap.ts                          |   6 +
  apps/electron/src/renderer/electron-api-mock.ts                 |  36 +++
  apps/electron/src/transport/__tests__/channel-map-parity.test.ts |  6 +
  apps/electron/src/transport/channel-map.ts                      |  28 +++
  apps/electron/src/transport/routed-client.ts                    |  34 +++-

Depends on: pr/owner-features (shared types + transport layer).
```

---

## Stack summary (reordered)

```
pr/protocol-channels       (7 files,  +392 −2)      ← protocol layer, no deps
pr/git-status-backend      (3 files,  +294)         ← server-side, depends on protocol
pr/recent-changes-rail     (3 files,  +1718 −16)    ← UI, depends on protocol + backend
pr/renderer-test-infra     (2 files,  +111)         ← test infra, no deps
pr/iconography-and-dockerfile (1 file, +164)         ← depends on test-infra
pr/electron-deps-scripts   (5 files,  +74 −18)      ← deps + scripts, no deps
pr/owner-features          (152 files, +19788 −865)  ← depends on test-infra + deps-scripts
pr/electron-main-fixes     (16 files, +316 −63)     ← depends on owner-features

Total: 189 files, +22,557 −966
```
