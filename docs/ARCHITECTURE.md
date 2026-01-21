# Craft Agents Architecture

This document provides a high-level overview of the Craft Agents system architecture, focusing on the core logic, data flow, and key components.

## System Overview

Craft Agents is a desktop application built on **Electron**, using **React** for the UI and **Bun** as the runtime. It leverages the **Claude Agent SDK** to power its AI capabilities, providing a secure and extensible environment for agentic workflows.

### Tech Stack

| Layer | Technology | Description |
|-------|------------|-------------|
| **Runtime** | [Bun](https://bun.sh/) | Fast JavaScript runtime and package manager |
| **Desktop** | [Electron](https://www.electronjs.org/) | Cross-platform desktop application framework |
| **Frontend** | React + Vite | UI framework with fast build tooling |
| **UI Kit** | [shadcn/ui](https://ui.shadcn.com/) | Reusable components built with Radix UI and Tailwind |
| **Styling** | Tailwind CSS v4 | Utility-first CSS framework |
| **State** | Jotai | Atomic state management for React |
| **AI** | [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) | Core agent capabilities |

---

## Core Components (`packages/shared`)

The core business logic resides in the `@craft-agent/shared` package. This ensures logic can be reused across different interfaces (Electron, CLI, etc.).

### 1. CraftAgent (`src/agent/craft-agent.ts`)
The `CraftAgent` class is the heart of the system. It wraps the Claude Agent SDK and adds application-specific layers:

- **Session Management**: Handles session IDs, resumption, and conversation history.
- **Tool Interception (Hooks)**:
  - **PreToolUse**: Intercepts tool calls to check permissions (Safe/Ask/Auto modes) and expand file paths (e.g., `~` expansion).
  - **PostToolUse**: Intercepts tool results to summarize large outputs (using a lightweight model) before they hit the context window limit.
- **Source Integration**: Dynamically builds and injects MCP servers and API tools based on the active workspace configuration.
- **Error Handling**: Converts raw SDK errors into user-friendly typed errors (e.g., Auth, Rate Limit, Billing).

### 2. Sources System (`src/sources/`)
"Sources" are external data connections that the agent can use. The system supports three types:

- **MCP Servers**: Connects to Model Context Protocol servers (local stdio or remote HTTP/SSE).
- **REST APIs**: Auto-generates tools for APIs (Google, Slack, Microsoft, etc.) with built-in auth handling.
- **Local Files**: Grants access to local directories.

**Key Components:**
- **SourceServerBuilder (`server-builder.ts`)**: Converts source configs into SDK-compatible MCP server objects.
- **CredentialManager**: Handles secure storage and retrieval of API keys and OAuth tokens.

### 3. Permission System (`src/agent/mode-manager.ts`)
A three-level permission system ensures user safety while maintaining flexibility. Modes are session-scoped.

| Mode | Behavior |
|------|----------|
| **Safe (Explore)** | **Read-only**. Blocks all write operations (file edits, API mutations). Allows read-only tools (Read, Glob, Grep) and safe bash commands (`ls`, `cat`, etc.). |
| **Ask (Default)** | **Interactive**. Prompts the user for confirmation before executing dangerous commands (Bash) or write operations. |
| **Auto (Allow All)** | **Unrestricted**. Auto-approves all tool calls. Useful for trusted autonomous tasks. |

**Configuration:**
- **Permissions.json**: Fine-grained control (allow/block specific tools or API endpoints) at the workspace or source level.

### 4. Configuration & Storage
All data is stored locally in `~/.craft-agent/`:

- **config.json**: Global settings (workspaces, default mode).
- **credentials.enc**: AES-256-GCM encrypted storage for sensitive keys.
- **workspaces/{id}/**: Workspace-specific data.
  - `sessions/`: Chat history (JSONL).
  - `sources/`: Source configurations.
  - `permissions.json`: Workspace safety rules.

---

## Data Flow

### 1. Agent Initialization
1. User opens a workspace.
2. `CraftAgent` initializes with the workspace config.
3. `SourceServerBuilder` reads enabled sources and builds MCP server configs.
4. `CredentialManager` decrypts necessary tokens.

### 2. Chat Loop
1. **User Input**: User sends a message (e.g., "Check my PRs").
2. **Context Injection**: The agent prepends system info (date, active sources, workspace capabilities) to the prompt.
3. **Claude Inference**: The model decides to call a tool (e.g., `mcp__github__get_prs`).
4. **PreToolUse Hook**:
   - Checks if the source is active.
   - Checks `PermissionMode` (Safe/Ask/Auto).
   - If "Ask", prompts user via UI callback.
5. **Tool Execution**: The tool runs (via MCP or local execution).
6. **PostToolUse Hook**:
   - Checks result size.
   - If > 60KB, summarizes the result to save tokens.
7. **Response**: The agent generates a text response based on the tool result.

---

## Directory Structure

```
craft-agents/
├── apps/
│   └── electron/              # Desktop GUI (Renderer + Main process)
│       ├── src/main/          # Electron main (Window mgmt, IPC)
│       └── src/renderer/      # React UI (Components, Hooks, Jotai)
└── packages/
    ├── core/                  # Shared TypeScript types
    └── shared/                # Core Business Logic
        ├── src/
        │   ├── agent/         # Agent logic & Permissions
        │   ├── auth/          # OAuth flows
        │   ├── config/        # File-based config storage
        │   ├── credentials/   # Encryption logic
        │   ├── mcp/           # MCP Client integration
        │   ├── sessions/      # Session persistence
        │   └── sources/       # Source management
```
