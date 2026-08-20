# Security and External Access Design v1

**Status:** Approved design; implementation is intentionally out of scope for this document.

## 1. Purpose and scope

Craft Agents must support four independent product capabilities without conflating their trust boundaries:

1. Remote workspaces reachable through public CA TLS, explicit self-hosted trust enrollment, or SSH tunnels.
2. Public messaging channels that accept contact/pairing requests but reserve agent control for explicitly approved sender IDs.
3. Public, no-account session sharing, while creation and revocation remain owner-authenticated operations.
4. Owner-only external WebUI access from phones and computers through per-device pairing and passkeys.

This specification also defines the security boundary for shell and `transform_data` execution and the CI/CD trust split required to ship these capabilities.

It does not select a concrete CI vendor for macOS, provision external infrastructure, use credentials, change existing source, or merge a rebranding branch.

## 2. Terminology and origin roles

The implementation must use logical origin roles rather than hard-coded brand domains:

| Role | v1 target after rebranding | Responsibility |
|---|---|---|
| `APP_ORIGIN` | `app.rox.one` | Owner WebUI, WebAuthn, pairing, authenticated RPC/WebSocket, OAuth callback. |
| `SHARE_ORIGIN` | `share.rox.one` | Public immutable session viewer, Cloudflare Pages Function, R2-backed read API. |
| `AUTH_ORIGIN` | Not used in v1 | Reserved for a later dedicated authentication origin. |

`APP_ORIGIN` and `SHARE_ORIGIN` MUST be distinct origins. `SHARE_ORIGIN` MUST NOT receive WebUI session cookies or accept authenticated WebSocket upgrades.

The specification remains domain-agnostic until the parallel rebranding worktree/branch is identified. The actual hostname mapping is an integration concern.

## 3. Remote workspace trust

### 3.1 Required policy

Remote workspace trust has exactly three supported routes:

| Remote type | Required trust mechanism |
|---|---|
| Branded/public remote | `wss://` with a valid public-CA certificate. |
| Direct self-hosted remote | `wss://` with explicit app-local SPKI pin enrollment. |
| SSH-backed remote | Verified SSH host key plus a local tunnel. |

An invalid, expired, hostname-mismatched, or untrusted certificate MUST block connection before any remote bearer token is transmitted. The product MUST NOT retain any global `rejectUnauthorized: false` override.

### 3.2 Self-hosted enrollment

For an unknown self-signed direct remote:

1. Craft inspects the peer certificate without sending a remote token.
2. It displays origin, SPKI SHA-256 fingerprint, issuer, and expiry.
3. The owner compares the fingerprint using an independent channel such as server console, QR code, or verified SSH login.
4. The owner explicitly accepts or rejects the enrollment.
5. Craft stores an app-local record keyed by origin and SPKI pin.
6. Only after successful enrollment may Craft authenticate the remote RPC connection.

The stored pin is trust material, not a secret. It is scoped to one origin. A changed key blocks connection until the owner explicitly confirms a rollover showing both old and new fingerprints.

### 3.3 Existing implementation surface

The secure default already exists in `packages/server-core/src/transport/client.ts`, where `tlsRejectUnauthorized` defaults to `true`. The implementation must remove unsafe callers currently present in:

- `apps/electron/src/preload/bootstrap.ts`;
- `apps/electron/src/main/handlers/workspace.ts`;
- any equivalent transport callers found by symbol/reference search, including mobile clients.

## 4. Messaging and execution authority

### 4.1 Messaging access modes

Messaging bindings MUST have an explicit access mode:

| Mode | Behaviour |
|---|---|
| `public-inbox` | Unknown senders receive only a static pairing/access response. No LLM session or tool invocation occurs. |
| `owner-control` | Only `allowedSenderIds` may route to a bound owner session. |
| `disabled` | No inbound routing occurs. |

New and migrated bindings MUST NOT silently default to public agent control. Non-Telegram platforms MUST NOT retain a hard-coded `open` default.

Pairing records MUST be short-lived, rate-limited per platform/sender, auditable, and explicitly approved by an owner before becoming an allowlist entry.

### 4.2 Execution authority

An external message, including one from an allowlisted sender, remains untrusted input. Sender authorization grants routing authority; it does not silently enlarge tool authority.

Before the local sandbox is available:

- `transform_data` remains available;
- Safe/Explore mode MUST require explicit owner approval before unsandboxed `transform_data` execution;
- approval UI MUST show language, input paths, output path, and a concise script summary;
- unknown public-inbox senders MUST never reach tool-capable sessions.

## 5. Sandbox execution runner

### 5.1 Target architecture

Shell and `transform_data` MUST converge on one `SandboxExecutionRunner`, backed by a local microVM. Environment stripping, timeouts, `cwd`, a shell parser, and deprecated `sandbox-exec` are not sufficient isolation.

A request describes:

- command or language;
- read-only input mounts;
- writable output mounts;
- network policy;
- explicit environment allowlist;
- CPU, memory, wall-clock, and process-count limits;
- execution audit summary.

The microVM MUST deny access to host credentials, home directory, keychain, SSH agent, Docker socket, browser debugging sockets, Craft config, and the network by default.

### 5.2 Permission policy

| Mode | Before microVM availability | After microVM availability |
|---|---|---|
| Safe/Explore shell | Fail closed when sandbox is unavailable. | Run only through `SandboxExecutionRunner`. |
| Safe/Explore `transform_data` | Explicit owner approval. | Run through `SandboxExecutionRunner`. |
| Local `allow-all` session | Explicitly unsafe existing semantics; never granted to public senders. | Sandbox is preferred but mode remains owner-controlled. |

A parser MAY explain likely command effects to the user. It MUST NOT be the authorization boundary for arbitrary shell writes.

## 6. Public shares

### 6.1 Share lifecycle

A share is an immutable public snapshot:

1. An authenticated Craft owner creates a share.
2. The service records `ownerId`, `createdAt`, and `expiresAt`.
3. The owner receives a public read URL.
4. Any reader with that URL may read the snapshot without an account until expiry.
5. The snapshot expires after exactly 30 days.
6. The authenticated owner may revoke it before expiry.

Shares MUST NOT support in-place update. Public read URLs MUST NOT grant create, update, delete, or revoke authority.

### 6.2 Authorization and observability

- Create and revoke require the owner-authenticated `APP_ORIGIN` path.
- Public GET remains unauthenticated on `SHARE_ORIGIN`.
- Expired, revoked, unknown, and unauthorized share IDs return indistinguishable generic `404` responses.
- Share creation has owner-scoped quota and rate/size limits.
- CORS is same-origin or an explicit narrow allowlist; it MUST NOT be wildcarded for mutation endpoints.
- `SHARE_ORIGIN` uses `Referrer-Policy: no-referrer`.
- Logs store a canonicalized or hashed share identifier, never a full bearer URL or session payload.

### 6.3 Legacy shares

Existing anonymous R2 objects cannot be assigned to an owner by inference. At cutover they become read-only. Their expiry is their reliable `createdAt + 30 days`, or at most `cutover + 30 days` where metadata is incomplete. No legacy mutation capability is preserved.

## 7. External WebUI and device pairing

### 7.1 Per-device authentication

`APP_ORIGIN` uses WebAuthn passkeys for browser-first per-device identity. A trusted device starts a short-lived QR pairing request; a new device scans it, creates a passkey, and displays a human-verifiable confirmation code. The trusted device accepts or rejects the pairing.

The server stores:

```text
DeviceRecord
  deviceId
  ownerId
  WebAuthn credential ID and public key
  label
  createdAt
  lastSeenAt
  revokedAt
  sessionVersion
```

A browser session includes `deviceId`. Every HTTP request and WebSocket upgrade validates the session, the active non-revoked `DeviceRecord`, and its `sessionVersion`. Revoking a device invalidates subsequent requests and closes active WebSocket connections.

### 7.2 Browser session and perimeter

The session cookie is host-only and follows this contract:

```text
__Host-craft_session
  Secure
  HttpOnly
  SameSite=Strict
  Path=/
  no Domain attribute
  short access TTL
```

The external perimeter is:

```text
Browser → HTTPS/WSS reverse proxy with public CA → private Craft backend
```

The backend RPC port MUST NOT be directly reachable from the Internet. The reverse proxy overwrites forwarded headers, terminates TLS, supports WebSocket upgrade, and rate-limits login and upgrade paths. WebSocket upgrades MUST require exact `Origin == APP_ORIGIN` in addition to session validation.

OAuth callback remains `APP_ORIGIN/api/oauth/callback` in v1. Provider-derived strings are HTML-escaped before rendering. A future `AUTH_ORIGIN` is out of scope.

### 7.3 Recovery

Recovery codes are generated once, displayed once, stored only as hashes, consumed once, and force registration of a new passkey. Any recovery material previously exposed outside a protected channel MUST be replaced, not reused.

## 8. CI/CD and dependency policy

### 8.1 Trust split

| Workflow class | Secrets | Purpose |
|---|---|---|
| PR/fork validation | None | Frozen install, typecheck, tests, builds, security reports. |
| Protected main | Only minimal read/observability scope when required | Full validation and immutable artifact creation. |
| Approved deploy | Short-lived scoped deploy credentials | Deploy, target smoke, rollback evidence. |
| macOS release | Signing/notarization credentials only in this disposable protected job | Package, sign, notarize, verify. |

CircleCI is the current Linux validation baseline because `.circleci/config.yml` already provides a Bun-based smoke workflow. BuildKit is a Linux image-build backend, not a macOS signing replacement. A disposable managed macOS executor is required for macOS release work; the concrete provider is an implementation-time infrastructure decision.

No workflow may use credentials previously exposed outside a protected secret store. Credentials must be rotated before external CI/CD configuration.

### 8.2 Dependency triage

CI always runs and emits evidence. Promotion/deploy is blocked only by an unmitigated reachable critical or high advisory. Each such advisory requires package/version, dependency path, runtime classification, reachable caller, attacker-controlled input assessment, fixed version/workaround, owner, and review decision.

`bun update --latest` or forced bulk audit remediation is prohibited. Dev-only or demonstrated unreachable findings require a documented, expiring exception rather than silent suppression.

## 9. Verification, rollout, and repository integration

### 9.1 Mandatory verification

| Boundary | Required verification |
|---|---|
| TLS | Valid CA works; untrusted peer receives no token; enrolled SPKI works; changed pin blocks. |
| Messaging | Unknown sender invokes neither LLM nor tools; allowlisted sender routes correctly; pairing expires and rate-limits. |
| Sandbox | Home/keychain/network/socket access denied; resource limits work; only declared mounts are writable. |
| `transform_data` bridge | Owner approval is required; rejection leaves no child process/output. |
| Shares | Anonymous create rejected; public read works before expiry; expired/revoked response is generic `404`; foreign owner cannot revoke. |
| Device pairing | QR replay/expiry rejected; passkey required; revoke closes active WebSocket. |
| WebUI | Secure host-only cookie; foreign WebSocket Origin rejected; backend direct ingress unavailable. |
| CI/CD | PR environment has no deploy secrets; deploy job is protected; artifacts and target smoke are recorded. |

### 9.2 Source integration contract

- `main` is the current runtime baseline because it already contains viewer deployment commit `d221aa495`.
- `fix/viewer-share-rox-onboarding` is design input only; its docs must be reconciled with this approved specification, not blindly merged.
- `feat/agents-rox-viewer` MUST NOT be merged as implementation source because it is stale relative to `main` and lowers viewer version `0.11.5` to `0.11.4`.
- Implementation begins only from the identified rebranding branch/worktree. Until then, this specification uses logical origins.

### 9.3 Rollout order

1. Rotate exposed credentials and establish protected CI secret delivery.
2. Merge/reconcile domain-agnostic security changes onto the rebranding base.
3. Ship TLS strictness and app-local pin enrollment with migration diagnostics.
4. Ship messaging access modes and the `transform_data` approval bridge.
5. Ship owner-authenticated immutable share lifecycle and legacy-share expiry cutover.
6. Ship external WebUI perimeter and device pairing.
7. Ship local microVM sandbox; then move Safe/Explore `transform_data` into it.
8. Complete reachable dependency remediation and CI/CD artifact/deploy evidence gates.

Each phase requires its listed verification before the next phase begins.
