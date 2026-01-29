# Craft Agents Codebase Investigation & Agent-Native Alignment

This document captures learnings from investigating the Craft Agents OSS codebase and its alignment with the "Agent-native Architectures" principles from Dan Shipper's article.



[TOC]



## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture Deep Dive](#architecture-deep-dive)
3. [The Agent Loop](#the-agent-loop)
4. [Agent-Native Principles Alignment](#agent-native-principles-alignment)
5. [UI-Agent Parity Analysis](#ui-agent-parity-analysis)
6. [Building a CLI](#building-a-cli)
7. [Key Takeaways](#key-takeaways)

---

## Project Overview

**Craft Agents** is an open-source desktop application built with Claude's Agent SDK that provides a beautiful UI for working with Claude as an AI agent.

### What It Is

- A desktop Electron app for interacting with Claude
- Built on top of `@anthropic-ai/claude-agent-sdk`
- Supports MCP (Model Context Protocol) for tool integration
- Multi-session management with workflow statuses
- Permission-based safety controls

### Project Structure

```
craft-agents-oss/
├── apps/
│   ├── electron/          # Main desktop app (Electron + React)
│   ├── viewer/            # Session viewer web app
│   └── marketing/         # Marketing website
├── packages/
│   ├── core/              # Shared TypeScript types
│   ├── shared/            # Business logic (agent, auth, MCP, sessions)
│   ├── ui/                # React UI components
│   └── mermaid/           # Mermaid diagram support
└── scripts/               # Build utilities
```

### Key Insight: Separation of Concerns

The architecture separates:
- **`packages/core`**: Type definitions (Workspace, Session, Message, AgentEvent)
- **`packages/shared`**: All business logic (CraftAgent, HeadlessRunner, config, credentials)
- **`apps/electron`**: UI layer (React components, IPC handlers)

This means the **agent logic is UI-independent** - a critical design for building CLI tools.

---

## Architecture Deep Dive

### Technology Stack

| Layer | Technology |
|-------|------------|
| Runtime | Bun |
| AI | `@anthropic-ai/claude-agent-sdk` |
| Desktop | Electron 39.x |
| Frontend | React 18 + Tailwind CSS v4 |
| UI Components | shadcn/ui + Radix UI |
| State | Jotai |
| Build | esbuild + Vite |

### Key Files

| File | Purpose | LOC |
|------|---------|-----|
| `packages/shared/src/agent/craft-agent.ts` | Core CraftAgent class | ~3,000 |
| `packages/shared/src/agent/mode-manager.ts` | Permission system | ~1,500 |
| `packages/shared/src/headless/runner.ts` | Non-interactive runner | ~285 |
| `apps/electron/src/main/ipc.ts` | Electron IPC handlers | - |

### Data Storage

All data is file-based (aligning with agent-native principles):

```
~/.craft-agent/
├── config.json                     # Main config (workspaces, auth type)
├── credentials.enc                 # Encrypted credentials (AES-256-GCM)
├── preferences.json                # User preferences
├── theme.json                      # App-level theme
└── workspaces/
    └── {id}/
        ├── config.json             # Workspace settings
        ├── sessions/               # Session JSONL files
        ├── sources/                # MCP source configs
        │   └── {slug}/
        │       ├── config.json
        │       └── guide.md
        └── statuses/               # Status workflow config
```

---

## The Agent Loop

### Key Discovery: SDK Handles the Loop

The agent loop is **NOT** built directly on LLM calls. Instead, it's delegated to Claude's Agent SDK.

**Location**: `packages/shared/src/agent/craft-agent.ts:1561`

```typescript
// The core loop - consuming SDK events
for await (const message of this.currentQuery) {
  const events = this.convertSDKMessage(message, toolIndex, ...);
  for (const event of events) {
    yield event;
  }
}
```

### What the SDK Handles

- LLM API calls and streaming
- Tool execution loop (call LLM → execute tools → call LLM again)
- Message history management
- Session persistence
- MCP server connections and tool discovery
- Abort/interrupt handling

### What Craft Agents Adds

1. **Event transformation** - Converts SDK events to UI-friendly `AgentEvent` types
2. **Permission modes** - Adds safe/ask/allow-all layer via `PreToolUse` hooks
3. **Source auto-activation** - Detects inactive MCP sources and activates them
4. **Large result summarization** - Uses `PostToolUse` to summarize big outputs (>60KB)
5. **Session recovery** - Handles failed resume attempts gracefully
6. **UI integration** - Yields events that the renderer consumes

### Simplified View

```typescript
// SDK creates the query with full agent loop
this.currentQuery = query({ prompt, options });

// Craft Agents consumes and decorates the event stream
for await (const message of this.currentQuery) {
  yield* this.convertSDKMessage(message);
}
```

The SDK's `query()` function returns an async iterable that internally runs the full agent loop until completion.

---

## Agent-Native Principles Alignment

Reference: "Agent-native Architectures: How to Build Apps After Code Ends" by Dan Shipper

### 1. Parity ✅ Strong

> "Whatever the user can do through the UI, the agent should be able to achieve through tools."

**How Craft Agents implements this:**
- MCP integration provides 32+ Craft document tools
- Source connections (Google, Slack, Microsoft APIs)
- Local filesystem access via bash
- Permission system controls access, not capability

**Evidence**: The IPC channels map directly to agent capabilities:

| UI Action | Agent Capability |
|-----------|-----------------|
| Create session | Agent has session context |
| Send message | `chat()` method |
| File attachments | File read/write tools |
| Connect to APIs | Source tools |
| Search files | MCP file tools, bash |

### 2. Granularity ✅ Strong

> "Tools should be atomic primitives. Features are outcomes achieved by an agent operating in a loop."

**How Craft Agents implements this:**
- Uses atomic MCP tools (read_file, write_file, bash, etc.)
- The SDK handles the loop; outcomes are described in prompts
- No bundled "analyze_and_organize" style tools

**Example from codebase:**
```typescript
// Atomic tools provided via MCP
tools: bash, file operations, MCP tools
// User describes outcome
prompt: "Organize my downloads folder"
// Agent loops until achieved
```

### 3. Composability ✅ Strong

> "With atomic tools and parity, you can create new features just by writing new prompts."

**How Craft Agents implements this:**
- New "features" are prompts sent to the agent
- MCP tools can be composed in any order
- No hardcoded feature workflows

### 4. Files as Universal Interface ✅ Strong

> "Agents are naturally good at files. Claude Code works because bash + filesystem is the most battle-tested agent interface."

**How Craft Agents implements this:**
- All config in JSON files at `~/.craft-agent/`
- Sessions stored as JSONL files
- Workspace-scoped file organization
- Human-readable markdown guides for sources

**File structure follows the article's recommendations:**
```
~/.craft-agent/workspaces/{id}/
├── config.json          # Entity data
├── sessions/            # Collections
└── sources/{slug}/
    ├── config.json      # Source config
    └── guide.md         # Human-readable setup guide
```

### 5. Agent-to-UI Communication ✅ Strong

> "When agents act, the UI should reflect it immediately."

**How Craft Agents implements this:**

The `AgentEvent` type mirrors the article's recommendations exactly:

```typescript
type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; toolUseId: string; toolName: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; result: string; isError: boolean }
  | { type: 'error'; message: string }
  | { type: 'complete'; usage?: TokenUsage }
  // ... more event types
```

The UI streams all events in real-time - no silent actions.

### 6. Approval and User Agency ✅ Strong

> "When agents take unsolicited actions, you need to decide how much autonomy to grant."

**Three permission modes:**

| Mode | Display Name | Behavior |
|------|--------------|----------|
| `safe` | Explore | Read-only, blocks write operations |
| `ask` | Ask to Edit | Prompts for bash commands (default) |
| `allow-all` | Auto | Auto-approves all commands |

This maps to the article's stakes/reversibility matrix.

### 7. Emergent Capability ⚠️ Partial

> "The agent can accomplish things you didn't explicitly design for."

**Status**: Depends on connected MCP servers

Craft Agents is a **meta-implementation** - it's infrastructure for agent-native apps rather than a domain-specific app. Emergent capability comes from:
- The MCP tools you connect
- The bash primitives available
- The flexibility of the permission system

### 8. Improvement Over Time ⚠️ Partial

> "Agent-native applications get better through accumulated context and prompt refinement."

**What's implemented:**
- Session persistence ✅
- Session resume ✅

**What's missing:**
- No `context.md` pattern for accumulated learning
- Prompt refinement happens at SDK level, not workspace level
- No agent self-modification capabilities

---

## UI-Agent Parity Analysis

### UI Capabilities (IPC Channels)

From `apps/electron/src/shared/types.ts`:

```typescript
export const IPC_CHANNELS = {
  // Session management
  GET_SESSIONS: 'sessions:get',
  CREATE_SESSION: 'sessions:create',
  DELETE_SESSION: 'sessions:delete',
  SEND_MESSAGE: 'sessions:sendMessage',
  CANCEL_PROCESSING: 'sessions:cancel',
  RESPOND_TO_PERMISSION: 'sessions:respondToPermission',

  // Workspace management
  GET_WORKSPACES: 'workspaces:get',
  CREATE_WORKSPACE: 'workspaces:create',

  // File operations
  READ_FILE: 'file:read',
  OPEN_FILE_DIALOG: 'file:openDialog',
  STORE_ATTACHMENT: 'file:storeAttachment',

  // ... more channels
}
```

### Agent Capabilities (via SDK + MCP)

- **bash** - Execute shell commands
- **File operations** - read, write, edit, glob, grep
- **MCP server tools** - 32+ built-in
- **REST API calls** - via source integrations
- **Task management** - create, update, complete
- **Web fetch/search** - via MCP tools

### Parity Mapping

| UI Action | Agent Equivalent | Parity? |
|-----------|------------------|---------|
| Create/delete sessions | Session context | ✅ |
| Send messages | `chat()` method | ✅ |
| File attachments | File read/write tools | ✅ |
| Permission approval | `onPermissionRequest` callback | ✅ |
| Workspace switching | Agent scoped to workspace | ✅ |
| Read/search files | MCP file tools, bash | ✅ |
| Connect to APIs | Source tools | ✅ |
| System preferences | Config files | ✅ |

---

## Building a CLI

### Why It's Easy

The architecture already supports headless execution:

1. **Business logic is decoupled** - All core logic lives in `@craft-agent/shared`
2. **HeadlessRunner exists** - Already at `packages/shared/src/headless/runner.ts`
3. **Event streaming** - Same `AgentEvent` types work for CLI output

### HeadlessRunner API

```typescript
import { HeadlessRunner } from '@craft-agent/shared/headless';

const runner = new HeadlessRunner({
  workspace: { id: 'my-workspace', rootPath: '/path/to/workspace' },
  prompt: 'List all files in the current directory',
  permissionPolicy: 'allow-safe',  // or 'allow-all', 'deny-all'
  model: 'claude-sonnet-4-5-20250929',
  sessionId: 'optional-session-id',
  sessionResume: true,  // Resume last session
});

// Blocking execution
const result = await runner.run();

// Streaming execution
for await (const event of runner.runStreaming()) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.text);
  }
}
```

### HeadlessConfig Type

```typescript
interface HeadlessConfig {
  // Required
  prompt: string;
  workspace: Workspace;

  // Optional
  model?: string;
  outputFormat?: 'text' | 'json' | 'stream-json';
  permissionPolicy?: 'deny-all' | 'allow-safe' | 'allow-all';
  sessionId?: string;
  sessionResume?: boolean;
}
```

### HeadlessEvent Types

```typescript
type HeadlessEvent =
  | { type: 'status'; message: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; result: string; isError: boolean }
  | { type: 'error'; message: string }
  | { type: 'complete'; result: HeadlessResult };
```

### Permission Policies

| Policy | Safe Commands | Write Commands |
|--------|---------------|----------------|
| `deny-all` | Blocked | Blocked |
| `allow-safe` | Auto-allowed | Blocked |
| `allow-all` | Auto-allowed | Auto-allowed |

Safe commands: `ls`, `cat`, `head`, `tail`, `grep`, `find`, `pwd`, `echo`, `which`, `wc`, `sort`, `uniq`, `diff`, `file`, `stat`, `tree`, `less`, `more`

---

## Key Takeaways

### 1. SDK Abstraction is Powerful

The Claude Agent SDK handles all the complex agent loop logic:
- LLM calls
- Tool execution
- Message history
- Session management

Craft Agents focuses on **what to do with the events**, not how to run the loop.

### 2. Separation Enables Flexibility

Because business logic is in `@craft-agent/shared`:
- Electron app is just a UI wrapper
- CLI can use the same `CraftAgent` and `HeadlessRunner`
- Other UIs (web, mobile wrappers) could be built

### 3. Files Are First-Class

Following the agent-native principle, everything is file-based:
- Human-readable configs
- Easy backup/sync
- Agent can inspect and modify

### 4. Permission System is Well-Designed

Three-level system with per-session isolation:
- Safe for exploration
- Interactive for normal use
- Full auto for automation

### 5. Event Streaming is the Integration Pattern

Both UI and CLI consume the same `AgentEvent` stream:
- Consistent behavior
- Easy to add new consumers
- Real-time feedback

### 6. MCP is the Extensibility Layer

Instead of building custom tools:
- Connect MCP servers
- Get tools dynamically
- Compose as needed

---

## Next Steps

1. **Build the CLI** - Use HeadlessRunner in a Bun script
2. **Test permission policies** - Verify safe/ask/allow-all work correctly
3. **Explore MCP integration** - Connect additional MCP servers
4. **Consider improvements** - Add context.md pattern for memory

---

*Written by Claude (Opus 4.5) | 2026-01-28 20:15 PST*
