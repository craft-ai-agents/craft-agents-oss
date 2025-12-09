# Craft TUI Agent: Dual-Mode Architecture

## Overview

The Craft TUI Agent supports **two deployment modes**:

| Mode | Description | Use Case |
|------|-------------|----------|
| **Local** | Everything runs on your device (current app) | Development, privacy, offline |
| **Remote** | Server on Modal, thin clients connect | Multi-device, iOS/web clients, team sharing |

Both modes share the same core code via a monorepo structure.

### Local Mode (Current App)
```
bun start                    # Runs everything locally
```
- Agent SDK, MCP, credentials all on your machine
- Credentials in OS keychain (keytar)
- No network dependency (except Anthropic API + MCP servers)

### Remote Mode (Client-Server)
```
bun start --server wss://craft.modal.run    # Connect to remote server
```
- Server on Modal handles SDK, MCP, credentials
- Thin client just renders UI
- Enables iOS, web, multi-device access

### Design Principles

1. **Same core logic** - Agent, MCP, OAuth code shared between modes
2. **Swappable credential backend** - Keychain (local) or Modal Secrets (remote)
3. **Protocol abstraction** - Local mode uses direct calls, remote uses WebSocket
4. **Minimal client for remote** - Just WebSocket + UI rendering

---

## Dual-Mode Architecture Diagrams

### Local Mode (Current App Style)

Everything runs in a single process on your device:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Your Device                              │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Craft TUI App                          │  │
│  │                                                           │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │  │
│  │  │   Ink UI    │  │ CraftAgent  │  │  MCP Client     │   │  │
│  │  │  (render)   │←→│ (SDK calls) │←→│  (connections)  │   │  │
│  │  └─────────────┘  └──────┬──────┘  └────────┬────────┘   │  │
│  │                          │                   │            │  │
│  │  ┌───────────────────────┴───────────────────┴─────────┐  │  │
│  │  │              Credential Manager                      │  │  │
│  │  │         (keytar → OS Keychain)                      │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   Anthropic API     │
                    │   MCP Servers       │
                    └─────────────────────┘
```

### Remote Mode (Client-Server)

Server runs on Modal, clients connect via WebSocket:

```
┌─────────────────┐
│   TUI Client    │──────┐
│  (Bun + Ink)    │      │
└─────────────────┘      │
                         │
┌─────────────────┐      │      ┌─────────────────────────────────┐
│   iOS Client    │──────┼─────>│         Modal Server            │
│  (Swift/UIKit)  │      │      │                                 │
└─────────────────┘      │ WS   │  ┌───────────────────────────┐  │
                         │      │  │ CraftAgent (same code!)   │  │
┌─────────────────┐      │      │  │ MCP Client (same code!)   │  │
│   Web Client    │──────┤      │  │ Credential Manager        │  │
│  (React/Next)   │      │      │  │   → Modal Secrets backend │  │
└─────────────────┘      │      │  └─────────────┬─────────────┘  │
                         │      │                │                 │
┌─────────────────┐      │      │                ▼                 │
│  macOS Client   │──────┘      │  ┌───────────────────────────┐  │
│  (SwiftUI)      │             │  │   Anthropic API           │  │
└─────────────────┘             │  │   MCP Servers             │  │
                                │  └───────────────────────────┘  │
                                └─────────────────────────────────┘
```

**Key insight:** The core logic (`CraftAgent`, `MCP Client`) is identical in both modes. Only the credential backend and transport layer differ.

---

## Component Architecture

### What's Shared Between Modes

| Component | Local Mode | Remote Mode | Code Sharing |
|-----------|------------|-------------|--------------|
| **CraftAgent** | Direct calls | Runs on server | 100% shared |
| **MCP Client** | Direct connections | Runs on server | 100% shared |
| **OAuth logic** | Local callback | Server callback | 90% shared (URL differs) |
| **AgentEvent types** | Used directly | Sent over WebSocket | 100% shared |
| **Message types** | Local storage | Server storage | 100% shared |
| **Token calculation** | In useAgent | On server | 100% shared |

### What Differs Between Modes

| Component | Local Mode | Remote Mode |
|-----------|------------|-------------|
| **Credential storage** | OS Keychain (keytar) | Modal Secrets API |
| **Config storage** | `~/.craft-agent/` | Modal Volume |
| **Transport** | Direct function calls | WebSocket protocol |
| **OAuth callback** | `localhost:8914` | Modal server URL |

### TUI Components (Always Client-Side)

| Component | Notes |
|-----------|-------|
| **Messages.tsx** | Identical in both modes |
| **Input.tsx** | Identical in both modes |
| **Header.tsx** | Identical in both modes |
| **ToolCall.tsx** | Identical in both modes |
| **useAgent hook** | Wraps either local CraftAgent or RemoteAgent |

---

## Code Sharing Strategy

### Monorepo Structure

```
craft-tui-agent/
├── packages/
│   ├── shared/                    # Shared types & utilities (both modes)
│   │   ├── src/
│   │   │   ├── protocol.ts        # ClientMessage, ServerMessage
│   │   │   ├── events.ts          # AgentEvent types
│   │   │   ├── messages.ts        # StoredMessage, Conversation
│   │   │   ├── tokens.ts          # TokenUsage, cost calculation
│   │   │   ├── workspace.ts       # Workspace, WorkspaceInfo types
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── core/                      # Core logic (used by both modes)
│   │   ├── src/
│   │   │   ├── craft-agent.ts     # CraftAgent - SDK wrapper
│   │   │   ├── mcp/
│   │   │   │   ├── client.ts      # MCP client
│   │   │   │   └── tools.ts       # Tool registry
│   │   │   ├── agents/
│   │   │   │   ├── manager.ts     # Subagent manager
│   │   │   │   └── extractor.ts   # Agent extraction
│   │   │   ├── auth/
│   │   │   │   └── oauth.ts       # OAuth logic (callback URL configurable)
│   │   │   └── credentials/
│   │   │       ├── types.ts       # CredentialManager interface
│   │   │       ├── keytar.ts      # Local: OS Keychain backend
│   │   │       └── modal.ts       # Remote: Modal Secrets backend
│   │   └── package.json
│   │
│   ├── tui/                       # TUI components (used by local + remote TUI)
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── components/        # Messages, Input, Header, ToolCall, etc.
│   │   │   ├── hooks/
│   │   │   │   ├── useAgent.ts    # Wraps LocalAgent or RemoteAgent
│   │   │   │   └── useResize.ts
│   │   │   └── keyboard/
│   │   └── package.json
│   │
│   ├── local/                     # Local mode entry point
│   │   ├── src/
│   │   │   ├── index.tsx          # CLI entry: bun start
│   │   │   └── local-agent.ts     # Direct CraftAgent usage
│   │   └── package.json
│   │
│   ├── remote-client/             # Remote TUI client
│   │   ├── src/
│   │   │   ├── index.tsx          # CLI entry: bun start --server
│   │   │   └── remote-agent.ts    # WebSocket client
│   │   └── package.json
│   │
│   └── server/                    # Modal server (remote mode)
│       ├── src/
│       │   ├── modal_app.py       # Modal entry point
│       │   ├── server.ts          # WebSocket + HTTP server
│       │   └── storage/
│       │       └── workspaces.ts  # Volume storage
│       └── package.json
│
├── package.json                   # Workspace root
└── bun.lockb
```

### Package Dependencies

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   shared    │ ←── │    core     │ ←── │    tui      │
│  (types)    │     │  (logic)    │     │ (components)│
└─────────────┘     └─────────────┘     └──────┬──────┘
                           │                    │
              ┌────────────┼────────────────────┤
              │            │                    │
              ▼            ▼                    ▼
       ┌───────────┐ ┌───────────┐     ┌───────────────┐
       │   local   │ │  server   │     │ remote-client │
       │  (entry)  │ │  (Modal)  │     │   (thin TUI)  │
       └───────────┘ └───────────┘     └───────────────┘

Local mode:  local → tui → core → shared
Remote mode: server → core → shared
             remote-client → tui → shared (no core!)
```

### Shared Package Contents

```typescript
// packages/shared/src/protocol.ts
export type ClientMessage =
  | { type: 'connect'; userId: string; workspaceId?: string }
  | { type: 'chat'; sessionId: string; text: string; attachments?: Attachment[] }
  | { type: 'permission_response'; sessionId: string; requestId: string; allowed: boolean }
  // ... etc

export type ServerMessage =
  | { type: 'connected'; sessionId: string; state: SessionState }
  | { type: 'agent_event'; sessionId: string; event: AgentEvent }
  // ... etc

// packages/shared/src/events.ts
export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'text_delta'; text: string }
  | { type: 'text_complete'; text: string }
  | { type: 'tool_start'; toolName: string; toolId: string; input: unknown }
  | { type: 'tool_result'; toolId: string; result: string }
  | { type: 'permission_request'; requestId: string; command: string }
  | { type: 'ask_user'; requestId: string; questions: Question[] }
  | { type: 'error'; message: string }
  | { type: 'complete'; usage: TokenUsage }

// packages/shared/src/tokens.ts
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalCostUsd: number;
}

export function calculateCost(usage: TokenUsage, model: string): number { ... }

// packages/shared/src/messages.ts
export interface StoredMessage {
  role: 'user' | 'assistant' | 'tool' | 'error' | 'status' | 'system';
  content: string;
  timestamp: number;
  toolName?: string;
  toolId?: string;
}

export interface WorkspaceConversation {
  messages: StoredMessage[];
  tokenUsage: TokenUsage;
  savedAt: number;
}
```

### Import Pattern

```typescript
// In client
import { AgentEvent, ClientMessage, ServerMessage } from '@craft/shared';
import { TokenUsage, calculateCost } from '@craft/shared';

// In server
import { AgentEvent, ClientMessage, ServerMessage } from '@craft/shared';
import { StoredMessage, WorkspaceConversation } from '@craft/shared';
```

### What Gets Reused Across Modes

| Module | Package | Local Mode | Remote Server | Remote Client |
|--------|---------|------------|---------------|---------------|
| `AgentEvent` types | `@craft/shared` | ✓ | ✓ | ✓ |
| `StoredMessage` types | `@craft/shared` | ✓ | ✓ | ✓ |
| `TokenUsage` + cost | `@craft/shared` | ✓ | ✓ | ✓ |
| `CraftAgent` | `@craft/core` | ✓ | ✓ | - |
| `MCP Client` | `@craft/core` | ✓ | ✓ | - |
| `OAuth logic` | `@craft/core` | ✓ | ✓ | - |
| `Subagent manager` | `@craft/core` | ✓ | ✓ | - |
| TUI components | `@craft/tui` | ✓ | - | ✓ |
| `useAgent` hook | `@craft/tui` | ✓ | - | ✓ |
| Keytar backend | `@craft/core` | ✓ | - | - |
| Modal Secrets backend | `@craft/core` | - | ✓ | - |

---

## Adding New Clients (Remote Mode)

The remote mode architecture makes it trivial to add new client platforms. The server handles all business logic; clients only need WebSocket + UI.

### What Each Remote Client Needs

| Responsibility | Server | Any Client |
|----------------|--------|------------|
| Claude Agent SDK | ✓ | - |
| MCP connections | ✓ | - |
| Credential storage | ✓ | - |
| OAuth token exchange | ✓ | - |
| Session management | ✓ | - |
| WebSocket connection | - | ✓ |
| JSON message parsing | - | ✓ |
| UI rendering | - | ✓ |
| Open browser (OAuth) | - | ✓ |
| Permission prompts | - | ✓ |

### Protocol as Contract

The WebSocket protocol defined in `@craft/shared/protocol.ts` is the contract. Any client that can:
1. Open a WebSocket connection
2. Send/receive JSON messages
3. Render UI based on events

...can be a Craft client. The protocol is platform-agnostic.

### Example: iOS Client

```swift
// Minimal iOS client implementation

class CraftClient: ObservableObject {
    private var webSocket: URLSessionWebSocketTask?
    @Published var messages: [Message] = []
    @Published var isConnected = false

    func connect(serverUrl: String, userId: String) {
        let url = URL(string: serverUrl)!
        webSocket = URLSession.shared.webSocketTask(with: url)
        webSocket?.resume()

        // Send connect message
        send(["type": "connect", "userId": userId])
        receiveMessages()
    }

    func chat(sessionId: String, text: String) {
        send([
            "type": "chat",
            "sessionId": sessionId,
            "text": text
        ])
    }

    private func receiveMessages() {
        webSocket?.receive { [weak self] result in
            switch result {
            case .success(.string(let text)):
                if let data = text.data(using: .utf8),
                   let message = try? JSONDecoder().decode(ServerMessage.self, from: data) {
                    DispatchQueue.main.async {
                        self?.handleMessage(message)
                    }
                }
            default: break
            }
            self?.receiveMessages() // Continue listening
        }
    }

    private func handleMessage(_ message: ServerMessage) {
        switch message.type {
        case "connected":
            isConnected = true
        case "agent_event":
            // Update UI based on event type
            handleAgentEvent(message.event)
        case "oauth_url":
            // Open Safari for OAuth
            UIApplication.shared.open(URL(string: message.url)!)
        case "needs_anthropic_key":
            // Show API key input screen
        // ... handle other message types
        }
    }
}
```

### Client Complexity Comparison

| Client Type | Lines of Code (Est.) | Primary Complexity |
|-------------|---------------------|-------------------|
| TUI (Bun/Ink) | ~2,000 | Terminal rendering, keyboard |
| iOS (Swift) | ~1,500 | Native UI, OAuth redirect |
| Web (React) | ~1,200 | Simplest - standard web tech |
| macOS (SwiftUI) | ~1,500 | Native UI, menu bar |

All clients share the same ~200 lines of protocol handling logic.

---

## Architecture

```
┌─────────────────────┐                    ┌─────────────────────────────────┐
│    TUI Client       │                    │         Modal Server            │
│   (Thin Wrapper)    │                    │                                 │
│                     │                    │ ┌─────────────────────────────┐ │
│ ┌─────────────────┐ │                    │ │   Bun WebSocket Server      │ │
│ │ RemoteAgent     │ │<====WebSocket====>│ │   + HTTP (OAuth callback)   │ │
│ │ (just WS client)│ │                    │ └───────────┬─────────────────┘ │
│ └────────┬────────┘ │                    │             │                   │
│          │          │                    │ ┌───────────▼─────────────────┐ │
│ ┌────────▼────────┐ │                    │ │   SessionManager            │ │
│ │    useAgent     │ │                    │ │   (per-user sessions)       │ │
│ │  (event → UI)   │ │                    │ └───────────┬─────────────────┘ │
│ └────────┬────────┘ │                    │             │                   │
│          │          │                    │ ┌───────────▼─────────────────┐ │
│ ┌────────▼────────┐ │                    │ │   CredentialStore           │ │
│ │   Ink UI        │ │                    │ │   (Modal Secrets API)       │ │
│ │ (render only)   │ │                    │ │   - Anthropic API key       │ │
│ └─────────────────┘ │                    │ │   - MCP OAuth tokens        │ │
│                     │                    │ │   - Workspace credentials   │ │
│  NO keychain        │                    │ └───────────┬─────────────────┘ │
│  NO credentials     │                    │             │                   │
│  NO config storage  │                    │ ┌───────────▼─────────────────┐ │
│                     │                    │ │   RemoteCraftAgent          │ │
└─────────────────────┘                    │ │   (SDK wrapper)             │ │
                                           │ └───────────┬─────────────────┘ │
                                           │             │                   │
                                           │ ┌───────────▼─────────────────┐ │
                                           │ │   Claude Agent SDK          │ │
                                           │ │   + MCP Servers             │ │
                                           │ └───────────┬─────────────────┘ │
                                           │             │                   │
                                           │ ┌───────────▼─────────────────┐ │
                                           │ │   Anthropic API             │ │
                                           │ └─────────────────────────────┘ │
                                           └─────────────────────────────────┘
```

## Server-Side Credential Storage

### CredentialStore Design

Server stores all credentials using Modal's native Secrets API. No credentials on client.

**Single Modal workspace** with naming convention `craft-{userId}-...` to isolate per-user secrets.

```typescript
// src/server/credentials/store.ts
// Wraps Modal's Secret.objects API

interface CredentialStore {
  // Secret: "craft-{userId}-anthropic"
  getAnthropicKey(userId: string): Promise<string | null>;
  setAnthropicKey(userId: string, key: string): Promise<void>;

  // Secret: "craft-{userId}-{workspaceId}-oauth"
  getWorkspaceOAuth(userId: string, workspaceId: string): Promise<OAuthTokens | null>;
  setWorkspaceOAuth(userId: string, workspaceId: string, tokens: OAuthTokens): Promise<void>;

  // Secret: "craft-{userId}-{workspaceId}-{agentId}-{name}"
  getSubagentCredential(userId: string, workspaceId: string, agentId: string, name: string): Promise<string | null>;
  setSubagentCredential(userId: string, workspaceId: string, agentId: string, name: string, value: string): Promise<void>;
}

interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
  scope?: string;
}
```

### Secret Naming Convention

```
craft-{userId}-anthropic                           # Anthropic API key
craft-{userId}-{workspaceId}-oauth                 # Workspace MCP OAuth
craft-{userId}-{workspaceId}-{agentId}-{name}      # Subagent credentials
```

### Modal Secrets API Usage

```python
# src/server/credentials/modal_backend.py
from modal import Secret

class ModalCredentialStore:
    def set_anthropic_key(self, user_id: str, key: str):
        """Create/update Anthropic API key for user."""
        Secret.objects.create(
            name=f"craft-{user_id}-anthropic",
            env_dict={"ANTHROPIC_API_KEY": key},
            allow_existing=True  # Upsert behavior
        )

    def get_anthropic_key(self, user_id: str) -> str | None:
        """Retrieve Anthropic API key for user."""
        try:
            secret = Secret.from_name(f"craft-{user_id}-anthropic")
            # Access via environment when injected into function
            return os.environ.get("ANTHROPIC_API_KEY")
        except modal.exception.NotFoundError:
            return None

    def set_workspace_oauth(self, user_id: str, workspace_id: str, tokens: dict):
        """Store OAuth tokens for workspace."""
        Secret.objects.create(
            name=f"craft-{user_id}-{workspace_id}-oauth",
            env_dict={
                "ACCESS_TOKEN": tokens["accessToken"],
                "REFRESH_TOKEN": tokens.get("refreshToken", ""),
                "EXPIRES_AT": str(tokens.get("expiresAt", 0)),
            },
            allow_existing=True
        )

    def delete_credential(self, secret_name: str):
        """Remove a credential."""
        Secret.objects.delete(name=secret_name, allow_missing=True)

    def list_user_secrets(self, user_id: str) -> list[str]:
        """List all secrets for a user."""
        all_secrets = Secret.objects.list()
        return [s.name for s in all_secrets if s.name.startswith(f"craft-{user_id}-")]
```

### Benefits of Modal Secrets

- **Native integration** - No additional infrastructure
- **Automatic encryption** - Modal handles at-rest encryption
- **SOC 2 / HIPAA compliant** - Enterprise-grade security
- **No encryption code** - Eliminates custom crypto implementation
- **Audit logging** - Via Modal dashboard

### Alternative: External Secret Store (future)

For multi-cloud or enterprise deployments:
- Infisical (open-source, self-hostable)
- Doppler (SaaS, $3/user/month)
- HashiCorp Vault

### OAuth Flow (Server-Side)

OAuth flows are handled entirely by the server. Client just opens a browser URL.

```
Client                              Server                              MCP Provider
   |                                   |                                      |
   |-- oauth_start (workspaceId) ----->|                                      |
   |                                   |-- Generate PKCE challenge            |
   |                                   |-- Store state in session             |
   |<-- oauth_url (url to open) -------|                                      |
   |                                   |                                      |
   | (user opens URL in browser)       |                                      |
   |                                   |<----- OAuth redirect with code ------|
   |                                   |                                      |
   |                                   |-- Exchange code for tokens --------->|
   |                                   |<----- Access + refresh tokens -------|
   |                                   |                                      |
   |                                   |-- Store tokens in CredentialStore    |
   |<-- oauth_complete (success) ------|                                      |
```

## Protocol

### Client → Server Messages

```typescript
type ClientMessage =
  // Session management
  | { type: 'connect'; userId: string; workspaceId?: string }
  | { type: 'disconnect'; sessionId: string }

  // Chat
  | { type: 'chat'; sessionId: string; text: string; attachments?: Attachment[] }
  | { type: 'interrupt'; sessionId: string }

  // Callbacks
  | { type: 'permission_response'; sessionId: string; requestId: string; allowed: boolean; alwaysAllow?: boolean }
  | { type: 'question_response'; sessionId: string; requestId: string; answers: Record<string, string> }

  // Credential management (client tells server what to store)
  | { type: 'set_anthropic_key'; userId: string; key: string }
  | { type: 'oauth_start'; sessionId: string; workspaceId: string }
  | { type: 'set_api_key'; sessionId: string; agentId: string; apiName: string; key: string }

  // Workspace management
  | { type: 'create_workspace'; userId: string; name: string; mcpUrl: string }
  | { type: 'list_workspaces'; userId: string }
  | { type: 'switch_workspace'; sessionId: string; workspaceId: string }

### Server → Client Messages

```typescript
type ServerMessage =
  // Session
  | { type: 'connected'; sessionId: string; state: SessionState }
  | { type: 'error'; sessionId?: string; code: string; message: string }

  // Agent events (streaming)
  | { type: 'agent_event'; sessionId: string; event: AgentEvent }

  // OAuth flow
  | { type: 'oauth_url'; sessionId: string; url: string }           // Client opens browser
  | { type: 'oauth_complete'; sessionId: string; success: boolean; error?: string }

  // Credential status
  | { type: 'needs_anthropic_key'; userId: string }
  | { type: 'needs_workspace_auth'; sessionId: string; workspaceId: string; authUrl?: string }
  | { type: 'credential_saved'; type: 'anthropic' | 'oauth' | 'api_key' }

  // Workspace management
  | { type: 'workspaces'; userId: string; workspaces: WorkspaceInfo[] }
  | { type: 'workspace_created'; workspaceId: string; name: string }

interface SessionState {
  userId: string;
  workspaceId: string;
  workspaceName: string;
  conversation?: WorkspaceConversation;
  hasAnthropicKey: boolean;
  hasWorkspaceAuth: boolean;
  model: string;
}

interface WorkspaceInfo {
  id: string;
  name: string;
  mcpUrl: string;
  hasAuth: boolean;
}

// Reuse existing format from storage.ts
interface WorkspaceConversation {
  messages: StoredMessage[];
  tokenUsage: { inputTokens, outputTokens, totalTokens, contextTokens, costUsd };
  savedAt: number;
}
```

### Connection Flow

**Initial connection (first time user):**
```
Client                              Server
   |--- connect (userId) ------------->|  Check credentials
   |                                   |  No Anthropic key found
   |<-- needs_anthropic_key -----------|
   |                                   |
   | (client shows API key input)      |
   |--- set_anthropic_key (key) ------>|  Store in Modal Secrets
   |<-- credential_saved --------------|
   |                                   |
   |<-- workspaces ([]) ---------------|  No workspaces yet
   | (client shows "add workspace")    |
   |--- create_workspace (url) ------->|  Create workspace entry
   |                                   |  Check MCP server auth
   |<-- needs_workspace_auth ----------|
   |                                   |
   |--- oauth_start (workspaceId) ---->|  Generate PKCE, store state
   |<-- oauth_url (url) ---------------|
   | (client opens browser)            |
   |                                   |<--- OAuth callback (code)
   |                                   |  Exchange code for tokens
   |                                   |  Store in Modal Secrets
   |<-- oauth_complete (success) ------|
   |                                   |
   |<-- connected (sessionId, state) --|  Ready to chat
```

**Returning user:**
```
Client                              Server
   |--- connect (userId) ------------->|  Load credentials from Modal Secrets
   |                                   |  Has API key ✓, Has workspaces ✓
   |<-- connected (sessionId, state) --|  Includes conversation history
   |  (client displays messages)       |
   |                                   |
   |-------- chat (message) ---------->|  agent.chat()
   |<--- agent_event (text_delta) -----|  Stream events
   |<--- agent_event (permission_req) -|  (server blocks)
   |--- permission_response (allow) -->|  (server continues)
   |<--- agent_event (complete) -------|  Save conversation to Volume
```

### Message Sync Strategy

- **Server-authoritative**: Server stores `conversation.json` per workspace
- **On connect**: Server loads and sends full history to client
- **During chat**: Server builds messages from events, client mirrors
- **On complete**: Server persists updated conversation
- **Same format**: Reuses existing `WorkspaceConversation` interface

### Server Storage (Modal Volume)

**Critical discovery:** SDK sessions are stored **locally**, not on Anthropic's servers!

Session transcripts are stored at: `~/.claude/projects/{project-path}/{sessionId}.jsonl`

Each `.jsonl` contains the **full conversation transcript**:
- User messages
- Assistant responses with tool calls
- Tool results
- Metadata (timestamps, UUIDs, etc.)

Files can be 500KB - 3MB+ depending on conversation length.

```python
# modal_app.py
volume = modal.Volume.from_name("craft-agent-data", create_if_missing=True)

@app.function(
    volumes={"/data": volume},  # Persistent storage
    ...
)
```

**Storage structure on server:**
```
/data/
  workspaces/
    {workspaceId}/
      session-id.txt           # Current sessionId string
      conversation.json        # Display messages + token usage (for TUI)
  claude/
    projects/
      {workspaceId}/
        {sessionId}.jsonl      # Full SDK transcript (conversation state)
```

**Session persistence flow:**
1. Server sets SDK `cwd` option to `/data/claude/projects/{workspaceId}`
2. SDK stores/reads `.jsonl` transcript files from that directory
3. When resuming, SDK reads the `.jsonl` file to restore full context
4. Modal Volume persists everything across container restarts

**Export/Import conversations:**
- **Export**: Download `{sessionId}.jsonl` file
- **Import**: Upload `.jsonl` to server, set as current session
- Full conversation state including all tool calls is preserved

## File Structure

See **Code Sharing Strategy** section above for the full monorepo layout.

### Quick Reference

```
packages/
  shared/           @craft/shared       - Types, protocol, utilities
  core/             @craft/core         - Agent, MCP, OAuth, credentials
  tui/              @craft/tui          - TUI components (Ink)
  local/            @craft/local        - Local mode entry point
  remote-client/    @craft/remote-client - Remote TUI client
  server/           @craft/server       - Modal server
```

### Migration from Current `src/`

```
# Current location          → New package location

src/agent/craft-agent.ts   → packages/core/src/craft-agent.ts
src/mcp/                   → packages/core/src/mcp/
src/agents/                → packages/core/src/agents/
src/auth/oauth.ts          → packages/core/src/auth/oauth.ts
src/credentials/           → packages/core/src/credentials/
                             (add Modal backend alongside keytar)

src/tui/components/        → packages/tui/src/components/
src/tui/hooks/             → packages/tui/src/hooks/
src/tui/keyboard/          → packages/tui/src/keyboard/

src/index.tsx              → packages/local/src/index.tsx (local mode)
                           → packages/remote-client/src/index.tsx (remote mode)

src/config/storage.ts      → packages/local/src/config.ts (local config)
                           → packages/server/src/storage/ (server config)
```

## Implementation Steps

### Phase 0: Monorepo Setup
1. Create `packages/` directory structure
2. Set up Bun workspaces in root `package.json`
3. Create package.json for each package with proper names
4. Configure TypeScript paths for cross-package imports

### Phase 1: Extract Shared Package (`@craft/shared`)
1. Extract `AgentEvent` types → `packages/shared/src/events.ts`
2. Extract `StoredMessage`, `WorkspaceConversation` → `packages/shared/src/messages.ts`
3. Extract `TokenUsage` + cost calculation → `packages/shared/src/tokens.ts`
4. Create `packages/shared/src/protocol.ts` - ClientMessage, ServerMessage types
5. Create `packages/shared/src/workspace.ts` - Workspace, WorkspaceInfo types

### Phase 2: Extract Core Package (`@craft/core`)
1. Move `src/agent/craft-agent.ts` → `packages/core/src/craft-agent.ts`
2. Move `src/mcp/` → `packages/core/src/mcp/`
3. Move `src/agents/` → `packages/core/src/agents/`
4. Move `src/auth/oauth.ts` → `packages/core/src/auth/oauth.ts`
   - Make callback URL configurable (local vs remote)
5. Refactor `src/credentials/`:
   - Create `packages/core/src/credentials/types.ts` - CredentialManager interface
   - Move keytar backend → `packages/core/src/credentials/keytar.ts`
   - Create Modal backend → `packages/core/src/credentials/modal.ts`

### Phase 3: Extract TUI Package (`@craft/tui`)
1. Move `src/tui/components/` → `packages/tui/src/components/`
2. Move `src/tui/hooks/` → `packages/tui/src/hooks/`
3. Move `src/tui/keyboard/` → `packages/tui/src/keyboard/`
4. Refactor `useAgent` hook to accept agent interface (local or remote)

### Phase 4: Create Local Entry Point (`@craft/local`)
1. Create `packages/local/src/index.tsx` - CLI entry for `bun start`
2. Create `packages/local/src/local-agent.ts` - wraps CraftAgent directly
3. Move local config handling
4. **Test: Local mode works identically to current app**

### Phase 5: Create Server Package (`@craft/server`)
1. Create `packages/server/src/modal_app.py` - Modal entry point
2. Create `packages/server/src/server.ts`:
   - WebSocket server (chat, permissions, questions)
   - HTTP server (OAuth callback)
   - Session management
3. Create `packages/server/src/storage/`:
   - `workspaces.ts` - CRUD on Volume
   - `conversations.ts` - Save/load conversations
4. Configure to use Modal Secrets credential backend

### Phase 6: Create Remote Client (`@craft/remote-client`)
1. Create `packages/remote-client/src/index.tsx` - CLI entry for `bun start --server`
2. Create `packages/remote-client/src/remote-agent.ts`:
   - WebSocket client
   - Implements same interface as local-agent
3. Add connection UI: `ApiKeyInput.tsx`, `OAuthWait.tsx`

### Phase 7: Deployment & Testing
1. Volume setup: `/data` for conversations
2. Modal Secrets for credentials
3. Deployment script with health checks
4. End-to-end tests for both modes

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Deployment modes | Local + Remote | Supports offline dev and multi-client access |
| Code structure | Bun monorepo with 6 packages | Core logic shared between modes |
| Core package | `@craft/core` | Agent, MCP, OAuth reused by local + server |
| TUI package | `@craft/tui` | Components reused by local + remote-client |
| Credential backends | Keytar (local) + Modal Secrets (remote) | Swappable via interface |
| Transport (remote) | WebSocket + HTTP | WS for chat/events, HTTP for OAuth callback |
| Server runtime | Bun subprocess on Modal | Reuses existing TypeScript code |
| Secret isolation | Naming prefix per user | Single Modal workspace, `craft-{userId}-...` |
| OAuth callback | Configurable URL | `localhost:8914` (local) or Modal URL (remote) |

## Critical Files Reference

- `src/agent/craft-agent.ts:24-33` - AgentEvent types to share
- `src/agent/craft-agent.ts:36-41` - PendingPermission pattern
- `src/agent/craft-agent.ts:66-69` - PendingQuestion pattern
- `src/tui/hooks/useAgent.ts:77-80` - TokenUsage interface
- `src/config/storage.ts` - Workspace, StoredConfig types

## Open Questions

### Resolved
- **Platform**: Modal (Bun subprocess approach)
- **Multi-tenancy**: Single user per instance (MVP)
- **MCP location**: Server-side, credentials stored encrypted on server
- **Anthropic key**: Per-user, encrypted on server (not Modal secret - allows multiple users)
- **OAuth tokens**: Server stores, server refreshes

### Open
- **User identification**: How does client get userId?
  - Option A: Auto-generated UUID stored in `~/.craft-agent-id` (simplest)
  - Option B: Auth flow (OAuth with identity provider)
  - Option C: Self-selected username (collision risk)

- **Token refresh**: When OAuth token expires
  - Option A: Server auto-refreshes, client never knows
  - Option B: Server sends `needs_workspace_auth` to re-trigger OAuth

- **Multi-device**: If same userId from multiple devices
  - Current design: Last-connected device wins, previous gets disconnected
  - Future: Multiple sessions per user

## Security Considerations

### Modal Secrets Security
- **At-rest encryption** - Modal encrypts all secrets automatically
- **SOC 2 Type 2 certified** - Enterprise compliance
- **HIPAA compliant** - With BAA available
- **Access logging** - Comprehensive audit trails via Modal dashboard

### Secret Isolation
- Each user's secrets prefixed with `craft-{userId}-`
- All secrets visible to Modal workspace admins (acceptable for MVP)
- Future: per-user Modal workspaces for stronger isolation

### Transport Security
- WebSocket over TLS (wss://)
- Modal provides HTTPS termination

### OAuth Security
- PKCE prevents authorization code interception
- State parameter prevents CSRF
- Tokens never sent to client - stored directly in Modal Secrets
