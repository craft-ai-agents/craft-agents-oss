# Owner Agent Full Redesign Implementation Plan

> **For Hermes:** Use subagent-driven-development to implement this plan task-by-task. Keep each phase runnable; do not begin the next phase until its acceptance gate passes.

**Goal:** Turn the ARCHstudio OSS fork into a private, single-owner desktop agent that is visually original, action-first, provider-agnostic, durable across sessions, and deeply integrated with ChatGPT Codex, Hermes Agent, ComfyUI, Ollama Local, and Ollama Cloud.

**Architecture:** Keep Craft's proven Electron/Bun/React session shell and backend abstraction, then replace the product identity and renderer experience while adding an app-owned memory/prompt layer and explicit integration adapters. LLM inference stays in the provider plane; external actions and specialist systems stay in the tool/service plane. All new capabilities must work through typed interfaces so the UI does not care whether a job is handled by Codex, Ollama, Hermes, or ComfyUI.

**Tech Stack:** Electron 39, React 18, TypeScript, Bun workspaces, Vite, Jotai, Tailwind, Radix UI, Pi SDK, Claude Agent SDK, MCP SDK, SQLite/FTS5, WebSocket/JSONL RPC, Ollama OpenAI-compatible API, Hermes MCP/API/CLI bridge, ComfyUI REST + WebSocket API.

---

## 1. Product contract and honest boundaries

### Intended behavior

- One owner: Richard/Skobez. No teams, organisations, seats, sharing, or enterprise administration in v1.
- Default posture: **act first**, inspect prerequisites automatically, execute and verify, then report results.
- Never ask a question when the required answer can be discovered from files, system state, APIs, session history, or configured defaults.
- Support an **Owner Auto** mode that auto-approves ordinary tool calls within configured roots and services.
- Let the owner edit identity, system prompts, tool policies, memory, skills, models, integrations, and UI without recompiling.
- Keep all histories, memories, credentials, generated artifacts, and configuration local by default.
- Make capabilities visible: the UI must show what is connected, what ran, what changed, what failed, and where outputs landed.

### Boundary that must not be misrepresented

We can build a maximally owner-controlled, low-friction agent, but we cannot honestly guarantee that every cloud model will answer every request or that every action can be performed without confirmation. Cloud providers retain their own service policies. Local models reduce that dependency but do not create missing capabilities. Irreversible actions—drive-wide deletion, credential export, purchases, publishing, account changes, or actions affecting other people—must be governed by explicit owner policy or a narrowly scoped confirmation. This is not a moralising chat refusal layer; it is protection against accidental irreversible side effects.

### Owner policy modes

1. **Explore** — read-only inspection and planning.
2. **Owner Auto** — default; execute automatically within configured roots/services.
3. **Unrestricted Session** — broad execution for the current session, with an always-visible indicator and audit trail.
4. **Sandbox** — unrestricted inside a disposable workspace/container.

The owner can permanently pre-authorise specific roots, commands, domains, APIs, MCP tools, accounts, and spend limits. A pre-authorised operation must not ask again.

---

## 2. Current verified baseline

- Repository: `D:\craft-agents-oss`
- Upstream version: `0.11.2`, branch `main`
- Repository state before planning: clean
- Architecture: Bun monorepo; Electron desktop + Web UI + CLI + headless server
- Existing backends: Claude Agent SDK and Pi SDK
- Existing provider support already includes ChatGPT Codex OAuth, Google, Copilot, OpenAI-compatible endpoints, and Ollama-style custom endpoints.
- Hermes Agent is installed and running; OpenAI Codex OAuth, Nous OAuth, Telegram gateway, memory, skills, web/media tools, and delegation are available.
- Ollama `0.32.1` is running at `http://127.0.0.1:11434`; eleven local models are installed.
- ComfyUI `0.28.0` is running at `http://127.0.0.1:8188` on the RTX 5070 Ti; Agnes Image/Text/Video nodes are loaded.
- Node.js and Git are installed.
- **Blocker before first launch:** Bun is not currently installed or not on PATH.

---

## 3. Provider vs MCP/service decisions

### Use direct providers for inference

| Integration | Primary method | Reason |
|---|---|---|
| ChatGPT Codex | Existing Pi/OpenAI-Codex provider path | Native streaming, reasoning, usage, model switching, and OAuth belong in the inference layer. |
| Ollama Local | `pi_compat` / OpenAI-compatible provider at `http://127.0.0.1:11434/v1` | It is an LLM inference endpoint, not a tool server. |
| Ollama Cloud | Dedicated provider connection after endpoint/auth discovery spike | It is also inference; do not hide it behind MCP. |
| Hermes-selected model | Optional OpenAI-compatible Hermes proxy connection | Useful only when we deliberately want Hermes to own provider routing/OAuth. It should not be the default path for all models. |

### Use MCP or native service adapters for capabilities

| Integration | Primary method | Reason |
|---|---|---|
| Hermes Agent | Dedicated `AgentBackend` for full Hermes sessions; MCP bridge for optional Hermes tools | Hermes owns a complete autonomous runtime (streaming, resume, steering, tools, memory, delegation). Treating that whole runtime as one MCP tool would create a nested opaque agent loop. A selectable Hermes backend is the correct end-state; MCP remains useful when a Codex/Ollama session wants only selected Hermes capabilities. |
| ComfyUI | First-party bundled MCP/source backed by native REST/WebSocket code | ComfyUI is a capability, not inference. The MCP/source boundary makes it available to every backend, while a typed first-party client and RPC event stream preserve queue progress, cancellation, binary uploads, workflow schemas, and first-class Media Lab UI. |
| External apps/APIs | Existing Craft Sources/MCP pool | Craft already centralises MCP clients and proxy tool definitions. |

### Avoid these architecture mistakes

- Do not treat ComfyUI as a chat provider.
- Do not route every model request through Hermes; that creates duplicated sessions, prompts, memory, and tool loops.
- Do not let Owner Agent and Hermes independently write the same memory record without a source-of-truth and conflict policy.
- Do not expose hundreds of MCP tools to every prompt. Activate tool bundles per task/session.
- Do not embed API keys in renderer code or system prompts.

---

## 4. Target repository structure

Create these new modules while preserving upstream package boundaries:

```text
packages/
  core/src/owner/                 # shared owner/profile/policy DTOs
  shared/src/owner/               # owner config + runtime resolution
  shared/src/memory/              # native MEMORY.md/JSONL index, retrieval, consolidation
  shared/src/prompts/owner/       # versioned prompt layers and compiler
  shared/src/integrations/hermes/ # Hermes backend + optional MCP capability bridge
  comfyui-mcp-server/             # first-party ComfyUI MCP/source + REST/WS client
  shared/src/integrations/ollama/ # discovery, health, local/cloud helpers
  shared/src/capabilities/        # capability registry + health model
  server-core/src/handlers/rpc/   # new memory/prompt/integration RPC handlers
apps/electron/src/renderer/
  features/command-center/
  features/memory/
  features/prompts/
  features/integrations/
  features/models/
  features/media-lab/
  features/runs/
  design-system/
apps/electron/src/main/
  services/hermes/
  services/comfyui/
  services/ollama/
```

App data target:

```text
D:\OwnerAgent\
  config\
  data\owner-agent.db
  memories\
  prompts\
  skills\
  sessions\
  artifacts\
  logs\
  backups\
```

ComfyUI models and outputs remain under `D:\Comfyui`; the app stores references/metadata rather than duplicating large files.

---

## 5. Phase 0 — Baseline, fork hygiene, and reproducibility

### Task 0.1: Preserve upstream and create the redesign branch

**Files:** Git metadata only.

1. Rename current remote to `upstream`.
2. Add the owner's future GitHub fork as `origin` when available.
3. Create branch `feat/owner-agent-redesign`.
4. Record upstream commit in `docs/upstream-baseline.md`.

**Verification:**

```bash
git status --short --branch
git remote -v
git log -1 --oneline
```

**Commit:** `chore: establish owner-agent fork baseline`

### Task 0.2: Install and verify Bun without changing global provider defaults

1. Install current stable Bun for Windows.
2. Confirm `bun --version` from the same environment used by Hermes and Electron.
3. Run `bun install` from `D:\craft-agents-oss`.
4. Do not set a default Hermes model/provider.

**Verification:**

```bash
bun --version
bun install --frozen-lockfile
bun run typecheck:all
```

### Task 0.3: Capture the untouched app baseline

1. Run `bun run electron:dev`.
2. Complete minimum local onboarding using an existing supported connection.
3. Capture screenshots of onboarding, shell, chat, settings, sources, and model picker to `docs/baseline/screens/`.
4. Run `bun run validate:dev`.
5. Record startup time, idle RAM, first-token time, and known failures in `docs/baseline/report.md`.

**Acceptance gate:** The unmodified app launches and can complete one real prompt before redesign work starts.

---

## 6. Phase 1 — Rebrand and visual design system

### Task 1.1: Pick a working product identity

Use a temporary codename until the owner chooses the final name. Do not ship Craft branding.

**Modify:**
- `package.json`
- `apps/electron/package.json`
- `apps/electron/electron-builder.yml`
- `apps/electron/resources/`
- `apps/electron/src/shared/menu-schema.ts`
- user-visible locale strings under the renderer locale tree

**Create:**
- `docs/brand/identity.md`
- `docs/brand/voice.md`
- `docs/brand/trademark-audit.md`

Retain Apache-2.0 `LICENSE` and required `NOTICE`; follow `TRADEMARK.md` by removing Craft names/logos from the new product.

### Task 1.2: Build tokens before pages

**Create:**
- `apps/electron/src/renderer/design-system/tokens.css`
- `apps/electron/src/renderer/design-system/typography.css`
- `apps/electron/src/renderer/design-system/motion.css`
- `apps/electron/src/renderer/design-system/elevation.css`
- `apps/electron/src/renderer/design-system/index.ts`
- `apps/electron/src/renderer/design-system/__tests__/tokens.test.ts`

Extend the existing token path in `packages/shared/src/config/theme.ts`, map it through `apps/electron/src/renderer/index.css`, and expose the new design-system modules above it. Define semantic tokens for canvas, panels, command surface, tool states, model/provider identity, success/warning/error, focused work, background jobs, and media assets. Support dark-first plus a readable light theme. Avoid a shallow colour swap of Craft and avoid hard-coded colours, shadows, or z-indexes.

### Task 1.2a: Prototype every major state in the existing playground

Use `apps/electron/src/renderer/playground/` and its registries before wiring live application state. Add previews for the new shell, empty chat, streaming turn, tool run, permission request, memory card, integration card, media queue, compact layout, and error/offline states. This is the fastest safe visual loop and does not require the full agent runtime for every tweak.

### Task 1.2b: Extract headless controllers before replacing oversized markup

Do not add more behavior to these current hotspots:
- `apps/electron/src/renderer/App.tsx` (~2,270 lines)
- `apps/electron/src/renderer/components/app-shell/AppShell.tsx` (~3,911 lines)
- `apps/electron/src/renderer/contexts/NavigationContext.tsx` (~1,305 lines)
- `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` (~2,383 lines)
- `packages/ui/src/components/chat/TurnCard.tsx` (~3,279 lines)

First extract headless controllers/view-model hooks while preserving streaming, branching, lazy loading, permission, and route behavior. Then replace presentation. Keep the URL/history route model in `NavigationContext.tsx`, the panel boundary in `PanelStackContainer.tsx`/`PanelSlot.tsx`, and shared chat presentation in `packages/ui/src/components/chat/`.

### Task 1.3: Replace the shell information architecture

**Modify:**
- `apps/electron/src/renderer/App.tsx`
- `apps/electron/src/renderer/components/app-shell/AppShell.tsx`
- `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx`
- `apps/electron/src/renderer/components/app-shell/NavigatorPanel.tsx`
- `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx`
- `apps/electron/src/shared/routes.ts`
- `apps/electron/src/shared/route-parser.ts`
- `apps/electron/src/renderer/contexts/NavigationContext.tsx`
- `apps/electron/src/renderer/contexts/navigation-history.ts`
- `apps/electron/src/renderer/contexts/navigation-reconcile.ts`

Do not use `apps/electron/src/renderer/lib/navigation-registry.ts` as the sole route registry; it is incomplete relative to the current typed route/history system.

New top-level destinations:

1. **Command** — active conversation and action composer.
2. **Runs** — all foreground/background jobs and subagents.
3. **Projects** — working directories and project context.
4. **Memory** — profile, facts, episodes, skills.
5. **Media Lab** — ComfyUI generations, workflows, queue, outputs.
6. **Integrations** — Hermes, Ollama, Codex, MCPs, APIs.
7. **Settings** — appearance, behavior, privacy, storage, advanced.

### Task 1.4: Redesign the chat surface

**Modify/refactor:**
- `apps/electron/src/renderer/pages/ChatPage.tsx`
- `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`
- `apps/electron/src/renderer/components/app-shell/input/ChatInputZone.tsx`
- `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx`
- `apps/electron/src/renderer/components/app-shell/input/CompactModelSelector.tsx`
- `apps/electron/src/renderer/components/app-shell/input/CompactPermissionModeSelector.tsx`
- `packages/ui/src/components/chat/TurnCard.tsx`
- `packages/ui/src/components/chat/UserMessageBubble.tsx`
- `packages/ui/src/lib/layout.ts`

The composer must expose, without clutter:
- model/connection
- active capability bundle
- working directory
- Owner policy mode
- attachment/media controls
- queued/steering behavior
- visible stop/interrupt

Tool calls render as expandable run cards with status, duration, inputs, outputs, changed files, and retry. Final answers remain visually dominant.

**Acceptance gate:** A first-time user can see what model is active, what the agent can touch, what it is doing, and where results landed without opening settings.

---

## 7. Phase 2 — Owner profile, prompt studio, and behavior compiler

### Task 2.1: Replace the single notes field with layered owner configuration

Current seam: `packages/shared/src/config/preferences.ts` stores name/timezone/location/free-form notes.

**Create:**
- `packages/core/src/owner/types.ts`
- `packages/shared/src/owner/schema.ts`
- `packages/shared/src/owner/storage.ts`
- `packages/shared/src/owner/migrations.ts`
- `packages/shared/src/owner/__tests__/storage.test.ts`

Schema layers:

```ts
interface OwnerProfile {
  identity: { name: string; aliases: string[]; locale: string; timezone: string }
  communication: { tone: string; verbosity: number; bannedPhrases: string[] }
  execution: { defaultMode: 'explore' | 'owner-auto' | 'unrestricted'; askOnlyWhen: string[] }
  paths: { allowedRoots: string[]; artifactRoot: string; backupRoot: string }
  privacy: { telemetry: boolean; cloudMemory: boolean; redactSecretsInLogs: boolean }
}
```

Migrate existing preferences without deleting the old file until verification passes.

### Task 2.2: Build a versioned prompt compiler

Current seams:
- `packages/shared/src/prompts/system.ts`
- `packages/shared/src/agent/core/prompt-builder.ts`
- `packages/shared/src/agent/base-agent.ts`

**Create:**
- `packages/shared/src/prompts/owner/types.ts`
- `packages/shared/src/prompts/owner/defaults.ts`
- `packages/shared/src/prompts/owner/compiler.ts`
- `packages/shared/src/prompts/owner/validator.ts`
- `packages/shared/src/prompts/owner/__tests__/compiler.test.ts`

Prompt composition order:

1. immutable runtime contract
2. owner identity/personality
3. action-first execution policy
4. current project instructions (`AGENTS.md`, `CLAUDE.md`, later `.hermes.md`)
5. selected skills
6. retrieved durable memory
7. session summary and volatile state
8. active capabilities/tool hints
9. user message

Stable layers remain cacheable; date, connection health, active tools, and retrieved episodes remain volatile. Never put credentials in prompts.

### Task 2.3: Add Prompt Studio UI

**Create:**
- `apps/electron/src/renderer/features/prompts/PromptStudioPage.tsx`
- `PromptLayerEditor.tsx`
- `PromptPreview.tsx`
- `PromptDiff.tsx`
- `PromptTestHarness.tsx`

Features:
- layer toggles and ordering
- raw compiled prompt preview
- token estimate
- version history and rollback
- per-model overrides
- test cases with expected behavior
- export/import as JSON/YAML

### Task 2.4: Behavior tests, not “magic jailbreak” text

Create regression scenarios such as:
- obvious default → acts without asking
- missing information discoverable by tools → inspects first
- failed execution → retries an alternate route and reports real blocker
- destructive request inside pre-authorised sandbox → executes
- destructive request outside scope → asks one concise scope question
- provider refuses → surfaces provider limitation and offers configured local model, without pretending success

**Acceptance gate:** Prompt changes are inspectable, versioned, testable, and reversible. No “never refuse” string is treated as a substitute for tools or provider capability.

---

## 8. Phase 3 — Durable memory system

### Task 3.1: Establish four memory classes

1. **Profile memory** — who the owner is and stable preferences.
2. **Semantic memory** — durable facts about machines, projects, people, conventions.
3. **Episodic memory** — summaries and searchable past sessions/runs.
4. **Procedural memory** — skills and proven workflows.

**Create:**
- `packages/shared/src/memory/types.ts`
- `packages/shared/src/memory/repository.ts`
- `packages/shared/src/memory/index-repository.ts`
- `packages/shared/src/memory/retrieval.ts`
- `packages/shared/src/memory/consolidation.ts`
- `packages/shared/src/memory/redaction.ts`
- `packages/shared/src/memory/__tests__/`

Preserve the repository's native durable sources rather than replacing them:
- global profile: `~/.archstudio/preferences.json` through `packages/shared/src/config/preferences.ts`
- project memory: `~/.archstudio/workspaces/{workspace}/projects/{project}/MEMORY.md` through `packages/shared/src/projects/storage.ts`
- sessions: `{workspace}/sessions/{sessionId}/session.jsonl` through `packages/shared/src/sessions/storage.ts`, `jsonl.ts`, and `persistence-queue.ts`
- skills: global/workspace/project `SKILL.md` precedence through `packages/shared/src/skills/storage.ts`

Use SQLite/FTS5 only as a rebuildable cross-session search/index and audit store, not as a second authoritative copy of session transcripts or project memory. Add embeddings only after FTS retrieval is measured; do not introduce a vector database by default. Add error propagation and recovery tests around `persistence-queue.ts`, whose current queued write errors may be logged without reaching callers.

### Task 3.2: Database and audit model

Rebuildable index/audit tables:
- `owner_profile_versions`
- `memories`
- `memory_sources`
- `memory_links`
- `session_summaries`
- `skills`
- `skill_versions`
- `prompt_versions`
- `capability_health`
- `run_audit`
- `artifacts`

Every memory records source session/message, created/updated timestamps, confidence, sensitivity, expiry policy, and supersession chain.

### Task 3.3: Memory writes and consolidation

- The agent may propose/save stable facts automatically under Owner Auto.
- Deduplicate before insertion.
- Never store raw keys/tokens/passwords.
- Never store task-progress noise as durable memory.
- Consolidation produces a diff and remains reversible.
- Add importers for Craft preferences and Hermes `USER.md`/`MEMORY.md`.
- In v1, import Hermes memory as read-only snapshots. Do not bi-directionally sync until conflict tests exist.
- Keep project `MEMORY.md` sanitisation and its 5,000-token cap from `packages/shared/src/prompts/system.ts`; add a workspace-level analogue only by reusing the same loader, sanitiser, cap, and provenance rules.

### Task 3.4: Memory UI

**Create:**
- `apps/electron/src/renderer/features/memory/MemoryPage.tsx`
- `MemorySearch.tsx`
- `MemoryCard.tsx`
- `MemoryTimeline.tsx`
- `ProfileEditor.tsx`
- `SkillLibrary.tsx`

Allow search, edit, pin, forget, merge, provenance inspection, sensitivity marking, and full export.

### Task 3.5: Retrieval tests

Build a fixed evaluation set of at least 50 queries covering preferences, environment facts, project conventions, corrections, and old session decisions. Measure precision@5 and ensure stale/superseded entries are excluded.

**Acceptance gate:** Start a new session and verify the agent correctly uses a saved preference, a project convention, and a previous correction while excluding a deliberately forgotten fact.

---

## 9. Phase 4 — Capability registry and integration health

### Task 4.1: Introduce a capability registry

**Create:**
- `packages/shared/src/capabilities/types.ts`
- `packages/shared/src/capabilities/registry.ts`
- `packages/shared/src/capabilities/health.ts`
- `packages/shared/src/capabilities/__tests__/registry.test.ts`

Each capability declares:
- id, display name, category
- transport: provider, native service, MCP, CLI, built-in
- health probe
- tool definitions
- required credentials
- permission risk class
- artifact types
- cancellation support
- streaming/progress support

The model receives only the active subset.

### Task 4.2: Integration dashboard

**Create:**
- `apps/electron/src/renderer/features/integrations/IntegrationsPage.tsx`
- `IntegrationCard.tsx`
- `HealthProbeResult.tsx`
- `CapabilityPicker.tsx`

Every card must show configured/reachable/authenticated, endpoint, last probe, exposed tools/models, and a real smoke-test button.

---

## 10. Phase 5 — ChatGPT Codex integration

### Task 5.1: Preserve and harden the existing direct path

Current seams:
- `packages/shared/src/config/llm-connections.ts`
- `packages/shared/src/config/models-pi.ts`
- `packages/shared/src/agent/backend/internal/drivers/pi.ts`
- `packages/shared/src/agent/backend/factory.ts`
- `packages/shared/src/auth/chatgpt-oauth.ts`
- `packages/shared/src/auth/chatgpt-oauth-config.ts`
- `packages/server-core/src/handlers/rpc/llm-connections.ts`
- `packages/server-core/src/domain/connection-setup-logic.ts`
- `packages/shared/src/credentials/manager.ts`
- `packages/pi-agent-server/src/index.ts`
- onboarding UI in `apps/electron/src/renderer/hooks/useOnboarding.ts`
- connection settings in `apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx`

Use `providerType: 'pi'` and `piAuthProvider: 'openai-codex'`. Do not add a second Codex backend unless the existing Pi path fails a real end-to-end test.

### Task 5.2: Add owner-friendly Codex onboarding

- Detect an existing valid Codex login without displaying tokens.
- Offer native Craft Codex OAuth as the default.
- Offer Hermes proxy as an advanced route labelled clearly: “Model traffic routed through Hermes.”
- Show subscription OAuth versus separate OpenAI API billing honestly.
- Test model listing, one simple response, one coding tool call, streaming, cancellation, and session resume.

### Task 5.3: Codex acceptance test

Use a disposable fixture repo. Ask Codex to add a tested function, inspect the diff, run tests, and produce a real commit only inside the fixture. Verify the run card captures tools, changed files, test output, and final result.

---

## 11. Phase 6 — Ollama Local and Ollama Cloud

### Task 6.1: Ollama discovery client

**Create:**
- `packages/shared/src/integrations/ollama/client.ts`
- `discovery.ts`
- `types.ts`
- `health.ts`
- `__tests__/client.test.ts`

Probe:
- `/api/version`
- `/api/tags`
- `/v1/models`
- a short `/v1/chat/completions` request

Record local/cloud model distinction; do not assume cloud models appear in `/api/tags`.

### Task 6.2: First-class Local connection

Create a preset that maps to:

```ts
{
  providerType: 'pi_compat',
  baseUrl: 'http://127.0.0.1:11434/v1',
  authType: 'none',
  customEndpoint: { api: 'openai-completions' }
}
```

Discover models dynamically, retain manual model overrides, and show VRAM/context/tool/vision capability hints only when verified.

### Task 6.3: Ollama Cloud discovery spike

Do not guess the cloud endpoint or auth format. Verify against current Ollama documentation and the installed `ollama` client. Decide between:

1. cloud models invoked through the signed-in local Ollama daemon, or
2. direct Ollama Cloud API connection.

Write the decision and verified request/response shape to `docs/integrations/ollama-cloud.md`, then implement a separate connection preset.

### Task 6.4: Local model routing

Support per-task defaults:
- fast local chat
- private/sensitive task
- coding
- long context
- vision (only verified models)
- fallback when cloud provider refuses or is unavailable

Do not silently switch models mid-session; show fallback in the run timeline.

### Task 6.5: Ollama acceptance test

For at least one small model and one preferred large local model:
- list/discover
- stream response
- call a supported tool or explicitly show tools unsupported
- cancel generation
- report tokens/sec and memory/GPU status

---

## 12. Phase 7 — Hermes integration

### Task 7.1: Add Hermes as a first-class selectable AgentBackend

Because Hermes is a complete autonomous runtime—not just an inference endpoint—integrate it behind Craft's common backend contract rather than wrapping the entire agent loop as one opaque MCP call.

**Create:**
- `packages/shared/src/agent/hermes-agent.ts`
- `packages/shared/src/agent/backend/hermes/index.ts`
- `packages/shared/src/agent/backend/internal/drivers/hermes.ts`
- `packages/hermes-agent-server/` if a JSONL subprocess adapter is needed
- `packages/shared/src/integrations/hermes/health.ts`
- `apps/electron/src/main/services/hermes/HermesService.ts`

**Modify:**
- `packages/shared/src/config/models.ts` (`ModelProvider` / `AgentProvider`)
- `packages/shared/src/config/llm-connections.ts` (`LlmProviderType`, validation, labels)
- `packages/shared/src/agent/backend/factory.ts` (`DRIVER_REGISTRY`, capabilities, creation)
- `packages/shared/src/agent/backend/internal/driver-types.ts`
- `packages/shared/src/agent/backend/internal/runtime-resolver.ts`
- provider metadata, model-fetching, setup UI, packaging scripts, Electron resources, and `Dockerfile.server` as required

Hermes must implement the common `AgentBackend` event/session contract, reuse `McpClientPool`, route tool hooks through `runPreToolUseChecks()` in `packages/shared/src/agent/core/pre-tool-use.ts`, and emit normal Craft session events. If parent callback tool execution is impossible, set `needsHttpPoolServer: true` and use the existing MCP pool HTTP bridge.

### Task 7.2: Keep an optional Hermes MCP capability source

When the active conversational backend is Codex, Ollama, Pi, or Claude, allow selected Hermes capabilities through Hermes' supported MCP server mode. Register it through `packages/shared/src/mcp/mcp-pool.ts`; never scrape free-form CLI output.

Default opt-in bundles:
- web/research
- memory/session search
- skills
- delegation
- schedules/messaging
- managed media

Never expose every Hermes tool by default. Let the owner toggle bundles or individual tools.

### Task 7.3: Ownership and memory boundaries

Owner Agent owns the visible conversation, prompt compilation, selected backend, native Craft session JSONL, run/audit UI, and authoritative project `MEMORY.md`. Hermes owns its own execution internals, Telegram gateway, cron, Hermes skills, delegation, and managed tools when the Hermes backend or MCP source is selected. Import Hermes user/memory files read-only in v1; do not silently dual-write.

### Task 7.4: Hermes acceptance tests

From the redesigned app:
1. run Hermes web research;
2. search a past Hermes session;
3. load a Hermes skill;
4. delegate a bounded subtask;
5. create then delete a test cron job;
6. return all outputs to the same visible run timeline.

---

## 13. Phase 8 — ComfyUI Media Lab

### Task 8.1: Bundled ComfyUI MCP/source with native client internals

**Create:**
- `packages/comfyui-mcp-server/package.json`
- `packages/comfyui-mcp-server/src/index.ts`
- `packages/comfyui-mcp-server/src/client.ts`
- `packages/comfyui-mcp-server/src/websocket.ts`
- `packages/comfyui-mcp-server/src/workflow.ts`
- `packages/comfyui-mcp-server/src/schema.ts`
- `packages/comfyui-mcp-server/src/jobs.ts`
- `packages/comfyui-mcp-server/src/artifacts.ts`
- `packages/comfyui-mcp-server/src/__tests__/`

Register it as a first-party source through `packages/shared/src/sources/types.ts`, `sources/storage.ts`, `sources/server-builder.ts`, and `packages/server-core/src/handlers/rpc/sources.ts`. Update Electron/server resource builds and Docker packaging. The Media Lab may consume typed RPC progress events from the same client, while all agent backends see the capability through the standard MCP/source pool.

Endpoints:
- `GET /system_stats`
- `GET /object_info`
- `POST /prompt`
- `GET /queue`
- `GET /history/{prompt_id}`
- `GET /view`
- `POST /upload/image`
- `POST /interrupt`
- WebSocket `/ws`

### Task 8.2: Workflow library and parameter schema

Index API-format workflows from `D:\Comfyui` and an app-managed workflow directory. Extract editable prompt, negative prompt, seed, steps, CFG, dimensions, frames, FPS, image inputs, model names, and save-node metadata. Reject editor-only JSON until converted.

### Task 8.3: Media Lab UI

**Create:**
- `apps/electron/src/renderer/features/media-lab/MediaLabPage.tsx`
- `WorkflowBrowser.tsx`
- `WorkflowForm.tsx`
- `GenerationQueue.tsx`
- `ArtifactGallery.tsx`
- `GenerationInspector.tsx`

Features:
- image/video/audio tabs
- workflow selection
- typed parameter forms
- drag/drop source images
- real-time node/progress state
- interrupt/retry/duplicate
- output preview and reveal-in-folder
- seed/workflow/model provenance
- “send result back to chat”

### Task 8.4: Agent tools

Expose narrow internal tools:
- `comfy_health`
- `comfy_list_workflows`
- `comfy_run_workflow`
- `comfy_job_status`
- `comfy_cancel_job`
- `comfy_list_outputs`

The MCP tool implementation uses the bundled native client. This gives every backend the same capability while preserving first-class workflow-aware UI, WebSocket progress, and binary artifact handling.

### Task 8.5: ComfyUI acceptance tests

Run one verified image workflow and one short video workflow. Confirm real progress, cancellation, output metadata, and delivery into chat. Outputs stay under `D:\Comfyui\output` unless the workflow explicitly targets an app-owned artifact folder.

---

## 14. Phase 9 — Permissions redesigned as owner policy

### Task 9.1: Replace command-name heuristics with policy rules

Current seam: `packages/shared/src/agent/core/permission-manager.ts` and `packages/shared/src/agent/permissions-config.ts`.

**Create:**
- `packages/shared/src/owner/policy-schema.ts`
- `packages/shared/src/owner/policy-engine.ts`
- `packages/shared/src/owner/policy-audit.ts`
- `packages/shared/src/owner/__tests__/policy-engine.test.ts`

Evaluate:
- operation type
- target root/account/service
- reversibility
- data sensitivity
- spend/publishing impact
- session mode
- explicit pre-authorisation

A command like `rm` is not categorically blocked: removing build output inside an allowed project can auto-run; deleting an entire drive cannot.

### Task 9.2: Policy UI

Add:
- allowed filesystem roots
- protected paths
- allowed domains
- enabled integrations/accounts
- maximum automatic spend
- publish/send permissions
- secret handling
- default session mode
- “always allow this exact pattern” rules

Every auto-approved or blocked decision must be explainable in one line and appear in the audit log.

### Task 9.3: Recovery and rollback

- Enable project checkpoints before broad edits.
- Create pre-operation snapshots for multi-file writes where practical.
- Prefer recycle-bin semantics over permanent delete for interactive file removal.
- Display an Undo action when a reversible operation supports it.

**Acceptance gate:** Routine project work proceeds without prompts; a drive-wide destructive test is stopped or requires an explicit scoped owner rule.

---

## 15. Phase 10 — Runs, subagents, scheduling, and “create anything” workflows

### Task 10.1: Unified run model

Create a provider-neutral run graph covering:
- model turns
- tools
- shell/file operations
- MCP calls
- Hermes delegation
- ComfyUI jobs
- scheduled tasks
- artifacts

**Create:**
- `packages/core/src/runs/types.ts`
- `packages/shared/src/runs/repository.ts`
- `packages/shared/src/runs/events.ts`
- `apps/electron/src/renderer/features/runs/RunsPage.tsx`
- `RunTimeline.tsx`
- `RunGraph.tsx`
- `ArtifactTray.tsx`

### Task 10.2: Capability recipes

Build reusable recipes for:
- build/test/fix a software project
- research → brief → document
- prompt → image → video → audio
- inspect downloads → sort/install/test
- scheduled monitoring → Telegram delivery

Recipes are editable and become procedural memories/skills after successful verification.

### Task 10.3: Delegation

Use Hermes delegation initially. Show each child agent as a run node with task, status, transcript, artifacts, and final result. Add native multi-agent orchestration only if Hermes delegation cannot satisfy the UI contract.

---

## 16. Phase 11 — Security, privacy, and single-owner operation

### Task 11.1: Local owner lock

- Bind app data to the current Windows user profile/SID.
- Store secrets via the existing secure credential backend/Windows credential protection.
- Optional local PIN only locks the UI; it is not marketed as full-disk encryption.
- No remote server exposure by default.

### Task 11.2: Network and telemetry

- Disable Sentry/telemetry by default in the fork.
- Show every configured outbound endpoint.
- Add per-integration offline toggle.
- Keep memory local unless the active prompt explicitly sends retrieved context to a cloud model; show this fact in model privacy indicators.

### Task 11.3: Secrets

- Never render full credentials after entry.
- Never inject credentials into model prompts.
- Scrub logs and exported sessions.
- Add tests for renderer IPC boundaries and credential leakage.
- Migrate the existing plaintext `remoteServer.token` path in `packages/shared/src/config/storage.ts` into `CredentialManager`.
- Migrate automation webhook `auth` fields out of `{workspace}/automations.json`; store only credential references and prefer `ARCHSTUDIO_WH_*` environment variables for existing automation compatibility.
- Preserve `packages/shared/src/credentials/backends/secure-storage.ts` as the encrypted source of truth; never store secrets in preferences, `MEMORY.md`, skills, prompts, session JSONL, guides, or automation history.

---

## 17. Phase 12 — Testing and release gates

### Automated gates

Run after each phase:

```bash
bun run typecheck:all
bun test
bun run lint
bun run validate:dev
```

Add targeted tests for:
- prompt compiler snapshots and cache-stable ordering
- memory retrieval/deduplication/forgetting
- owner policy decisions
- provider discovery and auth errors
- Ollama streaming/cancellation
- Hermes tool filtering
- ComfyUI workflow schema/progress/artifacts
- RPC validation
- renderer navigation and state recovery
- credential redaction

### Integration fixture services

Create deterministic mocks for Ollama, the Hermes backend protocol, Hermes MCP, and ComfyUI. Keep a separate opt-in live suite for real local services.

### Manual acceptance matrix

Test each supported model path against:
1. normal chat;
2. file inspection;
3. code edit + test;
4. tool failure and retry;
5. cancellation;
6. session resume;
7. memory retrieval;
8. background task;
9. image generation;
10. offline/unreachable service.

### Performance targets

- cold launch under 5 seconds on the target PC after production build
- shell remains responsive with 50k-message history metadata
- input latency under 50 ms
- tool progress visible within 250 ms of event receipt
- no full chat rerender on unrelated background-job updates
- bounded prompt/memory retrieval size

### Release artifacts

- portable development build
- signed/unsigned Windows installer as appropriate
- backup/restore command
- migration dry-run and rollback
- `THIRD_PARTY_NOTICES.md`
- owner setup guide
- integration troubleshooting guide

---

## 18. Implementation order and milestone gates

### Milestone A — “It runs”
- Bun installed
- dependencies installed
- baseline app launches
- one real Codex or existing provider prompt works

### Milestone B — “It is ours”
- rebrand complete
- new design tokens and shell live
- no Craft trademarks in product UI
- core navigation usable

### Milestone C — “It knows the owner”
- owner profile
- prompt studio
- local memory store
- retrieval/forgetting verified

### Milestone D — “All current systems connected”
- Codex direct
- Ollama Local
- Ollama Cloud verified
- Hermes first-class backend
- optional Hermes MCP capability bridge
- ComfyUI Media Lab

### Milestone E — “It acts without nagging”
- Owner Auto policy engine
- pre-authorised roots/services
- audit and rollback
- routine acceptance suite completes without unnecessary prompts

### Milestone F — “Daily-driver build”
- performance gates
- installer
- migration/backup
- full live integration suite
- seven-day dogfood period with issue log

---

## 19. First execution session after this plan

Do only Milestone A first:

1. Verify repository location remains `D:\craft-agents-oss` and that the already-removed accidental `C:\d\craft-agents-oss` duplicate has not reappeared.
2. Create redesign branch.
3. Install Bun.
4. Run `bun install`.
5. Run typecheck/tests.
6. Launch `bun run electron:dev`.
7. Capture the baseline UI and failures.
8. Do not redesign until the untouched app has completed one real model turn.

Then work visually in tight loops: shell screenshot → one design change → rebuild → screenshot → owner feedback. Change one major visual variable at a time.

---

## 20. Key risks and mitigations

| Risk | Mitigation |
|---|---|
| Fork diverges rapidly from upstream | Keep integration modules isolated; periodically merge upstream into a dedicated sync branch. |
| Duplicate agent loops between Owner Agent and Hermes | A session selects exactly one primary backend. Hermes tools may also be exposed selectively through MCP, but never invoke a hidden second conversational loop for the same turn. |
| Memory becomes noisy or creepy | Provenance, confidence, expiry, dedupe, sensitivity, editable UI, and reversible forgetting. |
| Huge tool schemas degrade model quality | Capability bundles and per-session activation; tool filtering in MCP pool. |
| Local models claim tool support but fail | Live capability probes and per-model tested flags; do not infer support from name alone. |
| ComfyUI workflow/custom node executes unsafe code | Trust marking, dependency inspection, and explicit warning for untrusted workflows/nodes. |
| “Unrestricted” causes accidental damage | Scope-based owner policy, snapshots, recycle-bin semantics, and audit—not blanket paternalistic refusals. |
| Cloud model refuses request | Surface provider limitation honestly and offer a configured local route when appropriate. |
| Credentials leak across renderer/process boundary | Existing secure storage, typed IPC, redaction tests, never put secrets in prompts. |
| Windows background services open consoles | Launch long-lived local services through hidden VBS/service wrappers; no visible terminal windows. |

---

## 21. Definition of done

The redesign is complete when the owner can launch one original-branded Windows app and:

- choose Codex, Ollama Local, or Ollama Cloud per session;
- invoke Hermes tools, skills, session search, delegation, schedules, and Telegram delivery;
- generate and manage ComfyUI image/video jobs with live progress;
- inspect/edit prompts, memories, skills, permissions, and integrations;
- work across files/projects with verified tool execution and visible diffs;
- resume sessions with durable context;
- run routine tasks without repeated approval prompts inside pre-authorised scope;
- see honest failures rather than fabricated success;
- back up, export, restore, and fully delete its local data;
- pass the full automated and live integration acceptance matrix.
