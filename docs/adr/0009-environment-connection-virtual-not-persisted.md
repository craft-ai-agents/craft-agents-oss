# ADR 0009 — Environment Connection: Virtual, Not Persisted

**Status**: Accepted  
**Date**: 2026-05-18

## Decision

The **Environment Connection** (derived from `LLM_BASE_URL` / `LLM_MODEL` env vars) is synthesized in memory at startup and never written to `config.json`. It is re-derived on every launch and appears in the connection list as a pinned, read-only entry.

## Alternatives Rejected

### Pre-seed a real record in config.json on first launch

Write a real `LlmConnection` entry the first time `LLM_BASE_URL` is detected. Simpler lookup — the connection list handler needs no special case.

**Rejected because**: the record would go stale if `LLM_BASE_URL` changes (different deployment, env var removed). It would also appear deletable and editable by users, letting them silently break the enterprise default. Keeping it virtual ensures it always reflects the current env — no migration, no stale records.

### Add a user-visible "Environment" auth type in the Add Connection wizard

Let users manually create a connection with `authType: 'environment'` and no stored credential.

**Rejected because**: this defeats the purpose — the point is zero user setup. An env connection should appear automatically. A manual creation path for the same concept creates confusion about which one is authoritative.

## Consequences

- `getLlmConnections()` and `LIST_WITH_STATUS` must be aware of the virtual connection and prepend it when `LLM_BASE_URL` is set and an SSO Session is active. The virtual connection uses a well-known slug (`env-provider`) so the rest of the system can treat it like any other connection.
- The virtual connection is excluded from `saveLlmConnection`, `deleteLlmConnection`, and `setDefaultLlmConnection` handlers — attempts to mutate it are a no-op or an error.
- Settings → AI renders it with a read-only badge and no context menu actions (Edit/Delete/Rename suppressed).
- Token injection (`Authorization: <sso.token>`) is handled by the network interceptor inside the Pi subprocess, driven by `CRAFT_LLM_SSO_TOKEN` and `CRAFT_LLM_SSO_BASE_URL` env vars set at spawn time — not by the Pi SDK's built-in auth path. This is necessary because the desired header format (`Authorization: <token>` without `Bearer` prefix) differs from the Pi SDK's default OpenAI auth format.
- A `501` response from `LLM_BASE_URL` signals an expired Session Token and triggers a redirect to the Login Page, consistent with how all other MDP API calls handle token expiry.
- Onboarding is skipped when the Environment Connection is ready (env vars present + SSO authenticated) — no wizard needed.
