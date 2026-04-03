# Craft Plugin Platform Standard

**Status:** Active implementation standard  
**Last updated:** 2026-04-03  
**Primary example:** Hermes external backend plugin  
**Supersedes:** [2026-04-02-plugin-platform-spec.md](./plans/2026-04-02-plugin-platform-spec.md) as the day-to-day implementation reference

## Purpose

This document defines the extension contract for Craft's plugin system as it exists after Hermes Phase 7. It is the reference for adding:

- another agent or backend runtime
- settings panes and route pages
- session and composer actions
- chat card surfaces
- future richer plugin-owned features such as custom tools, app surfaces, and provider integrations

The goal is one extension spine for both runtime and UI growth. New features should fit the capability model already present in the codebase instead of creating parallel integration paths.

## Design Principles

### 1. The host owns the platform

The Electron main process is the kernel. Plugin discovery, compatibility checks, activation, persistence, quarantine, and backend registration all live in the plugin host layer under:

- `packages/server-core/src/plugins/*`

Plugins may contribute capabilities, but they do not bypass the host to patch arbitrary renderer or session internals.

### 2. Capabilities are typed, not ad hoc

The canonical plugin vocabulary lives in:

- `packages/shared/src/plugins/types.ts`

Current capability types are:

- `backend`
- `routingPolicy`
- `sourceConnector`
- `settingsPane`
- `routePage`
- `sessionAction`
- `composerAction`
- `chatCardType`
- `eventEnricher`
- `taskProvider`
- `automationProvider`
- `voiceInputProvider`
- `speechOutputProvider`
- `mcpAppProvider`

If a new feature does not fit one of these cleanly, the right move is to extend the shared capability taxonomy first, then wire host and renderer support, rather than inventing a one-off side channel.

### 3. The renderer consumes projected surfaces

The renderer should load host-projected capability lists and render them into stable UI slots. Current projection lives under:

- `apps/electron/src/renderer/components/plugins/registry.ts`

This keeps plugin UI integration bounded. A plugin can ask for a settings pane or chat card type, but the host decides how that surface is exposed.

### 4. Session identity stays host-owned

Local Craft session identity is not the same thing as backend continuity. Helper-backed runtimes must store backend session pointers in backend-owned state such as `sdkSessionId`, while Craft keeps its own session ids, normalized transcript, permissions, and UI state.

Hermes is the first concrete example of this rule.

## Lifecycle And Trust Model

### Discovery and registration

The plugin host:

1. Loads manifests from the plugin directory or built-in registrations.
2. Verifies API compatibility and engine support.
3. Registers manifest-declared capabilities in the capability registry.
4. Persists enabled, disabled, quarantined, and error state.
5. Activates eligible external plugins by wiring their helper/runtime hooks into host services.

Key files:

- `packages/server-core/src/plugins/host.ts`
- `packages/server-core/src/plugins/registry.ts`
- `packages/server-core/src/plugins/loader.ts`
- `packages/server-core/src/plugins/storage.ts`

### Trust and permissions

Manifest permissions declare what a plugin is allowed to do. The current permission model includes:

- network
- filesystem
- session read/write
- source read/write
- tool invocation
- UI rendering
- voice input/output
- automation management

Permissions are descriptive and host-enforced. They are not a suggestion. If a plugin needs a new power, add it to the shared permission model before relying on it.

### Quarantine

Activation failures or unsafe behavior should degrade the plugin, not crash the app. The host can disable or quarantine a plugin and preserve the error in plugin state so the UI can explain what happened.

## Manifest Contract

Every plugin manifest should declare:

- identity and version
- supported Craft API version
- engine requirements
- permissions
- entrypoints
- contribution ids grouped by capability type
- optional capability metadata used by the host and renderer

The manifest shape is defined by `CraftPluginManifest` in:

- `packages/shared/src/plugins/types.ts`

The Hermes manifest is the first concrete backend example:

- `plugins/hermes/plugin.json`

## Host-Owned Versus Plugin-Owned Responsibilities

### Host-owned

The host remains responsible for:

- plugin lifecycle and persistence
- session identity and transcript storage
- backend selection and routing
- MCP exposure decisions
- user-visible permissions and safety behavior
- route and settings registration
- chat-shell rendering

### Plugin-owned

A plugin may own:

- helper/runtime implementation details
- provider-specific transport logic
- plugin-specific config and diagnostics
- plugin-defined metadata for its declared surfaces
- optional host-approved settings or route affordances

### Shared boundary

The contract boundary should be narrow and typed. A plugin should communicate through the manifest, helper/runtime bridge, and host registries, not through renderer globals or direct filesystem mutation of unrelated Craft state.

## Backend Plugin Pattern

Use a `backend` contribution when the plugin provides a new agent runtime or model execution path.

### The standard shape

1. Add a manifest with a `backend` contribution id.
2. Add a helper or runtime entrypoint.
3. Activate the plugin through `PluginHost`.
4. Register the backend through the existing external backend registration seam in:
   - `packages/shared/src/agent/backend/factory.ts`
5. Keep backend session continuity in backend-owned state, not Craft's local session id.
6. Expose backend capabilities such as branching explicitly through registration metadata.

### Hermes as the example

Hermes proves the intended path:

- plugin package:
  - `plugins/hermes/plugin.json`
  - `plugins/hermes/main.mjs`
- managed runtime preparation:
  - `packages/server-core/src/plugins/hermes-runtime.ts`
- host activation:
  - `packages/server-core/src/plugins/host.ts`
- bridge/session semantics:
  - `packages/shared/src/agent/plugin-bridge-agent.ts`
  - `packages/server-core/src/sessions/SessionManager.ts`

Hermes uses:

- API-first transport via `/v1/responses`
- CLI fallback for debugging
- `sdkSessionId`/bridge session state for backend continuity
- host-side transcript recovery when backend continuity breaks
- `supportsBranching=false`

That is the baseline for future external runtimes.

## UI Extension Pattern

Use a UI capability when the plugin extends an existing host-owned surface.

### Settings panes

Use `settingsPane` when a plugin needs a bounded settings surface. The plugin supplies metadata; the host decides where it appears in the settings shell.

### Route pages

Use `routePage` when the feature needs a navigable host-approved page. Routes should stay namespaced and typed through the shared navigation model.

### Session actions and composer actions

Use `sessionAction` or `composerAction` when the feature behaves like an existing command surface instead of a whole page. These should be small, intentional actions, not catch-all escape hatches.

### Chat cards

Use `chatCardType` when the plugin needs to decorate assistant/tool/plan turns with structured visual presentation. Matching stays declarative through capability metadata rather than letting plugins directly render into the transcript.

### Future richer app surfaces

Use `mcpAppProvider` for richer interactive app-style surfaces once the host is ready to project them safely. This is future-facing capability space, not a reason to bypass the current platform rules.

## Production-Ready Versus Future-Facing

### Production-ready now

These are implemented enough to treat as current platform contract:

- plugin manifest loading and registration
- capability registry
- plugin enable/disable/quarantine state
- external backend registration
- renderer projection for session actions, composer actions, and chat card types
- Hermes as a working external backend plugin

### Future-facing

These are in the capability taxonomy but should still be treated as staged expansion areas:

- routing policies beyond narrow host use
- source connector ecosystem
- task and automation providers
- voice input and speech output providers
- MCP app providers with richer inline UI

The rule is simple: declare the capability shape early, but do not claim a surface is stable until host, renderer, persistence, tests, and permissions all exist together.

## How To Add A New Plugin

### Add another agent/backend

1. Create a plugin package with a `backend` contribution.
2. Add helper/runtime code that speaks the provider's real transport.
3. Register activation in the plugin host.
4. Use the shared external backend registration seam.
5. Keep backend continuity separate from local Craft session ids.
6. Add host, session, and bridge tests.

### Add a settings pane

1. Declare a `settingsPane` contribution in the manifest.
2. Add host-projected metadata.
3. Extend the renderer plugin surface registry if needed.
4. Keep settings state in host-approved storage rather than arbitrary plugin files unless the plugin truly owns that config.

### Add a route page

1. Declare a `routePage` contribution.
2. Register a typed route and a host projection path.
3. Keep navigation host-controlled and namespaced.

### Add a session action or composer action

1. Declare `sessionAction` or `composerAction`.
2. Register the handler through the plugin host.
3. Return a typed invoke result such as navigation, toast, or insert-text behavior.

### Add a chat card type

1. Declare a `chatCardType`.
2. Add matcher metadata for assistant/tool/plan roles or tool state.
3. Let the renderer resolve the match from host-projected capabilities.

### Add a future richer provider

1. Add the capability type or use the existing future-facing type if it fits.
2. Extend shared plugin types first.
3. Add host lifecycle and permission support.
4. Add renderer projection only after the host contract is stable.

## Testing Requirements

A new plugin surface is not complete without tests at the layer where it integrates.

### For all plugins

- manifest parsing or registration coverage
- plugin host activation coverage
- enable/disable/quarantine behavior where relevant

### For backend plugins

- backend registration and capability flags
- session continuity behavior
- recovery behavior
- helper/runtime error handling

### For renderer-facing capabilities

- capability projection tests
- UI-surface registry tests
- action execution or card matching tests when behavior depends on metadata

## Change Control

When extending the plugin system:

1. change shared types first
2. update host registration or lifecycle behavior
3. update renderer projection only if a visible surface is involved
4. add tests at each touched boundary
5. document the new capability here or in a linked focused doc if it becomes large enough

This prevents the platform from drifting into a collection of plugin-shaped exceptions.

## Summary

The Craft plugin system should be treated as a single extension platform with one host-owned control plane and one shared capability vocabulary. Hermes is the first fully implemented example of that design for external runtimes, and the same pattern should now be used for new backends, new UI surfaces, and future provider-style integrations.
