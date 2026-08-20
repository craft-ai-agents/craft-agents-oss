# Rox cloud Connect (desktop ↔ rox.one)

## Product policy

- Single **Rox** desktop binary lives in this repo for now.
- **Connect required** by default (`ROX_CLOUD_REQUIRED` defaults true).
- Set `ROX_CLOUD_REQUIRED=0` only for pure engine/dev without cloud identity.
- Auth host: `ROX_AUTH_BASE_URL` (default `https://rox.one`).
- Website repo: `rox-one/rox-one-website` owns better-auth, device APIs, cabinet, Neon SoT.

## Flow

1. Desktop `onboarding:startRoxConnect` → `POST {auth}/api/auth/device/start`
2. User opens `verification_uri_complete`, signs in, approves
3. Main process polls until approved → stores session via CredentialManager (`service_oauth::global::rox-cloud`)
4. Renderer watches `getRoxCloudState` until `connected`
5. Continues to provider/LLM setup

## Env

| Variable | Default | Meaning |
|----------|---------|---------|
| `ROX_AUTH_BASE_URL` | `https://rox.one` | Marketing auth origin |
| `ROX_CLOUD_REQUIRED` | `true` | Gate agent UI until Connect |

## Balance

After Connect: `GET {auth}/api/me/balance` with `Authorization: Bearer <access_token>`.
