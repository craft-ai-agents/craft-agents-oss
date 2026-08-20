# Security and External Access Implementation Plan

> **For agentic workers:** Execute one task at a time with a fresh review gate. Tasks use checkbox (`- [ ]`) syntax for tracking. Do not use an implementation substitute for a missing isolation or identity boundary.

**Goal:** Deliver the approved Security and External Access Design v1 as independently testable TLS, messaging, sandbox, identity, sharing, and CI/CD increments.

**Architecture:** Keep local transport and messaging authority in existing TypeScript packages. Introduce a durable device-auth authority before the share-management capability that depends on it. Treat the local microVM and external WebUI deployment as real prerequisites, not aliases for `sandbox-exec`, environment filtering, or a shared password. Public reads remain isolated in the Cloudflare Pages viewer; management operations originate at the authenticated application service.

**Tech Stack:** Bun/TypeScript, Electron, `ws`, Node TLS/X509, existing JSON-backed Craft configuration, Cloudflare Pages/R2, WebAuthn, CircleCI, GitHub Actions, Docker/BuildKit.

## Global Constraints

- Implement on the discovered rebrand integration base, not by blindly merging `feat/agents-rox-viewer` or `fix/viewer-share-rox-onboarding`.
- Logical origins are `APP_ORIGIN` and `SHARE_ORIGIN`; `app.rox.one` and `share.rox.one` are deployment values only.
- Remote tokens MUST NOT be sent before public-CA validation or app-local SPKI pin verification succeeds.
- Unknown public messaging senders MUST NOT enter an LLM session or reach tool execution.
- Safe/Explore shell MUST fail closed until the local microVM is usable. `transform_data` requires explicit owner approval until then.
- A public share is immutable and expires exactly 30 days after creation; it has no URL-borne mutation capability.
- Device revocation invalidates subsequent HTTP requests and closes active WebSockets.
- PR/fork jobs receive no deployment, signing, or cloud credentials. No exposed credential is reused.
- Preserve existing user-owned dirty worktree changes. Stage only files created/modified by the task currently being executed.

---

## Program structure and execution gates

| Increment | Deliverable | Depends on |
|---|---|---|
| A | Strict remote TLS and explicit SPKI enrollment | Current local Electron/runtime code only |
| B | Default-deny public messaging authority | Current messaging-gateway code only |
| C | `SandboxExecutionRunner` contract and owner-approval bridge | Local microVM image/runtime contract before enforcement |
| D | WebUI device authority and proxy-safe session enforcement | Durable deployment-owned device store and origin configuration |
| E | Owner-authenticated immutable public shares | Increment D capability issuer |
| F | Protected CI/CD and dependency triage evidence | Rotated credentials and approved provider configuration |

### Gate 0: Establish deployable identity and sandbox ownership

**Files:**
- Create: `docs/security/external-access-deployment-contract.md`
- Modify: `docs/superpowers/specs/2026-08-11-security-external-access-design.md` only if the agreed deployment facts differ from the stated logical-origin contract.
- Test: an operator-reviewed deployment worksheet; no source-code test substitutes for this gate.

**Interfaces:**
- Consumes: approved logical origins and local-microVM decision from the design spec.
- Produces: immutable references for `APP_ORIGIN`, `SHARE_ORIGIN`, device-record backing store, secret authority, microVM image signer/digest, and reverse-proxy ownership.

- [ ] **Step 1: Select the durable device-record store and its transaction owner.**

Record one production-owned datastore with atomic conditional update support for:

```ts
interface DeviceRecord {
  deviceId: string
  ownerId: string
  credentialId: string
  publicKeyCose: Uint8Array
  label: string
  createdAt: number
  lastSeenAt: number
  revokedAt?: number
  sessionVersion: number
}
```

A local in-memory map, browser storage, R2 metadata, or a shared password does not satisfy this requirement.

- [ ] **Step 2: Define the app-to-share management capability issuer.**

The authenticated `APP_ORIGIN` service issues an audience-bound, short-lived, single-purpose proof:

```ts
interface ShareManagementCapability {
  sub: string                 // ownerId
  aud: 'share-management'
  scope: 'create' | 'revoke'
  deviceId: string
  sessionVersion: number
  exp: number
  jti: string
}
```

`SHARE_ORIGIN` verifies issuer, audience, expiry, scope, and device revocation state before any mutation. The capability is sent in an `Authorization` header, never embedded in a public URL.

- [ ] **Step 3: Define the local microVM image lifecycle.**

Record image digest, signature verification key, guest OS/runtime versions, network-off default, mount protocol, CPU/RAM/process/time enforcement mechanism, and host-platform backends. On macOS the runner uses an actual Virtualization.framework guest; it does not use `sandbox-exec` as a production security boundary.

- [ ] **Step 4: Obtain security-owner approval for the recorded facts.**

Expected result: a reviewable contract identifies the durable server state and microVM image provenance. Do not begin Increment C, D, E, or F without it.

---

## Increment A — Remote TLS trust

### Task 1: Persist origin-scoped remote TLS trust

**Files:**
- Modify: `packages/core/src/types/workspace.ts:15-22`
- Modify: `packages/shared/src/config/storage.ts:913-933,1531-1555`
- Modify: `packages/shared/src/config/__tests__/remote-server-ssh-persistence.test.ts`
- Create: `packages/shared/src/config/remote-tls-trust.ts`
- Test: `packages/shared/src/config/__tests__/remote-tls-trust.test.ts`

**Interfaces:**
- Consumes: `RemoteServerConfig` persistence.
- Produces:

```ts
export type RemoteTlsTrust =
  | { mode: 'public-ca' }
  | { mode: 'spki-pin'; origin: string; spkiSha256: string; enrolledAt: number }

export function normalizeRemoteTlsTrust(
  remote: RemoteServerConfig,
): RemoteTlsTrust
```

- [ ] **Step 1: Write persistence tests first.**

Cover default legacy `wss://` records returning `{ mode: 'public-ca' }`, a matching canonical `wss://host:port` SPKI record surviving `saveConfig()`/reload, and a pin whose `origin` does not equal the remote URL origin being rejected by normalization.

- [ ] **Step 2: Add `tlsTrust?: RemoteTlsTrust` to `RemoteServerConfig`.**

Keep `sshHostId` semantics unchanged. Normalize legacy records to public-CA; reject `spki-pin` for `ws://` and reject malformed/non-base64 SHA-256 input before persistence.

- [ ] **Step 3: Preserve the trust field through workspace updates.**

`updateWorkspaceRemoteServer()` merges an intentional re-enrollment record but must not remove a stored pin merely because a reconnect update provides URL/token/workspace ID only.

- [ ] **Step 4: Run focused tests.**

Run: `bun test packages/shared/src/config/__tests__/remote-server-ssh-persistence.test.ts packages/shared/src/config/__tests__/remote-tls-trust.test.ts`

Expected: existing SSH persistence and new canonical-origin/pin round-trip cases pass.

- [ ] **Step 5: Commit the persistence boundary.**

```bash
git add packages/core/src/types/workspace.ts packages/shared/src/config/storage.ts packages/shared/src/config/remote-tls-trust.ts packages/shared/src/config/__tests__
git commit -m "feat: persist remote TLS trust pins"
```

### Task 2: Gate handshake transmission on verified peer identity

**Files:**
- Modify: `packages/server-core/src/transport/client.ts:95-110,164-179,347-362,424-520`
- Modify: `packages/server-core/src/transport/__tests__/server-lifecycle.test.ts`
- Create: `packages/server-core/src/transport/peer-trust.ts`
- Test: `packages/server-core/src/transport/__tests__/peer-trust.test.ts`

**Interfaces:**
- Consumes: `RemoteTlsTrust` from Task 1.
- Produces:

```ts
export type PeerTrustVerifier = (input: {
  url: string
  socket: WebSocket
}) => Promise<void>

export interface WsRpcClientOptions {
  peerTrustVerifier?: PeerTrustVerifier
}
```

- [ ] **Step 1: Write a trust-verifier unit test using injected certificate extraction.**

Prove that a public-CA connection does not activate a relaxed TLS option, a matching SPKI pin resolves before handshake, and a mismatched pin rejects before `trySendEnvelope()` observes a token-bearing handshake.

- [ ] **Step 2: Implement peer certificate extraction only in the Node/Electron `ws` path.**

Use `crypto.X509Certificate` and export the peer public key as DER SPKI, then SHA-256 and base64 it. Browser `WebSocket` may only use public-CA trust and MUST reject a configured `spki-pin` with a typed unsupported-runtime error.

- [ ] **Step 3: Await trust verification in `openSocket()` before constructing/sending the handshake.**

Make the open handler asynchronous. On verifier failure, set a `TransportConnectionError` with code `TLS_TRUST_REJECTED`, fail readiness, close the socket, and let reconnect policy obey the existing state machine. Do not call `trySendEnvelope()` first.

- [ ] **Step 4: Remove the `tlsRejectUnauthorized: false` escape hatch.**

Delete the option and the `createWebSocket()` branch that passes `{ rejectUnauthorized: false }`. A self-signed remote uses an explicit pin verifier; all unauthorised certificates remain connection failures.

- [ ] **Step 5: Run focused transport tests.**

Run: `bun test packages/server-core/src/transport/__tests__/peer-trust.test.ts packages/server-core/src/transport/__tests__/server-lifecycle.test.ts`

Expected: no-token-before-verification and existing handshake behavior pass.

### Task 3: Route Electron remote connections through the trust policy

**Files:**
- Modify: `apps/electron/src/preload/bootstrap.ts:125-168`
- Modify: `apps/electron/src/main/handlers/workspace.ts:23-55`
- Modify: `apps/electron/src/main/index.ts:266-287`
- Create: `apps/electron/src/main/remote-tls-enrollment.ts`
- Test: `apps/electron/src/main/__tests__/remote-tls-enrollment.test.ts`
- Test: `apps/electron/src/transport/__tests__/routed-client.test.ts`

**Interfaces:**
- Consumes: `RemoteTlsTrust`, `PeerTrustVerifier`, and `updateWorkspaceRemoteServer()`.
- Produces:

```ts
export interface RemoteTlsEnrollmentResult {
  origin: string
  spkiSha256: string
  expiresAt: number
}
export async function inspectRemoteTlsPeer(url: string): Promise<RemoteTlsEnrollmentResult>
```

- [ ] **Step 1: Test enrollment and rollover decisions.**

Verify inspection sends no RPC handshake token, acceptance persists exactly the inspected origin/pin, rejection persists nothing, and a changed pin requires a second explicit decision.

- [ ] **Step 2: Implement main-process certificate inspection.**

Use a token-free TLS probe in the main process; return origin/fingerprint/expiry through a narrow IPC API. Keep user confirmation in the renderer; main receives only accept/reject plus the inspection nonce and verifies it has not expired or changed.

- [ ] **Step 3: Construct remote clients with `peerTrustVerifier`.**

In `makeRemoteClient()` and `connectToRemote()`, derive trust from `remote.tlsTrust`; delete both current `tlsRejectUnauthorized: false` arguments. SSH-backed connections continue to use their local `ws://127.0.0.1` tunnel and never invoke remote TLS enrollment.

- [ ] **Step 4: Remove global Electron certificate bypass.**

`apps/electron/src/main/index.ts` must no longer accept every certificate matching `CRAFT_SERVER_URL`. Replace it with the same pin-verifier path or remove the listener for direct remote workspaces.

- [ ] **Step 5: Run focused Electron tests and smoke the route.**

Run: `bun test apps/electron/src/main/__tests__/remote-tls-enrollment.test.ts apps/electron/src/transport/__tests__/routed-client.test.ts apps/electron/src/main/__tests__/ssh-tunnel.test.ts`

Smoke: connect to a local test WSS endpoint with a public-CA-equivalent trusted certificate; confirm a mismatched pin reaches `TLS_TRUST_REJECTED` and emits no server handshake.

---

## Increment B — Public messaging authority

### Task 4: Replace open defaults with explicit public-inbox and owner-control modes

**Files:**
- Modify: `packages/messaging-gateway/src/types.ts:329-500`
- Modify: `packages/messaging-gateway/src/access-control.ts:31-135`
- Modify: `packages/messaging-gateway/src/binding-store.ts`
- Modify: `packages/server-core/src/handlers/messaging-registry-interface.ts:22-104,288-290`
- Test: `packages/messaging-gateway/src/__tests__/access-control.test.ts`
- Test: `packages/messaging-gateway/src/__tests__/binding-store.test.ts`

**Interfaces:**
- Consumes: persisted binding/config records.
- Produces:

```ts
export type MessagingAccessMode = 'public-inbox' | 'owner-control' | 'disabled'
export type AccessDecision =
  | { kind: 'route' }
  | { kind: 'public-inbox' }
  | { kind: 'reject'; reason: 'bot-sender' | 'not-owner' | 'not-allowlisted' | 'disabled' }
```

- [ ] **Step 1: Write migration tests.**

Test every legacy missing/open/inherit mode normalizes to `public-inbox`, not owner control; test all platform types, not only Telegram.

- [ ] **Step 2: Add the new discriminated access mode to gateway and RPC types.**

Remove `open` from new binding creation. Preserve legacy records only long enough to normalize them during load; the persisted write format contains the new explicit mode.

- [ ] **Step 3: Make `evaluatePreBindingAccess()` and `evaluateBindingAccess()` return routing categories.**

Only `owner-control` plus an owner/allowlisted sender returns `{ kind: 'route' }`. `public-inbox` returns a non-executing category. Bot senders remain silent drop.

- [ ] **Step 4: Run evaluator and storage tests.**

Run: `bun test packages/messaging-gateway/src/__tests__/access-control.test.ts packages/messaging-gateway/src/__tests__/binding-store.test.ts`

Expected: legacy migration cannot make an unknown sender tool-capable.

### Task 5: Enforce public-inbox before sessions and tools

**Files:**
- Modify: `packages/messaging-gateway/src/router.ts:74-210`
- Modify: `packages/messaging-gateway/src/commands.ts`
- Modify: `packages/messaging-gateway/src/pending-senders.ts`
- Test: `packages/messaging-gateway/src/__tests__/router-access.test.ts`
- Test: `packages/messaging-gateway/src/__tests__/commands-access.test.ts`
- Test: `packages/messaging-gateway/src/pairing.test.ts`

**Interfaces:**
- Consumes: `AccessDecision` from Task 4.
- Produces: a static public-inbox response and pending pairing record; neither carries a session ID or model invocation.

- [ ] **Step 1: Add router regressions for unknown senders.**

Assert `sessionManager.sendMessage` and `commands.handle` are both uncalled for `public-inbox`; assert one static pairing response and a pending record are produced. Assert rejected owner-control traffic neither calls the model nor creates a session.

- [ ] **Step 2: Replace direct routing branches with decision handling.**

Handle `route`, `public-inbox`, and `reject` explicitly in `Router.route()` and pre-binding command entrypoints. Keep `executeRejection()` only for rejected owner-control access; it must not become an LLM-backed response.

- [ ] **Step 3: Bind pairing approval to exact sender/platform/workspace.**

Reuse `PairingCodeManager.canConsume()` for consume-side limits. Approval must persist a specific sender ID in `allowedSenderIds`; it MUST NOT toggle a platform-wide open mode.

- [ ] **Step 4: Run gateway focused tests.**

Run: `bun test packages/messaging-gateway/src/__tests__/router-access.test.ts packages/messaging-gateway/src/__tests__/commands-access.test.ts packages/messaging-gateway/src/pairing.test.ts`

### Task 6: Migrate the messaging settings UI without recreating an open-control path

**Files:**
- Modify: `apps/electron/src/renderer/atoms/messaging.ts:20-30`
- Modify: `apps/electron/src/renderer/pages/settings/MessagingSettingsPage.tsx:280-310,560-610`
- Modify: `apps/electron/src/renderer/components/messaging/access/AccessModeBanner.tsx`
- Modify: `apps/electron/src/renderer/components/messaging/access/BindingAllowListPopover.tsx`
- Modify: `apps/electron/src/renderer/playground/mock-utils.ts:39-72`
- Test: `apps/electron/src/renderer/pages/settings/__tests__/MessagingSettingsPage.test.ts` (create if the current tree has no matching focused test)

**Interfaces:**
- Consumes: `MessagingAccessMode` and pending-sender records.
- Produces: UI controls labelled `Public inbox`, `Owner control`, and `Disabled`; the public path is visibly non-executing.

- [ ] **Step 1: Add UI state tests.**

Assert public-inbox copy does not claim that messages run in an agent session; owner-control disables save until at least one allowed sender is selected; disabled binding removes routing.

- [ ] **Step 2: Replace `open`/`inherit` labels in renderer types and conversion helpers.**

The settings default is `public-inbox`. Remove controls that silently create an `open` binding.

- [ ] **Step 3: Render pending sender approval as a narrow allowlist mutation.**

Approve one exact observed sender ID, leave the binding in owner-control, and display a one-line audit reason. Do not add a broad “unlock all” action.

- [ ] **Step 4: Run UI tests and focused gateway tests.**

Run: `bun test apps/electron/src/renderer/pages/settings/__tests__/MessagingSettingsPage.test.ts packages/messaging-gateway/src/__tests__/router-access.test.ts`

---

## Increment C — Sandbox execution

### Task 7: Introduce a runtime-neutral sandbox contract

**Files:**
- Create: `packages/session-tools-core/src/runtime/sandbox-execution.ts`
- Modify: `packages/session-tools-core/src/context.ts`
- Modify: `packages/session-tools-core/src/handlers/script-sandbox.ts:13-212`
- Modify: `packages/session-tools-core/src/handlers/transform-data.ts:64-170`
- Test: `packages/session-tools-core/src/runtime/sandbox-execution.test.ts`

**Interfaces:**
- Consumes: a Gate 0-provisioned microVM backend.
- Produces:

```ts
export interface SandboxExecutionRequest {
  language: 'python3' | 'node' | 'bun'
  script: string
  readOnlyInputs: readonly string[]
  writableOutputDir: string
  stdin?: string
  limits: { timeoutMs: number; maxMemoryMiB: number; maxProcesses: number }
}
export interface SandboxExecutionResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  audit: { backend: 'microvm'; imageDigest: string; network: 'deny' }
}
export interface SandboxExecutionRunner {
  isAvailable(): Promise<boolean>
  execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult>
}
```

- [ ] **Step 1: Write contract tests with a fake `SandboxExecutionRunner`.**

Cover input/output mapping, no implicit host environment, unavailable runner response, output truncation, and propagation of guest timeout/resource failures.

- [ ] **Step 2: Add the runner dependency to `SessionToolContext`.**

Make it optional only during migration. Safe/Explore call paths must receive an unavailable result rather than fall back to host `spawn()`.

- [ ] **Step 3: Rewrite `script_sandbox` as a runner client.**

Delete calls to `applyNetworkIsolation()` and `applyFilesystemIsolation()` from the execution path. Preserve script/input validation, but pass the resulting approved paths to the runner as mounts.

- [ ] **Step 4: Delete deprecated `sandbox-exec` policy assertions.**

Remove `filesystem-isolation.ts` and `filesystem-isolation.test.ts` only after all production imports are removed. The new tests assert guest-level contract outcomes, not profile-string contents.

- [ ] **Step 5: Run focused unit tests.**

Run: `bun test packages/session-tools-core/src/runtime/sandbox-execution.test.ts packages/session-tools-core/src/handlers/script-sandbox.test.ts`

### Task 8: Implement the Gate 0 local-microVM adapter and acceptance tests

**Files:**
- Create: `packages/session-tools-core/src/runtime/microvm-runner.ts`
- Create: `packages/session-tools-core/src/runtime/microvm-image-verifier.ts`
- Create: `packages/session-tools-core/src/runtime/__tests__/microvm-runner.test.ts`
- Create: `packages/session-tools-core/src/runtime/__tests__/microvm-acceptance.isolated.ts`
- Modify: platform-specific packaging/build configuration identified in Gate 0.

**Interfaces:**
- Consumes: signed image digest and host backend selected in Gate 0.
- Produces: `SandboxExecutionRunner` with `backend: 'microvm'` only after image signature/digest validation.

- [ ] **Step 1: Write host-independent fake-backend tests.**

Test refusal on unsigned/wrong-digest image, mount plan creation, and audit record contents without launching a guest.

- [ ] **Step 2: Implement digest/signature validation before guest start.**

The adapter receives an immutable image path and expected digest. It verifies before mounting any user file and returns a typed unavailable/error result on mismatch.

- [ ] **Step 3: Implement the selected platform backend.**

On macOS launch the provisioned Virtualization.framework guest. The guest receives only declared read-only input shares and a writable output share, starts without network, and receives cgroup/guest limits from `SandboxExecutionRequest`.

- [ ] **Step 4: Add isolated acceptance cases.**

In a real guest, attempt access to `~/.ssh`, Keychain, Docker socket, browser-debug socket, host home, and network; each must fail. Confirm declared input is readable, declared output is writable, and resource limits terminate the guest process.

- [ ] **Step 5: Run unit plus isolated acceptance test on the supported host.**

Run: `bun test packages/session-tools-core/src/runtime/__tests__/microvm-runner.test.ts && bun test packages/session-tools-core/src/runtime/__tests__/microvm-acceptance.isolated.ts`

Expected: the acceptance run demonstrates actual guest isolation; a skipped/unavailable backend is not a pass for a release candidate.

### Task 9: Add the `transform_data` owner-approval bridge

**Files:**
- Modify: `packages/session-tools-core/src/tool-defs.ts:579-594`
- Modify: `packages/shared/src/agent/mode-manager.ts:1885-1963`
- Modify: `packages/session-tools-core/src/handlers/transform-data.ts:64-170`
- Modify: approval IPC/UI files identified by references to `onAuthRequest`
- Test: `packages/session-tools-core/src/handlers/transform-data.test.ts`
- Test: `packages/shared/src/agent/__tests__/mode-manager-path-boundary.test.ts`

**Interfaces:**
- Consumes: `SandboxExecutionRunner` and existing session auth-request callback.
- Produces: `TransformDataApproval { language, inputFiles, outputFile, scriptSummary }`.

- [ ] **Step 1: Add approval-path tests.**

Assert Safe/Explore `transform_data` returns an approval request before child process creation; reject/cancel leaves no temporary script or output; approved host bridge is available only while no microVM runner exists.

- [ ] **Step 2: Classify `transform_data` as confirmation-required until runner availability.**

Change the canonical tool policy from unconditional `safeMode: 'allow'` to a handler-level decision that checks mode plus runner availability. Do not use Bash parsing as the permission decision.

- [ ] **Step 3: Replace direct host spawn with runner-or-approved bridge.**

When a microVM is available, use Task 7 runner. When it is unavailable, invoke the explicit owner approval callback; on approval, preserve existing bounded host execution only for the current local owner session.

- [ ] **Step 4: Run bridge tests.**

Run: `bun test packages/session-tools-core/src/handlers/transform-data.test.ts packages/shared/src/agent/__tests__/mode-manager-path-boundary.test.ts`

---

## Increment D — External WebUI device authority

### Task 10: Add durable device/session authority behind a repository interface

**Files:**
- Create: `packages/server-core/src/webui/device-store.ts`
- Create: `packages/server-core/src/webui/device-auth.ts`
- Modify: `packages/server-core/src/webui/auth.ts:16-88,177-188`
- Modify: `packages/server-core/src/webui/http-server.ts:113-161`
- Test: `packages/server-core/src/webui/__tests__/device-store.test.ts`
- Test: `packages/server-core/src/webui/__tests__/device-auth.test.ts`

**Interfaces:**
- Consumes: Gate 0 datastore adapter.
- Produces:

```ts
export interface DeviceStore {
  get(deviceId: string): Promise<DeviceRecord | null>
  create(record: DeviceRecord): Promise<void>
  revoke(deviceId: string, ownerId: string): Promise<DeviceRecord | null>
  touch(deviceId: string, now: number): Promise<void>
}
export interface WebuiJwtPayload extends JwtPayload {
  deviceId: string
  sessionVersion: number
}
```

- [ ] **Step 1: Write store and session-version tests.**

Verify a stale `sessionVersion` and revoked device fail session validation even with a valid signature; verify revoke atomically increments version and preserves audit facts.

- [ ] **Step 2: Extend JWT creation and validation.**

Use `__Host-craft_session` as the cookie name. Include only `sub`, `deviceId`, `sessionVersion`, `iat`, and `exp`; do not put WebAuthn credential material or recovery codes in JWT claims.

- [ ] **Step 3: Implement `DeviceStore` against the Gate 0 durable store.**

Conditional updates must prevent simultaneous pairing/revoke races. Test using the adapter’s transactional semantics, not a process-local map.

- [ ] **Step 4: Run device authority tests.**

Run: `bun test packages/server-core/src/webui/__tests__/device-store.test.ts packages/server-core/src/webui/__tests__/device-auth.test.ts`

### Task 11: Implement QR bootstrapping and WebAuthn registration/login

**Files:**
- Create: `packages/server-core/src/webui/pairing.ts`
- Modify: `packages/server-core/src/webui/http-server.ts:202-405`
- Modify: `apps/webui/src/adapter/web-api.ts:50-160`
- Create: `apps/webui/src/auth/device-pairing.ts`
- Test: `packages/server-core/src/webui/__tests__/pairing.test.ts`
- Test: `apps/webui/src/auth/device-pairing.test.ts`

**Interfaces:**
- Consumes: `DeviceStore` from Task 10.
- Produces endpoints:

```text
POST /api/devices/pairing-requests
POST /api/devices/pairing-requests/:id/attest
POST /api/devices/pairing-requests/:id/confirm
POST /api/auth/webauthn/assertion
POST /api/devices/:deviceId/revoke
```

- [ ] **Step 1: Write pairing state-machine tests.**

Test one-time request consumption, five-minute expiry, replay rejection, mismatched confirmation code rejection, explicit reject, successful registration, and audit event emission.

- [ ] **Step 2: Implement server-side WebAuthn challenge lifecycle.**

Store challenges server-side with request ID, origin, RP ID, expiry, and one-time state. Verify challenge, origin, RP ID, credential ownership, and signature before creating a `DeviceRecord`.

- [ ] **Step 3: Implement browser pairing UI with platform WebAuthn.**

The QR contains only a random pairing request identifier and expiry-bound nonce. Browser creates a platform credential through `navigator.credentials.create`; no private key, long-lived bearer token, or recovery code is copied into JavaScript storage.

- [ ] **Step 4: Run server and browser tests.**

Run: `bun test packages/server-core/src/webui/__tests__/pairing.test.ts && bun test apps/webui/src/auth/device-pairing.test.ts`

### Task 12: Lock down proxy, cookie, origin, and active WebSocket revoke paths

**Files:**
- Modify: `packages/server-core/src/webui/auth.ts:56-88,123-174`
- Modify: `packages/server-core/src/webui/http-server.ts:53-107,169-405`
- Modify: `packages/server-core/src/transport/server.ts:431-511`
- Modify: `packages/server-core/src/bootstrap/headless-start.ts:415-440`
- Modify: `packages/server/src/index.ts:328-355`
- Test: `packages/server-core/src/webui/__tests__/http-server.test.ts`
- Test: `packages/server-core/src/transport/__tests__/server-lifecycle.test.ts`

**Interfaces:**
- Consumes: `validateSession()` returning device-aware payload.
- Produces:

```ts
validateSessionCookie(cookie: string | null): Promise<boolean>
validateWebSocketOrigin(origin: string | null, expectedOrigin: string): boolean
closeConnectionsForDevice(deviceId: string, reason: 'device-revoked'): void
```

- [ ] **Step 1: Add security regressions.**

Assert exact `__Host-` cookie attributes, HTTPS-only external mode, no wildcard CORS, spoofed forwarded headers ignored unless the immediate peer is a configured proxy, foreign WebSocket `Origin` rejected before handshake, and revoking a device closes its socket.

- [ ] **Step 2: Remove global rate-limit denial.**

`RateLimiter` remains per client identity/IP with bounded cleanup. Eliminate `maxGlobalAttempts` behavior that can lock out all owners from unrelated failed requests.

- [ ] **Step 3: Bind WebSocket identity to the validated cookie session.**

Store device ID on the connected client after cookie authentication. Do not allow a bearer token connection to masquerade as a browser device; only browser-origin upgrades participate in device-revoke closing.

- [ ] **Step 4: Fail closed on non-local insecure WebUI deployment.**

Current `--allow-insecure-bind` remains a local explicit development escape only. Production config requires proxy/TLS origin values, secure cookies, trusted proxy list, and backend network isolation.

- [ ] **Step 5: Run focused WebUI and transport tests.**

Run: `bun test packages/server-core/src/webui/__tests__/http-server.test.ts packages/server-core/src/webui/__tests__/oauth-callback.test.ts packages/server-core/src/transport/__tests__/server-lifecycle.test.ts`

---

## Increment E — Owner-authenticated immutable shares

### Task 13: Move public reader to an immutable 30-day read-only surface

**Files:**
- Modify: `apps/viewer/functions/s/api.ts:1-54`
- Modify: `apps/viewer/functions/s/api/[id].ts:1-66`
- Modify: `apps/viewer/wrangler.toml:1-12`
- Create: `apps/viewer/functions/s/api/share-policy.ts`
- Test: `apps/viewer/functions/s/api/share-policy.test.ts`

**Interfaces:**
- Consumes: verified management capability from Task 14.
- Produces:

```ts
interface ShareMetadata {
  ownerId: string
  createdAt: number
  expiresAt: number
  revokedAt?: number
  schemaVersion: 1
}
function isReadableShare(metadata: ShareMetadata, now: number): boolean
```

- [ ] **Step 1: Write policy tests.**

Cover creation with `expiresAt === createdAt + 30 * 24 * 60 * 60 * 1000`, existing/expired/revoked object yielding generic `404`, and immutable API rejecting `PUT` with no storage mutation.

- [ ] **Step 2: Remove anonymous create/update/delete from the public API.**

`onRequestPost`, `onRequestPut`, and `onRequestDelete` must not accept public browser requests. Public `GET` returns only a non-expired, non-revoked object and uses `Referrer-Policy: no-referrer`; it has no CORS mutation methods.

- [ ] **Step 3: Add legacy object read policy.**

Read `createdAt` metadata when valid. If it is absent or invalid, calculate expiry as the deployment cutover deadline supplied by a non-secret environment variable. Never invent `ownerId` for a legacy object.

- [ ] **Step 4: Run Pages function policy tests.**

Run: `bun test apps/viewer/functions/s/api/share-policy.test.ts`

### Task 14: Add authenticated share-management endpoints and capability verification

**Files:**
- Create: `packages/server-core/src/webui/share-management.ts`
- Modify: `packages/server-core/src/webui/http-server.ts:202-405`
- Create: `apps/viewer/functions/s/api/management.ts`
- Modify: `apps/viewer/wrangler.toml`
- Test: `packages/server-core/src/webui/__tests__/share-management.test.ts`
- Test: `apps/viewer/functions/s/api/management.test.ts`

**Interfaces:**
- Consumes: device-auth session and Gate 0 capability issuer.
- Produces:

```text
POST APP_ORIGIN/api/shares/capabilities   → short-lived create/revoke capability
POST SHARE_ORIGIN/s/api/management        → immutable create
DELETE SHARE_ORIGIN/s/api/management/:id  → owner-only revoke
```

- [ ] **Step 1: Write authorization tests.**

Assert anonymous capability issuance returns `401`; a revoked device cannot mint; wrong audience/scope/expired capability returns generic `404` from share management; a different owner cannot revoke; capability never appears in the returned public URL.

- [ ] **Step 2: Implement device-session-gated capability issuance.**

Issue only after Task 10 validation. Bind `ownerId`, `deviceId`, current `sessionVersion`, audience, scope, expiry, and unique token ID. Record issuance/revocation audit facts without request payload.

- [ ] **Step 3: Verify capability at `SHARE_ORIGIN`.**

Use the Gate 0 public verification material. Reject unless signature, issuer, audience, expiry, scope, session version, and device status are valid. Perform owner check before `R2.delete()`.

- [ ] **Step 4: Run authenticated-share tests.**

Run: `bun test packages/server-core/src/webui/__tests__/share-management.test.ts apps/viewer/functions/s/api/management.test.ts`

### Task 15: Cut desktop session sharing over to immutable management operations

**Files:**
- Modify: `packages/server-core/src/sessions/SessionManager.ts:5591-5700`
- Modify: `packages/shared/src/sessions/storage.ts:549-575`
- Modify: `packages/shared/src/protocol/dto.ts:82-84,436-439`
- Modify: `apps/electron/src/renderer/hooks/useSessionMenuActions.ts:171-190`
- Modify: `apps/electron/src/renderer/pages/ChatPage.tsx:725-803`
- Test: `packages/server-core/src/sessions/session-sharing.test.ts` (create)

**Interfaces:**
- Consumes: `POST /api/shares/capabilities` and `POST|DELETE /s/api/management`.
- Produces: `sharedUrl`, `sharedId`, and immutable `expiresAt` displayed to the owner; no update-share command.

- [ ] **Step 1: Write session-manager request tests.**

Assert share creates a capability then creates exactly one snapshot; update is absent; revoke sends an authenticated management delete; failed create/revoke leaves local metadata unchanged.

- [ ] **Step 2: Replace `updateShare()` with immutable lifecycle actions.**

Delete the `PUT ${VIEWER_URL}/s/api/${id}` path. A changed session requires creating a new share; the old share remains until expiry or explicit revoke.

- [ ] **Step 3: Persist and display expiry.**

Extend session metadata with `sharedExpiresAt`; copy/open UI labels must state the expiry. Clear all three share fields only after confirmed revoke.

- [ ] **Step 4: Run share unit tests.**

Run: `bun test packages/server-core/src/sessions/session-sharing.test.ts`

---

## Increment F — CI/CD and dependency evidence

### Task 16: Make PR validation secret-free and release jobs explicitly protected

**Files:**
- Modify: `.circleci/config.yml:12-93`
- Modify: `.github/workflows/ci.yml:1-19`
- Modify: `.github/workflows/toolchain-smoke.yml:1-198`
- Create: `.github/workflows/release.yml`
- Create: `scripts/ci/assert-no-pr-secrets.ts`
- Test: `scripts/ci/assert-no-pr-secrets.test.ts`

**Interfaces:**
- Consumes: rotated credentials delivered only by the Gate 0 secret authority.
- Produces: one PR-safe validation workflow and distinct protected deploy/macOS-release workflows.

- [ ] **Step 1: Write workflow-policy tests.**

Parse workflow YAML and fail when a pull-request-reachable job references deploy/signing/cloud secret names, a self-hosted label without trust classification, or an unpinned action SHA where repository policy requires a SHA.

- [ ] **Step 2: Remove `GITHUB_TOKEN` injection from unneeded install steps.**

`bun install --frozen-lockfile` gets no token unless a documented private-package registry requires a narrowly scoped read token in a protected non-fork context.

- [ ] **Step 3: Split deployment from CircleCI smoke.**

Keep `toolchain-smoke-linux` secret-free. Move `craft-gateway-deploy` behind protected main/manual approval and short-lived Cloudflare credentials. Do not schedule a privileged deploy before branch protection and credential rotation are in place.

- [ ] **Step 4: Define the macOS release executor contract.**

The release workflow runs only on a disposable managed macOS executor selected in Gate 0. It receives signing/notarization credentials only in the protected release job and removes them at job end. Existing self-hosted `macos-toolchain` is not accepted as a signing boundary.

- [ ] **Step 5: Run policy tests and CI config syntax validation.**

Run: `bun test scripts/ci/assert-no-pr-secrets.test.ts && bun scripts/ci/assert-no-pr-secrets.ts`

### Task 17: Add reachable-dependency triage evidence before promotion

**Files:**
- Create: `scripts/security/dependency-triage.ts`
- Create: `security/dependency-exceptions.json`
- Create: `scripts/security/dependency-triage.test.ts`
- Modify: `.circleci/config.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: lockfile audit output and exception records.
- Produces:

```ts
interface DependencyException {
  advisoryId: string
  packageName: string
  lockedVersion: string
  dependencyPath: string
  runtimeClass: 'production' | 'build' | 'test' | 'dev-only'
  reachability: 'reachable' | 'unreachable'
  rationale: string
  owner: string
  reviewBy: string
}
```

- [ ] **Step 1: Write evidence-schema tests.**

Reject missing owner/review date/dependency path/rationale; reject `reviewBy` in the past; reject an exception that labels a production reachable high/critical advisory as non-blocking.

- [ ] **Step 2: Implement deterministic triage validation.**

Read machine audit output plus checked-in exception records. Produce a JSON artifact naming advisory, package, lockfile path, classification, and decision. It must not run bulk updates or mutate the lockfile.

- [ ] **Step 3: Wire CI behavior.**

PR validation uploads triage evidence. Release/deploy fails only when an unmitigated reachable critical/high issue remains. Lower or proven unreachable findings remain visible with an expiring exception.

- [ ] **Step 4: Run focused script tests.**

Run: `bun test scripts/security/dependency-triage.test.ts && bun scripts/security/dependency-triage.ts --help`

---

## End-to-end release verification

- [ ] Run each increment’s focused test command before merging its commit.
- [ ] Run `bun run typecheck:all` after an increment changes cross-package TypeScript interfaces.
- [ ] Run `bun run validate:ci` in a clean, non-privileged Linux CI environment after A, B, D, E, and F land together.
- [ ] Run microVM acceptance tests on every supported host platform; fail release promotion if any required backend is unavailable.
- [ ] Smoke external WebUI through the configured HTTPS/WSS reverse proxy: passkey login, pairing, cross-origin WebSocket rejection, device revoke, public share create/read/revoke/expiry.
- [ ] Record immutable artifact identifiers, target smoke result, and rollback reference in the protected deployment audit trail.

## Plan self-review

**Spec coverage:** Tasks 1–3 cover strict TLS/SPKI; 4–6 messaging ownership; 7–9 microVM and `transform_data`; 10–12 device pairing/WebUI perimeter; 13–15 immutable shares and legacy handling; 16–17 CI/CD and dependency triage. Gate 0 covers the deployment and image facts the repository does not currently contain.

**Consistency:** `RemoteTlsTrust`, `PeerTrustVerifier`, `SandboxExecutionRunner`, `DeviceStore`, `ShareManagementCapability`, and `DependencyException` are introduced before their consumers. Shares depend on device authority; this corrects execution ordering without weakening the approved owner-authenticated share contract.

**No placeholder scan:** The plan contains no deferred code marker. Gate 0 is an explicit, verifiable prerequisite for external infrastructure and the local microVM image, not an implementation substitute.
