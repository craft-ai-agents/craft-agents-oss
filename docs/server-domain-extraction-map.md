# Server Domain Extraction Map

Inventory of all headless-critical modules in `apps/electron/src/main/` with
dependency analysis for progressive extraction into `@craft-agent/server-core`.

## Coupling legend

| Level | Meaning |
|-------|---------|
| **None** | No Electron imports, no `main/logger.ts` import |
| **Platform** | Uses `PlatformServices` abstraction (already headless-safe) |
| **GUI** | Requires WindowManager / BrowserPaneManager / Electron APIs |

---

## Extraction tiers

### Tier 0 — Pure utilities (zero internal deps)

| Module | File | Ext. deps | Coupling | Risk |
|--------|------|-----------|----------|------|
| `connection-setup-logic` | `main/connection-setup-logic.ts` | `@craft-agent/shared/config` | None | Low |
| `title-sanitizer` | `main/title-sanitizer.ts` | — | None | Low |
| `browser-tool-detection` | `main/browser-tool-detection.ts` | — | None | Low |
| `init-gate` | `main/init-gate.ts` | — | None | Low |
| `session-branch-cleanup` | `main/session-branch-cleanup.ts` | `@craft-agent/shared/sessions`, Node `fs` | None | Low |
| `handler-deps` (type) | `main/handlers/handler-deps.ts` | `@craft-agent/server-core/handlers` | None | Low |

### Tier 1 — Platform-abstracted services

| Module | File | Ext. deps | Coupling | Risk |
|--------|------|-----------|----------|------|
| `model-fetchers/` | `main/model-fetchers/*.ts` (6 files) | `@craft-agent/shared/{config,credentials,agent}` | Platform | **Low** |
| `search` | `main/search.ts` | `@craft-agent/shared/agent/backend` | Platform | Low |
| `image-utils` | `main/image-utils.ts` | `@craft-agent/shared/utils` | Platform | Low |
| `privileged-execution-broker` | `main/privileged-execution-broker.ts` | Node `crypto`, `fs` | Platform | Low |
| `shell-env` | `main/shell-env.ts` | Node `child_process` | Logger-only¹ | Low |

¹ `shell-env.ts` still imports `mainLog` from `./logger`. Needs Logger param added before extraction.

### Tier 2 — Handler domains (all use `(server, deps)` pattern)

All handlers import from `@craft-agent/shared/*` and `../../transport/types`.
None import `electron` directly.

| Module | File | Internal deps | Risk | Notes |
|--------|------|---------------|------|-------|
| `statuses` | `handlers/statuses.ts` | — | Low | Simplest (31 lines) |
| `labels` | `handlers/labels.ts` | — | Low | 43 lines |
| `automations` | `handlers/automations.ts` | — | Low | |
| `skills` | `handlers/skills.ts` | — | Low | |
| `auth` | `handlers/auth.ts` | `transport/capabilities` | Low | Uses `requestClientConfirmDialog` |
| `oauth` | `handlers/oauth.ts` | — | Low | Server-owned flows |
| `sources` | `handlers/sources.ts` | — | Low | |
| `files` | `handlers/files.ts` | `image-utils`, `transport/capabilities` | Low | |
| `settings` | `handlers/settings.ts` | `handlers/files` (validateFilePath) | Low | |
| `onboarding` | `main/onboarding.ts` | — | Low | |
| `sessions` | `handlers/sessions.ts` | `search` (dynamic import) | Medium | File watchers, large |
| `llm-connections` | `handlers/llm-connections.ts` | `model-fetchers`, `connection-setup-logic`, `transport/capabilities` | Medium | Copilot+ChatGPT OAuth |
| `workspace` | `handlers/workspace.ts` | — | Medium | Has GUI handlers (guarded) |
| `system` | `handlers/system.ts` | `handlers/files`, `git-bash`, `transport/capabilities` | Medium | Core/GUI split already done |

### Tier 3 — SessionManager (the gravity center)

| Module | File | Internal deps | Risk |
|--------|------|---------------|------|
| `session-browser-release` | `main/session-browser-release.ts` | SessionManager (circular) | Medium |
| **SessionManager** | `main/sessions.ts` | privileged-execution-broker, init-gate, title-sanitizer, browser-tool-detection, session-branch-cleanup, image-utils, session-browser-release | **High** |

SessionManager is ~2500 lines, uses `EventSink`, `PlatformServices`, and
`RuntimeHooks` injections — already Electron-free but heavyweight to move.

### Non-extractable (GUI-only)

| Module | File | Reason |
|--------|------|--------|
| `browser` handler | `handlers/browser.ts` | BrowserPaneManager / BrowserView |
| `window-manager` | `main/window-manager.ts` | BrowserWindow, app, screen |
| `browser-pane-manager` | `main/browser-pane-manager.ts` | BrowserView, CDP |
| `menu` | `main/menu.ts` | Menu, MenuItem |
| `auto-update` | `main/auto-update.ts` | electron-updater |
| `notifications` | `main/notifications.ts` | Notification |
| `deep-link` | `main/deep-link.ts` | app protocol |
| `power-manager` | `main/power-manager.ts` | powerSaveBlocker |
| `logger` | `main/logger.ts` | electron-log (stays for GUI) |

---

## Recommended extraction order

1. **Tier 0** — Pure utilities (batch move, zero risk)
2. **Tier 1: `model-fetchers/`** — First real slice (this phase)
3. **Tier 1: remaining** — `search`, `image-utils`, `privileged-execution-broker`
4. **Tier 2: simple handlers** — statuses, labels, automations, skills, auth, oauth, sources
5. **Tier 2: complex handlers** — files, settings, sessions handler, llm-connections, workspace, system
6. **Tier 3: SessionManager** + helpers — final, highest-risk move
7. **Handler registry** — split `handlers/index.ts` into core (server-core) + gui (apps/electron)

Each step should keep `bun test` baseline stable and produce a working Electron + headless server.
