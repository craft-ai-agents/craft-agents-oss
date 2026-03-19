# Thin-Client Mode (External Server)

Electron can run as a **UI-only client** connecting to an external headless server.
In this mode, the Electron process skips all server-side initialization
(SessionManager, model refresh, platform subsystems) and delegates everything
over WebSocket RPC.

## Quick start

### 1. Start the headless server

```bash
bun run packages/server/src/index.ts
```

Output (two lines):

```
CRAFT_SERVER_URL=ws://127.0.0.1:<port>
CRAFT_SERVER_TOKEN=<token>
```

### 2. Start Electron as a thin client

```bash
CRAFT_SERVER_URL=ws://127.0.0.1:<port> \
CRAFT_SERVER_TOKEN=<token> \
bun run electron:dev
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CRAFT_SERVER_URL` | **Yes** | WebSocket URL of the external server (e.g. `ws://127.0.0.1:9222`). Setting this variable activates thin-client mode. |
| `CRAFT_SERVER_TOKEN` | **Yes** | Auth token printed by the headless server on startup. |
| `CRAFT_WORKSPACE_ID` | No | Override the workspace ID for all windows. If omitted, each window derives its workspace from `windowManager`. Useful when the server hosts a single workspace. |

## What gets skipped in thin-client mode

The `isClientOnly` guard in `main/index.ts` skips:

- `SessionManager` creation and initialization
- `setSessionPlatform()`, `setFetcherPlatform()`, `setSearchPlatform()`, `setImageProcessor()`
- `initModelRefreshService()`
- Local `WsRpcServer` creation
- RPC handler registration
- Git bash path restoration
- Credential health checks

## What still runs in thin-client mode

- `WindowManager` — manages Electron BrowserWindows
- `BrowserPaneManager` — embedded browser panes
- Dialog bridge (`__dialog:showMessageBox`, `__dialog:showOpenDialog`)
- `__get-web-contents-id` / `__get-workspace-id` ipc handlers
- Client capabilities (all 5): `client:openExternal`, `client:openPath`, `client:showInFolder`, `client:confirmDialog`, `client:openFileDialog`
- Auto-update, power monitor, notification service

## Transport details

### Connection lifecycle

1. Preload detects `CRAFT_SERVER_URL` → creates `WsRpcClient` pointed at external server.
2. Client sends handshake with `token`, `workspaceId`, `webContentsId`, and `clientCapabilities`.
3. Server validates token and completes handshake.
4. All API calls flow over the single WS connection.

### Auto-reconnect

If the connection drops, the client retries with exponential backoff:
1s → 2s → 4s → 8s → 16s → 30s (cap). Retries are unlimited.

On successful reconnect the backoff counter resets to zero.

### Request timeout

Each RPC call has a 30-second timeout. If the server doesn't respond within
that window, the call rejects with a timeout error.

## Known limitations

- **Static token**: The auth token is fixed at startup. If the server regenerates
  tokens on restart, the client must also be restarted.
- **No connection-ready signal**: The renderer doesn't receive an explicit
  "connected" / "disconnected" event — the first API call simply blocks until
  the connection is ready or times out.
- **Unlimited retries**: The client will retry reconnection forever. There is no
  max-attempt cutoff.

These are acceptable for the current dev/staging use case. Production hardening
(token entropy, connection limits, host binding safety) is being addressed in Phase 5.
