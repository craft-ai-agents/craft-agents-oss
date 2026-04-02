# Craft Agents Unified Plugin Platform Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use [skill:executing-plans] to implement this plan task-by-task.

**Goal:** Build one host-owned plugin platform for Craft Agents so future backends, UI extensions, routing logic, chat surfaces, voice features, MCP-app integrations, and helper services can all flow through one stable extension spine instead of being bolted onto random code paths.

**Architecture:** Extend the existing main-process control plane instead of inventing a second one. Put a `PluginHost` and typed capability registry behind the existing RPC/session/backend seams, run third-party code out of process behind a bridge runtime, and let the renderer consume only host-projected routes, settings panes, cards, actions, and composer affordances.

**Tech Stack:** Electron, TypeScript, Bun, RPC transport, `packages/server-core`, `packages/shared`, typed routes/settings registry, existing backend abstraction in `packages/shared/src/agent/backend/*`, existing source/MCP handlers, feature flags.

---

## Executive Summary

Craft Agents already has most of the hard parts needed for a plugin platform. The app has a centralized RPC registration flow, a shared `SessionManager`, a backend abstraction layer, a model registry, typed routes, a settings registry, a feature-flag system, and source/MCP discovery patterns. That means the safest move is not a rewrite. It is to add one plugin host on top of the seams the app already trusts.

This spec chooses a single approach:

1. Main-process plugin host as the kernel
2. Manifest-driven discovery and compatibility checks
3. Typed capability registry for all extension kinds
4. Out-of-process bridge runtime for code-backed plugins
5. Thin renderer projection into fixed routes and UI slots
6. Built-in Claude and Pi paths treated as first-party registrations before third-party plugins

This gives us one extension surface for:

- additional agent runtimes like Codex CLI, Hermes, OpenClaw, and Claude Code
- routing policies and backend selection
- source and helper-service plugins
- settings pages, info panes, and plugin management UI
- chat cards, composer actions, and session actions
- voice input/output chains
- MCP app-style dynamic tool and app surfaces

## Why This Spec Exists

We want one route for app extension instead of many ad hoc seams. Right now the app already supports a lot of the user-facing behavior that other agent systems expose: tasks, progress, tool events, permissions, sources, and settings. The right move is to create a platform that can normalize new runtimes and new UI affordances into those existing app concepts.

This document consolidates:

- the repo packet and system map work
- the main-process evidence addendum from the installed app bundle
- the plugin platform architecture reports
- direct source inspection in the real repo
- the additional product goals discussed afterward, including chat cards, MCP app surfaces, voice features, and hook-based UI extension

## Current Verified Architecture

These are the strongest seams we should build on.

### 1. Main-process control plane already exists

Current source:

- `apps/electron/src/main/handlers/index.ts`
- `packages/server-core/src/handlers/rpc/index.ts`
- `apps/electron/src/main/index.ts`

What is already true:

- `registerAllRpcHandlers()` composes the app's main RPC behavior.
- `registerCoreRpcHandlers()` already centralizes auth, automations, files, labels, LLM connections, OAuth, onboarding, sessions, settings, skills, sources, statuses, system, and workspace handlers.
- The installed `dist/main.cjs` also shows broad centralized RPC namespaces for sessions, workspaces, LLM connections, Pi provider-model lookup, and source/MCP capability access.

Implication:

- The plugin kernel belongs here, not in the renderer and not in SDK subprocesses.

### 2. Session orchestration is centralized

Current source:

- `packages/server-core/src/sessions/SessionManager.ts`

What is already true:

- `SessionManager` is already the center of session lifecycle, source hydration, permissions, automation wiring, MCP pools, model selection, and event forwarding.
- It already creates runtimes through shared backend helpers like `resolveSessionConnection()`, `createBackendFromConnection()`, and `createBackendFromResolvedContext()`.

Implication:

- New runtimes should register into the session layer instead of inventing a separate conversation engine.

### 3. Backend abstraction already exists

Current source:

- `packages/shared/src/agent/backend/types.ts`
- `packages/shared/src/agent/backend/factory.ts`
- `packages/shared/src/agent/backend/index.ts`
- `packages/shared/src/agent/backend/claude/*`
- `packages/shared/src/agent/backend/pi/*`

What is already true:

- The app already has an `AgentBackend` abstraction.
- Drivers and event adapters already normalize multiple providers into common `AgentEvent` behavior.
- `factory.ts` already has a driver registry and provider resolution path.

Implication:

- We are not starting from zero.
- The plugin platform should evolve this into a plugin-aware backend registry instead of creating a parallel backend architecture.

### 4. Provider and model lookup are already centralized

Current source:

- `packages/shared/src/config/models.ts`
- `packages/server-core/src/handlers/rpc/llm-connections.ts`
- installed `dist/main.cjs` evidence for `getModelsByProvider()`, `getModelById()`, and `getModelProvider()`

What is already true:

- Anthropic models live in `MODEL_REGISTRY`.
- Pi models are discovered dynamically.
- Model/provider lookup already has a central place.

Implication:

- Backend plugins should register provider and model descriptors into one registry instead of teaching the renderer about every new model family.

### 5. Typed routes and settings already exist

Current source:

- `apps/electron/src/shared/routes.ts`
- `apps/electron/src/shared/settings-registry.ts`
- `apps/electron/src/renderer/contexts/NavigationContext.tsx`
- `apps/electron/src/renderer/App.tsx`

What is already true:

- The app has typed route builders and route parsing.
- Settings pages are declared in a central registry.
- Navigation already depends on named route surfaces rather than free-form router mutation.

Implication:

- UI extensions should project into fixed namespaces and settings slots, not arbitrary route injection.

### 6. Renderer info-page primitives already exist

Current source:

- `apps/electron/src/renderer/components/info/Info_Page.tsx`
- `apps/electron/src/renderer/components/info/Info_Section.tsx`
- `apps/electron/src/renderer/components/info/Info_Table.tsx`
- `apps/electron/src/renderer/components/info/Info_DataTable.tsx`
- `apps/electron/src/renderer/components/info/Info_Markdown.tsx`
- `apps/electron/src/renderer/components/info/PermissionsDataTable.tsx`
- `apps/electron/src/renderer/components/info/ToolsDataTable.tsx`

Implication:

- Plugin UI can start as host-rendered structured pages before we ever allow richer plugin-owned interfaces.

### 7. Source and MCP access are already host-mediated

Current source:

- `packages/server-core/src/handlers/rpc/sources.ts`
- `apps/electron/src/transport/channel-map.ts`
- `packages/shared/src/protocol/channels.ts`
- installed `dist/main.cjs` evidence for `sources:getMcpTools`

Implication:

- MCP and source connectors should become plugin contribution types under the host, not the whole plugin system.

### 8. Feature flags already exist

Current source:

- `packages/shared/src/feature-flags.ts`

Implication:

- The plugin platform should ship behind flags and keep rollback cheap.

## Core Product Decision

The correct move is to build **one host-owned plugin platform in the main process** and let everything else register into it.

That means:

- backends become a capability type
- routing policies become a capability type
- sources and helper services become capability types
- settings panes and pages become capability types
- chat cards and composer actions become capability types
- voice input and output become capability types
- MCP app surfaces become capability types

Nothing gets to become its own side architecture.

## Goals

1. Create one extension surface for runtime, UI, workflow, and system-level extensions.
2. Let current built-ins participate in the same host contract as future plugins.
3. Preserve the current session/event model so the renderer stays generic.
4. Keep the app update-survivable by minimizing core patch points.
5. Support both first-party and third-party plugin lifecycles.
6. Make plugin permissions and trust explicit and separate from agent tool approvals.
7. Allow richer future surfaces like voice, app cards, and MCP-app UI without requiring a second architecture later.

## Non-Goals

1. Do not rewrite the chat shell.
2. Do not let plugins import arbitrary app internals from the renderer.
3. Do not make `--plugin-dir` or MCP the whole architecture.
4. Do not allow free-form top-level route mutation.
5. Do not store mutable third-party plugin code in bundled resource paths that are overwritten on app sync/update.
6. Do not require each backend or feature plugin to invent its own event model, persistence scheme, or settings surface.

## Recommended Platform Shape

The recommended platform is a hybrid with four layers.

### Layer A. Main-process `PluginHost`

Responsibilities:

- discovery
- compatibility checks
- trust and permission checks
- enable and disable state
- lifecycle management
- contribution registration
- event logging and quarantine on failure

This is the kernel.

### Layer B. Typed capability registry

Responsibilities:

- answer "what exists?"
- answer "what applies here?"
- let sessions, settings, routing, sources, and UI all query one registry
- keep capability kinds typed and discoverable

This is the app-facing API surface.

### Layer C. Bridge runtime for code-backed plugins

Responsibilities:

- run third-party code out of process
- isolate crashes
- isolate SDK and CLI dependencies
- translate plugin calls into host-safe messages

This is the compatibility membrane.

### Layer D. Thin renderer projection

Responsibilities:

- render host-approved plugin pages, settings panes, actions, cards, and buttons
- never let plugins directly patch random renderer internals
- keep UI contributions declarative when possible

This is the safe UI layer.

## Plugin Model

Each plugin has:

1. a manifest
2. optional runtime code
3. declared capabilities
4. optional helper bridges
5. host-managed state

### Manifest shape

Recommended fields:

```ts
interface CraftPluginManifest {
  id: string
  name: string
  version: string
  apiVersion: string
  description?: string
  author?: string
  homepage?: string
  engines: {
    craftAgents: string
  }
  trust?: {
    signed?: boolean
    publisher?: string
  }
  permissions: Array<
    | 'network'
    | 'filesystem'
    | 'session.read'
    | 'session.write'
    | 'routing.control'
    | 'sources.read'
    | 'sources.write'
    | 'tools.invoke'
    | 'voice.input'
    | 'voice.output'
    | 'ui.render'
    | 'automation.manage'
  >
  entrypoints?: {
    main?: string
    helper?: string
    ui?: string
  }
  contributions: {
    backends?: string[]
    routingPolicies?: string[]
    sourceConnectors?: string[]
    settingsPanes?: string[]
    routes?: string[]
    sessionActions?: string[]
    composerActions?: string[]
    chatCardTypes?: string[]
    eventEnrichers?: string[]
    taskProviders?: string[]
    automationProviders?: string[]
    voiceInputProviders?: string[]
    speechOutputProviders?: string[]
    mcpAppProviders?: string[]
  }
}
```

### Runtime activation API

Recommended host API:

```ts
interface PluginActivationContext {
  registerBackend(def: BackendContribution): void
  registerRoutingPolicy(def: RoutingPolicyContribution): void
  registerSourceConnector(def: SourceConnectorContribution): void
  registerSettingsPane(def: SettingsPaneContribution): void
  registerRoutePage(def: RoutePageContribution): void
  registerSessionAction(def: SessionActionContribution): void
  registerComposerAction(def: ComposerActionContribution): void
  registerChatCardType(def: ChatCardContribution): void
  registerEventEnricher(def: EventEnricherContribution): void
  registerTaskProvider(def: TaskProviderContribution): void
  registerAutomationProvider(def: AutomationProviderContribution): void
  registerVoiceInputProvider(def: VoiceInputContribution): void
  registerSpeechOutputProvider(def: SpeechOutputContribution): void
  registerMcpAppProvider(def: McpAppContribution): void
  logger: Logger
  host: PluginHostServices
}
```

## Capability Types

This is the platform-wide list of things plugins should eventually be able to contribute.

### V1 capability types

These should ship first because they map cleanly to existing seams.

1. `backend`
2. `routingPolicy`
3. `sourceConnector`
4. `settingsPane`
5. `routePage`
6. `sessionAction`
7. `eventEnricher`
8. `taskProvider`
9. `automationProvider`

### V1.5 capability types

These are good second-wave additions after the host exists.

1. `composerAction`
2. `chatCardType`
3. `voiceInputProvider`
4. `speechOutputProvider`

### V2 capability types

These need stronger trust, sandboxing, or renderer-shell rules.

1. `mcpAppProvider`
2. `richPluginPage`
3. `customInspectorPanel`
4. `toolResultRenderer`

## What This Platform Would Let Us Build

This is the practical benefit map.

### Agent and backend plugins

- Codex CLI backend
- Hermes backend
- OpenClaw backend
- Claude Code backend
- local agent wrappers
- remote agent bridge backends
- provider-specific auth and model discovery plugins

### Routing and orchestration plugins

- route by task type
- route by workspace
- route by source/tool usage
- route by privacy or cost rules
- route by reasoning depth or latency preference
- fallback chains across runtimes
- handoff and escalation rules

### UI and settings plugins

- backend picker in new-session flow
- per-workspace backend defaults
- plugin manager page
- plugin health page
- routing-policy page
- backend diagnostics page
- plugin-owned settings panes

### Chat and card plugins

- new chat card types
- progress and task visualizers
- interactive approval cards
- recovery or degraded-mode cards
- "open plugin page" cards
- MCP tool result cards

### Composer and input plugins

- slash commands
- quick action buttons
- backend picker button
- microphone button
- push-to-talk
- attachment preprocessors
- prompt templates

### Voice plugins

- local speech-to-text
- remote speech-to-text
- local text-to-speech
- remote text-to-speech
- voice-to-voice chains
- playback controls and per-backend voice modes

### Source, MCP, and app-style plugins

- MCP server connectors
- source discovery plugins
- MCP tool catalogs
- dynamic app cards backed by MCP app metadata
- embedded app-like panels after the host learns how to safely render them

### Workflow and system plugins

- research workflow plugins
- coding workflow plugins
- memory workflow plugins
- export/import plugins
- observability and audit plugins
- credential-helper plugins
- local model runner plugins
- background service bridge plugins

## Hook System Design

The hook system should attach plugins to **interfaces**, not file locations and not DOM selectors.

That means plugin contributions bind to stable names like:

- `backend.registry`
- `routing.policy`
- `source.catalog`
- `settings.sections`
- `navigation.routes`
- `session.actions`
- `composer.actions`
- `chat.cards`
- `event.pipeline`
- `voice.input`
- `speech.output`
- `mcp.app.surface`

### Recommended host hook names

```ts
type PluginHookName =
  | 'backend.registry'
  | 'routing.policy'
  | 'source.catalog'
  | 'settings.sections'
  | 'navigation.routes'
  | 'session.actions'
  | 'composer.actions'
  | 'chat.cards'
  | 'event.pipeline'
  | 'task.providers'
  | 'automation.providers'
  | 'voice.input'
  | 'speech.output'
  | 'mcp.app.surface'
```

This is the key update-survival rule:

- plugins should be tied to app interfaces
- not to component locations
- not to DOM structure
- not to brittle import paths

## Chat Cards, MCP App Surfaces, and Voice

These are all possible, but they should not all land in the first implementation slice.

### Chat cards

Yes, the platform should eventually support plugin-defined chat card types.

Recommended design:

- plugin registers a card type
- plugin declares a schema for its card payload
- host owns placement and lifecycle
- renderer uses host-owned card shells and action dispatch

Avoid in v1:

- arbitrary plugin React injection into the chat stream

### MCP app dynamic loading

Yes, this should be supported eventually, especially because the product direction across chat tools is moving toward app-like inline experiences.

Recommended approach:

- treat MCP app support as a plugin capability type
- host resolves app metadata and permissions
- renderer loads only host-approved plugin app surfaces under one namespace
- start with structured cards and fixed plugin pages before fully sandboxed app iframes or complex dynamic UI

Avoid in v1:

- making the app shell depend on raw third-party app UI contracts before the plugin host and permission model exist

### Microphone, STT, TTS, and voice-to-voice

Yes, this is a natural plugin fit.

Recommended approach:

- `voiceInputProvider` contributes capture or transcription
- `speechOutputProvider` contributes playback
- composer gets a host-owned microphone button slot
- message cards and session surfaces get host-owned playback buttons
- backend routing policy can choose which runtime handles voice-related tasks

Avoid in v1:

- tightly coupling one speech stack into the core app

## Trust, Permissions, and Sandboxing

Plugin permissions must be separate from agent tool approvals.

That means:

- "this plugin may read sessions" is not the same as "the agent may run bash"
- "this plugin may use network" is not the same as "the current session may call a mutation tool"

Recommended rules:

1. plugin install/enable permissions are host-level trust decisions
2. session tool approvals remain session-level decisions
3. plugin permissions are declared in the manifest
4. runtime bridge enforces what plugin code can ask for
5. the UI explains the difference between plugin trust and agent tool approval

## Persistence and Installation Model

Use three layers.

### 1. Bundled first-party defaults

Use for:

- built-in plugins
- example manifests
- default host-provided capabilities

Do not use for:

- mutable third-party plugin installs

### 2. User-installed plugin code

Recommended location:

- `~/.craft-agent/plugins/{pluginId}/`

Use for:

- third-party plugin code
- external bridge helpers
- signatures and installed metadata

### 3. Plugin state and overrides

Recommended locations:

- global state: `~/.craft-agent/plugin-state.json`
- plugin config: `~/.craft-agent/plugins/{pluginId}/config.json`
- workspace overrides: `~/.craft-agent/workspaces/{workspaceId}/plugins/{pluginId}.json`

## Failure and Update Behavior

### On app startup

- invalid plugins do not block app startup
- failed plugins are quarantined
- host logs load failures
- plugin manager shows failure state

### On app update

- compatible plugins continue loading
- incompatible plugins are disabled but preserved
- sessions tied to missing backend plugins open in degraded mode with recovery actions

### On plugin disappearance

- session shows degraded-mode banner
- user can rebind the session to another backend
- plugin config remains intact for later recovery

## Update-Survival Rules

These rules are non-negotiable if the platform is supposed to survive upstream updates.

1. Patch composition roots, not generated bundle blobs.
2. Keep plugin registration behind the main-process control plane.
3. Keep renderer additions behind typed routes, settings registry, and fixed UI slots.
4. Keep new backends behind the existing backend abstraction and normalized event model.
5. Keep third-party code out of Electron main where possible.
6. Keep plugin install paths out of overwrite-on-launch bundled resource locations.
7. Prefer first-party registrations before third-party execution.
8. Ship behind flags and staged rollouts.

## Recommended File Touch Points

These are the best starting surfaces in the real source tree.

### Main process and host

- Modify: `packages/server-core/src/handlers/rpc/index.ts`
- Modify: `apps/electron/src/main/handlers/index.ts`
- Modify: `apps/electron/src/main/index.ts`
- Create: `packages/server-core/src/plugins/index.ts`
- Create: `packages/server-core/src/plugins/host.ts`
- Create: `packages/server-core/src/plugins/registry.ts`
- Create: `packages/server-core/src/plugins/loader.ts`
- Create: `packages/server-core/src/plugins/storage.ts`
- Create: `packages/server-core/src/plugins/bridge-runtime.ts`

### Shared contracts

- Create: `packages/shared/src/plugins/types.ts`
- Create: `packages/shared/src/plugins/manifest.ts`
- Modify: `packages/shared/src/protocol/channels.ts`
- Modify: `packages/shared/src/protocol/dto.ts`
- Modify: `packages/shared/src/feature-flags.ts`

### Sessions and backend integration

- Modify: `packages/server-core/src/sessions/SessionManager.ts`
- Modify: `packages/shared/src/agent/backend/types.ts`
- Modify: `packages/shared/src/agent/backend/index.ts`
- Modify: `packages/shared/src/agent/backend/factory.ts`
- Modify: `packages/shared/src/config/models.ts`

### Renderer projection

- Modify: `apps/electron/src/transport/channel-map.ts`
- Modify: `apps/electron/src/shared/routes.ts`
- Modify: `apps/electron/src/shared/settings-registry.ts`
- Modify: `apps/electron/src/renderer/contexts/NavigationContext.tsx`
- Modify: `apps/electron/src/renderer/App.tsx`
- Create: `apps/electron/src/renderer/pages/settings/PluginsSettingsPage.tsx`
- Create: `apps/electron/src/renderer/pages/settings/RoutingSettingsPage.tsx`

### Renderer primitives for structured UI

- Reuse first: `apps/electron/src/renderer/components/info/*`
- Later create:
  - `apps/electron/src/renderer/components/plugins/PluginCardHost.tsx`
  - `apps/electron/src/renderer/components/plugins/ComposerActionBar.tsx`
  - `apps/electron/src/renderer/components/plugins/VoiceButton.tsx`

## Recommended Implementation Order

This is the proper order.

### Phase 0. Documentation and isolation

Already done here:

- create a dedicated worktree and branch
- write the architecture/spec
- keep implementation isolated from the current dirty main checkout

Execution workspace:

- Repo: `/Users/kosta/LocalDev/craft-agents-oss`
- Worktree: `/Users/kosta/LocalDev/.worktrees/craft-agents-oss/plugin-platform-spec`
- Branch: `codex/plugin-platform-spec`

### Phase 1. Host kernel and built-in registrations

Build:

- plugin manifest types
- plugin registry
- plugin host
- built-in plugin descriptors for current Anthropic and Pi support

Outcome:

- the current app behavior is unchanged
- Claude and Pi are now expressed as first-party host registrations

### Phase 2. Backend and routing integration

Build:

- backend capability registration
- routing policy registration
- session metadata support for `backendId`
- plugin RPC surface for list/get/enable/disable

Outcome:

- backend selection becomes registry-driven
- future runtimes are additive

### Phase 3. Renderer projection

Build:

- `settings/plugins`
- `settings/routing`
- host-projected session actions
- host-projected plugin page namespace

Outcome:

- plugin UI gets one predictable home

### Phase 4. External bridge runtime

Build:

- external plugin loading
- helper runtime isolation
- plugin trust and quarantine rules

Outcome:

- third-party plugins can participate without living in the Electron main process

### Phase 5. Richer UI surfaces

Build:

- composer actions
- chat card types
- voice providers
- MCP app-provider surface

Outcome:

- richer product features can ride the same platform

## Implementation Plan

### Task 1: Introduce shared plugin contracts

**Files:**
- Create: `packages/shared/src/plugins/types.ts`
- Create: `packages/shared/src/plugins/manifest.ts`
- Modify: `packages/shared/src/protocol/channels.ts`
- Modify: `packages/shared/src/protocol/dto.ts`
- Test: `packages/shared/src/__tests__/plugin-manifest.test.ts`

**Step 1: Write the failing tests**

Cover:

- manifest validation
- capability typing
- permission enum validation
- version compatibility checks

**Step 2: Run test to verify it fails**

Run: `bun test packages/shared/src/__tests__/plugin-manifest.test.ts`

**Step 3: Write minimal implementation**

Add:

- manifest types
- capability contribution types
- shared RPC channel names for plugin host access

**Step 4: Run test to verify it passes**

Run: `bun test packages/shared/src/__tests__/plugin-manifest.test.ts`

**Step 5: Commit**

Commit only the shared plugin contract files and tests.

### Task 2: Create the main-process plugin host and registry

**Files:**
- Create: `packages/server-core/src/plugins/index.ts`
- Create: `packages/server-core/src/plugins/host.ts`
- Create: `packages/server-core/src/plugins/registry.ts`
- Create: `packages/server-core/src/plugins/loader.ts`
- Create: `packages/server-core/src/plugins/storage.ts`
- Test: `packages/server-core/src/plugins/plugin-host.test.ts`

**Step 1: Write the failing tests**

Cover:

- built-in plugin registration
- duplicate plugin rejection
- disabled plugin state
- quarantine on activation failure

**Step 2: Run test to verify it fails**

Run: `bun test packages/server-core/src/plugins/plugin-host.test.ts`

**Step 3: Write minimal implementation**

Implement:

- discovery of built-in plugins first
- plugin registry indexing by capability type
- enable and disable state
- load failure quarantine behavior

**Step 4: Run test to verify it passes**

Run: `bun test packages/server-core/src/plugins/plugin-host.test.ts`

**Step 5: Commit**

Commit only the host and registry layer.

### Task 3: Add plugin RPC and transport exposure

**Files:**
- Create: `packages/server-core/src/handlers/rpc/plugins.ts`
- Modify: `packages/server-core/src/handlers/rpc/index.ts`
- Modify: `apps/electron/src/main/handlers/index.ts`
- Modify: `apps/electron/src/transport/channel-map.ts`
- Test: `apps/electron/src/transport/__tests__/channel-map-parity.test.ts`
- Test: `packages/server-core/src/handlers/rpc/plugins.test.ts`

**Step 1: Write the failing tests**

Cover:

- `plugins:list`
- `plugins:get`
- `plugins:enable`
- `plugins:disable`
- `plugins:listCapabilities`

**Step 2: Run test to verify it fails**

Run: `bun test packages/server-core/src/handlers/rpc/plugins.test.ts`

**Step 3: Write minimal implementation**

Wire:

- shared channels
- RPC handlers
- renderer transport exposure

**Step 4: Run tests to verify they pass**

Run:

- `bun test packages/server-core/src/handlers/rpc/plugins.test.ts`
- `bun test apps/electron/src/transport/__tests__/channel-map-parity.test.ts`

**Step 5: Commit**

Commit only the plugin RPC surface.

### Task 4: Convert current backends into first-party plugin registrations

**Files:**
- Modify: `packages/shared/src/agent/backend/types.ts`
- Modify: `packages/shared/src/agent/backend/index.ts`
- Modify: `packages/shared/src/agent/backend/factory.ts`
- Modify: `packages/server-core/src/sessions/SessionManager.ts`
- Modify: `packages/shared/src/config/models.ts`
- Test: `packages/shared/src/agent/backend/__tests__/factory.test.ts`
- Test: `packages/server-core/src/sessions/create-managed-session.test.ts`

**Step 1: Write the failing tests**

Cover:

- backend resolution through plugin registry
- built-in Anthropic and Pi registrations
- session metadata persistence of `backendId`
- clean fallback for legacy sessions with no `backendId`

**Step 2: Run test to verify it fails**

Run:

- `bun test packages/shared/src/agent/backend/__tests__/factory.test.ts`
- `bun test packages/server-core/src/sessions/create-managed-session.test.ts`

**Step 3: Write minimal implementation**

Do:

- make current built-ins register through the plugin host
- keep the event model unchanged
- preserve legacy session resume behavior

**Step 4: Run tests to verify they pass**

Run the same tests as in step 2.

**Step 5: Commit**

Commit only the backend-registration refactor.

### Task 5: Add plugin and routing settings surfaces

**Files:**
- Modify: `apps/electron/src/shared/settings-registry.ts`
- Modify: `apps/electron/src/shared/routes.ts`
- Modify: `apps/electron/src/renderer/contexts/NavigationContext.tsx`
- Modify: `apps/electron/src/renderer/App.tsx`
- Create: `apps/electron/src/renderer/pages/settings/PluginsSettingsPage.tsx`
- Create: `apps/electron/src/renderer/pages/settings/RoutingSettingsPage.tsx`
- Reuse: `apps/electron/src/renderer/components/info/*`

**Step 1: Write the failing tests**

Cover:

- route parsing and navigation for new settings pages
- plugin list rendering from transport data
- routing settings rendering from host registry

**Step 2: Run test to verify it fails**

Run the repo’s existing renderer/unit test command for the touched packages.

**Step 3: Write minimal implementation**

Do:

- add `plugins` and `routing` settings pages
- render host-provided plugin descriptors through existing info components
- keep custom UI out of v1

**Step 4: Run tests to verify it passes**

Run the same renderer test command.

**Step 5: Commit**

Commit only the new settings surfaces.

### Task 6: Add stable host hooks for session actions and composer actions

**Files:**
- Create: `apps/electron/src/renderer/components/plugins/PluginCardHost.tsx`
- Create: `apps/electron/src/renderer/components/plugins/ComposerActionBar.tsx`
- Modify: `apps/electron/src/renderer/App.tsx`
- Modify: `packages/shared/src/plugins/types.ts`
- Test: renderer tests near the touched components

**Step 1: Write the failing tests**

Cover:

- host-projected session actions
- host-projected composer actions
- contribution ordering and visibility rules

**Step 2: Run test to verify it fails**

Run the repo’s renderer test command for the touched areas.

**Step 3: Write minimal implementation**

Do:

- keep actions declarative
- dispatch actions through host-owned handlers
- do not allow free-form plugin UI embedding

**Step 4: Run tests to verify it passes**

Run the same renderer test command.

**Step 5: Commit**

Commit only the stable action hook layer.

### Task 7: Add external bridge runtime support

**Files:**
- Modify: `packages/server-core/src/plugins/bridge-runtime.ts`
- Modify: `packages/server-core/src/plugins/loader.ts`
- Modify: `packages/server-core/src/plugins/storage.ts`
- Test: `packages/server-core/src/plugins/plugin-host.test.ts`

**Step 1: Write the failing tests**

Cover:

- external plugin activation
- permission filtering
- helper process failure isolation
- incompatible plugin disable behavior

**Step 2: Run test to verify it fails**

Run: `bun test packages/server-core/src/plugins/plugin-host.test.ts`

**Step 3: Write minimal implementation**

Do:

- add external plugin discovery
- add bridge process activation
- add host-managed crash and quarantine rules

**Step 4: Run test to verify it passes**

Run the same test command.

**Step 5: Commit**

Commit only the external runtime support.

### Task 8: Pilot one real plugin

**Files:**
- Create: `plugins/codex-cli/plugin.json` or `plugins/hermes/plugin.json`
- Create: `plugins/<pilot>/main.ts`
- Create: `plugins/<pilot>/README.md`
- Test: plugin host integration tests plus one manual smoke test path

**Step 1: Choose the first pilot**

Recommendation:

- `Codex CLI` if the first goal is coding-oriented delegation
- `Hermes` if the first goal is memory/self-improvement workflows

**Step 2: Write the failing integration test**

Cover:

- plugin discovery
- backend registration
- session creation using plugin backend
- visible host metadata in settings/plugins

**Step 3: Implement the minimal plugin**

Keep it narrow:

- backend registration
- optional settings schema
- no rich custom UI yet

**Step 4: Run tests and a manual smoke check**

Run the integration test plus one manual session-creation smoke test.

**Step 5: Commit**

Commit only the pilot plugin.

## Testing Strategy

The test strategy should match the platform layers.

### Shared tests

- manifest validation
- capability typing
- compatibility gates

### Server-core tests

- registry behavior
- plugin load and unload behavior
- quarantine behavior
- bridge runtime failure behavior

### Session tests

- backend selection by `backendId`
- legacy session fallback
- event normalization continuity

### Renderer tests

- settings routes
- plugin list rendering
- action slot rendering
- hidden-by-flag behavior

### Manual smoke tests

- open app with no plugins
- enable built-in plugin host only
- create session with Anthropic and Pi
- disable one backend registration and verify degraded behavior
- enable pilot plugin and create a session through it

## Risks and How To Handle Them

### Risk 1. We accidentally create a second backend architecture

Mitigation:

- route all backend plugins through the existing `AgentBackend` abstraction
- do not create a separate conversation runtime contract

### Risk 2. Renderer plugins become a maintenance trap

Mitigation:

- host-owned slots only
- declarative cards and actions first
- no arbitrary component injection in v1

### Risk 3. Plugin permissions become confused with session approvals

Mitigation:

- explicit separate permission model
- separate UI surfaces for plugin trust and agent tool approval

### Risk 4. App updates break plugin installation

Mitigation:

- keep plugin code outside bundled overwrite-on-launch resource paths
- keep patch points limited to composition roots and stable registries

### Risk 5. Session continuity breaks when plugins disappear

Mitigation:

- persist `backendId`
- add degraded-mode session recovery
- allow rebind or migration

### Risk 6. We overbuild too early

Mitigation:

- ship phases in order
- do not start with rich plugin pages, chat cards, voice, and MCP apps all at once

## Recommended First Slice

The first implementation slice should be:

1. shared plugin contracts
2. plugin host and registry
3. plugin RPC surface
4. built-in Anthropic and Pi registrations
5. `settings/plugins` and `settings/routing`

Stop there first.

That gives us the platform spine without taking on the highest-risk UI work too early.

## Recommended Pilot After The Spine Exists

Build one real external backend plugin next.

My recommendation:

1. `Codex CLI` if the top priority is code-oriented delegation
2. `Hermes` if the top priority is memory and self-improvement workflows

Do not start by integrating several runtimes at once.

## Open Questions To Resolve During Implementation

1. Should third-party plugins be signed in v1 or only flagged as untrusted?
2. Should workspace-local plugin installs be supported in v1 or only global installs?
3. Should chat cards remain purely schema-driven in v1.5, or can some host-approved rich card renderers be included?
4. Should MCP app surfaces use a sandboxed iframe model from the start, or begin as structured host-rendered cards and pages?
5. Which pilot backend gives the cleanest proof of the contract: Codex CLI or Hermes?

## Definition Of Done For The Platform Spine

The platform spine is done when:

1. the app boots with the plugin host enabled and no regressions to current Anthropic or Pi behavior
2. built-in backends are registered through the host
3. the renderer can list plugins and routing policies through new settings pages
4. sessions can persist and reopen with `backendId`
5. one plugin can be disabled without destabilizing app startup
6. the code changes are localized to the planned control-plane and projection seams

## Final Recommendation

Proceed with a worktree-based implementation from:

- `/Users/kosta/LocalDev/.worktrees/craft-agents-oss/plugin-platform-spec`

Do **not** fork the architecture first. Build the host spine in-tree, behind flags, inside the isolated worktree and branch already created for this effort.

That is the least destructive path, the least compromising path for the current app, and the path most likely to survive upstream updates with small, understandable patches.
