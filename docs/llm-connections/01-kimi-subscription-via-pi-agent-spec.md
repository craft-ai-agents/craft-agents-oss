---
status: draft
owner: agent
last_verified: 2026-06-28
source_of_truth: false
---

# Kimi Subscription Via PiAgent Spec

## Decision

Add Kimi as a first-class LLM connection option by reusing the existing PiAgent path.

Do not add a new `KimiAgent` backend for V1. RunnerOS already has the right runtime abstraction:

```ts
providerType: 'pi'
authType: 'api_key'
piAuthProvider: 'kimi-coding'
modelSelectionMode: 'automaticallySyncedFromProvider' | 'userDefined3Tier'
```

This means Kimi sessions behave like other Runner Backend connections: same agent runtime, same tools, same workspace context, same approvals, same session locking.

## Product Shape

Settings / onboarding should expose a clear option:

```text
Kimi
Use your Kimi Coding subscription/API key to run RunnerOS agents.
```

Internally this should create or update a normal Pi connection, not a custom endpoint connection.

Recommended slug:

```text
kimi-subscription
```

Recommended display name:

```text
Kimi
```

## Current Code Signals

Kimi support is already partially present:

- `packages/server-core/src/domain/connection-setup-logic.ts`
  - `piAuthProviderDisplayName()` already maps `kimi-coding` to `Kimi (Coding)`.
- `apps/electron/src/renderer/components/apisetup/ApiKeyInput.tsx`
  - provider preset already includes `kimi-coding`.
- `packages/shared/src/config/models-pi.ts`
  - provider metadata already includes `kimi-coding`.
- `apps/electron/src/renderer/assets/provider-icons/kimi.svg`
  - icon asset already exists.

So this is mostly a productized preset/wiring task, not a new backend.

## Connection Template

Add a built-in template:

```ts
'kimi-subscription': {
  name: 'Kimi',
  providerType: 'pi',
  authType: 'api_key',
  piAuthProvider: 'kimi-coding',
}
```

Expected persisted connection:

```json
{
  "slug": "kimi-subscription",
  "name": "Kimi",
  "providerType": "pi",
  "authType": "api_key",
  "piAuthProvider": "kimi-coding",
  "modelSelectionMode": "automaticallySyncedFromProvider"
}
```

Credentials stay in encrypted LLM credential storage under the connection slug.

## Setup Flow

1. User chooses `Kimi`.
2. UI asks for the Kimi Coding key/token.
3. Setup calls `settings.SETUP_LLM_CONNECTION` with:

```ts
{
  slug: 'kimi-subscription',
  credential: '<user key>',
  piAuthProvider: 'kimi-coding',
  setAsDefault: true | false
}
```

4. Backend creates a Pi connection.
5. Model refresh uses `getModels('kimi-coding')`.
6. User can choose model tiers if automatic defaults are not good enough.

## Model Defaults

Prefer provider-discovered models over hardcoded IDs.

If tier defaults are needed, add a `kimi-coding` entry to `PROVIDER_PREFERRED_TIERS` in:

```text
apps/electron/src/renderer/components/apisetup/tier-models.ts
```

Use only model IDs returned by the Pi model resolver, for example IDs shaped like:

```text
pi/moonshotai/...
```

Do not guess final model IDs in code without verifying the current Pi registry output.

## Runtime Behavior

When a session uses the Kimi connection:

- Session provider resolves to `pi`.
- `createBackendFromConnection()` creates `PiAgent`.
- `PiAgent` receives `piAuthProvider: 'kimi-coding'`.
- Tools, approvals, workspace context, spawned sessions, and session MCP behavior stay on the existing PiAgent path.

No Claude SDK path should be involved.
No Codex OAuth path should be involved.

## Subscription Caveat

This spec assumes Kimi subscription access is represented by a key/token accepted by the Pi SDK provider `kimi-coding`.

If Kimi only exposes browser-login subscription access through Kimi CLI, this spec is not enough. That would require a separate backend that wraps Kimi CLI wire mode as a subprocess runtime.

V1 should avoid that unless API-key access cannot satisfy the product goal.

## Files To Touch

Likely required:

- `packages/server-core/src/domain/connection-setup-logic.ts`
  - add `kimi-subscription` built-in template.
- `apps/electron/src/renderer/components/apisetup/ApiKeyInput.tsx`
  - expose a first-class Kimi option where connection setup choices are shown.
- `apps/electron/src/renderer/components/apisetup/tier-models.ts`
  - optional provider-specific model tier defaults.
- `apps/electron/src/renderer/lib/provider-icons.ts`
  - confirm `kimi-coding` maps to the Kimi icon.
- `apps/electron/src/main/__tests__/connection-setup-logic.test.ts`
  - add template/default assertions.

Likely not required:

- New backend provider type.
- New credential type.
- New agent implementation.
- New session manager routing.

## Verification

Run focused checks:

```bash
bun test apps/electron/src/main/__tests__/connection-setup-logic.test.ts
bun test apps/electron/src/renderer/components/apisetup/__tests__/ApiKeyInput.test.ts
bun run typecheck:electron
```

Manual smoke:

1. Add Kimi connection.
2. Confirm it stores as `providerType: 'pi'` and `piAuthProvider: 'kimi-coding'`.
3. Confirm model list loads.
4. Start a new agent session with Kimi selected.
5. Confirm tool approval flow still works.
6. Confirm session locks to the Kimi connection after first message.
