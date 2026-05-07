# CLAUDE.md — `@craft-agent/shared`

## Purpose
Core business logic package for Craft Agent:
- Agent backends and session-scoped tools
- Sources, credentials, sessions, and config
- Permission modes and validation

## Key folders
- `src/agent/` — `claude-agent.ts`, `pi-agent.ts`, `base-agent.ts`, tools, permissions
- `src/sources/` — source storage/types/services
- `src/sessions/` — session persistence/index
- `src/config/` — config/preferences/theme/watcher
- `src/credentials/` — encrypted credential management

## Commands
From repo root:
```bash
cd packages/shared && bun run tsc --noEmit
```

## Hard rules
- Permission modes are fixed: `safe`, `ask`, `allow-all`.
- Source types are fixed: `mcp`, `api`, `local`.
- Keep credential handling in `src/credentials/` pathways (no ad-hoc secret storage).
- Keep user-facing tool contracts backward-compatible where possible.

## Notes
- `ClaudeAgent` is the primary class in `src/agent/claude-agent.ts`.
- Claude SDK subprocess env is sanitized to strip Claude-specific Bedrock routing vars (`CLAUDE_CODE_USE_BEDROCK`, `AWS_BEARER_TOKEN_BEDROCK`, `ANTHROPIC_BEDROCK_BASE_URL`). Pi Bedrock uses its own AWS env path instead.
- Backward alias export (`CraftAgent`) exists for compatibility.
- Prefer routing new model vendors through the existing Pi path (`providerType: 'pi'` + `piAuthProvider`) unless they truly need a distinct runtime/backend. The Pi provider catalog and display metadata live in `src/config/models-pi.ts`.
- Custom endpoint model capabilities must preserve explicit per-model overrides end-to-end. In particular, `supportsImages: true` enables image input for one model and `supportsImages: false` must remain available to override a global endpoint image default. Active Pi custom-endpoint sessions refresh runtime capabilities via `updateRuntimeConfig`; capability changes are pushed proactively from the `llmConnections.SAVE` handler through `SessionManager.refreshConnectionRuntime`, with the lazy `getOrCreateAgent` path acting as a backstop. The session layer still gates image attachments at send time so disabled images are not sent even if a subprocess refresh fails.
- `update_runtime_config` IPC carries `model, providerType, authType, baseUrl, customEndpoint, customModels` only — `piAuthProvider`, `slug`, and the broader credential/provider routing state cannot be re-routed inside a live Pi subprocess. `runtime-config.ts:buildRestartRequiredSignature` hashes those fields separately from the in-place-safe ones; when the restart signature drifts, `tryRefreshAgentRuntime` skips the in-place attempt and goes straight to dispose + recreate so the new auth/provider state actually takes effect.
- Session lifecycle distinguishes **hard aborts** from **UI handoff interrupts**:
  - use hard aborts for true cancellation/teardown (`UserStop`, redirect fallback)
  - use handoff interrupts for pause points where control moves to the UI (`AuthRequest`, `PlanSubmitted`)
- Remote workspace handoff summaries are injected as one-shot hidden context on the destination session's first turn.
- WebUI source OAuth uses a stable relay redirect URI (`https://agents.craft.do/auth/callback`); the deployment-specific callback target is carried in a relay-owned outer `state` envelope and unwrapped by the router worker.
- Automations matching is unified through canonical matcher adapters in `src/automations/utils.ts` (`matcherMatches*`). Avoid direct primitive-only matcher checks in feature code so condition gating stays consistent across app and agent events.
- Automation matchers may declare an optional `telegramTopic?: string` to route spawned sessions into a Telegram forum topic in the workspace's paired supergroup. The field is plumbed through `PendingPrompt` and `ExecutePromptAutomationInput`; runtime resolution and topic creation live in `@craft-agent/messaging-gateway`'s `TopicRegistry` and `MessagingGatewayRegistry.bindAutomationSession`. SessionManager picks up the resolution via the optional `setAutomationBinder` hook installed by the messaging-gateway bootstrap.
- The OpenAI Chat Completions strip stream (`unified-network-interceptor.ts:createOpenAiSseStrippingStream`) emits **one consolidated SSE event per logical tool call** with `id + name + cleanArgs` together — never split across init + args-only deltas. Some downstream SDKs (Pi SDK) treat args-only deltas as new tool_calls instead of merging by index, which produces duplicate empty-id entries on parallel-tool turns from DeepSeek and other relays. `sanitizeOpenAiHistoryInPlace` recovers sessions whose history was persisted by the pre-fix split-emit version.
- `LlmConnection.midStreamBehavior` controls whether mid-stream user sends try to steer the in-flight turn or hold for the next turn. Default is per-`providerType` via `defaultMidStreamBehavior()` (anthropic→`'queue'`, pi/pi_compat→`'steer'`). **Read everywhere via `resolveMidStreamBehavior(connection)`** — never branch on `providerType` directly for this decision; legacy connections without the field rely on the resolver's fallback. New connections persist the explicit default at `createBuiltInConnection` time so the Settings → AI submenu shows a checkmark on first load. The decision is made in `SessionManager.sendMessage`'s mid-stream branch only — backend code (`claude-agent.ts`, `pi-agent.ts`) is unchanged: `'queue'` mode skips `agent.redirect()` entirely and lets the current turn finish before replay.
- The network interceptor (`unified-network-interceptor.ts`) is currently **Pi-only**: it preloads into the Pi subprocess via Bun `--preload`. The Claude SDK no longer runs under Bun (since 0.2.113 it spawns a per-platform native `claude` binary), so `--preload` is not available there. Features that used to live in the interceptor for Claude (rich tool intent, fast-mode override, MalformedBodyError validation, etc.) are tracked as Phase-2 work in `plans/sdk-uplift-plan.md` — they'll need to move to SDK hooks or a local proxy. In dev / monorepo runs, the Pi interceptor still preloads from the .ts source so changes propagate without a rebuild; packaged builds use `apps/electron/dist/interceptor.cjs`. See `agent/backend/internal/runtime-resolver.ts:resolveInterceptorBundlePath`.

## i18n (Internationalization)

Translations live in `src/i18n/locales/{lang}.json`. All user-facing strings must use `t()` (React) or `i18n.t()` (non-React).

### Locale registry (single source of truth)

All locale metadata lives in **`src/i18n/registry.ts`**. To add a new locale:

1. Create `src/i18n/locales/{code}.json` with all keys (copy from `en.json`)
2. Import the messages and `date-fns` locale in `registry.ts`
3. Add one entry to `LOCALE_REGISTRY`

**That's it.** `SUPPORTED_LANGUAGE_CODES`, `LANGUAGES`, i18n resources, and `getDateLocale()` are all derived automatically. No other file needs to change.

### Key naming convention

Keys use **flat dot-notation** with a category prefix:

| Prefix | Scope | Example |
|--------|-------|---------|
| `common.*` | Shared labels (Cancel, Save, Close, Edit, Loading...) | `common.cancel` |
| `menu.*` | App menu items (File, Edit, View, Window) | `menu.toggleSidebar` |
| `sidebar.*` | Left sidebar navigation items | `sidebar.allSessions` |
| `sidebarMenu.*` | Sidebar context menu actions | `sidebarMenu.addSource` |
| `sessionMenu.*` | Session context menu actions | `sessionMenu.archive` |
| `settings.*` | Settings pages — nested by page ID | `settings.ai.connections` |
| `chat.*` | Chat input, session viewer, inline UI | `chat.attachFiles` |
| `toast.*` | Toast/notification messages | `toast.failedToShare` |
| `errors.*` | Error screens | `errors.sessionNotFound` |
| `onboarding.*` | Onboarding flow — nested by step | `onboarding.welcome.title` |
| `dialog.*` | Modal dialogs | `dialog.reset.title` |
| `apiSetup.*` | API connection setup | `apiSetup.modelTier.best` |
| `workspace.*` | Workspace creation/management | `workspace.createNew` |
| `sourceInfo.*` | Source detail page | `sourceInfo.connection` |
| `skillInfo.*` | Skill detail page | `skillInfo.metadata` |
| `automations.*` | Automation list/detail/menus | `automations.runTest` |
| `sourcesList.*` | Sources list panel | `sourcesList.noSourcesConfigured` |
| `skillsList.*` | Skills list panel | `skillsList.addSkill` |
| `editPopover.*` | EditPopover labels/placeholders | `editPopover.label.addSource` |
| `status.*` | Session status names (by status ID) | `status.needs-review` |
| `mode.*` | Permission mode names (by mode ID) | `mode.safe` |
| `hints.*` | Empty state workflow suggestions | `hints.summarizeGmail` |
| `table.*` | Data table column headers | `table.access` |
| `time.*` | Relative time strings | `time.minutesAgo_other` |
| `session.*` | Session list UI | `session.noSessionsYet` |
| `shortcuts.*` | Keyboard shortcuts descriptions | `shortcuts.sendMessage` |
| `sendToWorkspace.*` | Send to workspace dialog | `sendToWorkspace.title` |
| `webui.*` | WebUI-specific strings | `webui.connectionFailed` |
| `auth.*` | Auth banner/prompts | `auth.connectionRequired` |
| `browser.*` | Browser empty state | `browser.readyTitle` |

### Rules

1. **Never call `i18n.t()` at module level** — store `labelKey` strings and resolve in components/functions.
2. **Use i18next pluralization** (`_one`/`_other`), never manual `count === 1 ?` logic.
3. **Keep brand names in English**: Craft, Craft Agents, Agents, Workspace, Claude, Anthropic, OpenAI, MCP, API, SDK.
4. **Include `...` in the translation value** if the UI needs an ellipsis — don't append it in JSX.
5. **Use `<Trans>` component** for translations containing HTML tags (e.g. `<strong>`).
6. **Use `i18n.resolvedLanguage`** (not `i18n.language`) when comparing against supported language codes.
7. **Keys must exist in all locale files** (`en.json`, `es.json`, `zh-Hans.json`, and any future locales). Keep alphabetically sorted.
8. **Watch translation length for constrained UI elements.** Translations can be 20-100%+ longer than English. For buttons, badges, tab labels, and dropdown items, keep translations concise — use shorter synonyms if needed. High-risk areas:
   - Permission mode badges (3-5 characters max)
   - Settings tab labels (≤10 characters ideal)
   - Button labels (avoid exceeding 2x the English length)
   - Menu items (flexible, but avoid 3x+ growth)

### Validation

Three checks gate i18n correctness, all wired into pre-commit (`lint:i18n:staged`) and `validate:ci`:

| Script | Catches |
|--------|---------|
| `lint:i18n:sorted` | locale keys not alphabetical |
| `lint:i18n:parity` | non-EN locale missing keys present in `en.json`, or vice versa |
| `lint:i18n:coverage` | `t('...')` callsite referencing a key that doesn't exist in `en.json` |

`parity` alone is insufficient — it can't detect symmetric losses across all locales (a merge that drops the same 50 keys from every locale file passes parity but breaks the UI). `coverage` closes that gap by verifying every literal `t(...)` / `i18n.t(...)` / `<Trans i18nKey>` reference resolves against `en.json`. Dynamic keys (`t(\`status.${id}\`)`) are skipped — those surface via i18next's runtime missing-key warnings.

When resolving locale merge conflicts, run `bun run validate:ci` and trust the result — no manual key auditing needed if all three pass.

### Adding a new translated string

1. Add the key + English value to `en.json` (alphabetical order)
2. Add the key + translated value to all other locale files (`es.json`, `zh-Hans.json`)
3. Use `t("your.key")` in the component (add `useTranslation()` hook if not present)
4. For non-React code, use `i18n.t("your.key")` — but only inside functions, never at module level

### Adding a new locale

1. Create `src/i18n/locales/{code}.json` with all keys from `en.json`
2. Add the entry to `LOCALE_REGISTRY` in `src/i18n/registry.ts` (messages + date-fns locale + native name)
3. Run tests — the registry tests will catch any missing wiring

## Token refresh for API sources

API sources can auto-refresh tokens via two paths:
- **OAuth** — Google, Slack, Microsoft, or generic OAuth (`authType: 'oauth'`)
- **Renew endpoint** — custom bearer-token APIs with `api.renewEndpoint` in config.json

For renew-endpoint sources, the current access token is sent to the configured endpoint and a new token is extracted from the response. No separate refresh token is needed (MVP scope).

Key integration points:
- `isRefreshableSource()` in `types.ts` — single guard for "can this source auto-refresh?"
- `SourceCredentialManager.refreshApiRenew()` — calls the renew endpoint
- `TokenRefreshManager` — treats renew-endpoint sources as refreshable even without `refreshToken`
- `server-builder.ts` — passes a token getter (not static credential) for renew-endpoint sources

## `queryLlm` backend contract

Every `AgentBackend.queryLlm(request: LLMQueryRequest)` implementation MUST:
- honor `request.model` (with backend-specific fallback only when the model is
  unresolvable/unsupported; always report the *effective* model in
  `LLMQueryResult.model`)
- honor `request.systemPrompt`

SHOULD:
- honor `request.outputSchema` (at minimum via prompt injection — see
  `buildCallLlmRequest` in `agent/llm-tool.ts`, which already handles this
  pre-backend)

MAY:
- honor `request.maxTokens` and `request.temperature` if the underlying SDK
  supports passing these to its generation call

MUST NOT:
- return a fabricated `LLMQueryResult.model` that doesn't match what was actually
  used — downstream UI treats this as authoritative

IPC envelopes between the main process and any subprocess backend (Pi today,
potentially others) MUST carry the full `LLMQueryRequest`, not a subset.
A backend that invents a narrower envelope is guaranteed to drift over time
(see #596). The round-trip invariant is guarded by
`packages/shared/src/agent/__tests__/pi-query-llm.test.ts`.

## Source of truth
- Package exports: `packages/shared/src/index.ts` and subpath export entries.
- Agent exports: `packages/shared/src/agent/index.ts`
