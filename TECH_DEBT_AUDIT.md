# Technical Debt Audit

Generated: 2026-05-05
Scope: `/Users/michaelb.williams/RunnerOS`

## Executive Summary

RunnerOS is functional but carrying heavy debt in four places:

1. `SessionManager` is the main runtime choke point. It owns too many flows: agents, workflows, pulses, sources, persistence, tools, and message launch.
2. Dependency health is not clean. `bun audit` found 136 vulnerabilities, including direct high-risk packages.
3. Electron security boundaries need tightening, especially URL opening and build-time OAuth secret injection.
4. Tooling exists, but dependency and cycle checks are not clean enough to trust as gates yet.
5. Product identity is split: docs and packages still say Craft Agents while the app is Runner/RunnerOS.

Useful checks already passed:

- `bun run typecheck:all` passed.

Useful checks that exposed debt:

- `bun audit` failed with 136 vulnerabilities.
- `madge --circular --extensions ts,tsx packages apps` found 39 circular dependencies.
- `knip --no-progress` found many unused/unlisted dependency signals, but it needs workspace tuning before becoming a hard gate.
- `npm audit` is not useful here because the repo has no npm lockfile.

## Top 5 Debt Items

1. **Upgrade vulnerable direct dependencies.** Start with `electron`, `@modelcontextprotocol/sdk`, `tar`, `postcss`, and `vite`. Evidence: `package.json:121`, `package.json:143`, `package.json:132`, `package.json:129`, `package.json:134`.
2. **Split `SessionManager` by runtime responsibility.** It is over 8,600 lines and sits on critical paths for sessions, workflows, pulses, sources, and tools. Evidence: `packages/server-core/src/sessions/SessionManager.ts:1`, `packages/server-core/src/sessions/SessionManager.ts:6324`.
3. **Harden Electron external navigation and secret handling.** Block unsafe URL schemes and stop passing OAuth secrets through esbuild defines. Evidence: `apps/electron/src/main/window-manager.ts:187`, `apps/electron/package.json:19`.
4. **Make global/workspace activation failures consistent.** Workflow preflight fails loud, but send-message source activation can degrade to warnings. Evidence: `packages/server-core/src/workflows/WorkflowRunner.ts:349`, `packages/server-core/src/sessions/SessionManager.ts:6362`.
5. **Turn dependency/cycle tools into configured checks.** Current output is noisy but still reveals real package-boundary drift. Evidence: `packages/ui/src/components/chat/turn-utils.ts:9`, `packages/server-core/src/sessions/SessionManager.ts:40`.

## Findings

| ID | Severity | Area | Evidence | Debt | Fix |
|---|---:|---|---|---|---|
| TD-001 | High | Architecture | `packages/server-core/src/sessions/SessionManager.ts:1` | `SessionManager` imports and coordinates too many domains from one file. It is a god module, not a session manager. | Split into launch orchestration, source activation, persistence, tools, workflow bridge, and pulse bridge services. |
| TD-002 | High | Architecture | `packages/server-core/src/sessions/SessionManager.ts:6324` | `sendMessage` is doing source resolution, activation, agent construction, logging, and message dispatch in one path. | Extract a tested `MessageLaunchService` with explicit preflight and launch phases. |
| TD-003 | Medium | Architecture | `packages/server-core/src/sessions/SessionManager.ts:1812` | Agent session option resolution is central and high-risk, but it is embedded inside the huge manager. | Move resolver/preflight logic to its own module with direct tests. |
| TD-004 | Medium | Architecture | `packages/server-core/src/sessions/SessionManager.ts:4917` | Source activation logic appears in several runtime paths and is easy to drift. | Centralize source activation into one strict service used by chat, workflow, and pulse paths. |
| TD-005 | Medium | Architecture | `packages/server-core/src/workflows/WorkflowRunner.ts:76` | Workflow runner depends on both `resolveAgentSessionOptions` and `preflightStepAgent`, which can drift. | Pass a single resolver result object through preflight and execution. |
| TD-006 | Medium | Architecture | `packages/server-core/src/workflows/storage.ts:43` | Global workflows live in `~/.workflows`, while other Codex/Runner state lives elsewhere. | Consolidate app-owned global state under one app config root or document the split as a formal contract. |
| TD-007 | Medium | Reliability | `packages/server-core/src/workflows/storage.ts:180` | Malformed workflow activation manifests silently become empty manifests. | Backup bad manifests and surface diagnostics like global source manifest handling already does. |
| TD-008 | Medium | Contract Validation | `packages/session-tools-core/src/handlers/create-workflow.ts:60` | `create_workflow` validates only the outer shell: slug, name, description, manual trigger, and non-empty steps. | Validate duplicate step ids, trigger input names/defaults, output schema shape, and template references before write. |
| TD-009 | Medium | Runtime Consistency | `packages/server-core/src/sessions/SessionManager.ts:6362` | Required source failures can become warnings in chat launch, while workflow launch preflights fail louder. | Use one failure policy per launch origin and make warnings impossible for required capabilities. |
| TD-010 | Low | Cleanup | `packages/server-core/src/workflows/WorkflowRunner.ts:877` | `emitEvent` and `emit` appear to duplicate event wrapping behavior. | Delete one helper after confirming call sites. |
| TD-011 | High | Dependency Security | `package.json:121` | Direct `electron` version is inside vulnerable ranges reported by `bun audit`. | Upgrade Electron and run desktop smoke tests. |
| TD-012 | High | Dependency Security | `package.json:143` | Direct `@modelcontextprotocol/sdk` is flagged for cross-client data leak risk. | Upgrade and verify no shared server/transport instances leak session state. |
| TD-013 | High | Dependency Security | `package.json:132` | Direct `tar` is flagged for arbitrary file creation/overwrite/path traversal. | Upgrade `tar` and audit extraction call sites. |
| TD-014 | Medium | Dependency Security | `package.json:129` | Direct `postcss` is flagged for CSS stringification XSS risk. | Upgrade and verify style build paths. |
| TD-015 | Medium | Dependency Security | `package.json:134` | Direct `vite` is flagged for dev-server file-read/path traversal issues. | Upgrade Vite and verify Electron/web dev server behavior. |
| TD-016 | Medium | Package Boundaries | `packages/server-core/src/sessions/SessionManager.ts:40` | `server-core` imports `@craft-agent/session-tools-core`, but package-boundary tooling reports it is not declared in `packages/server-core/package.json`. | Add the dependency or move the import behind a package that `server-core` already owns. |
| TD-017 | Medium | Package Boundaries | `packages/ui/src/components/chat/turn-utils.ts:9` | `@craft-agent/ui` imports `@craft-agent/shared`, but its package manifest does not declare that dependency. | Declare the dependency or move shared UI-safe helpers into `@craft-agent/core`/`@craft-agent/ui`. |
| TD-018 | Medium | Tooling | `package.json:42` | Validation scripts do not include dependency audit, circular dependency checks, or configured Knip checks. | Add a separate non-blocking debt check first, then graduate stable checks into CI. |
| TD-019 | High | Electron Security | `apps/electron/package.json:19` | The Electron main build injects OAuth client secrets through esbuild defines. That can embed secrets into bundled app code. | Do not bundle OAuth secrets. Use public client ids in app code and server/secure storage for secrets. |
| TD-020 | High | Electron Security | `apps/electron/src/main/window-manager.ts:187` | `setWindowOpenHandler` opens arbitrary external URLs with `shell.openExternal`. | Allowlist safe schemes like `https:`, `http:`, and maybe `mailto:`. Block `file:`, custom protocols, and malformed URLs. |
| TD-021 | High | Electron Security | `apps/electron/src/main/window-manager.ts:193` | `will-navigate` also forwards arbitrary external URLs to `shell.openExternal`. | Reuse the same URL sanitizer for all external open paths. |
| TD-022 | Medium | Security Logging | `packages/shared/src/security/privileged-execution-broker.ts:65` | Privileged command audit logs include raw command text. Shell args can contain tokens or paths users did not expect to persist. | Store command hash plus redacted preview by default; keep raw command only behind explicit debug mode. |
| TD-023 | Medium | Security Policy | `packages/shared/src/security/privileged-execution-broker.ts:157` | Privileged command policy is regex-based against full command strings. | Parse argv and validate command, subcommand, path, and target separately. |
| TD-024 | Medium | Network Safety | `packages/shared/src/sources/credential-manager.ts:1105` | Source token renewal fetches a configured endpoint without an obvious timeout or host policy. | Add `AbortSignal.timeout`, scheme checks, and optional local-network blocking for agent-authored configs. |
| TD-025 | Medium | Privacy | `packages/server-core/src/sessions/SessionManager.ts:6446` | Chat launch logging includes workspace path, model, and message metadata on the hot path. | Keep operational fields, but redact or omit user message content by default. |
| TD-026 | Medium | Performance | `packages/shared/src/config/storage.ts:596` | `getWorkspaces` synchronously reads config and icon stats per workspace every call. | Cache workspace metadata with invalidation on writes/file changes. |
| TD-027 | Medium | Build/Review Cost | `packages/shared/src/skills/bundled.generated.ts:1` | A 23k-line generated TypeScript file is committed and parsed as source. | Move bundled skill payloads to generated JSON/assets or lazy-load them outside the TS compile path. |
| TD-028 | Medium | Frontend Maintainability | `apps/electron/src/renderer/components/app-shell/AppShell.tsx:660` | `AppShell` owns migration, persisted state, filters, navigation, and workspace UI concerns. | Split persisted preferences and sidebar filtering into hooks/services. |
| TD-029 | Medium | Frontend Maintainability | `apps/electron/src/renderer/components/app-shell/AppShell.tsx:1735` | The app shell context value has a very large dependency surface. | Split context into smaller providers or selector hooks to reduce stale-render risk. |
| TD-030 | Low | Type Safety | `apps/electron/src/renderer/components/app-shell/AppShell.tsx:2358` | Sidebar label-building uses `any[]` and weakly typed items. | Introduce a typed sidebar item model. |
| TD-031 | Medium | Frontend Correctness | `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx:447` | Placeholder shuffling suppresses dependencies and can ignore later placeholder prop changes. | Keep the random seed stable, but include prop changes in the computed placeholder list. |
| TD-032 | Medium | Frontend State | `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx:1245` | Source mentions are optimistically enabled before backend launch confirms usability. | Add pending/rollback state or defer UI mutation until backend preflight succeeds. |
| TD-033 | Medium | Preferences | `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx:975` | Renderer reads, merges, and writes preferences directly, which can race with other preference updates. | Route preference patches through one settings RPC that merges atomically. |
| TD-034 | Medium | UI Truthfulness | `apps/electron/src/renderer/hooks/useBackgroundTasks.ts:71` | Killing agent tasks is explicitly not implemented, but the UI still removes the task from the visible list. | Keep the task visible and show unsupported/failed kill status. |
| TD-035 | Medium | Frontend Maintainability | `packages/ui/src/components/chat/TurnCard.tsx:320` | `TurnCard` has a large prop surface and owns too much rendering behavior. | Split tool rendering, annotations, diffs, markdown, and turn grouping into smaller components. |
| TD-036 | Medium | Frontend Correctness | `packages/ui/src/components/chat/TurnCard.tsx:3212` | A large custom `memo` comparator controls chat rendering freshness. | Replace with smaller memoized children or add focused tests for every comparator field. |
| TD-037 | Medium | Circular Dependencies | `packages/ui/src/components/chat/turn-utils.ts:9` | UI chat utilities import shared tool-name helpers and participate in circular dependency output. | Move display-only tool naming to a UI-safe package boundary. |
| TD-038 | Medium | Config Architecture | `packages/shared/src/config/validators.ts:15` | Config validators import across automations, credentials, LLM connections, prompts, and sources. Madge flags this area in cycles. | Split pure schemas from runtime config helpers. |
| TD-039 | Medium | Source Reliability | `packages/shared/src/sources/storage.ts:70` | Malformed source configs can be swallowed and returned as missing configs. | Report invalid source config paths and preserve a backup for recovery. |
| TD-040 | Medium | Feature Contract | `packages/shared/src/sources/storage.ts:770` | `includeCredentials` is documented as not implemented for source mirroring. | Hide the option until implemented, or implement credential mirroring with explicit confirmation. |
| TD-041 | Low | Docs/Product Drift | `README.md:1` | Root docs still present the project as Craft Agents, while the Electron package product is Runner. | Update README/package naming once the external product boundary is settled. |
| TD-042 | Low | Docs/Product Drift | `package.json:5` | Root package description still says "Claude Code-like agent for Craft documents." | Rewrite package metadata to match RunnerOS. |
| TD-043 | Low | Error Visibility | `packages/shared/src/config/storage.ts:1279` | Invalid theme files are skipped with little user-visible recovery context. | Log a structured warning and surface a settings diagnostic. |
| TD-044 | Low | Error Visibility | `packages/shared/src/config/storage.ts:2874` | Tool icon seeding ignores all errors. | Emit a debug diagnostic so broken bundled assets are visible. |
| TD-045 | Low | i18n/UI Copy | `apps/electron/src/renderer/components/app-shell/AppShell.tsx:3045` | Some status/label filter copy is hardcoded inside the renderer. | Move copy to the same label/status copy source as the rest of the shell. |

## Quick Wins

1. Upgrade direct vulnerable packages: `electron`, `@modelcontextprotocol/sdk`, `tar`, `postcss`, `vite`.
2. Add one URL sanitizer and use it in both Electron external-open paths.
3. Redact raw privileged command logs.
4. Add malformed workflow activation manifest backup/diagnostics.
5. Add package declarations for real cross-package imports surfaced by Knip.
6. Add a focused test file for extracted agent session resolution.
7. Delete duplicate workflow event helper after call-site check.
8. Add a non-blocking `debt:check` script for `bun audit`, Madge, and configured Knip.

## Looks Bad But Is Probably Fine

| Area | Evidence | Why It Is Probably Fine |
|---|---|---|
| Sandbox unavailable paths | `packages/shared/tests/script-sandbox.test.ts:69` | Tests accept either enforced isolation or a clear diagnostic error. That is fail-loud enough for the current abstraction. |
| HTML preview iframe | `apps/electron/src/renderer/components/HTMLPreviewOverlay.tsx:204` | It uses `allow-same-origin`, but does not include `allow-scripts`, so the risky part is limited. Keep it reviewed if scripts are ever added. |
| Workflow trigger normalization on resume | `packages/server-core/src/workflows/workflow-runs.ts:98` | The normalized value is not reused, but the call still validates and throws on bad historical inputs. Odd, but not automatically broken. |
| UI peer dependencies | `packages/ui/package.json:31` | Many UI dependencies are intentionally peers because the host app supplies React/Radix/etc. Do not blindly auto-add every peer warning. |
| Command-substitution defenses | `packages/shared/src/agent/mode-manager.ts:600` | The logic is verbose, but the parser has deliberate command-substitution checks. This is complexity, not dead code. |
| Workflow runner tests | `packages/server-core/src/workflows/runner.test.ts:212` | Workflow runner coverage is broad. The bigger gap is real resolver/source integration, not the runner core itself. |

## Open Questions

1. Should RunnerOS keep backwards-compatible `craft-agent` package names, or is a clean rename planned?
2. Are global workflows intentionally stored at `~/.workflows`, or should they move under the same config root as agents/skills/sources?
3. Should chat launch fail hard when required sources are unusable, matching workflow preflight behavior?
4. Is generated skill bundling required for offline install, or can bundled skills move to assets loaded outside TypeScript?
5. Which audit tool should become canonical for Bun workspaces: `bun audit` only, or `bun audit` plus configured Knip/Madge?

