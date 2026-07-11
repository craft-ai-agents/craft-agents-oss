# iOS / iPadOS Native Remote Client — Feasibility & Design

**Date:** 2026-07-11
**Status:** Approved (design)
**Related issues:** none yet (new exploration)

## Summary

Explore migrating Craft Agents to iOS/iPadOS. A full on-device port (running
agent execution, MCP servers, and arbitrary tool subprocesses directly on the
device, as the Electron app does today) is **not feasible**: iOS sandboxing
forbids arbitrary subprocess spawning and long-lived background execution,
and the current implementation depends on `child_process`/`spawn` in 26+
files (local MCP stdio servers, tool execution, etc.).

The recommended and approved path is a **native SwiftUI remote client** — a
new, fourth client application (alongside `apps/electron`, `apps/webui`,
`apps/cli`) that talks to the existing headless `packages/server` over its
existing WebSocket-RPC protocol (`packages/shared/src/protocol` +
`packages/server-core/src/transport`). No agent/tool execution logic moves to
the device; the phone/tablet is purely a client.

## Decisions (confirmed with user)

1. **Goal:** Hybrid — primarily a remote client for convenience, with a
   read-only offline cache of session history (no on-device agent execution).
2. **Platform form:** Native SwiftUI app (not a WKWebView wrapper, not React
   Native, not a bare PWA).
3. **Technical approach:** Reimplement the existing WS-RPC protocol natively
   in Swift using `URLSessionWebSocketTask` (not a WKWebView-embedded chat
   view). Full native fidelity over faster short-term delivery.
4. **Server access:** Out of scope for this design — user already has (or
   will separately solve) remote reachability of the server (self-hosted
   VPS / Tailscale / reverse proxy). The app only needs a server URL + token.
5. **Minimum OS version:** iOS 18+.
6. **Offline cache store:** SwiftData.
7. **iPad:** First-class multitasking support (`NavigationSplitView`,
   Stage Manager-friendly scenes) is required, not an afterthought.
8. **Push notifications / APNs wake-up:** Explicitly **out of scope** for
   this design. Because the app cannot keep a WebSocket alive indefinitely
   in the background, server-initiated wake-up requires a new APNs sending
   service on the server plus device-token registration — deferred to a
   future issue.
9. **Sources/MCP management UI:** Out of scope for MVP; remains desktop-only
   for now.

## Non-goals

- Running agent execution, MCP servers, or any subprocess-based tool on the
  device.
- Any change to `packages/server`, `packages/server-core`, or the RPC
  protocol itself. The iOS client is a protocol *consumer* only.
- Push notifications / background wake via APNs (future issue).
- Managing Sources/MCP connections from the iOS app.

## Architecture

```
┌─────────────────────┐        WSS (existing WsRpcServer protocol)       ┌──────────────────────────┐
│  iOS/iPadOS App      │ ───────────────────────────────────────────────▶│ Existing headless server │
│  (SwiftUI, new)      │ ◀─────────────────────────────────────────────  │ (packages/server, unchanged) │
│  - session list/chat │        JWT/token auth + heartbeat + reconnect    │                          │
│  - tool viz/approval │        event replay (existing mechanism)         │                          │
│  - SwiftData cache    │                                                 │                          │
│  - Keychain token     │                                                 │                          │
└─────────────────────┘                                                  └──────────────────────────┘
```

The app is a peer to `apps/webui` from the server's point of view: it
authenticates the same way, uses the same RPC domains, and receives the same
event stream. No server-side code changes are required for the MVP.

## Components

Each component has one job and a clear interface, so it can be built and
tested independently.

| Module | Responsibility | Depends on |
|---|---|---|
| `RPCTransport` | Wraps `URLSessionWebSocketTask`: connect, heartbeat (mirrors server's `HEARTBEAT_INTERVAL_MS`/`HEARTBEAT_MAX_MISSED`), auto-reconnect with backoff, seq-based event replay on reconnect | — |
| `ProtocolCodec` | Encodes/decodes the message envelope; Swift `Codable` models mirroring the TS types in `packages/shared/src/protocol` | `RPCTransport` |
| `RPCClient` | Typed methods for the MVP RPC domains only: `sessions`, `auth`, `tasks`, `files`, `statuses`, `labels`, `system` (subset of the 23 domains under `packages/server-core/src/handlers/rpc/`) | `ProtocolCodec` |
| `SessionStore` (SwiftData) | Local cache of session metadata + message history, for offline read and optimistic UI | `RPCClient` |
| `AuthKeychainStore` | Secure storage of server URL + auth token in Keychain; supports multiple configured servers | — |
| SwiftUI views | `NavigationSplitView` (iPad two/three-column, iPhone collapsed stack), session list, streaming chat view, tool-call visualization cards, permission-approval sheet, attachment picker | `SessionStore`, `RPCClient` |

## Data flow

1. Launch → read server URL/token from Keychain → `RPCTransport` opens the
   WSS connection and completes the auth handshake.
2. On connect, fetch the session list → write to SwiftData → SwiftUI views
   observe via `@Query`/Observation and refresh automatically.
3. Opening a session subscribes to that session's event stream (existing
   push/event mechanism) → each event is appended to SwiftData → the chat
   view renders it as a streaming update (including tool-call cards and
   diffs).
4. Flaky network / disconnect: `RPCTransport` reconnects automatically and
   requests replay from `lastAckedSeq`, reusing the server's existing
   `eventBuffer` replay mechanism — no message loss on reconnect.
5. Fully offline: the UI reads only from the SwiftData cache (read-only). A
   persistent banner indicates "offline — showing cached data"; send/approve/
   new-session actions are disabled (not silently queued).
6. Writes (approve permission, send message, create session) are
   request/response RPC calls; the UI optimistically marks them "pending"
   locally and reconciles on server confirmation.

## Error handling

- Connection state is modeled as an explicit enum (`connected` /
  `reconnecting` / `authFailed` / `unreachable`), driving a single banner
  component — no silent failure states.
- Auth failures route to a re-login screen; transient disconnects
  auto-reconnect with replay; unreachable server shows an explicit retry
  action.
- RPC calls carry timeouts and surface the existing `ErrorCode`/
  `isErrorCode` values as visible, retryable errors (toast/inline), never
  swallowed.
- Offline write attempts are prevented at the UI entry point (disabled
  controls), rather than optimistically accepted and later failed.

## Testing

- `ProtocolCodec` / `RPCTransport`: unit tests using round-trip fixtures
  from `packages/server-core/src/transport/__tests__` to guarantee protocol
  compatibility with the real server.
- `RPCClient`: integration tests against a locally running
  `packages/server` instance (`bun run server:start`) instead of a mock.
- SwiftUI views: snapshot tests for key states (offline banner, permission
  approval card, streaming append).
- Manual acceptance: real device connected to a `bun run server:start`
  instance on the same network, exercising poor connectivity (Network Link
  Conditioner) and foreground/background transitions.

## Phased roadmap

1. **Phase 1 (core usable):** `RPCTransport`/`ProtocolCodec`/`RPCClient`
   infrastructure, auth, session list, streaming chat send/receive (no tool
   visualization polish yet).
2. **Phase 2:** Tool-call visualization, permission-approval interaction,
   attachment upload.
3. **Phase 3:** New session creation / workspace switching, SwiftData
   offline cache and read-only browsing, iPad `NavigationSplitView`
   multitasking polish.
4. **Future issues (explicitly excluded here):** APNs push wake-up (requires
   a new server-side APNs sending service plus a device-token registration
   RPC handler), Sources/MCP management UI, silent background sync.

## Open risks

- App Store review posture for a "connects only to a user-supplied
  self-hosted server" app (similar precedent: Home Assistant, Tailscale) —
  believed low-risk but not yet confirmed against current App Review
  Guidelines.
- Manual TS ↔ Swift protocol type sync: as `packages/shared/src/protocol`
  evolves, the Swift `Codable` models must be kept in sync by hand; no
  code-gen pipeline exists yet. Worth revisiting if protocol churn is high.
