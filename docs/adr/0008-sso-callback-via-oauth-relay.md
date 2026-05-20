# ADR 0008 — SSO Callback via OAuth Relay

## Status
Accepted

## Context
The Electron SSO Login Flow sends an OIDC authorization request to `MDP_AUTH_URL`. The original design used `redirect_uri=mdp://sso-callback` so the OS would route the code back to the app via the registered custom URL scheme.

The OIDC provider behind `MDP_AUTH_URL` rejects non-`http/https` redirect URIs for all configured clients — custom schemes (`mdp://`) are never accepted regardless of client registration.

## Decision
Use a self-hosted OAuth relay as the `redirect_uri`. The relay URL is read from the `MDP_RELAY_URL` environment variable rather than hardcoded, so each deployment points at its own relay instance. The relay's `state` parameter encodes a relay envelope with `returnTo=mdp://sso-callback` and a CSRF nonce as the inner state. The relay redirects to `mdp://sso-callback?code=...&state=<nonce>`, which the OS routes back into Electron's existing deep link handler.

A random CSRF nonce is generated before opening the browser, stored in memory, and validated when the deep link arrives.

The shared relay at `https://agents.craft.do/auth/callback` (used by WebUI OAuth flows) is **not** used for SSO — each deployment runs its own relay and registers its own relay URL with the OIDC provider.

## Alternatives considered

**Localhost callback server** — bind `http://localhost:{port}/callback` and pre-register it with the OIDC provider. Rejected because the provider requires an exact pre-registered URI, so a fixed port would need to be reserved and any port collision breaks the flow.

**Polling relay** — relay stores the code server-side, app polls for it. Rejected because it requires changes to the relay service and adds latency.

## Consequences
- No changes to the Electron deep link handler — `mdp://sso-callback` handling is already wired.
- `buildSsoLoginUrl()` must generate a nonce, wrap the state via `encodeOAuthRelayState`, and return the nonce alongside the URL so the caller can store it.
- The callback handler must receive and validate the nonce from the deep link's `state` param before exchanging the code.
- `MDP_RELAY_URL` must be set in the environment and the value pre-registered with the OIDC provider as an allowed redirect URI.
- `buildSsoLoginUrl()` throws if `MDP_RELAY_URL` is not set, the same way it throws for missing `MDP_AUTH_URL` or `MDP_CLIENT_ID`.
