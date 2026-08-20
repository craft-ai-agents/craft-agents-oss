# Deployment Profiles

Deployment topology is orthogonal to source ownership, UI strategy, and roadmap. The product supports separate profiles; no single radio choice defines the architecture.

## Personal Local

- Electron main + hardened local provider.
- No PostgreSQL or Redis.
- Keychain/DPAPI/Secret Service wrapping and explicit recovery.
- WorkGraph remains local-only and metadata-only.
- P0 local importers are available.

## Personal External

- Native ROX Connections UI.
- Provider references Keychain/1Password/Bitwarden/Infisical or another configured provider.
- Provider access remains behind the broker; no raw payload in renderer.
- No requirement to run a provider daemon locally.

## Team Server

- Optional Infisical/OpenBao/Vault provider on external or operator-managed infrastructure.
- ROX uses provider API and opaque locators; provider remains authority for secret payload.
- External provider deployment is not a desktop dependency.
- Exact endpoint TLS, authentication, tenant/project scope, egress policy, and licensing are provider-specific gates.

## Remote Agent

- Agent Vault-compatible proxy/broker behavior is a reference architecture, not a mandatory local runtime.
- Prefer separate hardened host for proxy/broker, short-lived agent-scoped tokens, explicit egress allowlist, and no raw credential in agent context.
- Remote/headless Craft clients receive only capabilities explicitly advertised by the main/server boundary.

## Infisical boundary

Infisical is a P1 provider adapter for Team Server/Personal External. Do not embed upstream frontend, launch database/cache services per desktop, or copy its storage model. Pin an exact upstream repository commit and verify MIT/EE/third-party/trademark provenance before distribution.

## Existing Craft transport constraints

`apps/electron/src/preload/bootstrap.ts:72-103` blocks non-localhost unencrypted `ws://` in thin-client mode. `apps/electron/src/main/index.ts:826-835` differentiates GUI and headless handler registration. Connection/Broker channels must preserve these constraints and must not be advertised to remote clients without a separate capability contract.
