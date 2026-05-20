# ADR 0010 — OpenLLM Provider: New ProviderType with Per-Model URL Construction

**Status**: Accepted  
**Date**: 2026-05-20

## Decision

Add `providerType: 'openllm'` as a new value in `LlmProviderType`, backed by `AgentProvider: 'pi'` (PiAgent subprocess). The OpenLLM driver constructs the endpoint URL per call as `{OPENLLM_HOST}/llm/{model_name}/v1`, reading the host from the `OPENLLM_HOST` environment variable at call time. The host is never stored in the `LlmConnection` record — only the API key and user-defined model list are persisted.

## Why Not `pi_compat`

`pi_compat` takes a static `baseUrl` on the connection record and passes it unchanged to the Pi subprocess. OpenLLM's endpoint URL changes with the model — `{host}/llm/llama-3/v1` vs `{host}/llm/mistral-7b/v1` — so there is no single URL to store. Fitting this into `pi_compat` would require either:

- Baking the model name into `baseUrl` at connection-save time and rewriting the field on every model switch (stale-data risk, surprising mutation of a connection field), or
- Adding a URL-template mechanism to `pi_compat` specifically for this case (leaks OpenLLM-specific logic into a generic path).

A dedicated `providerType: 'openllm'` keeps the URL construction logic in one driver and leaves `pi_compat`'s static-URL contract intact.

## Why the Host Is Not Stored

The host is deployment-owned infrastructure, not user-owned credential data. Storing it alongside the API key would create a stale record if the deployment changes `OPENLLM_HOST`. Reading from the env var at call time ensures all connections automatically reflect the current deployment without migration.

## Consequences

- `LlmProviderType` gains a new literal: `'openllm'`.
- `providerTypeToAgentProvider('openllm')` returns `'pi'`.
- `defaultMidStreamBehavior('openllm')` returns `'steer'`.
- `isCompatProvider('openllm')` returns `true` — model list is user-defined, not fetched from a registry.
- The Add Connection preset is always shown regardless of whether `OPENLLM_HOST` is set; a missing env var surfaces as a runtime error when the connection is used.
- `isValidProviderAuthCombination` allows `openllm + api_key` only.
- **Protocol**: `OPENLLM_CUSTOM_ENDPOINT = { api: 'openai-completions' }` and `OPENLLM_PI_AUTH_PROVIDER = 'openai'`. OpenLLM speaks the OpenAI Chat Completions protocol — the initial `anthropic-messages` value in this file was incorrect. The constant is injected at runtime by the driver and `runtime-config.ts`, not stored on the connection record, so no migration is required.

## Amendment — OpenLLM Environment Connection (slug `openllm-env`)

A synthesized virtual connection activated when `OPENLLM_HOST` is set, parallel to the Environment Connection (`env-provider`). It becomes the implicit default in `getDefaultLlmConnection` when `OPENLLM_HOST` is present and no user-set explicit default exists — taking priority over env-provider. Auth is SSO-token injection via the network interceptor (`CRAFT_LLM_SSO_BASE_URL = OPENLLM_HOST`, matching all per-model paths). `OPENLLM_MODELS` (comma-separated, first is default) supplies the model list; `OPENLLM_CONNECTION_NAME` overrides the display name (defaults to `"OpenLLM"`). `isValidProviderAuthCombination` is not consulted for synthesized connections.
