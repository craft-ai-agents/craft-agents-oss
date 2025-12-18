# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this package.

**Important:** Keep this file and the root `CLAUDE.md` up-to-date whenever functionality changes.

## Overview

`@craft-agent/shared` is the core business logic package for Craft Agent. It contains:
- Agent implementation (CraftAgent, plan-tools)
- Authentication (OAuth, credentials)
- Configuration (storage, preferences)
- MCP client and validation
- Headless execution mode
- Subagent system

## Package Exports

This package uses subpath exports for clean imports:

```typescript
import { CraftAgent } from '@craft-agent/shared/agent';
import { loadStoredConfig, type Workspace } from '@craft-agent/shared/config';
import { getCredentialManager } from '@craft-agent/shared/credentials';
import { SubAgentManager } from '@craft-agent/shared/agents';
import { CraftMcpClient } from '@craft-agent/shared/mcp';
import { debug } from '@craft-agent/shared/utils';
```

## Directory Structure

```
src/
├── agent/              # CraftAgent, plan-tools, errors
├── agents/             # Subagent management, extraction, cache
├── auth/               # OAuth, balance, craft-token, state
├── clients/            # External API clients (Craft API)
├── config/             # Storage, preferences, models
├── credentials/        # Secure credential storage (AES-256-GCM)
├── headless/           # Non-interactive execution mode
├── mcp/                # MCP client and connection validation
├── prompts/            # System prompt generation
├── subscription/       # Craft subscription checking
├── utils/              # Debug logging, file handling, summarization
├── validation/         # URL validation
├── version/            # Version management, install scripts
├── branding.ts         # Branding constants
└── cache-ttl-interceptor.ts  # Extended prompt cache TTL
```

## Key Concepts

### CraftAgent (`src/agent/craft-agent.ts`)
The main agent class that wraps the Claude Agent SDK. Handles:
- MCP server connections
- Tool permissions via PreToolUse hook
- Large result summarization via PostToolUse hook
- Plan mode integration
- Session continuity

### Credentials (`src/credentials/`)
All sensitive credentials (API keys, OAuth tokens) are stored in an AES-256-GCM encrypted file at `~/.craft-agent/credentials.enc`. The `CredentialManager` provides the API for reading and writing credentials.

### Configuration (`src/config/storage.ts`)
Multi-workspace configuration stored in `~/.craft-agent/config.json`. Supports multiple workspaces with separate MCP servers and sessions.

### Subagents (`src/agents/`)
Subagents are specialized agents defined in Craft documents. The `SubAgentManager` handles discovery, extraction, and activation.

## Dependencies

- `@craft-agent/core` - Shared types
- `@anthropic-ai/claude-agent-sdk` - Claude Agent SDK

## Type Checking

```bash
# From monorepo root
cd packages/shared && bun run tsc --noEmit
```
