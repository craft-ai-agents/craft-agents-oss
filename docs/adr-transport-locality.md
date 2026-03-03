# ADR: Transport Locality & Bidirectional RPC

**Status:** Accepted
**Date:** 2026-03-03

## Context

The WS RPC transport currently supports unidirectional communication: client→server requests and server→client push events. Some operations (browser open, OS interactions) must execute on the client's machine, not the server host. This is invisible when both run locally in Electron, but breaks in remote/headless topologies.

This ADR freezes terminology and contracts before implementing bidirectional RPC.

## Definitions

### Capability

A **capability** is a client-executed action registered during the WS handshake.

- Clients advertise capabilities as `clientCapabilities: string[]` in the handshake envelope.
- The server stores capabilities per `clientId`.
- The server can invoke a capability via `invokeClient()`.
- Initial capability set: `client:openExternal`.

### Locality Boundary

The **locality boundary** separates server-host and client-host execution:

| Side | Owns | Examples |
|------|------|----------|
| **Server-host** | Storage, token exchange, session mutation, credential management | `prepareOAuth()`, `exchangeAndStore()`, session CRUD |
| **Client-host** | Browser open, OS interactions requiring the user's machine | `shell.openExternal()`, callback server for OAuth |

Code that crosses this boundary must use `invokeClient()` (server→client) or `invoke()` (client→server). Direct imports across the boundary (e.g., server importing `shell.openExternal`) are incorrect in remote topologies.

### `invokeClient` Contract

`server.invokeClient(clientId, channel, ...args): Promise<any>`

Sends a typed request to a specific client and awaits a response. Semantics:

1. **Capability check** — Before sending, the server checks if the client advertised the capability. If not → immediate `CAPABILITY_UNAVAILABLE` error. No timeout wait.
2. **Connection check** — If the client is disconnected → immediate `CLIENT_DISCONNECTED` error.
3. **Correlation** — Uses the same `request`/`response` `MessageType` values as client→server RPC. Direction is implicit based on sender.
4. **Timeout** — Only applies to in-flight requests where the client is connected but does not respond → `CLIENT_REQUEST_TIMEOUT`.
5. **Disconnect cleanup** — When a client disconnects, all pending server→client requests for that client are rejected with `CLIENT_DISCONNECTED`.

### Error Codes

| Code | Trigger | Timeout involved? |
|------|---------|-------------------|
| `CAPABILITY_UNAVAILABLE` | Client lacks the requested capability | No — immediate |
| `CLIENT_DISCONNECTED` | Client is not connected (or disconnects mid-flight) | No — immediate |
| `CLIENT_REQUEST_TIMEOUT` | Client is connected but did not respond in time | Yes |

### Fallback Matrix

When a capability is unavailable, the server returns a structured error. The handler decides fallback behavior:

| Scenario | Server behavior | Client/UI behavior |
|----------|----------------|-------------------|
| OAuth browser-open unavailable | Return `{ error: 'CAPABILITY_UNAVAILABLE', authUrl }` to caller | UI shows manual "copy link / open" action |
| General capability unavailable | Return structured error to handler | Handler decides fallback per use case |

Silent failure is not acceptable. All capability invocations must produce either a result or a structured error.

## Message Flow

```
Client                          Server
  │                                │
  ├─ handshake ────────────────►   │  clientCapabilities: ['client:openExternal']
  │                                │
  │   ◄──────────────── handshake_ack  (stores capabilities per clientId)
  │                                │
  │  ... normal RPC ...            │
  │                                │
  │   ◄──── request (invokeClient) │  channel: 'client:openExternal', args: [url]
  │                                │
  ├─ response ─────────────────►   │  result: true
  │                                │
```

## Decision

Implement bidirectional RPC reusing existing `request`/`response` message types with capability advertisement on handshake. No new envelope types needed.
